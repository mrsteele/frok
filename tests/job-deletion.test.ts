import { createLibraryFixture } from './fixtures/library';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import type { Generation, Job, Media } from '../src/lib/types';

const root = fs.mkdtempSync(path.resolve('.data/job-deletion-test-'));
process.env.FROK_DATA_DIR = root; process.env.FROK_ENV_FILE = path.join(root, 'absent.env');
const fixture = await createLibraryFixture();
const { test, beforeEach, after } = fixture;
const store = await import('../src/lib/db'), registry = await import('../src/lib/registry');
const { deleteJobs, cleanupExpiredJobs, withJobCleanup } = await import('../src/lib/job-deletion');
const { deletionPlan, deleteMedia } = await import('../src/lib/media-delete');
const { recoverDeletionFiles } = await import('../src/lib/deletion-files');
const { claimNextJob } = await import('../src/lib/worker-queue');
const { workerProtocolVersion } = await import('../src/lib/worker-health');
const routes = await import('../src/app/api/[[...segments]]/route');
const request: Generation = { mode: 'image', prompt: 'Synthetic fixture', count: 2, aspect: '1:1', duration: 6, quality: 'preview', enhance: false, referenceIds: [] };
const directory = (job: Job) => path.join(fixture.jobsDir, job.id);
function job(status: Job['status'] = 'completed', input: Generation = request) {
  const created = store.createJob({ kind: 'generate', runner: 'vpipe', request: input, total: 2 });
  const result = status === 'queued' ? created : store.updateJob(created.id, { status })!;
  fs.mkdirSync(path.join(directory(result), '0'), { recursive: true });
  fs.writeFileSync(path.join(directory(result), 'runner.log'), 'Synthetic log');
  fs.writeFileSync(path.join(directory(result), '0', 'raw.png'), 'Synthetic working file');
  return result;
}
function media(owner?: Job) {
  const id = randomUUID();
  const result: Media = { id, kind: 'image', filename: `${id}.jpg`, prompt: request.prompt, enhancedPrompt: '', width: 16, height: 16, seed: 7, favorite: true, createdAt: new Date().toISOString(), origin: owner ? 'generated' : 'upload', jobId: owner?.id, generation: owner ? structuredClone(request) : undefined };
  const saved = store.saveMedia(result); fs.writeFileSync(path.join(fixture.mediaDir, saved.filename), 'Synthetic saved media'); return saved;
}
const target = (item: Media) => ({ scope: 'media' as const, id: item.id });
const call = (segments: string[], method: 'GET' | 'POST' | 'DELETE') => routes[method](fixture.request(`http://localhost:3000/api/${segments.join('/')}`, { method }), { params: Promise.resolve({ segments }) });
const age = (item: Job, time: number, patch: Partial<Job> = {}) => store.updateJob(item.id, { ...(item.status === 'cancelled' ? { status: 'cancelled' as const } : {}), finishedAt: new Date(time).toISOString(), ...patch });
beforeEach(() => {
  store.db.exec('DELETE FROM jobs; DELETE FROM media; DELETE FROM settings');
  store.setValue('environmentDefaults', {});
  registry.registry.exec('DELETE FROM operations');
  for (const [key, value] of Object.entries({ maintenance: false, activeJob: null, workerPid: 0, workerHeartbeat: 0, workerProtocol: { pid: 0, version: workerProtocolVersion } })) registry.setServiceValue(key, value);
  for (const name of ['jobs', 'media', 'deletions', 'exports']) { const dir = path.join(fixture.directory, name); fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true }); }
});
after(() => { fixture.close(); fs.rmSync(root, { recursive: true, force: true }); });

function reference(createdAt=new Date().toISOString()) {
  return store.saveMedia({...media(),referenceOnly:true,favorite:false,createdAt});
}

test('deleting or expiring the last failed job removes its unused reference uploads',async()=>{
  for(const expire of [false,true]){
    const ref=reference(),owner=job('failed',{...request,mode:'reference',referenceIds:[ref.id]});
    if(expire){age(owner,Date.now()-4*3_600_000);await cleanupExpiredJobs();}else await deleteJobs(owner.id);
    assert.equal(store.getJob(owner.id),undefined);assert.equal(store.getMedia(ref.id),undefined);
    assert.equal(fs.existsSync(path.join(fixture.mediaDir,ref.filename)),false);
  }
});

