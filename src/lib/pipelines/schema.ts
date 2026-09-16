import { z } from 'zod';
import { providerIds } from '../providers/definitions';
import { catalogDetails, type PipelineFiles } from './details';
import type { DownloadAccess } from './download-access';
export const pipelineKinds=['image','video','reference','upscale'] as const;
export const pipelineRunners=providerIds;
export type PipelineKind=typeof pipelineKinds[number];
export const pipelineId=z.string().min(1).max(160).regex(/^[a-z0-9][a-z0-9._:-]*$/);
const relative=z.string().min(1).max(1024).refine(value=>!value.startsWith('/')&&!/[\\\x00-\x1f%]/.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..'),'Use a relative path without traversal.');
export const dependencySchema=z.object({
  kind:z.enum(['model','lora','file']),reference:relative,layout:z.enum(['krea','minimax','transformer','diffusers','ltx']).optional(),
  files:z.array(relative).default([]),size:z.number().int().positive().optional(),sha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),
  url:z.string().url().refine(value=>{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password;}).optional(),
  fetch:z.object({model:relative.refine(value=>value.includes('/')),variant:z.string().optional(),key:z.string().optional()}).optional(),
  generated:z.boolean().default(false),
}).strict();
const binding=z.object({node:z.string().min(1),field:z.string().min(1)}).strict();
export const pipelineMetadata=z.object({
  version:z.literal(1),id:pipelineId,name:z.string().trim().min(1).max(100),runner:z.enum(pipelineRunners),
  default:z.boolean().default(false),description:z.string().max(1000).default(''),
  catalog:catalogDetails.optional(),
  promptSuffix:z.string().trim().min(1).max(300).optional(),
  plugins:z.array(z.literal('ltx-2.5')).max(1).optional(),
  controls:z.object({durations:z.array(z.union([z.literal(6),z.literal(8),z.literal(10)])).default([6,8,10]),qualities:z.array(z.enum(['preview','standard'])).min(1).default(['preview','standard']),aspects:z.array(z.enum(['1:1','3:4','4:3','9:16','16:9','3:2','2:3'])).min(1).default(['1:1','3:4','4:3','9:16','16:9','3:2','2:3']),fps:z.number().positive().default(24),frameStride:z.number().int().positive().default(17),frameOffset:z.number().int().nonnegative().default(5)}).default({durations:[6,8,10],qualities:['preview','standard'],aspects:['1:1','3:4','4:3','9:16','16:9','3:2','2:3'],fps:24,frameStride:17,frameOffset:5}),
  bindings:z.partialRecord(z.enum(['prompt','seed','width','height','frames','duration','output','pixels','device','fps','frameBufferMB']),z.array(binding)).default({}),
  videoSource:binding.optional(),
  // Native restorers may require padded spatial/temporal input. Padding is removed after rendering.
  upscale:z.object({spatialMultiple:z.number().int().min(1).max(256).default(1),frameStride:z.number().int().min(1).max(32).default(1),frameOffset:z.number().int().min(0).max(31).default(0),minimumFrames:z.number().int().min(1).max(256).default(1),extraFrames:z.number().int().min(0).max(64).default(0)}).strict().optional(),
  source:z.object({required:z.boolean().optional(),target:z.string(),field:z.string().optional(),port:z.number().int().nonnegative().optional(),model:z.string().optional()}).optional(),
  references:z.object({target:z.string(),field:z.string(),max:z.number().int().min(1).max(9).default(9)}).optional(),
  dependencies:z.array(dependencySchema).max(100).default([]),
}).strict();
export type PipelineMetadata=z.infer<typeof pipelineMetadata>;
export type Dependency=z.infer<typeof dependencySchema>;
export type PipelineSelections=Record<PipelineKind,string|null>;
export const pipelineSelectionsSchema=z.object({image:pipelineId.nullable(),video:pipelineId.nullable(),reference:pipelineId.nullable(),upscale:pipelineId.nullable()}).strict();
export const emptyPipelines:PipelineSelections={image:null,video:null,reference:null,upscale:null};
export function currentPipelineSelections(value:PipelineSelections):PipelineSelections {
  const replacement=value.upscale==='local:seedvr2'?'comfyui:seedvr2':value.upscale==='local:realesrgan'?'comfyui:realesrgan':value.upscale;
  return {...value,upscale:replacement};
}
export type PipelineSnapshot={metadata:PipelineMetadata;kind:PipelineKind;graph:Record<string,unknown>;revision:string};
export type PipelineStatus={id:string;name:string;kind:PipelineKind;runner:PipelineMetadata['runner'];description:string;default:boolean;controls:PipelineMetadata['controls'];supportsSource:boolean;requiresSource?:boolean;maxReferences:number;state:'ready'|'missing'|'attention';ready:boolean;detail:string;missing:string[];revision:string;preparation?:string;catalog?:PipelineMetadata['catalog'];files?:PipelineFiles;downloadAccess?:DownloadAccess};
export function selectedPipeline(health:import('../types').Health|undefined,kind:PipelineKind,override?:string) {return health?.pipelines?.find(item=>item.kind===kind&&item.id===(override||health.pipelineSelections?.[kind]));}
