import test, {after, beforeEach, mock} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import type {Generation} from '../src/lib/types';

const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'frok-runner-isolation-')));
process.env.FROK_DATA_DIR = path.join(root, 'data');
process.env.VPIPE_WORKDIR = path.join(root, 'vpipe');
process.env.VPIPE_IMAGE_MODEL = 'krea/Krea-2-Turbo';
process.env.VPIPE_VIDEO_MODEL = 'local/MiniMax-H3-FL2VA-8bit';
process.env.VPIPE_REFERENCE_MODEL = 'local/MiniMax-H3-Ref2VA-8bit';
process.env.COMFYUI_DIR = path.join(root, 'comfy');
process.env.COMFYUI_URL = 'http://127.0.0.1:8188';
process.env.COMFYUI_API_KEY = 'synthetic-test-key';
const {registry} = await import('../src/lib/registry');
const {libraryDirectory:libraryDirectory}=await import('../src/lib/library');
const store = await import('../src/lib/db');
const {legacyDefaults} = await import('../src/lib/preferences');
function legacy(key:string, value:string|undefined) { store.setValue('environmentDefaults', {...store.getValue('environmentDefaults', {}), legacy:{...legacyDefaults(), [key]:value}}); }
const runJob=<T>(_label:string,fn:()=>T,_kind?:string)=>fn();
const {renderVpipe,factoryPipeline} = await import('./fixtures/pipeline');
const {renderComfy, comfyFetch, cleanupComfyJob, comfyIsolationIssue} = await import('../src/lib/comfyui');
const {validateModelAdapters, resolveVpipeModel, resolveModelAdapter} = await import('../src/lib/model-access');
const owners=['job-a','job-b'];
const models = path.join(process.env.VPIPE_WORKDIR!, 'models');
for (const name of ['krea/Krea-2-Turbo', 'local/MiniMax-H3-FL2VA-8bit', 'local/MiniMax-H3-Ref2VA-8bit', 'mgwr/M87', 'larryvrh/MiniMax-H3-Turbo-Lora']) await fs.mkdir(path.join(models, name), {recursive: true});
for (const name of ['mgwr/M87/m87_lora_v1.safetensors', 'larryvrh/MiniMax-H3-Turbo-Lora/minimax_h3_turbo_v4_step600_ema.safetensors']) await fs.writeFile(path.join(models, name), 'synthetic model marker');
const trustedComfyModels = path.join(process.env.COMFYUI_DIR!, 'models');
await fs.mkdir(trustedComfyModels, {recursive: true});
await fs.writeFile(path.join(trustedComfyModels, 'style.safetensors'), 'synthetic adapter');
const roots = {input: path.join(root, 'input'), output: path.join(root, 'output'), temp: path.join(root, 'temp')};
for (const dir of Object.values(roots)) await fs.mkdir(dir);
const base: Generation = {mode: 'image', prompt: 'Synthetic test brief', aspect: '1:1', duration: 6, quality: 'preview', count: 1, enhance: false, referenceIds: []};
async function inputFor(owner: string) {
  const dir = runJob(owner, () => libraryDirectory());
  const directory = path.join(dir, 'jobs', randomUUID(), '0');
  await fs.mkdir(directory, {recursive: true}); await fs.mkdir(path.join(dir, 'media'), {recursive: true});
  const source = path.join(path.dirname(directory), 'starting-frame.png');
  await fs.writeFile(source, `synthetic source for ${owner}`);
  const lines: string[] = [], controller = new AbortController();
  return {request: {...base}, prompt: base.prompt, seed: 7, width: 16, height: 16, directory, output: path.join(directory, 'raw.jpeg'), references: [] as string[], source, signal: controller.signal, controller, lines, log: (line: string) => lines.push(line)};
}
type Submitted = {prompt_id: string; client_id: string; prompt: Record<string, {class_type: string; inputs: Record<string, unknown>}>; namespace: string; running: boolean};
let submissions: Submitted[] = [], calls: {route: string; method: string; body?: any; mapping?: boolean}[] = [];
let uploadFolders: string[] = [], forged = false, running = false, loseSubmission = false, cancelUnsupported = false, abortOnHistory: AbortController | undefined;
let mismappedArea: string | undefined;
function fakeBackend() {
  mock.method(globalThis, 'fetch', async (target: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(String(target)), route = url.pathname, method = init.method || 'GET';
    assert.equal(url.origin, 'http://127.0.0.1:8188'); assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store');
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer synthetic-test-key');
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const mapping = route === '/view' && url.searchParams.get('filename') === 'mapping.txt';
    calls.push({route, method, body, mapping});
    if (mapping) {
      const area = url.searchParams.get('type') as 'input' | 'output';
      if (mismappedArea === area) return new Response(null, {status: 404});
      return new Response(await fs.readFile(path.join(roots[area], url.searchParams.get('subfolder')!, 'mapping.txt')));
    }
    if (route === '/upload/image') {
      const form = init.body as FormData, file = form.get('image') as File, subfolder = String(form.get('subfolder'));
      assert.equal(form.get('overwrite'), 'false'); assert.notEqual(file.name, 'starting-frame.png');
      uploadFolders.push(subfolder); await fs.mkdir(path.join(roots.input, subfolder), {recursive: true});
      await fs.writeFile(path.join(roots.input, subfolder, file.name), new Uint8Array(await file.arrayBuffer()));
      return Response.json({name: file.name, subfolder, type: 'input'});
    }
    if (route === '/object_info') return Response.json(Object.fromEntries(['CheckpointLoaderSimple', 'CLIPTextEncode', 'EmptyLatentImage', 'KSampler', 'VAEDecode', 'SaveImage'].map(name => [name, {}])));
    if (route === '/prompt') {
      const saved = Object.values(body.prompt as Submitted['prompt']).find(node => node.class_type === 'SaveImage')!;
      const namespace = path.posix.dirname(String(saved.inputs.filename_prefix));
      const entry = {...body, namespace, running}; submissions.push(entry);
      await fs.mkdir(path.join(roots.output, namespace), {recursive: true});
      await fs.writeFile(path.join(roots.output, namespace, 'render_00001.png'), 'synthetic output');
      if (loseSubmission) throw new Error('Synthetic lost submission response');
      return Response.json({prompt_id: entry.prompt_id, node_errors: {}});
    }
    if (route.startsWith('/history/')) {
      const entry = submissions.find(item => item.prompt_id === route.split('/').at(-1));
      abortOnHistory?.abort();
      return Response.json(!entry || entry.running ? {} : {[entry.prompt_id]: {status: {completed: true, status_str: 'success'}, outputs: {'7': {images: [{filename: 'render_00001.png', subfolder: forged ? 'frok/somebody-else' : entry.namespace, type: 'output'}]}}}});
    }
    if (route === '/view') return new Response('synthetic output');
    if (route === '/queue' && method === 'GET') return Response.json({queue_pending: [], queue_running: submissions.filter(item => item.running).map(item => [0, item.prompt_id])});
    if (route.endsWith('/cancel')) {
      if (cancelUnsupported) return new Response(null, {status: 404});
      const entry = submissions.find(item => route.includes(item.prompt_id)); if (entry) entry.running = false;
    }
    return Response.json({});
  });
}
beforeEach(() => {
  mock.restoreAll(); submissions = []; calls = []; uploadFolders = [];
  forged = running = loseSubmission = cancelUnsupported = false; abortOnHistory = undefined; mismappedArea = undefined;
  process.env.FROK_COMFYUI_PRIVATE = '1';
  legacy('COMFYUI_URL','http://127.0.0.1:8188');
  for (const [area, dir] of Object.entries(roots)) legacy(`COMFYUI_${area.toUpperCase()}_DIR`, dir);
});
after(async () => { mock.restoreAll(); registry.close(); await fs.rm(root, {recursive: true, force: true}); });

