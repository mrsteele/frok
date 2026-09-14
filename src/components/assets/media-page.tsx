'use client';
import { useCallback, useEffect, useState, type ComponentProps } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import type { Media, MediaFamily } from '@/lib/types';
import { api } from '@/lib/client-api';
import { MediaViewer } from './media-viewer';
import { assetPath, mediaPath } from '@/lib/navigation';

export function MediaPage({
  id,
  legacy,
  renderNumber,
  ...props
}: { id: string; legacy?: boolean; renderNumber: number } & Omit<
  ComponentProps<typeof MediaViewer>,
  'initialMedia' | 'onSelect' | 'renderNumber'
>) {
  const router = useRouter();
  const onSelect = useCallback(
    (item: Media, options?: { replace?: boolean }) => {
      const path = mediaPath(item);
      if (window.location.pathname !== path) {
        if (options?.replace) router.replace(path, { scroll: false });
        else router.push(path, { scroll: false });
      }
    },
    [router],
  );
  const [media, setMedia] = useState<Media>(),
    [error, setError] = useState(''),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let closed = false;
    api<MediaFamily>(`media/${id}/family`)
      .then((result) => {
        if (closed) return;
        const target =
          result.root.id === id
            ? result.root
            : result.legacyRootIds?.includes(id)
              ? result.renders.find((render) => render.media.assetNumber === renderNumber)?.media ||
                result.root
              : result.renders.find((render) => render.media.id === id || render.hd?.id === id)
                  ?.media;
        if (!target) throw Error('This creation is no longer available.');
        if (legacy || result.root.id !== id) {
          router.replace(mediaPath(target), { scroll: false });
          return;
        }
        setMedia(result.root);
      })
      .catch((e) => {
        if (!closed) setError(e.message);
      });
    return () => {
      closed = true;
    };
  }, [id, attempt, legacy, renderNumber, router]);
  useEffect(() => {
    if (!legacy && renderNumber === 1 && window.location.pathname.endsWith('/1'))
      router.replace(assetPath(id), { scroll: false });
  }, [id, legacy, renderNumber, router]);
  if (error)
    return (
      <div className="route-empty">
        <h2>This creation is unavailable</h2>
        <p role="alert">{error}</p>
        <button
          className="secondary"
          onClick={() => {
            setError('');
            setAttempt((value) => value + 1);
          }}
        >
          Try again
        </button>
      </div>
    );
  if (!media)
    return (
      <div className="route-empty" role="status">
        <Loader2 size={22} className="spin" />
        Loading creation…
      </div>
    );
  return (
    <MediaViewer initialMedia={media} renderNumber={renderNumber} onSelect={onSelect} {...props} />
  );
}
