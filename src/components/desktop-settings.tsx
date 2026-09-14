'use client';
import { useEffect, useState } from 'react';
import { FolderOpen, Monitor } from 'lucide-react';

export type CredentialKey = 'HF_TOKEN' | 'COMFYUI_API_KEY';
export type CredentialStatus = { available: boolean; configured: Record<CredentialKey, boolean>; restartRequired: boolean };
type UpdateState = { status: 'disabled' | 'idle' | 'checking' | 'downloading' | 'ready' | 'waiting' | 'installing' | 'error'; message: string; version?: string; percent?: number };
type DesktopInfo = { version: string; workspace: string; pipelines: string; development: boolean; update: UpdateState };
declare global {
  interface Window {
    frokDesktop?: { credentialsStatus: () => Promise<CredentialStatus>; saveCredential: (key: CredentialKey, value: string) => Promise<CredentialStatus>; info: () => Promise<DesktopInfo>; checkUpdates: () => Promise<UpdateState>; installUpdate: () => Promise<void>; cancelUpdateRestart: () => Promise<void>; onUpdate: (callback: (state: UpdateState) => void) => () => void; openDocs: (page?: string) => Promise<void>; openPipelines: () => Promise<void>; openLogs: () => Promise<void>; openPipelineUpdates: () => Promise<void> };
  }
}
export function DesktopSettings() {
  const [info, setInfo] = useState<DesktopInfo>(), [error, setError] = useState('');
  const [update, setUpdate] = useState<UpdateState>();
  useEffect(() => {
    let closed = false;
    const unsubscribe = window.frokDesktop?.onUpdate(setUpdate);
    void window.frokDesktop?.info().then(value => { if (!closed) { setInfo(value); setUpdate(current => current || value.update); } }).catch(() => { if (!closed) setError('Desktop information is unavailable.'); });
    return () => { closed = true; unsubscribe?.(); };
  }, []);
  if (!info) return error ? <p role="alert">{error}</p> : null;
  async function open(kind: 'openPipelines' | 'openLogs' | 'openPipelineUpdates' | 'openDocs') { try { await window.frokDesktop?.[kind](); setError(''); } catch { setError(kind === 'openDocs' ? 'Documentation could not be opened.' : 'The folder could not be opened.'); } }
  async function updateAction() {
    try {
      setError('');
      if (update?.status === 'ready') await window.frokDesktop?.installUpdate();
      else if (update?.status === 'waiting') await window.frokDesktop?.cancelUpdateRestart();
      else await window.frokDesktop?.checkUpdates();
    } catch { setError('The update action could not be completed. Try again.'); }
  }
  return <section className="desktop-settings" aria-labelledby="desktop-settings-title">
    <div className="section-header"><h3 id="desktop-settings-title"><Monitor size={17}/>Frok Desktop</h3><span>v{info.version}{info.development ? ' · Development' : ''}</span></div>
    <p>Your workspace</p><code>{info.workspace}</code>
    <div className="desktop-settings-actions"><button className="settings-button" onClick={() => void open('openPipelines')}><FolderOpen size={14}/>Pipelines</button><button className="settings-button" onClick={() => void open('openLogs')}>App logs</button><button className="settings-button" onClick={() => void open('openPipelineUpdates')}>Pipeline updates</button></div>
    <p>Closing the window keeps Frok running in the menu bar. Use Quit Frok to stop the app.</p>
    <button className="settings-button" onClick={() => void open('openDocs')}>Documentation · Available offline</button>
    {update && <div className="desktop-updates">
      <p role="status">{update.message}</p>
      {update.status === 'downloading' && <progress aria-label="Update download" value={update.percent || 0} max={100}/>}
      {update.status !== 'disabled' && <button className="settings-button" disabled={['checking', 'downloading', 'installing'].includes(update.status)} onClick={() => void updateAction()}>{update.status === 'ready' ? 'Restart to update' : update.status === 'waiting' ? 'Cancel scheduled restart' : update.status === 'checking' ? 'Checking…' : update.status === 'downloading' ? `Downloading… ${update.percent || 0}%` : update.status === 'installing' ? 'Installing…' : update.status === 'error' ? 'Retry update' : 'Check for updates'}</button>}
    </div>}
    {error && <p className="viewer-error" role="alert">{error}</p>}
  </section>;
}
