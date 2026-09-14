import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { advanceVideoProgress, completedVideoProgress, finishingVideoProgress, jobProgress, parseProgressLog, parseStepProgress, preparingVideoProgress, tracksVideoStages } from '../src/lib/progress';
import { JobProgressBar } from '../src/components/queue/job-progress';
import { VideoProgress } from '../src/components/queue/video-progress';
import type { Generation, Job, JobStep } from '../src/lib/types';

const request: Generation = { mode: 'video', prompt: 'Synthetic motion', aspect: '4:3', duration: 6, quality: 'preview', count: 1, enhance: false, referenceIds: [] };
const job: Job = { id: 'synthetic-video', kind: 'generate', request, runner: 'vpipe', status: 'running', completed: 0, total: 1, message: 'Rendering your video…', createdAt: '2026-01-01', updatedAt: '2026-01-01' };
const milestone = (phase: string, percent: number) => `[PROGRESS] ${percent}% of '${phase}' completed at 15:38:23 (500/1500)`;
const step = (label: string, current: number, total = 100): JobStep => ({ label, current, total });

// Synthetic log replay and component markup only. No runner, GPU or model imports.
test('parses native denoise and VAE decode milestones without mistaking GPU block counts for steps', () => {
  assert.deepEqual(parseStepProgress(milestone('denoise', 30)), step('Denoising', 30));
  assert.deepEqual(parseStepProgress(`\x1b[32m${milestone('vae decode', 20)}\x1b[0m`), step('vae decode', 20));
  assert.deepEqual(parseStepProgress("GenerateVideoStage('generate-video'): step 3/8 sigma 0.5"), { current: 3, total: 8 });
  assert.deepEqual(parseStepProgress(milestone('weights.safetensors', 90)), step('weights.safetensors', 90));
  assert.equal(parseStepProgress('GPU 93% elapsed 80 seconds'), undefined);
});

test('denoising and decode form one continuous percentage, with 100 reserved for a saved video', () => {
  let state = preparingVideoProgress();
  const values: number[] = [];
  for (const [phase, percent] of [['denoise', 0], ['denoise', 50], ['denoise', 100], ['vae decode', 0], ['vae decode', 50], ['vae decode', 100]] as const) {
    state = parseProgressLog(milestone(phase, percent), state).videoProgress!;
    values.push(jobProgress({ ...job, videoProgress: state }).percent!);
  }
  assert.deepEqual(values, [0, 40, 80, 80, 89, 99]);
  assert.equal(jobProgress({ ...job, videoProgress: finishingVideoProgress() }).percent, 99);
  assert.equal(jobProgress({ ...job, status: 'completed', completed: 1, videoProgress: completedVideoProgress() }).percent, 100);
});

test('phase labels distinguish the two stages at the 80% boundary', () => {
  const denoise = advanceVideoProgress(preparingVideoProgress(), step('Denoising', 100));
  const decode = advanceVideoProgress(denoise, step('vae decode', 0));
  assert.equal(jobProgress({ ...job, videoProgress: denoise }).text, '80% overall · Denoising · 1 of 2');
  assert.equal(jobProgress({ ...job, videoProgress: decode }).text, '80% overall · VAE decode · 2 of 2');
});

test('late denoise reports and repeated or reset decode tile counters never rewind progress', () => {
  let state = advanceVideoProgress(preparingVideoProgress(), step('vae decode', 60));
  const expected = state;
  for (const next of [step('Denoising', 100), step('vae decode', 0), step('vae decode', 40), step('vae decode', 60), step('weights.safetensors', 100)]) {
    state = advanceVideoProgress(state, next);
    assert.deepEqual(state, expected);
  }
  assert.equal(advanceVideoProgress(finishingVideoProgress(), step('vae decode', 100)).phase, 'finishing');
  assert.equal(advanceVideoProgress(completedVideoProgress(), step('Denoising', 0)).percent, 100);
});

test('batched and interleaved subprocess output retains the furthest phase', () => {
  const text = [milestone('denoise', 100), milestone('vae decode', 50), milestone('denoise', 80), milestone('weights.safetensors', 0)].join('\r\n');
  const result = parseProgressLog(text, preparingVideoProgress());
  assert.deepEqual(result.videoProgress, { phase: 'decode', percent: 89, stagePercent: 50 });
  assert.deepEqual(result.step, step('weights.safetensors', 0));
  assert.equal(jobProgress({ ...job, ...result }).percent, 89);
});

