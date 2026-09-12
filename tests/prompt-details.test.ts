import test from 'node:test';
import assert from 'node:assert/strict';
import { promptDetails } from '../src/lib/prompt-details';
import { normalMotion } from '../src/lib/motion';
import type { Generation, Media } from '../src/lib/types';

const root: Media = { id: 'image', kind: 'image', filename: 'synthetic.jpg', prompt: 'A blue car', enhancedPrompt: 'A blue car', width: 640, height: 480, seed: 1, favorite: true, origin: 'generated', createdAt: '2026-01-01' };
const recipe = { id: 'carguy', name: 'Carguy', prompt: 'Present the vehicle, pause, then step aside.' };
const generation: Generation = { mode: 'video', sourceId: root.id, prompt: '', videoStyle: 'preset', videoPreset: recipe, enhance: false, aspect: '4:3', duration: 6, count: 1, quality: 'preview', referenceIds: [] };
const video: Media = { ...root, id: 'video', kind: 'video', sourceId: root.id, prompt: '', enhancedPrompt: `${root.enhancedPrompt}\n\n${recipe.prompt}`, videoStyle: 'preset', generation, promptTrace: { raw: recipe.prompt, enhanced: false, image: { original: root.prompt, actual: root.enhancedPrompt } } };

test('enhancement off shows only the actual image and video prompts, labelled with the saved recipe', () => {
  assert.deepEqual(promptDetails(root, video), [
    { label: 'Image prompt', text: root.enhancedPrompt },
    { label: 'Video prompt [Carguy]', text: video.enhancedPrompt },
  ]);
  assert.deepEqual(promptDetails(root), [{ label: 'Image prompt', text: root.enhancedPrompt }]);
});

test('enhanced image and recipe show the full logical flow, using the saved image snapshot and recipe', () => {
  const enhancedImage = 'A polished blue car in a bright showroom';
  const enhancedVideo = { ...video, enhancedPrompt: `${enhancedImage}\n\nA presenter welcomes the viewer, pauses, then moves aside.`, promptTrace: { raw: recipe.prompt, enhanced: true, image: { original: root.prompt, actual: enhancedImage } } };
  assert.deepEqual(promptDetails({ ...root, enhancedPrompt: 'Later unrelated metadata' }, enhancedVideo), [
    { label: 'Original image prompt', text: root.prompt },
    { label: 'Image prompt', text: enhancedImage },
    { label: 'Raw video prompt', text: recipe.prompt },
    { label: 'Video prompt [Carguy]', text: enhancedVideo.enhancedPrompt },
  ]);
  assert.deepEqual(promptDetails({ ...root, enhancedPrompt: enhancedImage }).map(row => row.label), ['Original image prompt', 'Image prompt']);
});

test('only the inputs that changed get raw rows, including failed enhancement', () => {
  const enhancedImage = { original: root.prompt, actual: 'A detailed blue car' };
  const item = { ...video, generation: { ...generation, enhance: true }, promptTrace: { raw: recipe.prompt, enhanced: false, image: enhancedImage } };
  assert.deepEqual(promptDetails(root, item).map(row => row.label), ['Original image prompt', 'Image prompt', 'Video prompt [Carguy]']);
  assert.deepEqual(promptDetails(root, { ...video, promptTrace: { ...video.promptTrace!, enhanced: true } }).map(row => row.label), ['Image prompt', 'Raw video prompt', 'Video prompt [Carguy]']);
});

test('Normal and Custom display the effective raw motion instead of empty editor text', () => {
  for (const style of ['normal', 'custom'] as const) {
    const raw = style === 'normal' ? normalMotion : 'Turn left';
    const item = { ...video, videoStyle: style, generation: { ...generation, videoStyle: style, videoPreset: undefined }, promptTrace: { ...video.promptTrace!, raw, enhanced: true } };
    const rows = promptDetails(root, item);
    assert.equal(rows[1].text, raw);
    assert.equal(rows[2].label, `Video prompt [${style === 'normal' ? 'Normal' : 'Custom'}]`);
  }
});

test('uploads omit missing prompts; text-to-video posters are not called image prompts', () => {
  assert.deepEqual(promptDetails({ ...root, origin: 'upload', prompt: '', enhancedPrompt: '' }), []);
  const poster = { ...root, origin: 'poster' as const };
  const textVideo = { ...video, videoStyle: undefined, prompt: 'A blue car', generation: { ...generation, sourceId: undefined, videoStyle: undefined, videoPreset: undefined }, promptTrace: { raw: 'A blue car', enhanced: false } };
  assert.deepEqual(promptDetails(poster, textVideo), [{ label: 'Video prompt', text: textVideo.enhancedPrompt }]);
  assert.deepEqual(promptDetails(poster), [{ label: 'Video prompt', text: poster.enhancedPrompt }]);
});

test('legacy renders keep their actual saved prompt and recipe, without fabricating new context', () => {
  const legacy = { ...video, enhancedPrompt: 'Old LLM output without the image description', promptTrace: undefined, generation: { ...generation, enhance: true } };
  const rows = promptDetails(root, legacy);
  assert.equal(rows[1].text, recipe.prompt);
  assert.equal(rows.at(-1)?.text, legacy.enhancedPrompt);
  const fallback = { ...legacy, enhancedPrompt: 'One continuous 6-second shot, starting from the supplied image.\n\nStarting image description: A blue car\n\nMotion recipe: Present the vehicle' };
  assert.deepEqual(promptDetails(root, fallback).map(row => row.label), ['Image prompt', 'Video prompt [Carguy]']);
  assert.equal(promptDetails(root, { ...legacy, generation: { ...generation, videoPreset: undefined } }).at(-1)?.text, legacy.enhancedPrompt);
});


test('old Normal renders show the original built-in direction, not today’s replacement text', () => {
  const legacy = { ...video, videoStyle: 'normal' as const, enhancedPrompt: 'A car rolls forward slowly.', promptTrace: undefined, generation: { ...generation, enhance: true, videoStyle: 'normal' as const, videoPreset: undefined } };
  assert.equal(promptDetails(root, legacy)[1].text, 'Show simple, natural motions in the video, continuing the action described in the starting image.');
});
