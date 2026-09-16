import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { mock } from 'node:test';
import type { Graph } from '../src/lib/comfyui';
import type { ComfyNodeInfo } from '../src/lib/pipelines/comfy-devices';
import type { PipelineSnapshot } from '../src/lib/pipelines/schema';

await fs.mkdir(path.join(process.cwd(), '.data'), { recursive: true });
const directory = await fs.mkdtemp(path.join(process.cwd(), '.data/upscale-workflows-test-'));
const comfyDir = path.join(directory, 'comfy');
const comfyUrl = 'http://127.0.0.1:19997';
Object.assign(process.env, {
  FROK_DATA_DIR: directory, FROK_ENV_FILE: path.join(directory, 'unused.env'),
  VPIPE_WORKDIR: path.join(directory, 'vpipe'), COMFYUI_DIR: comfyDir,
  COMFYUI_URL: comfyUrl, FROK_COMFYUI_PRIVATE: '1', COMFYUI_API_KEY: '',
  REALESRGAN_BIN: path.join(directory, 'runtimes/realesrgan/runtime/realesrgan-ncnn-vulkan'),
  REALESRGAN_MODEL_DIR: path.join(directory, 'runtimes/realesrgan/runtime/models'),
});
// Match the image-model tests: no renderer, installer or external process may run.
for (const method of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork'] as const) {
  mock.method(childProcess, method, () => { throw Error('No processes allowed in upscale workflow tests.'); });
}
syncBuiltinESMExports();
let info: ComfyNodeInfo = {};
const requests: string[] = [];
mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
  requests.push(`${method} ${url}`);
  assert.equal(method, 'GET', 'Tests must never submit a prompt or upload media.');
  assert.equal(url, `${comfyUrl}/object_info`, 'No server, inference or download requests are allowed.');
  return Response.json(info);
});

const { createLibraryFixture } = await import('./fixtures/library');
const fixture = await createLibraryFixture();
const { test, beforeEach, after } = fixture;
const { diskCatalog, validatePipeline, pipelineStatus } = await import('../src/lib/pipelines/catalog');
const { bindPipeline } = await import('../src/lib/pipelines/bindings');
const { dependencies, comfyModelReference } = await import('../src/lib/pipelines/dependencies');
const { resolveComfyDevices, comfyOptions } = await import('../src/lib/pipelines/comfy-devices');
const { pipelineMetadata, currentPipelineSelections } = await import('../src/lib/pipelines/schema');
const { validateUpscaleOutput } = await import('../src/lib/upscale-workflow');
const { renderComfy } = await import('../src/lib/comfyui');
const db = await import('../src/lib/db');

beforeEach(async () => {
  info = {};
  requests.length = 0;
  db.db.exec('DELETE FROM settings;');
  db.setValue('connections', { vpipe: false, comfyui: true, ollama: false });
  db.setValue('runnerLocations', { comfyDir, comfyUrl, vpipeWorkdir: path.join(directory, 'vpipe') });
  await fs.rm(path.join(comfyDir, 'models'), { recursive: true, force: true });
  for (const area of ['models', 'input', 'output']) await fs.mkdir(path.join(comfyDir, area), { recursive: true });
});
after(async () => {
  mock.restoreAll();
  syncBuiltinESMExports();
  fixture.close();
  await fs.rm(directory, { recursive: true, force: true });
});