test('adapters reject traversal, unrelated paths, protocols, ambiguous folders, and symlink escapes', async () => {
  const valid = {primaryWeight: 1, secondary: '', secondaryWeight: .7};
  await validateModelAdapters(valid);
  for (const primary of ['mgwr/M87', 'models/mgwr/M87/m87_lora_v1.safetensors', path.join(trustedComfyModels, 'style.safetensors')]) await validateModelAdapters({...valid, primary});
  const outside = path.join(root, 'other-user.safetensors'); await fs.writeFile(outside, 'synthetic private marker');
  await fs.symlink(outside, path.join(models, 'escape.safetensors'));
  await fs.mkdir(path.join(models, 'ambiguous')); for (const name of ['a', 'b']) await fs.writeFile(path.join(models, 'ambiguous', `${name}.safetensors`), 'synthetic');
  for (const primary of ['../other-user.safetensors', 'x/../mgwr/M87', '%2e%2e/other', 'file:///tmp/key', 'https://example.test/style', '\\server\\file', outside, 'escape.safetensors', 'ambiguous']) await assert.rejects(validateModelAdapters({...valid, primary}));
  assert.equal(await resolveModelAdapter('larryvrh/MiniMax-H3-Turbo-Lora-v4-600-ema'), path.join(models, 'larryvrh/MiniMax-H3-Turbo-Lora/minimax_h3_turbo_v4_step600_ema.safetensors'));
  const link = path.join(models, 'krea/Krea-2-Turbo/escaped-weight.safetensors'); await fs.symlink(outside, link);
  await assert.rejects(resolveVpipeModel('krea/Krea-2-Turbo'), /symlink/); await fs.unlink(link);
});

