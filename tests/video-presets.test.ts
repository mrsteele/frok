import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDefaultVideoPreset, assignDefaultVideoPreset, decodeVideoPresets, defaultVideoPreset, normalizeVideoPresetDefaults, validateVideoPresets, motionChoices, motionChoiceInput } from '../src/lib/video-presets';
import { motionPrompt, motionSystem } from '../src/lib/motion';
import { animationRequest } from '../src/lib/media-family';
import { generationSchema } from '../src/lib/validation';
import type { Generation, Media, VideoPreset } from '../src/lib/types';

const car: VideoPreset = { id: 'carguy', name: 'Carguy', prompt: 'Present the vehicle with a welcoming gesture and a smooth commercial camera move.' };
const root: Media = { id: 'bf7d62f8-0de2-4fce-886f-f41b850952cd', kind: 'image', filename: 'synthetic.jpg', prompt: 'A car salesperson in a showroom', enhancedPrompt: 'A salesperson beside a blue car in a bright showroom', width: 640, height: 480, seed: 1, favorite: true, origin: 'generated', createdAt: '2026-01-01' };

test('only missing storage seeds starters; edited and empty lists survive round trips', () => {
  const first = decodeVideoPresets(null);
  assert.deepEqual(first.map(item => item.name), ['Normal', 'Silly', 'Dance']);
  assert.equal(defaultVideoPreset(first)?.name, 'Normal');
  const custom = validateVideoPresets([...first.filter(item => item.name !== 'Dance'), car]);
  custom[0].name = 'Comedy'; custom[0].prompt = 'A playful visual gag';
  assert.deepEqual(decodeVideoPresets(JSON.stringify(custom)), custom.map(item => ({ ...item, isDefault: !!item.isDefault })));
  assert.deepEqual(decodeVideoPresets('[]'), []);
  const existing = [{ id: 'fun', name: 'Fun', prompt: 'My own saved recipe' }, { id: 'commercial', name: 'Commercial', prompt: 'Another saved recipe' }];
  const upgraded = decodeVideoPresets(JSON.stringify(existing));
  assert.deepEqual(upgraded.slice(1), existing.map(item => ({ ...item, isDefault: false })));
  assert.equal(defaultVideoPreset(upgraded)?.name, 'Normal');
  assert.deepEqual(decodeVideoPresets(JSON.stringify(upgraded)), upgraded);
  assert.equal(decodeVideoPresets(null)[0].name, 'Normal');
  assert.deepEqual(motionChoices([]).map(item => item.value), ['custom']);
});

test('old starter labels update without overwriting custom recipes or colliding with names', () => {
  const current = decodeVideoPresets(null);
  const previous = current.map(preset => ({...preset,name:preset.id === 'zany' ? 'Zany' : preset.name}));
  assert.deepEqual(decodeVideoPresets(JSON.stringify(previous)),current);
  const edited = [{...previous[0],prompt:'My own motion recipe'}, {...previous[1],name:'Comedy'}];
  assert.deepEqual(decodeVideoPresets(JSON.stringify(edited)),edited);
  const collision = [...previous,{...car,name:'silly'}];
  assert.deepEqual(decodeVideoPresets(JSON.stringify(collision)).map(preset => preset.name),['Normal','Zany','Dance','silly']);
});

test('Dance queues the scene-aware starter recipe with image context and ignores the draft', () => {
  const dance = motionChoices(decodeVideoPresets(null)).find(choice => choice.name === 'Dance')!;
  assert.equal(dance.value, 'preset:dance');
  const input = motionChoiceInput(dance, 'An unrelated camera move');
  const request = generationSchema.parse(animationRequest(root, undefined, input));
  const prompt = motionPrompt({ style: 'preset', preset: request.videoPreset, prompt: request.prompt, sourcePrompt: root.enhancedPrompt, duration: request.duration });
  assert.equal(input.prompt, '');
  assert.equal(request.videoPreset?.prompt, dance.videoPreset?.prompt);
  assert.ok(prompt.startsWith(root.enhancedPrompt));
  assert.match(prompt, /dance that matches the mood, setting and atmosphere/);
  assert.ok(!prompt.includes('An unrelated camera move'));
});

