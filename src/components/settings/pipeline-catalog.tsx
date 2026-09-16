'use client';
import { useId, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, ChevronDown, X } from 'lucide-react';
import { Modal } from '@/components/ui/patterns/modal';
import { FormField } from '@/components/ui/patterns/form-field';
import { FormActions } from '@/components/ui/patterns/form-actions';
import { InlineMessage } from '@/components/ui/patterns/inline-message';
import { Button } from '@/components/ui/primitives/button';
import { IconButton } from '@/components/ui/primitives/icon-button';
import { Input } from '@/components/ui/primitives/input';
import { Select } from '@/components/ui/primitives/select';
import { providerDefinitions, providerIds } from '@/lib/providers/definitions';
import { WorkflowSummary } from '@/components/generation/workflow-summary';
import { groupWorkflowsByConnection } from '@/components/generation/workflow-options';
import type { PipelineKind } from '@/lib/pipelines/schema';
import type { Health } from '@/lib/types';
import { PipelineDetails } from './pipeline-details';

export function PipelineCatalog({ id: dialogId, health, kind, busy, error, onChoose, onClose }: {
  id: string;
  health: Health;
  kind: PipelineKind;
  busy: boolean;
  error?: string;
  onChoose: (kind: PipelineKind, id: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const titleId = useId(), search = useRef<HTMLInputElement>(null);
  const workflows = (health.pipelines || []).filter(p => p.kind === kind);
  const [query, setQuery] = useState(''), [provider, setProvider] = useState('');
  const [id, setId] = useState(health.pipelineSelections?.[kind] || '');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const visible = workflows.filter(p => (!provider || p.runner === provider) &&
    [p.name, p.description, p.catalog?.family, p.catalog?.flavor, p.catalog?.model].join(' ').toLowerCase().includes(query.trim().toLowerCase()));
  const byConnection = groupWorkflowsByConnection(visible, health);
  const ordered = [...byConnection.connected, ...byConnection.disconnected];
  const selected = id ? ordered.find(p => p.id === id) || ordered[0] : undefined;
  const connected = selected && health.connections?.[selected.runner]?.enabled && health.connections[selected.runner].available;
  return (
    <Modal id={dialogId} titleId={titleId} className="pipeline-catalog" busy={busy} onClose={onClose} initialFocus={search}>
      <header className="pipeline-catalog-header">
        <div><h2 id={titleId}>Choose {kind === 'image' ? 'an' : 'a'} {kind === 'reference' ? 'reference video' : kind === 'upscale' ? 'video upscaling' : kind} workflow</h2><p>Compare models at a glance. Selecting one never starts a download.</p></div>
        <IconButton aria-label="Close workflow catalog" disabled={busy} onClick={onClose} variant="ghost"><X size={20} /></IconButton>
      </header>
      <div className="pipeline-catalog-filters">
        <FormField label="Search models and flavors"><Input ref={search} disabled={busy} value={query} onChange={e => setQuery(e.target.value)} placeholder="Model, flavor or purpose" /></FormField>
        <FormField label="Provider"><Select disabled={busy} value={provider} onChange={e => setProvider(e.target.value)}><option value="">All providers</option>{providerIds.map(id => <option key={id} value={id}>{providerDefinitions[id].name}</option>)}</Select></FormField>
      </div>
      <div className="pipeline-catalog-body">
        <nav className="pipeline-catalog-options" aria-label="Available workflows">
          <Button className="pipeline-catalog-option pipeline-catalog-none" aria-pressed={!id} disabled={busy} onClick={() => setId('')}>
            <span><strong>Not enabled</strong><small>Turn off this generation option</small></span>
            {!health.pipelineSelections?.[kind] && <Check size={15} aria-label="Current default" />}
          </Button>
          {!visible.length && <p>No workflows match your search.</p>}
          {(['connected', 'disconnected'] as const).map(section => {
            const items = byConnection[section];
            if (!items.length) return null;
            const groups = Map.groupBy(items, p => `${providerDefinitions[p.runner].name} · ${p.catalog?.family || 'Custom workflows'}`);
            return (
              <section key={section} className={section === 'disconnected' ? 'pipeline-catalog-unavailable' : undefined} aria-label={section === 'connected' ? 'Connected providers' : 'Needs a connection'}>
                {section === 'disconnected' && <p className="pipeline-catalog-availability">Needs a connection<span>Connect these providers in Services to use their models.</span></p>}
                {[...groups].map(([group, workflows]) => <section key={group}>
                  <h3>{group}</h3>
                  {workflows.map(p => <Button key={p.id} className="pipeline-catalog-option" aria-pressed={p.id === selected?.id} disabled={busy} onClick={() => { setId(p.id); setDetailsOpen(false); }}>
                    <WorkflowSummary pipeline={p} connection={health.connections?.[p.runner]} />
                    <span className="pipeline-catalog-check">{p.id === health.pipelineSelections?.[kind] && <Check size={15} aria-label="Current default" />}</span>
                  </Button>)}
                </section>)}
              </section>
            );
          })}
        </nav>
        <section key={selected?.id} className="pipeline-catalog-preview" aria-label="Workflow details">
          <Button variant="ghost" className="pipeline-catalog-details-toggle" aria-expanded={detailsOpen} aria-controls={`${dialogId}-details`} onClick={() => setDetailsOpen(!detailsOpen)}>Model details & setup<ChevronDown size={15} aria-hidden="true" /></Button>
          <div id={`${dialogId}-details`} className={`pipeline-catalog-detail-content${detailsOpen ? ' is-open' : ''}`}>
            {selected ? <><h3>{selected.name}</h3><PipelineDetails pipeline={selected} /></> : id ? <><h3>No matching workflows</h3><p>Adjust your search to compare models.</p></> : <><h3>Not enabled</h3><p>No default workflow will be selected for this generation option.</p></>}
          </div>
        </section>
      </div>
      <footer className="pipeline-catalog-footer">
        {error && <InlineMessage role="alert" tone="danger">{error}</InlineMessage>}
        {selected && !connected && <p>Connect {providerDefinitions[selected.runner].name} in <Link href="/settings">Services</Link> to select this workflow.</p>}
        <FormActions><Button variant="secondary" disabled={busy} onClick={onClose}>Close</Button><Button disabled={!!id && (!selected || !connected) || busy} loading={busy} onClick={async () => { if (await onChoose(kind, selected?.id || '')) onClose(); }}>{id ? 'Use workflow' : 'Turn off'}</Button></FormActions>
      </footer>
    </Modal>
  );
}
