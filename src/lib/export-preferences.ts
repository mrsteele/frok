import { z } from 'zod';

// Durable studio preferences only; identities, reset coordination and drafts
// are deliberately not part of a portable backup.
export const exportPreferenceKeys=['frok-composer','frok-video-audio','userPrompts'] as const;
export const exportPreferencesSchema=z.object({
  'frok-composer':z.string().max(20_000).optional(),
  'frok-video-audio':z.string().max(1_000).optional(),
  userPrompts:z.string().max(900_000).optional(),
}).strict();
export type ExportPreferences=z.infer<typeof exportPreferencesSchema>;
export function captureExportPreferences(storage:Pick<Storage,'getItem'>):ExportPreferences {
  const values:ExportPreferences={};
  for(const key of exportPreferenceKeys){const value=storage.getItem(key);if(value!==null)values[key]=value;}
  return exportPreferencesSchema.parse(values);
}
export type LibraryExport={id:string;filename:string;bytes:number;download:string;warnings:string[]};
