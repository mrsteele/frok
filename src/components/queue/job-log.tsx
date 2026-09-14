'use client';
import { useEffect, useState } from 'react';
import type { Job } from '@/lib/types';
import { api } from '@/lib/client-api';

export function JobLog({
  id,
  renderJob,
}: {
  id: string;
  renderJob: (job: Job) => React.ReactNode;
}) {
  const [job, setJob] = useState<Job>(),
    [log, setLog] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    let closed = false,
      timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const [details, output] = await Promise.all([
          api<{ job: Job }>(`jobs/${id}`),
          api<{ log: string }>(`jobs/${id}/log`),
        ]);
        if (closed) return;
        setJob(details.job);
        setLog(output.log);
        setError('');
      } catch (e) {
        if (!closed) {
          const message = (e as Error).message;
          if (message === 'Job not found') {
            setJob(undefined);
            setLog('');
            setError('This job was deleted or expired. Saved media remains in your library.');
          } else setError(message);
        }
      }
      if (!closed) timer = setTimeout(() => void refresh(), 2500);
    }
    void refresh();
    return () => {
      closed = true;
      clearTimeout(timer);
    };
  }, [id]);
  return (
    <div className="job-log">
      {job && renderJob(job)}
      {error && (
        <p role="alert" className="viewer-error">
          {error}
        </p>
      )}
      {!job && !error && (
        <p role="status" className="muted">
          Loading job…
        </p>
      )}
      <p className="muted">Live output · most recent 16 KB</p>
      <pre aria-label="Runner output">{log || (job ? 'No runner output yet.' : '')}</pre>
    </div>
  );
}
