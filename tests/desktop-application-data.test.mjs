import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { migrateApplicationData } from '../desktop/application-data.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frok-machine-data-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'workspace'), state = path.join(root, 'application-data'), logs = path.join(state, 'logs');
  fs.mkdirSync(path.join(home, 'logs'), { recursive: true });
  return { home, state, logs };
}

test('machine state moves intact while user data and job logs stay in the workspace', t => {
  const options = fixture(t), { home, state, logs } = options;
  fs.writeFileSync(path.join(home, 'credentials.json'), '{"version":1,"tokens":{"HF_TOKEN":"synthetic-ciphertext"}}');
  fs.writeFileSync(path.join(home, 'window.json'), '{"width":1200,"height":900}');
  fs.writeFileSync(path.join(home, 'logs/backend.log'), 'startup diagnostics');
  fs.writeFileSync(path.join(home, 'logs/updates.log.previous'), 'older update diagnostics');
  fs.mkdirSync(path.join(home, 'data/library/jobs'), { recursive: true });
  fs.writeFileSync(path.join(home, 'data/library/jobs/job.log'), 'render details');
  migrateApplicationData(options);
  assert.equal(fs.readFileSync(path.join(state, 'credentials.json'), 'utf8'), '{"version":1,"tokens":{"HF_TOKEN":"synthetic-ciphertext"}}');
  assert.equal(fs.statSync(path.join(state, 'credentials.json')).mode & 0o777, 0o600);
  assert.equal(fs.readFileSync(path.join(state, 'window.json'), 'utf8'), '{"width":1200,"height":900}');
  assert.equal(fs.readFileSync(path.join(logs, 'backend.log'), 'utf8'), 'startup diagnostics');
  assert.equal(fs.readFileSync(path.join(logs, 'updates.log.previous'), 'utf8'), 'older update diagnostics');
  assert.equal(fs.readFileSync(path.join(home, 'data/library/jobs/job.log'), 'utf8'), 'render details');
  for (const name of ['credentials.json', 'window.json', 'logs']) assert.equal(fs.existsSync(path.join(home, name)), false);
  assert.doesNotThrow(() => migrateApplicationData(options));
});

test('conflicting saved credentials are preserved before any migration starts', t => {
  const options = fixture(t), { home, state } = options;
  fs.mkdirSync(state);
  fs.writeFileSync(path.join(home, 'credentials.json'), 'old ciphertext');
  fs.writeFileSync(path.join(state, 'credentials.json'), 'different ciphertext');
  fs.writeFileSync(path.join(home, 'window.json'), 'old window');
  assert.throws(() => migrateApplicationData(options), /Both copies were preserved/);
  assert.equal(fs.readFileSync(path.join(home, 'credentials.json'), 'utf8'), 'old ciphertext');
  assert.equal(fs.readFileSync(path.join(state, 'credentials.json'), 'utf8'), 'different ciphertext');
  assert.equal(fs.existsSync(path.join(home, 'window.json')), true);
});

test('an interrupted copy resumes safely and keeps both diagnostic histories', t => {
  const options = fixture(t), { home, state, logs } = options;
  fs.mkdirSync(logs, { recursive: true });
  for (const directory of [home, state]) fs.writeFileSync(path.join(directory, 'credentials.json'), 'same ciphertext');
  fs.writeFileSync(path.join(home, 'logs/backend.log'), 'old diagnostics');
  fs.writeFileSync(path.join(logs, 'backend.log'), 'current diagnostics');
  fs.writeFileSync(path.join(home, 'logs/user-notes.txt'), 'keep my file');
  migrateApplicationData(options);
  assert.equal(fs.existsSync(path.join(home, 'credentials.json')), false);
  assert.equal(fs.readFileSync(path.join(logs, 'backend.log'), 'utf8'), 'current diagnostics');
  const archived = fs.readdirSync(logs).find(name => name.startsWith('backend.log.migrated-'));
  assert.ok(archived); assert.equal(fs.readFileSync(path.join(logs, archived), 'utf8'), 'old diagnostics');
  assert.equal(fs.readFileSync(path.join(home, 'logs/user-notes.txt'), 'utf8'), 'keep my file');
});

test('migration does not follow a credential symlink', t => {
  const options = fixture(t), target = path.join(options.home, 'user-file');
  fs.writeFileSync(target, 'preserve');
  fs.symlinkSync(target, path.join(options.home, 'credentials.json'));
  assert.throws(() => migrateApplicationData(options), /regular saved file/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'preserve');
  assert.equal(fs.existsSync(options.state), false);
});