test('quick video, blank Custom and choosing the default recipe all queue the same snapshot', () => {
  const presets = assignDefaultVideoPreset(decodeVideoPresets(null), 'dance');
  const dance = motionChoices(presets).find(choice => choice.value === 'preset:dance')!;
  assert.equal(dance.isDefault, true);
  const options = [
    { prompt: '', videoStyle: 'custom' as const },
    { prompt: '  \n ', videoStyle: 'custom' as const },
    { prompt: '' },
    motionChoiceInput(dance, 'Ignore this editor draft'),
    { prompt: '', videoStyle: 'normal' as const }, // Older entry points also resolve the configured default.
  ];
  for (const option of options) {
    const input = generationSchema.parse(applyDefaultVideoPreset(animationRequest(root, undefined, option), presets));
    assert.equal(input.videoStyle, 'preset');
    assert.equal(input.prompt, '');
    assert.deepEqual(input.videoPreset, defaultVideoPreset(presets));
    assert.equal(input.sourceId, root.id);
  }
});

test('default selection persists; editing or removing Normal does not make it reappear', () => {
  const selected = assignDefaultVideoPreset(decodeVideoPresets(null), 'dance');
  const edited = selected.filter(preset => preset.id !== 'normal').map(preset => preset.id === 'dance' ? { ...preset, name: 'Waltz', prompt: 'A slow waltz in the ballroom.' } : preset);
  const restored = decodeVideoPresets(JSON.stringify(edited));
  assert.deepEqual(restored, edited);
  assert.equal(defaultVideoPreset(restored)?.name, 'Waltz');
  assert.equal(motionChoices(restored).some(choice => choice.name === 'Normal'), false);
  const changedNormal = decodeVideoPresets(null).map(preset => preset.id === 'normal' ? { ...preset, name: 'Calm', prompt: 'Watch the clouds drift slowly.' } : preset);
  assert.deepEqual(defaultVideoPreset(decodeVideoPresets(JSON.stringify(changedNormal))), changedNormal[0]);
});

test('deleting the default selects the next recipe; an empty list has no hidden fallback', () => {
  const selected = assignDefaultVideoPreset(decodeVideoPresets(null), 'dance');
  const remaining = normalizeVideoPresetDefaults(selected.filter(preset => preset.id !== 'dance'));
  assert.equal(defaultVideoPreset(remaining)?.name, 'Normal');
  assert.equal(remaining.filter(preset => preset.isDefault).length, 1);
  assert.equal(defaultVideoPreset(normalizeVideoPresetDefaults([])), undefined);
  assert.throws(() => assignDefaultVideoPreset(remaining, 'missing'), /no longer available/);
  const blank = animationRequest(root, undefined, { prompt: '' });
  assert.throws(() => applyDefaultVideoPreset(blank, []), /Add a default recipe/);
  const typed = animationRequest(root, undefined, { prompt: 'Walk toward the camera' });
  assert.deepEqual(applyDefaultVideoPreset(typed, []), typed);
  assert.equal(normalizeVideoPresetDefaults([car])[0].isDefault, true);
});

test('older lists upgrade safely with reserved IDs, existing Normal names and a full recipe list', () => {
  const collision = decodeVideoPresets(JSON.stringify([{ ...car, id: 'normal' }]));
  assert.equal(defaultVideoPreset(collision)?.id, 'normal-2');
  assert.equal(collision[1].prompt, car.prompt);
  const named = decodeVideoPresets(JSON.stringify([{ ...car, name: 'Normal' }]));
  assert.equal(named.length, 1); assert.equal(defaultVideoPreset(named)?.prompt, car.prompt);
  const full = decodeVideoPresets(JSON.stringify(Array.from({ length: 100 }, (_, index) => ({ ...car, id: `r${index}`, name: `Recipe ${index}` }))));
  assert.equal(full.length, 100); assert.equal(defaultVideoPreset(full)?.id, 'r0');
  assert.throws(() => decodeVideoPresets('[{"id":"broken","name":"Broken","prompt":"Move","isDefault":"yes"}]'));
});

