'use client';
import { Card } from '@/components/ui/patterns/card';
import { InlineMessage } from '@/components/ui/patterns/inline-message';
import { Input } from '@/components/ui/primitives/input';
import { FormField } from '@/components/ui/patterns/form-field';
import { Button } from '@/components/ui/primitives/button';
import { FormActions } from '@/components/ui/patterns/form-actions';
import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import type { CredentialKey, CredentialStatus } from './desktop-settings';
const providers: {
  key: CredentialKey;
  label: string;
  detail: string;
}[] = [
  {
    key: 'HF_TOKEN',
    label: 'Hugging Face',
    detail: 'For gated model downloads. Accept the model’s license on Hugging Face first.',
  },
  {
    key: 'COMFYUI_API_KEY',
    label: 'ComfyUI API key',
    detail: 'Only needed when your ComfyUI service requires a bearer token.',
  },
];
export function CredentialSettings() {
  const [status, setStatus] = useState<CredentialStatus>(),
    [desktop, setDesktop] = useState(false);
  const [values, setValues] = useState<Record<CredentialKey, string>>({
    HF_TOKEN: '',
    COMFYUI_API_KEY: '',
  });
  const [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  useEffect(() => {
    let closed = false;
    setDesktop(!!window.frokDesktop);
    void window.frokDesktop
      ?.credentialsStatus()
      .then((value) => {
        if (!closed) setStatus(value);
      })
      .catch((error) => {
        if (!closed) setError(error.message);
      });
    return () => {
      closed = true;
    };
  }, []);
  async function save(key: CredentialKey, remove = false) {
    if (!window.frokDesktop || busy) return;
    setBusy(key);
    setError('');
    setNotice('');
    try {
      setStatus(await window.frokDesktop.saveCredential(key, remove ? '' : values[key]));
      setValues((current) => ({ ...current, [key]: '' }));
      setNotice(remove ? 'Token removed.' : 'Token saved securely.');
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy('');
    }
  }
  return (
    <Card
      id="api-tokens"
      className="credential-settings desktop-settings"
      aria-labelledby="credential-settings-title"
    >
      <h3 id="credential-settings-title">
        <KeyRound size={17} />
        API tokens
      </h3>
      <p>
        Tokens are encrypted with your system keychain and saved in application data, outside your
        portable workspace and backups.
      </p>
      {!desktop && <p>Open Frok Desktop to manage API tokens securely.</p>}
      {status && !status.available && (
        <InlineMessage role="alert" tone="danger">
          Secure storage is unavailable. Unlock your system keychain and reopen Frok.
        </InlineMessage>
      )}
      {status &&
        providers.map((provider) => (
          <form
            key={provider.key}
            onSubmit={(event) => {
              event.preventDefault();
              void save(provider.key);
            }}
          >
            <FormField
              label={
                <>
                  {provider.label}
                  <span className="credential-state">
                    {status.configured[provider.key] ? 'Configured' : 'Not set'}
                  </span>
                </>
              }
              hint={provider.detail}
            >
              <Input
                type="password"
                autoComplete="new-password"
                spellCheck={false}
                maxLength={4096}
                aria-label={`${provider.label} token`}
                disabled={!status.available || !!busy}
                placeholder={
                  status.configured[provider.key] ? 'Enter a replacement token' : 'Paste token'
                }
                value={values[provider.key]}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [provider.key]: event.target.value }))
                }
              />
            </FormField>
            <FormActions>
              <Button
                disabled={!status.available || !!busy || !values[provider.key].trim()}
                variant="secondary"
                type="submit"
                loading={busy === provider.key}
              >
                {busy === provider.key ? 'Saving…' : 'Save token'}
              </Button>
              {status.configured[provider.key] && (
                <Button
                  type="button"
                  disabled={!status.available || !!busy}
                  onClick={() => void save(provider.key, true)}
                  variant="secondary"
                >
                  Remove
                </Button>
              )}
            </FormActions>
          </form>
        ))}
      {notice && (
        <InlineMessage role="status" tone="success">
          {notice}
        </InlineMessage>
      )}
      {status?.restartRequired && (
        <InlineMessage role="status" tone="neutral">
          Quit and reopen Frok to use the updated tokens.
        </InlineMessage>
      )}
      {error && (
        <InlineMessage role="alert" tone="danger">
          {error}
        </InlineMessage>
      )}
    </Card>
  );
}
