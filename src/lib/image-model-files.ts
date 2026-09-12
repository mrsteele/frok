import type { ImageModelId } from './image-models';

// Official Comfy-Org split pack, pinned so preparation and readiness agree.
export const zImageRevision = '08d04455279082882deaabc8d0d09fc914c071e1';
export const zImageFiles = [
  { directory: 'diffusion_models', name: 'z_image_turbo_bf16.safetensors', size: 12309866400, sha256: '2407613050b809ffdff18a4ac99af83ea6b95443ecebdf80e064a79c825574a6', node: 'UNETLoader', input: 'unet_name' },
  { directory: 'text_encoders', name: 'qwen_3_4b.safetensors', size: 8044982048, sha256: '6c671498573ac2f7a5501502ccce8d2b08ea6ca2f661c458e708f36b36edfc5a', node: 'CLIPLoader', input: 'clip_name' },
  { directory: 'vae', name: 'ae.safetensors', size: 335304388, sha256: 'afc8e28272cd15db3919bacdb6918ce9c1ed22e96cb12c4d5ed0fba823529e38', node: 'VAELoader', input: 'vae_name' },
] as const;
export const zImageUrl = (file: typeof zImageFiles[number]) => `https://huggingface.co/Comfy-Org/z_image_turbo/resolve/${zImageRevision}/split_files/${file.directory}/${file.name}`;
export const imageNodes = (id: ImageModelId): string[] => id === 'z-image-turbo'
  ? ['UNETLoader','CLIPLoader','VAELoader','CLIPTextEncode','ConditioningZeroOut','EmptySD3LatentImage','ModelSamplingAuraFlow','KSampler','VAEDecode','SaveImage']
  : ['CheckpointLoaderSimple','CLIPTextEncode','EmptyLatentImage','KSampler','VAEDecode','SaveImage'];