async function upscalers() {
  const result = await diskCatalog();
  assert.deepEqual(result.errors, []);
  const pipelines = result.entries.filter(pipeline => pipeline.kind === 'upscale' && pipeline.metadata.runner === 'comfyui');
  assert.deepEqual(pipelines.map(pipeline => pipeline.metadata.id).sort(), ['comfyui:realesrgan', 'comfyui:seedvr2']);
  return pipelines;
}
function oneNode(graph: Graph, type: string): [string, Graph[string]] {
  const nodes = Object.entries(graph).filter(([, node]) => node.class_type === type);
  assert.equal(nodes.length, 1, `Expected exactly one ${type}.`);
  return nodes[0];
}
function serviceInfo(pipeline: PipelineSnapshot, devices = ['cpu', 'mps']): ComfyNodeInfo {
  const graph = pipeline.graph as Graph;
  const result: ComfyNodeInfo = {};
  for (const node of Object.values(graph)) {
    const required: Record<string, unknown[]> = {};
    for (const [field, value] of Object.entries(node.inputs)) {
      if (comfyModelReference(node, field)) required[field] = [[value]];
    }
    result[node.class_type] = { input: { required } };
  }
  for (const binding of pipeline.metadata.bindings.device ?? []) {
    result[graph[binding.node].class_type].input!.required![binding.field] = [devices];
  }
  // An uploaded job video is deliberately absent from the service's shared list.
  result.LoadVideo.input!.required!.file = [['unrelated-upload.mp4']];
  return result;
}
const input = {
  request: { mode: 'upscale' as const, prompt: '', aspect: '16:9', duration: 6, quality: 'preview' as const, count: 1, enhance: false, referenceIds: [] },
  prompt: '', seed: 73, width: 1280, height: 720,
  directory: path.join(directory, 'job'), output: path.join(directory, 'job/output.mp4'),
  source: path.join(directory, 'library/source.mp4'), references: [],
};

test('catalog exposes two real ComfyUI upscale graphs that preserve video audio and fps', async () => {
  for (const pipeline of await upscalers()) {
    assert.equal(pipeline.metadata.runner, 'comfyui');
    assert.deepEqual(pipeline.metadata.videoSource, { node: 'load-video', field: 'file' });
    validatePipeline(pipeline);
    const graph = pipeline.graph as Graph;
    const [load] = oneNode(graph, 'LoadVideo');
    const [components, split] = oneNode(graph, 'GetVideoComponents');
    const [create, video] = oneNode(graph, 'CreateVideo');
    const [save, output] = oneNode(graph, 'SaveVideo');
    assert.deepEqual(split.inputs.video, [load, 0]);
    assert.deepEqual(video.inputs.audio, [components, 1]);
    assert.deepEqual(video.inputs.fps, [components, 2]);
    assert.deepEqual(output.inputs.video, [create, 0]);
    assert.ok(pipeline.metadata.bindings.output?.some(binding => binding.node === save && binding.field === 'filename_prefix'));
    const seedvr2 = pipeline.metadata.id === 'comfyui:seedvr2';
    const [upscale, node] = oneNode(graph, seedvr2 ? 'SeedVR2VideoUpscaler' : 'ImageUpscaleWithModel');
    assert.deepEqual(node.inputs.image, [components, 0]);
    if (seedvr2) {
      assert.deepEqual(node.inputs.dit, [oneNode(graph, 'SeedVR2LoadDiTModel')[0], 0]);
      assert.deepEqual(node.inputs.vae, [oneNode(graph, 'SeedVR2LoadVAEModel')[0], 0]);
      assert.ok(pipeline.metadata.bindings.device?.length, 'SeedVR2 must bind its service device controls.');
    } else {
      assert.deepEqual(node.inputs.upscale_model, [oneNode(graph, 'UpscaleModelLoader')[0], 0]);
    }
    // A final size adjustment may follow the neural upscale before video assembly.
    let frames = video.inputs.images;
    const visited = new Set<string>();
    while (Array.isArray(frames) && frames[0] !== upscale) {
      const id = String(frames[0]);
      assert.ok(!visited.has(id), 'The frame path must not contain a cycle.');
      visited.add(id);
      assert.ok(graph[id], `Missing frame node ${id}.`);
      frames = graph[id].inputs.image ?? graph[id].inputs.images;
    }
    assert.deepEqual(frames, [upscale, 0], 'Saved frames must pass through the neural upscale.');
  }
});

