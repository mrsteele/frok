import { createLibraryFixture } from './fixtures/library';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { DeletePlan, DeleteTarget, Generation, Media } from '../src/lib/types';

const testDir=path.join(process.cwd(),'.data',`deletion-test-${process.pid}`);
process.env.FROK_DATA_DIR=testDir;
const fixture = await createLibraryFixture();
const { test, after, beforeEach } = fixture;
const store=await import('../src/lib/db');
const {deletionPlan,deleteMedia}=await import('../src/lib/media-delete');
const routes=await import('../src/app/api/[[...segments]]/route');
const mediaDir=path.join(fixture.directory,'media');
const request:Generation={mode:'video',prompt:'Synthetic test',aspect:'1:1',duration:6,quality:'preview',count:1,enhance:false,referenceIds:[]};
function media(patch:Partial<Media>={}){
  const id=randomUUID();
  const item:Media={id,kind:'image',filename:`${id}.jpg`,prompt:'Synthetic fixture',enhancedPrompt:'',width:32,height:32,seed:1,favorite:false,origin:'generated',createdAt:new Date().toISOString(),...patch};
  store.saveMedia(item);if(patch.favorite)store.favoriteMedia(item.id,true);fs.writeFileSync(path.join(mediaDir,item.filename),'disposable test bytes');return item;
}
function video(root:Media,patch:Partial<Media>={}){return media({kind:'video',sourceId:root.id,rootId:root.id,...patch});}
const target=(item:Media):DeleteTarget=>({scope:'media',id:item.id});
async function call(method:'GET'|'POST',input:DeleteTarget,token?:string,origin?:string){
  const query=`?scope=${input.scope}${input.scope==='media'?`&id=${input.id}`:''}`;
  return routes[method](fixture.request(`http://localhost:3000/api/deletion${method==='GET'?query:''}`,{method,headers:{'Content-Type':'application/json',...(origin?{origin}:{})},body:method==='POST'?JSON.stringify({target:input,token}):undefined}),{params:Promise.resolve({segments:['deletion']})});
}
beforeEach(()=>{store.db.exec('DELETE FROM media; DELETE FROM jobs; DELETE FROM settings;');for(const dir of ['media','deletions'])fs.rmSync(path.join(fixture.directory,dir),{recursive:true,force:true});fs.mkdirSync(mediaDir,{recursive:true});});
after(()=>{fixture.close();fs.rmSync(testDir,{recursive:true,force:true});});

test('saved reference videos retain their reference images until the creation is deleted',async()=>{
  const ref=media({origin:'upload'});
  const root=media({kind:'video',favorite:true,generation:{...request,mode:'reference',referenceIds:[ref.id]}});
  assert.match(deletionPlan(target(ref)).blocked||'',/saved reference/);
  const rootPlan=deletionPlan(target(root));assert.equal(rootPlan.blocked,undefined);
  await deleteMedia(target(root),rootPlan.token);
  assert.equal(deletionPlan(target(ref)).blocked,undefined);
});

test('deleting a reference video creation removes its exclusive attachments, renders and HD versions',async()=>{
  const ref=media({origin:'upload',referenceOnly:true}),ordinary=media({origin:'upload'}),unrelated=media({origin:'upload',referenceOnly:true});
  const root=media({kind:'video',favorite:true,generation:{...request,mode:'reference',referenceIds:[ref.id,ordinary.id]}});
  const redo=video(root,{generation:root.generation}),hd=video(root,{origin:'upscale',sourceId:redo.id,generation:root.generation});
  const plan=deletionPlan(target(root));
  assert.equal(plan.referenceImages,1);assert.equal(plan.favorites,1);assert.equal(plan.total,4);assert.equal(plan.blocked,undefined);
  assert.deepEqual(new Set((await deleteMedia(target(root),plan.token)).deletedIds),new Set([root.id,redo.id,hd.id,ref.id]));
  assert.equal(store.getMedia(ref.id),undefined);assert.equal(fs.existsSync(path.join(mediaDir,ref.filename)),false);
  for(const item of [ordinary,unrelated])assert.ok(store.getMedia(item.id));
});

