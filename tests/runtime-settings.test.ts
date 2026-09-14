import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const directory = fs.mkdtempSync(path.resolve('.data/runtime-settings-test-'));
Object.assign(process.env, { FROK_DATA_DIR: directory, FROK_ENV_FILE: path.join(directory, 'absent.env'), FROK_ORIGIN: 'http://localhost:3000' });
const store = await import('../src/lib/db'), library = await import('../src/lib/library'), registry = await import('../src/lib/registry');
const { runtimeOptions } = await import('../src/lib/preferences');
const { jobTimeoutMs } = await import('../src/lib/config');
const { liveImagePreviewsEnabled } = await import('../src/lib/image-preview');
const routes = await import('../src/app/api/[[...segments]]/route');
const call = (method: 'GET' | 'PATCH', input?: unknown) => routes[method](new Request('http://localhost:3000/api/settings/runtime', { method, headers: { Origin: 'http://localhost:3000', 'X-Frok-Request': '1' }, body: input === undefined ? undefined : JSON.stringify(input) }), { params: Promise.resolve({ segments: ['settings', 'runtime'] }) });
beforeEach(() => { store.db.exec('DELETE FROM settings; DELETE FROM jobs'); store.setValue('environmentDefaults', {}); });
after(() => { library.closeLibraryDatabase(); registry.registry.close(); fs.rmSync(directory, { recursive: true, force: true }); });

test('runtime settings save and render consumers see changes from another process connection', async () => {
  assert.equal((await call('PATCH', { liveImagePreviews: false, jobTimeoutMinutes: 12 })).status, 200);
  assert.equal(jobTimeoutMs(), 12 * 60_000); assert.equal(liveImagePreviewsEnabled(), false);
  const other = new DatabaseSync(path.join(directory, 'library/frok.sqlite'));
  other.prepare("UPDATE settings SET value=? WHERE key='runtimeOptions'").run(JSON.stringify({ ...runtimeOptions(), jobTimeoutMinutes: 25, liveImagePreviews: true })); other.close();
  assert.equal(jobTimeoutMs(), 25 * 60_000); assert.equal(liveImagePreviewsEnabled(), true);
  const response = await (await call('GET')).json(); assert.equal(response.options.jobTimeoutMinutes, 25); assert.equal('restartRequired' in response, false);
});
test('invalid runtime updates do not partially save preferences', async () => {
  const initial = runtimeOptions();
  for (const input of [{ jobTimeoutMinutes: 0 }, { jobTimeoutMinutes: 10081 }, { jobTimeoutMinutes: 1.5 }, { jobTimeoutMinutes: '10' }, { liveImagePreviews: false, manageOllama: 'yes' }, { HF_TOKEN: 'synthetic-secret' }, { jobRetentionHours: 0 }, { jobRetentionHours: -1 }, { jobRetentionHours: 8761 }, { jobRetentionHours: 1.5 }, { jobRetentionHours: '3' }]) {
    assert.equal((await call('PATCH', input)).status, 400); assert.deepEqual(runtimeOptions(), initial);
  }
});
test('retired managed-runtime options are rejected and ignored in old settings', async () => {
  assert.equal((await call('PATCH', { manageOllama: true })).status, 400);
  store.setValue('runtimeOptions', { manageOllama: true });
  assert.equal('manageOllama' in runtimeOptions(), false);
  assert.equal(store.settings().ollamaUrl, 'http://127.0.0.1:11434');
});

test('job retention defaults to three hours and persists custom or disabled cleanup', async () => {
  assert.equal((await (await call('GET')).json()).options.jobRetentionHours, 3);
  for (const value of [12, null, 1, 8760]) {
    assert.equal((await call('PATCH', { jobRetentionHours: value })).status, 200);
    assert.equal(runtimeOptions().jobRetentionHours, value);
    assert.equal((await (await call('GET')).json()).options.jobRetentionHours, value);
  }
});

test('video tool folder changes refresh resolution and require an idle queue', async () => {
  const { ffmpeg } = await import('../src/lib/config');
  const folder = path.join(directory, 'external-tools');
  assert.equal((await call('PATCH', {mediaToolsDirectory: folder})).status, 200);
  assert.equal(ffmpeg(), path.join(folder, process.platform==='win32'?'ffmpeg.exe':'ffmpeg'));
  assert.equal((await call('PATCH', {mediaToolsDirectory:'relative/tools'})).status, 400);
  assert.equal((await call('PATCH', {mediaToolsDirectory:'/bad\u0000path'})).status, 400);
  store.createJob({kind:'setup',request:{task:'runtime'},runner:'vpipe',total:1});
  assert.equal((await call('PATCH', {mediaToolsDirectory:''})).status, 409);
  assert.equal(runtimeOptions().mediaToolsDirectory, folder);
  store.db.exec('DELETE FROM jobs');
  assert.equal((await call('PATCH', {mediaToolsDirectory:''})).status, 200);
  assert.equal(runtimeOptions().mediaToolsDirectory, '');
});
