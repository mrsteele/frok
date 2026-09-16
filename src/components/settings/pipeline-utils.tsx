'use client';
import { FormActions } from '@/components/ui/patterns/form-actions';
import { Card } from '@/components/ui/patterns/card';
import { Input } from '@/components/ui/primitives/input';
import { FormField } from '@/components/ui/patterns/form-field';
import { Select } from '@/components/ui/primitives/select';
import { Button } from '@/components/ui/primitives/button';
import { InlineMessage } from '@/components/ui/patterns/inline-message';
import { useRef, useState } from 'react';
import { Download, FolderOpen } from 'lucide-react';
import Link from 'next/link';
import { api } from '@/lib/client-api';
type Bundle = {
  base64: string;
  filename: string;
  folder: string;
  unresolved: string[];
};
function save(data: Blob, name: string) {
  const url = URL.createObjectURL(data),
    a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function PipelineUtils() {
  const [name, setName] = useState(''),
    [kind, setKind] = useState('image'),
    [runner, setRunner] = useState('vpipe');
  const [workflow, setWorkflow] = useState<Record<string, unknown>>(),
    [reading, setReading] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<Bundle>();
  const lock = useRef(false),
    upload = useRef(0);
  async function read(file: File | undefined) {
    const revision = ++upload.current;
    setWorkflow(undefined);
    setResult(undefined);
    setError('');
    setReading(false);
    if (!file) return;
    if (file.size > 1000000) {
      setError('Choose a workflow under 1 MB.');
      return;
    }
    setReading(true);
    try {
      const graph = JSON.parse(await file.text());
      if (revision !== upload.current) return;
      if (!graph || typeof graph !== 'object' || Array.isArray(graph))
        throw Error('The workflow must be a JSON object.');
      setWorkflow(graph);
    } catch (error) {
      if (revision === upload.current)
        setError(
          error instanceof SyntaxError
            ? 'The workflow is not valid JSON.'
            : (error as Error).message,
        );
    } finally {
      if (revision === upload.current) setReading(false);
    }
  }
  async function download() {
    if (lock.current || !workflow || !name.trim()) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setResult(undefined);
    try {
      const bundle = await api<Bundle>('utils/pipeline', 'POST', {
        name,
        kind,
        runner,
        graph: workflow,
      });
      const bytes = Uint8Array.from(atob(bundle.base64), (c) => c.charCodeAt(0));
      save(new Blob([bytes], { type: 'application/zip' }), bundle.filename);
      setResult(bundle);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <div className="pipeline-utils">
      <Card className="service-card" aria-labelledby="pipeline-builder-title">
        <header>
          <div>
            <h3 id="pipeline-builder-title">Create a pipeline folder</h3>
            <p>
              Turn a workflow into a Frok pipeline. Download its run file and
              metadata together in one ZIP.
            </p>
          </div>
          <FolderOpen size={21} />
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void download();
          }}
        >
          <FormField label="Pipeline name">
            <Input
              required
              value={name}
              maxLength={80}
              disabled={busy}
              placeholder="My image pipeline"
              onChange={(event) => {
                setName(event.target.value);
                setResult(undefined);
              }}
            />
          </FormField>
          <div className="settings-grid">
            <FormField label="Use for">
              <Select
                value={kind}
                disabled={busy}
                onChange={(event) => {
                  setKind(event.target.value);
                  setResult(undefined);
                }}
              >
                <option value="image">Images</option>
                <option value="video">Videos</option>
                <option value="reference">Reference videos</option>
                <option value="upscale">Video upscaling</option>
              </Select>
            </FormField>
            <FormField label="Workflow format">
              <Select
                value={runner}
                disabled={busy}
                onChange={(event) => {
                  setRunner(event.target.value);
                  setResult(undefined);
                }}
              >
                <option value="vpipe">Vpipe</option>
                <option value="comfyui">ComfyUI · API format</option>
              </Select>
            </FormField>
          </div>
          <FormField
            label="Workflow file"
            hint="Choose a native Vpipe generation pipeline or a ComfyUI API export, up to 1 MB."
          >
            <Input
              type="file"
              accept=".json,.vpipeline"
              disabled={busy}
              onChange={(event) => void read(event.target.files?.[0])}
            />
          </FormField>
          <FormActions align="start">
            <Button
              type="submit"
              disabled={busy || reading || !workflow || !name.trim()}
              variant="secondary"
              loading={busy}
            >
              <Download size={14} />
              {busy
                ? 'Building folder…'
                : reading
                  ? 'Reading workflow…'
                  : 'Download pipeline folder'}
            </Button>
          </FormActions>
        </form>
        <InlineMessage tone="neutral">
          Supported inputs and known downloads are mapped automatically. Anything that needs manual
          work is listed in REVIEW.txt. Nothing is run or installed.
        </InlineMessage>
        {error && (
          <InlineMessage role="alert" tone="danger">
            {error}
          </InlineMessage>
        )}
        {result && (
          <InlineMessage role="status" tone="success">
            <strong>
              {result.unresolved.length
                ? 'Draft downloaded · review needed'
                : 'Pipeline folder downloaded'}
            </strong>
            <p>
              Extract the ZIP into your workflow folder. It creates <code>{result.folder}/</code>.
              Review the files, then refresh{' '}
              <Link href="/settings/advanced#workflow-files">Advanced → Workflow files</Link>.
            </p>
            {!!result.unresolved.length && (
              <ul>
                {result.unresolved.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ul>
            )}
          </InlineMessage>
        )}
      </Card>
    </div>
  );
}
