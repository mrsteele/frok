import { createLibraryFixture } from './fixtures/library';
import { mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { normalMotion } from '../src/lib/motion';
import { animationRequest } from '../src/lib/media-family';
import { applyDefaultVideoPreset, assignDefaultVideoPreset, decodeVideoPresets } from '../src/lib/video-presets';
import type { Generation, Media } from '../src/lib/types';

const directory = path.join(process.cwd(), '.data', `prompt-flow-test-${process.pid}`);
process.env.FROK_DATA_DIR = directory;
const fixture = await createLibraryFixture();
const { test, beforeEach, after } = fixture;
const { prepareGenerationPrompt, prepareGenerationPrompts } = await import('../src/lib/generation-prompt');
const root: Media = { id: 'image', kind: 'image', filename: 'synthetic.jpg', prompt: 'A paper boat', enhancedPrompt: 'A blue paper boat on a still pond', width: 640, height: 480, seed: 1, favorite: false, origin: 'generated', createdAt: '2026-01-01' };
const request: Generation = { mode: 'video', sourceId: root.id, prompt: 'Drift left, then turn right. Keep the camera fixed.', videoStyle: 'custom', aspect: '4:3', duration: 6, quality: 'preview', count: 1, enhance: false, referenceIds: [] };
const preset = { id: 'carguy', name: 'Carguy', prompt: 'Present the vehicle with an open hand, pause, then step aside. No camera cuts.' };
const signal = () => new AbortController().signal;
// No model or network access: any unexpected call fails the test.
beforeEach(() => { mock.restoreAll(); mock.method(globalThis, 'fetch', async () => { assert.fail('Unexpected Ollama request'); }); });
after(async () => { mock.restoreAll(); fixture.close(); await fs.rm(directory, { recursive: true, force: true }); });

for (const style of ['custom', 'normal', 'preset'] as const) {
  test(`${style} without enhancement passes the full image prompt plus only the chosen direction`, async () => {
    const source = { ...root, enhancedPrompt: 'Exact image context. '.repeat(390) + 'KEEP THE LAST IMAGE DETAIL.' };
    const input = { ...request, videoStyle: style, videoPreset: style === 'preset' ? preset : undefined };
    const raw = style === 'custom' ? request.prompt : style === 'normal' ? normalMotion : preset.prompt;
    const result = await prepareGenerationPrompt(input, source, signal());
    assert.equal(result.prompt, `${source.enhancedPrompt}\n\n${raw}`);
    assert.deepEqual(result.promptTrace, { raw, enhanced: false, image: { original: source.prompt, actual: source.enhancedPrompt } });
    assert.equal(result.videoStyle, style);
  });

  test(`${style} enhances the direction with image context, then prepends the unchanged image prompt`, async () => {
    const source = { ...root, enhancedPrompt: 'Detailed image context. '.repeat(110) + 'FINAL CONTEXT DETAIL' };
    const input = { ...request, enhance: true, videoStyle: style, videoPreset: style === 'preset' ? preset : undefined };
    const raw = style === 'custom' ? request.prompt : style === 'normal' ? normalMotion : preset.prompt;
    const calls: { messages: { role: string; content: string }[] }[] = [];
    mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
      calls.push(JSON.parse(String(options.body)));
      return Response.json({ message: { content: '<think>Hidden reasoning</think>Refined motion with every requested action.' }, done_reason: 'stop', eval_count: 20 });
    });
    const result = await prepareGenerationPrompt(input, source, signal());
    assert.equal(calls.length, 1);
    assert.deepEqual(JSON.parse(calls[0].messages[1].content), { imageContext: source.enhancedPrompt, motionDirection: raw });
    assert.match(calls[0].messages[0].content, /Refine only the motion direction/);
    assert.ok(!calls[0].messages[0].content.includes(raw));
    assert.equal(result.prompt, `${source.enhancedPrompt}\n\n${raw}\n\nRefined motion with every requested action.`);
    assert.equal(result.promptTrace?.raw, raw);
    assert.equal(result.promptTrace?.enhanced, true);
  });
}

test('older queued empty Custom equals its saved Normal behavior; uploaded images work without invented context', async () => {
  const custom = await prepareGenerationPrompt({ ...request, prompt: '  ' }, root, signal());
  const normal = await prepareGenerationPrompt({ ...request, videoStyle: 'normal' }, root, signal());
  assert.deepEqual(custom, normal);
  const upload = { ...root, prompt: '', enhancedPrompt: '', origin: 'upload' as const };
  assert.equal((await prepareGenerationPrompt(request, upload, signal())).prompt, request.prompt);
  const plain = { ...root, enhancedPrompt: '' };
  assert.equal((await prepareGenerationPrompt(request, plain, signal())).prompt, `${root.prompt}\n\n${request.prompt}`);
});

