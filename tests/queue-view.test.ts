import test from 'node:test';
import assert from 'node:assert/strict';
import { queueView } from '../src/lib/queue-view';
import { sessionGallery } from '../src/lib/gallery';
import type { Generation, Job, Media } from '../src/lib/types';

const request: Generation = { mode: 'image', prompt: 'Synthetic paper boat', aspect: '1:1', duration: 6, quality: 'preview', count: 4, enhance: false, referenceIds: [] };
const job = (id: string, status: Job['status'], patch: Partial<Job> = {}): Job => ({ id, status, kind: 'generate', request, runner: 'vpipe', completed: 0, total: 4, message: '', createdAt: '2026-01-01', updatedAt: '2026-01-01', ...patch });

test('cancelled jobs never appear as unfinished, failed or completed, even with a legacy error', () => {
  const cancelled = job('cancelled', 'cancelled', { error: 'Cancelled', completed: 1 });
  const input = [cancelled, job('queued', 'queued'), job('running', 'running'), job('failed', 'failed'), job('complete', 'completed')];
  const view = queueView(input);
  assert.deepEqual(view.unfinished.map(item => item.id), ['running', 'queued', 'failed']);
  assert.deepEqual(view.failed.map(item => item.id), ['failed']);
  assert.deepEqual(view.completed.map(item => item.id), ['complete']);
  assert.equal(view.running?.id, 'running');
  assert.deepEqual(view.pending.map(item => item.id), ['queued']);
  assert.deepEqual(view.cancelled.map(item=>item.id), ['cancelled']);
  assert.equal(input[0], cancelled); // UI filtering does not discard the job's history.
});

test('cancelled jobs stay reviewable without contributing to active or failed counts', () => {
  const view = queueView([job('cancelled', 'cancelled'), job('dismissed', 'failed', { dismissedAt: '2026-01-02' })]);
  for (const group of [view.active, view.pending, view.failed, view.completed, view.unfinished]) assert.equal(group.length, 0);
  assert.equal(view.running, undefined);
  assert.deepEqual(view.cancelled.map(item=>item.id), ['cancelled']);
});

test('cancelling a batch removes queued tiles but keeps every saved output', () => {
  const batch = job('batch', 'cancelled', { completed: 1 });
  const image: Media = { id: 'saved', jobId: batch.id, batchIndex: 0, kind: 'image', filename: 'unused.jpg', prompt: request.prompt, enhancedPrompt: request.prompt, width: 512, height: 512, seed: 1, favorite: true, createdAt: '2026-01-01', origin: 'generated' };
  assert.equal(queueView([batch]).unfinished.length, 0);
  const gallery = sessionGallery([image], [batch], [batch.id]);
  assert.equal(gallery.length, 1);
  assert.ok(gallery[0].kind === 'media' && gallery[0].media.id === image.id && gallery[0].media.favorite);
});
