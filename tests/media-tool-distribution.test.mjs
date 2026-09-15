import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkMediaTools } from '../scripts/check-media-tools.mjs';
import { mediaDirectory } from '../scripts/media-tools.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('included media tools encode, probe and extract a synthetic frame with no system tools', async t => {
  const directory = mediaDirectory(process.cwd());
  await checkMediaTools(directory, undefined, {checkLinkage: false});
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frok-included-encode-test-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const command = tool => path.join(directory, tool + (process.platform === 'win32' ? '.exe' : ''));
  const execute = promisify(execFile);
  const env = {...process.env, PATH: ''};
  const file = path.join(root, 'sample.mp4');
  await execute(command('ffmpeg'), ['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=64x64:r=8','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','0.5','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac',file], {env,timeout:15000});
  const probe = await execute(command('ffprobe'), ['-v','error','-show_streams','-of','json',file], {env,timeout:15000});
  const streams = JSON.parse(probe.stdout).streams;
  assert.ok(streams.some(stream => stream.codec_name === 'h264' && stream.width === 64));
  assert.ok(streams.some(stream => stream.codec_name === 'aac'));
  await execute(command('ffmpeg'), ['-hide_banner','-loglevel','error','-i',file,'-frames:v','1',path.join(root,'frame.png')], {env,timeout:15000});
  assert.ok((await fs.stat(path.join(root,'frame.png'))).size > 0);
});

test('packaging rejects altered binaries and missing source before executing them', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frok-media-payload-test-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  await fs.cp(mediaDirectory(process.cwd()), root, {recursive: true});
  const name = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  await fs.writeFile(path.join(root, name), 'changed binary');
  const neverExecute = async () => { throw Error('Unexpected execution'); };
  await assert.rejects(checkMediaTools(root, neverExecute), /ffmpeg checksum mismatch/);
  await fs.rm(path.join(root, 'sources'), {recursive: true});
  await assert.rejects(checkMediaTools(root, neverExecute), /ENOENT/);
});
