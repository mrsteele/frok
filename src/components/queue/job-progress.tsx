import { jobProgress } from '@/lib/progress';
import type { Job } from '@/lib/types';

export function JobProgressBar({ job }: { job: Job }) {
  const progress = jobProgress(job);
  const known = progress.percent !== undefined;
  return (
    <div
      className={`job-progress ${known ? '' : 'indeterminate'}`}
      role="progressbar"
      aria-label="Generation progress"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={progress.percent}
      aria-valuetext={progress.text}
      title={progress.hint}
    >
      <span style={known ? { width: `${progress.percent}%` } : undefined} />
    </div>
  );
}
