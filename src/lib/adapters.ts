import type { Adapters } from './types';
export const defaultAdapters: Adapters = { primaryWeight: 1, secondary: '', secondaryWeight: 0.7 };
export const turboAdapters = {
  video: { alias: 'larryvrh/MiniMax-H3-Turbo-Lora-v4-600-ema', file: 'larryvrh/MiniMax-H3-Turbo-Lora/minimax_h3_turbo_v4_step600_ema.safetensors', steps: 6, shift: 12 },
  reference: { alias: 'lightx2v/Minimax-h3-Turbo-ref2va-4step-split', file: 'lightx2v/Minimax-h3-Turbo/minimax_h3_ref2v_turbo_4step_v0.1_bf16.safetensors', steps: 4, shift: 12 },
} as const;
