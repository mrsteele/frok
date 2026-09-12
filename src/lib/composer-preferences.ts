import { pipelineId } from './pipelines/schema';
import { z } from 'zod';
import type { Generation } from './types';

export const composerPreferencesKey='frok-composer';
const preferencesSchema=z.object({
  pipelineId:pipelineId.optional().catch(undefined),
  pipelineChoices:z.object({image:pipelineId.optional(),video:pipelineId.optional(),reference:pipelineId.optional(),upscale:pipelineId.optional()}).optional().catch(undefined),
  mode:z.enum(['image','video','reference']).catch('image'),
  aspect:z.enum(['1:1','3:4','4:3','9:16','16:9','3:2','2:3']).catch('1:1'),
  quality:z.enum(['preview','standard']).catch('preview'),
  count:z.union([z.literal(1),z.literal(4),z.literal(8),z.literal(12)]).catch(4),
  duration:z.union([z.literal(6),z.literal(8),z.literal(10)]).catch(6),
  enhance:z.boolean().catch(false),
  seed:z.number().int().min(0).max(2147483647).optional().catch(undefined),
});

// Accept older composer records, but retain only reusable controls. Prompt text,
// uploaded media, recipes and runner configuration never become browser defaults.
export function readComposerPreferences(raw:string|null) {
  let value:unknown={};
  try{value=raw?JSON.parse(raw):{};}catch{}
  return preferencesSchema.parse(value&&typeof value==='object'&&!Array.isArray(value)?value:{});
}
export function writeComposerPreferences(request:Generation) {
  return JSON.stringify(preferencesSchema.parse(request));
}
export function freshComposer(raw:string|null=null):Generation {
  return {...readComposerPreferences(raw),prompt:'',referenceIds:[]};
}
