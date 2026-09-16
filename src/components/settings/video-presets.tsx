'use client';
import { Button } from '@/components/ui/primitives/button';
import { InlineMessage } from '@/components/ui/patterns/inline-message';
import { FormActions } from '@/components/ui/patterns/form-actions';
import { IconButton } from '@/components/ui/primitives/icon-button';
import { Input } from '@/components/ui/primitives/input';
import { FormField } from '@/components/ui/patterns/form-field';
import { Textarea } from '@/components/ui/primitives/textarea';
import { useId, useRef, useState } from 'react';
import { Pencil, Plus, RotateCcw, Star, Trash2, X } from 'lucide-react';
import { Modal } from '@/components/ui/patterns/modal';
import type { VideoPreset } from '@/lib/types';
import { useVideoPresets } from '@/components/generation/use-video-presets';
import { ConfirmationDialog } from '@/components/ui/patterns/confirmation-dialog';
import { defaultVideoPreset, starterVideoPresets } from '@/lib/video-presets';
export function VideoPresets() {
  const editorTitleId = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const {
    presets,
    defaultPreset,
    ready,
    error,
    savePreset,
    deletePreset,
    resetPresets,
    setDefaultPreset,
  } = useVideoPresets();
  const [draft, setDraft] = useState<VideoPreset>(),
    [notice, setNotice] = useState(''),
    [failure, setFailure] = useState('');
  const [deleting, setDeleting] = useState<string>();
  const lock = useRef(false),
    [busy, setBusy] = useState(false);
  const [resetting, setResetting] = useState(false);
  function closeEditor() {
    if (lock.current) return;
    setDraft(undefined);
    setFailure('');
  }
  function edit(preset?: VideoPreset) {
    setDraft(preset ? { ...preset } : { id: crypto.randomUUID(), name: '', prompt: '' });
    setNotice('');
    setFailure('');
    setDeleting(undefined);
  }
  async function save() {
    if (!draft || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await savePreset(draft);
      setDraft(undefined);
      setNotice('Recipe saved. Choose it from Motion recipes when making a video.');
      setFailure('');
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function remove(id: string) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      const next = defaultVideoPreset(await deletePreset(id));
      setDeleting(undefined);
      setNotice(
        `Recipe deleted.${defaultPreset?.id === id ? (next ? ` ${next.name} is now the default.` : ' Add a recipe or type a prompt to generate videos.') : ''} Existing renders keep their saved recipe.`,
      );
      setFailure('');
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function makeDefault(preset: VideoPreset) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await setDefaultPreset(preset.id);
      setNotice(`${preset.name} is now the default when an image’s video prompt is empty.`);
      setFailure('');
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function reset() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      await resetPresets();
      setResetting(false);
      setDraft(undefined);
      setDeleting(undefined);
      setFailure('');
      setNotice('Starter recipes restored.');
    } catch (e) {
      setFailure((e as Error).message);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="motion-presets" aria-labelledby="motion-presets-title" aria-busy={busy}>
      <div className="preset-heading">
        <div>
          <h3 id="motion-presets-title">Motion recipes</h3>
          <p>Save reusable video prompts for movement, camera direction and style.</p>
        </div>
        <div className="preset-heading-actions">
          <Button
            disabled={busy || !ready}
            onClick={() => {
              setResetting(true);
              setDeleting(undefined);
              setFailure('');
              setNotice('');
            }}
            variant="ghost"
          >
            <RotateCcw size={13} />
            Reset recipes
          </Button>
          <Button
            disabled={busy || !ready || !!error}
            onClick={() => edit()}
            variant="primary"
          >
            <Plus size={13} />
            Add recipe
          </Button>
        </div>
      </div>
      <InlineMessage tone="neutral">
        Choose a recipe while making a video, then select Generate video when you’re ready.
        Your default recipe is used when an image’s video prompt is left empty.
      </InlineMessage>
      {ready && !error && (
        <InlineMessage role="status" tone="neutral">
          {defaultPreset ? (
            <>
              Current default: <strong>{defaultPreset.name}</strong>. You can edit or replace it
              like any other recipe.
            </>
          ) : (
            'No default recipe. Add one, or type your own video prompt when making a video.'
          )}
        </InlineMessage>
      )}
      {error && (
        <InlineMessage role="alert" tone="danger">
          <p>{error}</p>
          <p>Use Reset recipes to restore the starter recipes.</p>
        </InlineMessage>
      )}
      {resetting && (
        <ConfirmationDialog
          title="Reset recipes?"
          busy={busy}
          icon={<RotateCcw size={22} />}
          onClose={() => setResetting(false)}
        >
          <p>
            Replace all saved recipes with the starter recipes:{' '}
            {starterVideoPresets.map((preset) => preset.name).join(' and ')}?
          </p>
          <p>
            Your custom recipes and edits{draft ? ', including the unsaved draft,' : ''} will be
            removed. This cannot be undone. Existing images, videos and queued generations keep
            their saved recipes.
          </p>
          {failure && (
            <InlineMessage role="alert" tone="danger">
              {failure}
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
            <Button loading={busy} onClick={reset} variant="danger">
              Reset recipes
            </Button>
          </FormActions>
        </ConfirmationDialog>
      )}
      {!ready ? (
        <InlineMessage tone="neutral">Loading recipes…</InlineMessage>
      ) : (
        !error && (
          <div className="preset-list">
            {presets.map((preset) => (
              <div className="preset-row" key={preset.id}>
                <div className="preset-copy">
                  <strong>{preset.name}</strong>
                  <p>{preset.prompt}</p>
                </div>
                <div className="preset-actions">
                  <Button
                    type="button"
                    disabled={busy}
                    aria-pressed={!!preset.isDefault}
                    aria-label={
                      preset.isDefault
                        ? `${preset.name} is the default recipe`
                        : `Make ${preset.name} the default recipe`
                    }
                    onClick={() => makeDefault(preset)}
                    variant="secondary"
                    className="preset-default"
                  >
                    <Star size={13} fill={preset.isDefault ? 'currentColor' : 'none'} />
                    {preset.isDefault ? 'Default' : 'Make default'}
                  </Button>
                  <IconButton
                    disabled={busy}
                    aria-label={`Edit ${preset.name}`}
                    onClick={() => edit(preset)}
                    variant="ghost"
                  >
                    <Pencil size={15} />
                  </IconButton>
                  <IconButton
                    disabled={busy}
                    aria-label={`Delete ${preset.name}`}
                    onClick={() => {
                      setDeleting(preset.id);
                      setFailure('');
                    }}
                    variant="ghost"
                  >
                    <Trash2 size={15} />
                  </IconButton>
                </div>
                {deleting === preset.id && (
                  <ConfirmationDialog
                    title={`Delete “${preset.name}”?`}
                    busy={busy}
                    onClose={() => setDeleting(undefined)}
                  >
                    <p>This removes the saved recipe. Existing renders will keep their recipe.</p>
                    {preset.isDefault && (
                      <p>
                        {presets.find((item) => item.id !== preset.id)
                          ? `“${presets.find((item) => item.id !== preset.id)!.name}” will become the default recipe.`
                          : 'You will need to type a video prompt or add a recipe before generating a video from an image.'}
                      </p>
                    )}
                    {failure && (
                      <InlineMessage role="alert" tone="danger">
                        {failure}
                      </InlineMessage>
                    )}
                    <FormActions>
                      <Button
                        autoFocus
                        disabled={busy}
                        onClick={() => setDeleting(undefined)}
                        variant="secondary"
                      >
                        Cancel
                      </Button>
                      <Button loading={busy} onClick={() => remove(preset.id)} variant="danger">
                        Delete recipe
                      </Button>
                    </FormActions>
                  </ConfirmationDialog>
                )}
              </div>
            ))}
            {!presets.length && !draft && (
              <p className="preset-empty">
                No saved recipes. Add a recipe for a campaign, a character, or a favorite kind of
                motion.
              </p>
            )}
          </div>
        )
      )}
      {draft && (
        <Modal titleId={editorTitleId} className="preset-editor-dialog" busy={busy} initialFocus={nameInput} onClose={closeEditor}>
          <div className="section-header">
            <h2 id={editorTitleId}>{presets.some(preset => preset.id === draft.id) ? 'Edit recipe' : 'New recipe'}</h2>
            <IconButton aria-label="Close recipe editor" disabled={busy} onClick={closeEditor} variant="ghost">
              <X size={20}/>
            </IconButton>
          </div>
          <form
            className="preset-editor"
            onSubmit={(e) => {
              e.preventDefault();
              save();
            }}
          >
            <FormField label="Recipe name">
              <Input
                ref={nameInput}
                required
                disabled={busy}
                maxLength={60}
                value={draft.name}
                placeholder="e.g. Carguy"
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </FormField>
            <FormField label="Video prompt recipe">
              <Textarea
                required
                disabled={busy}
                rows={5}
                maxLength={4000}
                value={draft.prompt}
                placeholder="Present the car with a confident gesture, then turn to the camera with a welcoming smile. Use a smooth commercial camera move."
                onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
              />
            </FormField>
            {failure && <InlineMessage role="alert" tone="danger">{failure}</InlineMessage>}
            <FormActions>
              <Button
                type="button"
                disabled={busy}
                onClick={closeEditor}
                variant="secondary"
              >
                Cancel
              </Button>
              <Button type="submit" loading={busy} variant="primary">
                Save recipe
              </Button>
            </FormActions>
          </form>
        </Modal>
      )}
      {failure && !draft && !deleting && !resetting && (
        <InlineMessage role="alert" tone="danger">
          {failure}
        </InlineMessage>
      )}
      {notice && (
        <InlineMessage role="status" tone="success">
          {notice}
        </InlineMessage>
      )}
    </section>
  );
}
