'use client';
import { ChevronDown, Image as ImageIcon, Loader2, Maximize2, Play, RefreshCw } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Media } from '@/lib/types';

export function assetVideoFeatures(root: Media, selected: Media) {
  const video = selected.kind === 'video';
  const text = root.kind === 'video' && root.generation?.mode !== 'reference';
  return {
    editPrompt: !text,
    redo: video,
    upscale: video && Math.min(selected.width, selected.height) < 720,
    imagePrompt:
      !video && selected.origin === 'generated'
        ? selected.enhancedPrompt || selected.prompt
        : undefined,
  };
}

export function AssetVideoControls({
  root,
  selected,
  prompt,
  onPromptChange,
  onGenerate,
  onRedo,
  onUpscale,
  disabled,
  busy,
  upscaleDisabled,
  upscalerName,
  recipes,
  settings,
}: {
  root: Media;
  selected: Media;
  prompt: string;
  onPromptChange: (value: string) => void;
  onGenerate: () => void;
  onRedo: () => void;
  onUpscale: () => void;
  disabled: boolean;
  busy: boolean;
  upscaleDisabled: boolean;
  upscalerName: string;
  recipes?: ReactNode;
  settings?: ReactNode;
}) {
  const features = assetVideoFeatures(root, selected);
  const generateDisabled = disabled || (root.kind === 'image' && !prompt.trim());
  return (
    <div className="asset-video-controls">
      {features.imagePrompt && (
        <section className="viewer-prompt-review" aria-labelledby="viewer-image-prompt-label">
          <div className="viewer-prompt-review-heading">
            <h3 id="viewer-image-prompt-label">
              <ImageIcon size={14} />
              Image prompt
            </h3>
          </div>
          <p tabIndex={0} aria-label="Image prompt text">
            {features.imagePrompt}
          </p>
        </section>
      )}
      <div className="viewer-composer">
        {settings}
        <div className="viewer-prompt-label">
          <label htmlFor="viewer-motion-prompt">Video prompt</label>
          {!features.editPrompt && <span>Read only</span>}
        </div>
        <textarea
          id="viewer-motion-prompt"
          rows={2}
          value={features.editPrompt ? prompt : root.prompt}
          readOnly={!features.editPrompt}
          maxLength={8000}
          placeholder={root.kind === 'image' ? 'Write a custom video prompt…' : 'Describe what happens in the video…'}
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={(event) => {
            if (
              features.editPrompt &&
              !generateDisabled &&
              event.key === 'Enter' &&
              (event.metaKey || event.ctrlKey) &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              onGenerate();
            }
          }}
        />
        <div className="viewer-generation-footer">
          {recipes && (
            <details className="viewer-mode viewer-recipes">
              <summary>
                Generate with recipe
                <ChevronDown size={13} />
              </summary>
              <div className="viewer-mode-options">{recipes}</div>
            </details>
          )}
          <div className="viewer-generation-actions" aria-label="Video actions">
            {features.upscale && (
              <button
                className="secondary"
                disabled={upscaleDisabled}
                onClick={onUpscale}
                title={`Enhance with ${upscalerName}`}
              >
                <Maximize2 size={15} />
                Upscale
              </button>
            )}
            {features.redo && (
              <button
                className={!features.editPrompt ? 'viewer-render' : 'secondary'}
                disabled={disabled}
                onClick={onRedo}
                title="Repeat the saved prompt with a new seed"
              >
                <RefreshCw size={15} />
                Redo <small>New seed</small>
              </button>
            )}
            {features.editPrompt && (
              <button
                className="viewer-render"
                disabled={generateDisabled}
                onClick={onGenerate}
                title="Generate video · ⌘ / Ctrl + Enter"
              >
                {busy ? <Loader2 size={15} className="spin" /> : <Play size={15} />}Generate video
              </button>
            )}
          </div>
        </div>
        {features.editPrompt && (
          <p className="viewer-shortcut">
            ⌘ / Ctrl + Enter to generate · Enter for a new line
          </p>
        )}
      </div>
    </div>
  );
}
