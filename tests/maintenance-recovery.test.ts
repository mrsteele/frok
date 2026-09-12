import test, { after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';

const repo = process.cwd();
const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'frok-maintenance-test-')));
const environment = (directory: string) => ({ ...process.env,
  FROK_DATA_DIR: directory, FROK_ENV_FILE: path.join(root, 'absent.env'), FROK_APP_ROOT: repo,
  FROK_PIPELINE_HOME: root, FROK_DOCUMENTS_DIR: path.join(root, 'documents'),
  FROK_ORIGIN: 'http://127.0.0.1:3000', VPIPE_WORKDIR: path.join(directory, 'vpipe'),
  VPIPE_BIN: path.join(root, 'absent-vpipe'), OLLAMA_BIN: path.join(root, 'absent-ollama'),
  FFMPEG_BIN: path.join(root, 'absent-ffmpeg'), FFPROBE_BIN: path.join(root, 'absent-ffprobe'),
  REALESRGAN_BIN: path.join(root, 'absent-upscaler'), REALESRGAN_MODEL_DIR: path.join(root, 'absent-models'),
  COMFYUI_DIR: path.join(root, 'absent-comfy'), COMFYUI_URL: 'http://127.0.0.1:19982',
  OLLAMA_URL: 'http://127.0.0.1:19981', FROK_MANAGE_OLLAMA: '0',
});
Object.assign(process.env, environment(path.join(root, 'direct')));
const registry = await import('../src/lib/registry');
const library = await import('../src/lib/library');
const store = await import('../src/lib/db');
const { resetLibrary, recoverInterruptedLibraryReset } = await import('../src/lib/library-reset');
const { claimNextJob } = await import('../src/lib/worker-queue');
const api = await import('../src/app/api/[[...segments]]/route');
const guard = path.join(root, 'deny-runners.mjs');
await fs.writeFile(guard, `
import childProcess from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
const deny=()=>{fs.writeFileSync(path.join(process.env.FROK_DATA_DIR,'unexpected-execution'),'blocked');throw Error('No runner or network is allowed in this fixture');};
for(const name of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])childProcess[name]=deny;
globalThis.fetch=deny;syncBuiltinESMExports();
`);
const args = ['--import', 'tsx', '--import', pathToFileURL(guard).href];
function child(directory: string, module?: string) {
  const workerProcess = spawn(process.execPath, [...args, ...(module ? ['--input-type=module', '-e', module] : [path.join(repo, 'src/worker/index.ts')])], {
    cwd: repo, env: environment(directory), stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '', ready = false;
  workerProcess.stdout!.on('data', chunk => {
    output += String(chunk);
    if (!module && !ready && output.includes('Frok generation worker ready')) { ready = true; workerProcess.kill('SIGTERM'); }
  });
  workerProcess.stderr!.on('data', chunk => { output += String(chunk); });
  return new Promise<{ code: number | null; signal: NodeJS.Signals | null; output: string; ready: boolean }>((resolve, reject) => {
    const timer = setTimeout(() => workerProcess.kill('SIGKILL'), 8000);
    workerProcess.on('error', error => { clearTimeout(timer); reject(error); });
    workerProcess.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, output, ready }); });
  });
}
const source = (name: string) => JSON.stringify(pathToFileURL(path.join(repo, 'src/lib', name + '.ts')).href);
async function seedAbandoned(directory: string, kind: 'export' | 'delete') {
  const result = await child(directory, `
    import fs from 'node:fs/promises';import path from 'node:path';
    const r=await import(${source('registry')}),l=await import(${source('library')}),s=await import(${source('db')});
    s.saveMedia({id:'11111111-1111-4111-8111-111111111111',kind:'image',filename:'synthetic.jpg',prompt:'Keep unless reset was confirmed',enhancedPrompt:'',width:1,height:1,seed:1,favorite:false,createdAt:new Date().toISOString(),origin:'upload'});
    await fs.writeFile(path.join(l.libraryMediaDir(),'synthetic.jpg'),'synthetic bytes');
    s.setValue('preserve','synthetic setting');
    await fs.mkdir(path.join(process.env.FROK_DATA_DIR,'vpipe/models'),{recursive:true});
    await fs.writeFile(path.join(process.env.FROK_DATA_DIR,'vpipe/models/keep'),'model fixture');
    r.beginOperation(${JSON.stringify(kind)});
    ${kind === 'delete' ? "r.setServiceValue('maintenance',true);await fs.rm(l.libraryMediaDir(),{recursive:true});" : ''}
    l.closeLibraryDatabase();r.registry.close();
  `);
  assert.equal(result.code, 0, result.output);
}
beforeEach(() => {
  mock.restoreAll();
  registry.registry.exec('DELETE FROM operations; DELETE FROM service');
  store.db.exec('DELETE FROM media; DELETE FROM jobs; DELETE FROM prompt_sections; DELETE FROM settings');
  store.setValue('environmentDefaults', {});
  mock.method(globalThis, 'fetch', async () => { throw Error('No real services in maintenance tests'); });
});
after(async () => { mock.restoreAll(); library.closeLibraryDatabase(); registry.registry.close(); await fs.rm(root, { recursive: true, force: true }); });