test('the chosen default reaches prompt preparation with the actual image context, with or without enhancement', async () => {
  const presets = assignDefaultVideoPreset(decodeVideoPresets(null), 'dance');
  const input = applyDefaultVideoPreset({ ...request, prompt: '' }, presets);
  const raw = input.videoPreset!.prompt;
  const plain = await prepareGenerationPrompt(input, root, signal());
  assert.equal(plain.prompt, `${root.enhancedPrompt}\n\n${raw}`);
  assert.equal(plain.videoStyle, 'preset');
  mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    const body = JSON.parse(String(options.body));
    assert.deepEqual(JSON.parse(body.messages[1].content), { imageContext: root.enhancedPrompt, motionDirection: raw });
    assert.match(body.messages[0].content, /Use the recipe as the motion direction/);
    return Response.json({ message: { content: 'Match the rhythm with small, coordinated steps.' }, done_reason: 'stop' });
  });
  const enhanced = await prepareGenerationPrompt({ ...input, enhance: true }, root, signal());
  assert.equal(enhanced.prompt, `${root.enhancedPrompt}\n\n${raw}\n\nMatch the rhythm with small, coordinated steps.`);
  assert.equal(enhanced.promptTrace?.raw, raw);
});

test('unavailable, empty or truncated enhancement falls back to the complete image and recipe', async () => {
  for (const response of [
    new Response('Unavailable', { status: 503 }),
    Response.json({ message: { content: '' } }),
    Response.json({ message: { content: 'A cut-off direction' }, done_reason: 'length' }),
    Response.json({ message: { content: 'x'.repeat(8001) } }),
  ]) {
    mock.method(globalThis, 'fetch', async () => response);
    let fallback = false;
    const result = await prepareGenerationPrompt({ ...request, enhance: true, videoStyle: 'preset', videoPreset: preset }, root, signal(), { fallback: () => { fallback = true; } });
    assert.equal(fallback, true);
    assert.equal(result.prompt, `${root.enhancedPrompt}\n\n${preset.prompt}`);
    assert.equal(result.promptTrace?.enhanced, false);
    assert.equal(result.promptTrace?.raw, preset.prompt);
  }
});

test('cancellation during enhancement propagates instead of generating from the fallback', async () => {
  const controller = new AbortController();
  mock.method(globalThis, 'fetch', async () => { controller.abort(); throw controller.signal.reason; });
  await assert.rejects(prepareGenerationPrompt({ ...request, enhance: true }, root, controller.signal), { name: 'AbortError' });
});

test('unchanged enhancement does not claim the direction was modified', async () => {
  mock.method(globalThis, 'fetch', async () => Response.json({ message: { content: request.prompt } }));
  const result = await prepareGenerationPrompt({ ...request, enhance: true }, root, signal());
  assert.equal(result.promptTrace?.enhanced, false);
});

test('text generation keeps its own prompt and HD preserves the original video prompt trace', async () => {
  for (const mode of ['image', 'video', 'reference'] as const) {
    const result = await prepareGenerationPrompt({ ...request, mode, sourceId: undefined, videoStyle: undefined }, undefined, signal());
    assert.equal(result.prompt, request.prompt);
    assert.deepEqual(result.promptTrace, { raw: request.prompt, enhanced: false, image: undefined });
  }
  const original = await prepareGenerationPrompt(request, root, signal());
  const video: Media = { ...root, kind: 'video', prompt: request.prompt, enhancedPrompt: original.prompt, promptTrace: original.promptTrace, videoStyle: 'custom' };
  const hd = await prepareGenerationPrompt({ ...request, mode: 'upscale', enhance: true }, video, signal());
  assert.equal(hd.prompt, video.enhancedPrompt);
  assert.deepEqual(hd.promptTrace, video.promptTrace);
});

test('viewer, quick-play and Redo requests can honor the current enhancement toggle', () => {
  const video: Media = { ...root, kind: 'video', generation: { ...request, enhance: true } };
  assert.equal(animationRequest(root, undefined, { prompt: '', videoStyle: 'normal' }, false).enhance, false);
  assert.equal(animationRequest(root, video, { prompt: 'Turn right' }, false).enhance, false);
  assert.equal(animationRequest(root, video, undefined, false).enhance, false);
  assert.equal(animationRequest(root, video, undefined, true).enhance, true);
});

