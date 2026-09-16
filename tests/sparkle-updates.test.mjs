import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSparkleUpdater } from '../desktop/sparkle-updater.mjs';
import { createUpdates } from '../desktop/updates.mjs';
import { generateUpdateKey, publicUpdateKey } from '../scripts/update-key.mjs';

function bridgeFixture() {
  let handler, checks = 0, installs = 0;
  const bridge = { setEventHandler: fn => { handler = fn; }, init: () => true, setAutomaticChecks: value => assert.equal(value, false),
    checkForUpdates: () => { checks++; handler({ type: 'checking' }); }, installUpdateNow: () => { installs++; },
    installUpdateOnQuit: () => assert.fail('Sparkle must never bypass queue coordination') };
  const updater = createSparkleUpdater(bridge, {});
  return { bridge, updater, emit: event => handler(event), get checks() { return checks; }, get installs() { return installs; } };
}
test('Sparkle waits through download and queue drain before invoking its native installer', async () => {
  const fixture = bridgeFixture(); let drained;
  const updates = createUpdates({ updater: fixture.updater, beforeInstall: () => new Promise(resolve => { drained = resolve; }) });
  const pending = updates.check(); assert.equal(updates.check(), pending); assert.equal(fixture.checks, 1);
  fixture.emit({ type: 'update-available', version: '1.2.3' }); fixture.emit({ type: 'download-progress', percent: 50 });
  assert.equal(updates.state.percent, 50); await updates.install(); assert.equal(fixture.installs, 0);
  fixture.emit({ type: 'update-downloaded', version: '1.2.3' }); await pending;
  updates.defer(); const install = updates.install(); assert.equal(fixture.installs, 0);
  drained(); await install; assert.equal(fixture.installs, 1); updates.dispose();
});
test('Sparkle download errors release pending checks and permit retry without installation', async () => {
  const fixture = bridgeFixture(), errors = [];
  const updates = createUpdates({ updater: fixture.updater, beforeInstall: async () => {}, log: { error: value => errors.push(value) } });
  const first = updates.check(); fixture.emit({ type: 'error', message: 'Invalid Ed25519 signature' }); await first;
  assert.equal(errors.length, 1); assert.equal(updates.state.status, 'error'); assert.equal(fixture.installs, 0);
  assert.throws(() => fixture.updater.quitAndInstall(), /not finished/);
  const second = updates.check(); fixture.emit({ type: 'update-not-available' }); await second;
  assert.equal(fixture.checks, 2); assert.equal(updates.state.status, 'idle'); updates.dispose();
});
test('key generation preserves existing trust and keeps the private seed out of public configuration', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'frok-update-key-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true })); await fs.mkdir(path.join(directory, 'desktop'));
  const privateFile = await generateUpdateKey(directory), seed = (await fs.readFile(privateFile, 'utf8')).trim();
  const publicFile = await fs.readFile(path.join(directory, 'desktop/sparkle-key.json'), 'utf8');
  assert.equal(JSON.parse(publicFile).publicEdKey, publicUpdateKey(seed)); assert.ok(!publicFile.includes(seed));
  if(process.platform!=='win32')assert.equal((await fs.stat(privateFile)).mode & 0o777, 0o600);
  await assert.rejects(generateUpdateKey(directory), /already exists/);
  assert.throws(() => publicUpdateKey('invalid'), /32-byte/);
});
