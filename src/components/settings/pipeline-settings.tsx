'use client';
import { Badge } from '@/components/ui/primitives/badge';
import { InlineMessage } from '@/components/ui/patterns/inline-message';
import { Spinner } from '@/components/ui/primitives/spinner';
import { FormField } from '@/components/ui/patterns/form-field';
import { Button } from '@/components/ui/primitives/button';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Film, Image, Layers3, RefreshCw, ScanLine, Download } from 'lucide-react';
import type { PipelineKind } from '@/lib/pipelines/schema';
import { generationOptions } from '@/lib/onboarding';
import { DocumentationLink } from '@/components/shell/documentation-link';
import { api } from '@/lib/client-api';
import type { Health, Job, SetupRequest } from '@/lib/types';
import { isPreparationJob } from '@/lib/preparation-job';
import { WorkflowSelect } from '@/components/generation/workflow-select';
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
  useEffect(() => {
    onBusyChange?.(!!busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  async function choose(kind: PipelineKind, value: string) {
    setBusy(kind);
    setError('');
    try {
      await api('settings', 'PATCH', { pipelineSelections: { [kind]: value || null } });
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  async function prepare(kind:PipelineKind,id:string) {
    if(busy)return;
    setBusy(kind);setError('');
    try {await api('pipelines/prepare','POST',{id});await onRefresh();}
    catch(error){setError((error as Error).message);}
    finally{setBusy('');}
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
                  tone={
                    checking || busy === kind
                      ? 'neutral'
                      : state?.ready
                        ? 'success'
                        : value
                          ? 'warning'
                          : 'neutral'
                  }
                >
                  {checking || busy === kind ? (
                    <>
                      <Spinner size={13} />
                      Checking
                    </>
                  ) : state?.ready ? (
                    <>
                      <Check size={13} />
                      Ready
                    </>
                  ) : value ? (
                    'Setup needed'
                  ) : (
                    'Optional'
                  )}
                </Badge>
              </header>
              <FormField label={<span className="visually-hidden">{name} workflow</span>}>
                <WorkflowSelect
                  health={health}
                  kind={kind}
                  allowNone
                  aria-label={name + ' workflow'}
                  value={value}
                  disabled={checking || !!busy}
                  onChange={(e) => void choose(kind, e.target.value)}
                />
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
              {selected?.description && (
                <InlineMessage tone="neutral">{selected.description}</InlineMessage>
              )}
              {value && !state?.ready && !checking && (
                <InlineMessage tone="warning">
                  {state?.detail || 'This workflow needs setup.'}
                </InlineMessage>
              )}
              {selected?.preparation && !state?.ready && !checking && (
                <div className="workflow-preparation">
                  {!preparing && <Button disabled={!!busy||!health?.worker} loading={busy===kind} onClick={()=>void prepare(kind,selected.id)} variant="secondary"><Download size={14}/>Prepare models</Button>}
                  {job && <Link href={`/queue/${job.id}`} onClick={event=>{if(onOpenJob){event.preventDefault();onOpenJob(job.id);}}}>{job.status==='queued'?'Preparation queued':job.status==='running'?'Preparing models':job.status==='completed'?'Preparation finished':'Preparation needs attention'} · View log →</Link>}
                  <p>Runs the bundled Vpipe starter in your model workspace. If it fails, use the setup instructions below.</p>
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
      {error && (
        <InlineMessage role="alert" tone="danger">
          {error}
        </InlineMessage>
      )}
      {!wizard && (
        <p className="settings-footnote">
          Workflows define the model and how it runs.{' '}
          <Link href="/settings/advanced#workflow-files">Manage workflow files →</Link>
        </p>
      )}
    </>
  );
}
