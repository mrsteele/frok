import { createLibraryFixture } from './fixtures/library';
import { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { jobElapsedSeconds } from '../src/lib/runner-time';
import { JobRuntime } from '../src/components/queue/job-runtime';
import type { Generation, Job } from '../src/lib/types';

const directory = path.join(process.cwd(), '.data', `job-runtime-test-${process.pid}`);
process.env.FROK_DATA_DIR = directory;
const fixture = await createLibraryFixture();
const { test, after, afterEach, beforeEach } = fixture;
const store = await import('../src/lib/db');
const epoch = Date.parse('2026-01-01T00:00:00Z');
const request: Generation = { mode: 'image', prompt: 'Synthetic timing', aspect: '1:1', duration: 6, quality: 'preview', count: 1, enhance: false, referenceIds: [] };
const create = () => store.createJob({ kind: 'generate', request, runner: 'comfyui', total: 1 });
const markup = (job: Job) => renderToStaticMarkup(createElement(JobRuntime, { job }));
beforeEach(() => { store.db.exec('DELETE FROM jobs;'); mock.timers.enable({ apis: ['Date'], now: epoch }); });
afterEach(() => mock.timers.reset());
after(async () => { fixture.close(); await fs.rm(directory, { recursive: true, force: true }); });

test('time starts at worker pickup, not creation, and progress does not reset the clock', () => {
  const queued = create();
  mock.timers.setTime(epoch + 300000);
  assert.equal(jobElapsedSeconds(queued), undefined);
  assert.equal(markup(queued), '');
  const running = store.claimJob()!;
  assert.equal(running.id, queued.id);
  assert.equal(running.startedAt, new Date(epoch + 300000).toISOString());
  mock.timers.setTime(epoch + 365000);
  const updated = store.updateJob(running.id, { message: 'VAE decode', step: { current: 50, total: 100 } })!;
  assert.equal(updated.startedAt, running.startedAt);
  assert.equal(jobElapsedSeconds(updated), 65);
  assert.match(markup(updated), /Elapsed · 1m 5s/);
  assert.equal(jobElapsedSeconds(updated, epoch + 375000), 75); // Keeps counting between progress reports.
});

test('completed jobs retain their measured time after reload and later updates', () => {
  const job = create(); store.claimJob(); mock.timers.setTime(epoch + 685000);
  const complete = store.updateJob(job.id, { status: 'completed' })!;
  assert.equal(complete.elapsedSeconds, 685);
  assert.equal(complete.finishedAt, new Date(epoch + 685000).toISOString());
  assert.match(markup(complete), /Ran for · 11m 25s/);
  mock.timers.setTime(epoch + 900000);
  store.updateJob(job.id, { message: 'Saved' });
  const reloaded = JSON.parse(JSON.stringify(store.getJob(job.id))) as Job;
  assert.equal(jobElapsedSeconds(reloaded), 685);
  assert.equal(reloaded.finishedAt, complete.finishedAt);
});

test('setup and failed jobs have timings without any runner logs; retries start fresh', () => {
  const setup = store.createJob({ kind: 'setup', request: { task: 'ollama' }, runner: 'vpipe', total: 1 });
  store.claimJob(); mock.timers.setTime(epoch + 123000);
  const failed = store.updateJob(setup.id, { status: 'failed', error: 'Synthetic failure' })!;
  assert.equal(failed.elapsedSeconds, 123);
  assert.match(markup(failed), /Ran for · 2m 3s/);
  const retry = store.createJob({ kind: setup.kind, request: setup.request, runner: setup.runner, total: 1 });
  assert.equal(retry.startedAt, undefined); assert.equal(retry.elapsedSeconds, undefined);
  mock.timers.setTime(epoch + 200000); const running = store.claimJob()!;
  assert.equal(running.id, retry.id); assert.equal(jobElapsedSeconds(running), 0);
});

test('cancellation freezes time and late worker events cannot restart it', () => {
  const job = create(); store.claimJob(); mock.timers.setTime(epoch + 15000);
  const cancelled = store.updateJob(job.id, { status: 'cancelled' })!;
  assert.equal(cancelled.elapsedSeconds, 15);
  mock.timers.setTime(epoch + 45000);
  store.updateJob(job.id, { status: 'completed', elapsedSeconds: 45 });
  store.updateJob(job.id, { status: 'cancelled', error: undefined });
  assert.equal(store.getJob(job.id)?.elapsedSeconds, 15);
  assert.equal(store.getJob(job.id)?.finishedAt, cancelled.finishedAt);
  const waiting = create(); const stopped = store.updateJob(waiting.id, { status: 'cancelled' })!;
  assert.equal(stopped.startedAt, undefined); assert.equal(jobElapsedSeconds(stopped), undefined);
});

test('measured final duration can use a monotonic clock and keeps the reported runner time separate', () => {
  const job = create(); store.claimJob(); mock.timers.setTime(epoch + 720000);
  const complete = store.updateJob(job.id, { status: 'completed', elapsedSeconds: 700.5, runnerSeconds: 685 })!;
  assert.equal(jobElapsedSeconds(complete), 700.5);
  assert.match(markup(complete), /Ran for · 11m 41s/);
  assert.match(markup(complete), /ComfyUI rendering: 11m 25s/);
  assert.match(markup({...complete,runner:'vpipe'}), /Vpipe rendering: 11m 25s/);
});

test('interrupted runs stop at their last known activity, excluding downtime before restart', () => {
  const job = create(); store.claimJob(); mock.timers.setTime(epoch + 600000);
  const failed = store.updateJob(job.id, { status: 'failed', finishedAt: new Date(epoch + 90000).toISOString() })!;
  assert.equal(jobElapsedSeconds(failed), 90);
});

test('legacy records use captured runner time, otherwise omit an unknowable duration', () => {
  const old = { ...create(), status: 'completed' as const, updatedAt: new Date(epoch + 685000).toISOString() };
  assert.equal(jobElapsedSeconds(old), undefined); assert.match(markup(old), /Time not recorded/);
  assert.match(markup({ ...old, runnerSeconds: 685 }), /ComfyUI rendering · 11m 25s/);
  assert.match(markup({ ...old, runner:'vpipe', runnerSeconds: 685 }), /Vpipe rendering · 11m 25s/);
  assert.equal(jobElapsedSeconds({ ...old, startedAt: 'bad', finishedAt: old.updatedAt }), undefined);
});
