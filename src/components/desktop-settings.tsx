'use client';
import { useEffect, useState } from 'react';
import { FolderOpen, Monitor } from 'lucide-react';

export type CredentialKey = 'HF_TOKEN' | 'COMFYUI_API_KEY';
export type CredentialStatus = { available: boolean; configured: Record<CredentialKey, boolean>; restartRequired: boolean };
type DesktopInfo = { version: string; workspace: string; pipelines: string; development: boolean; updatesConfigured: boolean };
declare global {
  interface Window {
    frokDesktop?: { credentialsStatus: () => Promise<CredentialStatus>; saveCredential: (key: CredentialKey, value: string) => Promise<CredentialStatus>; info: () => Promise<DesktopInfo>; openDocs: (page?: string) => Promise<void>; openPipelines: () => Promise<void>; openLogs: () => Promise<void>; openPipelineUpdates: () => Promise<void> };
  }
}
export function DesktopSettings() {
  const [info, setInfo] = useState<DesktopInfo>(), [error, setError] = useState('');
  useEffect(() => { let closed = false; void window.frokDesktop?.info().then(value => { if (!closed) setInfo(value); }).catch(() => { if (!closed) setError('Desktop information is unavailable.'); }); return () => { closed = true; }; }, []);
  if (!info) return error ? <p role="alert">{error}</p> : null;
  async function open(kind: 'openPipelines' | 'openLogs' | 'openPipelineUpdates' | 'openDocs') { try { await window.frokDesktop?.[kind](); setError(''); } catch { setError(kind === 'openDocs' ? 'Documentation could not be opened.' : 'The folder could not be opened.'); } }
  return <section className="desktop-settings" aria-labelledby="desktop-settings-title">
    <div className="section-header"><h3 id="desktop-settings-title"><Monitor size={17}/>Frok Desktop</h3><span>v{info.version}{info.development ? ' · Development' : ''}</span></div>
    <p>Your workspace</p><code>{info.workspace}</code>
    <div className="desktop-settings-actions"><button className="settings-button" onClick={() => void open('openPipelines')}><FolderOpen size={14}/>Pipelines</button><button className="settings-button" onClick={() => void open('openLogs')}>Logs</button><button className="settings-button" onClick={() => void open('openPipelineUpdates')}>Pipeline updates</button></div>
    <p>Closing the window keeps Frok running in the menu bar. Use Quit Frok to stop the app.</p>
    <button className="settings-button" onClick={() => void open('openDocs')}>Documentation · Available offline</button>
    <div className="desktop-update-placeholder"><button className="settings-button" disabled>Check for updates</button><span>Updates are not configured yet.</span></div>
    {error && <p className="viewer-error" role="alert">{error}</p>}
  </section>;
}
