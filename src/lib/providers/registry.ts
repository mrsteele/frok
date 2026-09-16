import { vpipeProvider } from './vpipe';
import { comfyuiProvider } from './comfyui';
import type { ProviderId } from './definitions';
import type { ProviderAdapter } from './types';

const providers: Record<ProviderId, ProviderAdapter> = {
  vpipe: vpipeProvider,
  comfyui: comfyuiProvider,
};

export function providerFor(id: string): ProviderAdapter {
  if (!Object.hasOwn(providers, id)) throw Error(`Unsupported generation provider: ${id}.`);
  return providers[id as ProviderId];
}
