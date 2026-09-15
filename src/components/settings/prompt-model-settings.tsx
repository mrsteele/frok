'use client';
import { Badge } from '@/components/ui/primitives/badge';
import { Spinner } from '@/components/ui/primitives/spinner';
import { Select } from '@/components/ui/primitives/select';
import { FormField } from '@/components/ui/patterns/form-field';
import { InlineMessage } from '@/components/ui/patterns/inline-message';
import { Button } from '@/components/ui/primitives/button';
import { Checkbox } from '@/components/ui/primitives/checkbox';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { DocumentationLink } from '@/components/shell/documentation-link';
import { api } from '@/lib/client-api';
import { ollamaModelKey } from '@/lib/ollama-models';
import type { Health } from '@/lib/types';
const sameModel = (a: string, b: string) => ollamaModelKey(a) === ollamaModelKey(b);
export function PromptModelSettings({
  health,
  checking,
  onRefresh,
  embedded = false,
  anchor = true,
  enhance = false,
  onEnhancementChange,
  onBusyChange,
}: {
  health?: Health;
  checking: boolean;
  onRefresh: () => void;
  embedded?: boolean;
  anchor?: boolean;
  enhance?: boolean;
  onEnhancementChange?: (enabled: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
}) {
  const setting = health?.promptModelSetting;
  const saved = setting === null ? '__off__' : (setting ?? health?.modelSelections?.prompt ?? '');
  const effective = health?.ollamaModel || health?.recommendedPromptModel || '';
  const [value, setValue] = useState(saved),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  useEffect(() => setValue(saved), [saved]);
  useEffect(() => {
    onBusyChange?.(busy);
    return () => onBusyChange?.(false);
  }, [busy, onBusyChange]);
  const state = health?.capabilities?.prompt;
  const pending = checking || busy || value !== saved || !health;
  const connected = !!health?.connections?.ollama.enabled && health.connections.ollama.available;
  const models = connected ? health?.ollamaModels || [] : [];
  const options = models.map((model) => ({
    label: model,
    value: saved && sameModel(model, saved) ? saved : model,
  }));
  const missingModel =
    saved !== '__off__' && (!models.length || !models.some((model) => sameModel(model, effective)));
  async function choose(model: string) {
    setValue(model);
    setBusy(true);
    setError('');
    try {
      await api('settings', 'PATCH', {
        modelSelections: { prompt: model === '__off__' ? null : model },
      });
      await onRefresh();
    } catch (error) {
      setError((error as Error).message);
      setValue(saved);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      id={anchor ? 'setup-prompt' : undefined}
      className={embedded ? 'ollama-model-settings' : 'service-card model-choice'}
    >
      <header>
        <div>
          <h3>Prompt enhancement</h3>
          <p>Enrich prompts with an installed Ollama text-generation model.</p>
        </div>
        <Badge
          tone={
            pending
              ? 'neutral'
              : state?.ready
                ? 'success'
                : state?.configured
                  ? 'warning'
                  : 'neutral'
          }
        >
          {pending ? (
            <>
              <Spinner size={13} />
              Checking
            </>
          ) : state?.ready ? (
            <>
              <Check size={13} />
              Ready
            </>
          ) : state?.configured ? (
            'Setup needed'
          ) : (
            'Not configured'
          )}
        </Badge>
      </header>
      <FormField
        label="Ollama model"
        hint="Leave on Default to use the default model when it is installed, or choose another installed model."
      >
        <Select
          value={value}
          className={!value ? 'default-placeholder' : undefined}
          disabled={pending || !connected}
          onChange={(event) => void choose(event.target.value)}
        >
          <option value="">
            Default · {health?.recommendedPromptModel || 'Default Ollama model'}
          </option>
          <option value="__off__">None · Enhancement off</option>
          {!!value && value !== '__off__' && !options.some((option) => option.value === value) && (
            <option value={value} disabled>
              {value} · Connection or model unavailable
            </option>
          )}
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </FormField>
      {!connected && (
        <InlineMessage tone="neutral">
          Connect Ollama to choose a model.{' '}
          <Link href="/settings?service=ollama">Configure connection →</Link>
        </InlineMessage>
      )}
      {connected && !models.length && (
        <InlineMessage tone="neutral">
          No compatible text-generation models are installed. Install one in Ollama, then refresh
          this list.
        </InlineMessage>
      )}
      {!pending && state?.configured && !state.ready && (
        <InlineMessage tone="warning">{state.detail}</InlineMessage>
      )}
      {connected && (
        <Button disabled={pending} onClick={onRefresh} variant="ghost">
          Refresh installed models
        </Button>
      )}
      {connected && missingModel && (
        <InlineMessage tone="neutral">
          Install {effective} in Ollama, then refresh installed models.{' '}
          <DocumentationLink className="settings-documentation-link" page="/guide/model-setup" label="Installation guide" onError={setError} />
        </InlineMessage>
      )}
      {onEnhancementChange && (
        <FormField label={<span>Use Prompt Enhancement</span>} layout="toggle">
          <Checkbox
            checked={enhance}
            disabled={!health?.ollama && !enhance}
            onChange={(event) => onEnhancementChange(event.target.checked)}
          />
        </FormField>
      )}
      {error && (
        <InlineMessage role="alert" tone="danger">
          {error}
        </InlineMessage>
      )}
    </section>
  );
}
