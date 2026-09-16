import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createLibraryFixture } from './fixtures/library';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { pipelineMetadata } from '../src/lib/pipelines/schema';
import { PipelineDetails } from '../src/components/settings/pipeline-details';

const directory = await fs.mkdtemp(path.resolve('.data/provider-catalog-test-'));
process.env.FROK_DATA_DIR = directory;
process.env.VPIPE_WORKDIR = path.join(directory, 'vpipe');
const fixture = await createLibraryFixture(), { test, after } = fixture;
const { diskCatalog, pipelineStatus, validatePipeline } = await import('../src/lib/pipelines/catalog');
const { preparationFor, builtinPreparation } = await import('../src/lib/pipelines/builtins');
const { checkPipelineRequest } = await import('../src/lib/pipelines/selection');
const { bindPipeline } = await import('../src/lib/pipelines/bindings');
const { providerFor } = await import('../src/lib/providers/registry');
const { vpipePluginArgs } = await import('../src/lib/providers/vpipe-plugins');
after(async () => { fixture.close(); await fs.rm(directory, { recursive: true, force: true }); });
const workflows = () => diskCatalog(path.resolve('resources/pipelines'));

test('every catalog entry has details and a native or verified file setup plan, with unique identities', async () => {
  const { entries, errors } = await workflows(); assert.deepEqual(errors, []);
  assert.equal(new Set(entries.map(p => p.metadata.id)).size, entries.length);
  for (const p of entries) {
    assert.ok(p.metadata.catalog, p.metadata.id); validatePipeline(p);
    const key = await preparationFor(p);
    // Real-ESRGAN has a manual guide; its original release has no pinned hash.
    if (p.metadata.id === 'comfyui:realesrgan') { assert.equal(key, undefined); continue; }
    assert.ok(key, p.metadata.id); const setup = await builtinPreparation(key);
    assert.equal(setup.snapshot.metadata.id, p.metadata.id);
    assert.ok(p.metadata.runner === 'vpipe' ? setup.graph : setup.files?.every(d => d.sha256 && d.size && /\/resolve\/[a-f0-9]{40}\//.test(d.url!)));
    const changed = structuredClone(p); changed.metadata.name += ' custom';
    assert.equal(await preparationFor(changed), undefined, 'Custom metadata cannot inherit executable setup.');
  }
  assert.equal(providerFor('vpipe').id, 'vpipe'); assert.equal(providerFor('comfyui').id, 'comfyui');
  assert.throws(() => providerFor('__proto__'), /Unsupported/);
});
test('flavors reuse base references, preserve fixed samplers, and bind every seed and frame count', async () => {
  const { entries } = await workflows();
  const base = entries.find(p => p.metadata.id === 'vpipe:krea-2-turbo')!, flavor = entries.find(p => p.metadata.id === 'vpipe:krea-2-turbo-m87')!;
  assert.deepEqual(flavor.metadata.dependencies[0], base.metadata.dependencies[0]);
  for (const p of entries.filter(p => p.kind !== 'upscale')) {
    const input = { request: { mode: p.kind, duration: 8 } as import('../src/lib/types').Generation, prompt: 'A boat', seed: 1234, width: 512, height: 512, output: '/private/job/out', directory: '/private/job', source: p.metadata.source ? '/private/job/source' : undefined, references: [] };
    const graph = bindPipeline(p, input);
    const config = (id: string) => p.metadata.runner === 'vpipe' ? (graph.stages as any[]).find(s => s.id === id).config : (graph as any)[id].inputs;
    for (const binding of p.metadata.bindings.seed!) assert.equal(config(binding.node)[binding.field], 1234);
    for (const binding of p.metadata.bindings.frames || []) {
      const frames = config(binding.node)[binding.field];
      assert.equal((frames - p.metadata.controls.frameOffset) % p.metadata.controls.frameStride, 0); assert.ok(frames >= 8 * p.metadata.controls.fps);
    }
    if (p === flavor) assert.equal(config('text-prompt').text, 'A boat --preview');
  }
});
test('disconnected catalog details include file sizes and gates without probing any runner', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw Error('Do not probe a disconnected provider.'); });
  const { entries } = await workflows();
  const krea = await pipelineStatus(entries.find(p => p.metadata.id === 'vpipe:krea-2-turbo')!, { enabled: false, available: false, detail: '' });
  const qwen = await pipelineStatus(entries.find(p => p.metadata.id === 'comfyui:qwen-image-lightning')!, { enabled: false, available: false, detail: '' });
  const html = renderToStaticMarkup(createElement(PipelineDetails, { pipeline: krea }));
  assert.match(html, /Gated download/); assert.match(html, /Already installed models can run without it/); assert.match(html, /Unrated/); assert.match(html, /Manage workflow files/);
  assert.ok(qwen.files!.every(d => d.size! > 0)); assert.equal(fetch.mock.callCount(), 0);
  const original = entries.find(p => p.metadata.id === krea.id)!.metadata;
  assert.doesNotThrow(() => pipelineMetadata.parse(original));
  assert.throws(() => pipelineMetadata.parse({ ...original, catalog: { ...original.catalog, documentation: 'javascript:alert(1)' } }), /HTTPS/);
});
test('image-only video workflows reject requests without an image before inspecting the runner', async () => {
  const p = (await workflows()).entries.find(p => p.metadata.id === 'comfyui:wan2-2-14b-i2v')!;
  const state = { worker: true, connections: { comfyui: { enabled: true, available: true } }, checks: [{ id: 'ffmpeg', ready: true }] } as import('../src/lib/types').Health;
  await assert.rejects(checkPipelineRequest(p, { mode: 'video' } as import('../src/lib/types').Generation, state), /requires a starting image/);
});
test('LTX native plugins are explicit, local, and required for readiness', async () => {
  const p = (await workflows()).entries.find(p => p.metadata.id === 'vpipe:ltx-2-5')!;
  assert.match((await pipelineStatus(p)).detail, /Install the compatible LTX/);
  const file = path.join(process.env.VPIPE_WORKDIR!, 'plugins/vpipe-ltx-2.5.so'); await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, 'synthetic plugin placeholder, never loaded');
  assert.deepEqual(await vpipePluginArgs(p.metadata), ['--plugin', file]);
  assert.throws(() => pipelineMetadata.parse({ ...p.metadata, plugins: ['../../untrusted'] }));
});