test('binding uses each job upload and private output without mutating saved graphs', async () => {
  for (const pipeline of await upscalers()) {
    const original = structuredClone(pipeline);
    for (const job of ['job-a', 'job-b']) {
      const source = `frok/library/${job}/source video.mp4`;
      const prefix = `frok/library/${job}/render`;
      const graph = bindPipeline(pipeline, input, prefix, source) as Graph;
      assert.equal(graph['load-video'].inputs.file, source);
      for (const binding of pipeline.metadata.bindings.output!) assert.equal(graph[binding.node].inputs[binding.field], prefix);
      for (const binding of pipeline.metadata.bindings.seed ?? []) assert.equal(graph[binding.node].inputs[binding.field], input.seed);
      for (const binding of pipeline.metadata.bindings.width ?? []) assert.equal(graph[binding.node].inputs[binding.field], input.width);
      for (const binding of pipeline.metadata.bindings.height ?? []) assert.equal(graph[binding.node].inputs[binding.field], input.height);
      for (const binding of pipeline.metadata.bindings.device ?? []) {
        assert.equal(graph[binding.node].inputs[binding.field], (original.graph as Graph)[binding.node].inputs[binding.field]);
      }
    }
    assert.deepEqual(pipeline, original);
    assert.throws(() => bindPipeline(pipeline, { ...input, source: undefined }), /source video/i);
  }
});

test('upscale prompt and seed bindings are optional, but every output remains private', async () => {
  for (const pipeline of await upscalers()) {
    delete pipeline.metadata.bindings.prompt;
    delete pipeline.metadata.bindings.seed;
    assert.doesNotThrow(() => validatePipeline(pipeline));
    assert.doesNotThrow(() => bindPipeline(pipeline, input));
    pipeline.metadata.bindings.output = [];
    assert.throws(() => validatePipeline(pipeline), /output|private job storage/i);
  }
});

test('extra video loaders and invalid or conflicting video source metadata are rejected', async t => {
  const [pipeline] = await upscalers();
  const cases: [string, (snapshot: PipelineSnapshot) => void][] = [
    ['extra unbound LoadVideo', p => { p.graph.extra = { class_type: 'LoadVideo', inputs: { file: 'other-job.mp4' } }; }],
    ['missing videoSource', p => { delete p.metadata.videoSource; }],
    ['missing loader node', p => { delete p.graph['load-video']; }],
    ['source targets a different node', p => { p.metadata.videoSource!.node = 'components'; }],
    ['wrong loader type', p => { (p.graph as Graph)['load-video'].class_type = 'GetVideoComponents'; }],
    ['wrong source field', p => { p.metadata.videoSource!.field = 'image'; }],
    ['prototype field', p => { p.metadata.videoSource!.field = '__proto__'; }],
    ['non-upscale kind', p => { p.kind = 'video'; }],
    ['image source conflict', p => { p.metadata.source = { target: 'load-video', field: 'file' }; }],
    ['reference source conflict', p => { p.metadata.references = { target: 'load-video', field: 'file', max: 1 }; }],
    ['ordinary binding overwrites loader', p => { p.metadata.bindings.prompt = [{ node: 'load-video', field: 'file' }]; }],
  ];
  for (const [name, mutate] of cases) await t.test(name, () => {
    const changed = structuredClone(pipeline);
    mutate(changed);
    assert.throws(() => validatePipeline(changed), /videoSource|private uploaded|video inputs|video loader/i);
  });
});

