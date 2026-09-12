export type VideoPlayback = { currentTime: number; paused: boolean; playbackRate: number };
type Player = Pick<HTMLVideoElement, 'currentTime' | 'paused' | 'playbackRate' | 'readyState' | 'seeking'>;

export function captureVideoPlayback(player: Player | null, pending?: VideoPlayback): VideoPlayback | undefined {
  // Rapid SD/HD switches can happen before the new source has loaded or sought.
  // Keep the intended position and play state instead of capturing its defaults.
  if (!player || player.readyState < 1) return pending;
  if (player.seeking && pending) return pending;
  return { currentTime: player.currentTime, paused: player.paused, playbackRate: player.playbackRate };
}

export function restoreVideoPlayback(player: Pick<HTMLVideoElement, 'currentTime' | 'duration' | 'playbackRate' | 'pause' | 'play'>, playback: VideoPlayback) {
  const end = Number.isFinite(player.duration) ? player.duration : Infinity;
  player.currentTime = Math.max(0, Math.min(playback.currentTime, end));
  player.playbackRate = playback.playbackRate;
  if (playback.paused) player.pause();
  else void player.play().catch(() => {}); // Native controls remain usable if autoplay is blocked.
}
