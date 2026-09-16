import Link from 'next/link';
import { ExternalLink, LockKeyhole } from 'lucide-react';
import { Badge } from '@/components/ui/primitives/badge';
import { InlineMessage } from '@/components/ui/patterns/inline-message';
import { gatedAccess, knownDownloadBytes } from '@/lib/pipelines/details';
import { providerDefinitions } from '@/lib/providers/definitions';
import type { PipelineStatus } from '@/lib/pipelines/schema';
import { WorkflowMetrics } from '@/components/generation/workflow-summary';

export function PipelineDetails({ pipeline }: { pipeline: PipelineStatus }) {
  const details = pipeline.catalog;
  const gated = gatedAccess(details);
  const bytes = knownDownloadBytes(pipeline.files || []);
  const missing = pipeline.files?.filter(file => !file.ready) || [];
  const remaining = knownDownloadBytes(missing);
  return (
    <div className="pipeline-details">
      <div className="pipeline-badges">
        <Badge>{providerDefinitions[pipeline.runner].name} · Local</Badge>
        {details?.precision && <Badge>{details.precision}</Badge>}
        {details?.experimental && <Badge tone="warning">Experimental</Badge>}
        {!!gated.length && (
          <Badge tone="warning" title="Hugging Face access is required to download. Installed models can run without a token.">
            <LockKeyhole size={12} aria-hidden="true" /> Gated download
          </Badge>
        )}
      </div>
      {details && <p className="pipeline-flavor">{details.family} · {details.flavor}</p>}
      <WorkflowMetrics pipeline={pipeline} />
      <p>{pipeline.description || 'A workflow from your local pipeline folder.'}</p>
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
      {!!gated.length && (
        <InlineMessage tone="warning">
          <strong>Hugging Face access is required for downloading.</strong>
          <p>Accept the model’s terms, then save a read token in <Link href="/settings/advanced#api-tokens">API tokens</Link>. A token does not grant model access by itself. Already installed models can run without it.</p>
          {gated.map(item => <a key={item.url} className="pipeline-source-link" href={item.url} target="_blank" rel="noreferrer">{item.name} · Request access <ExternalLink size={12} /></a>)}
        </InlineMessage>
      )}
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
