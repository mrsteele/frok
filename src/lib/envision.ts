import { assetId, groupAssets } from './asset-groups';
import { sessionGallery, type GalleryEntry } from './gallery';
import type { Generation, Job, Media } from './types';

export type PromptSection = {
  id: string; sourceId?: string; prompt: string; createdAt: string;
  jobIds: string[]; request?: Generation;
};
export function sectionRequest(section: PromptSection): Generation {
  if (!section.request) throw Error('Open this image to choose how it should move.');
  return { ...structuredClone(section.request), sectionId: section.id, seed: undefined };
}
export function promptGallery(sections: PromptSection[], media: Media[], jobs: Job[]) {
  const seen = new Set<string>();
  return sections.map(section => {
    const entries = sessionGallery(media, jobs, section.jobIds).filter(entry => {
      if (entry.kind === 'pending') return true;
      const root = assetId(entry.media);
      if (seen.has(root)) return false;
      seen.add(root); return true;
    });
    // Uploads and older outputs without job records are still library assets.
    const members = media.filter(item => item.sectionId === section.id);
    for (const item of groupAssets(members).reverse()) {
      const root = assetId(item);
      if (!seen.has(root)) { seen.add(root); entries.push({key: root, kind: 'media', media: item}); }
    }
    return { ...section, entries, active: jobs.filter(job => section.jobIds.includes(job.id) && ['queued','running'].includes(job.status)) };
  });
}
export type PromptGallerySection = PromptSection & { entries: GalleryEntry[]; active: Job[] };
