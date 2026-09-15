import assert from 'node:assert/strict';
import { mock } from 'node:test';
import fs from 'node:fs';
import promises from 'node:fs/promises';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createLibraryFixture } from './fixtures/library';
import { imageModels } from '../src/lib/image-models';
import { zImageFiles, imageNodes, zImageRevision, zImageUrl } from '../src/lib/image-model-files';
import type { Generation, Job } from '../src/lib/types';
import { withRunnerLocations } from '../src/lib/runner-locations';

const directory=fs.mkdtempSync(path.join(process.cwd(),'.data','image-model-test-'));
Object.assign(process.env,{FROK_DATA_DIR:directory,VPIPE_WORKDIR:path.join(directory,'vpipe'),COMFYUI_DIR:path.join(directory,'comfy'),COMFYUI_URL:'http://127.0.0.1:19999',OLLAMA_URL:'http://127.0.0.1:19998',OLLAMA_MODEL:'synthetic:model',AI_RUNNER:'vpipe',FROK_COMFYUI_PRIVATE:'1',COMFYUI_API_KEY:'',PORT:'3000'});
delete process.env.FROK_ORIGIN;
for(const area of ['INPUT','OUTPUT']){const folder=path.join(directory,area);fs.mkdirSync(folder);process.env[`COMFYUI_${area}_DIR`]=folder;}
fs.mkdirSync(process.env.VPIPE_WORKDIR!,{recursive:true});
for(const method of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'] as const)mock.method(childProcess,method,()=>{throw new Error('No processes allowed in image model tests');});
syncBuiltinESMExports();
const fixture=await createLibraryFixture(), {test,beforeEach,after}=fixture;
const store=await import('../src/lib/db');
const registry=await import('../src/lib/registry');

const routes=await import('../src/app/api/[[...segments]]/route');
const {pipelineStatus,resolvePipeline}=await import('../src/lib/pipelines/catalog');
const {buildComfyGraph}=await import('../src/lib/comfyui');
const {buildPipeline}=await import('../src/lib/vpipe');
const {generationBlocker,missingSetup}=await import('../src/lib/readiness');
const {health}=await import('../src/lib/setup');
const actualStat=promises.stat.bind(promises),actualOpen=promises.open.bind(promises);
fs.mkdirSync(path.join(directory,'comfy/models'),{recursive:true});
let sizes=new Map<string,number>(), info:Record<string,any>={};
const expected=new Map(zImageFiles.map(file=>[path.join(process.env.COMFYUI_DIR!,'models',file.directory,file.name),file]));
mock.method(promises,'stat',async (...args:Parameters<typeof promises.stat>)=>{
  const name=String(args[0]);
  if(expected.has(name)){if(!sizes.has(name))throw Object.assign(new Error('Synthetic missing file'),{code:'ENOENT'});return {size:sizes.get(name),isFile:():boolean=>true};}
  return actualStat(...args);
});
// A bounded-header file handle models the declared multi-GB files without
// allocating their payload, writing sparse weights, or opening real models.
mock.method(promises,'open',async(...args:Parameters<typeof promises.open>)=>{
 const name=String(args[0]);if(!expected.has(name))return actualOpen(...args);
 const size=sizes.get(name);if(!size)throw Object.assign(Error('Missing fixture'),{code:'ENOENT'});
 let header=Buffer.alloc(0);for(let i=0;i<5;i++)header=Buffer.from(JSON.stringify({synthetic:{dtype:'U8',shape:[1],data_offsets:[0,size-8-header.length]}}));
 const length=Buffer.alloc(8);length.writeBigUInt64LE(BigInt(header.length));const bytes=Buffer.concat([length,header]);
 return {stat:async()=>({size,isFile:()=>true}),read:async(buffer:Buffer,offset:number,length:number,position:number)=>{bytes.copy(buffer,offset,position,position+length);return {bytesRead:length,buffer};},close:async()=>{}} as any;
});
mock.method(globalThis,'fetch',async (input:string|URL|Request)=>{
  const url=String(input);
  if(url==='http://127.0.0.1:19999/object_info')return Response.json(info);
  if(url==='http://127.0.0.1:19999/system_stats')return Response.json({});
  if(url==='http://127.0.0.1:19998/api/tags')return Response.json({models:[]});
  throw new Error('No network or model downloads allowed in image model tests');
});
beforeEach(()=>{
  store.db.exec('DELETE FROM jobs; DELETE FROM settings;');
  store.setValue('connections',{vpipe:true,comfyui:true,ollama:false});
  registry.setServiceValue('workerHeartbeat',Date.now());
  sizes=new Map(zImageFiles.map(file=>[path.join(process.env.COMFYUI_DIR!,'models',file.directory,file.name),file.size]));
  info=Object.fromEntries(imageNodes('z-image-turbo').map(node=>[node,{input:{required:{}}}]));
  for(const file of zImageFiles)info[file.node].input.required[file.input]=[[file.name]];
  info.CLIPLoader.input.required.type=[['lumina2']];
  info.KSampler.input.required.sampler_name=[['res_multistep']];
  info.KSampler.input.required.scheduler=[['simple']];
});
after(()=>{mock.restoreAll();syncBuiltinESMExports();fixture.close();fs.rmSync(directory,{recursive:true,force:true});});
function call(endpoint:string,method:'GET'|'POST'|'PATCH'='GET',value?:unknown){return routes[method](fixture.request(`http://localhost:3000/api/${endpoint}`,{method,...(value===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(value)})}),{params:Promise.resolve({segments:endpoint.split('?')[0].split('/')})});}
const request:Generation={mode:'image',prompt:'A blue paper boat',aspect:'1:1',duration:6,quality:'preview',count:4,enhance:false,referenceIds:[]};

