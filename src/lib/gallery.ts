import type { Generation, Job, Media } from './types';
import { assetId, groupAssets } from './asset-groups';

export type GalleryEntry = { key: string; kind: 'media'; media: Media } | { key: string; kind: 'pending'; job: Job; index: number; aspect: string; state: 'generating' | 'queued' | 'loading' };

// Reserve a slot per output. A saved output replaces that same slot, even if API polls arrive out of order.
export function sessionGallery(media: Media[], jobs: Job[], sessionIds: string[]): GalleryEntry[] {
  const entries: GalleryEntry[] = [];
  for (const id of new Set(sessionIds)) {
    const job = jobs.find(j => j.id === id && j.kind === 'generate');
    const outputs = media.filter(m => m.jobId === id && m.origin !== 'poster' && m.origin !== 'upload')
      .sort((a, b) => (a.batchIndex ?? Infinity) - (b.batchIndex ?? Infinity) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const slots = new Map<number, Media>();
    for (const item of outputs) {
      let index = item.batchIndex ?? 0;
      while (slots.has(index)) index++;
      slots.set(index, item);
    }
    const active = job && ['running', 'queued'].includes(job.status);
    const total = active ? job.total : Math.max(0, ...[...slots.keys()].map(index => index + 1));
    const request = job?.request as Generation | undefined;
    const source = media.find(m => m.id === (request?.sourceId || request?.rootId));
    // An image being animated is the pending tile itself; never append an empty video block.
    if (active && (request?.mode === 'video' || request?.mode === 'reference' || request?.mode === 'upscale') && source && !slots.size) {
      const inImageBatch = source.jobId && sessionIds.includes(source.jobId) && !['poster', 'upload'].includes(source.origin);
      if (!inImageBatch && !entries.some(entry => entry.kind === 'media' && entry.media.id === source.id)) entries.push({ key: `anchor:${source.id}`, kind: 'media', media: source });
      continue;
    }
    const aspect = source ? `${source.width} / ${source.height}` : request?.aspect.replace(':', ' / ') || '1 / 1';
    for (let index = 0; index < total; index++) {
      const item = slots.get(index), key = `${id}:${index}`;
      if (item) entries.push({ key, kind: 'media', media: item });
      else if (active) entries.push({ key, kind: 'pending', job, index, aspect,
        state: index < job.completed ? 'loading' : job.status === 'running' && index === job.completed ? 'generating' : 'queued' });
    }
  }
  const latest = new Map(groupAssets(media).map(item => [assetId(item), item])), shown = new Set<string>();
  return entries.flatMap<GalleryEntry>(entry => {
    if (entry.kind === 'pending') return [entry];
    const id = assetId(entry.media);
    if (shown.has(id)) return [];
    shown.add(id); return [{ ...entry, media: latest.get(id) || entry.media }];
  });
}
