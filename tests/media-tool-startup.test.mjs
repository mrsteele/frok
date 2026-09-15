import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {checkMediaTools} from '../scripts/check-media-tools.mjs';
import {checkMediaCompiler, mediaDirectory} from '../scripts/media-tools.mjs';

const execute = promisify(execFile);

test('startup reuses a verified cache without developer tools or source downloads', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frok-media-startup-test-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const directory = mediaDirectory(root);
  await fs.cp(mediaDirectory(process.cwd()), directory, {recursive: true});
  await checkMediaTools(directory, async (command, args, options) => {
    assert.equal(path.dirname(command), directory, 'only the bundled executables may run');
    return execute(command, args, options);
  }, {checkLinkage: false});
  const script = `import {ensureMediaTools} from ${JSON.stringify(new URL('../scripts/media-tools.mjs', import.meta.url).href)};
    console.log(await ensureMediaTools(${JSON.stringify(root)}));`;
  const {stdout} = await execute(process.execPath, ['--input-type=module', '-e', script], {env: {...process.env, PATH: ''}, timeout: 30_000});
  assert.equal(stdout.trim(), directory);
  await assert.rejects(fs.access(path.join(root, '.data')), {code: 'ENOENT'});
});

test('new-build and packaging verification still require the macOS library inspection', {skip: process.platform !== 'darwin'}, async () => {
  const failure = Error('otool is unavailable');
  await assert.rejects(checkMediaTools(mediaDirectory(process.cwd()), (command, args, options) => {
    if (command === '/usr/bin/otool') throw failure;
    return execute(command, args, options);
  }), error => error === failure);
});

test('compiler preflight explains the Xcode license failure and cleans up its probe', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frok-media-compiler-test-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  await assert.rejects(checkMediaCompiler(root, async () => {
    throw Object.assign(Error('clang exited with 69'), {stderr: 'You have not agreed to the Xcode license agreements.\n'});
  }, 'darwin'), /Cannot build bundled FFmpeg:[\s\S]*not agreed to the Xcode license[\s\S]*sudo xcodebuild -license/);
  assert.deepEqual(await fs.readdir(root), []);
});

test('compiler preflight preserves other compiler diagnostics', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frok-media-compiler-test-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  await assert.rejects(checkMediaCompiler(root, async () => {
    throw Object.assign(Error('cc exited with 1'), {stderr: 'ld: cannot find crt1.o\n'});
  }, 'linux'), /cc could not compile and link[\s\S]*ld: cannot find crt1.o[\s\S]*docs\/development.md/);
  assert.deepEqual(await fs.readdir(root), []);
});
