// Pinned to the maintained standalone CLI's v2.5.24 source and model registry.
export const seedvr2Revision = '4490bd1f482e026674543386bb2a4d176da245b9';
export const seedvr2Models = [
  { name: 'seedvr2_ema_3b-Q4_K_M.gguf', repo: 'AInVFX/SeedVR2_comfyUI', size: 1995344224, sha256: 'e665e3909de1a8c88a69c609bca9d43ff5a134647face2ce4497640cc3597f0e' },
  { name: 'ema_vae_fp16.safetensors', repo: 'numz/SeedVR2_comfyUI', size: 501324814, sha256: '20678548f420d98d26f11442d3528f8b8c94e57ee046ef93dbb7633da8612ca1' },
] as const;
export const seedvr2Fingerprint = `${seedvr2Revision}:torch2.9.1:3b-q4:vae-fp16`;
export function seedvr2Args(input: string, output: string, modelDir: string, seed: number) {
  return [input, '--output', output, '--output_format', 'mp4', '--video_backend', 'ffmpeg',
    '--model_dir', modelDir, '--dit_model', seedvr2Models[0].name,
    '--resolution', '720', '--max_resolution', '1920', '--seed', String(seed),
    '--batch_size', '5', '--chunk_size', '17', '--temporal_overlap', '1', '--uniform_batch_size',
    '--vae_encode_tiled', '--vae_encode_tile_size', '512', '--vae_encode_tile_overlap', '64',
    '--vae_decode_tiled', '--vae_decode_tile_size', '512', '--vae_decode_tile_overlap', '64',
    '--dit_offload_device', 'cpu', '--vae_offload_device', 'cpu', '--tensor_offload_device', 'cpu',
    '--attention_mode', 'sdpa', '--color_correction', 'lab'];
}

// Progress spans all chunks and phases, reserving the final 5% for audio/export.
export function seedvr2Progress(onProgress: (percent: number, message: string) => void) {
  let pending = '', chunk = 1, chunks = 1, percent = 0;
  return (text: string) => {
    const lines = (pending + text).split(/[\r\n]/); pending = lines.pop()!.slice(-4000);
    for (const line of lines) {
      const match = /Chunk (\d+)\/(\d+):/.exec(line);
      const phase = /Phase ([1-4]): (.+?)(?: ━| complete|$)/.exec(line);
      if (match) { chunk = Number(match[1]); chunks = Number(match[2]); }
      if (!match && !phase) continue;
      const fraction = phase ? (Number(phase[1]) - (line.includes('complete') ? 0 : 1)) / 4 : 0;
      percent = Math.max(percent, Math.min(95, Math.floor(95 * (chunk - 1 + fraction) / chunks)));
      onProgress(percent, phase ? `SeedVR2 · ${phase[2].trim()} · part ${chunk} of ${chunks}` : `SeedVR2 · Restoring part ${chunk} of ${chunks}`);
    }
  };
}
