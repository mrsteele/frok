import test from 'node:test';
import assert from 'node:assert/strict';
import { draftModeSelection, resolveDraftImages, validateDraftImage, type DraftImage } from '../src/lib/draft-images';
import { freshComposer } from '../src/lib/composer-preferences';
import { generationSchema } from '../src/lib/validation';
import type { Media } from '../src/lib/types';

const draft=(id:string):DraftImage=>({id,file:new File(['image'],`${id}.png`,{type:'image/png'}),previewUrl:`blob:${id}`,uploaded:{}});
const saved=(id:string,referenceOnly=false):Media=>({id,referenceOnly,kind:'image',origin:'upload',filename:`${id}.png`,prompt:'',enhancedPrompt:'',seed:0,width:64,height:64,favorite:false,createdAt:'2026-01-01'});

test('switching staged images between video and references preserves the local selection without uploading',()=>{
  const items=[draft('first'),draft('second')];
  const video={...freshComposer(),mode:'video' as const,sourceId:'first'};
  const refs={...video,mode:'reference' as const,...draftModeSelection(video,'reference',items)};
  assert.equal(refs.sourceId,undefined);assert.deepEqual(refs.referenceIds,['first']);
  assert.deepEqual(draftModeSelection({...refs,referenceIds:['first','second']},'video',items),{sourceId:'first',referenceIds:[]});
  assert.deepEqual(draftModeSelection(refs,'image',items),{sourceId:undefined,referenceIds:[]});
  assert.deepEqual(items.map(item=>item.uploaded),[{},{}]);
});
test('Generate uploads only selected files with the final mode’s purpose and preserves reference order',async()=>{
  const items=[draft('first'),draft('second'),draft('removed')],calls:string[]=[];
  const input={...freshComposer(),mode:'reference' as const,prompt:'Move slowly',referenceIds:['second','existing','first']};
  const result=await resolveDraftImages(input,items,async(file,purpose)=>{calls.push(`${file.name}:${purpose}`);return saved(`saved-${file.name}`,purpose==='reference');});
  assert.deepEqual(calls,['second.png:reference','first.png:reference']);
  assert.deepEqual(result.request.referenceIds,['saved-second.png','existing','saved-first.png']);
  assert.deepEqual(input.referenceIds,['second','existing','first']);
  assert.equal(result.request.sourceId,undefined);
  assert.deepEqual(items[2].uploaded,{});
  assert.ok([...result.replacements.values()].every(item=>item.referenceOnly));
});
test('image-to-video uploads a root image and reuses it if job submission needs a retry',async()=>{
  const items=[draft('first')];let calls=0;
  const input={...freshComposer(),mode:'video' as const,sourceId:'first'};
  const upload=async(_file:File,purpose:'image'|'reference')=>{calls++;assert.equal(purpose,'image');return saved('root-image');};
  const result=await resolveDraftImages(input,items,upload);
  assert.equal(result.request.sourceId,'root-image');assert.equal(result.replacements.get('first')?.referenceOnly,false);
  assert.deepEqual(await resolveDraftImages(input,items,upload),result);assert.equal(calls,1);
});
test('partial upload failures keep successful references for retry without changing draft IDs',async()=>{
  const items=[draft('first'),draft('second')];let fail=true;const calls:string[]=[];
  const input={...freshComposer(),mode:'reference' as const,prompt:'Move slowly',referenceIds:['first','second']};
  const upload=async(file:File)=>{calls.push(file.name);if(file.name==='second.png'&&fail)throw Error('Disconnected');return saved(file.name,true);};
  await assert.rejects(resolveDraftImages(input,items,upload),/Disconnected/);
  fail=false;
  const result=await resolveDraftImages(input,items,upload);
  assert.deepEqual(calls,['first.png','second.png','second.png']);
  assert.deepEqual(result.request.referenceIds,['first.png','second.png']);
  assert.deepEqual(input.referenceIds,['first','second']);
});
test('retry reuploads an expired reference but retains cached uploads when their check fails',async()=>{
  const items=[draft('first')],input={...freshComposer(),mode:'reference' as const,prompt:'Move slowly',referenceIds:['first']};
  items[0].uploaded.reference=saved('expired',true);let uploads=0;
  const upload=async()=>{uploads++;return saved('replacement',true);};
  await assert.rejects(resolveDraftImages(input,items,upload,async()=>{throw Error('Disconnected');}),/Disconnected/);
  assert.equal(uploads,0);assert.equal(items[0].uploaded.reference?.id,'expired');
  const result=await resolveDraftImages(input,items,upload,async()=>false);
  assert.equal(uploads,1);assert.deepEqual(result.request.referenceIds,['replacement']);
  await resolveDraftImages(input,items,upload,async()=>true);assert.equal(uploads,1);
});
test('file and generation validation can reject invalid drafts before any upload',()=>{
  assert.throws(()=>validateDraftImage(new File([],'empty.png',{type:'image/png'})));
  assert.throws(()=>validateDraftImage(new File(['text'],'file.txt',{type:'text/plain'})));
  assert.doesNotThrow(()=>validateDraftImage(draft('valid').file));
  assert.equal(generationSchema.safeParse({...freshComposer(),mode:'reference',referenceIds:[crypto.randomUUID()]}).success,false);
});
