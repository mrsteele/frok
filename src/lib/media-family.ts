import type { Generation, Media, MediaFamily, VideoStyle, VideoPreset } from './types';
import { newestMedia } from './asset-groups';

// Initial history is a baseline, not a reason to leave a directly linked render.
// Later saved outputs (including HD copies) select their original render's URL.
export function newlyAvailableRender(previous:MediaFamily|undefined, next:MediaFamily, waitingJobId?:string):Media|undefined {
  const awaited=waitingJobId&&next.renders.find(render=>render.media.jobId===waitingJobId||render.hd?.jobId===waitingJobId);
  if(awaited)return awaited.media;
  if(!previous||previous.root.id!==next.root.id)return;
  const known=new Set(previous.renders.flatMap(render=>[render.media.id,...(render.hd?[render.hd.id]:[])]));
  return next.renders.flatMap(render=>[render.media,...(render.hd?[render.hd]:[])]
    .filter(output=>!known.has(output.id)).map(output=>({output,media:render.media})))
    .sort((a,b)=>newestMedia(a.output,b.output))[0]?.media;
}

export function upscaleRequest(video:Media):Generation {
  return {mode:'upscale',sourceId:video.id,prompt:video.prompt,aspect:video.generation?.aspect || '1:1',
    duration:video.generation?.duration ?? 6,quality:video.generation?.quality ?? 'preview',count:1,referenceIds:[],enhance:false};
}

export function redoRequest(root:Media,video:Media,enhance:boolean,controls:Partial<Pick<Generation,'duration'|'quality'|'seed'|'pipelineId'>>,randomSeed=()=>crypto.getRandomValues(new Uint32Array(1))[0]%2147483648):Generation {
  let seed=randomSeed();
  // Redo must differ even if the RNG happens to select the previous render's seed.
  if(seed===video.seed)seed=(seed+1)%2147483648;
  return animationRequest(root,video,undefined,enhance,{...controls,seed});
}

export const familySlides = (family:MediaFamily):Media[] => [family.root,...family.renders.map(render=>render.media).filter(media=>media.id!==family.root.id)];
export const familySelection = (family:MediaFamily, number:number):Media|undefined =>
  number===1 ? family.root : family.renders.find(render=>render.media.assetNumber===number)?.media;

export function groupMediaFamily(root: Media, relatives: Media[]): MediaFamily {
  const byId = new Map(relatives.map(media => [media.id, media]));
  const originals = relatives.filter(media => media.kind === 'video' && media.origin !== 'upscale').sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const copies = new Map<string, Media>();
  for (const media of relatives.filter(media => media.kind === 'video' && media.origin === 'upscale').sort((a,b) => a.createdAt.localeCompare(b.createdAt))) {
    let parent = byId.get(media.sourceId || ''); const seen = new Set([media.id]);
    while (parent?.origin === 'upscale' && !seen.has(parent.id)) { seen.add(parent.id); parent = byId.get(parent.sourceId || ''); }
    if (parent?.kind === 'video' && parent.origin !== 'upscale') copies.set(parent.id, media);
  }
  return { root, renders: originals.map(media => ({media,hd:copies.get(media.id)})) };
}
export function animationRequest(root: Media, video?: Media, options?: {prompt: string; videoStyle?: VideoStyle; videoPreset?: VideoPreset}, enhance = video?.generation?.enhance ?? root.generation?.enhance ?? true, controls:Partial<Pick<Generation,'duration'|'quality'|'seed'|'pipelineId'>>={}): Generation {
  const saved = video?.generation ?? root.generation;
  if(root.kind==='video') {
    const reference=root.generation?.mode==='reference';
    return {mode:reference?'reference':'video',rootId:root.id,pipelineId:controls.pipelineId ?? saved?.pipelineId,
      prompt:reference?options?.prompt ?? video?.prompt ?? root.prompt:root.prompt,
      referenceIds:reference?[...(root.generation?.referenceIds || [])]:[],
      duration:controls.duration ?? saved?.duration ?? 6,quality:controls.quality ?? saved?.quality ?? 'preview',
      aspect:saved?.aspect || '1:1',count:1,enhance,seed:controls.seed};
  }
  const requestedStyle = options ? options.videoStyle ?? 'custom' : saved?.videoStyle ?? video?.videoStyle ?? 'custom';
  const prompt = requestedStyle === 'normal' || requestedStyle === 'preset' ? '' : options?.prompt ?? video?.prompt ?? '';
  const videoPreset = requestedStyle === 'preset' ? (options?.videoPreset ?? saved?.videoPreset) : undefined;
  const duration = controls.duration ?? saved?.duration ?? Math.round(video?.duration || 6);
  return { mode:'video',pipelineId:controls.pipelineId,sourceId:root.id,prompt,
    videoPreset:videoPreset ? {...videoPreset} : undefined,
    videoStyle:requestedStyle,
    duration:[6,8,10].includes(duration)?duration:6,quality:controls.quality ?? saved?.quality ?? (video && Math.min(video.width,video.height)>=720?'standard':'preview'),
    aspect:saved?.aspect || '1:1',count:1,referenceIds:[],enhance,seed:controls.seed };
}