test('image pipeline choice is saved globally and leaves the video pipeline unchanged',async()=>{
  assert.equal((await call('settings','PATCH',{pipelineSelections:{video:'vpipe:minimax-h3-turbo',image:'comfyui:z-image-turbo'}})).status,200);
  assert.equal(store.settings().pipelineSelections.video,'vpipe:minimax-h3-turbo');
  for(const id of ['../other/model','unrecognized','https://example.com/model'])assert.equal((await call('settings','PATCH',{pipelineSelections:{image:id}})).status,400);
  assert.equal(store.settings().pipelineSelections.image,'comfyui:z-image-turbo');
});

test('Z-Image graph uses its own latent, encoder, sampling and private output prefix',async()=>{
  const input={request:{...request,imageModel:'z-image-turbo' as const},prompt:request.prompt,seed:812,width:512,height:384,output:'unused',directory:'unused',references:[]};
  const graph=buildComfyGraph(input,undefined,[],'frok/owner/job/render');
  assert.equal(graph['2'].inputs.type,'lumina2');assert.equal(graph['2'].inputs.clip_name,zImageFiles[1].name);
  assert.equal(graph['6'].class_type,'EmptySD3LatentImage');assert.equal(graph['6'].inputs.batch_size,1);
  assert.equal(graph['7'].inputs.shift,3);assert.equal(graph['8'].inputs.steps,8);assert.equal(graph['8'].inputs.cfg,1);
  assert.equal(graph['8'].inputs.seed,812);assert.equal(graph['8'].inputs.sampler_name,'res_multistep');
  assert.deepEqual(graph['8'].inputs.negative,['5',0]);assert.equal(graph['5'].class_type,'ConditioningZeroOut');
  assert.equal(graph['10'].inputs.filename_prefix,'frok/owner/job/render');
  assert.throws(()=>buildComfyGraph({...input,request:{...request,imageModel:'krea-2-turbo'}}),/requires Vpipe/);
  await assert.rejects(buildPipeline(input),/no pipeline/);
  assert.equal(imageModels['z-image-turbo'].runner,'comfyui');
});

test('readiness requires every full model file, loader choice, core node and sampler',async()=>{
  const pipeline=await resolvePipeline('image','comfyui:z-image-turbo');
  const status=()=>pipelineStatus(pipeline);
  assert.equal((await status()).ready,true);
  for(const [file,size] of [...sizes]){sizes.delete(file);assert.equal((await status()).ready,false);sizes.set(file,size-1);assert.equal((await status()).ready,false);sizes.set(file,size);}
  const saved=info.CLIPLoader;delete info.CLIPLoader;assert.match((await status()).detail,/nodes in ComfyUI.*CLIPLoader/);info.CLIPLoader=saved;
  info.KSampler.input.required.sampler_name=[['euler']];assert.match((await status()).detail,/sampler_name is unavailable/);
  info.KSampler.input.required.sampler_name=[['res_multistep']];
  info.CLIPLoader.input.required.clip_name=[['different.safetensors']];assert.equal((await status()).ready,false);
});