test('job cleanup keeps references used by saved outputs or another retryable job',async()=>{
  const ref=reference(),input={...request,mode:'reference' as const,referenceIds:[ref.id]};
  const owner=job('completed',input),retryable=job('cancelled',input);
  await deleteJobs(owner.id);assert.ok(store.getMedia(ref.id));
  const saved=store.saveMedia({...media(),kind:'video',origin:'generated',generation:input});
  await deleteJobs(retryable.id);assert.ok(store.getMedia(ref.id));assert.ok(store.getMedia(saved.id));
  await deleteMedia(target(saved),deletionPlan(target(saved)).token);assert.equal(store.getMedia(ref.id),undefined);
});

test('abandoned reference uploads expire after a day even with job retention off, preserving fresh and used inputs',async()=>{
  const now=Date.now(),old=new Date(now-25*3_600_000).toISOString();
  const abandoned=reference(old),fresh=reference(),used=reference(old),image=store.saveMedia({...media(),createdAt:old});
  const retryable=job('failed',{...request,mode:'reference',referenceIds:[used.id]});
  store.setValue('runtimeOptions',{jobRetentionHours:null});
  await cleanupExpiredJobs(now);
  assert.equal(store.getMedia(abandoned.id),undefined);assert.equal(fs.existsSync(path.join(fixture.mediaDir,abandoned.filename)),false);
  for(const item of [fresh,used,image])assert.ok(store.getMedia(item.id));
  assert.ok(store.getJob(retryable.id));
});

test('deleting a job really removes its record and working directory while keeping saved media and generation settings', async () => {
  const owner = job(), saved = media(owner);
  assert.equal((await deleteJobs(owner.id)).deletedJobs, 1);
  assert.equal(store.getJob(owner.id), undefined); assert.equal(fs.existsSync(directory(owner)), false);
  assert.deepEqual(store.getMedia(saved.id), saved); assert.ok(fs.existsSync(path.join(fixture.mediaDir, saved.filename)));
  assert.equal((await call(['jobs', owner.id], 'GET')).status, 404);
  assert.equal((await call(['jobs', owner.id, 'log'], 'GET')).status, 404);
  assert.equal((await deleteJobs(owner.id)).deletedJobs, 0);
});

test('deleting one image deletes its shared batch log, keeps sibling media, and deletes jobs that reference the removed image', async () => {
  const batch = job(), removed = media(batch), sibling = media(batch);
  const failed = job('failed', { ...request, mode: 'video', sourceId: removed.id });
  const plan = deletionPlan(target(removed)); assert.equal(plan.jobs, 2);
  const result = await deleteMedia(target(removed), plan.token); assert.equal(result.deletedJobs, 2);
  assert.equal(store.getMedia(removed.id), undefined);
  assert.deepEqual(store.getMedia(sibling.id), sibling);
  for (const owner of [batch, failed]) { assert.equal(store.getJob(owner.id), undefined); assert.equal(fs.existsSync(directory(owner)), false); }
  assert.ok(fs.existsSync(path.join(fixture.mediaDir, sibling.filename)));
});

test('media deletion also removes an orphaned associated job directory', async () => {
  const owner = job(), item = media(owner); store.db.prepare('DELETE FROM jobs WHERE id=?').run(owner.id);
  await deleteMedia(target(item), deletionPlan(target(item)).token);
  assert.equal(fs.existsSync(directory(owner)), false);
});

test('cancellation preserves the job and log for review and manual deletion uses the DELETE endpoint', async () => {
  const owner = job('queued');
  const response = await call(['jobs', owner.id, 'cancel'], 'POST'); assert.equal(response.status, 200);
  assert.equal((await response.json()).job.status, 'cancelled');
  assert.equal((await call(['jobs', owner.id], 'GET')).status, 200);
  assert.equal((await (await call(['jobs', owner.id, 'log'], 'GET')).json()).log, 'Synthetic log');
  assert.ok(store.listJobs().some(item => item.id === owner.id));
  assert.equal((await call(['jobs', owner.id], 'DELETE')).status, 200);
  assert.equal(fs.existsSync(directory(owner)), false);
});

test('queued and running jobs cannot be deleted', async () => {
  for (const status of ['queued', 'running'] as const) {
    const owner = job(status); assert.equal((await call(['jobs', owner.id], 'DELETE')).status, 409);
    assert.ok(fs.existsSync(directory(owner))); assert.ok(store.getJob(owner.id));
  }
});

