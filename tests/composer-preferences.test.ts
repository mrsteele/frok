import test from 'node:test';
import assert from 'node:assert/strict';
import { freshComposer, readComposerPreferences, writeComposerPreferences } from '../src/lib/composer-preferences';

test('legacy composer preferences retain four images and enhancement without restoring private drafts', () => {
  const request = freshComposer(JSON.stringify({
    mode: 'image', aspect: '3:4', quality: 'standard', count: 4, duration: 8, enhance: true, seed: 0,
    prompt: 'Private draft', sourceId: 'old-image', referenceIds: ['old-reference'],
    videoPresetPrompt: 'Old recipe', ollamaModel: 'previous-model',
  }));
  assert.deepEqual(request, {
    mode: 'image', aspect: '3:4', quality: 'standard', count: 4, duration: 8, enhance: true, seed: 0,
    prompt: '', referenceIds: [],
  });
  assert.deepEqual(freshComposer(writeComposerPreferences(request)), request);
});

test('only reusable generation controls are written, including video choices and random seed', () => {
  const request = { ...freshComposer(), mode: 'video' as const, duration: 10 as const,
    count: 4, aspect: '16:9' as const, quality: 'standard' as const, enhance: true,
    prompt: 'Another private draft', sourceId: 'image', referenceIds: ['reference'],
    fromVideoId: 'video', ollamaModel: 'writer',
  };
  const saved = writeComposerPreferences(request);
  assert.deepEqual(JSON.parse(saved), {
    mode: 'video', aspect: '16:9', quality: 'standard', count: 4, duration: 10, enhance: true,
  });
  assert.equal(freshComposer(saved).seed, undefined);
  assert.equal(freshComposer(saved).sourceId, undefined);
  assert.equal(freshComposer(saved).prompt, '');
});

test('damaged storage falls back safely without discarding other valid preferences', () => {
  const defaults = readComposerPreferences(null);
  for (const value of ['{broken', 'null', '[]', 'false', '123', '"text"']) {
    assert.deepEqual(readComposerPreferences(value), defaults);
  }
  assert.deepEqual(readComposerPreferences(JSON.stringify({
    count: 4, enhance: true, mode: 'upscale', aspect: 'bad', quality: 'bad', duration: -1, seed: -1,
  })), { ...defaults, count: 4, enhance: true, seed: undefined });
});
