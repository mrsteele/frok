'use client';
import { ServicePanel, ConnectionStatus } from './service-panel';
import { FormActions } from '@/components/ui/patterns/form-actions';
import { Input } from '@/components/ui/primitives/input';
import { FormField } from '@/components/ui/patterns/form-field';
import { Button } from '@/components/ui/primitives/button';
import { InlineMessage } from '@/components/ui/patterns/inline-message';
import { useEffect, useRef, useState } from 'react';
import { Plug, RefreshCw } from 'lucide-react';
import { api } from '@/lib/client-api';
import { connectionNames } from '@/lib/service-config';
import type { Health, Runner } from '@/lib/types';
export function RunnerConnection({
  id,
  health,
  checking,
  onRefresh,
  onBusyChange,
}: {
  id: Runner;
  health?: Health;
  checking: boolean;
  onRefresh: () => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const savedFolder =
    (id === 'vpipe'
      ? health?.connectionFields?.values.vpipeWorkdir
      : health?.connectionFields?.values.comfyDir) || '';
  const savedAddress = health?.connectionFields?.values.comfyUrl || '';
  const [folder, setFolder] = useState(savedFolder),
    [address, setAddress] = useState(savedAddress);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  useEffect(() => {
    setFolder(savedFolder);
  }, [savedFolder]);
  useEffect(() => {
    setAddress(savedAddress);
  }, [savedAddress]);
  const state = health?.connections?.[id],
    connected = !!state?.enabled && state.available;
  const dirty =
    !!health &&
    (folder.trim() !== savedFolder ||
      (id === 'comfyui' && address.trim().replace(/\/+$/, '') !== savedAddress));
  const pending = busy || checking || !health;
  function edit() {
    setError('');
    setNotice('');
  }
  async function save(disconnect = false) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    edit();
    try {
      await api(
        'settings',
        'PATCH',
        disconnect
          ? { connections: { [id]: false } }
          : {
              connections: { [id]: true },
              ...(id === 'vpipe'
                ? { vpipeWorkdir: folder }
                : { comfyDir: folder, comfyUrl: address }),
            },
      );
      const next = await api<Health>('health?refresh=1');
      if (!disconnect) {
        setFolder(
          (id === 'vpipe'
            ? next.connectionFields?.values.vpipeWorkdir
            : next.connectionFields?.values.comfyDir) || '',
        );
        setAddress(next.connectionFields?.values.comfyUrl || '');
      }
      setNotice(
        disconnect
          ? 'Disconnected.'
          : dirty
            ? 'Connection saved and checked. Pipeline readiness refreshed.'
            : 'Connection checked. Pipeline readiness refreshed.',
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
  const defaults = health?.connectionFields?.defaults;
  return (
    <ServicePanel
      title={connectionNames[id]}
      description={
        id === 'vpipe'
          ? 'Images and video through native Metal on Apple Silicon.'
          : 'Use pipelines and models from your local ComfyUI installation.'
      }
      status={
        <ConnectionStatus
          pending={pending}
          dirty={dirty}
          connected={connected}
          enabled={state?.enabled}
        />
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        {id === 'comfyui' && (
          <FormField
            label="Service address"
            hint="Start ComfyUI first. Desktop normally uses port 8000; manual installations use 8188."
          >
            <Input
              type="url"
              disabled={busy}
              value={address}
              placeholder={defaults?.comfyUrl || 'http://127.0.0.1:8000'}
              spellCheck={false}
              autoCapitalize="none"
              onChange={(event) => {
                setAddress(event.target.value);
                edit();
              }}
            />
          </FormField>
        )}
        <FormField
          label={id === 'vpipe' ? 'Model workspace' : 'ComfyUI folder'}
          hint={
            id === 'vpipe'
              ? 'Leave blank to use the default workspace. New model downloads use this location.'
              : 'Leave blank to use the default folder, or choose the folder containing models, input and output.'
          }
        >
          <Input
            disabled={busy}
            value={folder}
            placeholder={
              id === 'vpipe'
                ? defaults?.vpipeWorkdir || '~/vpipe'
                : defaults?.comfyDir || '~/Documents/ComfyUI'
            }
            spellCheck={false}
            autoCapitalize="none"
            onChange={(event) => {
              setFolder(event.target.value);
              edit();
            }}
          />
        </FormField>
        {(folder || (id === 'comfyui' && address)) && (
          <Button
            type="button"
            disabled={pending}
            onClick={() => {
              setFolder('');
              if (id === 'comfyui') setAddress('');
              edit();
            }}
            variant="ghost"
            className="connection-defaults"
          >
            Use default location
          </Button>
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
            ) : dirty ? (
              'Save & check'
            ) : connected ? (
              <>
                <RefreshCw size={13} />
                Check connection
              </>
            ) : (
              <>
                <Plug size={13} />
                Connect {connectionNames[id]}
              </>
            )}
          </Button>
          {state?.enabled && (
            <Button
              type="button"
              disabled={pending}
              onClick={() => void save(true)}
              variant="ghost"
            >
              Disconnect
            </Button>
          )}
          <a
            className="settings-text-button"
            href={id === 'vpipe' ? 'https://vpipe.ai/' : 'https://www.comfy.org/download'}
            target="_blank"
            rel="noreferrer"
          >
            Get {connectionNames[id]} ↗
          </a>
        </FormActions>
      </form>
    </ServicePanel>
  );
}
