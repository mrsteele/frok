import type { Runner } from './types';

export const imageModelIds = ['krea-2-turbo', 'sdxl-turbo', 'z-image-turbo'] as const;
export type ImageModelId = typeof imageModelIds[number];
export const imageModels = {
  'krea-2-turbo': { name: 'Krea 2 Turbo', runner: 'vpipe', task: 'image', detail: 'About 36 GB including the encoder, VAE and adapter. Requires Krea’s license and an administrator-provided Hugging Face token.' },
  'sdxl-turbo': { name: 'SDXL Turbo', runner: 'comfyui', task: 'comfy-image', detail: 'About 7 GB. Uses a checkpoint installed in your protected ComfyUI service.' },
  'z-image-turbo': { name: 'Z-Image-Turbo', runner: 'comfyui', task: 'comfy-z-image', detail: 'About 20 GB including the Qwen3 text encoder and VAE. Uses an eight-step ComfyUI workflow. Memory use and speed depend on your hardware and ComfyUI configuration.' },
} as const;
export const defaultImageModel = (runner: Runner): ImageModelId => runner === 'vpipe' ? 'krea-2-turbo' : 'sdxl-turbo';
export const imageModelForTask = (task: string): ImageModelId | undefined => imageModelIds.find(id => imageModels[id].task === task);
