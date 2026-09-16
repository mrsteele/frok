import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createLibraryFixture } from './fixtures/library';
import { dependencySchema, pipelineMetadata } from '../src/lib/pipelines/schema';

const directory = await fs.mkdtemp(path.resolve('.data/model-download-test-'));
process.env.FROK_DATA_DIR = directory;
process.env.COMFYUI_DIR = path.join(directory, 'comfy');
process.env.HF_TOKEN = 'hf_SyntheticDownloadToken';
const fixture = await createLibraryFixture(), { test, beforeEach, after } = fixture;
const { prepareComfyFiles } = await import('../src/lib/providers/model-download');
const { setValue } = await import('../src/lib/db');
const root = path.join(process.env.COMFYUI_DIR, 'models');
const header = Buffer.from(JSON.stringify({ weight: { dtype: 'U8', shape: [4], data_offsets: [0, 4] } }));
const length = Buffer.alloc(8); length.writeBigUInt64LE(BigInt(header.length));
const tensor = Buffer.concat([length, header, Buffer.from([1, 2, 3, 4])]);
const dependency = dependencySchema.parse({ kind: 'file', reference: 'diffusion_models/synthetic.safetensors', size: tensor.length,
  sha256: createHash('sha256').update(tensor).digest('hex'), url: 'https://huggingface.co/frok/synthetic/resolve/abc/synthetic.safetensors' });
const snapshot = { metadata: pipelineMetadata.parse({ version: 1, id: 'comfyui:synthetic', name: 'Synthetic', runner: 'comfyui' }), kind: 'image' as const, graph: {}, revision: 'synthetic' };
const controller = () => new AbortController();
const prepare = (signal = controller().signal, files = [dependency], log = (_line: string) => {}) => prepareComfyFiles({ snapshot, files, signal, log, directory });
beforeEach(async () => { setValue('comfyDir', process.env.COMFYUI_DIR); await fs.rm(root, { recursive: true, force: true }); await fs.mkdir(root, { recursive: true }); });
after(async () => { fixture.close(); await fs.rm(directory, { recursive: true, force: true }); });

test('verified streamed downloads publish once, reuse files, and never forward the HF token to a CDN', async t => {
  const calls: { url: string; token: string | null }[] = [];
  t.mock.method(globalThis, 'fetch', async (url: URL, init: RequestInit) => {
    calls.push({ url: String(url), token: new Headers(init.headers).get('Authorization') });
    return calls.length === 1 ? new Response(null, { status: 302, headers: { location: 'https://cdn-lfs.hf.co/synthetic' } }) : new Response(tensor);
  });
  const logs: string[] = [];
  await prepare(controller().signal, [dependency], line => logs.push(line));
  assert.deepEqual(await fs.readFile(path.join(root, dependency.reference)), tensor);
  assert.equal(calls[0].token, 'Bearer hf_SyntheticDownloadToken'); assert.equal(calls[1].token, null);
  assert.ok(!logs.join('').includes(process.env.HF_TOKEN!));
  await prepare(); assert.equal(calls.length, 2, 'Already installed matching files do not download again.');
  assert.deepEqual(await fs.readdir(path.join(root, 'diffusion_models')), ['synthetic.safetensors']);
});
test('checksum failure and interrupted downloads remove their partial files', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(Buffer.alloc(tensor.length)));
  await assert.rejects(prepare(), /checksum/);
  assert.deepEqual(await fs.readdir(path.join(root, 'diffusion_models')), []);
  const abort = controller();
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ pull(stream) { stream.enqueue(tensor.subarray(0, 8)); abort.abort(); stream.close(); } })));
  await assert.rejects(prepare(abort.signal), /abort/i);
  assert.deepEqual(await fs.readdir(path.join(root, 'diffusion_models')), []);
});
test('existing conflicting files and symlinks remain untouched without fetching', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw Error('Must not fetch.'); });
  const destination = path.join(root, dependency.reference); await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, 'a user-managed model');
  await assert.rejects(prepare(), /kept the existing file/);
  assert.equal(await fs.readFile(destination, 'utf8'), 'a user-managed model');
  await fs.rm(destination); await fs.symlink(path.join(directory, 'outside'), destination);
  await assert.rejects(prepare(), /symlinks/); assert.equal(fetch.mock.callCount(), 0);
});
test('access failures offer actionable help and redirects cannot reach local services', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 403 }));
  await assert.rejects(prepare(), /HTTP 403.*API tokens/);
  const fetch = t.mock.method(globalThis, 'fetch', async () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } }));
  await assert.rejects(prepare(), /unsupported host/); assert.equal(fetch.mock.callCount(), 1);
  assert.deepEqual(await fs.readdir(path.join(root, 'diffusion_models')), []);
});