test('Vpipe stub receives a private cwd/config/temp/cache and only model symlinks, with absolute pinned model references', async () => {
  const input = await inputFor(owners[0]); input.source = '';
  input.request.pipeline=factoryPipeline('image');
  (input.request.pipeline.graph.stages as import('../src/lib/vpipe').Stage[]).find(s=>s.type==='krea2-model-config')!.config.lora='mgwr/M87';
  const binary = path.join(root, 'runner-stub.mjs');
  await fs.writeFile(binary, `#!/usr/bin/env node\nimport fs from 'node:fs';\nimport path from 'node:path';\nconst args=process.argv.slice(2);const config=JSON.parse(fs.readFileSync(args[args.indexOf('--config')+1]));const graph=JSON.parse(fs.readFileSync(args[args.indexOf('--launch')+1]));\nfs.writeFileSync(path.join(process.cwd(),'observed.json'),JSON.stringify({cwd:process.cwd(),config,paths:{home:process.env.HOME,cache:process.env.XDG_CACHE_HOME,temp:process.env.TMPDIR,vpipeTemp:process.env.VPIPE_TMPDIR},hasToken:!!process.env.HF_TOKEN,hasPlugins:!!process.env.VPIPE_PLUGINS}));\nfs.writeFileSync(graph.stages.find(s=>s.id==='save-image').config.path,'synthetic output');\n`, {mode: 0o700});
  process.env.VPIPE_BIN = binary; process.env.HF_TOKEN = 'synthetic-token'; process.env.VPIPE_PLUGINS = 'synthetic-unwanted-plugin';
  await runJob(owners[0], () => renderVpipe({...input,source:undefined}), 'worker');
  const dir = (await fs.readdir(input.directory)).find(name => name.startsWith('vpipe-'))!;
  const workspace = path.join(input.directory, dir), observed = JSON.parse(await fs.readFile(path.join(workspace, 'observed.json'), 'utf8'));
  assert.equal(observed.cwd, workspace); assert.equal(observed.config.log.delegate, 'stdout');
  for (const value of [...Object.values(observed.paths), observed.config.db.path]) assert.ok(String(value).startsWith(workspace + path.sep));
  assert.equal(observed.hasToken, false); assert.equal(observed.hasPlugins, false);
  assert.equal(await fs.realpath(path.join(workspace, 'models')), models);
  const graph = JSON.parse(await fs.readFile(path.join(input.directory, 'pipeline.vpipeline'), 'utf8'));
  assert.equal(graph.stages.find((s: {id: string}) => s.id === 'model-select').config.hf_dir, path.join(models, 'krea/Krea-2-Turbo'));
  assert.equal(graph.stages.find((s: {id: string}) => s.id === 'krea2-model-config').config.lora, path.join(models, 'mgwr/M87/m87_lora_v1.safetensors'));
  assert.equal(await fs.readFile(input.output, 'utf8'), 'synthetic output');
});

test('remote ComfyUI still requires a protected backend; no network or receipt is created', async () => {
  const input = await inputFor(owners[0]); delete process.env.FROK_COMFYUI_PRIVATE;
  legacy('COMFYUI_URL','http://remote.example:8188');
  fakeBackend(); assert.match(comfyIsolationIssue()!, /protected backend/);
  await assert.rejects(runJob(owners[0], () => renderComfy(input)), /protected backend/);
  await assert.rejects(runJob(owners[0], () => comfyFetch('/system_stats')), /protected backend/);
  assert.equal(calls.length, 0); assert.deepEqual(await fs.readdir(input.directory), []);
  assert.deepEqual(await runJob(owners[0], () => cleanupComfyJob(input.directory)), {pending: 0});
});