test('stored progress survives a browser reload and later stage events', () => {
  const first = advanceVideoProgress(preparingVideoProgress(), step('Denoising', 100));
  const reloaded = JSON.parse(JSON.stringify({ ...job, videoProgress: first })) as Job;
  assert.equal(jobProgress(reloaded).percent, 80);
  assert.equal(advanceVideoProgress(reloaded.videoProgress!, step('vae decode', 0)).percent, 80);
});

test('existing jobs without combined metadata still map both native stage percentages', () => {
  assert.equal(jobProgress({ ...job, step: step('Denoising', 100) }).percent, 80);
  assert.equal(jobProgress({ ...job, step: step('vae decode', 0) }).percent, 80);
  assert.equal(jobProgress({ ...job, step: step('vae decode', 100) }).percent, 99);
  assert.equal(jobProgress({ ...job, step: null, message: 'Finishing video and saving audio…' }).percent, 99);
  assert.equal(jobProgress({ ...job, step: null, message: 'Video saved to favorites' }).percent, 99);
  assert.equal(jobProgress({ ...job, step: { current: 3, total: 8 } }).percent, 30);
});

test('preparation and unrelated model-loading percentages stay indeterminate', () => {
  const state = advanceVideoProgress(preparingVideoProgress(), step('model.safetensors', 100));
  assert.equal(state.phase, 'preparing');
  assert.equal(jobProgress({ ...job, videoProgress: state }).percent, undefined);
  assert.equal(jobProgress({ ...job, step: step('vae encode', 100) }).percent, undefined);
  assert.equal(jobProgress({ ...job, runner: 'comfyui', step: undefined }).percent, undefined);
  assert.equal(jobProgress({ ...job, status: 'queued', videoProgress: completedVideoProgress() }).percent, undefined);
});

test('invalid reports cannot corrupt a progress value', () => {
  const state = advanceVideoProgress(preparingVideoProgress(), step('Denoising', 40));
  for (const [current, total] of [[NaN, 100], [Infinity, 100], [40, Infinity], [40, 0], [-1, 100], [101, 100]]) {
    assert.deepEqual(advanceVideoProgress(state, step('vae decode', current, total)), state);
  }
  assert.equal(advanceVideoProgress(preparingVideoProgress(), step('VAE_decode', 0)).phase, 'decode');
});

test('images, setup and HD upscaling keep their native progress; reference video uses both stages', () => {
  const image = { ...job, request: { ...request, mode: 'image' as const }, step: step('Denoising', 50) };
  const hd = { ...job, request: { ...request, mode: 'upscale' as const }, step: step('AI upscaling', 50) };
  const setup = { ...job, kind: 'setup' as const, request: { task: 'video' }, step: step('model.safetensors', 50) };
  for (const item of [image, hd, setup]) {
    assert.equal(tracksVideoStages(item), false);
    assert.equal(jobProgress(item).percent, 50);
    assert.ok(!jobProgress(item).text.includes('overall'));
    assert.equal(parseProgressLog(milestone('denoise', 50)).videoProgress, undefined);
  }
  assert.equal(tracksVideoStages({ ...job, request: { ...request, mode: 'reference' } }), true);
});

test('failure or cancellation does not turn a decoded but unsaved video into 100%', () => {
  for (const status of ['failed', 'cancelled'] as const) {
    assert.equal(jobProgress({ ...job, status, videoProgress: finishingVideoProgress() }).percent, 99);
  }
});

test('overlay and shared queue progress bars display identical overall percentages and phase labels', () => {
  for (const progress of [advanceVideoProgress(preparingVideoProgress(), step('Denoising', 100)), advanceVideoProgress(preparingVideoProgress(), step('vae decode', 0)), finishingVideoProgress()]) {
    const input = { ...job, videoProgress: progress };
    const summary = jobProgress(input);
    for (const Component of [VideoProgress, JobProgressBar]) {
      const markup = renderToStaticMarkup(createElement(Component, { job: input }));
      assert.ok(markup.includes(`aria-valuenow="${summary.percent}"`));
      assert.ok(markup.includes(`aria-valuetext="${summary.text}"`));
      assert.ok(markup.includes(`width:${summary.percent}%`));
    }
  }
});
