'use client';
import { Badge } from '@/components/ui/primitives/badge';
import { InlineMessage } from '@/components/ui/patterns/inline-message';
import { Spinner } from '@/components/ui/primitives/spinner';
import { FormField } from '@/components/ui/patterns/form-field';
import { Button } from '@/components/ui/primitives/button';
import { useEffect, useId, useRef, useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Film, Image, Layers3, RefreshCw, ScanLine, Download } from 'lucide-react';
import type { PipelineKind } from '@/lib/pipelines/schema';
import { generationOptions } from '@/lib/onboarding';
import { DocumentationLink } from '@/components/shell/documentation-link';
import { api } from '@/lib/client-api';
import type { Health, Job, SetupRequest } from '@/lib/types';
import { isPreparationJob } from '@/lib/preparation-job';
import { PipelineCatalog } from './pipeline-catalog';
import { WorkflowSummary } from '@/components/generation/workflow-summary';
import { providerDefinitions } from '@/lib/providers/definitions';
const icons = { image: Image, video: Film, reference: Layers3, upscale: ScanLine };
export function PipelineSettings({
  health,
  checking,
  onRefresh,
  wizard = false,
  onBusyChange,
  jobs = [],
  onOpenJob,
}: {
  health?: Health;
  checking: boolean;
  onRefresh: () => void;
  wizard?: boolean;
  onBusyChange?: (busy: boolean) => void;
  jobs?: Job[];
  onOpenJob?: (id:string) => void;
}) {
  const [busy, setBusy] = useState(''),
    [error, setError] = useState('');
  const [browsing, setBrowsing] = useState<PipelineKind>();
  const catalogId = useId();
  const lock = useRef(false);
  useEffect(() => {
    onBusyChange?.(!!busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  async function choose(kind: PipelineKind, value: string) {
    if (lock.current) return false;
    lock.current = true;
    setBusy(kind);
    setError('');
    try {
      await api('settings', 'PATCH', { pipelineSelections: { [kind]: value || null } });
      await onRefresh();
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      lock.current = false;
      setBusy('');
    }
  }
  async function prepare(kind:PipelineKind,id:string) {
    if(lock.current)return;
    lock.current=true;
    setBusy(kind);setError('');
    try {await api('pipelines/prepare','POST',{id});await onRefresh();}
    catch(error){setError((error as Error).message);}
    finally{lock.current=false;setBusy('');}
  }

  return (
    <>
      {health && !health.worker && (
        <InlineMessage role="status" tone="warning">
          {health.checks.find((check) => check.id === 'worker')?.detail ||
            'Start the generation worker to generate.'}
        </InlineMessage>
      )}
      <div className="generation-choices">
        {generationOptions.map(({ kind, name, description }) => {
          const value = health?.pipelineSelections?.[kind] || '';
          const selected = health?.pipelines?.find((p) => p.kind === kind && p.id === value),
            state = health?.capabilities?.[kind],
            Icon = icons[kind];
          const job=selected?.preparation?jobs.find(job=>isPreparationJob(job)&&(job.request as SetupRequest).preparation===selected.preparation):undefined;
          const preparing=job&&['queued','running'].includes(job.status);
          return (
            <section
              className="workflow-choice"
              id={wizard ? undefined : 'setup-' + kind}
              key={kind}
            >
              <header>
                <span className="workflow-icon">
                  <Icon size={18} />
                </span>
                <div>
                  <h3>{name}</h3>
                  <p>{description}</p>
                </div>
                <Badge
                  tone="neutral"
                >
                  {checking || busy === kind ? (
                    <>
                      <Spinner size={13} />
                      Checking
                    </>
                  ) : selected ? providerDefinitions[selected.runner].name : 'Optional'}
                </Badge>
              </header>
              <FormField controlId={`${catalogId}-${kind}`} label={<span className="visually-hidden">{name} workflow</span>}>
                <Button
                  id={`${catalogId}-${kind}`}
                  className="workflow-picker"
                  aria-label={`${name} workflow: ${selected?.name || (value ? 'Selected workflow unavailable' : 'Not enabled')}`}
                  aria-describedby={selected ? `${catalogId}-${kind}-metrics-state ${catalogId}-${kind}-metrics` : undefined}
                  aria-haspopup="dialog"
                  aria-expanded={browsing === kind}
                  aria-controls={browsing === kind ? catalogId : undefined}
                  disabled={!health || checking || !!busy}
                  onClick={() => { setError(''); setBrowsing(kind); }}
                >
                  {selected ? <WorkflowSummary pipeline={selected} connection={health?.connections?.[selected.runner]} descriptionId={`${catalogId}-${kind}-metrics`} /> : <span className="workflow-picker-empty"><strong>{value ? 'Selected workflow unavailable' : 'Choose a workflow'}</strong><span>Compare models, ratings and download sizes</span></span>}
                  <ChevronDown size={16} aria-hidden="true" />
                </Button>
              </FormField>
              {health && !health.pipelines?.some((p) => p.kind === kind) && (
                <InlineMessage tone="neutral">
                  No workflows found.
                  {!wizard && (
                    <>
                      {' '}
                      <Link href="/settings/advanced#workflow-files">Manage workflow files →</Link>
                    </>
                  )}
                </InlineMessage>
              )}
              {value && !state?.ready && !checking && (
                <details className="workflow-setup-details">
                  <summary>Setup details</summary>
                  <InlineMessage tone="warning">{state?.detail || 'This workflow needs setup.'}</InlineMessage>
                </details>
              )}
              {selected?.preparation && !state?.ready && !checking && (
                <div className="workflow-preparation">
                  {!preparing && <Button disabled={!!busy||!health?.worker} loading={busy===kind} onClick={()=>void prepare(kind,selected.id)} variant="secondary"><Download size={14}/>Prepare models</Button>}
                  {job && <Link href={`/queue/${job.id}`} onClick={event=>{if(onOpenJob){event.preventDefault();onOpenJob(job.id);}}}>{job.status==='queued'?'Preparation queued':job.status==='running'?'Preparing models':job.status==='completed'?'Preparation finished':'Preparation needs attention'} · View log →</Link>}
                  <p>{selected.runner === 'vpipe' ? 'Prepares models in your Vpipe workspace.' : 'Downloads verified files into your ComfyUI model folder.'} Check requirements in the selector first.</p>
                </div>
              )}
              {value && !state?.ready && !checking && (
                <DocumentationLink className="settings-documentation-link" page="/guide/model-setup" label="Setup instructions" onError={setError} />
              )}
            </section>
          );
        })}
      </div>
      <Button disabled={checking || !!busy} onClick={onRefresh} variant="ghost">
        <RefreshCw size={14} className={checking ? 'spin' : ''} />
        Refresh workflows
      </Button>
      {browsing && health && <PipelineCatalog id={catalogId} health={health} kind={browsing} busy={!!busy} error={error} onChoose={choose} onClose={() => setBrowsing(undefined)} />}
      {error && !browsing && (
        <InlineMessage role="alert" tone="danger">
          {error}
        </InlineMessage>
      )}
      {!wizard && (
        <p className="settings-footnote">
          Choose a model and flavor; Frok runs its workflow through your provider. You can always configure pipelines yourself.{' '}
          <Link href="/settings/advanced#workflow-files">Manage workflow files →</Link>
        </p>
      )}
    </>
  );
}
