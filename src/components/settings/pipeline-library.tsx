'use client';
import { Card } from '@/components/ui/patterns/card';
import { Input } from '@/components/ui/primitives/input';
import { FormField } from '@/components/ui/patterns/form-field';
import { Button } from '@/components/ui/primitives/button';
import { InlineMessage } from '@/components/ui/patterns/inline-message';
import { FormActions } from '@/components/ui/patterns/form-actions';
import { useEffect, useRef, useState } from 'react';
import { FolderOpen, RefreshCw, RotateCcw } from 'lucide-react';
import { api } from '@/lib/client-api';
import type { Health } from '@/lib/types';
import type { PipelineLibrary as Library } from '@/lib/pipelines/location';
import { pipelineRunners } from '@/lib/pipelines/schema';
import { connectionNames } from '@/lib/service-config';
import { ConfirmationDialog } from '@/components/ui/patterns/confirmation-dialog';
export function PipelineLibrary({
  health,
  checking,
  onRefresh,
}: {
  health?: Health;
  checking: boolean;
  onRefresh: () => void;
}) {
  const [library, setLibrary] = useState(health?.pipelineLibrary),
    [folder, setFolder] = useState(health?.pipelineLibrary?.configured || '');
  const [busy, setBusy] = useState(false),
    [resetting, setResetting] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const lock = useRef(false);
  useEffect(() => {
    if (health?.pipelineLibrary) setLibrary(health.pipelineLibrary);
  }, [health?.pipelineLibrary]);
  useEffect(() => {
    setFolder(health?.pipelineLibrary?.configured || '');
  }, [health?.pipelineLibrary?.configured]);
  async function run(action: 'save' | 'scan' | 'reset') {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result =
        action === 'reset'
          ? await api<Library>('pipelines/reset', 'POST', { confirm: 'RESET DEFAULT PIPELINES' })
          : action === 'save'
            ? await api<Library>('pipelines/library', 'PATCH', { path: folder })
            : await api<Library>('pipelines/library');
      setLibrary(result);
      if (action === 'save') setFolder(result.configured);
      setNotice(
        action === 'reset'
          ? `Default pipelines restored at ${result.defaultPath}.`
          : action === 'save'
            ? 'Workflow folder saved and scanned.'
            : 'Pipeline folder refreshed.',
      );
      setResetting(false);
      onRefresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const pending = busy || checking,
    dirty = folder.trim() !== (library?.configured || '');
  return (
    <Card
      className="service-card pipeline-library"
      id="workflow-files"
      aria-labelledby="pipeline-library-title"
    >
      <header>
        <div>
          <span className="pipeline-library-eyebrow">On your device</span>
          <h3 id="pipeline-library-title">Workflow files</h3>
          <p>
            One home for your workflows. Edit the files on your device, then refresh to pick up
            changes.
          </p>
        </div>
        <span className="pipeline-library-icon">
          <FolderOpen size={22} />
        </span>
      </header>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void run('save');
        }}
      >
        <FormField
          label="Workflow folder"
          hint={<>Leave empty to use {library?.defaultPath || '~/frok/pipelines'}.</>}
        >
          <Input
            value={folder}
            disabled={busy}
            placeholder={library?.defaultPath || '~/frok/pipelines'}
            spellCheck={false}
            autoCapitalize="none"
            onChange={(event) => {
              setFolder(event.target.value);
              setError('');
              setNotice('');
            }}
          />
        </FormField>
        <FormActions align="start">
          {dirty && (
            <Button type="submit" disabled={pending} variant="secondary">
              Save & scan
            </Button>
          )}
          <Button
            type="button"
            disabled={pending || dirty}
            onClick={() => void run('scan')}
            variant="ghost"
          >
            <RefreshCw size={13} className={busy ? 'spin' : ''} />
            Refresh workflows
          </Button>
          {folder && (
            <Button type="button" disabled={pending} onClick={() => setFolder('')} variant="ghost">
              Use default folder
            </Button>
          )}
        </FormActions>
      </form>
      {library && (
        <>
          <p className="pipeline-active-path">
            Reading from <code>{library.path}</code>
          </p>
          <div className="pipeline-audit-counts" aria-label="Detected workflows">
            {pipelineRunners.map((runner) => (
              <span key={runner}>
                <strong>{library.counts[runner]}</strong> {connectionNames[runner]} workflows
              </span>
            ))}
          </div>
          {!!library.errors.length && (
            <InlineMessage role="status" tone="warning">
              <strong>Some definitions could not be loaded</strong>
              <ul>
                {library.errors.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </InlineMessage>
          )}
          {!library.errors.length && (
            <InlineMessage tone="neutral">
              {Object.values(library.counts).some(Boolean)
                ? 'Detected definitions look good. Choose defaults and check readiness in Generation.'
                : 'No pipelines detected. Add workflow folders here, or restore the defaults.'}
            </InlineMessage>
          )}
        </>
      )}
      <div className="pipeline-reset-row">
        <Button
          disabled={pending || !library}
          onClick={() => {
            setError('');
            setResetting(true);
          }}
          variant="ghost"
        >
          <RotateCcw size={13} />
          Reset default pipelines
        </Button>
        <small>Restore the pipelines included with Frok.</small>
      </div>
      {error && !resetting && (
        <InlineMessage role="alert" tone="danger">
          {error}
        </InlineMessage>
      )}
      {notice && (
        <InlineMessage role="status" tone="success">
          {notice}
        </InlineMessage>
      )}
      {resetting && (
        <ConfirmationDialog
          title="Reset default pipelines?"
          busy={busy}
          onClose={() => setResetting(false)}
          icon={<RotateCcw size={22} />}
        >
          <p>
            This deletes all files in <strong>{library?.defaultPath}</strong> and replaces them with
            Frok’s bundled pipelines.
          </p>
          <p>
            Custom pipelines and edits inside that folder will be lost. Other pipeline locations,
            models, images and videos are kept. This cannot be undone.
          </p>
          {error && (
            <InlineMessage role="alert" tone="danger">
              {error}
            </InlineMessage>
          )}
          <FormActions>
            <Button
              autoFocus
              disabled={busy}
              onClick={() => setResetting(false)}
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              disabled={busy}
              onClick={() => void run('reset')}
              variant="danger"
              loading={busy}
            >
              {busy ? 'Restoring…' : 'Reset pipelines'}
            </Button>
          </FormActions>
        </ConfirmationDialog>
      )}
    </Card>
  );
}
