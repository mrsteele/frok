import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { recoverJobTimes } from '../src/lib/recover-job-times';

const directory = path.join(process.cwd(), '.data', `recover-times-test-${process.pid}`);
const db = new DatabaseSync(':memory:');
db.exec('CREATE TABLE jobs(id TEXT PRIMARY KEY,status TEXT,data TEXT);CREATE TABLE media(id TEXT PRIMARY KEY,data TEXT);');
beforeEach(async () => { db.exec('DELETE FROM jobs; DELETE FROM media;'); await fs.rm(directory, { recursive: true, force: true }); });
after(async () => { db.close(); await fs.rm(directory, { recursive: true, force: true }); });
function job(patch: Record<string, unknown> = {}) {
  const item = { id: randomUUID(), status: 'completed', runner: 'vpipe', kind: 'generate', request: { mode: 'image' }, updatedAt: '2026-01-01', completed: 2, total: 2, ...patch };
  db.prepare('INSERT INTO jobs VALUES (?,?,?)').run(item.id, item.status, JSON.stringify(item)); return item;
}
function media(jobId: string, seed: number, patch: Record<string, unknown> = {}) {
  const item = { id: randomUUID(), jobId, seed, favorite: true, origin: 'generated', ...patch };
  db.prepare('INSERT INTO media VALUES (?,?)').run(item.id, JSON.stringify(item)); return item;
}
async function log(id: string, text: string) { const dir = path.join(directory, id); await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, 'runner.log'), text); }
const report = (seed: number, duration: string, mode = 'image') => `[INFO] PipelineRuntime: pipeline 'frok-${mode}-${seed}' ran for ${duration}`;
const read = (table: string, id: string) => JSON.parse((db.prepare(`SELECT data FROM ${table} WHERE id=?`).get(id) as { data: string }).data);

test('recovers a batch total and each output time without changing saved metadata', async () => {
  const batch = job({ dismissedAt: '2026-01-02' });
  const first = media(batch.id, 42), second = media(batch.id, 43), poster = media(batch.id, 42, { origin: 'poster' });
  const untouched = media(batch.id, 44, { elapsedSeconds: 90, runnerSeconds: 80 });
  await log(batch.id, [report(42, '1 m 20 s'), report(42, '1 m 20 s'), report(43, '1 m 21 s'), report(99, '10 h', 'video'), "Stage 'denoise' ran for 20 h"].join('\n'));
  assert.deepEqual(await recoverJobTimes(db, directory), { jobsRecovered: 1, outputsRecovered: 2, unavailable: 0 });
  assert.deepEqual(read('jobs', batch.id), { ...batch, runnerSeconds: 161 });
  assert.deepEqual(read('media', first.id), { ...first, runnerSeconds: 80 });
  assert.deepEqual(read('media', second.id), { ...second, runnerSeconds: 81 });
  assert.deepEqual(read('media', poster.id), poster); assert.deepEqual(read('media', untouched.id), untouched);
  assert.deepEqual(await recoverJobTimes(db, directory), { jobsRecovered: 0, outputsRecovered: 0, unavailable: 0 });
});

test('failed runs can retain reported time; missing and invalid logs do not invent one', async () => {
  const failed = job({ status: 'failed', error: 'Synthetic failure', request: { mode: 'video' } });
  const missing = job(), invalid = job();
  await log(failed.id, report(42, '11 m 25 s', 'video'));
  await log(invalid.id, report(42, 'NaN s'));
  assert.deepEqual(await recoverJobTimes(db, directory), { jobsRecovered: 1, outputsRecovered: 0, unavailable: 2 });
  assert.equal(read('jobs', failed.id).runnerSeconds, 685); assert.equal(read('jobs', failed.id).status, 'failed');
  assert.equal(read('jobs', missing.id).runnerSeconds, undefined); assert.equal(read('jobs', invalid.id).runnerSeconds, undefined);
});

test('active jobs and already measured or recovered records are left alone', async () => {
  const rows = [job({ status: 'running' }), job({ status: 'queued' }), job({ elapsedSeconds: 120 }), job({ runnerSeconds: 80 }), job({ runner: 'comfyui' })];
  for (const item of rows) await log(item.id, report(42, '11 m 25 s'));
  assert.deepEqual(await recoverJobTimes(db, directory), { jobsRecovered: 0, outputsRecovered: 0, unavailable: 0 });
  for (const item of rows) assert.deepEqual(read('jobs', item.id), item);
});

test('path-like job IDs cannot address logs outside the jobs directory', async () => {
  const invalid = job({ id: '../outside' });
  assert.deepEqual(await recoverJobTimes(db, directory), { jobsRecovered: 0, outputsRecovered: 0, unavailable: 0 });
  assert.deepEqual(read('jobs', invalid.id), invalid);
});
