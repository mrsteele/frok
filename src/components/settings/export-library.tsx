'use client';
import { Button } from '@/components/ui/primitives/button';
import { InlineMessage } from '@/components/ui/patterns/inline-message';
import { useEffect, useRef, useState } from 'react';
import { flushInterfacePreferences } from '@/lib/client-preferences';
import { Download, X } from 'lucide-react';
import { type LibraryExport } from '@/lib/export-preferences';
export function ExportLibrary({
  disabled = false,
  onBusyChange,
}: {
  disabled?: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<LibraryExport>();
  const controller = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => controller.current?.abort(), []);
  async function exportData() {
    if (controller.current || disabled) return;
    const pending = new AbortController();
    controller.current = pending;
    setBusy(true);
    onBusyChange(true);
    setError('');
    setResult(undefined);
    try {
      await flushInterfacePreferences();
      const response = await fetch('/api/library/export', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        signal: pending.signal,
        headers: { 'Content-Type': 'application/json', 'X-Frok-Request': '1' },
        body: JSON.stringify({}),
      });
      const backup = (await response.json()) as LibraryExport & {
        error?: string;
      };
      if (!response.ok) throw Error(backup.error || 'Could not prepare the backup.');
      pending.signal.throwIfAborted();
      setResult(backup);
      const link = document.createElement('a');
      link.href = backup.download;
      link.download = backup.filename;
      document.body.append(link);
      link.click();
      link.remove();
    } catch (e) {
      setError(
        pending.signal.aborted
          ? 'Export cancelled. Your data has not changed.'
          : (e as Error).message,
      );
    } finally {
      controller.current = undefined;
      setBusy(false);
      onBusyChange(false);
    }
  }
  return (
    <section className="library-export" aria-labelledby="library-export-title" aria-busy={busy}>
      <h3 id="library-export-title">Export my data</h3>
      <p>
        Save your images, videos, favorites, prompts, queue logs, recipes, settings and pipeline
        definitions in one backup. Models and installed runners are not included. Preparing the
        archive requires temporary disk space.
      </p>
      <div className="library-export-actions">
        <Button
          type="button"
          disabled={disabled || busy}
          onClick={() => void exportData()}
          variant="secondary"
          loading={busy}
        >
          {busy ? null : <Download size={14} />} {busy ? 'Preparing backup…' : 'Export all my data'}
        </Button>
        {busy && (
          <Button type="button" onClick={() => controller.current?.abort()} variant="ghost">
            <X size={14} />
            Cancel
          </Button>
        )}
      </div>
      {busy && (
        <InlineMessage role="status" tone="success">
          Preparing a .tar.gz archive. Large libraries can take a while; queued work resumes when it
          is ready.
        </InlineMessage>
      )}
      {result && (
        <InlineMessage role="status" tone="neutral">
          <p>
            Backup ready · {(result.bytes / 1024 ** 2).toFixed(1)} MB.{' '}
            <a href={result.download} download={result.filename}>
              Download again
            </a>
          </p>
          <p>
            Make sure the download finishes and the archive opens before deleting anything. Recovery
            instructions are included; automatic import is not available yet.
          </p>
          {result.warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </InlineMessage>
      )}
      {error && (
        <InlineMessage role="alert" tone="danger">
          {error}
        </InlineMessage>
      )}
    </section>
  );
}