test('missing or invalid cleanup directory mappings disable ComfyUI before network or receipts', async () => {
  fakeBackend();
  for (const area of ['input', 'output'] as const) {
    const key = `COMFYUI_${area.toUpperCase()}_DIR`, input = await inputFor(owners[0]);
    for (const value of ['', 'relative/directory', ' /absolute/path ', path.join(root, 'missing'), input.source]) {
      legacy(key, value);
      assert.match(comfyIsolationIssue()!, new RegExp(area));
      await assert.rejects(runJob(owners[0], () => renderComfy(input)), new RegExp(area));
      await assert.rejects(runJob(owners[0], () => comfyFetch('/system_stats')), new RegExp(area));
      assert.equal(calls.length, 0); assert.deepEqual(await fs.readdir(input.directory), []);
    }
    legacy(key, roots[area]);
  }
});

test('existing but mismapped directories fail the marker preflight before any prompt or asset is sent', async () => {
  fakeBackend();
  for (const area of ['input', 'output'] as const) {
    mismappedArea = area; const input = await inputFor(owners[0]);
    await assert.rejects(runJob(owners[0], () => renderComfy(input)), new RegExp(`does not match the service’s ${area} directory`));
    assert.deepEqual(await fs.readdir(input.directory), []);
  }
  assert.ok(calls.length > 0); assert.ok(calls.every(call => call.mapping));
  for (const area of ['input', 'output'] as const) {
    const entries = await fs.readdir(roots[area], {recursive: true});
    assert.ok(!entries.some(name => /mapping-/.test(name)));
  }
});

test('same-seed jobs get distinct upload/output/client namespaces and cleanup only their runner copies', async () => {
  fakeBackend(); const inputs = await Promise.all(owners.map(inputFor));
  const sentinel = path.join(roots.output, 'frok', 'other-job', 'keep.png'); await fs.mkdir(path.dirname(sentinel), {recursive: true}); await fs.writeFile(sentinel, 'keep');
  await Promise.all(inputs.map((input, i) => runJob(owners[i], () => renderComfy(input), 'worker')));
  assert.equal(new Set(submissions.map(item => item.client_id)).size, 2); assert.equal(new Set(uploadFolders).size, 2);
  for (let i = 0; i < inputs.length; i++) {
    assert.equal(await fs.readFile(inputs[i].output, 'utf8'), 'synthetic output');
    assert.ok(await fs.stat(inputs[i].source));
    assert.ok(!(await fs.readdir(inputs[i].directory)).some(name => name.startsWith('comfy-cleanup-')));
  }
  for (const item of submissions) for (const area of ['input', 'output'] as const) await assert.rejects(fs.stat(path.join(roots[area], item.namespace)), {code: 'ENOENT'});
  assert.equal(await fs.readFile(sentinel, 'utf8'), 'keep');
  for (const call of calls.filter(call => call.route === '/history')) assert.equal(call.body.delete.length, 1);
  assert.ok(!calls.some(call => call.route === '/interrupt' || call.body?.clear));
});

test('foreign source/output paths and foreign Comfy output descriptors are rejected', async () => {
  fakeBackend(); const [a, b] = await Promise.all(owners.map(inputFor));
  const outside=path.join(root,'outside.png');await fs.writeFile(outside,'synthetic outside');
  await assert.rejects(runJob(owners[0], () => renderComfy({...a, source: outside})), /local library/);
  await assert.rejects(runJob(owners[0], () => renderComfy({...a, output: b.output})), /job directory/);
  assert.equal(calls.length, 0);
  forged = true; await assert.rejects(runJob(owners[0], () => renderComfy(a)), /namespace/);
  assert.ok(!calls.some(call => call.route === '/view' && !call.mapping));
});

