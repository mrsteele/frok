import { exportPreferencesSchema, type ExportPreferences } from './export-preferences';
import { readComposerPreferences } from './composer-preferences';
import { decodeVideoPresets } from './video-presets';
import { z } from 'zod';

// Only reusable user controls are portable, never browser identities or caches.
export function normalizeInterfacePreferences(input: unknown, migrating = false): ExportPreferences {
  const values = exportPreferencesSchema.parse(input);
  if (values['frok-composer'] !== undefined) values['frok-composer'] = JSON.stringify(readComposerPreferences(values['frok-composer']));
  if (!migrating && values.userPrompts !== undefined) values.userPrompts = JSON.stringify(decodeVideoPresets(values.userPrompts));
  if (!migrating && values['frok-video-audio'] !== undefined) values['frok-video-audio'] = JSON.stringify(z.object({ muted: z.boolean(), volume: z.number().min(0).max(1) }).parse(JSON.parse(values['frok-video-audio'])));
  return values;
}
