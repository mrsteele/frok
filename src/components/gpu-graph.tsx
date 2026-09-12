import type { Telemetry } from '@/lib/types';

export function GpuGraph({ telemetry, compact = false }: { telemetry?: Telemetry; compact?: boolean }) {
  const samples = telemetry?.samples || [];
  // Fixed 3-minute axis. A gap or unavailable sample breaks the line rather than inventing data.
  const end = samples.at(-1)?.at || Date.now();
  let d = "", previous = 0;
  for (const s of samples) {
    if (s.busy === null) { previous = 0; continue; }
    const x = Math.max(0, 180 - (end - s.at) / 1000), y = 36 - s.busy * .32;
    d += `${previous && s.at - previous < 12000 ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)} `; previous = s.at;
  }
  const busy = telemetry?.busy;
  return <div className={`gpu-graph ${compact ? "compact" : ""}`} title={telemetry?.detail || "Waiting for a GPU sample"}>
    <div className="gpu-label"><span>GPU</span><span>{busy == null ? "Unavailable" : `${Math.round(busy)}% busy · ${Math.round(100 - busy)}% idle`}</span></div>
    <svg viewBox="0 0 180 40" preserveAspectRatio="none" role="img" aria-label={busy == null ? "GPU utilization unavailable" : "GPU busy percentage over the last three minutes"}><path className="graph-grid" d="M0 4H180 M0 20H180 M0 36H180" />{d && <path className="graph-line" d={d} />}</svg>
    {!compact && <p>{telemetry?.detail || "Sampling starts when a job runs."} · Last 3 minutes</p>}
  </div>;
}
