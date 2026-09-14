"use client";
import { useEffect, useState } from 'react';
import type { Job } from '@/lib/types';
import { formatRunnerTime, jobElapsedSeconds } from '@/lib/runner-time';
import { connectionNames } from '@/lib/service-config';

export function JobRuntime({ job }: { job: Job }) {
  const [now, setNow] = useState(() => Date.parse(job.updatedAt));
  useEffect(() => {
    if (job.status !== 'running' || !job.startedAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [job.id, job.status, job.startedAt]);
  const elapsed = jobElapsedSeconds(job, now);
  const duration = formatRunnerTime(elapsed ?? (job.status !== 'queued' ? job.runnerSeconds : undefined));
  if (!duration) return job.status === 'queued' ? null : <small className="job-runtime" title="This older job has no recorded start time or usable runner duration.">Time not recorded</small>;
  const runner = formatRunnerTime(job.runnerSeconds);
  const reportedOnly = elapsed === undefined;
  const service = connectionNames[job.runner];
  const title = reportedOnly ? `Rendering time reported by ${service}.`
    : `Total processing time, including prompt enhancement and saving; excludes queue wait.${runner ? ` ${service} rendering: ${runner}.` : ''}`;
  return <small className="job-runtime" title={title}>{reportedOnly ? `${service} rendering` : job.status === 'running' ? 'Elapsed' : 'Ran for'} · {duration}</small>;
}
