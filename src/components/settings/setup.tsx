'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, CircleAlert, Layers3, Plug, SlidersHorizontal, Sparkles, WandSparkles, X } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/primitives/button';
import { Badge } from '@/components/ui/primitives/badge';
import { IconButton } from '@/components/ui/primitives/icon-button';
import { InlineMessage } from '@/components/ui/patterns/inline-message';
import { Modal } from '@/components/ui/patterns/modal';
import { BrandMark } from '@/components/shell/brand-mark';
import { api } from '@/lib/client-api';
import { isPreparationJob } from '@/lib/preparation-job';
import { setupWorkflows } from '@/lib/onboarding';
import type { Health, Job, SetupRequest } from '@/lib/types';
import { settingsPath, type SettingsSection } from '@/lib/navigation';
import { settingsAttention } from '@/lib/settings-attention';
import { VideoPresets } from './video-presets';
import { ResetLibrary } from './reset-library';
import { Connections } from './connections';
import { PipelineSettings } from './pipeline-settings';
import { PipelineLibrary } from './pipeline-library';
import { DesktopSettings } from './desktop-settings';
import { RuntimeSettings } from './runtime-settings';
import { CredentialSettings } from './credential-settings';
import { LegalNotice } from '@/components/shell/legal-notice';

const tabs = [
  { id: 'services', label: 'Services', icon: Plug },
  { id: 'generation', label: 'Generation', icon: Layers3 },
  { id: 'recipes', label: 'Recipes', icon: Sparkles },
  { id: 'advanced', label: 'Advanced', icon: SlidersHorizontal },
] as const;
const steps = ['Welcome', 'Services', 'Generation', 'Review'];
const introductions = {
  services: { title: 'Connect your local tools', description: 'Connect Vpipe or ComfyUI to generate images and videos. Ollama is optional, for prompt enhancement.' },
  generation: { title: 'Choose how you create', description: 'Choose a default workflow for the things you want to make. You can leave the others off and add them later.' },
};