test('a cancelled runner retains its files until it releases its worker operation; unrelated finished jobs can be deleted', async () => {
  const pending = job('queued'), saved = media(pending), claimed = claimNextJob()!;
  registry.setServiceValue('workerPid', process.pid); registry.setServiceValue('workerHeartbeat', Date.now()); registry.setServiceValue('workerProtocol', { pid: process.pid, version: workerProtocolVersion });
  store.updateJob(pending.id, { status: 'cancelled' });
  await assert.rejects(deleteJobs(pending.id), /still stopping/);
  assert.match(deletionPlan(target(saved)).blocked!, /still stopping/);
  const other = job(); await deleteJobs(other.id); assert.equal(store.getJob(other.id), undefined);
  registry.endOperation(claimed.operation);
  await deleteJobs(pending.id); assert.equal(fs.existsSync(directory(pending)), false);
});

test('bulk deletion covers every finished record, including older hidden records, and keeps queued jobs and media', async () => {
  const waiting = job('queued'), saved = media();
  for (let n = 0; n < 105; n++) {
    const owner = store.createJob({ kind: 'setup', runner: 'vpipe', request: { task: 'synthetic' }, total: 1 });
    store.updateJob(owner.id, { status: n % 3 === 0 ? 'cancelled' : n % 3 === 1 ? 'failed' : 'completed', ...(n === 0 ? { dismissedAt: new Date().toISOString() } : {}) });
  }
  const result = await (await call(['jobs', 'clear'], 'POST')).json(); assert.equal(result.deletedJobs, 105);
  assert.deepEqual(store.listJobs().map(item => item.id), [waiting.id]); assert.ok(store.getMedia(saved.id));
});

test('three-hour expiry uses finish time and includes failed, cancelled and previously dismissed jobs', async () => {
  const now = Date.now(), old: Job[] = [];
  for (const status of ['completed', 'failed', 'cancelled'] as const) { const owner = job(status); age(owner, now - 3 * 3_600_000, { dismissedAt: new Date(now).toISOString() }); old.push(owner); }
  const saved = media(old[0]), fresh = job(); age(fresh, now - 3_600_000, { createdAt: new Date(now - 20 * 3_600_000).toISOString() });
  const waiting = job('queued');
  assert.equal((await cleanupExpiredJobs(now)).deletedJobs, 3);
  for (const owner of old) assert.equal(fs.existsSync(directory(owner)), false);
  assert.ok(store.getJob(fresh.id)); assert.ok(store.getJob(waiting.id)); assert.deepEqual(store.getMedia(saved.id), saved);
});

test('retention can be disabled, extended, or shortened and legacy records fall back to last update', async () => {
  const now = Date.now(), owner = job(); age(owner, now - 4 * 3_600_000);
  store.setValue('runtimeOptions', { jobRetentionHours: null }); assert.equal((await cleanupExpiredJobs(now)).deletedJobs, 0);
  store.setValue('runtimeOptions', { jobRetentionHours: 6 }); assert.equal((await cleanupExpiredJobs(now)).deletedJobs, 0);
  const legacy = { ...store.getJob(owner.id)!, finishedAt: undefined, updatedAt: new Date(now - 4 * 3_600_000).toISOString() };
  store.db.prepare('UPDATE jobs SET data=? WHERE id=?').run(JSON.stringify(legacy), owner.id);
  store.setValue('runtimeOptions', { jobRetentionHours: 2 }); assert.equal((await cleanupExpiredJobs(now)).deletedJobs, 1);
});

test('pending runner cleanup keeps the job, files and selected media, while expiry can still remove another job', async () => {
  const now = Date.now(), blocked = job(), saved = media(blocked), other = job();
  age(blocked, now - 4 * 3_600_000); age(other, now - 4 * 3_600_000);
  fs.writeFileSync(path.join(directory(blocked), '0', `comfy-cleanup-${randomUUID()}.json`), '{}');
  await assert.rejects(deleteMedia(target(saved), deletionPlan(target(saved)).token), /cleanup is still pending/);
  assert.ok(store.getMedia(saved.id)); assert.ok(store.getJob(blocked.id));
  const result = await cleanupExpiredJobs(now); assert.equal(result.deletedJobs, 1); assert.equal(result.pending, 1);
  assert.ok(fs.existsSync(directory(blocked))); assert.equal(fs.existsSync(directory(other)), false);
});

test('cleanup coordinates with exports, resets, new mutations and worker claims', async () => {
  const owner = job();
  for (const kind of ['export', 'download', 'delete'] as const) {
    const operation = registry.beginOperation(kind);
    try { await assert.rejects(deleteJobs(owner.id), /reset or backup/); } finally { registry.endOperation(operation); }
  }
  await withJobCleanup(async () => {
    for (const kind of ['request', 'delete', 'export', 'download'] as const) assert.throws(() => registry.beginOperation(kind), /cleanup/);
    assert.equal(claimNextJob(), undefined);
    const read = registry.beginOperation('read'); registry.endOperation(read);
  });
  assert.ok(store.getJob(owner.id));
});

