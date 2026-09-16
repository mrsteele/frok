import { z } from 'zod';
import type { Generation, VideoPreset, VideoStyle } from './types';

export const videoPresetsKey = 'userPrompts';
export const videoPresetSchema = z.object({
  id: z.string().min(1).max(80).regex(/^[a-zA-Z0-9_-]+$/, 'Use a simple, unique recipe ID.'),
  name: z.string().trim().min(1, 'Give this recipe a name.').max(60, 'Keep the name under 61 characters.'),
  prompt: z.string().trim().min(1, 'Describe what this recipe should do.').max(4000, 'Keep the recipe under 4,001 characters.'),
  isDefault: z.boolean().optional(),
});
const presetsSchema = z.array(videoPresetSchema).max(100, 'You can save up to 100 recipes.').superRefine((items, ctx) => {
  const ids = new Set<string>(), names = new Set(['custom']);
  if (items.filter(item => item.isDefault).length > 1) ctx.addIssue({ code: 'custom', message: 'Choose only one default recipe.' });
  for (const item of items) {
    if (ids.has(item.id)) ctx.addIssue({ code: 'custom', message: 'Each recipe needs a unique ID.' });
    if (names.has(item.name.toLowerCase())) ctx.addIssue({ code: 'custom', message: 'Choose a unique name; Custom is reserved for typed prompts.' });
    ids.add(item.id); names.add(item.name.toLowerCase());
  }
});
export const starterVideoPresets: readonly VideoPreset[] = [
  { id: 'normal', name: 'Normal', isDefault: true, prompt: 'The picture comes to life with basic movement, no fast camera changes or movement. Continue the action described in the image while preserving the subjects and setting.' },
  { id: 'zany', name: 'Silly', isDefault: false, prompt: 'Bring the scene to life with wildly playful movement, exaggerated reactions and unexpected visual comedy.' },
  { id: 'dance', name: 'Dance', isDefault: false, prompt: 'Bring the subjects to life with a dance that matches the mood, setting and atmosphere of the image. Choose fitting steps and a natural rhythm: relaxed swaying in a calm scene, lively footwork in an energetic one. Preserve the subjects, clothing and surroundings, and keep movement coherent with their bodies and available space.' },
];
export function validateVideoPresets(value: unknown): VideoPreset[] {
  const result = presetsSchema.safeParse(value);
  if (!result.success) throw new Error(result.error.issues[0].message);
  return result.data;
}
export function decodeVideoPresets(raw: string | null): VideoPreset[] {
  if (raw === null) return starterVideoPresets.map(preset => ({ ...preset }));
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error('Saved recipes contain invalid JSON.'); }
  let presets = validateVideoPresets(value);
  // Rename untouched starter recipes while preserving edits and custom names.
  presets = presets.map(preset => {
    const starter = starterVideoPresets.find(item => item.id === preset.id && item.prompt === preset.prompt);
    const oldName = preset.id === 'zany' ? 'Zany' : undefined;
    return starter && preset.name === oldName && !presets.some(item => item.name.toLowerCase() === starter.name.toLowerCase())
      ? { ...preset, name: starter.name } : preset;
  });
  // Older lists had no default flag. Keep their edits and move the former
  // built-in Normal action into the list once. An empty list stays empty.
  if (presets.length && presets.every(preset => preset.isDefault === undefined)) {
    const normal = presets.find(preset => preset.name.toLowerCase() === 'normal');
    if (normal) return assignDefaultVideoPreset(presets, normal.id);
    if (presets.length < 100) {
      let id = 'normal';
      for (let suffix = 2; presets.some(preset => preset.id === id); suffix++) id = `normal-${suffix}`;
      presets = [{ ...starterVideoPresets[0], id }, ...presets];
    }
  }
  return normalizeVideoPresetDefaults(presets);
}
export const defaultVideoPreset = (presets: readonly VideoPreset[]) => presets.find(preset => preset.isDefault);
export function assignDefaultVideoPreset(presets: VideoPreset[], id: string): VideoPreset[] {
  if (!presets.some(preset => preset.id === id)) throw new Error('That recipe is no longer available.');
  return validateVideoPresets(presets.map(preset => ({ ...preset, isDefault: preset.id === id })));
}
export function normalizeVideoPresetDefaults(presets: VideoPreset[]): VideoPreset[] {
  const valid = validateVideoPresets(presets);
  const selected = defaultVideoPreset(valid) ?? valid[0];
  return selected ? assignDefaultVideoPreset(valid, selected.id) : [];
}
export function needsDefaultVideoPreset(input: Generation): boolean {
  return input.mode === 'video' && !!input.sourceId && (input.videoStyle === 'normal' ||
    ((!input.videoStyle || input.videoStyle === 'custom') && !input.prompt.trim()));
}
export function applyDefaultVideoPreset(input: Generation, presets: readonly VideoPreset[]): Generation {
  if (!needsDefaultVideoPreset(input)) return input;
  const preset = defaultVideoPreset(presets);
  if (!preset) throw new Error('Add a default recipe in Settings → Recipes, or type a video prompt.');
  return { ...input, prompt: '', videoStyle: 'preset', videoPreset: videoPresetSchema.parse(preset) };
}
export type MotionChoice = { value: string; name: string; description: string; videoStyle: VideoStyle; videoPreset?: VideoPreset; isDefault?: boolean };
export function motionChoices(presets: VideoPreset[]): MotionChoice[] {
  return [
    { value: 'custom', name: 'Custom', description: 'Type your own direction, then generate', videoStyle: 'custom' },
    ...presets.map(preset => ({ value: `preset:${preset.id}`, name: preset.name, description: preset.prompt, videoStyle: 'preset' as const, videoPreset: preset, isDefault: preset.isDefault })),
  ];
}
// Recipe actions never consume the text editor's draft. Empty Custom is resolved
// to the current default when the generation is submitted.
export function motionChoiceInput(choice: MotionChoice, draft: string): Pick<Generation, 'prompt' | 'videoStyle' | 'videoPreset'> {
  return {
    prompt: choice.videoStyle === 'custom' ? draft : '',
    videoStyle: choice.videoStyle,
    videoPreset: choice.videoPreset ? { ...choice.videoPreset } : undefined,
  };
}
