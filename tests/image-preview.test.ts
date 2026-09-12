import { createLibraryFixture } from './fixtures/library';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { Generation } from '../src/lib/types';

const testDir = path.join(process.cwd(), '.data', `image-preview-test-${process.pid}`);
process.env.FROK_DATA_DIR = testDir;
process.env.VPIPE_WORKDIR = path.join(testDir, 'vpipe');
process.env.VPIPE_BIN = path.join(testDir, 'fake-vpipe.mjs');
process.env.VPIPE_IMAGE_MODEL='synthetic/image';
process.env.VPIPE_LIVE_PREVIEWS = '1';
const fixture = await createLibraryFixture();
const { test, after, beforeEach } = fixture;
await fs.mkdir(path.join(process.env.VPIPE_WORKDIR!,'models/krea/Krea-2-Turbo'),{recursive:true});
await fs.mkdir(path.join(process.env.VPIPE_WORKDIR!,'models/mgwr/M87'),{recursive:true});
await fs.writeFile(path.join(process.env.VPIPE_WORKDIR!,'models/mgwr/M87/m87_lora_v1.safetensors'),'synthetic unused adapter');
const store = await import('../src/lib/db');
const routes = await import('../src/app/api/[[...segments]]/route');
const { buildPipeline, renderVpipe } = await import('./fixtures/pipeline');
const { imagePreviewDir, imagePreviewPath, readImagePreview, clearImagePreviews } = await import('../src/lib/image-preview');
const request: Generation = { mode: 'image', prompt: 'Synthetic preview fixture', aspect: '4:3', duration: 6, quality: 'preview', count: 2, enhance: false, referenceIds: [] };
const first = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#32546b' } }).jpeg().toBuffer();
const second = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#92b0c1' } }).jpeg().toBuffer();
const input = (directory: string) => ({ request, prompt: request.prompt, seed: 123, width: 512, height: 384, output: path.join(directory, 'raw.jpeg'), directory, references: [] });
function job() { const value = store.createJob({ kind: 'generate', request, runner: 'vpipe', total: 2 }); return store.updateJob(value.id, { status: 'running' })!; }
function directory(id: string, index = 0) { return path.join(fixture.directory, 'jobs', id, String(index)); }
async function frame(dir: string, name = 'frame.jpg', bytes = first) { await fs.mkdir(imagePreviewDir(dir), { recursive: true }); await fs.writeFile(path.join(imagePreviewDir(dir), name), bytes); }
async function get(id: string, index: string | number = 0, etag?: string, method: 'GET' | 'HEAD' = 'GET') {
  return routes[method](fixture.request(`http://localhost:3000/api/jobs/${id}/preview?index=${encodeURIComponent(index)}`, { method, headers: etag ? { 'If-None-Match': etag } : {} }), { params: Promise.resolve({ segments: ['jobs', id, 'preview'] }) });
}
beforeEach(async () => { store.setValue('runtimeOptions',{liveImagePreviews:true}); delete process.env.FROK_FAKE_PREVIEW_MODE; store.db.exec('DELETE FROM jobs;'); await fs.rm(path.join(fixture.directory, 'jobs'), { recursive: true, force: true }); await fs.mkdir(path.join(fixture.directory, 'jobs'), { recursive: true }); });
after(async () => { fixture.close(); await fs.rm(testDir, { recursive: true, force: true }); });

test('the preview is a separate branch; the final image still decodes the final latent', async () => {
  const value = input(directory('pipeline')), graph = await buildPipeline(value);
  const stage = (id: string) => graph.stages.find(stage => stage.id === id)!;
  assert.deepEqual(stage('frok-preview-decode').iports?.[0], { src: 'generate-image', oport: 1 });
  assert.deepEqual(stage('vae-decode').iports?.[0], { src: 'generate-image', oport: 0 });
  assert.deepEqual(stage('save-image').iports?.[0], { src: 'vae-decode', oport: 0 });
  assert.equal(stage('save-image').config.path, value.output);
  assert.equal(stage('frok-preview-save').config.path, imagePreviewPath(value.directory));
  const declared = new Set<string>();
  for (const stage of graph.stages) { for (const port of stage.iports || []) if (port.src) assert.ok(declared.has(port.src), `${stage.id} references undeclared ${port.src}`); declared.add(stage.id); }
  store.setValue('runtimeOptions',{liveImagePreviews:false});
  assert.ok(!(await buildPipeline(value)).stages.some(stage => stage.id.startsWith('frok-preview')));
  store.setValue('runtimeOptions',{liveImagePreviews:true});
  assert.ok(!(await buildPipeline({ ...value, request: { ...request, mode: 'video', count: 1 } })).stages.some(stage => stage.id.startsWith('frok-preview')));
});

