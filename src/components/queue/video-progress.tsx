import { Clock3, Loader2 } from 'lucide-react';
import type { Job } from '@/lib/types';
import { jobProgress } from '@/lib/progress';

export function VideoProgress({ job, queued = 0 }: { job: Job; queued?: number }) {
  const progress = jobProgress(job);
  const percent = progress.percent;
  return (
    <span
      className={`video-progress-overlay ${job.status === 'running' ? 'is-rendering' : 'is-queued'}`}
      role="status"
      aria-label={progress.text}
    >
      <span className="video-progress-sweep" />
      <span className="video-progress-label">
        {job.status === 'running' ? <Loader2 size={22} className="spin" /> : <Clock3 size={22} />}
        <strong>
          {percent !== undefined
            ? `${percent}%`
            : job.status === 'queued'
              ? 'Queued'
              : /finishing|saving/i.test(job.message)
                ? 'Finishing video'
                : 'Preparing video'}
        </strong>
        <small>
          {job.status === 'queued'
            ? 'Waiting to render video'
            : progress.label || 'Waiting for runner progress'}
        </small>
        {queued > 0 && <small>+{queued} queued</small>}
      </span>
      {percent !== undefined && (
        <span
          className="video-progress-track"
          role="progressbar"
          aria-label="Overall video progress"
          aria-valuetext={progress.text}
          title={progress.hint}
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${percent}%` }} />
        </span>
      )}
    </span>
  );
}
