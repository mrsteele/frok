'use client';
import { Button } from '@/components/ui/primitives/button';
import { InlineMessage } from '@/components/ui/patterns/inline-message';
import { useCallback, useEffect, useId, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Check, ChevronRight, Plug, RefreshCw } from 'lucide-react';
import type { Health } from '@/lib/types';
import { connectionIds, connectionNames, type ConnectionId } from '@/lib/service-config';
import { OllamaConnection } from './ollama-connection';
import { RunnerConnection } from './runner-connection';
const descriptions = {
  vpipe: 'Images & videos',
  comfyui: 'Images, videos & workflows',
  ollama: 'Prompt enhancement',
};
export function Connections({
  health,
  checking,
  onRefresh,
  enhance,
  onEnhancementChange,
  wizard = false,
  onBusyChange,
}: {
  health?: Health;
  checking: boolean;
  onRefresh: () => void;
  enhance?: boolean;
  onEnhancementChange?: (enabled: boolean) => void;
  wizard?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [selected, setSelected] = useState<ConnectionId | undefined>(() =>
    connectionIds.find((id) => health?.connections?.[id].enabled),
  );
  const [busy, setBusy] = useState(false);
  const editorId = useId();
  const requested = useSearchParams()?.get('service');
  useEffect(() => {
    const id = connectionIds.find((id) => id === requested);
    if (!wizard && id) setSelected(id);
  }, [requested, wizard]);
  const pending = useCallback(
    (value: boolean) => {
      setBusy(value);
      onBusyChange?.(value);
    },
    [onBusyChange],
  );
  return (
    <>
      <div className="service-picker" aria-label="Local services">
        {connectionIds.map((id) => {
          const state = health?.connections?.[id],
            connected = state?.enabled && state.available;
          return (
            <Button
              key={id}
              type="button"
              aria-pressed={selected === id}
              aria-controls={editorId}
              disabled={busy}
              onClick={() => setSelected(id)}
              variant="secondary"
              className="service-tile"
            >
              <span className="service-tile-top">
                <strong>{connectionNames[id]}</strong>
                {connected ? <Check size={16} className="settings-ready" /> : <Plug size={16} />}
              </span>
              <span>{descriptions[id]}</span>
              <small
                className={connected ? 'settings-ready' : state?.enabled ? 'settings-pending' : ''}
              >
                {!health
                  ? 'Checking…'
                  : connected
                    ? 'Connected'
                    : state?.enabled
                      ? 'Needs attention'
                      : 'Connect service'}
                <ChevronRight size={12} />
              </small>
            </Button>
          );
        })}
      </div>
      <div id={editorId} className="service-editor">
        {!selected ? (
          <p className="service-picker-hint">
            Choose a service above to connect it. Only connect what you have installed.
          </p>
        ) : selected === 'ollama' ? (
          <OllamaConnection
            health={health}
            checking={checking}
            onRefresh={onRefresh}
            enhance={enhance}
            onEnhancementChange={onEnhancementChange}
            onBusyChange={pending}
            wizard={wizard}
          />
        ) : (
          <RunnerConnection
            key={selected}
            id={selected}
            health={health}
            checking={checking}
            onRefresh={onRefresh}
            onBusyChange={pending}
          />
        )}
      </div>
      {!wizard && (
        <div className="settings-next-step">
          <Button disabled={checking || busy} onClick={onRefresh} variant="ghost">
            <RefreshCw size={13} className={checking ? 'spin' : ''} />
            Refresh services
          </Button>
          <Link href="/settings/generation">
            Choose how to generate
            <ChevronRight size={14} />
          </Link>
        </div>
      )}
      {health?.checks
        .filter((check) => ['worker', 'ffmpeg'].includes(check.id) && !check.ready)
        .map((check) => (
          <InlineMessage
            id={wizard ? undefined : 'setup-' + check.id}
            key={check.id}
            role="status"
            tone="warning"
          >
            {check.name}: {check.detail}
          </InlineMessage>
        ))}
    </>
  );
}
