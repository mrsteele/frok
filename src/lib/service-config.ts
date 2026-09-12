import { z } from 'zod';
import { imageModelIds, imageModels } from './image-models';

export const connectionIds = ['vpipe', 'comfyui', 'ollama'] as const;
export type ConnectionId = typeof connectionIds[number];
export const connectionNames = {vpipe:'Vpipe',comfyui:'ComfyUI',ollama:'Ollama'};
export const connectionsSchema = z.object({vpipe:z.boolean(),comfyui:z.boolean(),ollama:z.boolean()}).strict();
export type Connections = z.infer<typeof connectionsSchema>;
export const emptyConnections: Connections = {vpipe:false,comfyui:false,ollama:false};
export const promptModelSchema = z.string().trim().min(1).max(200).regex(/^[A-Za-z0-9][A-Za-z0-9._\/:@-]*$/);
export const ollamaUrlSchema = z.string().trim().min(1).max(2048).refine(value=>{
  try {
    const url=new URL(value);
    return ['http:','https:'].includes(url.protocol)&&['localhost','127.0.0.1','[::1]'].includes(url.hostname)
      &&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/';
  }catch{return false;}
},'Enter a local Ollama address, such as http://127.0.0.1:11434, without credentials or a path.').transform(value=>new URL(value).origin);
export const ollamaAddressSettingSchema=z.union([z.string().trim().length(0),ollamaUrlSchema]);
export const modelSelectionsSchema = z.object({
  image:z.enum(imageModelIds).nullable(),
  video:z.enum(['vpipe','comfyui']).nullable(),
  reference:z.enum(['vpipe','comfyui']).nullable(),
  // Empty uses the default installed model; null explicitly disables enhancement.
  prompt:z.union([z.literal(''),promptModelSchema]).nullable(),
  upscale:z.enum(['realesrgan','seedvr2']).nullable(),
}).strict();
export type ModelSelections = z.infer<typeof modelSelectionsSchema>;
export type Capability = keyof ModelSelections;
export const emptyModelSelections: ModelSelections = {image:null,video:null,reference:null,prompt:null,upscale:null};
export const capabilityNames = {image:'Images',video:'Video',reference:'Reference video',prompt:'Prompt enhancement',upscale:'HD enhancement'};
export function modelConnection(capability: Capability, models: ModelSelections): ConnectionId | undefined {
  if(capability==='image')return models.image?imageModels[models.image].runner:undefined;
  if(capability==='prompt')return models.prompt?'ollama':undefined;
  if(capability==='upscale')return;
  return models[capability] || undefined;
}
export type ConnectionStatus = {enabled:boolean;available:boolean;detail:string};
export type CapabilityStatus = {configured:boolean;ready:boolean;detail:string;task?:string;connection?:ConnectionId};