test('dependencies discover both SeedVR2 loaders and Real-ESRGAN model_name without declarations', async () => {
  const [pipeline] = await upscalers();
  pipeline.metadata.dependencies = [];

  pipeline.graph = {
    dit: { class_type: 'SeedVR2LoadDiTModel', inputs: { model: 'fixture-dit.gguf' } },
    vae: { class_type: 'SeedVR2LoadVAEModel', inputs: { model: 'fixture-vae.safetensors' } },
    esrgan: { class_type: 'UpscaleModelLoader', inputs: { model_name: 'fixture-x4.pth' } },
    duplicate: { class_type: 'UpscaleModelLoader', inputs: { model_name: 'fixture-x4.pth' } },
    unrelated: { class_type: 'OtherNode', inputs: { model: 'not-a-file', model_name: 'not-a-file' } },
    linked: { class_type: 'SeedVR2LoadDiTModel', inputs: { model: ['dit', 0] } },
  };
  const expected = ['SEEDVR2/fixture-dit.gguf', 'SEEDVR2/fixture-vae.safetensors', 'upscale_models/fixture-x4.pth'];
  assert.deepEqual(dependencies(pipeline).map(dependency => dependency.reference).sort(), expected);
  assert.ok(dependencies(pipeline).every(dependency => dependency.kind === 'file'));
  pipeline.metadata.dependencies = [{ kind: 'file', reference: expected[0], files: [], generated: false, url: 'https://example.invalid/fixture-dit.gguf' }];
  assert.equal(dependencies(pipeline).length, 3);
  assert.equal(dependencies(pipeline).find(dependency => dependency.reference === expected[0])?.url, 'https://example.invalid/fixture-dit.gguf');
});

test('known missing models are reported even when their loader combo has no option', async () => {
  for (const pipeline of await upscalers()) {
    info = serviceInfo(pipeline);
    for (const node of Object.values(pipeline.graph as Graph)) {
      for (const field of Object.keys(node.inputs)) {
        if (comfyModelReference(node, field)) info[node.class_type].input!.required![field] = [[]];
      }
    }
    const status = await pipelineStatus(pipeline);
    assert.equal(status.ready, false);
    assert.equal(status.state, 'missing', status.detail);
    assert.deepEqual(status.missing.sort(), dependencies(pipeline).map(dependency => dependency.reference).sort());
    assert.ok(status.missing.length > 0);
  }
  assert.deepEqual(requests, Array(2).fill(`GET ${comfyUrl}/object_info`));
});

test('missing SeedVR2 custom nodes block generation and explain what to install', async () => {
  const pipeline = (await upscalers()).find(p => p.metadata.id === 'comfyui:seedvr2')!;
  for (const type of ['SeedVR2LoadDiTModel', 'SeedVR2LoadVAEModel', 'SeedVR2VideoUpscaler']) {
    info = serviceInfo(pipeline);
    delete info[type];
    const status = await pipelineStatus(pipeline);
    assert.equal(status.ready, false);
    assert.equal(status.state, 'attention');
    assert.ok(status.detail.includes(type), status.detail);
  }
});

test('readiness verifies ComfyUI files and ignores the per-job video combo', async () => {
  for (const pipeline of await upscalers()) {
    const original = structuredClone(pipeline);
    // Tiny structural fixtures replace the manifest's production file sizes.
    // No real weights, sparse model files or runtime receipts are needed.
    pipeline.metadata.dependencies = dependencies(pipeline);

    for (const dependency of pipeline.metadata.dependencies) {
      const header = Buffer.from(JSON.stringify({ fixture: { dtype: 'U8', shape: [1], data_offsets: [0, 1] } }));
      const length = Buffer.alloc(8);
      length.writeBigUInt64LE(BigInt(header.length));
      const bytes = dependency.reference.endsWith('.safetensors') ? Buffer.concat([length, header, Buffer.alloc(1)]) : Buffer.from('synthetic model marker');
      dependency.size = bytes.length;
      delete dependency.sha256;
      const file = path.join(comfyDir, 'models', dependency.reference);
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, bytes);
    }
    info = serviceInfo(pipeline, ['cpu', 'cuda:3']);
    const before = structuredClone(pipeline);
    const ready = await pipelineStatus(pipeline);
    assert.equal(ready.ready, true, ready.detail);
    assert.equal(ready.state, 'ready');
    assert.deepEqual(ready.missing, []);
    assert.deepEqual(pipeline, before, 'Readiness device resolution must not rewrite saved workflows.');
    const dependency = pipeline.metadata.dependencies[0];
    await fs.rm(path.join(comfyDir, 'models', dependency.reference));
    const missing = await pipelineStatus(pipeline);
    assert.equal(missing.ready, false, 'A service combo cannot certify a missing model file.');
    assert.deepEqual(missing.missing, [dependency.reference]);
    assert.deepEqual(pipeline.graph, original.graph);
  }
});

