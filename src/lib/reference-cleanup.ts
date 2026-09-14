import type { Generation, Job, Media } from './types';
import { retentionDefaults } from '../../desktop/preferences.mjs';

export const mediaInputs = (item: Media) => [item.sourceId, item.rootId, item.generation?.sourceId, item.generation?.rootId, ...(item.generation?.referenceIds || [])].filter((id): id is string => !!id && id !== item.id);
export const jobInputs = (job: Job) => {
  if (job.kind !== 'generate') return [];
  const request = job.request as Generation;
  return [request.sourceId, request.rootId, ...request.referenceIds].filter((id): id is string => !!id);
};

export function unusedReferences(all: Media[], jobs: Job[], removed: Media[] = [], jobIds: string[] = [], candidates?: Set<string>) {
  const deleted = new Set(removed.map(item => item.id)), deletedJobs = new Set(jobIds);
  const used = new Set([
    ...all.filter(item => !deleted.has(item.id)).flatMap(mediaInputs),
    // Failed and cancelled jobs still need their inputs for Retry.
    ...jobs.filter(job => !deletedJobs.has(job.id)).flatMap(jobInputs),
  ]);
  return all.filter(item => item.kind === 'image' && item.origin === 'upload' && item.referenceOnly && !deleted.has(item.id) && !used.has(item.id) && (!candidates || candidates.has(item.id)));
}

export function referencesReleasedByDeletion(all: Media[], jobs: Job[], removed: Media[], jobIds: string[]) {
  const deletedJobs = new Set(jobIds);
  // Only consider inputs owned by this deletion. A different upload may still
  // be between the upload request and queuing its first generation.
  const candidates = new Set([...removed.flatMap(mediaInputs), ...jobs.filter(job => deletedJobs.has(job.id)).flatMap(jobInputs)]);
  return unusedReferences(all, jobs, removed, jobIds, candidates);
}

// References uploaded by an abandoned/failed submission have no job to own
// their cleanup. Give retries a grace period; ordinary uploaded root images stay.
export const abandonedReferenceAge = retentionDefaults.referenceUploadHours * 3_600_000;
export function abandonedReferences(all: Media[], jobs: Job[], now: number) {
  return unusedReferences(all, jobs).filter(item => Date.parse(item.createdAt) <= now - abandonedReferenceAge);
}
