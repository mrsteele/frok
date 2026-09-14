'use client';
import { PipelineSelect } from './pipeline-select';
import { selectedPipeline } from '@/lib/pipelines/schema';
import type { Generation, Health } from '@/lib/types';
import { PromptEnhancementToggle } from './prompt-enhancement-toggle';

export type VideoRenderPreferences = Pick<
  Generation,
  'duration' | 'quality' | 'seed' | 'enhance' | 'pipelineId'
>;
export function VideoRenderControls({
  value,
  health,
  disabled,
  onChange,
  storageError,
  mode = 'video',
  source = true,
  allowSeed = true,
}: {
  allowSeed?: boolean;
  mode?: 'video' | 'reference';
  source?: boolean;
  value: VideoRenderPreferences;
  health?: Health;
  disabled: boolean;
  onChange: (change: Partial<VideoRenderPreferences>) => void;
  storageError?: string;
}) {
  const pipeline = selectedPipeline(health, mode, value.pipelineId);
  return (
    <fieldset className="video-render-controls" disabled={disabled}>
      <legend className="visually-hidden">Video generation settings</legend>
      <div className="settings-grid">
        <PipelineSelect
          kind={mode}
          value={value.pipelineId}
          source={source}
          health={health}
          disabled={disabled}
          onChange={onChange}
        />
        <label>
          Duration
          <select
            aria-label="Video duration"
            value={value.duration}
            onChange={(event) => onChange({ duration: Number(event.target.value) })}
          >
            {(pipeline?.controls.durations || [6, 8, 10]).map((seconds) => (
              <option key={seconds} value={seconds}>
                {seconds} seconds
              </option>
            ))}
          </select>
        </label>
        <label>
          Resolution
          <select
            aria-label="Video resolution"
            value={value.quality}
            onChange={(event) => onChange({ quality: event.target.value as Generation['quality'] })}
          >
            <option
              value="preview"
              disabled={!!pipeline && !pipeline.controls.qualities.includes('preview')}
            >
              480p · SD
            </option>
            <option
              value="standard"
              disabled={!!pipeline && !pipeline.controls.qualities.includes('standard')}
            >
              720p · HD
            </option>
          </select>
        </label>
        {allowSeed && (
          <label>
            Seed
            <input
              type="number"
              min={0}
              max={2147483647}
              step={1}
              placeholder="Random each time"
              value={value.seed ?? ''}
              onChange={(event) =>
                onChange({
                  seed: event.target.value === '' ? undefined : Number(event.target.value),
                })
              }
            />
          </label>
        )}
      </div>
      <PromptEnhancementToggle
        health={health}
        enabled={value.enhance}
        onChange={(enhance) => onChange({ enhance })}
      />
      <p className="settings-hint">
        {source ? 'Proportions follow the starting image. ' : ''}Your choices are saved
        automatically. 720p renders directly at higher resolution; AI upscaling is available after
        rendering.
      </p>
      {storageError && (
        <p className="viewer-error" role="status">
          {storageError}
        </p>
      )}
    </fieldset>
  );
}
