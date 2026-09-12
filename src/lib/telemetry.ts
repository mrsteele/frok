import { vpipeBin } from './config';
import { runProcess } from './process';
import { getValue, setValue } from './db';
import type { GpuSample, Telemetry } from './types';

export function parseGpuSample(text: string, at = Date.now()): GpuSample {
  const line = text.split(/[\r\n]/).find(l => l.trim().startsWith('{'));
  try {
    const value = JSON.parse(line || '{}').gpu_active_pct;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100) return { at, busy: value };
  } catch {}
  return { at, busy: null };
}
export async function sampleGpu() {
  let sample: GpuSample;
  try { sample = parseGpuSample(await runProcess(vpipeBin(), ['--gpu-thermal', '200'], { timeout: 2500 })); }
  catch { sample = { at: Date.now(), busy: null }; }
  const history = getValue<GpuSample[]>('gpuHistory', []).filter(s => s.at > Date.now() - 180_000);
  setValue('gpuHistory', [...history, sample].slice(-60));
}
export function telemetry(): Telemetry {
  const samples = getValue<GpuSample[]>('gpuHistory', []).filter(s => s.at > Date.now() - 180_000);
  const latest = samples.at(-1);
  const available = latest?.busy != null && Date.now() - latest.at < 12_000;
  return { samples, busy: available ? latest.busy : null, sampledAt: latest?.at,
    detail: available ? 'Device-wide GPU utilization · sampled every 3 seconds' : 'GPU utilization is unavailable from this runner. Job progress is still live.' };
}
export { parseStepProgress } from './progress';
