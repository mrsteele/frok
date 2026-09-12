import test from 'node:test';
import assert from 'node:assert/strict';
import { createVideoAudioStore } from '../src/lib/video-audio';

// Like a media element, changes enqueue events rather than firing synchronously.
class Player extends EventTarget {
  private mute = false;
  private level = 1;
  get muted() { return this.mute; }
  set muted(value: boolean) { if (this.mute !== value) { this.mute = value; this.changed(); } }
  get volume() { return this.level; }
  set volume(value: number) { if (this.level !== value) { this.level = value; this.changed(); } }
  private changed() { queueMicrotask(() => this.dispatchEvent(new Event('volumechange'))); }
}
const settled = () => new Promise<void>(resolve => setImmediate(resolve));
const audio = (player: Player) => ({ muted: player.muted, volume: player.volume });
function fixture(initial: string | null = null) {
  let raw = initial, writes = 0;
  const storage = { read: () => raw, write: (value: string) => { raw = value; writes++; } };
  return { store: createVideoAudioStore(storage), storage, saved: () => raw, writes: () => writes, replace: (value: string | null) => { raw = value; } };
}

test('mute and volume sync with existing players, newly loaded videos, and a new page', async () => {
  const f = fixture();
  const first = new Player(), second = new Player();
  const disconnect = f.store.connect(first); f.store.connect(second);
  await settled();
  assert.deepEqual(audio(first), { muted: true, volume: 1 });
  assert.equal(f.writes(), 0); // Mounting must not overwrite a saved choice.
  first.volume = .28; first.muted = false;
  await settled();
  assert.deepEqual(audio(second), { muted: false, volume: .28 });
  assert.equal(f.writes(), 1); // Programmatic changes in peers do not echo.
  second.muted = true;
  await settled();
  assert.deepEqual(audio(first), { muted: true, volume: .28 });
  disconnect();
  const next = new Player(); f.store.connect(next);
  assert.deepEqual(audio(next), { muted: true, volume: .28 });
  const reloaded = new Player(); createVideoAudioStore(f.storage).connect(reloaded);
  assert.deepEqual(audio(reloaded), audio(next));
  reloaded.muted = false;
  await settled();
  assert.equal(reloaded.volume, .28);
});

test('zero volume stays zero independently of mute', async () => {
  const f = fixture(JSON.stringify({ muted: false, volume: 0 }));
  const first = new Player(), next = new Player(); f.store.connect(first);
  await settled();
  assert.deepEqual(audio(first), { muted: false, volume: 0 });
  first.muted = true; await settled(); first.muted = false; await settled();
  f.store.connect(next);
  assert.deepEqual(audio(next), { muted: false, volume: 0 });
});

test('another tab can update or clear preferences without generating write loops', async () => {
  const f = fixture(); const first = new Player(), second = new Player();
  f.store.connect(first); f.store.connect(second); await settled();
  f.replace(JSON.stringify({ muted: false, volume: .63 })); f.store.restore(); await settled();
  assert.deepEqual(audio(first), { muted: false, volume: .63 });
  assert.deepEqual(audio(second), audio(first)); assert.equal(f.writes(), 0);
  f.replace(null); f.store.restore(); await settled();
  assert.deepEqual(audio(first), { muted: true, volume: 1 }); assert.equal(f.writes(), 0);
});

test('closing a video saves its final controls before a delayed event, then removes listeners', async () => {
  const f = fixture(); const player = new Player(); const disconnect = f.store.connect(player);
  await settled(); player.volume = .42; player.muted = false; disconnect();
  const next = new Player(); f.store.connect(next); await settled();
  assert.deepEqual(audio(next), { muted: false, volume: .42 });
  const saved = f.saved(); player.volume = .9; await settled();
  assert.equal(f.saved(), saved); assert.equal(next.volume, .42);
});

test('blocked storage still shares controls within the page', async () => {
  const store = createVideoAudioStore({ read: () => { throw new Error('Storage blocked'); }, write: () => { throw new Error('Storage blocked'); } });
  const first = new Player(); store.connect(first); await settled();
  first.volume = .37; first.muted = false; await settled(); store.restore();
  const next = new Player(); store.connect(next);
  assert.deepEqual(audio(next), { muted: false, volume: .37 });
});

test('invalid preferences fall back safely and numeric levels are bounded', async () => {
  for (const raw of ['bad json', 'null', '{}', '{"muted":true,"volume":"0.5"}']) {
    const f = fixture(raw); const player = new Player(); f.store.connect(player); await settled();
    assert.deepEqual(audio(player), { muted: true, volume: 1 }); assert.equal(f.writes(), 0);
  }
  for (const [volume, expected] of [[-1, 0], [2, 1]]) {
    const f = fixture(JSON.stringify({ muted: false, volume })); const player = new Player(); f.store.connect(player);
    assert.equal(player.volume, expected);
  }
});
