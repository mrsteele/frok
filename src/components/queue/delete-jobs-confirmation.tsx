'use client';
import { InlineMessage } from '@/components/ui/patterns/inline-message';
import { Button } from '@/components/ui/primitives/button';
import { FormActions } from '@/components/ui/patterns/form-actions';
import { useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { api } from '@/lib/client-api';
import type { Job } from '@/lib/types';
import { ConfirmationDialog } from '@/components/ui/patterns/confirmation-dialog';
export function DeleteJobsConfirmation({
  job,
  onClose,
  onDeleted,
}: {
  job?: Job;
  onClose: () => void;
  onDeleted: (pending: boolean) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const lock = useRef(false);
  async function remove() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await api<{
        cleanupPending: boolean;
      }>(job ? `jobs/${job.id}` : 'jobs/clear', job ? 'DELETE' : 'POST');
      onDeleted(result.cleanupPending);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <ConfirmationDialog
      title={job ? 'Delete this job and its logs?' : 'Delete all finished jobs and logs?'}
      busy={busy}
      onClose={onClose}
    >
      <p>
        {job
          ? 'Permanently remove this job record, its logs and working files.'
          : 'Permanently remove all completed, failed and cancelled job records, their logs and working files. Queued and running jobs stay.'}
      </p>
      <p>
        Your saved images and videos stay in your library. Deleted job details cannot be reviewed or
        retried.
      </p>
      <p>Attached reference images are also removed when no other asset or job uses them.</p>
      {error && (
        <InlineMessage role="alert" tone="danger">
          {error}
        </InlineMessage>
      )}
      <FormActions>
        <Button disabled={busy} onClick={onClose} variant="secondary">
          Cancel
        </Button>
        <Button disabled={busy} onClick={() => void remove()} variant="danger" loading={busy}>
          {busy ? null : <Trash2 size={15} />}Delete {job ? 'job' : 'finished jobs'} &amp; logs
        </Button>
      </FormActions>
    </ConfirmationDialog>
  );
}
