import { readInterfacePreference, writeInterfacePreference, subscribeInterfacePreferences } from './client-preferences';
export type VideoAudio = { muted: boolean; volume: number };
export const videoAudioKey = 'frok-video-audio';
const defaults: VideoAudio = { muted: true, volume: 1 };
type Player = Pick<HTMLMediaElement, 'muted' | 'volume' | 'addEventListener' | 'removeEventListener'>;

function decode(raw: string | null): VideoAudio {
  try {
    const value = raw === null ? null : JSON.parse(raw);
    if (typeof value?.muted !== 'boolean' || typeof value?.volume !== 'number' || !Number.isFinite(value.volume)) return { ...defaults };
    return { muted: value.muted, volume: Math.min(1, Math.max(0, value.volume)) };
  } catch { return { ...defaults }; }
}
const same = (a: VideoAudio, b: VideoAudio) => a.muted === b.muted && a.volume === b.volume;

// Native volumechange events also fire asynchronously for programmatic updates.
// Comparing with shared state prevents those updates from saving or echoing back.
export function createVideoAudioStore(storage: { read: () => string | null | undefined; write: (raw: string) => void }) {
  let state = { ...defaults };
  const players = new Set<Player>();
  function apply(player: Player) {
    if (player.volume !== state.volume) player.volume = state.volume;
    if (player.muted !== state.muted) player.muted = state.muted;
  }
  function restore() {
    try {
      const raw = storage.read();
      if (raw === undefined) return; // Unavailable storage keeps the current session preference.
      state = decode(raw);
      players.forEach(apply);
    } catch { /* Private browsing can deny storage access. */ }
  }
  restore();
  return {
    restore,
    connect(player: Player) {
      players.add(player);
      apply(player);
      const changed = () => {
        const next = { muted: player.muted, volume: player.volume };
        if (same(state, next)) return;
        state = next;
        try { storage.write(JSON.stringify(state)); } catch { /* Still sync within this page. */ }
        players.forEach(apply);
      };
      player.addEventListener('volumechange', changed);
      return () => { changed(); players.delete(player); player.removeEventListener('volumechange', changed); };
    },
  };
}

let shared: ReturnType<typeof createVideoAudioStore> | undefined;
export function connectVideoAudio(player: HTMLVideoElement) {
  if (!shared) {
    shared = createVideoAudioStore({
      read: () => readInterfacePreference(videoAudioKey),
      write: raw => { void writeInterfacePreference(videoAudioKey, raw).catch(() => {}); },
    });
    subscribeInterfacePreferences(() => shared?.restore());
  }
  return shared.connect(player);
}