test('the endpoint publishes only the current active image, at a bounded size, without library entries', async () => {
  const value = job();
  assert.equal((await get(value.id)).status, 204);
  await frame(directory(value.id));
  const response = await get(value.id);
  assert.equal(response.status, 200); assert.match(response.headers.get('cache-control') ?? '', /no-store/);
  const metadata = await sharp(Buffer.from(await response.arrayBuffer())).metadata();
  assert.equal(metadata.width, 640); assert.equal(metadata.height, 480);
  assert.equal((await get(value.id, 0, response.headers.get('etag')!)).status, 304);
  assert.equal((await get(value.id, 0, undefined, 'HEAD')).status, 200);
  assert.equal((await get(value.id, 1)).status, 204);
  assert.equal(store.listMedia().length, 0);
  store.updateJob(value.id, { completed: 1 });
  assert.equal((await get(value.id, 0)).status, 204);
  assert.equal((await get(value.id, 1)).status, 204);
  for (const status of ['cancelled', 'failed', 'completed', 'queued'] as const) {
    store.updateJob(value.id, { status, completed: 0 }); assert.equal((await get(value.id)).status, 204);
  }
});

test('partial newer files keep the last complete preview until the new frame can decode', async () => {
  const value = job(), dir = directory(value.id); await frame(dir);
  const previous = (await get(value.id)).headers.get('etag')!;
  await frame(dir, 'frame-000001.jpg', second.subarray(0, 200));
  assert.equal((await get(value.id, 0, previous)).status, 304);
  await frame(dir, 'frame-000001.jpg', second);
  const next = await get(value.id, 0, previous);
  assert.equal(next.status, 200); assert.notEqual(next.headers.get('etag'), previous);
  await frame(dir, 'unrelated.jpg', first); // Only the fixed runner filename pattern is eligible.
  assert.equal((await get(value.id, 0, next.headers.get('etag')!)).status, 304);
  await clearImagePreviews(dir); assert.equal(await readImagePreview(dir), undefined);
});

test('bad paths, non-image runners and disabled previews cannot expose files', async () => {
  const value = job(); await frame(directory(value.id));
  for (const index of [-1, 12, '1/../../elsewhere', 'NaN']) assert.equal((await get(value.id, index)).status, 400);
  assert.equal((await get('not-a-job')).status, 400);
  assert.equal((await get('8a8bb7f4-737a-4ff9-951a-42427683a745')).status, 404);
  store.updateJob(value.id, { runner: 'comfyui' }); assert.equal((await get(value.id)).status, 204);
  store.updateJob(value.id, { runner: 'vpipe', request: { ...request, mode: 'video' } }); assert.equal((await get(value.id)).status, 204);
  store.updateJob(value.id, { request }); store.setValue('runtimeOptions',{liveImagePreviews:false}); assert.equal((await get(value.id)).status, 204);
});

test('runner success, failure and cancellation all clean previews while preserving other job files', async () => {
  // A file-writing process exercises the adapter lifecycle. It never loads a model.
  await fs.writeFile(path.join(testDir, 'fixture.jpg'), first);
  await fs.writeFile(process.env.VPIPE_BIN!, `#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
const graph=JSON.parse(await fs.readFile(process.argv[process.argv.indexOf('--launch')+1],'utf8'));
const target=graph.stages.find(stage=>stage.id==='frok-preview-save').config.path;
await fs.mkdir(path.dirname(target),{recursive:true});
const bytes=await fs.readFile(path.join(path.dirname(process.argv[1]),'fixture.jpg'));
await fs.writeFile(target,bytes);console.log('Preview fixture ready');
if(process.env.FROK_FAKE_PREVIEW_MODE==='cancel')await new Promise(resolve=>setTimeout(resolve,10000));
else if(process.env.FROK_FAKE_PREVIEW_MODE==='fail')process.exitCode=1;
else await fs.writeFile(graph.stages.find(stage=>stage.id==='save-image').config.path,bytes);
`, { mode: 0o755 });
  for (const mode of ['success', 'fail', 'cancel']) {
    process.env.FROK_FAKE_PREVIEW_MODE = mode;
    const dir = directory(mode); await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, 'keep.txt'), 'keep');
    const controller = new AbortController();
    const render = renderVpipe({ ...input(dir), signal: controller.signal, log: line => { if (mode === 'cancel' && line.includes('Preview fixture ready')) controller.abort(); } });
    if (mode === 'success') { await render; assert.deepEqual(await fs.readFile(input(dir).output), first); } else await assert.rejects(render);
    assert.equal(await fs.stat(imagePreviewDir(dir)).catch(() => null), null);
    assert.equal(await fs.readFile(path.join(dir, 'keep.txt'), 'utf8'), 'keep');
  }
});
