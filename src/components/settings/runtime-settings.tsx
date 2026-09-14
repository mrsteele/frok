'use client';
import { Card } from '@/components/ui/patterns/card';
import { Input } from '@/components/ui/primitives/input';
import { FormField } from '@/components/ui/patterns/form-field';
import { Checkbox } from '@/components/ui/primitives/checkbox';
import { Button } from '@/components/ui/primitives/button';
import { InlineMessage } from '@/components/ui/patterns/inline-message';
import { useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { api } from '@/lib/client-api';
import type { RuntimeOptions } from '@/lib/preferences';
type State = {
  options: RuntimeOptions;
};
export function RuntimeSettings({ onRefresh }: { onRefresh: () => void }) {
  const [state, setState] = useState<State>(),
    [draft, setDraft] = useState<RuntimeOptions>();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false);
  useEffect(() => {
    let closed = false;
    void api<State>('settings/runtime')
      .then((value) => {
        if (!closed) {
          setState(value);
          setDraft((current) => current ?? value.options);
        }
      })
      .catch((error) => {
        if (!closed) setError(error.message);
      });
    return () => {
      closed = true;
    };
  }, []);
  async function save() {
    setBusy(true);
    setError('');
    setSaved(false);
    try {
      const value: State = await api('settings/runtime', 'PATCH', draft);
      setState(value);
      setDraft(value.options);
      setSaved(true);
      onRefresh();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const changed = JSON.stringify(state?.options) !== JSON.stringify(draft);
  return (
    <Card className="runtime-settings desktop-settings" aria-labelledby="runtime-settings-title">
      <h3 id="runtime-settings-title">
        <SlidersHorizontal size={17} />
        Background tasks & tools
      </h3>
      {draft && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy}>
            <FormField
              id="video-tools-folder"
              label="Video tools folder"
              hint="FFmpeg and FFprobe are included. Leave this blank, or choose your own tools folder. Save, then refresh connections to check an override."
            >
              <Input
                type="text"
                value={draft.mediaToolsDirectory}
                placeholder="Use the tools included with Frok"
                onChange={(event) => {
                  setDraft({ ...draft, mediaToolsDirectory: event.target.value });
                  setSaved(false);
                }}
              />
            </FormField>
            <FormField
              label={
                <span>
                  Live image previews
                  <small>
                    Show intermediate images during rendering. Turn off to reduce memory use and
                    extra decoding.
                  </small>
                </span>
              }
              layout="toggle"
            >
              <Checkbox
                checked={draft.liveImagePreviews}
                onChange={(event) => {
                  setDraft({ ...draft, liveImagePreviews: event.target.checked });
                  setSaved(false);
                }}
              />
            </FormField>
            <FormField
              label="Job timeout"
              hint="Applies when the next render starts. Model downloads use their own timeout."
              className="runtime-timeout"
            >
              <span className="runtime-timeout-input">
                <Input
                  type="number"
                  min={1}
                  max={10080}
                  step={1}
                  required
                  value={Number.isNaN(draft.jobTimeoutMinutes) ? '' : draft.jobTimeoutMinutes}
                  onChange={(event) => {
                    setDraft({ ...draft, jobTimeoutMinutes: event.target.valueAsNumber });
                    setSaved(false);
                  }}
                />
                <span>minutes</span>
              </span>
            </FormField>
            <FormField
              label={
                <span>
                  Automatically delete finished jobs and logs
                  <small>
                    Includes completed, failed and cancelled jobs. Saved media stays in your
                    library. Turn off to keep job details until you delete them.
                  </small>
                </span>
              }
              layout="toggle"
            >
              <Checkbox
                checked={draft.jobRetentionHours !== null}
                onChange={(event) => {
                  setDraft({ ...draft, jobRetentionHours: event.target.checked ? 3 : null });
                  setSaved(false);
                }}
              />
            </FormField>
            {draft.jobRetentionHours !== null && (
              <FormField
                label="Delete job details after"
                hint="Measured from when the job finishes. Applies to existing jobs. Cleanup checks about once a minute while Frok is running and catches up after reopening."
                className="runtime-timeout"
              >
                <span className="runtime-timeout-input">
                  <Input
                    type="number"
                    min={1}
                    max={8760}
                    step={1}
                    required
                    value={Number.isNaN(draft.jobRetentionHours) ? '' : draft.jobRetentionHours}
                    onChange={(event) => {
                      setDraft({ ...draft, jobRetentionHours: event.target.valueAsNumber });
                      setSaved(false);
                    }}
                  />
                  <span>hours</span>
                </span>
              </FormField>
            )}
            <Button disabled={!changed || busy} variant="secondary" type="submit" loading={busy}>
              {busy ? 'Saving…' : 'Save preferences'}
            </Button>
          </fieldset>
        </form>
      )}
      {saved && !changed && (
        <InlineMessage role="status" tone="success">
          Preferences saved.
        </InlineMessage>
      )}
      {error && (
        <InlineMessage role="alert" tone="danger">
          {error}
        </InlineMessage>
      )}
    </Card>
  );
}
