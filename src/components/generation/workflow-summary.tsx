import { Brain, Gauge, HardDrive, LockKeyhole, LockKeyholeOpen } from 'lucide-react';
import { knownDownloadBytes } from '@/lib/pipelines/details';
import { workflowDownloadAccess } from '@/lib/pipelines/download-access';
import type { PipelineStatus } from '@/lib/pipelines/schema';
import type { ConnectionStatus } from '@/lib/service-config';
import { providerDefinitions } from '@/lib/providers/definitions';

export function WorkflowMetrics({ pipeline, id }: { pipeline: PipelineStatus; id?: string }) {
  const ratings = pipeline.catalog?.ratings;
  const bytes = knownDownloadBytes(pipeline.files || []);
  const estimate = pipeline.catalog?.estimates?.downloadGB;
  const size = bytes !== undefined ? `${(bytes / 1e9).toFixed(1)} GB` : estimate ? `~${estimate.toFixed(1)} GB` : 'Size unknown';
  return (
    <span id={id} className="workflow-metrics">
      <span title={ratings?.speed?.basis || 'Speed has not been rated.'}>
        <Gauge size={13} aria-hidden="true" /><span>Speed <b>{ratings?.speed ? `${ratings.speed.score}/5` : 'Unrated'}</b></span>
      </span>
      <span title={ratings?.adherence?.basis || 'Prompt adherence has not been rated.'}>
        <Brain size={13} aria-hidden="true" /><span>Adherence <b>{ratings?.adherence ? `${ratings.adherence.score}/5` : 'Unrated'}</b></span>
      </span>
      <span title="Full model download size, including shared files. This is not runtime memory usage.">
        <HardDrive size={13} aria-hidden="true" /><span><span className="visually-hidden">Full download: </span><b>{size}</b></span>
      </span>
    </span>
  );
}

export function WorkflowSummary({ pipeline, connection, descriptionId }: { pipeline: PipelineStatus; connection?: ConnectionStatus; descriptionId?: string }) {
  const provider = providerDefinitions[pipeline.runner].name;
  const connected = connection?.enabled && connection.available;
  const access = workflowDownloadAccess(pipeline);
  const missingFiles = pipeline.missing.length > 0 || pipeline.files?.some(file => !file.ready);
  const state = !connected ? `Connect ${provider}` : pipeline.ready ? 'Ready'
    : access.state === 'token-required' ? 'Token needed'
    : access.state === 'denied' ? 'Access needed'
    : access.state === 'unknown' ? 'Setup needed'
    : missingFiles ? 'Needs download' : 'Setup needed';
  return (
    <span className="workflow-summary">
      <span className="workflow-summary-heading">
        <span className="workflow-summary-name">
          {connected && <WorkflowAccessIcon pipeline={pipeline} />}
          <strong>{pipeline.name}</strong>
        </span>
        <span id={descriptionId ? `${descriptionId}-state` : undefined} className={`workflow-summary-state${connected && !pipeline.ready ? ' workflow-summary-state--missing' : ''}${connected && pipeline.ready ? ' workflow-summary-state--ready' : ''}`}>{state}</span>
      </span>
      <WorkflowMetrics pipeline={pipeline} id={descriptionId} />
    </span>
  );
}

export function WorkflowAccessIcon({ pipeline }: { pipeline: PipelineStatus }) {
  const access = workflowDownloadAccess(pipeline);
  const blocked = access.state === 'token-required' || access.state === 'denied';
  if (pipeline.ready || (!blocked && access.state !== 'granted')) return null;
  const label = access.state === 'token-required' ? 'Hugging Face token needed for missing downloads'
    : blocked ? 'Hugging Face access needed for missing downloads'
    : 'Access verified for required Hugging Face downloads';
  const Icon = blocked ? LockKeyhole : LockKeyholeOpen;
  return <span className={`workflow-access-icon workflow-access-icon--${blocked ? 'warning' : 'success'}`} role="img" aria-label={label} title={label}>
    <Icon size={13} aria-hidden="true" />
  </span>;
}
