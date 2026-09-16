import Link from 'next/link';
import { ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/primitives/badge';
import { InlineMessage } from '@/components/ui/patterns/inline-message';
import { Button } from '@/components/ui/primitives/button';
import { gatedAccess, knownDownloadBytes } from '@/lib/pipelines/details';
import { workflowDownloadAccess } from '@/lib/pipelines/download-access';
import { providerDefinitions } from '@/lib/providers/definitions';
import type { PipelineStatus } from '@/lib/pipelines/schema';
import { WorkflowAccessIcon, WorkflowMetrics } from '@/components/generation/workflow-summary';

export function PipelineDetails({ pipeline, checkingAccess = false, busy = false, connectionAvailable, accessError, onCheckAccess }: {
  pipeline: PipelineStatus;
  checkingAccess?: boolean;
  busy?: boolean;
  connectionAvailable?: boolean;
  accessError?: string;
  onCheckAccess?: () => void;
}) {
  const details = pipeline.catalog;
  const gated = gatedAccess(details);
  const resolvedAccess = workflowDownloadAccess(pipeline);
  const access = connectionAvailable === false && resolvedAccess.state !== 'not-required'
    ? { ...resolvedAccess, state: 'unknown' as const, detail: 'Connect the provider to verify installed files and any remaining download requirements.' }
    : connectionAvailable && resolvedAccess.state === 'unknown'
    ? { ...resolvedAccess, detail: 'Frok couldn’t verify which downloads this workflow still needs. Review its setup instructions or configure it manually.' }
    : resolvedAccess;
  const blocked = !pipeline.ready && ['token-required', 'denied'].includes(access.state);
  const granted = !pipeline.ready && access.state === 'granted';
  const needsAccess = !pipeline.ready && access.state !== 'not-required';
  const canCheck = needsAccess && access.repositories.length > 0 && ['unchecked', 'unavailable', 'denied', 'granted'].includes(access.state);
  const accessLabels = {
    'not-required': 'No gated downloads needed',
    'token-required': 'Hugging Face token needed',
    granted: 'Download access verified',
    denied: 'Hugging Face access needed',
    unchecked: 'Download access not checked',
    unavailable: 'Couldn’t check download access',
    unknown: 'Download requirements not verified',
  };
  const repositoryLabels = {
    'not-required': 'No download needed',
    'token-required': 'Token needed',
    granted: 'Access verified',
    denied: 'Access needed',
    unchecked: 'Not checked',
    unavailable: 'Check failed',
    unknown: 'Not verified',
  };
  const bytes = knownDownloadBytes(pipeline.files || []);
  const missing = pipeline.files?.filter(file => !file.ready) || [];
  const remaining = knownDownloadBytes(missing);
  return (
    <div className="pipeline-details">
      <div className="pipeline-badges">
        <Badge>{providerDefinitions[pipeline.runner].name} · Local</Badge>
        {details?.precision && <Badge>{details.precision}</Badge>}
        {details?.experimental && <Badge tone="warning">Experimental</Badge>}
      </div>
      {details && <p className="pipeline-flavor">{details.family} · {details.flavor}</p>}
      <WorkflowMetrics pipeline={pipeline} />
      <p>{pipeline.description || 'A workflow from your local pipeline folder.'}</p>
      {needsAccess && <section className="pipeline-access" aria-label="Download access">
        <InlineMessage tone={blocked ? 'warning' : granted ? 'success' : access.state === 'unavailable' ? 'danger' : 'neutral'}>
          <strong className="pipeline-access-title">
            {(blocked || granted) && <WorkflowAccessIcon pipeline={pipeline} />}
            {accessLabels[access.state]}
          </strong>
          <p>{access.detail}</p>
          {blocked && <p>
            {access.state === 'token-required' ? 'Accept any required model terms using the links below. ' : 'After changing your token, quit and reopen Frok. '}
            <Link href="/settings/advanced#api-tokens">Manage API tokens →</Link>
          </p>}
          {access.state === 'unchecked' && <p>Check access before downloading. This verifies permission without downloading model weights.</p>}
          {!!access.repositories.length && <ul className="pipeline-access-repositories">
            {access.repositories.map(repository => <li key={repository.url}>
              <a href={repository.url} target="_blank" rel="noreferrer">{repository.name}<ExternalLink size={12} aria-hidden="true" /></a>
              <small>{connectionAvailable === false ? repositoryLabels.unknown : repositoryLabels[repository.state]}</small>
            </li>)}
          </ul>}
        </InlineMessage>
        {canCheck && onCheckAccess && <Button variant="secondary" disabled={busy || checkingAccess} loading={checkingAccess} onClick={onCheckAccess}>
          {checkingAccess ? 'Checking download access…' : 'Check download access'}
        </Button>}
        {accessError && <InlineMessage role="alert" tone="danger">{accessError}</InlineMessage>}
      </section>}
      {details && (
        <>
          <dl className="pipeline-facts">
            <div><dt>Model</dt><dd>{details.model}</dd></div>
            <div><dt>Supports</dt><dd>{details.uses.join(' · ') || pipeline.kind}</dd></div>
            <div><dt>Installed size</dt><dd>{details.estimates?.installedGB ? `~${details.estimates.installedGB.toFixed(1)} GB` : bytes ? `${(bytes / 1e9).toFixed(1)} GB of model files` : 'Not specified'}</dd></div>
            <div><dt>Peak preparation space</dt><dd>{details.estimates?.preparationGB ? `~${details.estimates.preparationGB} GB` : 'Not specified'}</dd></div>
            <div><dt>Memory guidance</dt><dd>{details.estimates?.memoryGB ? `${details.estimates.memoryGB} GB · see hardware notes` : 'Depends on the runner, hardware and output size'}</dd></div>
          </dl>
          {details.estimates && <p className="pipeline-note">{details.estimates.basis} <a href={details.estimates.source} target="_blank" rel="noreferrer">Hardware notes ↗</a></p>}
          <p className="pipeline-note">Ratings require a published basis. Speed comparisons depend on hardware, output size and sampling settings.</p>
          {Object.entries(details.ratings || {}).map(([name, rating]) => rating && <p className="pipeline-note" key={name}>{name === 'speed' ? 'Speed' : 'Adherence'}: {rating.basis} <a href={rating.source} target="_blank" rel="noreferrer">Rating source ↗</a></p>)}
          {!!details.requirements.length && <ul className="pipeline-requirements">{details.requirements.map(item => <li key={item}>{item}</li>)}</ul>}
        </>
      )}
      {!needsAccess && !!gated.length && <div className="pipeline-note">
        {gated.map(item => <a key={item.url} className="pipeline-source-link" href={item.url} target="_blank" rel="noreferrer">{item.name} · Model terms <ExternalLink size={12} /></a>)}
      </div>}
      <div className="pipeline-setup-guide">
        <h4>Setup</h4>
        <p>{details?.setup || 'Install dependencies in your runner and refresh workflows. Custom pipelines use manual setup.'}</p>
        <InlineMessage tone={pipeline.ready ? 'success' : 'neutral'}>{pipeline.detail}</InlineMessage>
        {remaining !== undefined && !pipeline.ready && <p className="pipeline-note">{(remaining / 1e9).toFixed(1)} GB of missing model files. Matching installed files are reused.</p>}
        {details && <a className="pipeline-source-link" href={details.documentation} target="_blank" rel="noreferrer">Model and setup guide <ExternalLink size={12} /></a>}
      </div>
      {!!pipeline.files?.length && (
        <details className="pipeline-file-list">
          <summary>Required files ({pipeline.files.length})</summary>
          <ul>{pipeline.files.map(file => (
            <li key={file.reference}>
              <span>{file.url ? <a href={file.url} target="_blank" rel="noreferrer">{file.reference}</a> : file.reference}</span>
              <small>{file.ready ? 'Installed' : 'Not verified'}{file.size ? ` · ${(file.size / 1e9).toFixed(2)} GB` : ''}</small>
            </li>
          ))}</ul>
        </details>
      )}
      <p className="pipeline-note">You can always configure pipelines yourself. <Link href="/settings/advanced#workflow-files">Manage workflow files →</Link></p>
    </div>
  );
}