test('changing defaults never alters queued snapshots, explicit recipes, typed directions or non-image video requests', () => {
  const presets = decodeVideoPresets(null);
  const queued = applyDefaultVideoPreset(animationRequest(root, undefined, { prompt: '' }), presets);
  presets[0].prompt = 'This later edit must not reach the queue';
  const changed = assignDefaultVideoPreset(presets, 'dance');
  assert.ok(!queued.videoPreset?.prompt.includes('later edit'));
  const video: Media = { ...root, id: 'video', kind: 'video', generation: queued, videoStyle: 'preset', prompt: '' };
  assert.deepEqual(applyDefaultVideoPreset(animationRequest(root, video), changed).videoPreset, queued.videoPreset);
  const explicit = animationRequest(root, undefined, { prompt: '', videoStyle: 'preset', videoPreset: car });
  assert.deepEqual(applyDefaultVideoPreset(explicit, changed).videoPreset, car);
  const typed = animationRequest(root, undefined, { prompt: 'Walk forward' });
  assert.deepEqual(applyDefaultVideoPreset(typed, changed), typed);
  for (const input of [{ ...queued, sourceId: undefined, videoStyle: undefined, videoPreset: undefined }, { ...queued, mode: 'reference' as const }, { ...queued, mode: 'upscale' as const }]) {
    assert.deepEqual(applyDefaultVideoPreset(input, changed), input);
  }
});

test('invalid storage and duplicate names are reported instead of silently replacing recipes', () => {
  for (const value of ['{bad', '{}', 'null', '[{"name":"Missing recipe"}]']) assert.throws(() => decodeVideoPresets(value));
  assert.throws(() => validateVideoPresets([car, { ...car, id: 'another', name: 'carguy' }]));
  assert.equal(validateVideoPresets([{ ...car, name: 'Normal' }])[0].name, 'Normal');
  assert.throws(() => validateVideoPresets([{ ...car, name: 'Custom' }]));
  assert.throws(() => validateVideoPresets([{ ...car, isDefault: true }, { id: 'other', name: 'Other', prompt: 'Turn', isDefault: true }]));
  assert.throws(() => validateVideoPresets([car, { ...car, name: 'Another name' }]));
  assert.throws(() => validateVideoPresets([{ ...car, prompt: 'x'.repeat(4001) }]));
});

test('a recipe uses image context and never includes the text editor draft, with or without Ollama', () => {
  const brief = { style: 'preset' as const, preset: car, prompt: 'End with a slow zoom out', sourcePrompt: root.enhancedPrompt, duration: 8 };
  const prompt = motionPrompt(brief);
  assert.ok(prompt.includes(car.prompt));
  assert.ok(prompt.includes(root.enhancedPrompt));
  assert.ok(!prompt.includes(brief.prompt));
  assert.ok(!prompt.includes('Motion direction:'));
  assert.equal(prompt, `${root.enhancedPrompt}\n\n${car.prompt}`);
  const nextImage = motionPrompt({ ...brief, sourcePrompt: 'A salesperson next to a red SUV' });
  assert.match(nextImage, /red SUV/); assert.ok(!nextImage.includes(root.enhancedPrompt)); assert.ok(nextImage.includes(car.prompt));
  assert.ok(!motionSystem(brief).includes(car.prompt)); // The recipe belongs to the creative brief, not system instructions.
  assert.match(motionSystem(brief), /Use the recipe as the motion direction/);
});

test('blank text with a preset remains a preset; the API requires a complete recipe and image anchor', () => {
  const input = animationRequest(root, undefined, { prompt: '', videoStyle: 'preset', videoPreset: car });
  assert.equal(input.videoStyle, 'preset'); assert.ok(generationSchema.safeParse(input).success);
  for (const overrides of [{ videoPreset: undefined }, { videoPreset: { ...car, prompt: '' } }, { sourceId: undefined }, { videoStyle: 'normal' }, { mode: 'upscale' }]) {
    assert.ok(!generationSchema.safeParse({ ...input, ...overrides }).success);
  }
  const normal = applyDefaultVideoPreset(animationRequest(root, undefined, { prompt: '', videoStyle: 'custom' }), decodeVideoPresets(null));
  assert.equal(normal.videoStyle, 'preset'); assert.equal(normal.videoPreset?.name, 'Normal');
});

