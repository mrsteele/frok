import { createLibraryFixture } from './fixtures/library';
import pureTest from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseVpipeRuntime, formatRunnerTime } from '../src/lib/runner-time';
import type { Generation } from '../src/lib/types';

const id = 'frok-image-42';
const report = (duration: string, name = id) => `[INFO] PipelineRuntime: pipeline '${name}' ran for ${duration}`;

pureTest('reads Vpipe elapsed time in hours, minutes, seconds and milliseconds', () => {
  for (const [duration, seconds] of [['11 m 25 s', 685], ['1 h 2 m 3 s', 3723], ['3.5 s', 3.5], ['240 ms', .24], ['0 s', 0], ['2m 4s', 124]] as const) {
    assert.equal(parseVpipeRuntime(report(duration), id), seconds);
  }
  assert.equal(parseVpipeRuntime(`\x1b[32m${report('11 m 25 s')}\x1b[0m`, id), 685);
});

pureTest('ignores stage timings, wall-clock progress stamps, other pipelines and malformed durations', () => {
  for (const line of ["[PROGRESS] 100% of 'denoise' completed at 11:25:00 (8/8)", "Stage 'denoise' ran for 11 m 25 s", report('3 s', 'other'), report('-3 s'), report('NaN s'), report('Infinity s'), report('11 m 25'), report('11 m 25 s remaining')]) {
    assert.equal(parseVpipeRuntime(line, id), undefined, line);
  }
  assert.equal(parseVpipeRuntime([report('1 s'), report('11 m 25 s'), report('1 h', 'other')].join('\r\n'), id), 685);
});

pureTest('formats reported time without fabricating values for older assets', () => {
  assert.equal(formatRunnerTime(685), '11m 25s');
  assert.equal(formatRunnerTime(3723), '1h 2m 3s');
  assert.equal(formatRunnerTime(.24), '240ms');
  assert.equal(formatRunnerTime(0), '0s');
  for (const value of [undefined, NaN, Infinity, -1]) assert.equal(formatRunnerTime(value), undefined);
});

const root = process.cwd(), directory = path.join(root, '.data', `runner-time-test-${process.pid}`);
process.env.FROK_DATA_DIR = directory;
process.env.VPIPE_WORKDIR = path.join(directory, 'workspace');
process.env.VPIPE_BIN = path.join(root, 'tests/fixtures/runtime-vpipe.mjs');
process.env.VPIPE_IMAGE_MODEL='synthetic/image';
process.env.VPIPE_LIVE_PREVIEWS = '0';
const { renderVpipe } = await import('./fixtures/pipeline');
const fixture = await createLibraryFixture();
const { test, after } = fixture;
await fs.mkdir(path.join(process.env.VPIPE_WORKDIR!,'models/krea/Krea-2-Turbo'),{recursive:true});
const store = await import('../src/lib/db');
after(async () => { fixture.close(); await fs.rm(directory, { recursive: true, force: true }); });
const request: Generation = { mode: 'image', prompt: 'Synthetic runtime test', aspect: '1:1', duration: 6, quality: 'preview', count: 1, enhance: false, referenceIds: [] };

test('captures one complete summary across chunks and without a final newline, including failed runs', async () => {
  for (const prompt of ['success', 'fail']) {
    const itemDirectory = path.join(fixture.jobsDir, prompt);
    await fs.mkdir(itemDirectory, { recursive: true });
    const timings: number[] = [];
    const run = renderVpipe({ request, prompt, seed: 42, width: 512, height: 512, output: path.join(itemDirectory, 'unused-output'), directory: itemDirectory, references: [], signal: new AbortController().signal, log() {}, onRuntime: seconds => timings.push(seconds) });
    if (prompt === 'fail') await assert.rejects(run); else await run;
    assert.deepEqual(timings, [685]);
  }
});

test('job totals and per-output timings persist independently of playback duration', () => {
  const job = store.createJob({ kind: 'generate', request: { ...request, count: 2 }, runner: 'vpipe', total: 2 });
  let total = 0;
  for (const [index, seconds] of [685, 700].entries()) {
    total += seconds; store.updateJob(job.id, { runnerSeconds: total });
    const item = store.saveMedia({ id: `synthetic-${index}`, jobId: job.id, batchIndex: index, kind: 'image', filename: 'unused.jpg', prompt: request.prompt, enhancedPrompt: request.prompt, width: 512, height: 512, seed: index, favorite: false, createdAt: '2026-01-01', origin: 'generated', runnerSeconds: seconds });
    assert.equal(store.getMedia(item.id)?.runnerSeconds, seconds);
    assert.equal(store.getMedia(item.id)?.duration, undefined);
  }
  assert.equal(store.getJob(job.id)?.runnerSeconds, 1385);
});