test('preemption waits for ComfyUI to acknowledge exit before releasing the worker', async () => {
  fakeBackend(); running = true; cancelUnsupported = true;
  const input = await inputFor(owners[0]); abortOnHistory = input.controller;
  let released=false;
  const render=runJob(owners[0], () => renderComfy({...input,waitForStop:()=>true}), 'worker');
  const result=assert.rejects(render.finally(()=>{released=true;}));
  try {
    for(let i=0;i<100&&!calls.some(call=>call.route.endsWith('/cancel'));i++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.ok(calls.some(call=>call.route.endsWith('/cancel')));
    assert.equal(released,false);
    assert.ok(!calls.some(call=>call.route==='/interrupt'));
  } finally { for(const item of submissions)item.running=false; }
  await result;
  assert.equal(released,true);
});

test('unsupported targeted cancellation preserves receipts and files until the job has stopped', async () => {
  fakeBackend(); running = true; cancelUnsupported = true;
  const input = await inputFor(owners[0]); abortOnHistory = input.controller;
  await assert.rejects(runJob(owners[0], () => renderComfy(input), 'worker'));
  assert.ok(calls.some(call => call.route.endsWith('/cancel'))); assert.ok(!calls.some(call => call.route === '/interrupt'));
  assert.equal((await runJob(owners[0], () => cleanupComfyJob(input.directory))).pending, 1);
  assert.ok(await fs.stat(path.join(roots.output, submissions[0].namespace)));
  submissions[0].running = false; abortOnHistory = undefined;
  assert.deepEqual(await runJob(owners[0], () => cleanupComfyJob(input.directory)), {pending: 0});
  await assert.rejects(fs.stat(path.join(roots.output, submissions[0].namespace)), {code: 'ENOENT'});
});

test('lost submission responses remain pending until completion is established by the recorded ID', async () => {
  fakeBackend(); running = true; loseSubmission = true; const input = await inputFor(owners[0]);
  await assert.rejects(runJob(owners[0], () => renderComfy(input)), /lost submission/);
  assert.equal((await runJob(owners[0], () => cleanupComfyJob(input.directory))).pending, 1);
  submissions[0].running = false;
  assert.deepEqual(await runJob(owners[0], () => cleanupComfyJob(input.directory)), {pending: 0});
});

test('losing cleanup mappings preserves pending receipts until the original mappings are restored', async () => {
  fakeBackend(); running = true; cancelUnsupported = true;
  const input = await inputFor(owners[0]); abortOnHistory = input.controller;
  await assert.rejects(runJob(owners[0], () => renderComfy(input)));
  assert.ok(input.lines.some(line => line.includes('cleanup is pending')));
  legacy('COMFYUI_INPUT_DIR', undefined); legacy('COMFYUI_OUTPUT_DIR', undefined);
  submissions[0].running = false; abortOnHistory = undefined;
  const count = calls.length;
  assert.equal((await runJob(owners[0], () => cleanupComfyJob(input.directory))).pending, 1);
  assert.equal(calls.length, count);
  legacy('COMFYUI_INPUT_DIR', roots.input); legacy('COMFYUI_OUTPUT_DIR', roots.output);
  assert.deepEqual(await runJob(owners[0], () => cleanupComfyJob(input.directory)), {pending: 0});
});

test('cleanup rejects outside receipt directories and symlinked runner namespace', async () => {
  fakeBackend(); running = true; cancelUnsupported = true;
  const input = await inputFor(owners[0]); abortOnHistory = input.controller;
  await assert.rejects(runJob(owners[0], () => renderComfy(input)));
  submissions[0].running = false; abortOnHistory = undefined;
  await assert.rejects(cleanupComfyJob(root), /local library/);
  const own = path.join(roots.output, submissions[0].namespace), other = path.join(root, 'untouched-other-job');
  await fs.mkdir(other); await fs.writeFile(path.join(other, 'keep.png'), 'synthetic private output');
  await fs.rm(own, {recursive: true}); await fs.symlink(other, own, 'dir');
  assert.equal((await runJob(owners[0], () => cleanupComfyJob(input.directory))).pending, 1);
  assert.equal(await fs.readFile(path.join(other, 'keep.png'), 'utf8'), 'synthetic private output');
  await fs.unlink(own);
  assert.deepEqual(await runJob(owners[0], () => cleanupComfyJob(input.directory)), {pending: 0});
});

test('cleanup does not send a saved job ID to a replacement service endpoint', async () => {
  fakeBackend(); running = true; cancelUnsupported = true;
  const input = await inputFor(owners[0]); abortOnHistory = input.controller;
  await assert.rejects(runJob(owners[0], () => renderComfy(input)));
  const count = calls.length; legacy('COMFYUI_URL','http://127.0.0.1:9999');
  try {
    assert.equal((await runJob(owners[0], () => cleanupComfyJob(input.directory))).pending, 1);
    assert.equal(calls.length, count);
  } finally { legacy('COMFYUI_URL','http://127.0.0.1:8188'); }
});