test('local runtime receipts cannot make missing ComfyUI upscale models ready', async () => {
  // Keep legacy runtime markers isolated; model names come from the workflow.
  const pipelines = await upscalers();
  const seedvr2 = pipelines.find(pipeline => pipeline.metadata.id === 'comfyui:seedvr2')!;
  const runtime = path.join(directory, 'runtimes/seedvr2');
  const files: Record<string, { size: number; mtimeMs: number }> = {};
  const required = [
    process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python',
    'source/inference_cli.py', 'source/pos_emb.pt', 'source/neg_emb.pt',
    ...dependencies(seedvr2).map(model => `models/${path.posix.basename(model.reference)}`),
  ];
  for (const relative of required) {
    const file = path.join(runtime, relative);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'synthetic installation marker', { mode: 0o700 });
    const stat = await fs.stat(file);
    files[path.relative(runtime, file)] = { size: stat.size, mtimeMs: stat.mtimeMs };
  }
  await fs.writeFile(path.join(runtime, 'ready.json'), JSON.stringify({ ready: true, device: 'mps', files }));
  await fs.mkdir(process.env.REALESRGAN_MODEL_DIR!, { recursive: true });
  for (const file of [process.env.REALESRGAN_BIN!, ...['bin', 'param'].map(extension => path.join(process.env.REALESRGAN_MODEL_DIR!, `realesrgan-x4plus.${extension}`))]) {
    await fs.writeFile(file, 'synthetic installation marker', { mode: 0o700 });
  }
  db.setValue('prepared:seedvr2', true);
  db.setValue('prepared:realesrgan', true);
  db.setValue('prepared:upscale', true);
  for (const pipeline of pipelines) {
    info = serviceInfo(pipeline);
    db.setValue(`prepared:${pipeline.metadata.id}`, true);
    const status = await pipelineStatus(pipeline);
    assert.equal(status.ready, false);
    assert.ok(status.missing.length > 0);
  }
});