test('a failed file move rolls back the media and job records and both directories', async () => {
  const owner = job(), saved = media(owner), plan = deletionPlan(target(saved));
  const rename = fs.renameSync; let moves = 0;
  fs.renameSync = (...args) => { if (++moves === 2) throw Error('Synthetic move failure'); return rename(...args); };
  try { await assert.rejects(deleteMedia(target(saved), plan.token), /Synthetic move failure/); } finally { fs.renameSync = rename; }
  assert.ok(store.getJob(owner.id)); assert.ok(store.getMedia(saved.id)); assert.ok(fs.existsSync(directory(owner))); assert.ok(fs.existsSync(path.join(fixture.mediaDir, saved.filename)));
});

test('unfinished file cleanup is reported and retried even with automatic retention disabled', async () => {
  const owner = job(), remove = fs.rmSync;
  fs.rmSync = (...args) => { if (String(args[0]).includes(`${path.sep}deletions${path.sep}`)) throw Error('Synthetic cleanup failure'); return remove(...args); };
  try { assert.equal((await deleteJobs(owner.id)).cleanupPending, true); } finally { fs.rmSync = remove; }
  assert.equal(store.getJob(owner.id), undefined); assert.equal(fs.readdirSync(path.join(fixture.directory, 'deletions')).length, 1);
  store.setValue('runtimeOptions', { jobRetentionHours: null }); await cleanupExpiredJobs();
  assert.deepEqual(fs.readdirSync(path.join(fixture.directory, 'deletions')), []);
});

test('job journals restore uncommitted files and finish committed deletion after a restart', () => {
  for (const committed of [false, true]) {
    const owner = job(), staged = path.join(fixture.directory, 'deletions', randomUUID()); fs.mkdirSync(staged);
    fs.writeFileSync(path.join(staged, 'manifest.json'), JSON.stringify([{ id: owner.id, filename: `job-${owner.id}`, kind: 'job' }]));
    fs.renameSync(directory(owner), path.join(staged, `job-${owner.id}`));
    if (committed) store.db.prepare('DELETE FROM jobs WHERE id=?').run(owner.id);
    recoverDeletionFiles(); assert.equal(fs.existsSync(directory(owner)), !committed); assert.equal(fs.existsSync(staged), false);
  }
});

test('job cleanup rejects path traversal and symlinked job directories', async () => {
  const owner = job(), outside = path.join(root, 'keep'); fs.mkdirSync(outside, { recursive: true }); fs.writeFileSync(path.join(outside, 'keep.txt'), 'keep');
  await assert.rejects(deleteJobs('../keep'), /Invalid job ID/);
  fs.rmSync(directory(owner), { recursive: true }); fs.symlinkSync(outside, directory(owner));
  await assert.rejects(deleteJobs(owner.id), /regular job directory/); assert.equal(fs.readFileSync(path.join(outside, 'keep.txt'), 'utf8'), 'keep');
});

test('job cleanup refuses a symlinked jobs folder without touching its contents', async () => {
  const owner = job(), moved = path.join(root, 'held-jobs');
  fs.renameSync(fixture.jobsDir, moved); fs.symlinkSync(moved, fixture.jobsDir);
  try {
    await assert.rejects(deleteJobs(owner.id), /regular jobs folder/);
    assert.ok(store.getJob(owner.id)); assert.equal(fs.readFileSync(path.join(moved, owner.id, 'runner.log'), 'utf8'), 'Synthetic log');
  } finally { fs.unlinkSync(fixture.jobsDir); fs.renameSync(moved, fixture.jobsDir); }
});

test('the actual worker cleans expired jobs on startup without running a generation', async () => {
  const owner = job(), saved = media(owner); age(owner, Date.now() - 4 * 3_600_000);
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/worker/index.ts'], { cwd: process.cwd(), env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
  const exited = once(child, 'exit');
  try {
    const deadline = Date.now() + 10_000;
    while (store.getJob(owner.id) && child.exitCode === null && Date.now() < deadline) await delay(40);
    assert.equal(store.getJob(owner.id), undefined, output); assert.ok(store.getMedia(saved.id)); assert.equal(fs.existsSync(directory(owner)), false);
  } finally { child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 3000); await exited; clearTimeout(timer); }
});