for (const kind of ['export', 'delete'] as const) test(`worker startup recovers an abandoned ${kind} before admission`, { timeout: 15000 }, async () => {
  const directory = path.join(root, 'abandoned-' + kind);
  await seedAbandoned(directory, kind);
  const result = await child(directory);
  assert.equal(result.code, 0, result.output); assert.equal(result.signal, null); assert.equal(result.ready, true);
  const database = new DatabaseSync(path.join(directory, 'library/frok.sqlite'), { readOnly: true });
  const services = new DatabaseSync(path.join(directory, 'registry.sqlite'), { readOnly: true });
  try {
    assert.equal(database.prepare('SELECT COUNT(*) AS n FROM media').get()!.n, kind === 'export' ? 1 : 0);
    assert.equal(services.prepare("SELECT value FROM service WHERE key='maintenance'").get()!.value, 'false');
    assert.deepEqual(services.prepare('SELECT * FROM operations').all(), []);
    if (kind === 'export') assert.equal(await fs.readFile(path.join(directory, 'library/media/synthetic.jpg'), 'utf8'), 'synthetic bytes');
    else {
      assert.equal(services.prepare("SELECT value FROM service WHERE key='libraryResetPending'").get()!.value, 'false');
      assert.ok(services.prepare("SELECT value FROM service WHERE key='libraryResetEpoch'").get());
      assert.deepEqual(await fs.readdir(path.join(directory, 'library/media')), []);
      assert.equal(database.prepare("SELECT value FROM settings WHERE key='preserve'").get(), undefined);
    }
  } finally { database.close(); services.close(); }
  assert.equal(await fs.readFile(path.join(directory, 'vpipe/models/keep'), 'utf8'), 'model fixture');
  await assert.rejects(fs.stat(path.join(directory, 'unexpected-execution')), { code: 'ENOENT' });
});

for (const kind of ['export', 'delete'] as const) test(`worker startup still refuses a live ${kind} owner`, { timeout: 15000 }, async () => {
  const operation = registry.beginOperation(kind);
  try {
    const result = await child(process.env.FROK_DATA_DIR!);
    assert.equal(result.code, 1, result.output); assert.equal(result.ready, false);
    assert.match(result.output, /maintenance is in progress/);
    assert.equal(registry.serviceValue('maintenance', false), true);
    assert.equal(registry.activeOperations().some(row => row.id === operation), true);
    assert.equal(registry.serviceValue('workerPid', 0), 0);
  } finally { registry.endOperation(operation); }
});