test('switching models invalidates readiness; missing Z-Image blocks image jobs and flags setup',async()=>{
  await call('health');
  await call('settings','PATCH',{pipelineSelections:{image:'comfyui:z-image-turbo'}});
  sizes.clear();
  const state=await (await call('health')).json();
  assert.equal(state.pipelineSelections.image,'comfyui:z-image-turbo');assert.equal(state.capabilities.image.ready,false);
  assert.match(generationBlocker(state,'image')!,/Z-Image/);
  assert.ok(missingSetup(state).some(item=>item.target==='image'&&item.name==='Images'));
  assert.equal((await call('jobs','POST',request)).status,409);
  assert.equal(store.listJobs().length,0);
});

test('images use ComfyUI independently and queued jobs and retries keep their model',async()=>{
  await call('settings','PATCH',{pipelineSelections:{image:'comfyui:z-image-turbo'}});
  const response=await call('jobs','POST',{...request,imageModel:'krea-2-turbo'});
  assert.equal(response.status,201,await response.clone().text());
  const {job}:{job:Job}=await response.json();
  assert.equal(job.runner,'comfyui');assert.equal(job.request.pipeline?.metadata.id,'comfyui:z-image-turbo');assert.equal(job.total,4);
  assert.equal((await call('settings','PATCH',{pipelineSelections:{image:null}})).status,200);
  assert.equal(store.getJob(job.id)!.request.pipeline?.metadata.id,'comfyui:z-image-turbo');
  Object.assign(job.request.pipeline!,{prepare:{stages:[{type:'shell',config:{command:'must never run'}}]}});
  store.updateJob(job.id,{request:job.request,status:'failed',message:'Synthetic failure'});
  const retry=await call(`jobs/${job.id}/retry`,'POST',{});
  assert.equal(retry.status,201,await retry.clone().text());
  const next=(await retry.json()).job;assert.equal(next.runner,'comfyui');assert.equal(next.request.pipeline.metadata.id,'comfyui:z-image-turbo');
  assert.ok(!('prepare' in next.request.pipeline));
  assert.ok('prepare' in store.getJob(job.id)!.request.pipeline!,'Original history stays intact.');
  assert.equal(store.settings().runner,'vpipe');
  await call('settings','PATCH',{pipelineSelections:{image:'comfyui:z-image-turbo'}});
  const setup=await call('setup','POST',{pipelineId:'comfyui:z-image-turbo'});
  assert.equal(setup.status,410);
});

test('Z-Image stays blocked on an unprotected remote ComfyUI',async()=>{
  process.env.FROK_COMFYUI_PRIVATE='0';
  try{await withRunnerLocations({comfyUrl:'https://untrusted.example'},async()=>{store.setValue('pipelineSelections',{...store.settings().pipelineSelections,image:'comfyui:z-image-turbo'});const state=await health();assert.equal(state.connections!.comfyui.available,false);assert.equal(state.capabilities!.image.ready,false);assert.equal((await call('jobs','POST',request)).status,409);assert.equal((await call('setup','POST',{pipelineId:'comfyui:z-image-turbo'})).status,410);});}
  finally{process.env.FROK_COMFYUI_PRIVATE='1';}
});

test('Z-Image installation metadata pins dependencies and read-only checks preserve conflicting files',async()=>{
  const pipeline=await resolvePipeline('image','comfyui:z-image-turbo');
  for(const file of zImageFiles){
    const dependency=pipeline.metadata.dependencies.find(item=>item.reference===`${file.directory}/${file.name}`)!;
    assert.equal(dependency.url,zImageUrl(file));assert.match(dependency.url!,new RegExp(zImageRevision));
    assert.equal(dependency.sha256,file.sha256);assert.match(dependency.sha256!,/^[0-9a-f]{64}$/);assert.equal(dependency.size,file.size);
  }
  const conflict=[...sizes.keys()][0];sizes.set(conflict,1);
  fs.mkdirSync(path.dirname(conflict),{recursive:true});fs.writeFileSync(conflict,'x');
  try{
    assert.equal((await pipelineStatus(pipeline)).ready,false);
    assert.equal(fs.readFileSync(conflict,'utf8'),'x');
  }finally{fs.rmSync(conflict);}
});

test('download receipts cannot make missing Z-Image weights appear ready',async()=>{
  store.setValue('pipelineSelections',{...store.settings().pipelineSelections,image:'comfyui:z-image-turbo'});
  store.setValue('prepared:comfy-z-image',true);
  sizes.clear();
  const result=await health();
  assert.equal(result.capabilities!.image.ready,false);
});