const imageBatch: Generation = { ...request, mode: 'image', sourceId: undefined, videoStyle: undefined, prompt: 'One blue paper boat on a pond, no people', count: 4, enhance: true };
const imageVariants = [
  'A close water-level view with soft reflected clouds.',
  'A wide composition with sunlit ripples around the boat.',
  'An overhead composition with geometric reflections.',
  'Side framing with a misty background and soft dawn light.',
];

test('one Ollama call plans all image variations and each output keeps its own actual prompt', async () => {
  let calls = 0;
  mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
    calls++;
    const body = JSON.parse(String(options.body));
    assert.deepEqual(JSON.parse(body.messages[1].content), { prompt: imageBatch.prompt, count: 4 });
    assert.match(body.messages[0].content, /exactly 4 distinct/);
    assert.match(body.messages[0].content, /every explicit constraint/);
    assert.equal(body.format.properties.details.minItems, 4);
    assert.equal(body.format.properties.details.maxItems, 4);
    assert.equal(body.keep_alive, 0);
    assert.ok(body.options.num_predict > 256);
    return Response.json({ message: { content: JSON.stringify({ details: imageVariants }) }, done_reason: 'stop', eval_count: 300 });
  });
  const planned = await prepareGenerationPrompts(imageBatch, undefined, signal());
  assert.equal(calls, 1);
  assert.deepEqual(planned.map(item => item.prompt), imageVariants.map(details => `${imageBatch.prompt}\n\n${details}`));
  for (const item of planned) {
    assert.equal(item.promptTrace?.raw, imageBatch.prompt);
    assert.equal(item.promptTrace?.enhanced, true);
    const image: Media = { ...root, prompt: imageBatch.prompt, enhancedPrompt: item.prompt };
    const video = await prepareGenerationPrompt(request, image, signal());
    assert.equal(video.prompt, `${item.prompt}\n\n${request.prompt}`);
  }
});

test('image batches with enhancement off keep the exact original prompt and never call Ollama', async () => {
  const planned = await prepareGenerationPrompts({ ...imageBatch, enhance: false }, undefined, signal());
  assert.equal(planned.length, 4);
  for (const item of planned) {
    assert.equal(item.prompt, imageBatch.prompt);
    assert.equal(item.promptTrace?.enhanced, false);
  }
});

test('invalid, repeated, missing, empty, oversized and truncated batch prompts fall back cleanly', async () => {
  const responses = [
    new Response('Offline', { status: 503 }),
    Response.json({ message: { content: 'not JSON' } }),
    Response.json({ message: { content: JSON.stringify({ details: imageVariants.slice(0, 3) }) } }),
    Response.json({ message: { content: JSON.stringify({ details: [...imageVariants, 'Extra'] }) } }),
    Response.json({ message: { content: JSON.stringify({ details: [imageVariants[0], imageVariants[0].toUpperCase(), ...imageVariants.slice(2)] }) } }),
    Response.json({ message: { content: JSON.stringify({ details: ['   ', ...imageVariants.slice(1)] }) } }),
    Response.json({ message: { content: JSON.stringify({ details: ['x'.repeat(8001), ...imageVariants.slice(1)] }) } }),
    Response.json({ message: { content: JSON.stringify({ details: imageVariants }) }, done_reason: 'length' }),
  ];
  for (const response of responses) {
    let warned = false;
    mock.method(globalThis, 'fetch', async () => response);
    const planned = await prepareGenerationPrompts(imageBatch, undefined, signal(), { fallback: () => { warned = true; } });
    assert.equal(warned, true);
    assert.equal(planned.length, 4);
    assert.ok(planned.every(item => item.prompt === imageBatch.prompt && !item.promptTrace?.enhanced));
  }
});

test('a twelve-image plan keeps a long original brief intact in every output', async () => {
  const original = 'A patterned ceramic vase. '.repeat(320).slice(0, 7920) + ' KEEP EXACTLY TWO RED HANDLES. <Picture 1>';
  const details = Array.from({ length: 12 }, (_, index) => `Soft light variation ${index} reveals the fine ceramic texture, with subtle shadows on the existing surface.`);
  mock.method(globalThis, 'fetch', async () => Response.json({ message: { content: JSON.stringify({ details }) }, done_reason: 'stop' }));
  const planned = await prepareGenerationPrompts({ ...imageBatch, prompt: original, count: 12 }, undefined, signal());
  assert.ok(planned.every(item => item.prompt.length > 8000));
  assert.deepEqual(planned.map(item => item.prompt), details.map(detail => `${original}\n\n${detail}`));
});

