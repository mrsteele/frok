import { createLibraryFixture } from './fixtures/library';
import { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const testDir = path.join(process.cwd(), '.data', `settings-test-${process.pid}`);
process.env.FROK_DATA_DIR = testDir;
const machine = {
  VPIPE_WORKDIR: path.join(testDir, 'machine-models'),
  COMFYUI_URL: 'http://127.0.0.1:8188',
  COMFYUI_DIR: path.join(testDir, 'machine-comfy'),
  FROK_COMFYUI_PRIVATE: '1',
  COMFYUI_INPUT_DIR: path.join(testDir, 'comfy-input'),
  COMFYUI_OUTPUT_DIR: path.join(testDir, 'comfy-output'),
  COMFYUI_TEMP_DIR: path.join(testDir, 'comfy-temp'),
};
Object.assign(process.env, machine);
const fixture = await createLibraryFixture();
const { test, beforeEach, after } = fixture;
const store = await import('../src/lib/db');
const routes = await import('../src/app/api/[[...segments]]/route');
const { comfyFetch } = await import('../src/lib/comfyui');
async function patch(body: unknown) {
  return routes.PATCH(fixture.request('http://localhost:3000/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), { params: Promise.resolve({ segments: ['settings'] }) });
}
beforeEach(() => {
  Object.assign(process.env, machine);
  for (const directory of [machine.COMFYUI_INPUT_DIR, machine.COMFYUI_OUTPUT_DIR, machine.COMFYUI_TEMP_DIR]) fs.mkdirSync(directory, { recursive: true });
  store.db.exec('DELETE FROM jobs; DELETE FROM settings;');
  mock.restoreAll();
});
after(() => { mock.restoreAll(); fixture.close(); fs.rmSync(testDir, { recursive: true, force: true }); });

test('first-run dismissal persists as a studio preference while jobs are queued', async () => {
  assert.equal(store.settings().setupDismissed, false);
  assert.equal((await patch({ pipelineSelections: {upscale:'local:seedvr2'} })).status, 200);
  assert.equal(store.settings().setupDismissed, false);
  store.createJob({ kind: 'setup', request: { task: 'image' }, runner: 'vpipe', total: 1 });
  assert.equal((await patch({ setupDismissed: true })).status, 200);
  assert.equal(store.settings().setupDismissed, true);
});

test('environment defaults ignore retired top-level connection fields', () => {
  for (const [key, value] of Object.entries({ vpipeWorkdir: path.join(testDir, 'untrusted-models'), comfyDir: path.join(testDir, 'untrusted-comfy'), comfyUrl: 'http://localhost:9999' })) store.setValue(key, value);
  const settings = store.settings();
  assert.equal(settings.vpipeWorkdir, machine.VPIPE_WORKDIR);
  assert.equal(settings.comfyDir, machine.COMFYUI_DIR);
  assert.equal(settings.comfyUrl, machine.COMFYUI_URL);
});

test('saved connection changes update preparation scope; later environment edits are ignored', async () => {
  const oldFolder = store.settings().comfyDir;
  process.env.COMFYUI_DIR = path.join(testDir, 'new-machine-comfy');
  process.env.COMFYUI_URL = 'http://127.0.0.1:18999';
  const requested: string[] = [];
  mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    requested.push(String(input));
    return Response.json({ synthetic: true });
  });
  assert.equal(store.settings().comfyDir, machine.COMFYUI_DIR);
  assert.equal(store.settings().comfyDir, oldFolder);
  for(const area of ['input','output'])fs.mkdirSync(path.join(process.env.COMFYUI_DIR!,area),{recursive:true});
  store.setValue('runnerLocations', {comfyDir:process.env.COMFYUI_DIR, comfyUrl:process.env.COMFYUI_URL});
  assert.notEqual(store.settings().comfyDir, oldFolder);
  assert.deepEqual(await (await comfyFetch('/system_stats')).json(), { synthetic: true });
  assert.deepEqual(requested, ['http://127.0.0.1:18999/system_stats']);
});

test('queued work prevents changing runner locations without partially saving preferences', async () => {
  store.createJob({kind:'setup',request:{task:'runtime'},runner:'vpipe',total:1});
  const initial=store.settings();
  for(const change of [{vpipeWorkdir:path.join(testDir,'other-folder')},{comfyUrl:'http://localhost:9999'},{comfyDir:path.join(testDir,'other')}]) {
    assert.equal((await patch({...change,setupDismissed:true})).status,409);
    assert.deepEqual(store.settings(),initial);
  }
});

test('invalid connection URLs and unsupported storage edits cannot partially save settings', async () => {
  const initial=store.settings();
  for(const comfyUrl of ['https://example.com','file:///tmp/comfy','javascript:alert(1)','http://user:secret@localhost:8188','http://localhost:8188/path','http://localhost:8188/?token=secret']) {
    assert.equal((await patch({comfyUrl,setupDismissed:true})).status,400);
    assert.deepEqual(store.settings(),initial);
  }
  assert.equal((await patch({dataDir:testDir})).status,400);
});

test('migration skips unsafe environment URLs without storing or exposing embedded secrets', async () => {
  const secret = 'synthetic-comfy-url-secret';
  const username = 'synthetic-comfy-admin';
  let fetches = 0;
  mock.method(globalThis, 'fetch', async () => { fetches++; throw new Error('Unexpected network access in settings test'); });
  const get = () => routes.GET(fixture.request('http://localhost:3000/api/settings'), { params: Promise.resolve({ segments: ['settings'] }) });
  try {
    for (const url of [
      `http://${username}:${secret}@127.0.0.1:8188`,
      `http://127.0.0.1:8188/?token=${secret}`,
      `http://127.0.0.1:8188/#${secret}`,
      `file:///${secret}`,
    ]) {
      process.env.COMFYUI_URL = url;
      store.db.prepare("DELETE FROM settings WHERE key='environmentDefaults'").run();
      const response = await get();
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.equal(JSON.parse(body).settings.comfyUrl, 'http://127.0.0.1:8000');
      assert.ok(!JSON.stringify(store.getValue('environmentDefaults', {})).includes(secret));
      for (const exposed of [body, JSON.stringify([...response.headers])]) {
        assert.ok(!exposed.includes(secret));
        assert.ok(!exposed.includes(username));
      }
    }
  } finally { process.env.COMFYUI_URL = machine.COMFYUI_URL; store.db.prepare("DELETE FROM settings WHERE key='environmentDefaults'").run(); }
  const restored = await get();
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).settings.comfyUrl, machine.COMFYUI_URL);
  assert.equal(fetches, 0);
});

test('settings never exposes service API keys, and remote addresses cannot be set through the UI', async () => {
  process.env.COMFYUI_URL='https://protected-comfy.example:8443';
  const previousKey=process.env.COMFYUI_API_KEY;
  process.env.COMFYUI_API_KEY='synthetic-service-secret';
  try {
    const initial=store.settings();
    const response=await routes.GET(fixture.request('http://localhost:3000/api/settings'),{params:Promise.resolve({segments:['settings']})});
    assert.equal(response.status,200);
    const body=await response.text();
    assert.equal(JSON.parse(body).settings.comfyUrl,process.env.COMFYUI_URL);
    assert.ok(!body.includes('synthetic-service-secret'));
    assert.equal((await patch({comfyUrl:'https://other-comfy.example:8443'})).status,400);
    assert.deepEqual(store.settings(),initial);
  } finally {
    if(previousKey===undefined)delete process.env.COMFYUI_API_KEY;
    else process.env.COMFYUI_API_KEY=previousKey;
  }
});

test('removed attention settings cannot be edited or reactivate an old preference',async()=>{
  store.setValue('videoAcceleration','dense');
  assert.equal('videoAcceleration' in store.settings(),false);
  assert.equal((await patch({videoAcceleration:'dense'})).status,400);
});
