import test from 'node:test';
import assert from 'node:assert/strict';
import { captureVideoPlayback, restoreVideoPlayback } from '../src/lib/video-playback';

function player(overrides = {}) {
  return { currentTime: 0, duration: 6, paused: true, playbackRate: 1, readyState: 1, seeking: false,
    pause() { this.paused = true; }, async play() { this.paused = false; }, ...overrides };
}

test('switching versions preserves the same moment, pause state, and speed', () => {
  for (const paused of [true, false]) {
    const sd = player({ currentTime: 3.25, paused, playbackRate: .5 });
    const hd = player();
    restoreVideoPlayback(hd, captureVideoPlayback(sd)!);
    assert.equal(hd.currentTime, 3.25);
    assert.equal(hd.paused, paused);
    assert.equal(hd.playbackRate, .5);
  }
});

test('rapid switches retain the pending seek and playback intent until the new source is ready', () => {
  const pending = { currentTime: 4.5, paused: false, playbackRate: 1.5 };
  assert.deepEqual(captureVideoPlayback(null, pending), pending);
  assert.deepEqual(captureVideoPlayback(player({ readyState: 0 }), pending), pending);
  assert.deepEqual(captureVideoPlayback(player({ seeking: true }), pending), pending);
  assert.deepEqual(captureVideoPlayback(player({ currentTime: 5, paused: true }), pending), { currentTime: 5, paused: true, playbackRate: 1 });
  assert.deepEqual(captureVideoPlayback(player({currentTime: 2, paused: true, seeking: true})), {currentTime: 2, paused: true, playbackRate: 1});
  assert.equal(captureVideoPlayback(null), undefined);
});

test('a slightly shorter enhanced encode clamps the saved position to its duration', () => {
  const hd = player({ duration: 5.96 });
  restoreVideoPlayback(hd, { currentTime: 6, paused: true, playbackRate: 1 });
  assert.equal(hd.currentTime, 5.96);
  assert.equal(hd.paused, true);
});

test('blocked autoplay leaves a seeked, paused video without an unhandled rejection', async () => {
  const hd = player({ play: async () => { throw new Error('Autoplay blocked'); } });
  restoreVideoPlayback(hd, { currentTime: 2.5, paused: false, playbackRate: 1 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(hd.currentTime, 2.5);
  assert.equal(hd.paused, true);
});