test('cancelling batch planning never starts generation using a fallback prompt', async () => {
  const controller = new AbortController();
  mock.method(globalThis, 'fetch', async () => { controller.abort(); throw controller.signal.reason; });
  let warned = false;
  await assert.rejects(prepareGenerationPrompts(imageBatch, undefined, controller.signal, { fallback: () => { warned = true; } }), { name: 'AbortError' });
  assert.equal(warned, false);
});

test('single images and video keep their existing one-prompt enhancement path', async () => {
  for (const input of [{ ...imageBatch, count: 1 }, { ...request, sourceId: undefined, videoStyle: undefined, enhance: true }]) {
    mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
      assert.equal(JSON.parse(String(options.body)).format, undefined);
      return Response.json({ message: { content: 'A single detailed prompt.' } });
    });
    const planned = await prepareGenerationPrompts(input, undefined, signal());
    assert.equal(planned.length, 1);
    assert.equal(planned[0].prompt, `${input.prompt}\n\nA single detailed prompt.`);
  }
});


const mirrorBrief = 'A selfie photo of two pregnant woman in the bathroom looking in the mirror. One is blonde and the other is a brunette. They are both attractive. One is holding the phone, taking the selfie. They are both in towels.';
for (const count of [1, 4]) {
  test(`${count} image enrichment retains every word of the two-person mirror selfie brief`, async () => {
    const details = Array.from({ length: count }, (_, index) => `Soft bathroom lighting variation ${index} reveals the texture of the existing tiles and a thin beveled edge on the mirror.`);
    mock.method(globalThis, 'fetch', async (_url: unknown, options: RequestInit) => {
      const body = JSON.parse(String(options.body));
      const system = body.messages[0].content;
      for (const requirement of [/exact subject and object counts/, /both, each, only and neither/, /clothing and coverage/, /Mirrors and reflections show the same existing subjects/, /never additional people/, /never a rewrite|never a rewritten/, /Fidelity always takes priority over variety/]) assert.match(system, requirement);
      assert.ok(body.options.temperature <= 0.5);
      return Response.json({ message: { content: count === 1 ? details[0] : JSON.stringify({ details }) } });
    });
    const planned = await prepareGenerationPrompts({ ...imageBatch, prompt: mirrorBrief, count }, undefined, signal());
    assert.deepEqual(planned.map(item => item.prompt), details.map(detail => `${mirrorBrief}\n\n${detail}`));
    for (const item of planned) {
      assert.equal(item.promptTrace?.raw, mirrorBrief);
      assert.equal(item.prompt.split(mirrorBrief).length - 1, 1);
    }
  });
}

test('reference-video enrichment retains literal tags, counts, quoted text and exclusions', async () => {
  const prompt = '<Picture 1> Exactly two blue robots stand beside <Picture 2>. Both hold red signs reading "OPEN". No other robots. Keep the camera fixed.';
  const details = 'Soft light catches the existing metal surfaces with a restrained ambient hum.';
  mock.method(globalThis, 'fetch', async () => Response.json({ message: { content: details } }));
  const result = await prepareGenerationPrompt({ ...request, mode: 'reference', sourceId: undefined, prompt, enhance: true }, undefined, signal());
  assert.equal(result.prompt, `${prompt}\n\n${details}`);
});

test('verbose additions fall back to the original without truncating or rewriting it', async () => {
  for (const count of [1, 4]) {
    const details = Array.from({ length: count }, (_, i) => `${i} ` + 'detail '.repeat(81));
    mock.method(globalThis, 'fetch', async () => Response.json({ message: { content: count === 1 ? details[0] : JSON.stringify({ details }) } }));
    let fallback = false;
    const result = await prepareGenerationPrompts({ ...imageBatch, prompt: mirrorBrief, count }, undefined, signal(), { fallback: () => { fallback = true; } });
    assert.equal(fallback, true);
    assert.ok(result.every(item => item.prompt === mirrorBrief && !item.promptTrace?.enhanced));
  }
});

test('echoed original text is included only once and unchanged responses stay unenhanced', async () => {
  for (const addition of ['', '\n\nSoft light reveals the existing tile texture.']) {
    mock.method(globalThis, 'fetch', async () => Response.json({ message: { content: mirrorBrief + addition } }));
    const result = await prepareGenerationPrompt({ ...imageBatch, prompt: mirrorBrief, count: 1 }, undefined, signal());
    assert.equal(result.prompt, mirrorBrief + addition);
    assert.equal(result.promptTrace?.enhanced, !!addition);
  }
});
