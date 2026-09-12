"use client";
import { useEffect, useState, type ReactNode } from 'react';
import { ChevronRight, Clock3, Loader2 } from 'lucide-react';
import type { GalleryEntry } from '@/lib/gallery';
import type { Generation } from '@/lib/types';

function useImagePreview(jobId: string, index: number, enabled: boolean) {
  const key = `${jobId}:${index}`;
  const [frame, setFrame] = useState<{ key: string; url: string }>();
  useEffect(() => {
    setFrame(undefined);
    if (!enabled) return;
    const controller = new AbortController(), urls = new Set<string>();
    let stopped = false, etag = '', timer: ReturnType<typeof setTimeout> | undefined;
    async function poll() {
      let candidate: string | undefined;
      try {
        const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/preview?index=${index}`, {
          signal: controller.signal, cache: 'no-store', headers: etag ? { 'If-None-Match': etag } : {},
        });
        if (response.status === 200 && response.headers.get('content-type')?.startsWith('image/jpeg')) {
          const blob = await response.blob();
          if (stopped) return;
          candidate = URL.createObjectURL(blob); urls.add(candidate);
          const image = new Image(); image.src = candidate;
          await image.decode();
          if (stopped) { URL.revokeObjectURL(candidate); return; }
          etag = response.headers.get('etag') || '';
          setFrame({ key, url: candidate });
          // Keep the previous frame alive until React has swapped the image.
          while (urls.size > 2) { const old = urls.values().next().value!; URL.revokeObjectURL(old); urls.delete(old); }
        }
      } catch {
        if (candidate) { URL.revokeObjectURL(candidate); urls.delete(candidate); }
        // Incomplete frames and transient network errors keep the last good image.
      } finally { if (!stopped) timer = setTimeout(() => void poll(), 1200); }
    }
    void poll();
    return () => { stopped = true; controller.abort(); clearTimeout(timer); urls.forEach(url => URL.revokeObjectURL(url)); };
  }, [jobId, index, key, enabled]);
  return enabled && frame?.key === key ? frame.url : undefined;
}

export function PendingCard({ entry, onQueue, children }: { entry: Extract<GalleryEntry, { kind: 'pending' }>; onQueue: () => void; children?: ReactNode }) {
  const image = (entry.job.request as Generation).mode === 'image';
  const generating = entry.state === 'generating';
  const preview = useImagePreview(entry.job.id, entry.index, generating && image && entry.job.runner === 'vpipe');
  const step = entry.job.step;
  const percent = generating && step && step.total > 0 ? Math.max(0, Math.min(100, Math.round(step.current / step.total * 100))) : undefined;
  return <article className={`media-card pending-card ${entry.state} ${preview ? 'has-live-preview' : ''}`} style={{ aspectRatio: entry.aspect }} aria-label={`${image ? 'Image' : 'Video'} ${entry.index + 1} of ${entry.job.total}: ${entry.state}`} aria-busy="true">
    {preview && <><img className="pending-preview-image" src={preview} alt={`Live preview of image ${entry.index + 1} taking shape`}/><div className="pending-preview-shade"/><span className="live-preview-badge">Live preview</span></>}
    <div className="pending-content">
      {!preview && (generating ? <Loader2 size={23} className="spin"/> : entry.state === 'loading' ? <Loader2 size={21} className="spin"/> : <Clock3 size={21}/>)}
      <strong>{generating ? `Generating${percent === undefined ? '' : ` · ${percent}%`}` : entry.state === 'loading' ? 'Loading image…' : 'Queued'}</strong>
      <small>{image ? `Image ${entry.index + 1} of ${entry.job.total}` : 'Video'}</small>
      <button onClick={onQueue}>View queue <ChevronRight size={12}/></button>
    </div>
    {children}
  </article>;
}
