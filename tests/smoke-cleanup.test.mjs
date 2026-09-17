import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { trackSmokeChild, waitForSmokeProcess, removeSmokeDirectory } from '../scripts/smoke-cleanup.mjs';

test('cleanup waits for a child still writing its profile after reporting success', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frok-cleanup-'));
  const child = spawn(process.execPath, ['-e', `
    const fs=require('node:fs'),path=require('node:path'),root=process.argv[1];
    process.send('success');
    setTimeout(()=>{fs.mkdirSync(path.join(root,'profile'),{recursive:true});fs.writeFileSync(path.join(root,'profile','late-write'),'flushed');},100);
  `, root], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  const stop = trackSmokeChild(child);
  try {
    await once(child, 'message');
    await stop();
    assert.equal(await fs.readFile(path.join(root, 'profile/late-write'), 'utf8'), 'flushed');
    await removeSmokeDirectory(root);
    await assert.rejects(fs.stat(root), { code: 'ENOENT' });
  } finally { child.kill(); await removeSmokeDirectory(root); }
});

test('cleanup also waits for an independently relaunched process', async () => {
  const child = spawn(process.execPath, ['-e', 'setTimeout(()=>{},150)'], { stdio: 'ignore' });
  const stop = trackSmokeChild(child);
  try { await waitForSmokeProcess(child.pid); assert.notEqual(child.exitCode, null); }
  finally { await stop(); }
});

test('live processes cannot be mistaken for successful shutdown', async () => {
  await assert.rejects(waitForSmokeProcess(process.pid, 0), /did not exit/);
  await assert.rejects(waitForSmokeProcess(NaN), /Invalid/);
});

test('spawn failures can still be cleaned up without an unhandled error', async () => {
  const child = spawn(path.join(os.tmpdir(), 'frok-does-not-exist'), [], { stdio: 'ignore' });
  await trackSmokeChild(child)();
});