test('shared references survive deleting one render or creation until their last consumer is removed',async()=>{
  const ref=media({origin:'upload',referenceOnly:true}),generation={...request,mode:'reference' as const,referenceIds:[ref.id]};
  const root=media({kind:'video',generation}),redo=video(root,{generation}),other=media({kind:'video',generation});
  for(const item of [redo,root]){
    const plan=deletionPlan(target(item));assert.equal(plan.referenceImages,0);
    await deleteMedia(target(item),plan.token);assert.ok(store.getMedia(ref.id));
  }
  const last=deletionPlan(target(other));assert.equal(last.referenceImages,1);
  await deleteMedia(target(other),last.token);assert.equal(store.getMedia(ref.id),undefined);
});

test('all surviving job states protect shared references and a new consumer invalidates the preview',async()=>{
  for(const status of ['queued','running','failed','cancelled','completed'] as const){
    const ref=media({origin:'upload',referenceOnly:true}),generation={...request,mode:'reference' as const,referenceIds:[ref.id]};
    const root=media({kind:'video',generation}),plan=deletionPlan(target(root));assert.equal(plan.referenceImages,1);
    const job=store.createJob({kind:'generate',runner:'vpipe',request:generation,total:1});store.updateJob(job.id,{status});
    await assert.rejects(deleteMedia(target(root),plan.token),/library changed/);
    const refreshed=deletionPlan(target(root));assert.equal(refreshed.referenceImages,0);assert.equal(refreshed.blocked,undefined);
    await deleteMedia(target(root),refreshed.token);assert.ok(store.getMedia(ref.id));assert.ok(store.getJob(job.id));
  }
});

test('attachment deletion rolls back with its video if a file move fails',async()=>{
  const ref=media({origin:'upload',referenceOnly:true});
  const root=media({kind:'video',generation:{...request,mode:'reference',referenceIds:[ref.id]}}),plan=deletionPlan(target(root));
  const rename=fs.renameSync;let count=0;
  fs.renameSync=(...args)=>{if(++count===2)throw Error('Synthetic attachment move failure');return rename(...args);};
  try{await assert.rejects(deleteMedia(target(root),plan.token),/Synthetic attachment move/);}finally{fs.renameSync=rename;}
  for(const item of [ref,root]){assert.ok(store.getMedia(item.id));assert.ok(fs.existsSync(path.join(mediaDir,item.filename)));}
});

test('history and section deletion include unused reference attachments but preserve saved creations',async()=>{
  for(const scope of ['history','section'] as const){
    const ref=media({origin:'upload',referenceOnly:true}),keptRef=media({origin:'upload',referenceOnly:true});
    const generation={...request,mode:'reference' as const,referenceIds:[ref.id]};
    const job=store.createJob({kind:'generate',runner:'vpipe',request:generation,total:1});store.updateJob(job.id,{status:'completed'});
    const root=media({kind:'video',jobId:job.id,generation}),saved=media({kind:'video',favorite:true,generation:{...generation,referenceIds:[keptRef.id]}});
    const target:DeleteTarget=scope==='history'?{scope}:{scope,jobIds:[job.id]};
    const plan=deletionPlan(target);assert.equal(plan.referenceImages,1);
    await deleteMedia(target,plan.token);
    for(const item of [root,ref])assert.equal(store.getMedia(item.id),undefined);
    for(const item of [saved,keptRef])assert.ok(store.getMedia(item.id));
  }
});

test('queued video-root rerenders protect the root from deletion',async()=>{
  const root=media({kind:'video'});
  store.createJob({kind:'generate',runner:'vpipe',total:1,request:{...request,rootId:root.id}});
  assert.match(deletionPlan(target(root)).blocked||'',/active job/);
});

