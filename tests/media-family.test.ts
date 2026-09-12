import test from 'node:test';
import assert from 'node:assert/strict';
import { groupMediaFamily, animationRequest, redoRequest, upscaleRequest, newlyAvailableRender } from '../src/lib/media-family';
import { mediaPath } from '../src/lib/navigation';
import type { Media } from '../src/lib/types';
import { generationSchema } from '../src/lib/validation';
import { applyDefaultVideoPreset, decodeVideoPresets } from '../src/lib/video-presets';
const root:Media={id:'root',kind:'image',filename:'synthetic.png',prompt:'A paper boat on a pond',enhancedPrompt:'A blue paper boat on a quiet pond',width:640,height:480,seed:1,favorite:true,origin:'generated',createdAt:'2026-01-01'};
const video:Media={...root,id:'video',kind:'video',sourceId:root.id,prompt:'Drift left',enhancedPrompt:'A boat drifts left',duration:6,videoStyle:'fun',createdAt:'2026-01-02'};
test('newly completed renders replace the open asset while initial history and repeated polls do not redirect',()=>{
  const first={...video,rootId:root.id,assetNumber:2};
  const next={...first,id:'next',assetNumber:3,jobId:'external-job',createdAt:'2026-01-03'};
  const before=groupMediaFamily(root,[root,first]);
  const after=groupMediaFamily(root,[root,first,next]);
  assert.equal(newlyAvailableRender(undefined,before),undefined);
  assert.equal(newlyAvailableRender(before,before),undefined);
  assert.equal(mediaPath(newlyAvailableRender(before,after)!),'/asset/root/3');
  assert.equal(newlyAvailableRender(after,after),undefined);
  assert.equal(newlyAvailableRender(after,groupMediaFamily(root,[root,first])),undefined);
  assert.equal(newlyAvailableRender(undefined,after,'external-job')?.id,'next');
});
test('new HD files switch to their original render URL, including subsequent upscale replacements',()=>{
  const first={...video,rootId:root.id,assetNumber:2};
  const hd={...first,id:'hd',origin:'upscale' as const,sourceId:first.id,jobId:'upscale-job',createdAt:'2026-01-03'};
  const before=groupMediaFamily(root,[root,first]);
  const after=groupMediaFamily(root,[root,first,hd]);
  assert.equal(mediaPath(newlyAvailableRender(before,after)!),'/asset/root/2');
  assert.equal(newlyAvailableRender(undefined,after,'upscale-job')?.id,first.id);
  const replacement={...hd,id:'replacement',createdAt:'2026-01-04'};
  assert.equal(newlyAvailableRender(after,groupMediaFamily(root,[root,first,hd,replacement]))?.id,first.id);
});
test('text and reference video roots follow new takes and choose the newest of multiple completed outputs',()=>{
  for(const mode of ['video','reference'] as const){
    const videoRoot={...video,id:'video-root',sourceId:undefined,rootId:'video-root',assetNumber:1,generation:{...upscaleRequest(video),mode}};
    const second={...videoRoot,id:'second',assetNumber:2,createdAt:'2026-01-03'};
    const third={...videoRoot,id:'third',assetNumber:3,createdAt:'2026-01-04'};
    const before=groupMediaFamily(videoRoot,[videoRoot]);
    const after=groupMediaFamily(videoRoot,[third,second,videoRoot]);
    assert.equal(mediaPath(newlyAvailableRender(before,after)!),'/asset/video-root/3');
    assert.equal(newlyAvailableRender(groupMediaFamily(root,[root,video]),after),undefined);
  }
});
test('Redo overrides a pinned seed, avoids the previous seed, and leaves generation controls unchanged',()=>{
  const controls={seed:123,duration:8,quality:'preview' as const};
  const next=redoRequest(root,{...video,seed:2147483647},false,controls,()=>2147483647);
  assert.equal(next.seed,0);assert.equal(next.sourceId,root.id);assert.equal(next.prompt,video.prompt);assert.equal(next.duration,8);assert.equal(controls.seed,123);
  assert.equal(redoRequest(root,video,false,controls,()=>42).seed,42);
});
test('upscaling every video type uses the selected upscaler, not its generation pipeline or references',()=>{
  for(const mode of ['video','reference'] as const){
    const item={...video,id:'11111111-1111-4111-8111-111111111111',generation:{mode,pipelineId:'video-pipeline',rootId:'root-video',sourceId:mode==='video'?root.id:undefined,prompt:video.prompt,aspect:'4:3',duration:8,quality:'preview' as const,count:1,referenceIds:mode==='reference'?['reference-image']:[],enhance:true}};
    const input=upscaleRequest(item);
    assert.equal(input.mode,'upscale');assert.equal(input.sourceId,item.id);assert.equal(input.pipelineId,undefined);
    assert.equal(input.rootId,undefined);assert.deepEqual(input.referenceIds,[]);assert.equal(input.enhance,false);
    assert.equal(input.duration,8);assert.equal(input.aspect,'4:3');assert.equal(generationSchema.safeParse(input).success,true);
  }
});
test('text video redo keeps video lineage and prompt without attaching an image',()=>{
  const text={...video,id:'text',sourceId:undefined,videoStyle:undefined,generation:{mode:'video' as const,prompt:video.prompt,aspect:'16:9',duration:8,quality:'standard' as const,count:1,referenceIds:[],enhance:false}};
  const input=animationRequest(text,text,{prompt:'Should not replace the text prompt'},false,{seed:0});
  assert.equal(input.rootId,text.id);assert.equal(input.sourceId,undefined);assert.equal(input.prompt,text.prompt);
  assert.equal(input.mode,'video');assert.equal(input.aspect,'16:9');assert.equal(input.seed,0);assert.equal(input.videoStyle,undefined);
});
test('reference redo and prompt edits retain reference order and the root video',()=>{
  const reference={...video,id:'reference',sourceId:undefined,generation:{mode:'reference' as const,prompt:video.prompt,aspect:'4:3',duration:6,quality:'preview' as const,count:1,referenceIds:['ref-2','ref-1'],enhance:false}};
  const sibling={...reference,id:'sibling',prompt:'Circle slowly'};
  const redo=animationRequest(reference,sibling);
  const edit=animationRequest(reference,sibling,{prompt:'Circle faster'});
  assert.equal(redo.prompt,'Circle slowly');assert.equal(edit.prompt,'Circle faster');
  for(const input of [redo,edit]){assert.equal(input.mode,'reference');assert.equal(input.rootId,reference.id);assert.equal(input.sourceId,undefined);assert.deepEqual(input.referenceIds,['ref-2','ref-1']);assert.notEqual(input.referenceIds,reference.generation.referenceIds);assert.equal(input.videoStyle,undefined);}
});
test('legacy previous-frame fields are dropped at the API boundary',()=>{
  const input=generationSchema.parse({mode:'video',sourceId:'11111111-1111-4111-8111-111111111111',fromVideoId:'22222222-2222-4222-8222-222222222222'});
  assert.equal('fromVideoId' in input,false);
});
test('the carousel keeps one slide per render and groups HD copies with their SD original',()=>{
  const hd:Media={...video,id:'hd',origin:'upscale',sourceId:video.id,width:960,height:720,createdAt:'2026-01-03'};
  const second={...video,id:'second',createdAt:'2026-01-04'};
  const upgraded={...hd,id:'new-hd',sourceId:hd.id,createdAt:'2026-01-05'};
  const family=groupMediaFamily(root,[second,hd,root,video,upgraded]);
  assert.deepEqual(family.renders.map(r=>r.media.id),['video','second']);
  assert.equal(family.renders[0].hd?.id,'new-hd');assert.equal(family.renders[1].hd,undefined);
});
test('Redo preserves saved text, style and enhancement preference, with a fresh seed from the root image',()=>{
  const input=animationRequest(root,{...video,generation:{mode:'video',prompt:video.prompt,sourceId:root.id,videoStyle:'fun',duration:8,quality:'preview',aspect:'4:3',count:1,referenceIds:[],enhance:false,seed:123}});
  assert.equal(input.prompt,video.prompt);assert.equal(input.videoStyle,'fun');assert.equal(input.duration,8);assert.equal(input.enhance,false);assert.equal(input.seed,undefined);assert.equal(input.sourceId,root.id);assert.equal('fromVideoId' in input,false);assert.equal(input.adapters,undefined);
});
test('empty Custom uses the configured recipe while editing makes a new custom variation',()=>{
  const normal=applyDefaultVideoPreset(animationRequest(root,undefined,{prompt:'',videoStyle:'custom'}),decodeVideoPresets(null));
  assert.equal(normal.videoStyle,'preset');assert.equal(normal.videoPreset?.name,'Normal');assert.equal(normal.prompt,'');assert.equal(normal.duration,6);
  const edit=animationRequest(root,video,{prompt:'Drift right',videoStyle:'custom'});
  assert.equal(edit.prompt,'Drift right');assert.equal(edit.videoStyle,'custom');assert.equal('fromVideoId' in edit,false);assert.equal(video.prompt,'Drift left');
});

test('viewer controls apply to custom and recipe renders without losing the root image or motion instruction',()=>{
  const controls={mode:'image',prompt:'Unrelated composer draft',sourceId:undefined,duration:10,quality:'standard' as const,seed:42};
  const recipe={id:'boat',name:'Boat ride',prompt:'Drift in a slow circle'};
  for(const options of [{prompt:'Turn left',videoStyle:'custom' as const},{prompt:'Ignored',videoStyle:'preset' as const,videoPreset:recipe}]){
    const input=animationRequest(root,video,options,false,controls);
    assert.equal(input.duration,10);assert.equal(input.quality,'standard');assert.equal(input.seed,42);
    assert.equal(input.mode,'video');
    assert.equal(input.enhance,false);assert.equal(input.sourceId,root.id);assert.equal('fromVideoId' in input,false);
    if(options.videoStyle==='preset'){assert.equal(input.prompt,'');assert.deepEqual(input.videoPreset,recipe);}
    else assert.equal(input.prompt,'Turn left');
  }
});
