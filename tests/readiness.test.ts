import test from 'node:test';
import assert from 'node:assert/strict';
import { generationIssue, missingSetup, promptEnhancementIssue } from '../src/lib/readiness';
import { defaultAdapters } from '../src/lib/adapters';
import type { Health } from '../src/lib/types';

function health(overrides: Partial<Health> = {}): Health {
  return {
    runner: 'vpipe', worker: true, ollama: false, ollamaConnected: false, ollamaInstalled: false,
    platform: 'darwin arm64', memoryGB: 16, diskGB: 300, workdir: '/example/work', setupDismissed: true,
    checks: [
      { id: 'worker', name: 'Queue', ready: true, detail: '' },
      { id: 'runner', name: 'Vpipe', ready: true, detail: '' },
      { id: 'ffmpeg', name: 'Video tools', ready: true, detail: '' },
      { id: 'ollama', name: 'Prompt enhancement', ready: false, detail: '' },
    ],
    videoAdapters:{...defaultAdapters},referenceAdapters:{...defaultAdapters},upscalerReady:true,upscalerSupported:true,
    models: { image: true, video: true, reference: true },
    ...overrides,
  };
}

test('saved enhancement blocks new enhanced work while its model is unavailable', () => {
  assert.equal(promptEnhancementIssue(health(), true)?.target, 'prompt');
  assert.equal(promptEnhancementIssue(undefined, true)?.target, 'prompt');
  assert.equal(promptEnhancementIssue(health({ ollama: true }), true), undefined);
  assert.equal(promptEnhancementIssue(health(), false), undefined);
  assert.equal(promptEnhancementIssue(undefined, false), undefined);
});

test('the Settings badge includes missing video packs even when image generation is ready', () => {
  const state = health({ models: { image: true, video: false, reference: false } });
  assert.equal(generationIssue(state, 'image'), undefined);
  assert.deepEqual(missingSetup(state).map(item => item.target), ['video', 'reference']);
});

test('optional Ollama does not prevent complete setup, while missing essentials do', () => {
  const state = health();
  assert.deepEqual(missingSetup(state), []);
  state.checks.find(check => check.id === 'ffmpeg')!.ready = false;
  assert.deepEqual(missingSetup(state).map(item => item.target), ['ffmpeg']);
  assert.equal(generationIssue(state, 'image'), undefined);
  assert.equal(generationIssue(state, 'video')?.target, 'ffmpeg');
  assert.equal(generationIssue(state, 'upscale')?.target, 'ffmpeg');
  state.checks.find(check => check.id === 'ffmpeg')!.ready = true;
  state.worker = false;
  assert.equal(generationIssue(state, 'image')?.target, 'worker');
  assert.deepEqual(missingSetup(state).map(item => item.target), ['worker']);
});

test('each unavailable mode points to its own download card and setup task', () => {
  const state = health({ models: {} });
  const image = generationIssue(state, 'image')!;
  assert.match(image.message, /cannot generate images until Krea 2 Turbo/);
  assert.equal(image.action, 'Download Krea');
  for (const mode of ['image', 'video', 'reference'] as const) {
    assert.equal(generationIssue(state, mode)?.target, mode);
    assert.equal(generationIssue(state, mode)?.task, mode);
  }
  assert.equal(generationIssue(state, 'upscale'), undefined);
});

test('ComfyUI readiness uses its own prepared packs and download actions', () => {
  const state = health({ runner: 'comfyui' });
  assert.deepEqual(missingSetup(state).map(item => item.target), ['image', 'video', 'reference']);
  const image = generationIssue(state, 'image')!;
  assert.equal(image.task, 'comfy-image');
  assert.equal(image.target, 'image');
  assert.equal(image.action, 'Download SDXL Turbo');
  for (const mode of ['image', 'video', 'reference'] as const) {
    assert.equal(generationIssue(state, mode)?.task, `comfy-${mode}`);
    state.models[`comfy-${mode}`] = true;
    assert.equal(generationIssue(state, mode), undefined);
  }
  assert.deepEqual(missingSetup(state), []);
});

test('unknown health and a disconnected runner cannot appear ready for generation', () => {
  assert.ok(generationIssue(undefined, 'image'));
  const state = health();
  state.checks.find(check => check.id === 'runner')!.ready = false;
  assert.equal(generationIssue(state, 'image')?.target, 'runner');
  assert.deepEqual(missingSetup(state).map(item => item.target), ['runner']);
  assert.equal(generationIssue(state, 'upscale'), undefined);
});

test('missing neural upscaler blocks HD and points at setup without blocking generation',()=>{
  const state=health({upscalerReady:false});
  assert.equal(generationIssue(state,'upscale')?.target,'upscale');
  assert.equal(generationIssue(state,'image'),undefined);
  assert.equal(generationIssue(state,'video'),undefined);
  assert.deepEqual(missingSetup(state).map(item=>item.target),['upscale']);
});
