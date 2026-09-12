'use client';
import { useRef, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import { api, resetBrowserStorage } from '@/lib/client-api';
import { ConfirmationDialog } from './confirmation-dialog';
import { ExportLibrary } from './export-library';

export function ResetLibrary({ onPending }: { onPending?: (pending: boolean) => void }) {
  const [confirming, setConfirming] = useState(false), [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [deleted, setDeleted] = useState(false);
  const [exporting,setExporting]=useState(false);
  const locked = useRef(false);
  function cancel(){setConfirming(false);setConfirmation('');setError('');}
  async function remove() {
    if (confirmation !== 'DELETE' || locked.current || exporting) return;
    locked.current = true; setBusy(true); setError(''); onPending?.(true);
    try {
      if (!deleted) { await api('library', 'DELETE', { confirm: 'DELETE ALL DATA' }); setDeleted(true); }
      resetBrowserStorage();
      // A full reload discards media, jobs and composer state.
      window.location.replace('/');
    } catch (e) { setError((e as Error).message); locked.current = false; setBusy(false); if (!deleted) onPending?.(false); }
  }
  return <><ExportLibrary disabled={busy||confirming||deleted} onBusyChange={setExporting}/><section className="reset-library" aria-labelledby="reset-library-title">
    <h3 id="reset-library-title">Delete all my stuff</h3>
    <p>Permanently delete all images, videos, favorites, history, jobs and settings. Saved recipes and local preferences will also be reset. Downloaded models, pipeline files and API tokens are kept.</p>
    <button className="settings-button danger" disabled={exporting} onClick={() => setConfirming(true)}><Trash2 size={14}/>Delete all my stuff</button>
    {confirming && <ConfirmationDialog title="Delete all my stuff?" busy={busy||deleted} onClose={cancel}><form className="reset-library-form" onSubmit={e => { e.preventDefault(); void remove(); }}>
      {busy && <p role="status">Stopping your jobs and removing your data. This may take a moment.</p>}
      <p>Permanently delete the entire library, including favorites, uploads, jobs, settings, recipes and retained copies from the previous version.</p>
      <p>This cannot be undone. Downloaded models, installed runners, pipeline files and API tokens are kept.</p>
      <label className="settings-field">Type DELETE to confirm<input autoFocus autoComplete="off" spellCheck={false} value={confirmation} disabled={busy || deleted} onChange={e => setConfirmation(e.target.value)}/></label>
      {error && <p role="alert">{deleted ? 'Your server data was deleted. Local cleanup needs to be retried: ' : ''}{error}</p>}
      <div className="delete-actions"><button className="secondary" type="button" disabled={busy || deleted} onClick={cancel}>Cancel</button><button className="delete-confirm" type="submit" disabled={busy || confirmation !== 'DELETE'}>{busy ? <Loader2 size={14} className="spin"/> : <Trash2 size={14}/>} {deleted ? 'Retry local cleanup' : busy ? 'Deleting…' : 'Permanently delete all my stuff'}</button></div>
    </form></ConfirmationDialog>}
  </section></>;
}
