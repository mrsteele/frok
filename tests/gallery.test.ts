import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionGallery } from '../src/lib/gallery';
import { generationSchema } from '../src/lib/validation';
import { motionPrompt } from '../src/lib/motion';
import type { Generation, Job, Media } from '../src/lib/types';
const request: Generation = { mode: 'image', prompt: 'A paper boat', aspect: '3:4', duration: 6, quality: 'preview', count: 12, enhance: false, referenceIds: [] };
const job: Job = { id: 'batch', kind: 'generate', request, runner: 'vpipe', status: 'running', completed: 0, total: 12, message: '', createdAt: '2026-01-01', updatedAt: '2026-01-01' };
const output = (index: number): Media => ({ id: `image-${index}`, jobId: 'batch', batchIndex: index, kind: 'image', filename: 'synthetic.jpg', prompt: request.prompt, enhancedPrompt: request.prompt, width: 384, height: 512, seed: index, favorite: false, origin: 'generated', createdAt: `2026-01-01T00:00:${String(index).padStart(2,'0')}.000Z` });

test('a twelve-image batch reserves twelve distinct slots, with only the active output generating', () => {
  const entries = sessionGallery([], [job], ['batch']);
  assert.equal(entries.length, 12);
  assert.equal(new Set(entries.map(e => e.key)).size, 12);
  assert.equal(entries.filter(e => e.kind === 'pending' && e.state === 'generating').length, 1);
  assert.equal(entries.filter(e => e.kind === 'pending' && e.state === 'queued').length, 11);
  assert.ok(entries.every(e => e.kind === 'pending' && e.aspect === '3 / 4'));
  assert.ok(sessionGallery([], [{ ...job, status: 'queued' }], ['batch']).every(e => e.kind === 'pending' && e.state === 'queued'));
});

test('out-of-order output polls replace their original slots without changing slot keys', () => {
  const before = sessionGallery([], [job], ['batch']);
  const after = sessionGallery([output(2), output(0)], [{ ...job, completed: 3 }], ['batch']);
  assert.deepEqual(after.map(e => e.key), before.map(e => e.key));
  assert.equal(after[0].kind, 'media');
  assert.equal(after[2].kind, 'media');
  assert.ok(after[1].kind === 'pending' && after[1].state === 'loading');
  assert.ok(after[3].kind === 'pending' && after[3].state === 'generating');
});

test('stopped batches keep saved outputs and remove unfilled slots; later batches append', () => {
  for (const status of ['failed', 'cancelled', 'completed'] as const) {
    const entries = sessionGallery([output(0), output(1)], [{ ...job, status, completed: 2 }], ['batch']);
    assert.equal(entries.length, 2);
    assert.ok(entries.every(e => e.kind === 'media'));
  }
  const next = { ...job, id: 'next', status: 'queued' as const };
  const entries = sessionGallery([output(0)], [job, next], ['batch', 'next']);
  assert.equal(entries.length, 24);
  assert.equal(entries[12].key, 'next:0');
});

test('legacy media without batch indices still fills slots chronologically and excludes posters', () => {
  const first = { ...output(0), batchIndex: undefined }, second = { ...output(1), batchIndex: undefined };
  const entries = sessionGallery([second, { ...output(2), origin: 'poster' }, first], [{ ...job, completed: 2 }], ['batch', 'batch']);
  assert.equal(entries.length, 12);
  assert.ok(entries[0].kind === 'media' && entries[0].media.id === first.id);
  assert.ok(entries[1].kind === 'media' && entries[1].media.id === second.id);
});

test('animation accepts blank custom and natural prompts while validating the image anchor', () => {
  const input = { ...request, mode: 'video', sourceId: 'c8cc9bd3-aed2-4e41-84b5-b1e9fc4b74f8', prompt: '' };
  assert.ok(generationSchema.safeParse(input).success);
  for (const videoStyle of ['normal', 'fun']) assert.ok(generationSchema.safeParse({ ...input, videoStyle }).success);
  assert.ok(generationSchema.safeParse({ ...input, videoStyle: 'custom' }).success);
  assert.ok(generationSchema.safeParse({ ...input, videoStyle: 'custom', prompt: 'Gently drift to the left' }).success);
  assert.ok(!generationSchema.safeParse({ ...input, sourceId: undefined, videoStyle: 'normal' }).success);
  assert.ok(!generationSchema.safeParse({ ...request, videoStyle: 'normal' }).success);
});

test('built-in motion directions retain source context and explicit custom motion without inventing image details', () => {
  const natural = motionPrompt({ style: 'normal', prompt: '', sourcePrompt: '', duration: 6 });
  assert.match(natural, /basic movement/);
  assert.ok(!natural.includes('Starting image description:'));
  const custom = motionPrompt({ style: 'custom', prompt: 'Gently drift left', sourcePrompt: 'A blue paper boat on a pond', duration: 8 });
  assert.equal(custom, 'A blue paper boat on a pond\n\nGently drift left');
  const longDirection = 'Keep this detail. '.repeat(300) + 'Finish with a slow pan left.';
  assert.ok(motionPrompt({style:'custom',prompt:longDirection,sourcePrompt:'',duration:6}).endsWith(longDirection));
});

test('image-to-video progress reuses its image tile without adding a blank video placeholder',()=>{
  const image=output(0),animation={...job,id:'animation',request:{...request,mode:'video' as const,sourceId:image.id},total:1};
  const entries=sessionGallery([image],[{...job,status:'completed',completed:1},animation],['batch','animation']);
  assert.equal(entries.length,1);assert.ok(entries[0].kind==='media'&&entries[0].media.id===image.id);
  const oldImage={...image,jobId:'old-batch'};
  const multiple=sessionGallery([oldImage],[animation,{...animation,id:'next',status:'queued'}],['animation','next']);
  assert.equal(multiple.length,1);assert.ok(multiple[0].kind==='media'&&multiple[0].media.id===image.id);
  const finished={...output(0),id:'video',kind:'video' as const,jobId:animation.id};
  const result=sessionGallery([oldImage,finished],[{...animation,status:'completed',completed:1}],['animation']);
  assert.equal(result.length,1);assert.ok(result[0].kind==='media'&&result[0].media.id==='video');
});