function deviceFixture() {
  const graph: Graph = {
    dit: { class_type: 'SeedVR2LoadDiTModel', inputs: { device: 'mps', offload_device: 'cpu' } },
    vae: { class_type: 'SeedVR2LoadVAEModel', inputs: { device: 'cuda:0', offload_device: 'cpu' } },
    untouched: { class_type: 'OtherNode', inputs: { device: 'administrator-choice' } },
  };
  const metadata = pipelineMetadata.parse({ version: 1, id: 'comfyui:device-fixture', name: 'Devices', runner: 'comfyui', bindings: { device: [{ node: 'dit', field: 'device' }, { node: 'vae', field: 'device' }] } });
  return { graph, metadata };
}
test('V3 typed combos work alongside legacy combos for devices and model readiness', async () => {
  const pipeline = (await upscalers()).find(p => p.metadata.id === 'comfyui:seedvr2')!;
  info = serviceInfo(pipeline, ['cuda:1']);
  for (const node of Object.values(info)) for (const [field, entry] of Object.entries(node.input?.required || {})) {
    if (Array.isArray(entry[0])) node.input!.required![field] = ['COMBO', { options: entry[0] }];
  }
  assert.deepEqual(comfyOptions(info, 'SeedVR2LoadDiTModel', 'device'), ['cuda:1']);
  const graph = structuredClone(pipeline.graph) as Graph;
  resolveComfyDevices(graph, pipeline.metadata, info);
  assert.equal(graph.dit.inputs.device, 'cuda:1');
  assert.equal(graph.vae.inputs.device, 'cuda:1');
  const status = await pipelineStatus(pipeline);
  assert.equal(status.ready, false);
  assert.ok(status.missing.length > 0);
});
test('device bindings follow the connected MPS or CUDA options, including optional inputs', () => {
  for (const device of ['mps', 'cuda:3']) {
    const { graph, metadata } = deviceFixture();
    const info: ComfyNodeInfo = {
      SeedVR2LoadDiTModel: { input: { required: { device: [['cpu', device]] } } },
      SeedVR2LoadVAEModel: { input: { optional: { device: [['cpu', device]] } } },
    };
    resolveComfyDevices(graph, metadata, info);
    assert.equal(graph.dit.inputs.device, device);
    assert.equal(graph.vae.inputs.device, device);
    assert.equal(graph.dit.inputs.offload_device, 'cpu');
    assert.equal(graph.vae.inputs.offload_device, 'cpu');
    assert.equal(graph.untouched.inputs.device, 'administrator-choice');
  }
});
test('device resolution preserves a compatible administrator choice', () => {
  const { graph, metadata } = deviceFixture();
  graph.dit.inputs.device = 'cuda:2';
  const info: ComfyNodeInfo = Object.fromEntries(['SeedVR2LoadDiTModel', 'SeedVR2LoadVAEModel'].map(type => [type, { input: { required: { device: [['cpu', 'cuda:0', 'cuda:2']] } } }]));
  resolveComfyDevices(graph, metadata, info);
  assert.equal(graph.dit.inputs.device, 'cuda:2');
  assert.equal(graph.vae.inputs.device, 'cuda:0');
});
test('device bindings reject absent GPU options instead of falling back to the Frok host', () => {
  for (const options of [undefined, ['cpu'], ['auto', 'cuda', 'mps:0']]) {
    const { graph, metadata } = deviceFixture();
    const info: ComfyNodeInfo = options ? { SeedVR2LoadDiTModel: { input: { required: { device: [options] } } } } : {};
    assert.throws(() => resolveComfyDevices(graph, metadata, info), /no compatible GPU/i);
  }
});
test('readiness also rejects a connected service with no compatible GPU', async () => {
  const pipeline = (await upscalers()).find(p => p.metadata.id === 'comfyui:seedvr2')!;
  info = serviceInfo(pipeline, ['cpu']);
  const status = await pipelineStatus(pipeline);
  assert.equal(status.ready, false);
  assert.equal(status.state, 'attention');
  assert.match(status.detail, /no compatible GPU/i);
});

test('legacy upscale selections migrate without changing other choices or enabling ComfyUI', () => {
  db.setValue('connections', { vpipe: true, comfyui: false, ollama: false });
  for (const engine of ['seedvr2', 'realesrgan']) {
    const saved = { image: 'vpipe:krea-2-turbo', video: 'vpipe:minimax-h3-turbo', reference: null, upscale: `local:${engine}` };
    const original = structuredClone(saved);
    const migrated = currentPipelineSelections(saved);
    assert.deepEqual(migrated, { ...saved, upscale: `comfyui:${engine}` });
    assert.deepEqual(saved, original);
    assert.notEqual(migrated, saved);
    db.setValue('pipelineSelections', saved);
    assert.deepEqual(db.settings().pipelineSelections, migrated);
    assert.equal(db.settings().connections.comfyui, false);
  }
  for (const upscale of [null, 'comfyui:seedvr2', 'comfyui:realesrgan', 'comfyui:custom-upscaler']) {
    const saved = { image: null, video: null, reference: null, upscale };
    assert.deepEqual(currentPipelineSelections(saved), saved);
  }
});

