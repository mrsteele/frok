import type { Adapters } from './types';
export const defaultAdapters: Adapters = { primaryWeight: 1, secondary: '', secondaryWeight: 0.7 };
export type AdapterProfile = 'video' | 'reference';
export type InstalledAdapter = { value: string; label: string; profile?: AdapterProfile };
export const turboAdapters = {
  video: { alias: 'larryvrh/MiniMax-H3-Turbo-Lora-v4-600-ema', file: 'larryvrh/MiniMax-H3-Turbo-Lora/minimax_h3_turbo_v4_step600_ema.safetensors', steps: 6, shift: 12 },
  reference: { alias: 'lightx2v/Minimax-h3-Turbo-ref2va-4step-split', file: 'lightx2v/Minimax-h3-Turbo/minimax_h3_ref2v_turbo_4step_v0.1_bf16.safetensors', steps: 4, shift: 12 },
} as const;
export const primaryAdapter = (profile: AdapterProfile, adapters?: Adapters) => adapters?.primary ?? turboAdapters[profile].alias;
export function adapterProfile(value: string): AdapterProfile | undefined {
  if (/ref2v/i.test(value)) return 'reference';
  if (/fl2v|larryvrh\/MiniMax-H3-Turbo-Lora/i.test(value)) return 'video';
}
export function adapterSchedule(value: string) {
  const known = Object.values(turboAdapters).find(item => item.alias === value || value.endsWith(item.file));
  if (known) return { steps: known.steps, shift: known.shift };
  if (/ref2v.*turbo.*8step|Turbo-ref2va-8step/i.test(value)) return { steps: 8, shift: 6 };
  if (/ref2v.*turbo.*4step|Turbo-ref2va-4step/i.test(value)) return { steps: 4, shift: 12 };
}
