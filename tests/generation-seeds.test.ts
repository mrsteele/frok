import test from 'node:test';
import assert from 'node:assert/strict';
import { generationSeeds } from '../src/lib/generation-seeds';

test('an explicit seed remains reproducible while every image in the batch differs', () => {
  assert.deepEqual(generationSeeds(4, 42), [42, 43, 44, 45]);
  assert.deepEqual(generationSeeds(4, 42), generationSeeds(4, 42));
  assert.deepEqual(generationSeeds(1, 0), [0]);
});

test('seeds wrap inside the supported range without duplicates', () => {
  assert.deepEqual(generationSeeds(4, 2147483646), [2147483646, 2147483647, 0, 1]);
});

test('random collisions cannot produce duplicate seeds or hang batch planning', () => {
  assert.deepEqual(generationSeeds(4, undefined, () => 2147483647), [2147483647, 0, 1, 2]);
});

test('default random batches use distinct valid seeds', () => {
  const seeds = generationSeeds(12);
  assert.equal(new Set(seeds).size, 12);
  assert.ok(seeds.every(seed => Number.isInteger(seed) && seed >= 0 && seed <= 2147483647));
});
