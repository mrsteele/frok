import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { importEnvironment, readRuntimeOptions, readOllamaAddress, runtimeDefaults } from '../desktop/preferences.mjs';

function database(t) {
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
  t.after(() => db.close()); return db;
}
const set = (db, key, value) => db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run(key, JSON.stringify(value));

test('legacy preferences migrate once without importing secrets or enabling connections', t => {
  const db = database(t);
  const env = { HF_TOKEN: 'synthetic-private-token', COMFYUI_API_KEY: 'synthetic-key', AI_RUNNER: 'comfyui', VPIPE_WORKDIR: '/legacy/models', OLLAMA_MODEL: 'old:model', VPIPE_LIVE_PREVIEWS: '0', JOB_TIMEOUT_MINUTES: '35', FROK_MANAGE_OLLAMA: '1', UNRELATED_VALUE: 'ignore' };
  const first = importEnvironment(db, env);
  assert.equal(first.legacy.VPIPE_WORKDIR, '/legacy/models');
  assert.equal(first.legacy.OLLAMA_MODEL, 'old:model');
  assert.deepEqual(readRuntimeOptions(db), { liveImagePreviews: false, jobTimeoutMinutes: 35, jobRetentionHours: 3, mediaToolsDirectory: '' });
  assert.deepEqual(importEnvironment(db, { OLLAMA_MODEL: 'later:model', VPIPE_LIVE_PREVIEWS: '1' }), first);
  const rows = db.prepare('SELECT * FROM settings').all();
  assert.equal(rows.length, 1); assert.equal(rows[0].key, 'environmentDefaults');
  assert.doesNotMatch(JSON.stringify(rows), /synthetic-private-token|synthetic-key|UNRELATED_VALUE/);
});

test('unsafe legacy addresses are discarded before they can enter library exports', t => {
  const db = database(t);
  for (const url of ['https://user:synthetic-secret@localhost', 'http://localhost?token=synthetic-secret', 'http://localhost/#synthetic-secret', 'file:///synthetic-secret', 'bad address']) {
    db.exec('DELETE FROM settings');
    const saved = importEnvironment(db, { OLLAMA_URL: url, COMFYUI_URL: url });
    assert.deepEqual(saved.legacy, {});
    assert.doesNotMatch(JSON.stringify(db.prepare('SELECT * FROM settings').all()), /synthetic-secret/);
    assert.equal(readOllamaAddress(db), 'http://127.0.0.1:11434');
  }
});

test('explicit settings and blanks override migration; reset does not reimport old defaults', t => {
  const db = database(t);
  const env = { FROK_MANAGE_OLLAMA: '1', JOB_TIMEOUT_MINUTES: '900', OLLAMA_URL: 'http://localhost:19999' };
  importEnvironment(db, env);
  set(db, 'runtimeOptions', { manageOllama: false, jobTimeoutMinutes: 10 });
  assert.equal(readRuntimeOptions(db, env).jobTimeoutMinutes, 10);
  assert.equal(readOllamaAddress(db, env), 'http://localhost:19999');
  set(db, 'ollamaUrl', ''); assert.equal(readOllamaAddress(db, env), 'http://127.0.0.1:11434');
  set(db, 'runtimeOptions', { manageOllama: true }); assert.equal(readOllamaAddress(db, env), 'http://127.0.0.1:11434'); assert.equal('manageOllama' in readRuntimeOptions(db, env), false);
  db.exec('DELETE FROM settings'); set(db, 'environmentDefaults', {});
  assert.deepEqual(readRuntimeOptions(db, env), runtimeDefaults);
  assert.equal(readOllamaAddress(db, env), 'http://127.0.0.1:11434');
});