test('queued recipes and Redo retain snapshots; choosing a current recipe uses the edit', () => {
  const preset = { ...car };
  const queued = animationRequest(root, undefined, { prompt: 'Wave to the camera', videoStyle: 'preset', videoPreset: preset });
  preset.prompt = 'A completely different direction';
  assert.equal(queued.videoPreset?.prompt, car.prompt);
  const saved = JSON.parse(JSON.stringify(queued)) as Generation;
  const video: Media = { ...root, id: 'f4c5d3e8-c8f2-4995-87a7-5a7275eb1c32', kind: 'video', sourceId: root.id, prompt: queued.prompt, videoStyle: 'preset', generation: saved };
  const redo = animationRequest(root, video);
  assert.deepEqual(redo.videoPreset, car); assert.equal(redo.prompt, queued.prompt); assert.equal(redo.enhance, true);
  assert.equal(redo.seed, undefined); assert.equal('fromVideoId' in redo,false);
  const edited = animationRequest(root, video, { prompt: 'Turn left', videoStyle: 'preset', videoPreset: preset });
  assert.equal(edited.videoPreset?.prompt, preset.prompt);
  const custom = animationRequest(root, video, { prompt: 'Turn right', videoStyle: 'custom' });
  assert.equal(custom.videoPreset, undefined);
  assert.equal(animationRequest(root, video, { prompt: 'Turn left' }).videoStyle, 'custom');
  assert.equal(animationRequest(root, video, { prompt: 'Turn left' }).videoPreset, undefined);
});

test('the menu contains Custom and saved recipes with no separate Normal action; replay uses the saved snapshot', () => {
  assert.deepEqual(motionChoices([car]).map(item => item.name), ['Custom', 'Carguy']);
  const saved = animationRequest(root, undefined, { prompt: '', videoStyle: 'preset', videoPreset: car });
  const video: Media = { ...root, kind: 'video', videoStyle: 'preset', generation: saved, prompt: '' };
  const edited = { ...car, prompt: 'Updated commercial direction' };
  assert.equal(motionChoices([edited])[1].videoPreset?.prompt, edited.prompt);
  assert.deepEqual(motionChoices([]).map(item => item.name), ['Custom']);
  assert.equal(animationRequest(root, video).videoPreset?.prompt, car.prompt);
});

test('recipe and Normal menu actions exclude drafts while Custom keeps typed direction', () => {
  const draft = 'A completely unrelated camera move';
  for (const choice of motionChoices([car])) {
    const input = motionChoiceInput(choice, draft);
    assert.equal(input.prompt, choice.videoStyle === 'custom' ? draft : '');
    const request = animationRequest(root, undefined, input);
    assert.equal(request.prompt, input.prompt);
    assert.equal(request.videoStyle, choice.videoStyle);
    assert.deepEqual(request.videoPreset, choice.videoPreset);
  }
  const choice = motionChoices([car])[1];
  const input = motionChoiceInput(choice, draft);
  assert.notEqual(input.videoPreset, choice.videoPreset);
});

test('API normalization also strips leftover text for recipes and Normal, but preserves Custom', () => {
  for (const choice of motionChoices([car])) {
    const draft = 'Leftover textarea text';
    const request = generationSchema.parse({ mode: 'video', sourceId: root.id, ...motionChoiceInput(choice, ''), prompt: draft });
    assert.equal(request.prompt, choice.videoStyle === 'custom' ? draft : '');
    assert.deepEqual(request.videoPreset, choice.videoPreset);
  }
});

test('Normal continues the image action, ignores drafts and does not add recipe direction', () => {
  const brief = { style: 'normal' as const, prompt: 'Replace the scene with fireworks', sourcePrompt: 'A person skipping along a garden path', duration: 6, preset: car };
  const prompt = motionPrompt(brief);
  assert.ok(prompt.includes(brief.sourcePrompt));
  assert.match(prompt, /comes to life with basic movement/);
  assert.ok(!prompt.includes(brief.prompt));
  assert.ok(!prompt.includes(car.prompt));
  assert.ok(!prompt.includes('restrained camera'));
  assert.match(motionSystem(brief), /skipping should continue skipping/);
});
