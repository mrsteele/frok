import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createUpdates, updateAvailability } from '../desktop/updates.mjs';
import { prepareUpdateRestart } from '../desktop/update-restart.mjs';
import { createTrayAnimator, trayVariants } from '../desktop/tray-status.mjs';

function fixture(options = {}) {
  const updater = new EventEmitter(), states = [], errors = [], ticks = new Set();
  updater.checkForUpdates = async () => { updater.emit('checking-for-update'); updater.emit('update-not-available'); };
  let installs = 0;
  updater.quitAndInstall = () => { installs++; };
  const updates = createUpdates({ updater, changed: state => states.push(state), log: { error: error => errors.push(error) }, beforeInstall: async () => {}, every: fn => { ticks.add(fn); return fn; }, cancel: fn => ticks.delete(fn), ...options });
  return { updater, updates, states, errors, ticks, get installs() { return installs; } };
}
test('development and unsupported local builds never start update requests', async () => {
  assert.match(updateAvailability({ packaged: false }), /Development/);
  assert.match(updateAvailability({ packaged: true, releaseEnabled: false, platform: 'darwin' }), /does not receive automatic updates/);
  assert.match(updateAvailability({ packaged: true, releaseEnabled: false, platform: 'win32' }), /does not receive automatic updates/);
  assert.match(updateAvailability({ packaged: true, releaseEnabled: true, platform: 'linux', appImage: '' }), /AppImage/);
  assert.equal(updateAvailability({ packaged: true, releaseEnabled: true, platform: 'darwin' }), '');
  const f = fixture({ unavailable: 'Development' });
  f.updater.checkForUpdates = () => assert.fail('must not contact an update server');
  f.updates.start(); await f.updates.check(); await f.updates.install();
  assert.equal(f.ticks.size, 0); assert.equal(f.installs, 0); assert.equal(f.updates.state.status, 'disabled');
});
test('checks automatically, downloads with progress, and leaves restart to the user', async () => {
  const f = fixture();
  assert.equal(f.updater.autoDownload, true); assert.equal(f.updater.autoInstallOnAppQuit, false);
  assert.equal(f.updater.allowPrerelease, false); assert.equal(f.updater.allowDowngrade, false);
  f.updater.checkForUpdates = async () => {
    f.updater.emit('checking-for-update');
    f.updater.emit('update-available', { version: '1.2.3' });
    return { downloadPromise: Promise.resolve().then(() => { f.updater.emit('download-progress', { percent: 42.7 }); f.updater.emit('update-downloaded', { version: '1.2.3' }); }) };
  };
  f.updates.start(); f.updates.start();
  await f.updates.check();
  assert.equal(f.ticks.size, 1); assert.equal(f.updates.state.status, 'ready'); assert.equal(f.installs, 0);
  assert.ok(f.states.some(state => state.percent === 42));
  f.updater.checkForUpdates = () => assert.fail('must retain the downloaded update');
  await f.updates.check();
  f.updates.dispose(); assert.equal(f.ticks.size, 0); assert.equal(f.updater.listenerCount('error'), 0);
});
test('download failure is caught, preserves the update badge, and can retry', async () => {
  const f = fixture();
  f.updater.checkForUpdates = async () => {
    f.updater.emit('update-available', { version: '1.2.3' });
    return { downloadPromise: Promise.reject(Error('network disconnected')) };
  };
  await f.updates.check(); assert.equal(f.updates.state.status, 'error'); assert.equal(f.updates.state.version, '1.2.3');
  f.updater.checkForUpdates = async () => { f.updater.emit('update-downloaded', { version: '1.2.3' }); };
  await f.updates.check(); assert.equal(f.updates.state.status, 'ready'); assert.equal(f.installs, 0);
});
test('concurrent checks share one download and installation waits for a safe backend exit', async () => {
  let complete, stopped;
  const f = fixture({ beforeInstall: () => new Promise(resolve => { stopped = resolve; }) });
  f.updater.checkForUpdates = () => new Promise(resolve => { complete = resolve; });
  const first = f.updates.check(); assert.equal(f.updates.check(), first);
  complete(); await first;
  f.updater.emit('update-downloaded', { version: '1.2.3' });
  f.updates.defer(); assert.equal(f.updates.state.status, 'waiting');
  f.updates.cancelDeferred(); assert.equal(f.updates.state.status, 'ready');
  const install = f.updates.install(); assert.equal(f.updates.install(), install); assert.equal(f.installs, 0);
  stopped(); await install; assert.equal(f.installs, 1); assert.equal(f.updates.state.status, 'installing');
});
test('a failed queue drain preserves the downloaded update and never invokes the installer', async () => {
  const f = fixture({ beforeInstall: async () => { throw Error('worker not responding'); } });
  f.updater.emit('update-downloaded', { version: '1.2.3' });
  await f.updates.install(); assert.equal(f.installs, 0); assert.equal(f.updates.state.status, 'ready');
  assert.match(f.updates.state.message, /worker not responding/);
});
test('update restart cannot stop an active job, and waits for supervisor exit after draining', async () => {
  const supervisor = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null }), messages = [];
  let stopping = false;
  const options = { supervisor, drain: async () => ({ running: true }), send: message => messages.push(message), stopping: value => { stopping = value; } };
  await assert.rejects(prepareUpdateRestart(options), /still running/);
  assert.deepEqual(messages, []); assert.equal(stopping, false);
  const prepared = prepareUpdateRestart({ ...options, drain: async () => ({ running: false }) });
  await Promise.resolve(); assert.deepEqual(messages, ['stop']); assert.equal(stopping, true);
  let exited = false; prepared.then(() => { exited = true; }); await Promise.resolve(); assert.equal(exited, false);
  supervisor.emit('exit', 0); await prepared;
  assert.equal(exited, true);
});
test('unresponsive backend cancels installation without force-killing it', async () => {
  const supervisor = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null }), messages = [];
  let stopping;
  await assert.rejects(prepareUpdateRestart({ supervisor, drain: async () => ({ running: false }), send: value => messages.push(value), stopping: value => { stopping = value; }, timeoutMs: 1 }), /did not stop/);
  assert.deepEqual(messages, ['stop', 'resume']); assert.equal(stopping, false); assert.equal(supervisor.listenerCount('exit'), 0);
});
test('tray animates only while working, retains update status, and respects reduced motion', () => {
  const drawn = [], ticks = new Set(), images = Object.fromEntries(trayVariants.map(value => [value, value]));
  const animator = createTrayAnimator({ tray: { setImage: value => drawn.push(value) }, images, every: fn => { ticks.add(fn); return fn; }, cancel: fn => ticks.delete(fn) });
  animator.set({ running: false }); assert.equal(drawn.at(-1), 'idle'); assert.equal(ticks.size, 0);
  animator.set({ running: true }); const tick = [...ticks][0]; tick(); assert.equal(drawn.at(-1), 'busy-1');
  animator.set({ running: true }); assert.equal([...ticks][0], tick);
  animator.set({ running: true, updateAvailable: true }); [...ticks][0](); assert.equal(drawn.at(-1), 'busy-update-1');
  animator.set({ running: true, updateAvailable: true, reducedMotion: true }); assert.equal(ticks.size, 0); assert.equal(drawn.at(-1), 'busy-update-0');
  animator.set({ running: false, updateAvailable: true }); assert.equal(drawn.at(-1), 'update');
  animator.set({ running: true }); animator.dispose(); assert.equal(ticks.size, 0);
});