test('deletion preview is read-only and confirmation is required at the API',async()=>{
  const image=media();const response=await call('GET',target(image));assert.equal(response.status,200);const plan=await response.json() as DeletePlan;
  assert.equal(plan.images,1);assert.ok(store.getMedia(image.id));assert.ok(fs.existsSync(path.join(mediaDir,image.filename)));
  assert.equal((await call('POST',target(image))).status,400);
  assert.equal((await call('POST',target(image),plan.token,'https://outside.example')).status,403);
  assert.ok(store.getMedia(image.id));
});
test('deleting a video removes its SD and chained HD versions but keeps root and sibling renders',async()=>{
  const root=media(),first=video(root),hd=video(root,{origin:'upscale',sourceId:first.id}),hd2=video(root,{origin:'upscale',sourceId:hd.id}),sibling=video(root);
  const plan=deletionPlan(target(hd));assert.deepEqual([plan.images,plan.videos,plan.hdVersions],[0,1,2]);
  const result=await deleteMedia(target(hd),plan.token);assert.deepEqual(new Set(result.deletedIds),new Set([first.id,hd.id,hd2.id]));
  for(const item of [first,hd,hd2]){assert.equal(store.getMedia(item.id),undefined);assert.equal(fs.existsSync(path.join(mediaDir,item.filename)),false);}
  for(const item of [root,sibling])assert.ok(store.getMedia(item.id));
});
test('image deletion explicitly counts and removes every attached video, including favorites',async()=>{
  const root=media({favorite:true}),first=video(root,{favorite:true}),hd=video(root,{origin:'upscale',sourceId:first.id,favorite:true});video(root);const unrelated=media();
  const plan=deletionPlan(target(root));assert.equal(plan.total,4);assert.equal(plan.favorites,1);
  const response=await call('POST',target(root),plan.token);assert.equal(response.status,200);assert.equal((await response.json()).deletedIds.length,4);
  assert.deepEqual(store.listMedia().map(item=>item.id),[unrelated.id]);assert.ok(store.getValue('mediaRevision',0)>=1);assert.equal(fs.readdirSync(path.join(fixture.directory,'deletions')).length,0);assert.equal(store.getMedia(hd.id),undefined);
});
test('clear history preserves every member of saved groups, including sibling renders',async()=>{
  const root=media(),saved=video(root,{favorite:true}),hd=video(root,{origin:'upscale',sourceId:saved.id}),unsaved=video(root),discard=media(),upload=media({origin:'upload'});
  const plan=deletionPlan({scope:'history'});assert.equal(plan.favorites,0);assert.equal(plan.total,1);
  await deleteMedia({scope:'history'},plan.token);
  for(const item of [root,saved,hd,unsaved,upload])assert.ok(store.getMedia(item.id));
  for(const item of [discard])assert.equal(store.getMedia(item.id),undefined);
});
test('active sources, references and outputs are protected without blocking unrelated history cleanup',async()=>{
  const root=media(),ref=media(),unused=media();
  const job=store.createJob({kind:'generate',runner:'vpipe',request:{...request,sourceId:root.id,referenceIds:[ref.id]},total:1});
  const output=media({jobId:job.id});
  const plan=deletionPlan(target(root));assert.match(plan.blocked!,/active job/);await assert.rejects(()=>deleteMedia(target(root),plan.token),/active job/);
  const clear=deletionPlan({scope:'history'});assert.equal(clear.total,1);await deleteMedia({scope:'history'},clear.token);
  for(const item of [root,ref,output])assert.ok(store.getMedia(item.id));assert.equal(store.getMedia(unused.id),undefined);
});
test('a new video or favorite change requires a fresh confirmation',async()=>{
  const root=media(),plan=deletionPlan(target(root));video(root);await assert.rejects(()=>deleteMedia(target(root),plan.token),/library changed/);assert.equal(store.listMedia().length,2);
  const clear=deletionPlan({scope:'history'});store.favoriteMedia(root.id,true);await assert.rejects(()=>deleteMedia({scope:'history'},clear.token),/library changed/);assert.ok(store.getMedia(root.id));
});
test('new jobs and retries cannot queue references that were deleted during request validation',async()=>{
  const root=media();await deleteMedia(target(root),deletionPlan(target(root)).token);
  assert.throws(()=>store.createJob({kind:'generate',runner:'vpipe',request:{...request,sourceId:root.id},total:1}),/deleted/);assert.equal(store.listJobs().length,0);
});
test('file-move failure rolls back both files and library records',async()=>{
  const root=media(),clip=video(root),plan=deletionPlan(target(root));const rename=fs.renameSync;let moves=0;
  fs.renameSync=(...args)=>{if(++moves===2)throw new Error('Synthetic disk failure');return rename(...args);};
  try{await assert.rejects(()=>deleteMedia(target(root),plan.token),/Synthetic disk failure/);}finally{fs.renameSync=rename;}
  for(const item of [root,clip]){assert.ok(store.getMedia(item.id));assert.ok(fs.existsSync(path.join(mediaDir,item.filename)));}
});
test('an interrupted uncommitted deletion restores its staged file',async()=>{
  const root=media();const dir=path.join(fixture.directory,'deletions',randomUUID());fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify([{id:root.id,filename:root.filename}]));fs.renameSync(path.join(mediaDir,root.filename),path.join(dir,root.filename));
  deletionPlan(target(root));assert.ok(fs.existsSync(path.join(mediaDir,root.filename)));assert.equal(fs.existsSync(dir),false);
});

