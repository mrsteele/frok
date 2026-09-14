'use client';
import { Badge } from '@/components/ui/primitives/badge';
import { IconButton } from '@/components/ui/primitives/icon-button';
import { Spinner } from '@/components/ui/primitives/spinner';
import { InlineMessage } from '@/components/ui/patterns/inline-message';
import { Button } from '@/components/ui/primitives/button';
import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleAlert, X } from 'lucide-react';
import { api } from '@/lib/client-api';
import { setupWorkflows } from '@/lib/onboarding';
import type { Health, Job } from '@/lib/types';
import { BrandMark } from '@/components/shell/brand-mark';
import { Connections } from '@/components/settings/connections';
import { PipelineSettings } from '@/components/settings/pipeline-settings';
import { Modal } from '@/components/ui/patterns/modal';
const steps = ['Services', 'Generation', 'All done'];
export function SetupWizard({
  health,
  jobs,
  checking,
  onRefresh,
  enhance,
  onEnhancementChange,
  onFinished,
}: {
  health?: Health;
  jobs: Job[];
  checking: boolean;
  onRefresh: () => void;
  enhance: boolean;
  onEnhancementChange: (enabled: boolean) => void;
  onFinished: (destination?: string) => void;
}) {
  const [step, setStep] = useState(0),
    [busy, setBusy] = useState(false),
    [editing, setEditing] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false),
    body = useRef<HTMLDivElement>(null),
    titleId = useId();
  const pending = busy || editing,
    workflows = setupWorkflows(health, jobs),
    downloads = workflows.filter((item) => item.canPrepare);
  const preparing = workflows.some((item) => item.job),
    needsAttention = workflows.some((item) => !item.ready && !item.job);
  const anyReady = workflows.some((item) => item.ready);
  useEffect(() => {
    body.current?.scrollTo({ top: 0 });
    document.getElementById(titleId)?.focus();
  }, [step, titleId]);
  async function finish(destination?: string) {
    if (lock.current || editing) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      await api('settings', 'PATCH', { setupDismissed: true });
      await onRefresh();
      onFinished(destination);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function prepareTask(task: string) {
    setBusy(true);
    setError('');
    try {
      await api('setup', 'POST', { task });
      await onRefresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function next() {
    if (lock.current || editing) return;
    if (step === 0) {
      setError('');
      setStep(1);
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      // Refresh before admission so returning to this step cannot duplicate setup jobs.
      const [fresh, queue] = await Promise.all([
        api<Health>('health?refresh=1'),
        api<{
          jobs: Job[];
        }>('jobs'),
      ]);
      const missing = setupWorkflows(fresh, queue.jobs).filter((item) => item.canPrepare);
      if (missing.length && !fresh.worker)
        throw Error('The setup queue is offline. Start Frok’s worker, or choose Set up later.');
      for (const item of missing) await api('setup', 'POST', { pipelineId: item.id });
      await onRefresh();
      setStep(2);
    } catch (error) {
      setError((error as Error).message);
      await onRefresh();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const title =
    step === 0
      ? 'What do you have installed?'
      : step === 1
        ? 'What would you like to create?'
        : preparing
          ? 'Your studio is getting ready'
          : needsAttention
            ? 'Your choices are saved'
            : anyReady
              ? 'You’re ready to create'
              : 'Make yourself at home';
  return (
    <Modal
      id="quick-setup"
      titleId={titleId}
      className="setup-wizard"
      busy={pending}
      onClose={() => void finish()}
    >
      <header className="wizard-header">
        <span className="wizard-brand">
          <BrandMark size={22} />
          Frok <span>Quick setup</span>
        </span>
        <IconButton
          aria-label="Set up later"
          disabled={pending}
          onClick={() => void finish()}
          variant="ghost"
        >
          <X size={19} />
        </IconButton>
      </header>
      <ol className="wizard-steps" aria-label="Setup progress">
        {steps.map((name, index) => (
          <li
            key={name}
            aria-current={step === index ? 'step' : undefined}
            className={index < step ? 'is-complete' : ''}
          >
            <span>{index < step ? <Check size={13} /> : index + 1}</span>
            {name}
          </li>
        ))}
      </ol>
      <div className="wizard-body" ref={body}>
        <div className="wizard-intro">
          <h2 id={titleId} tabIndex={-1}>
            {title}
          </h2>
          <p>
            {step === 0
              ? 'Connect the services on your computer. Pick as many as you like, or skip for now.'
              : step === 1
                ? 'Choose a workflow for anything you want to make. Leave the rest off.'
                : preparing
                  ? 'Models are being prepared in the background. You can keep using Frok while they download.'
                  : needsAttention
                    ? 'Some workflows still need attention. You can finish their setup in Settings → Generation.'
                    : anyReady
                      ? 'Your connected tools are ready. You can change any of these choices in Settings.'
                      : 'Everything is optional. Connect services and choose workflows in Settings whenever you’re ready.'}
          </p>
        </div>
        {step === 0 && (
          <Connections
            wizard
            health={health}
            jobs={jobs}
            checking={checking}
            onRefresh={onRefresh}
            onPrepare={prepareTask}
            enhance={enhance}
            onEnhancementChange={onEnhancementChange}
            onBusyChange={setEditing}
          />
        )}
        {step === 1 && (
          <>
            <PipelineSettings
              wizard
              health={health}
              jobs={jobs}
              checking={checking}
              onRefresh={onRefresh}
              onBusyChange={setEditing}
            />
            {downloads.length > 0 && (
              <p className="wizard-download-note">
                Continuing queues downloads for {downloads.length} selected{' '}
                {downloads.length === 1 ? 'workflow' : 'workflows'}. Models can be large; you’ll
                need internet and free disk space.
              </p>
            )}
          </>
        )}
        {step === 2 && (
          <div className="wizard-summary">
            {workflows.map((item) => (
              <div key={item.kind}>
                <Badge tone={item.ready ? 'success' : item.job ? 'neutral' : 'warning'}>
                  {item.ready ? (
                    <Check size={17} />
                  ) : item.job ? (
                    <Spinner size={17} />
                  ) : (
                    <CircleAlert size={17} />
                  )}
                </Badge>
                <div>
                  <strong>{item.name}</strong>
                  <p>{item.workflow?.name || 'Workflow unavailable'}</p>
                </div>
                <small>
                  {item.ready
                    ? 'Ready'
                    : item.job
                      ? item.job.status === 'running'
                        ? 'Preparing'
                        : 'Queued'
                      : 'Needs setup'}
                </small>
              </div>
            ))}
            {health?.connections?.ollama.enabled && (
              <div>
                <span className={health.ollama ? 'settings-ready' : 'settings-pending'}>
                  {health.ollama ? <Check size={17} /> : <CircleAlert size={17} />}
                </span>
                <div>
                  <strong>Prompt enhancement</strong>
                  <p>
                    {enhance && health.ollama
                      ? health.ollamaModel
                      : 'You can enable this in Services.'}
                  </p>
                </div>
                <small>{enhance && health.ollama ? 'On' : 'Off'}</small>
              </div>
            )}
            {!workflows.length && !health?.connections?.ollama.enabled && (
              <div>
                <Check size={20} />
                <div>
                  <strong>Your studio, at your pace</strong>
                  <p>Open Quick setup from Services to return here.</p>
                </div>
              </div>
            )}
            {preparing && (
              <p className="wizard-download-note">
                Keep Frok running and your computer awake. Follow progress in the queue.
              </p>
            )}
          </div>
        )}
        {error && (
          <InlineMessage role="alert" tone="danger">
            {error}
          </InlineMessage>
        )}
      </div>
      <footer className="wizard-footer">
        <div>
          {step > 0 ? (
            <Button
              disabled={pending}
              onClick={() => {
                setError('');
                setStep(step - 1);
              }}
              variant="ghost"
            >
              <ArrowLeft size={14} />
              Back
            </Button>
          ) : (
            <Button disabled={pending} onClick={() => void finish()} variant="ghost">
              Set up later
            </Button>
          )}
        </div>
        <div>
          {step === 2 && preparing && (
            <Button disabled={pending} onClick={() => void finish('/queue')} variant="secondary">
              View queue
            </Button>
          )}
          <Button
            disabled={pending || (step < 2 && (checking || !health))}
            onClick={() => void (step === 2 ? finish() : next())}
            variant="primary"
            loading={busy}
          >
            {busy
              ? 'Saving…'
              : step === 2
                ? 'Open Frok'
                : step === 1 && downloads.length
                  ? 'Download & finish'
                  : 'Continue'}
            {!busy && <ArrowRight size={14} />}
          </Button>
        </div>
      </footer>
    </Modal>
  );
}
