import test, { after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frok-interface-test-'));
Object.assign(process.env, { FROK_DATA_DIR: root, FROK_ENV_FILE: path.join(root, 'absent.env'), FROK_ORIGIN: 'http://localhost:3000' });
const store = await import('../src/lib/db'), library = await import('../src/lib/library'), registry = await import('../src/lib/registry');
const routes = await import('../src/app/api/[[...segments]]/route');
const call = (method: 'GET' | 'POST' | 'PATCH', input?: unknown, origin = 'http://localhost:3000') => routes[method](new Request('http://localhost:3000/api/settings/interface', { method, headers: { Origin: origin, 'X-Frok-Request': '1' }, body: input === undefined ? undefined : JSON.stringify(input) }), { params: Promise.resolve({ segments: ['settings', 'interface'] }) });
beforeEach(() => { store.db.exec('DELETE FROM settings'); store.setValue('environmentDefaults', {}); });
after(() => { library.closeLibraryDatabase(); registry.registry.close(); fs.rmSync(root, { recursive: true, force: true }); });

test('recipes and reusable controls persist with the library without a browser profile', async () => {
  const recipes = JSON.stringify([{ id: 'orbit', name: 'Orbit', prompt: 'Slow camera orbit.', isDefault: true }]);
  assert.equal((await call('PATCH', { userPrompts: recipes, 'frok-composer': JSON.stringify({ mode: 'video', seed: 123, prompt: 'discard this draft', referenceIds: ['discard'] }) })).status, 200);
  const other = new DatabaseSync(path.join(root, 'library/frok.sqlite'), { readOnly: true });
  const value = JSON.parse(String(other.prepare("SELECT value FROM settings WHERE key='interfacePreferences'").get()!.value));
  other.close();
  assert.equal(value.userPrompts, recipes);
  assert.equal(JSON.parse(value['frok-composer']).seed, 123);
  assert.doesNotMatch(value['frok-composer'], /discard|referenceIds|prompt/);
  assert.deepEqual(await (await call('GET')).json(), value);
});

test('old windows fill missing preferences once and cannot overwrite current settings', async () => {
  const current = JSON.stringify({ muted: false, volume: 0.4 });
  await call('PATCH', { 'frok-video-audio': current });
  const migrated = await (await call('POST', { 'frok-video-audio': JSON.stringify({ muted: true, volume: 1 }), userPrompts: '[]' })).json();
  assert.equal(migrated['frok-video-audio'], current);
  assert.equal(migrated.userPrompts, '[]');
  // Existing corrupt recipes stay recoverable from Settings, rather than blocking startup.
  store.db.exec('DELETE FROM settings');
  assert.equal((await call('POST', { userPrompts: 'old damaged JSON' })).status, 200);
  assert.equal((await (await call('GET')).json()).userPrompts, 'old damaged JSON');
  assert.equal((await call('PATCH', { userPrompts: '[]' })).status, 200);
});

test('preference writes reject secrets, browser internals, invalid recipes and cross-site callers', async () => {
  for (const input of [{ HF_TOKEN: 'private' }, { Preferences: '{}' }, { userPrompts: '[{"id":"invalid"}]' }, { 'frok-video-audio': '{"muted":false,"volume":2}' }]) assert.equal((await call('PATCH', input)).status, 400);
  assert.equal((await call('PATCH', { userPrompts: '[]' }, 'https://unrelated.example')).status, 403);
  assert.deepEqual(await (await call('GET')).json(), {});
});