test('a failed rollback releases the database lock and recovers files on the next attempt',async()=>{
  const root=media(),clip=video(root),plan=deletionPlan(target(root));const rename=fs.renameSync;let moves=0;
  fs.renameSync=(...args)=>{if(++moves>=2)throw new Error('Synthetic access failure');return rename(...args);};
  try{await assert.rejects(()=>deleteMedia(target(root),plan.token),/held for recovery/);}finally{fs.renameSync=rename;}
  store.db.exec('BEGIN IMMEDIATE; ROLLBACK;');
  deletionPlan(target(root));
  for(const item of [root,clip]){assert.ok(store.getMedia(item.id));assert.ok(fs.existsSync(path.join(mediaDir,item.filename)));}
});


function imageBatch() {
  const item=store.createJob({kind:'generate',runner:'vpipe',request:{...request,mode:'image',count:2},total:2});
  return store.updateJob(item.id,{status:'completed',completed:2})!;
}

test('section deletion removes its unsaved families from all listings and protects every favorite sibling',async()=>{
  const batch=imageBatch(),root=media({jobId:batch.id}),clip=video(root),hd=video(root,{origin:'upscale',sourceId:clip.id});
  const favorite=media({jobId:batch.id,favorite:true}),savedVideo=video(favorite),savedHD=video(favorite,{origin:'upscale',sourceId:savedVideo.id});
  const older=media({jobId:imageBatch().id}); // Same prompt, separate visit: outside this section.
  const target:DeleteTarget={scope:'section',jobIds:[batch.id]};
  const plan=deletionPlan(target);assert.equal(plan.total,3);assert.equal(plan.favorites,0);assert.equal(plan.protectedCount,3);
  const result=await deleteMedia(target,plan.token);assert.deepEqual(new Set(result.deletedIds),new Set([root.id,clip.id,hd.id]));
  for(const item of [favorite,savedVideo,savedHD,older]){assert.ok(store.getMedia(item.id));assert.ok(fs.existsSync(path.join(mediaDir,item.filename)));}
  assert.deepEqual(new Set(store.listSessionMedia([batch.id]).map(item=>item.id)),new Set([favorite.id,savedVideo.id,savedHD.id]));
  assert.equal(store.listAssets().media.length,2);assert.equal(store.listAssets(true).media.length,1);
});

test('clearing a favorite-only section removes inactive job details and retains the saved section',async()=>{
  const batch=imageBatch(),saved=media({jobId:batch.id,favorite:true});
  const target:DeleteTarget={scope:'section',jobIds:[batch.id]},plan=deletionPlan(target);
  assert.equal(plan.total,0);assert.equal(plan.protectedCount,1);
  assert.deepEqual(await deleteMedia(target,plan.token),{deletedIds:[],deletedJobs:1,cleanupPending:false});assert.ok(store.getMedia(saved.id));
});

test('a queued or running section is blocked even before its first output exists',async()=>{
  const pending=store.createJob({kind:'generate',runner:'vpipe',request:{...request,mode:'image'},total:1});
  const target:DeleteTarget={scope:'section',jobIds:[pending.id]};
  for(const status of ['queued','running'] as const){store.updateJob(pending.id,{status});const plan=deletionPlan(target);assert.equal(plan.total,0);assert.match(plan.blocked!,/active jobs/);await assert.rejects(()=>deleteMedia(target,plan.token),/active jobs/);}
  store.updateJob(pending.id,{status:'cancelled'});const plan=deletionPlan(target);assert.equal(plan.blocked,undefined);assert.deepEqual(await deleteMedia(target,plan.token),{deletedIds:[],deletedJobs:1,cleanupPending:false});
});

