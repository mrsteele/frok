// Safe to import in the UI. Execution code belongs in the server-side registry.
export const providerDefinitions = {
  vpipe: { name: 'Vpipe', location: 'local', extension: '.vpipeline', setup: 'native' },
  comfyui: { name: 'ComfyUI', location: 'local', extension: '.json', setup: 'files' },
} as const;

export type ProviderId = keyof typeof providerDefinitions;
export const providerIds = Object.keys(providerDefinitions) as [ProviderId, ...ProviderId[]];