export function Setup({
  wizard = false, health, jobs = [], section = 'services', checkingHealth = false,
  resetting = false, onResetting, onRefresh, enhance = false, onEnhancementChange,
  onOnboarding, onFinished,
}: {
  wizard?: boolean;
  health?: Health;
  jobs?: Job[];
  section?: Exclude<SettingsSection, 'welcome'>;
  checkingHealth?: boolean;
  resetting?: boolean;
  onResetting?: (pending: boolean) => void;
  onRefresh: () => void;
  enhance?: boolean;
  onEnhancementChange?: (enabled: boolean) => void;
  onOnboarding?: () => void;
  onFinished?: (destination?: string) => void;
}) {
  const [step, setStep] = useState(0), [saving, setSaving] = useState(false),
    [editing, setEditing] = useState(false), [error, setError] = useState('');
  const lock = useRef(false), body = useRef<HTMLDivElement>(null), titleId = useId();
  const pending = saving || editing;
  const attention = settingsAttention(health), workflows = setupWorkflows(health);
  const preparing = jobs.some(job => isPreparationJob(job) && ['queued', 'running'].includes(job.status));
  const needsAttention = workflows.some(item => !item.ready), anyReady = workflows.some(item => item.ready);
  const runnerConnected = [health?.connections?.vpipe, health?.connections?.comfyui].some(connection => connection?.enabled && connection.available);
  const current = wizard ? (['welcome', 'services', 'generation', 'summary'] as const)[step] : section;
  const intro = current === 'services' || current === 'generation' ? introductions[current] : undefined;
  const title = intro?.title || (current === 'welcome' ? 'Welcome to Frok' : preparing ? 'Your setup is underway' : needsAttention ? 'Your choices are saved' : anyReady ? 'You’re ready to create' : 'Set up your first workflow');
  useEffect(() => {
    if (!wizard) return;
    body.current?.scrollTo({ top: 0 });
    document.getElementById(titleId)?.focus();
  }, [wizard, step, titleId]);
  async function finish(destination?: string) {
    if (lock.current || editing) return;
    lock.current = true;
    setSaving(true);
    setError('');
    try {
      await api('settings', 'PATCH', { setupDismissed: true });
      await onRefresh();
      onFinished?.(destination);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  const Heading = wizard ? 'h2' : 'h3';
  // Services and Generation have one rendering path in both modes.
  const content = <>
    {intro && <div className="settings-section-heading settings-intro">
      <div>
        <Heading id={wizard ? titleId : undefined} tabIndex={wizard ? -1 : undefined}>{intro.title}</Heading>
        <p>{intro.description}</p>
      </div>
      {!wizard && current === 'services' && onOnboarding && <Button onClick={onOnboarding} variant="ghost">
        <WandSparkles size={14} />Quick setup</Button>}
    </div>}
    {current === 'services' && <Connections wizard={wizard} health={health} checking={checkingHealth} onRefresh={onRefresh} enhance={enhance} onEnhancementChange={onEnhancementChange} onBusyChange={setEditing} />}
    {current === 'generation' && <PipelineSettings wizard={wizard} health={health} jobs={jobs} checking={checkingHealth} onRefresh={onRefresh} onBusyChange={setEditing} onOpenJob={wizard ? id => void finish(`/queue/${id}`) : undefined} />}
    {current === 'welcome' && <div className="wizard-welcome">
      <div className="wizard-intro">
        <h2 id={titleId} tabIndex={-1}>Welcome to Frok</h2>
        <p>Create images and videos with your local AI tools. Keep your prompts, queue, and creations together in one place.</p>
      </div>
      <iframe className="welcome-demo" src="/docs/welcome-demo.html" title="Frok demonstration: a prompt becomes an image, then a video" tabIndex={-1} />
      <p className="welcome-footnote">You’ll connect Vpipe or ComfyUI, then choose a model. Ollama can help with prompts, but isn’t required. Your creations stay on your computer.</p>
    </div>}
    {current === 'summary' && <>
      <div className="wizard-intro">
        <h2 id={titleId} tabIndex={-1}>{title}</h2>
        <p>{preparing ? 'Model preparation continues in Queue. You can explore Frok while it runs.' : needsAttention ? 'Finish the setup below to use these workflows, or explore Frok and return to Settings later.' : anyReady ? 'Your connected tools are ready. You can change these choices in Settings.' : 'To generate, connect a local tool and choose a workflow. You can do that now or return to Settings later.'}</p>
      </div>
      <div className="wizard-summary">
        {workflows.map(item => {
          const job = jobs.find(job => isPreparationJob(job)
            && (job.request as SetupRequest).preparation === item.workflow?.preparation
            && ['queued', 'running'].includes(job.status));
          const connection = item.workflow && health?.connections?.[item.workflow.runner];
          const needsConnection = !!item.workflow && !(connection?.enabled && connection.available);
          return <div key={item.kind}>
            <Badge tone={item.ready ? 'success' : 'warning'}>{item.ready ? <Check size={17} /> : <CircleAlert size={17} />}</Badge>
            <div>
              <strong>{item.name}</strong>
              <p>{item.workflow?.name || 'Workflow unavailable'}</p>
            </div>
            <div className="wizard-summary-actions">
              <small>{item.ready ? 'Ready' : job?.status === 'queued' ? 'Queued' : job?.status === 'running' ? 'Preparing' : 'Needs setup'}</small>
              {!item.ready && (job ? (
                <Button size="compact" variant="ghost" disabled={pending} onClick={() => void finish(`/queue/${job.id}`)}>
                  View progress<ArrowRight size={13} />
                </Button>
              ) : (
                <Button
                  size="compact"
                  variant="ghost"
                  disabled={pending}
                  aria-label={`${needsConnection ? 'Connect service' : 'Finish setup'} for ${item.name.toLowerCase()}`}
                  onClick={() => { setError(''); setStep(needsConnection ? 1 : 2); }}
                >
                  {needsConnection ? 'Connect service' : 'Finish setup'}<ArrowRight size={13} />
                </Button>
              ))}
            </div>
          </div>;
        })}
        {health?.connections?.ollama.enabled && <div>
          <Badge tone={enhance && health.ollama ? 'success' : 'neutral'}>
            <Sparkles size={17} />
          </Badge>
          <div>
            <strong>Prompt enhancement</strong>
            <p>{enhance && health.ollama ? health.ollamaModel : enhance ? 'Check the Ollama connection and prompt model in Services.' : 'Optional. You can enable this in Services.'}</p>
          </div>
          <div className="wizard-summary-actions">
            <small>{enhance && health.ollama ? 'On' : enhance ? 'Needs setup' : 'Off'}</small>
            {enhance && !health.ollama && (
              <Button size="compact" variant="ghost" disabled={pending} onClick={() => { setError(''); setStep(1); }}>
                Check Ollama<ArrowRight size={13} />
              </Button>
            )}
          </div>
        </div>}
        {!workflows.length && <div>
          <Layers3 size={20} />
          <div>
            <strong>No generation workflow selected</strong>
            <p>{runnerConnected ? 'Choose an image or video workflow to get started.' : 'Connect Vpipe or ComfyUI before choosing a workflow.'}</p>
          </div>
          <div className="wizard-summary-actions">
            <Button size="compact" variant="ghost" disabled={pending} onClick={() => { setError(''); setStep(runnerConnected ? 2 : 1); }}>
              {runnerConnected ? 'Choose a workflow' : 'Connect a service'}<ArrowRight size={13} />
            </Button>
          </div>
        </div>}
      </div>
    </>}
    {current === 'recipes' && <VideoPresets />}
    {current === 'advanced' && <div className="advanced-settings">
      <div className="settings-section-heading">
        <h3>Make Frok your own</h3>
        <p>Workflow files, access tokens, background tasks, and your library.</p>
      </div>
      <PipelineLibrary health={health} checking={checkingHealth} onRefresh={onRefresh} />
      <CredentialSettings />
      <RuntimeSettings onRefresh={onRefresh} />
      <DesktopSettings />
      <ResetLibrary onPending={onResetting} />
      <LegalNotice />
    </div>}
    {error && <InlineMessage role="alert" tone="danger">{error}</InlineMessage>}
  </>;
  if (wizard) return <Modal id="quick-setup" titleId={titleId} className="setup-wizard" busy={pending} onClose={() => void finish()}>
    <header className="wizard-header">
      <span className="wizard-brand">
        <BrandMark size={22} />Frok <span>Quick setup</span>
      </span>
      <IconButton aria-label="Set up later" disabled={pending} onClick={() => void finish()} variant="ghost">
        <X size={19} />
      </IconButton>
    </header>
    <ol className="wizard-steps" aria-label="Setup progress">{steps.map((name, index) => <li key={name} aria-current={step === index ? 'step' : undefined} className={index < step ? 'is-complete' : ''}>
      <span>{index < step ? <Check size={13} /> : index + 1}</span>{name}</li>)}</ol>
    <div className="wizard-body" ref={body}>{content}</div>
    <footer className="wizard-footer">
      <div>{step > 0 ? <Button disabled={pending} onClick={() => { setError(''); setStep(step - 1); }} variant="ghost">
        <ArrowLeft size={14} />Back</Button> : <Button disabled={pending} onClick={() => void finish()} variant="ghost">Set up later</Button>}</div>
      <Button disabled={pending || (step > 0 && step < 3 && (checkingHealth || !health))} onClick={() => { if (step === 3) void finish(); else if (!pending) { setError(''); setStep(step + 1); } }} variant="primary" loading={saving}>{saving ? 'Saving…' : step === 0 ? 'Get started' : step === 3 ? 'Open Frok' : 'Continue'}{!saving && <ArrowRight size={14} />}</Button>
    </footer>
  </Modal>;
  return <div className="settings-page">
    <nav inert={resetting} className="settings-tabs" aria-label="Settings sections">{tabs.map(tab => {
      const badge = tab.id === 'services' ? attention.connection : tab.id === 'generation' ? attention.models : undefined;
      return <Link key={tab.id} href={settingsPath(tab.id)} aria-current={section === tab.id ? 'page' : undefined}>
        <tab.icon size={15} />{tab.label}{badge && <span className={'settings-attention ' + badge} role="img" aria-label={badge === 'error' ? 'Action required' : 'Needs attention'} />}</Link>;
    })}</nav>
    <div className="settings-body">{content}</div>
  </div>;
}
