import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createLibraryFixture } from './fixtures/library';
import type { Job } from '../src/lib/types';

const directory = await fs.mkdtemp(path.resolve('.data/worker-readiness-test-'));
process.env.FROK_DATA_DIR = directory;
process.env.FROK_ENV_FILE = path.join(directory, 'absent.env');
process.env.VPIPE_WORKDIR = path.join(directory, 'unused-models');
process.env.VPIPE_BIN = path.join(directory, 'unused-vpipe');
process.env.FROK_MANAGE_OLLAMA = '0';
const fixture = await createLibraryFixture();
const store = await import('../src/lib/db');
const registry = await import('../src/lib/registry');
const { workerStatus } = await import('../src/lib/worker-health');

fixture.after(async () => {
  fixture.close();
  await fs.rm(directory, { recursive: true, force: true });
});

for (const recentHeartbeat of [false, true]) {
  fixture.test(`worker readiness waits for startup recovery with ${recentHeartbeat ? 'a recent' : 'no'} previous heartbeat`, async () => {
    store.db.exec('DELETE FROM jobs');
    registry.setServiceValue('workerHeartbeat', recentHeartbeat ? Date.now() : 0);
    const retired = ['queued', 'running', 'completed'].map(status => {
      const job = store.createJob({ kind: 'setup', runner: 'vpipe', total: 1, request: { task: 'ollama' } });
      store.updateJob(job.id, { status: status as Job['status'] });
      return job.id;
    });

    // Hold the library write lock so startup cannot finish its migrations.
    // The registry stays readable, making the readiness race deterministic.
    store.db.exec('BEGIN IMMEDIATE');
    const worker = spawn(process.execPath, ['--import', 'tsx', 'src/worker/index.ts'], {
      cwd: process.cwd(), env: process.env, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '', spawnError: Error | undefined;
    worker.on('error', error => { spawnError = error; });
    for (const stream of [worker.stdout!, worker.stderr!]) stream.on('data', chunk => { output += String(chunk); });
    const closed = new Promise(resolve => worker.once('close', (code, signal) => resolve({ code, signal })));
    const timer = setTimeout(() => worker.kill('SIGKILL'), 10_000);
    async function waitFor(check: () => boolean) {
      const deadline = Date.now() + 5000;
      while (!check()) {
        assert.equal(spawnError, undefined, output);
        assert.equal(worker.exitCode, null, output);
        assert.equal(worker.signalCode, null, output);
        assert.ok(Date.now() < deadline, `Worker startup timed out: ${output}`);
        await delay(10);
      }
    }
    try {
      await waitFor(() => registry.serviceValue('workerPid', 0) === worker.pid);
      assert.deepEqual(retired.map(id => store.getJob(id)!.status), ['queued', 'running', 'completed']);
      assert.equal(registry.serviceValue('workerHeartbeat', -1), 0, 'Claiming the PID must not advertise readiness');
      assert.equal(workerStatus().ready, false);
      assert.doesNotMatch(output, /Frok generation worker ready/);

      store.db.exec('COMMIT');
      await waitFor(() => registry.serviceValue('workerHeartbeat', 0) > 0);
      assert.equal(workerStatus().ready, true);
      assert.deepEqual(retired.map(id => store.getJob(id)!.status), ['cancelled', 'cancelled', 'completed']);
      assert.match(store.getJob(retired[0])!.error!, /older installation job was retired/);
      for (const id of retired) await assert.rejects(fs.stat(path.join(fixture.jobsDir, id, 'runner.log')), { code: 'ENOENT' });

      worker.kill('SIGTERM');
      assert.deepEqual(await closed, { code: 0, signal: null }, output);
      assert.equal(registry.serviceValue('workerHeartbeat', -1), 0);
      assert.equal(registry.serviceValue('workerPid', -1), 0);
    } finally {
      if (store.db.isTransaction) store.db.exec('ROLLBACK');
      if (worker.exitCode === null && worker.signalCode === null) worker.kill('SIGKILL');
      await closed;
      clearTimeout(timer);
    }
  });
}
