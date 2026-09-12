import type { Job } from './types';

// Cancellation remains reviewable without adding a failure or active queue count.
export function queueView(jobs: Job[]) {
  const visible = jobs.filter(job => !job.dismissedAt);
  const active = visible.filter(job => job.status === 'running' || job.status === 'queued')
    .sort((a, b) => Number(b.status === 'running') - Number(a.status === 'running') || (a.queuePosition ?? Date.parse(a.createdAt)) - (b.queuePosition ?? Date.parse(b.createdAt)) || a.id.localeCompare(b.id));
  const failed = visible.filter(job => job.status === 'failed');
  const completed = visible.filter(job => job.status === 'completed');
  const cancelled = visible.filter(job => job.status === 'cancelled');
  return { active, running: active.find(job => job.status === 'running'),
    pending: active.filter(job => job.status === 'queued'), failed, completed, cancelled,
    unfinished: [...active, ...failed] };
}