test('favoriting a section item after reviewing deletion requires confirmation again',async()=>{
  const batch=imageBatch(),first=media({jobId:batch.id}),second=media({jobId:batch.id});
  const target:DeleteTarget={scope:'section',jobIds:[batch.id]},plan=deletionPlan(target);
  store.favoriteMedia(first.id,true);
  await assert.rejects(()=>deleteMedia(target,plan.token),/library changed/);
  assert.ok(store.getMedia(first.id));assert.ok(store.getMedia(second.id));
  await deleteMedia(target,deletionPlan(target).token);assert.ok(store.getMedia(first.id));assert.equal(store.getMedia(second.id),undefined);
});

test('section preview accepts a structured target, validates IDs, and does not delete without its token',async()=>{
  const batch=imageBatch(),item=media({jobId:batch.id}),target:DeleteTarget={scope:'section',jobIds:[batch.id]};
  const preview=await routes.POST(fixture.request('http://localhost:3000/api/deletion/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(target)}),{params:Promise.resolve({segments:['deletion','preview']})});
  assert.equal(preview.status,200);const plan=await preview.json() as DeletePlan;assert.equal(plan.total,1);assert.ok(store.getMedia(item.id));
  assert.equal((await call('POST',target)).status,400);
  assert.equal((await call('POST',{scope:'section',jobIds:['bad-id']},plan.token)).status,400);
  assert.equal((await call('POST',target,plan.token)).status,200);assert.equal(store.getMedia(item.id),undefined);
});

test('a section opened from an existing image includes its unsaved root and related video group',async()=>{
  const root=media();const animation=store.createJob({kind:'generate',runner:'vpipe',request:{...request,sourceId:root.id},total:1});
  store.updateJob(animation.id,{status:'completed',completed:1});const clip=video(root,{jobId:animation.id});
  const target:DeleteTarget={scope:'section',jobIds:[animation.id]};
  assert.equal(deletionPlan(target).total,2);await deleteMedia(target,deletionPlan(target).token);
  assert.equal(store.getMedia(root.id),undefined);assert.equal(store.getMedia(clip.id),undefined);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM prompt_sections WHERE id=?').get(root.id)!.n,0);
});

test('persistent section deletion still finds all batches after queue records are gone',async()=>{
  const batch=imageBatch(),first=media({jobId:batch.id}),saved=media({jobId:batch.id,favorite:true});
  const more=store.createJob({kind:'generate',runner:'vpipe',total:1,request:{...request,mode:'image',sectionId:batch.id}});
  store.updateJob(more.id,{status:'completed'});const second=media({jobId:more.id});
  store.db.exec('DELETE FROM jobs');
  const target:DeleteTarget={scope:'section',sectionId:batch.id,jobIds:[]};
  const preview=await routes.POST(fixture.request('http://localhost:3000/api/deletion/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(target)}),{params:Promise.resolve({segments:['deletion','preview']})});
  assert.equal(preview.status,200);const plan=await preview.json() as DeletePlan;
  assert.equal(plan.total,2);assert.equal(plan.protectedCount,1);
  assert.deepEqual(new Set((await deleteMedia(target,plan.token)).deletedIds),new Set([first.id,second.id]));
  const {listPromptLibrary}=await import('../src/lib/prompt-library');
  const section=listPromptLibrary(store.db).sections.find(s=>s.id===batch.id)!;
  assert.equal(section.id,batch.id);assert.ok(store.getMedia(saved.id));
});

test('a persistent section with a queued Load more batch cannot be deleted',()=>{
  const batch=imageBatch();media({jobId:batch.id});
  store.createJob({kind:'generate',runner:'vpipe',total:1,request:{...request,mode:'image',sectionId:batch.id}});
  assert.match(deletionPlan({scope:'section',sectionId:batch.id,jobIds:[]}).blocked!,/active jobs/);
});