test('upscale output accepts improved dimensions with original proportions and duration', () => {
  for (const [width, height] of [[640, 360], [360, 640], [512, 512]]) {
    const source = { width, height, duration: 6 };
    assert.doesNotThrow(() => validateUpscaleOutput(source, { width: width * 2, height: height * 2, duration: 6 }));
    assert.doesNotThrow(() => validateUpscaleOutput(source, { width: width * 2, height: height * 2, duration: 6.1 }));
  }
});
test('upscale output rejects unchanged, reduced or non-finite dimensions', () => {
  const source = { width: 640, height: 360, duration: 6 };
  for (const [width, height] of [[640, 360], [640, 720], [1280, 360], [320, 180], [0, 720], [NaN, 720], [1280, Infinity]]) {
    assert.throws(() => validateUpscaleOutput(source, { width, height, duration: 6 }), /increase the video dimensions/i);
  }
});
test('upscale output rejects changed proportions even when both dimensions increase', () => {
  assert.throws(() => validateUpscaleOutput({ width: 640, height: 360, duration: 6 }, { width: 1280, height: 960, duration: 6 }), /aspect ratio/i);
});
test('upscale output rejects changed or invalid duration', () => {
  const source = { width: 640, height: 360, duration: 6 };
  for (const duration of [5.8, 6.2, 0, NaN, Infinity]) {
    assert.throws(() => validateUpscaleOutput(source, { width: 1280, height: 720, duration }), /video length|frame rate/i);
  }
  for (const duration of [undefined, 0]) {
    assert.throws(() => validateUpscaleOutput({ ...source, duration }, { width: 1280, height: 720, duration: 6 }), /video length|frame rate/i);
  }
});

