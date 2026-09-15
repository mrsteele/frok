'use client';
import { ServicePanel, ConnectionStatus } from './service-panel';
import { FormActions } from '@/components/ui/patterns/form-actions';
import { Input } from '@/components/ui/primitives/input';
import { FormField } from '@/components/ui/patterns/form-field';
import { InlineMessage } from '@/components/ui/patterns/inline-message';
import { Button } from '@/components/ui/primitives/button';
import { useEffect, useRef, useState } from 'react';
import { Plug } from 'lucide-react';
import { PromptModelSettings } from './prompt-model-settings';
import { api } from '@/lib/client-api';
import type { Health } from '@/lib/types';
export function OllamaConnection({
  health,
  checking,
  onRefresh,
  enhance,
  onEnhancementChange,
  onBusyChange,
  wizard = false,
}: {
  health?: Health;
  checking: boolean;
  onRefresh: () => void;
  enhance?: boolean;
  onEnhancementChange?: (enabled: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  wizard?: boolean;
}) {
  const savedAddress = health?.connectionFields?.values.ollamaUrl || '';
  const [address, setAddress] = useState(savedAddress);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const lock = useRef(false);
  const [modelBusy, setModelBusy] = useState(false);
  useEffect(() => {
    onBusyChange?.(busy || modelBusy);
    return () => onBusyChange?.(false);
  }, [busy, modelBusy, onBusyChange]);
  useEffect(() => {
    setAddress(savedAddress);
  }, [savedAddress]);
  const state = health?.connections?.ollama,
    dirty = !!health && address.trim().replace(/\/+$/, '') !== savedAddress;
  const pending = busy || checking || !health,
    connected = !!state?.enabled && state.available;
  const models = health?.ollamaModels || [];
  async function connect() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('settings', 'PATCH', { ollamaUrl: address, connections: { ollama: true } });
      const next = await api<Health>('health?refresh=1');
      setAddress(next.connectionFields?.values.ollamaUrl || '');
      setNotice(
        next.ollamaModels?.length
          ? ''
          : 'Connected. Install a text-generation model in Ollama, then check again.',
      );
      await onRefresh();
    } catch (error) {
      setError((error as Error).message);
      onRefresh();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function disconnect() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api('settings', 'PATCH', { connections: { ollama: false } });
      onRefresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <ServicePanel
      title="Ollama"
      description="Use your installed language models to enrich prompts."
      status={
        <ConnectionStatus
          pending={pending}
          dirty={dirty}
          connected={connected}
          enabled={state?.enabled}
          dirtyLabel="Unsaved address"
        />
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void connect();
        }}
      >
        <FormField
          label="Service address"
          hint="Leave blank for the default address. Open Ollama on this computer, then connect. Its installed text-generation models will be available to choose."
        >
          <Input
            type="url"
            value={address}
            disabled={busy}
            placeholder={health?.connectionFields?.defaults.ollamaUrl || 'http://127.0.0.1:11434'}
            spellCheck={false}
            autoCapitalize="none"
            onChange={(event) => {
              setAddress(event.target.value);
              setError('');
              setNotice('');
            }}
          />
        </FormField>
        {!dirty && connected && (
          <InlineMessage tone="neutral">
            {models.length
              ? `${models.length} compatible ${models.length === 1 ? 'model' : 'models'} available.`
              : 'No compatible text-generation models are installed.'}
          </InlineMessage>
        )}
        {!dirty && state?.enabled && !state.available && (
          <InlineMessage tone="warning">{state.detail}</InlineMessage>
        )}
        {error && (
          <InlineMessage role="alert" tone="danger">
            {error}
          </InlineMessage>
        )}
        {notice && !error && (
          <InlineMessage role="status" tone="success">
            {notice}
          </InlineMessage>
        )}
        <FormActions align="start">
          <Button type="submit" disabled={pending} variant="secondary" loading={busy}>
            {busy ? (
              'Checking…'
            ) : connected ? (
              dirty ? (
                'Save & connect'
              ) : (
                'Check connection'
              )
            ) : (
              <>
                <Plug size={13} />
                Connect Ollama
              </>
            )}
          </Button>
          {state?.enabled && (
            <Button
              type="button"
              disabled={pending}
              onClick={() => void disconnect()}
              variant="ghost"
            >
              Disconnect
            </Button>
          )}
          <a
            className="settings-text-button"
            href="https://ollama.com/download"
            target="_blank"
            rel="noreferrer"
          >
            Get Ollama ↗
          </a>
        </FormActions>
      </form>
      {connected && (
        <PromptModelSettings
          embedded
          anchor={!wizard}
          health={health}
          checking={pending || dirty}
          onRefresh={onRefresh}
          enhance={enhance}
          onEnhancementChange={onEnhancementChange}
          onBusyChange={setModelBusy}
        />
      )}
    </ServicePanel>
  );
}
