'use client';
import type { Health } from '@/lib/types';
import { promptEnhancementIssue } from '@/lib/readiness';

export function PromptEnhancementToggle({
  health,
  enabled,
  image = false,
  onChange,
}: {
  health?: Health;
  enabled: boolean;
  image?: boolean;
  onChange: (enabled: boolean) => void;
}) {
  const issue = promptEnhancementIssue(health, enabled);
  const description = image
    ? 'Create a different detailed prompt for each image.'
    : 'Add detail with your selected prompt model.';
  const setup =
    issue?.message ||
    (!health?.ollama ? 'Choose a prompt enhancement model in Settings → Services.' : '');
  return (
    <label className="toggle-row">
      <span>
        <strong>Prompt enhancement</strong>
        <small>
          {description}
          {setup && ` ${setup}`}
        </small>
      </span>
      <input
        type="checkbox"
        aria-label="Prompt enhancement"
        checked={enabled}
        disabled={!health?.ollama && !enabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}
