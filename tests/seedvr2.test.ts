import test from 'node:test';
import assert from 'node:assert/strict';
import { seedvr2Args, seedvr2Models, seedvr2Progress } from '../src/lib/seedvr2-profile';

test('the Mac profile uses temporal batches, quantized DiT and tiled VAE without CUDA-only options', () => {
  const args = seedvr2Args('/video with spaces.mp4', '/result.mp4', '/local models', 72);
  const value = (name: string) => args[args.indexOf(name) + 1];
  assert.equal(args[0], '/video with spaces.mp4');
  assert.equal(value('--model_dir'), '/local models');
  assert.equal(value('--dit_model'), seedvr2Models[0].name);
  assert.equal(value('--batch_size'), '5'); // More than one frame, and 4n+1.
  assert.equal(value('--resolution'), '720');
  assert.equal(value('--seed'), '72');
  assert(args.includes('--vae_encode_tiled') && args.includes('--vae_decode_tiled'));
  assert(Number(value('--temporal_overlap')) > 0);
  assert.equal(value('--attention_mode'), 'sdpa');
  assert(!args.includes('--cuda_device') && !args.includes('--blocks_to_swap') && !args.includes('--compile_dit'));
});

test('SeedVR2 progress stays monotonic through chunks, phases and fragmented log writes', () => {
  const updates: {percent: number; message: string}[] = [];
  const report = seedvr2Progress((percent, message) => updates.push({percent, message}));
  report('Chunk 1/2: 17 new + 0 context frames\n━━ Phase 1: VAE encoding ━━\n');
  report('Phase 1: VAE encoding complete\nPhase 2: DiT upscaling complete\n');
  report('Phase 3: VAE decoding complete\nPhase 4: Post-processing complete\n');
  report('Chun'); report('k 2/2: 17 new + 1 context frames\r');
  report('Phase 1: VAE encoding ━━\nPhase 4: Post-processing complete\n');
  assert(updates.every((update, i) => i === 0 || update.percent >= updates[i - 1].percent));
  assert.equal(updates.at(-1)?.percent, 95); // Export, audio and saving still remain.
  assert(updates.some(update => update.message.includes('part 2 of 2')));
  const count = updates.length;
  report('100%|████| 1/1\n'); // Inner denoising/VAE bars do not replace overall progress.
  assert.equal(updates.length, count);
});
