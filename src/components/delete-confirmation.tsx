'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Trash2 } from 'lucide-react';
import type { DeletePlan, DeleteTarget } from '@/lib/types';
import { api } from '@/lib/client-api';
import { ConfirmationDialog } from './confirmation-dialog';

export function DeleteConfirmation({ target, onClose, onDeleted }: { target: DeleteTarget; onClose: () => void; onDeleted: (ids: string[], cleanupPending: boolean) => void }) {
  const [plan, setPlan] = useState<DeletePlan>(), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const load = useCallback(() => api<DeletePlan>('deletion/preview', 'POST', target), [target]);
  useEffect(() => { let closed = false; load().then(value => { if (!closed) setPlan(value); }).catch(e => { if (!closed) setError(e.message); }); return () => { closed = true; }; }, [load]);
  async function confirm() {
    if (!plan || (!plan.total && target.scope !== 'section') || plan.blocked || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { const result = await api<{ deletedIds: string[]; cleanupPending: boolean }>('deletion', 'POST', { target, token: plan.token }); onDeleted(result.deletedIds, result.cleanupPending); onClose(); }
    catch (e) { setError((e as Error).message); setPlan(undefined); try { setPlan(await load()); } catch {} }
    finally { lock.current = false; setBusy(false); }
  }
  const images = (plan?.images || 0) - (plan?.referenceImages || 0);
  const counts = plan && [images && `${images} ${images === 1 ? 'image' : 'images'}`, plan.referenceImages && `${plan.referenceImages} reference ${plan.referenceImages === 1 ? 'image' : 'images'}`, plan.videos && `${plan.videos} ${plan.videos === 1 ? 'video' : 'videos'}`, plan.hdVersions && `${plan.hdVersions} HD ${plan.hdVersions === 1 ? 'version' : 'versions'}`].filter(Boolean).join(', ');
  const subject = plan ? images ? 'image' : 'video' : 'creation';
  const title = target.scope === 'section' ? 'Delete this prompt section?' : target.scope === 'history' ? 'Clear unsaved creations?' : `Delete this ${subject}?`;
  return <ConfirmationDialog title={title} busy={busy} onClose={onClose}>
    <p>{target.scope === 'section' ? 'Delete the unsaved creations in this prompt section. Favorited images and all their videos will stay in the section and your library.' : target.scope === 'history' ? 'Remove unsaved generations. Favorites and all their versions, uploaded root images, and media used by active jobs will stay.' : images ? plan?.videos ? 'Delete this image and all of its attached videos.' : 'Delete this image from your library.' : (plan?.videos || 0) > 1 ? 'Delete this video creation, its renders and HD versions.' : 'Delete this video and its HD versions.'}</p>
    {!!plan?.referenceImages && <p>Attached reference images are removed only when no other asset or job uses them.</p>}
    {plan ? <p className="delete-count">{plan.total ? `Will delete: ${counts}.` : target.scope === 'section' ? 'No unsaved files to delete. Associated inactive jobs can be removed; favorites stay.' : 'Nothing to delete. Your saved and active creations are protected.'}</p> : !error && <p className="delete-count"><Loader2 size={14} className="spin"/>Checking what will be removed…</p>}
    {target.scope === 'section' && !!plan?.protectedCount && <p>{plan.protectedCount} favorited {plan.protectedCount === 1 ? 'file is' : 'files are'} protected.</p>}
    {plan && plan.favorites > 0 && <p className="delete-warning">This affects {plan.favorites} saved {plan.favorites === 1 ? 'creation' : 'creations'} in Favorites.</p>}
    {plan?.blocked && <p className="delete-warning" role="alert">{plan.blocked}</p>}
    {error && <p className="delete-warning" role="alert">{error}</p>}
    {!!plan?.jobs && <p>This also deletes {plan.jobs} associated {plan.jobs === 1 ? 'job' : 'jobs'}, including logs and working files. A batch’s job details may be shared with other saved images; those images stay in your library.</p>}
    {!!plan?.total && <small>This permanently deletes the selected media and associated job data. It can’t be undone.</small>}
    <div className="delete-actions"><button className="secondary" autoFocus disabled={busy} onClick={onClose}>Cancel</button><button className="delete-confirm" disabled={busy || !plan || (!plan.total && target.scope !== 'section') || !!plan.blocked} onClick={() => void confirm()}>{busy ? <Loader2 size={15} className="spin"/> : <Trash2 size={15}/>} {target.scope === 'history' ? 'Clear unsaved' : target.scope === 'section' ? 'Delete section' : 'Delete'}</button></div>
  </ConfirmationDialog>;
}
