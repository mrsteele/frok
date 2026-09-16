'use client';
import { useRef } from 'react';
import Link from 'next/link';
import { Clock3, Film, Heart, Loader2, Trash2 } from 'lucide-react';
import type { Job, Media } from '@/lib/types';
import { mediaUrl } from '@/lib/types';
import { VideoProgress } from '@/components/queue/video-progress';

export function AssetCard({
  item,
  animation,
  queued = 0,
  submitting,
  queueing = false,
  saving,
  href,
  onFavorite,
  onDelete,
  onAnimate,
}: {
  item: Media;
  animation?: Job;
  queued?: number;
  submitting: boolean;
  queueing?: boolean;
  saving: boolean;
  href: string;
  onFavorite: () => void;
  onDelete: () => void;
  onAnimate: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  function play() {
    if (video.current) {
      video.current.muted = true;
      void video.current.play().catch(() => {});
    }
  }
  function resetPreview() {
    const player = video.current;
    if (player) {
      player.pause();
      player.currentTime = 0;
    }
  }
  return (
    <article
      className="media-card"
      aria-busy={!!animation || queueing}
      onMouseEnter={play}
      onMouseLeave={resetPreview}
      onFocus={play}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) resetPreview();
      }}
    >
      <Link
        className="media-open"
        style={{ aspectRatio: `${item.width}/${item.height}` }}
        href={href}
        aria-label={`Open ${item.kind}: ${item.prompt || 'Saved creation'}`}
      >
        {item.kind === 'image' ? (
          <img
            src={mediaUrl(item.id)}
            alt={animation ? 'Image being animated' : item.prompt || 'Saved image'}
            loading="lazy"
          />
        ) : (
          <video
            ref={video}
            muted
            key={item.id}
            src={mediaUrl(item.id)}
            loop
            playsInline
            preload="metadata"
          />
        )}
        <span className="card-gradient" />
        <span className="card-prompt">{item.prompt}</span>
        {animation && <VideoProgress job={animation} queued={Math.max(0, queued)} />}
      </Link>
      <button
        className="card-delete"
        onClick={onDelete}
        title="Delete creation"
        aria-label="Delete creation"
      >
        <Trash2 size={15} />
      </button>
      <button
        className={`heart-button ${item.favorite ? 'saved' : ''}`}
        disabled={saving}
        onClick={onFavorite}
        aria-label={item.favorite ? 'Remove creation from favorites' : 'Add creation to favorites'}
        aria-pressed={item.favorite}
      >
        <Heart size={16} fill={item.favorite ? 'currentColor' : 'none'} />
      </button>
      {item.kind === 'image' ? (
        <button
          type="button"
          className="animate-button"
          disabled={submitting || queueing}
          aria-busy={queueing || undefined}
          onClick={onAnimate}
          title={animation ? 'View video progress' : 'Queue a video using your default motion recipe'}
          aria-label={queueing ? 'Queuing video' : animation ? 'View video progress' : 'Generate video'}
        >
          {queueing ? <Loader2 size={16} className="spin" /> : animation ? (
            animation.status === 'running' ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Clock3 size={16} />
            )
          ) : (
            <Film size={16} />
          )}
          <span>{queueing ? 'Queuing…' : animation ? 'View progress' : 'Generate video'}</span>
        </button>
      ) : (
        <span className="media-badge">
          <Film size={13} />
          {item.duration?.toFixed(0)}s{Math.min(item.width, item.height) >= 720 && <b>HD</b>}
        </span>
      )}
    </article>
  );
}
