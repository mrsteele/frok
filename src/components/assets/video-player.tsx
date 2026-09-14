'use client';
import {
  useCallback,
  useLayoutEffect,
  useRef,
  type RefObject,
  type VideoHTMLAttributes,
} from 'react';
import { connectVideoAudio } from '@/lib/video-audio';
import { restoreVideoPlayback, type VideoPlayback } from '@/lib/video-playback';

type Props = Omit<VideoHTMLAttributes<HTMLVideoElement>, 'muted'> & {
  videoRef?: RefObject<HTMLVideoElement | null>;
  resumeFrom?: VideoPlayback;
  active?: boolean;
};

export function VideoPlayer({
  videoRef,
  autoPlay,
  resumeFrom,
  active = true,
  onLoadedMetadata,
  ...props
}: Props) {
  const player = useRef<HTMLVideoElement | null>(null);
  const attach = useCallback(
    (video: HTMLVideoElement | null) => {
      player.current = video;
      if (videoRef) videoRef.current = video;
      return () => {
        player.current = null;
        if (videoRef) videoRef.current = null;
      };
    },
    [videoRef],
  );
  const start = useCallback(
    (video: HTMLVideoElement) => {
      if (!active) return;
      if (resumeFrom) {
        if (video.readyState >= 1) restoreVideoPlayback(video, resumeFrom);
      } else if (autoPlay) void video.play().catch(() => {});
    },
    [active, autoPlay, resumeFrom],
  );
  useLayoutEffect(() => {
    const video = player.current;
    if (!video) return;
    if (!active) {
      video.pause();
      video.muted = true;
      return;
    }
    const disconnect = connectVideoAudio(video);
    start(video);
    return () => {
      // Save the user's actual audio choice before silencing the hidden player.
      disconnect();
      video.pause();
      video.muted = true;
    };
  }, [active, start, props.src]);
  return (
    <video
      {...props}
      ref={attach}
      muted
      autoPlay={false}
      onLoadedMetadata={(event) => {
        start(event.currentTarget);
        onLoadedMetadata?.(event);
      }}
    />
  );
}
