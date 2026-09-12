import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkMediaTools } from '../scripts/check-media-tools.mjs';

test('packaging rejects standalone media commands without executing them', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frok-media-payload-test-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  await fs.writeFile(path.join(root, 'worker.mjs'), '// backend');
  await checkMediaTools(root);
  for (const name of ['ffmpeg', 'ffprobe.exe', '@ffmpeg-installer', '@ffprobe-installer']) {
    await fs.mkdir(path.join(root, name));
    await assert.rejects(checkMediaTools(root), /External media tool found/);
    await fs.rm(path.join(root, name), {recursive: true});
  }
});
