'use client';
import { useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import type { CredentialKey, CredentialStatus } from './desktop-settings';

const providers: { key: CredentialKey; label: string; detail: string }[] = [
  { key: 'HF_TOKEN', label: 'Hugging Face', detail: 'For gated model downloads. Accept the model’s license on Hugging Face first.' },
  { key: 'COMFYUI_API_KEY', label: 'ComfyUI API key', detail: 'Only needed when your ComfyUI service requires a bearer token.' },
];
export function CredentialSettings() {
  const [status, setStatus] = useState<CredentialStatus>(), [desktop, setDesktop] = useState(false);
  const [values, setValues] = useState<Record<CredentialKey, string>>({ HF_TOKEN: '', COMFYUI_API_KEY: '' });
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => { let closed = false; setDesktop(!!window.frokDesktop); void window.frokDesktop?.credentialsStatus().then(value => { if (!closed) setStatus(value); }).catch(error => { if (!closed) setError(error.message); }); return () => { closed = true; }; }, []);
  async function save(key: CredentialKey, remove = false) {
    if (!window.frokDesktop || busy) return;
    setBusy(key); setError(''); setNotice('');
    try { setStatus(await window.frokDesktop.saveCredential(key, remove ? '' : values[key])); setValues(current => ({ ...current, [key]: '' })); setNotice(remove ? 'Token removed.' : 'Token saved securely.'); }
    catch (error) { setError((error as Error).message); } finally { setBusy(''); }
  }
  return <section className="credential-settings desktop-settings" aria-labelledby="credential-settings-title">
    <h3 id="credential-settings-title"><KeyRound size={17}/>API tokens</h3>
    <p>Tokens are encrypted with your system keychain and kept outside library backups.</p>
    {!desktop && <p>Open Frok Desktop to manage API tokens securely.</p>}
    {status && !status.available && <p role="alert">Secure storage is unavailable. Unlock your system keychain and reopen Frok.</p>}
    {status && providers.map(provider => <form key={provider.key} onSubmit={event => { event.preventDefault(); void save(provider.key); }}>
      <label className="settings-field">{provider.label}<span className="credential-state">{status.configured[provider.key] ? 'Configured' : 'Not set'}</span><small>{provider.detail}</small>
        <input type="password" autoComplete="new-password" spellCheck={false} maxLength={4096} aria-label={`${provider.label} token`} disabled={!status.available || !!busy} placeholder={status.configured[provider.key] ? 'Enter a replacement token' : 'Paste token'} value={values[provider.key]} onChange={event => setValues(current => ({ ...current, [provider.key]: event.target.value }))}/>
      </label>
      <div className="credential-actions"><button className="settings-button" disabled={!status.available || !!busy || !values[provider.key].trim()}>{busy === provider.key ? 'Saving…' : 'Save token'}</button>{status.configured[provider.key] && <button type="button" className="settings-button" disabled={!status.available || !!busy} onClick={() => void save(provider.key, true)}>Remove</button>}</div>
    </form>)}
    {notice && <p role="status">{notice}</p>}
    {status?.restartRequired && <p className="runtime-restart" role="status">Quit and reopen Frok to use the updated tokens.</p>}
    {error && <p className="viewer-error" role="alert">{error}</p>}
  </section>;
}
