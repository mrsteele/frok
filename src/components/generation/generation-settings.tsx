'use client';
import { SettingsDialog } from '@/components/ui/patterns/settings-dialog';
import type { Generation, Health, VideoPreset } from '@/lib/types';
import { PipelineSelect } from './pipeline-select';
import { selectedPipeline } from '@/lib/pipelines/schema';
import { motionChoices } from '@/lib/video-presets';
import { PromptEnhancementToggle } from './prompt-enhancement-toggle';

export function GenerationSettings({
  request,
  health,
  presets,
  presetError,
  storageError,
  disabled,
  stagedSource = false,
  onPatch,
  onChoose,
  onDone,
}: {
  request: Generation;
  health?: Health;
  presets: VideoPreset[];
  presetError: string;
  storageError?: string;
  disabled: boolean;
  stagedSource?: boolean;
  onPatch: (change: Partial<Generation>) => void;
  onChoose: (value: string) => void;
  onDone: () => void;
}) {
  const pipeline = selectedPipeline(health, request.mode, request.pipelineId);
  return (
    <SettingsDialog
      id="generation-settings"
      title={`${request.mode === 'image' ? 'Image' : 'Video'} generation settings`}
      onClose={onDone}
    >
      <div className="settings-grid">
        <PipelineSelect
          kind={request.mode}
          value={request.pipelineId}
          source={!!request.sourceId}
          health={health}
          onChange={onPatch}
        />
        <label>
          {request.mode === 'image' ? 'Image quality' : 'Video resolution'}
          <select
            value={request.quality}
            onChange={(e) => onPatch({ quality: e.target.value as Generation['quality'] })}
          >
            {request.mode === 'image' ? (
              <>
                <option
                  value="preview"
                  disabled={!!pipeline && !pipeline.controls.qualities.includes('preview')}
                >
                  Fast previews · 512px
                </option>
                <option
                  value="standard"
                  disabled={!!pipeline && !pipeline.controls.qualities.includes('standard')}
                >
                  Full size · 1024px
                </option>
              </>
            ) : (
              <>
                <option
                  value="preview"
                  disabled={!!pipeline && !pipeline.controls.qualities.includes('preview')}
                >
                  480p · Default
                </option>
                <option
                  value="standard"
                  disabled={!!pipeline && !pipeline.controls.qualities.includes('standard')}
                >
                  720p · HD generation
                </option>
              </>
            )}
          </select>
        </label>
        {request.mode === 'image' && (
          <label>
            Images per batch
            <select
              value={request.count}
              onChange={(e) => onPatch({ count: Number(e.target.value) })}
            >
              {[1, 4, 8, 12].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? 'image' : 'images'}
                </option>
              ))}
            </select>
          </label>
        )}
        <label>
          Seed
          <input
            type="number"
            min={0}
            max={2147483647}
            placeholder="Random each time"
            value={request.seed ?? ''}
            onChange={(e) =>
              onPatch({ seed: e.target.value === '' ? undefined : Number(e.target.value) })
            }
          />
        </label>
      </div>
      {request.mode === 'video' && request.sourceId && (
        <>
          <label className="composer-motion-style">
            {stagedSource ? 'Motion recipe' : 'Render with recipe'}
            <select
              value={
                stagedSource && request.videoStyle === 'preset'
                  ? `preset:${request.videoPreset?.id}`
                  : 'custom'
              }
              disabled={disabled}
              onChange={(e) => onChoose(e.target.value)}
            >
              {motionChoices(presets).map((item) => (
                <option key={item.value} value={item.value}>
                  {item.name}
                  {item.isDefault ? ' (Default)' : ''}
                </option>
              ))}
            </select>
          </label>
          <p className="settings-hint">
            {stagedSource
              ? 'Choose a recipe, then click Generate when you’re ready.'
              : 'Choose a recipe to render immediately.'}{' '}
            Custom uses your text, or your default recipe when left empty.
          </p>
          {presetError && (
            <p className="viewer-error">
              Motion recipes could not be loaded. Check Settings → Recipes.
            </p>
          )}
        </>
      )}
      <PromptEnhancementToggle
        health={health}
        enabled={request.enhance}
        image={request.mode === 'image'}
        onChange={(enhance) => onPatch({ enhance })}
      />
      <p className={storageError ? 'viewer-error' : 'settings-hint'} role="status">
        {storageError || 'Your last-used controls are saved automatically.'}
      </p>
    </SettingsDialog>
  );
}
