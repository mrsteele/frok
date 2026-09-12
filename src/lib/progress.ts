import type { Generation, Job, JobStep, VideoProgressState } from './types';

// Vpipe's non-TTY delegate reports milestones as percentages with a named phase.
// Counts may represent bytes or GPU blocks, so they must not be labeled denoising steps.
export function parseStepProgress(text: string): JobStep | undefined {
  const lines=text.replace(/\x1b\[[0-9;]*m/g, '').split(/[\r\n]/).reverse();
  for(const line of lines) {
    const milestone=/\b(\d{1,3})% of '([^']+)' completed at/.exec(line);
    if(milestone && Number(milestone[1])<=100) return {current:Number(milestone[1]),total:100,label:milestone[2] === 'denoise' ? 'Denoising' : milestone[2].slice(0,160)};
    const step=/\b(?:denois\w*|step)\s*[: ]\s*(\d+)\s*\/\s*(\d+)\b/i.exec(line);
    if(step){const current=Number(step[1]),total=Number(step[2]);if(total>0 && total<=10000 && current>=0 && current<=total)return {current,total};}
  }
}


export function tracksVideoStages(job: Job) {
  return job.kind === 'generate' && ['video', 'reference'].includes((job.request as Generation).mode);
}

const phaseOrder = { preparing: 0, denoise: 1, decode: 2, finishing: 3, completed: 4 };
const phaseLabels = { preparing: 'Preparing video', denoise: 'Denoising · 1 of 2', decode: 'VAE decode · 2 of 2', finishing: 'Saving video', completed: 'Video saved' };
export const videoProgressHint = 'Overall estimate: denoising 0–80%, VAE decode 80–99%, then saving. This is not an estimate of time remaining.';
export const videoPhaseLabel = (progress: VideoProgressState) => phaseLabels[progress.phase];
export const preparingVideoProgress = (): VideoProgressState => ({ phase: 'preparing', percent: 0 });
export const finishingVideoProgress = (): VideoProgressState => ({ phase: 'finishing', percent: 99 });
export const completedVideoProgress = (): VideoProgressState => ({ phase: 'completed', percent: 100 });

// Phase weights describe overall work, not measured wall-clock time. Only a saved
// output can reach 100%. Late reports and restarted tile counters cannot rewind it.
export function advanceVideoProgress(previous: VideoProgressState, step: JobStep): VideoProgressState {
  if (!Number.isFinite(step.current) || !Number.isFinite(step.total) || step.total <= 0 || step.current < 0 || step.current > step.total) return previous;
  const label = step.label?.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  const phase = !label || /^denois(?:e|ing)$/.test(label) ? 'denoise' : /^vae decod(?:e|ing)$/.test(label) ? 'decode' : undefined;
  if (!phase || phaseOrder[phase] < phaseOrder[previous.phase]) return previous;
  const fraction = Math.max(previous.phase === phase ? (previous.stagePercent ?? 0) / 100 : 0, step.current / step.total);
  const percent = Math.max(previous.percent, Math.floor(phase === 'denoise' ? fraction * 80 : 80 + fraction * 19));
  return { phase, percent, stagePercent: Math.round(fraction * 100) };
}

// Consume every phase in chronological order, even if a subprocess bundles
// multiple milestones (or a late denoise report) into the same output chunk.
export function parseProgressLog(text: string, videoProgress?: VideoProgressState) {
  let step: JobStep | undefined;
  for (const line of text.split(/[\r\n]/)) {
    const next = parseStepProgress(line);
    if (!next) continue;
    step = next;
    if (videoProgress) videoProgress = advanceVideoProgress(videoProgress, next);
  }
  return { step, videoProgress };
}

export function jobProgress(job: Job) {
  let percent: number | undefined;
  let label = job.message;
  const video = tracksVideoStages(job);
  if (job.status === 'completed') {
    percent = 100;
    label = video ? 'Video saved' : job.message;
  } else if (job.status === 'queued') {
    label = 'Waiting to render';
  } else if (video) {
    // This also understands jobs reported by an older worker until it restarts.
    const progress = job.videoProgress ?? (/finishing|saving|video saved/i.test(job.message) ? finishingVideoProgress()
      : job.step ? advanceVideoProgress(preparingVideoProgress(), job.step) : undefined);
    if (progress && progress.phase !== 'preparing') {
      percent = Math.min(99, progress.percent);
      label = videoPhaseLabel(progress);
    }
  } else if (job.step && job.step.total > 0 && Number.isFinite(job.step.current) && Number.isFinite(job.step.total)) {
    percent = Math.round(Math.max(0, Math.min(1, job.step.current / job.step.total)) * 100);
    label = job.step.label || `Denoising step ${job.step.current} of ${job.step.total}`;
  } else if (job.total > 1) {
    percent = Math.round(job.completed / job.total * 100);
  }
  return { percent, label, text: percent === undefined ? label : `${percent}%${video ? ' overall' : ''} · ${label}`, hint: video ? videoProgressHint : undefined };
}