test('renderComfy uploads MP4, submits upscale graphs and cleans only its runtime copies', async t => {
  // Adapt the in-memory backend in runner-isolation.test.ts; every response and
  // video byte is synthetic, and no HTTP server or renderer is started.
  const roots = { input: path.join(comfyDir, 'input'), output: path.join(comfyDir, 'output') };
  type Submission = { prompt: Graph; prompt_id: string; client_id: string; namespace: string };
  const submissions: Submission[] = [], uploads: string[] = [], deletedHistory: string[] = [];
  const source = path.join(fixture.mediaDir, 'original.MP4');
  const originalBytes = Buffer.from('synthetic original MP4 bytes');
  const renderedBytes = Buffer.from('synthetic enhanced MP4 bytes');
  await fs.writeFile(source, originalBytes);
  const sentinels = Object.values(roots).map(root => path.join(root, 'frok/other-job/keep.mp4'));
  for (const sentinel of sentinels) {
    await fs.mkdir(path.dirname(sentinel), { recursive: true });
    await fs.writeFile(sentinel, 'unrelated job');
  }
  t.mock.method(globalThis, 'fetch', async (target: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(target instanceof Request ? target.url : String(target));
    const method = init.method ?? 'GET';
    assert.equal(url.origin, comfyUrl);
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
    if (url.pathname === '/view' && method === 'GET') {
      const area = url.searchParams.get('type');
      assert.ok(area === 'input' || area === 'output');
      const folder = url.searchParams.get('subfolder')!;
      const filename = url.searchParams.get('filename')!;
      assert.ok(folder.startsWith('frok/local/'));
      assert.ok(filename === 'mapping.txt' || filename === 'render_00001.mp4');
      return new Response(await fs.readFile(path.join(roots[area], folder, filename)));
    }
    if (url.pathname === '/upload/image' && method === 'POST') {
      assert.ok(init.body instanceof FormData);
      const form = init.body, file = form.get('image') as File, folder = String(form.get('subfolder'));
      assert.equal(form.get('overwrite'), 'false');
      assert.equal(form.get('type'), 'input');
      assert.match(file.name, /^[a-f0-9-]{36}\.mp4$/);
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), originalBytes);
      await fs.mkdir(path.join(roots.input, folder), { recursive: true });
      await fs.writeFile(path.join(roots.input, folder, file.name), originalBytes);
      uploads.push(`${folder}/${file.name}`);
      return Response.json({ name: file.name, subfolder: folder, type: 'input' });
    }
    if (url.pathname === '/object_info' && method === 'GET') return Response.json(info);
    if (url.pathname === '/prompt' && method === 'POST') {
      assert.equal(typeof init.body, 'string');
      const body = JSON.parse(init.body as string) as Omit<Submission, 'namespace'>;
      const namespace = path.posix.dirname(String(body.prompt['save-video'].inputs.filename_prefix));
      submissions.push({ ...body, namespace });
      await fs.mkdir(path.join(roots.output, namespace), { recursive: true });
      await fs.writeFile(path.join(roots.output, namespace, 'render_00001.mp4'), renderedBytes);
      return Response.json({ prompt_id: body.prompt_id, node_errors: {} });
    }
    if (url.pathname.startsWith('/history/') && method === 'GET') {
      const submitted = submissions.find(item => item.prompt_id === url.pathname.split('/').at(-1));
      assert.ok(submitted);
      return Response.json({ [submitted.prompt_id]: {
        status: { completed: true, status_str: 'success' },
        outputs: {
          'load-video': { gifs: [{ filename: path.posix.basename(uploads.at(-1)!), subfolder: submitted.namespace, type: 'input' }] },
          'save-video': { videos: [{ filename: 'render_00001.mp4', subfolder: submitted.namespace, type: 'output' }] },
        },
      } });
    }
    if (url.pathname === '/history' && method === 'POST') {
      const body = JSON.parse(init.body as string);
      assert.deepEqual(Object.keys(body), ['delete']);
      assert.equal(body.delete.length, 1);
      assert.ok(submissions.some(item => item.prompt_id === body.delete[0]));
      deletedHistory.push(body.delete[0]);
      return Response.json({});
    }
    throw Error(`Unexpected mocked ComfyUI request: ${method} ${url.pathname}`);
  });
  for (const pipeline of await upscalers()) {
    const original = structuredClone(pipeline);
    const job = path.join(fixture.jobsDir, randomUUID(), '0');
    await fs.mkdir(job, { recursive: true });
    const output = path.join(job, 'raw.mp4');
    info = serviceInfo(pipeline, ['cpu', 'cuda:3']);
    const runtimes: number[] = [], logs: string[] = [];
    await renderComfy({ ...input, request: { ...input.request, pipeline }, source, directory: job, output,
      signal: AbortSignal.timeout(5000), log: line => logs.push(line), onRuntime: seconds => runtimes.push(seconds) });
    const submitted = submissions.at(-1)!;
    assert.equal(submitted.prompt['load-video'].inputs.file, uploads.at(-1));
    assert.equal(submitted.prompt['save-video'].inputs.filename_prefix, `${submitted.namespace}/render`);
    assert.deepEqual(submitted.prompt['create-video'].inputs.audio, ['components', 1]);
    assert.deepEqual(submitted.prompt['create-video'].inputs.fps, ['components', 2]);
    for (const binding of pipeline.metadata.bindings.device ?? []) assert.equal(submitted.prompt[binding.node].inputs[binding.field], 'cuda:3');
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(job, 'comfy-workflow.json'), 'utf8')), submitted.prompt);
    assert.deepEqual(await fs.readFile(output), renderedBytes);
    assert.deepEqual(await fs.readFile(source), originalBytes);
    assert.deepEqual(pipeline, original);
    assert.equal(runtimes.length, 1);
    assert.ok(Number.isFinite(runtimes[0]) && runtimes[0] >= 0);
    assert.ok(!(await fs.readdir(job)).some(name => name.startsWith('comfy-cleanup-')));
    for (const root of Object.values(roots)) await assert.rejects(fs.stat(path.join(root, submitted.namespace)), { code: 'ENOENT' });
    assert.ok(!logs.some(line => line.includes('cleanup is pending')));
  }
  assert.equal(submissions.length, 2);
  assert.equal(new Set(submissions.map(item => item.namespace)).size, 2);
  assert.equal(new Set(submissions.map(item => item.client_id)).size, 2);
  assert.equal(new Set(uploads).size, 2);
  assert.deepEqual(deletedHistory, submissions.map(item => item.prompt_id));
  for (const sentinel of sentinels) assert.equal(await fs.readFile(sentinel, 'utf8'), 'unrelated job');
});
