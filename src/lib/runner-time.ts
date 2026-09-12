import type { Job } from './types';

// Vpipe emits this summary when the whole pipeline stops. Milestone timestamps
// and individual stage timings are not the render's elapsed time.
export function parseVpipeRuntime(text: string, pipelineId: string): number | undefined {
  let seconds: number | undefined;
  for (const line of text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').split(/[\r\n]/)) {
    const report = /\bPipelineRuntime: pipeline '([^']+)' ran for (.+)$/.exec(line);
    if (!report || report[1] !== pipelineId) continue;
    const duration = report[2].trim();
    if (!/^(?:\d+(?:\.\d+)?\s*(?:ms|h|m|s)\s*)+$/.test(duration)) continue;
    const units: Record<string, number> = { h: 3600, m: 60, s: 1, ms: .001 };
    const total = [...duration.matchAll(/(\d+(?:\.\d+)?)\s*(ms|h|m|s)/g)]
      .reduce((sum, part) => sum + Number(part[1]) * units[part[2]], 0);
    if (Number.isFinite(total) && total >= 0) seconds = total;
  }
  return seconds;
}

export function formatRunnerTime(seconds?: number): string | undefined {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return;
  if (seconds > 0 && seconds < 1) return `${Math.max(1, Math.round(seconds * 1000))}ms`;
  const total = Math.round(seconds), hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60);
  return [hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', `${total % 60}s`].filter(Boolean).join(' ');
}

// Queue wait is excluded. Terminal jobs never keep counting after their finish.
export function jobElapsedSeconds(job: Job, now = Date.now()): number | undefined {
  if (job.status === 'queued') return;
  if (job.status !== 'running' && job.elapsedSeconds !== undefined && Number.isFinite(job.elapsedSeconds) && job.elapsedSeconds >= 0) return job.elapsedSeconds;
  if (!job.startedAt) return;
  const start = Date.parse(job.startedAt);
  const end = job.status === 'running' ? now : job.finishedAt ? Date.parse(job.finishedAt) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end)) return;
  return (job.accumulatedSeconds || 0) + Math.max(0, (end - start) / 1000);
}
