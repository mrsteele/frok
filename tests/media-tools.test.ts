import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolveMediaTool as resolve } from '../src/lib/media-tools';
const resolveMediaTool: typeof resolve = (tool, options = {}) => resolve(tool, {bundledDirectory: '', ...options});

test('external tools resolve from PATH and settings without caching', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frok-media-tools-test-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const executable = (name:string) => `${name}${process.platform==='win32'?'.exe':''}`;
  for (const name of ['ffmpeg', 'ffprobe']) await fs.writeFile(path.join(root, executable(name)), '#!/bin/sh\nexit 0\n', {mode: 0o755});
  const env = {PATH: root, FFMPEG_BIN: '/explicit/ffmpeg'};
  assert.equal(resolveMediaTool('ffmpeg', {env, platform:'linux'}), '/explicit/ffmpeg');
  assert.equal(resolveMediaTool('ffprobe', {env}), path.join(root, executable('ffprobe')));
  assert.equal(resolveMediaTool('ffmpeg', {env, directory: root}), path.join(root, process.platform==='win32'?'ffmpeg.exe':'ffmpeg'));
  assert.equal(resolveMediaTool('ffmpeg', {env, directory: '~/tools', home: '/example', platform:'linux'}), '/example/tools/ffmpeg');
  assert.throws(() => resolveMediaTool('ffmpeg', {directory: 'relative/tools'}), /absolute/);
  assert.equal(resolveMediaTool('ffmpeg', {env: {}, platform: 'win32', directory: 'C:\\Tools'}), 'C:\\Tools\\ffmpeg.exe');
  assert.ok(path.isAbsolute(resolveMediaTool('ffmpeg', {env: {PATH: '.::relative'}})));
});

test('included tools work without PATH, while explicit overrides still win', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frok-included-media-test-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  await fs.writeFile(path.join(root, name), 'fixture', {mode: 0o755});
  assert.equal(resolveMediaTool('ffmpeg', {bundledDirectory: root, env: {PATH: ''}}), path.join(root, name));
  assert.equal(resolveMediaTool('ffmpeg', {bundledDirectory: root, env: {FFMPEG_BIN: '/override/ffmpeg'}}), '/override/ffmpeg');
  assert.equal(resolveMediaTool('ffmpeg', {bundledDirectory: root, directory: root}), path.join(root, name));
});
