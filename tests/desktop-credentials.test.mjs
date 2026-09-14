import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { createCredentialStore } from '../desktop/credentials.mjs';
import { migrateApplicationData } from '../desktop/application-data.mjs';

// Exercise persistence with actual ciphertext, without touching the user's keychain.
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'frok-credentials-')), key = randomBytes(32);
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const safeStorage = {
    isEncryptionAvailable: () => true, getSelectedStorageBackend: () => 'gnome_libsecret',
    encryptString(value) { const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv); const data = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]); },
    decryptString(value) { const cipher = createDecipheriv('aes-256-gcm', key, value.subarray(0, 12)); cipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString('utf8'); },
  };
  return { directory, safeStorage, platform: 'linux', environment: {} };
}
test('imports legacy credentials encrypted, never returns tokens in status, and keeps saved values authoritative', t => {
  const options = fixture(t); options.environment = { HF_TOKEN: 'synthetic-hugging-face-token', COMFYUI_API_KEY: 'synthetic-comfy-token' };
  const store = createCredentialStore(options), file = path.join(options.directory, 'credentials.json');
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /synthetic|hugging-face|comfy-token/);
  assert.doesNotMatch(JSON.stringify(store.status()), /synthetic/);
  assert.deepEqual(store.status(), { available: true, configured: { HF_TOKEN: true, COMFYUI_API_KEY: true }, restartRequired: false });
  assert.equal(store.environment().HF_TOKEN, options.environment.HF_TOKEN);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const restarted = createCredentialStore({ ...options, environment: { HF_TOKEN: 'different-environment-token' } });
  assert.equal(restarted.environment().HF_TOKEN, options.environment.HF_TOKEN);
});
test('save and removal apply on restart; cleared tokens cannot reappear from an old environment file', t => {
  const options = fixture(t); options.environment = { HUGGING_FACE_HUB_TOKEN: 'synthetic-original-token' };
  const store = createCredentialStore(options);
  assert.equal(store.save('HF_TOKEN', 'synthetic-replacement-token').restartRequired, true);
  assert.equal(store.environment().HF_TOKEN, 'synthetic-original-token');
  assert.equal(store.environment().HUGGING_FACE_HUB_TOKEN, '');
  const restarted = createCredentialStore(options); assert.equal(restarted.environment().HF_TOKEN, 'synthetic-replacement-token');
  assert.equal(restarted.save('HF_TOKEN', '').configured.HF_TOKEN, false);
  assert.equal(createCredentialStore(options).environment().HF_TOKEN, '');
});

test('encrypted workspace tokens still unlock after moving into application data', t => {
  const options = fixture(t), home = path.join(options.directory, 'workspace'), state = path.join(options.directory, 'machine');
  fs.mkdirSync(home);
  const previous = createCredentialStore({ ...options, directory: home });
  previous.save('HF_TOKEN', 'synthetic-preserved-token');
  const ciphertext = fs.readFileSync(path.join(home, 'credentials.json'));
  migrateApplicationData({ home, state, logs: path.join(state, 'logs') });
  const migrated = createCredentialStore({ ...options, directory: state });
  assert.equal(migrated.environment().HF_TOKEN, 'synthetic-preserved-token');
  assert.equal(migrated.status().configured.HF_TOKEN, true);
  assert.deepEqual(fs.readFileSync(path.join(state, 'credentials.json')), ciphertext);
  assert.equal(fs.existsSync(path.join(home, 'credentials.json')), false);
});
test('unavailable and insecure storage never writes a plaintext fallback; invalid input cannot change storage', t => {
  const options = fixture(t);
  for (const unavailable of [false, true]) {
    const safeStorage = { ...options.safeStorage, isEncryptionAvailable: () => unavailable, getSelectedStorageBackend: () => 'basic_text' };
    const store = createCredentialStore({ ...options, safeStorage, environment: { HF_TOKEN: 'synthetic-legacy-token' } });
    assert.equal(store.status().available, false);
    assert.throws(() => store.save('HF_TOKEN', 'synthetic-new-token'), /Secure storage/);
    assert.equal(fs.existsSync(path.join(options.directory, 'credentials.json')), false);
  }
  const store = createCredentialStore(options);
  for (const [key, value] of [['OTHER_SECRET', 'secret'], ['HF_TOKEN', 'line\nbreak'], ['HF_TOKEN', 'x'.repeat(4097)], ['HF_TOKEN', null]]) assert.throws(() => store.save(key, value), /supported API token/);
  assert.deepEqual(store.status().configured, { HF_TOKEN: false, COMFYUI_API_KEY: false });
});
