import { selectedPipeline } from './pipelines/schema';
import type { Generation, Health, Runner } from './types';
import { imageModels, type ImageModelId } from './image-models';
import { capabilityNames, type Capability } from './service-config';

export const modelModes = ['image', 'video', 'reference'] as const;
export type SetupTarget = 'worker' | 'runner' | 'ffmpeg' | 'upscale' | 'prompt' | typeof modelModes[number];
export type ReadinessIssue = { message: string; action: string; target: SetupTarget; task?: string };

export function promptEnhancementIssue(health:Health|undefined,enabled:boolean):ReadinessIssue|undefined {
  if(!enabled||health?.ollama)return;
  return {message:health?'Prompt enhancement is enabled but unavailable. Reconnect its model or turn enhancement off in Generation settings.':'Checking prompt enhancement…',action:'Set up prompt enhancement',target:'prompt'};
}

export function modelRequirement(runner: Runner, mode: typeof modelModes[number], imageModel?: ImageModelId) {
  if(mode==='image'&&imageModel){const model=imageModels[imageModel];return {...model,action:`Download ${model.name}`};}
  const name = mode === 'image' ? runner === 'vpipe' ? 'Krea 2 Turbo' : 'SDXL Turbo' : mode === 'video' ? 'MiniMax H3 video' : 'MiniMax H3 references';
  return { task: `${runner === 'comfyui' ? 'comfy-' : ''}${mode}`, name,
    action: mode === 'image' ? runner === 'vpipe' ? 'Download Krea' : 'Download SDXL Turbo' : mode === 'video' ? 'Download video model' : 'Download reference model' };
}

// Only configured capabilities contribute to the setup badge.
export function missingSetup(health: Health | undefined): { target: SetupTarget; name: string }[] {
  if (!health) return [];
  if(health.capabilities){
    const selected=(Object.entries(health.capabilities) as [Capability,NonNullable<Health['capabilities']>[Capability]][]).filter(([,value])=>value.configured);
    if(!selected.length)return [{target:'runner',name:'Connect a service and choose a pipeline'}];
    const missing:{target:SetupTarget;name:string}[]=selected.filter(([,value])=>!value.ready).map(([target])=>({target,name:target==='image'&&health.modelSelections?.image?imageModels[health.modelSelections.image].name:capabilityNames[target]}));
    if(!health.worker)missing.unshift({target:'worker',name:'Generation queue'});
    return missing;
  }
  const missing: { target: SetupTarget; name: string }[] = [];
  for (const target of ['worker', 'runner', 'ffmpeg'] as const) {
    const check = health.checks.find(c => c.id === target);
    if (target === 'worker' ? !health.worker : !check?.ready) missing.push({ target, name: check?.name || target });
  }
  for (const mode of modelModes) {
    const model = modelRequirement(health.runner, mode, health.image?.model);
    if (mode==='image'&&health.image ? !health.image.ready||!health.image.connected : !health.models[model.task]) missing.push({ target: mode, name: model.name });
  }
  if(!health.upscalerReady)missing.push({target:'upscale',name:'AI video enhancement'});
  return missing;
}

export function generationIssue(health: Health | undefined, mode: Generation['mode'], sourceId?: string,pipelineId?:string): ReadinessIssue | undefined {
  if (!health) return { message: 'Checking local setup…', action: 'Open Settings', target: 'runner' };
  if (!health.worker) return { message: health.checks.find(check=>check.id==='worker')?.detail||'The generation queue is offline. Start it before creating.', action: 'Open Settings', target: 'worker' };
  if(health.pipelines){
    const p=selectedPipeline(health,mode,pipelineId);
    if(!p)return {message:'Choose an available pipeline in Settings → Pipelines.',action:'Choose a pipeline',target:mode};
    const connection=p.runner!=='local'&&health.connections?.[p.runner];
    if(connection&&(!connection.enabled||!connection.available))return {message:`Connect ${p.runner} to use ${p.name}.`,action:'Configure connections',target:'runner'};
    if(mode!=='image'&&!health.checks.find(c=>c.id==='ffmpeg')?.ready)return {message:health.checks.find(c=>c.id==='ffmpeg')?.detail||'Video tools need setup.',action:'Set up video tools',target:'ffmpeg'};
    if(sourceId&&mode!=='upscale'&&!p.supportsSource)return {message:'Choose a pipeline that accepts a starting image.',action:'Choose a pipeline',target:mode};
    if(!p.ready)return {message:p.detail,action:p.canPrepare?'Prepare pipeline':'Review pipeline',target:mode};
    return;
  }
  if(health.capabilities){
    const capability=health.capabilities[mode];
    if(!capability.ready){
      const connection=capability.connection&&health.connections?.[capability.connection];
      const target:SetupTarget=connection&&(!connection.enabled||!connection.available)?'runner':capability.detail.startsWith('Video tools')?'ffmpeg':mode;
      return {message:capability.detail,action:target==='runner'?'Configure connections':target==='ffmpeg'?'Check video tools':capability.configured?'Set up model':'Choose a model',target,task:capability.task};
    }
    return;
  }
  if (mode !== 'image' && !health.checks.find(c => c.id === 'ffmpeg')?.ready) return { message: 'Video tools need setup before you can create or enhance videos.', action: 'Set up video tools', target: 'ffmpeg' };
  if (mode === 'upscale') return health.upscalerReady ? undefined : {message:health.upscaler==='seedvr2'?'Download SeedVR2 and its VAE before upscaling.':'Set up AI video enhancement before upscaling.',action:health.upscaler==='seedvr2'?'Download SeedVR2':'Set up AI enhancement',target:'upscale',task:health.upscaler==='seedvr2'?'seedvr2':'upscale'};
  if(mode==='image'&&health.image){
    const image=health.image, model=imageModels[image.model];
    if(!image.connected)return {message:image.detail||`Connect ${image.runner==='vpipe'?'Vpipe':'ComfyUI'} to use ${model.name}.`,action:'Check image generator',target:'image'};
    if(!image.ready)return {message:image.detail||`You cannot generate images until ${model.name} is downloaded and prepared.`,action:`Download ${model.name}`,target:'image',task:image.setupTask||model.task};
    return;
  }
  if (!health.checks.find(c => c.id === 'runner')?.ready) return { message: `Connect ${health.runner === 'vpipe' ? 'Vpipe' : 'ComfyUI'} before generating.`, action: 'Connect runner', target: 'runner' };
  const model = modelRequirement(health.runner, mode, health.image?.model);
  if (!health.models[model.task]) return { message: `You cannot generate ${mode === 'image' ? 'images' : mode === 'reference' ? 'reference videos' : 'videos'} until ${model.name} is downloaded and prepared.`, action: model.action, target: mode, task: model.task };

}

// The API and composer enforce the same per-mode readiness check.
export function generationBlocker(health: Health | undefined, mode: Generation['mode'], sourceId?: string,pipelineId?:string): string | undefined {
  return generationIssue(health, mode, sourceId,pipelineId)?.message;
}
