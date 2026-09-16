import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { stageDesktopRuntime, runDesktop } from '../scripts/desktop-runtime.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frok-desktop-runtime-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const distribution = path.join(root, 'node_modules/electron/dist');
  await fs.mkdir(distribution, { recursive: true });
  return { root, distribution, directory: path.join(root, 'runtime') };
}

async function writeExecutable(file, contents) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, contents, { mode: 0o755 });
}

test('macOS helpers and framework links survive removal of node_modules', { skip: process.platform === 'win32' }, async t => {
  const { root, distribution, directory } = await fixture(t);
  const executable = path.join(distribution, 'Electron.app/Contents/MacOS/Electron');
  const framework = 'Electron.app/Contents/Frameworks/Electron Framework.framework';
  const helper = 'Electron.app/Contents/Frameworks/Electron Helper.app/Contents/MacOS/Electron Helper';
  await writeExecutable(executable, 'main');
  await writeExecutable(path.join(distribution, helper), 'audio helper');
  await writeExecutable(path.join(distribution, framework, 'Versions/A/Electron Framework'), 'framework');
  await fs.symlink('A', path.join(distribution, framework, 'Versions/Current'));
  await fs.symlink('Versions/Current/Electron Framework', path.join(distribution, framework, 'Electron Framework'));
  const runtime = await stageDesktopRuntime(executable, { directory, platform: 'darwin' });
  const snapshot = path.resolve(path.dirname(runtime.executable), '../../..');
  await fs.rm(path.join(root, 'node_modules'), { recursive: true });
  assert.equal(await fs.readFile(runtime.executable, 'utf8'), 'main');
  assert.equal(await fs.readFile(path.join(snapshot, helper), 'utf8'), 'audio helper');
  assert.equal(await fs.readFile(path.join(snapshot, framework, 'Electron Framework'), 'utf8'), 'framework');
  assert.equal(await fs.readlink(path.join(snapshot, framework, 'Versions/Current')), 'A');
  await fs.access(runtime.executable, fs.constants.X_OK);
  await runtime.dispose();
  assert.deepEqual(await fs.readdir(directory), []);
});

for (const platform of ['linux', 'win32']) test(`${platform} launches retain independent runtime files across installs`, async t => {
  const { distribution, directory } = await fixture(t);
  const executable = path.join(distribution, platform === 'win32' ? 'electron.exe' : 'electron');
  await writeExecutable(executable, 'old runtime');
  await fs.writeFile(path.join(distribution, 'resources.pak'), 'old resources');
  const first = await stageDesktopRuntime(executable, { directory, platform });
  await fs.writeFile(executable, 'new runtime');
  await fs.writeFile(path.join(distribution, 'resources.pak'), 'new resources');
  const second = await stageDesktopRuntime(executable, { directory, platform });
  assert.notEqual(first.executable, second.executable);
  assert.equal(await fs.readFile(first.executable, 'utf8'), 'old runtime');
  assert.equal(await fs.readFile(second.executable, 'utf8'), 'new runtime');
  assert.equal(await fs.readFile(path.join(path.dirname(first.executable), 'resources.pak'), 'utf8'), 'old resources');
  await second.dispose();
  await fs.access(first.executable);
  await first.dispose();
  assert.deepEqual(await fs.readdir(directory), []);
});

test('a failed copy does not leave a partial runtime', async t => {
  const { distribution, directory } = await fixture(t);
  await assert.rejects(stageDesktopRuntime(path.join(distribution, 'missing'), { directory, platform: 'linux' }), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(directory), []);
});

test('launcher preserves failures and cleans up after normal exits and signals', { skip: process.platform === 'win32' }, async t => {
  const { distribution, directory } = await fixture(t);
  const executable = path.join(distribution, 'electron');
  const listeners = ['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal));
  for (const [script, expected] of [['exit 0', 0], ['exit 7', 7], ['kill -TERM $$', 1]]) {
    await writeExecutable(executable, `#!/bin/sh\n${script}\n`);
    assert.equal(await runDesktop(executable, [], { directory, platform: 'linux' }), expected);
    assert.deepEqual(await fs.readdir(directory), []);
    assert.deepEqual(['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal)), listeners);
  }
  await writeExecutable(executable, '#!/frok-nonexistent-interpreter\n');
  await assert.rejects(runDesktop(executable, [], { directory, platform: 'linux' }), { code: 'ENOENT' });
  assert.deepEqual(await fs.readdir(directory), []);
  assert.deepEqual(['SIGINT', 'SIGTERM'].map(signal => process.listenerCount(signal)), listeners);
});
