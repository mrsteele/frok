'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Layers3 } from 'lucide-react';
import { api } from '@/lib/client-api';
import type { Job } from '@/lib/types';

const statusLabels: Record<Job['status'], string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export function AssetJobLink({ jobId }: { jobId: string }) {
  const [job, setJob] = useState<Job>();
  useEffect(() => {
    let closed = false,
      timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const result = await api<{ job: Job }>(`jobs/${encodeURIComponent(jobId)}`);
        if (!closed) setJob(result.job);
      } catch {
        if (!closed) setJob(undefined);
      }
      if (!closed) timer = setTimeout(() => void refresh(), 2500);
    }
    void refresh();
    return () => {
      closed = true;
      clearTimeout(timer);
    };
  }, [jobId]);
  if (!job || job.id !== jobId) return null;
  return (
    <Link className="viewer-queue viewer-asset-job" href={`/queue/${encodeURIComponent(job.id)}`}>
      <Layers3 size={13} />
      Asset job · {statusLabels[job.status]}
      <span>View job &amp; logs →</span>
    </Link>
  );
}
