import type { Job, SetupRequest } from './types';

export function isPreparationJob(job:Job) {
  const request=job.request as SetupRequest;
  return job.kind==='setup'&&request.task==='builtin-preparation'&&typeof request.preparation==='string';
}
