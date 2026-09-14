'use client';
import { Badge } from '@/components/ui/primitives/badge';
import { InlineMessage } from '@/components/ui/patterns/inline-message';
import { Spinner } from '@/components/ui/primitives/spinner';
import { FormField } from '@/components/ui/patterns/form-field';
import { Button } from '@/components/ui/primitives/button';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Download, Film, Image, Layers3, ScanLine } from 'lucide-react';
import type { PipelineKind } from '@/lib/pipelines/schema';
import { generationOptions, setupWorkflows } from '@/lib/onboarding';
import { api } from '@/lib/client-api';
import type { Health, Job } from '@/lib/types';
import { WorkflowSelect } from '@/components/generation/workflow-select';
const icons = { image: Image, video: Film, reference: Layers3, upscale: ScanLine };
export function PipelineSettings({
  health,
  jobs,
  checking,
  onRefresh,
  wizard = false,
  onBusyChange,
}: {
  health?: Health;
  jobs: Job[];
  checking: boolean;
  onRefresh: () => void;
  wizard?: boolean;
  onBusyChange?: (busy: boolean) => void;
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
  async function prepare(id: string) {
    setBusy(id);
    setError('');
    try {
      await api('setup', 'POST', { pipelineId: id });
      await onRefresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  }
  const workflows = setupWorkflows(health, jobs);
  return (
    <>
      {!wizard && (
        <div className="settings-section-heading">
          <h3>Choose how you create</h3>
          <p>Pick a default workflow for each kind of creation. Everything is optional.</p>
        </div>
      )}
      {health && !health.worker && (
        <InlineMessage role="status" tone="warning">
          {health.checks.find((check) => check.id === 'worker')?.detail ||
            'Start the generation worker to download models or generate.'}
        </InlineMessage>
      )}
      <div className="generation-choices">
        {generationOptions.map(({ kind, name, description }) => {
          const value = health?.pipelineSelections?.[kind] || '';
          const selected = health?.pipelines?.find((p) => p.kind === kind && p.id === value),
            summary = workflows.find((item) => item.kind === kind),
            state = health?.capabilities?.[kind],
            Icon = icons[kind];
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
                      : summary?.job
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
                  ) : summary?.job ? (
                    <>
                      <Spinner size={13} />
                      {summary.job.status === 'running' ? 'Preparing' : 'Queued'}
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
              {value && !state?.ready && !checking && !summary?.job && (
                <InlineMessage tone="warning">
                  {state?.detail || 'This workflow needs setup.'}
                </InlineMessage>
              )}
              {summary?.job ? (
                <p className="settings-working">
                  {summary.job.message}
                  {!wizard && <Link href={'/queue/' + summary.job.id}>View preparation →</Link>}
                </p>
              ) : (
                !wizard &&
                summary?.canPrepare && (
                  <Button
                    disabled={!!busy || checking || !health?.worker}
                    onClick={() => void prepare(value)}
                    variant="secondary"
                  >
                    <Download size={14} />
                    {selected?.prepareLabel || 'Download & prepare'}
                  </Button>
                )
              )}
            </section>
          );
        })}
      </div>
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
