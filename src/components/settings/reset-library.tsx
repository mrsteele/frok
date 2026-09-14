'use client';
import { Button } from '@/components/ui/primitives/button';
import { InlineMessage } from '@/components/ui/patterns/inline-message';
import { Input } from '@/components/ui/primitives/input';
import { FormField } from '@/components/ui/patterns/form-field';
import { FormActions } from '@/components/ui/patterns/form-actions';
import { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api, resetBrowserStorage } from '@/lib/client-api';
import { ConfirmationDialog } from '@/components/ui/patterns/confirmation-dialog';
import { ExportLibrary } from './export-library';
export function ResetLibrary({ onPending }: { onPending?: (pending: boolean) => void }) {
  const [confirming, setConfirming] = useState(false),
    [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [deleted, setDeleted] = useState(false);
  const [exporting, setExporting] = useState(false);
  const locked = useRef(false);
  function cancel() {
    setConfirming(false);
    setConfirmation('');
    setError('');
  }
  async function remove() {
    if (confirmation !== 'DELETE' || locked.current || exporting) return;
    locked.current = true;
    setBusy(true);
    setError('');
    onPending?.(true);
    try {
      if (!deleted) {
        await api('library', 'DELETE', { confirm: 'DELETE ALL DATA' });
        setDeleted(true);
      }
      resetBrowserStorage();
      // A full reload discards media, jobs and composer state.
      window.location.replace('/');
    } catch (e) {
      setError((e as Error).message);
      locked.current = false;
      setBusy(false);
      if (!deleted) onPending?.(false);
    }
  }
  return (
    <>
      <ExportLibrary disabled={busy || confirming || deleted} onBusyChange={setExporting} />
      <section className="reset-library" aria-labelledby="reset-library-title">
        <h3 id="reset-library-title">Delete all my stuff</h3>
        <p>
          Permanently delete all images, videos, favorites, history, jobs and settings. Saved
          recipes and local preferences will also be reset. Downloaded models, pipeline files and
          API tokens are kept.
        </p>
        <Button disabled={exporting} onClick={() => setConfirming(true)} variant="danger">
          <Trash2 size={14} />
          Delete all my stuff
        </Button>
        {confirming && (
          <ConfirmationDialog title="Delete all my stuff?" busy={busy || deleted} onClose={cancel}>
            <form
              className="reset-library-form"
              onSubmit={(e) => {
                e.preventDefault();
                void remove();
              }}
            >
              {busy && (
                <InlineMessage role="status" tone="success">
                  Stopping your jobs and removing your data. This may take a moment.
                </InlineMessage>
              )}
              <p>
                Permanently delete the entire library, including favorites, uploads, jobs, settings,
                recipes and retained copies from the previous version.
              </p>
              <p>
                This cannot be undone. Downloaded models, installed runners, pipeline files and API
                tokens are kept.
              </p>
              <FormField label="Type DELETE to confirm">
                <Input
                  autoFocus
                  autoComplete="off"
                  spellCheck={false}
                  value={confirmation}
                  disabled={busy || deleted}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </FormField>
              {error && (
                <InlineMessage role="alert" tone="danger">
                  {deleted
                    ? 'Your server data was deleted. Local cleanup needs to be retried: '
                    : ''}
                  {error}
                </InlineMessage>
              )}
              <FormActions>
                <Button
                  type="button"
                  disabled={busy || deleted}
                  onClick={cancel}
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={busy || confirmation !== 'DELETE'}
                  variant="danger"
                  loading={busy}
                >
                  {busy ? null : <Trash2 size={14} />}{' '}
                  {deleted
                    ? 'Retry local cleanup'
                    : busy
                      ? 'Deleting…'
                      : 'Permanently delete all my stuff'}
                </Button>
              </FormActions>
            </form>
          </ConfirmationDialog>
        )}
      </section>
    </>
  );
}