test('dead-owner sweeping preserves live maintenance and persists interrupted-reset intent across refused requests', () => {
  const active = registry.beginOperation('export');
  registry.registry.prepare('INSERT INTO operations VALUES (?,?,?)').run(randomUUID(), 0, 'export');
  registry.activeOperations();
  assert.equal(registry.serviceValue('maintenance', false), true);
  registry.endOperation(active);
  registry.registry.prepare('INSERT INTO operations VALUES (?,?,?)').run(randomUUID(), 0, 'delete');
  registry.setServiceValue('maintenance', true);
  assert.throws(() => registry.beginOperation('read'), /interrupted library reset/);
  assert.equal(registry.serviceValue('libraryResetPending', false), true);
  assert.equal(registry.serviceValue('maintenance', false), true);
  assert.deepEqual(registry.activeOperations(), []);
  assert.equal(claimNextJob(), undefined);
});

test('an abandoned export can be recovered by API admission without restarting the worker', () => {
  registry.registry.prepare('INSERT INTO operations VALUES (?,?,?)').run(randomUUID(), 0, 'export');
  registry.setServiceValue('maintenance', true);
  const operation = registry.beginOperation('read'); registry.endOperation(operation);
  assert.equal(registry.serviceValue('maintenance', true), false);
  assert.equal(registry.serviceValue('libraryResetPending', false), false);
});

test('partial reset failures block ordinary API and queue work until recovery completes', async () => {
  await fs.writeFile(path.join(library.libraryMediaDir(), 'synthetic.jpg'), 'synthetic bytes');
  store.setValue('preserve', 'synthetic setting');
  const remove = fs.rm;
  const fail = mock.method(fs, 'rm', async (...parameters: Parameters<typeof fs.rm>) => {
    if (String(parameters[0]) === library.libraryJobsDir()) throw Error('Synthetic interrupted deletion');
    return remove(...parameters);
  });
  try { await assert.rejects(resetLibrary(), /Synthetic interrupted deletion/); }
  finally { fail.mock.restore(); }
  assert.equal(registry.serviceValue('maintenance', false), true);
  assert.equal(registry.serviceValue('libraryResetPending', false), true);
  assert.equal(store.getValue('preserve', ''), 'synthetic setting');
  for (const kind of ['read', 'request', 'worker', 'export', 'download', 'cleanup'] as const) assert.throws(() => registry.beginOperation(kind), /interrupted library reset/);
  const response = await api.GET(new Request('http://127.0.0.1:3000/api/media'), { params: Promise.resolve({ segments: ['media'] }) });
  assert.equal(response.status, 409); assert.match((await response.json()).error, /interrupted library reset/);
  assert.equal(claimNextJob(), undefined);
  await recoverInterruptedLibraryReset();
  assert.equal(registry.serviceValue('libraryResetPending', true), false);
  assert.equal(store.getValue('preserve', ''), '');
  assert.deepEqual(await fs.readdir(library.libraryMediaDir()), []);
  const operation = registry.beginOperation('read'); registry.endOperation(operation);
});

test('a fresh reset preflight failure reopens intact data but an interrupted reset never does', async () => {
  const directory = path.join(library.libraryJobsDir(), randomUUID(), '0');
  await fs.mkdir(directory, { recursive: true });
  const receipt = path.join(directory, 'comfy-cleanup-' + randomUUID() + '.json');
  await fs.writeFile(receipt, '{}');
  await assert.rejects(resetLibrary(), /cleanup/);
  assert.equal(registry.serviceValue('libraryResetPending', true), false);
  const read = registry.beginOperation('read'); registry.endOperation(read);
  registry.setServiceValue('libraryResetPending', true);
  await assert.rejects(recoverInterruptedLibraryReset(), /Could not finish the interrupted library reset/);
  assert.throws(() => registry.beginOperation('read'), /interrupted library reset/);
  await fs.unlink(receipt);
  await recoverInterruptedLibraryReset();
  assert.equal(registry.serviceValue('libraryResetPending', true), false);
});
