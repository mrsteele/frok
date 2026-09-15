import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { mock } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLibraryFixture } from './fixtures/library';
import { emptyConnections, emptyModelSelections } from '../src/lib/service-config';
import { Setup } from '../src/components/settings/setup';
import { RunnerConnection } from '../src/components/settings/runner-connection';
import { OllamaConnection } from '../src/components/settings/ollama-connection';

const directory=fs.mkdtempSync(path.join(process.cwd(),'.data/service-config-test-'));
Object.assign(process.env,{FROK_DATA_DIR:directory,VPIPE_WORKDIR:path.join(directory,'models-workspace'),VPIPE_BIN:'synthetic-vpipe',FFMPEG_BIN:'synthetic-ffmpeg',FFPROBE_BIN:'synthetic-ffprobe',OLLAMA_URL:'http://127.0.0.1:19701',OLLAMA_MODEL:'synthetic:writer',COMFYUI_URL:'http://127.0.0.1:19702',COMFYUI_DIR:path.join(directory,'comfy'),FROK_COMFYUI_PRIVATE:'1',PORT:'3000'});
for(const type of ['INPUT','OUTPUT','TEMP']){process.env[`COMFYUI_${type}_DIR`]=path.join(directory,type);fs.mkdirSync(process.env[`COMFYUI_${type}_DIR`]!);}
fs.mkdirSync(process.env.VPIPE_WORKDIR!,{recursive:true});
let offline=new Set<string>(), models=['synthetic:writer','synthetic:second','synthetic:embedding'];
let duringProbe:(()=>void)|undefined;
let mappedComfyFolder:string|undefined, mappingMismatch=false, useDefaultEndpoints=false;
const serviceAddresses:string[]=[];
const chats:string[]=[];
// Health probes only. Any attempt to launch a generator fails this test.
mock.method(childProcess,'spawn',(command:string,args:string[])=>{
  const encoders=command==='synthetic-ffmpeg'&&args.join(' ')==='-hide_banner -encoders';
  assert.ok(encoders||['--version','-version'].includes(args[0]));
  assert.match(command,/^synthetic-/);
  const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>true});
  queueMicrotask(()=>{child.stdout.end(encoders?' V....D libx264 H.264\n A..... aac AAC\n':'Synthetic version');child.stderr.end();child.emit('close',offline.has(command)?1:0);});return child;
});
mock.method(childProcess,'execFile',()=>{throw Error('No native model catalogue probes in this test');});
syncBuiltinESMExports();
mock.method(globalThis,'fetch',async(input:string|URL|Request,init:RequestInit={})=>{
  const change=duringProbe;duringProbe=undefined;change?.();
  const url=new URL(String(input));
  serviceAddresses.push(url.origin);
  if(useDefaultEndpoints){if(url.port==='8000')url.port='19702';if(url.port==='11434')url.port='19701';}
  assert.equal(init.redirect,'error');
  if(offline.has(url.port))throw Error('Synthetic offline service');
  if(url.port==='19702'&&url.pathname==='/system_stats')return Response.json({});
  if(url.port==='19702'&&url.pathname==='/view'&&mappedComfyFolder){
    assert.equal(url.searchParams.get('filename'),'mapping.txt');
    if(mappingMismatch)return new Response('mismatch');
    return new Response(fs.readFileSync(path.join(mappedComfyFolder,url.searchParams.get('type')!,url.searchParams.get('subfolder')!,'mapping.txt')));
  }
  if(url.port==='19702'&&url.pathname==='/object_info')return Response.json(Object.fromEntries(['CheckpointLoaderSimple','CLIPTextEncode','EmptyLatentImage','KSampler','VAEDecode','SaveImage','UNETLoader','CLIPLoader','VAELoader','MiniMaxH3ImageToVideo','MiniMaxH3ReferenceToVideo','RandomNoise','BasicGuider','KSamplerSelect','BasicScheduler','SamplerCustomAdvanced','VAEDecodeAudio','CreateVideo','SaveVideo','LoadImage'].map(name=>[name,{}])));
  if(url.port==='19701'){
    if(url.pathname==='/api/tags')return Response.json({models:models.map(name=>({name}))});
    if(url.pathname==='/api/show'){const {model}=JSON.parse(String(init.body));return Response.json({capabilities:models.includes(model)?[model.endsWith('embedding')?'embedding':'completion']:[]});}
    if(url.pathname==='/api/chat'){chats.push(JSON.parse(String(init.body)).model);return Response.json({message:{content:'Soft natural light.'}});}
  }
  throw Error(`Unexpected service request ${url.pathname}`);
});
const fixture=await createLibraryFixture(),{test,beforeEach,after}=fixture;
const store=await import('../src/lib/db');
const setup=await import('../src/lib/setup');
const registry=await import('../src/lib/registry');
const {workerProtocolVersion}=await import('../src/lib/worker-health');

const routes=await import('../src/app/api/[[...segments]]/route');
const {generationBlocker,missingSetup}=await import('../src/lib/readiness');
const {prepareGenerationPrompts}=await import('../src/lib/generation-prompt');
const request={mode:'image',prompt:'A blue paper boat',aspect:'1:1',quality:'preview',duration:6,count:1,enhance:false,referenceIds:[]};
function call(endpoint:string,method:'GET'|'POST'|'PATCH'='GET',body?:unknown){return routes[method](fixture.request(`http://localhost:3000/api/${endpoint}`,{method,...(body?{body:JSON.stringify(body)}:{})}),{params:Promise.resolve({segments:endpoint.split('?')[0].split('/')})});}
const ids={image:(value:string)=>value==='krea-2-turbo'?'vpipe:krea-2-turbo':`comfyui:${value}`,video:(value:string)=>value==='vpipe'?'vpipe:minimax-h3-turbo':'comfyui:minimax-h3',reference:(value:string)=>value==='vpipe'?'vpipe:minimax-h3-reference':'comfyui:minimax-h3-reference'};
// Existing matrix cases now select pipelines; prompt models still use Ollama.
async function patch(body:any,status=200){
  if(body.modelSelections){const models={...body.modelSelections},pipelines={...body.pipelineSelections};for(const key of ['image','video','reference'] as const)if(Object.hasOwn(models,key)){pipelines[key]=models[key]===null?null:ids[key](models[key]);delete models[key];}body={...body,modelSelections:models,pipelineSelections:pipelines};}
const response=await call('settings','PATCH',body);assert.equal(response.status,status,await response.clone().text());return response;}
const {diskCatalog}=await import('../src/lib/pipelines/catalog');
const {dependencies}=await import('../src/lib/pipelines/dependencies');
const {writeReferencePack}=await import('./fixtures/reference-pack');
const header=Buffer.from(JSON.stringify({synthetic:{dtype:'U8',shape:[1],data_offsets:[0,1]}})),length=Buffer.alloc(8);length.writeBigUInt64LE(BigInt(header.length));const tensor=Buffer.concat([length,header,Buffer.from([0])]);
async function installFixtures(){
 for(const pipeline of (await diskCatalog()).entries){if(pipeline.kind==='upscale'||pipeline.metadata.id==='comfyui:z-image-turbo')continue;
  for(const d of dependencies(pipeline)){
   const base=pipeline.metadata.runner==='comfyui'?path.join(directory,'comfy/models'):path.join(process.env.VPIPE_WORKDIR!,'models');
   if(d.layout==='minimax'){const source=await writeReferencePack(process.env.VPIPE_WORKDIR!);if(source!==path.join(base,d.reference))await fs.promises.cp(source,path.join(base,d.reference),{recursive:true});}
   else if(d.kind==='model'){const dir=path.join(base,d.reference);fs.mkdirSync(dir,{recursive:true});for(const component of d.layout==='krea'?['transformer','text_encoder','vae']:['']){fs.mkdirSync(path.join(dir,component),{recursive:true});fs.writeFileSync(path.join(dir,component,'model.safetensors'),tensor);fs.writeFileSync(path.join(dir,component,'config.json'),'{}');}fs.mkdirSync(path.join(dir,'tokenizer'),{recursive:true});fs.writeFileSync(path.join(dir,'tokenizer/tokenizer.json'),'{}');fs.writeFileSync(path.join(dir,'model_index.json'),'{}');fs.writeFileSync(path.join(dir,'frok-prepared.json'),'{}');}
   else{const reference=d.reference==='larryvrh/MiniMax-H3-Turbo-Lora-v4-600-ema'?'larryvrh/MiniMax-H3-Turbo-Lora/minimax_h3_turbo_v4_step600_ema.safetensors':d.reference==='lightx2v/Minimax-h3-Turbo-ref2va-4step-split'?'lightx2v/Minimax-h3-Turbo/minimax_h3_ref2v_turbo_4step_v0.1_bf16.safetensors':d.reference;const file=path.join(base,reference);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,tensor);}
  }
 }
}
beforeEach(async()=>{
  delete process.env.FROK_MANAGE_OLLAMA;
  process.env.FROK_COMFYUI_PRIVATE='1';mappedComfyFolder=undefined;mappingMismatch=false;useDefaultEndpoints=false;serviceAddresses.length=0;
  store.db.exec('DELETE FROM settings; DELETE FROM jobs; DELETE FROM media;');offline.clear();models=['synthetic:writer','synthetic:second','synthetic:embedding'];chats.length=0;duringProbe=undefined;
  registry.setServiceValue('workerPid',0);
  registry.setServiceValue('workerProtocol',{pid:0,version:workerProtocolVersion});
  registry.setServiceValue('workerHeartbeat',Date.now());
  await installFixtures();
});
after(()=>{mock.restoreAll();syncBuiltinESMExports();fixture.close();fs.rmSync(directory,{recursive:true,force:true});});

test('a new browser cannot generate even when every service and shared model is available',async()=>{
  assert.deepEqual(store.settings().connections,emptyConnections);assert.deepEqual(store.settings().modelSelections,emptyModelSelections);
  const state=await setup.health();assert.ok(Object.values(state.connections!).every(service=>service.available));
  assert.ok(Object.values(state.capabilities!).every(capability=>!capability.configured&&!capability.ready));assert.equal(state.ollama,false);
  for(const mode of ['image','video','reference','upscale'] as const)assert.match(generationBlocker(state,mode)!,/Choose an available pipeline/);
  assert.equal((await call('jobs','POST',request)).status,409);assert.equal(store.listJobs().length,0);
  await patch({setupDismissed:true});assert.deepEqual(store.settings().modelSelections,emptyModelSelections);
});

test('models require a configured and reachable connection; invalid combinations never partially save',async()=>{
  await patch({modelSelections:{image:'sdxl-turbo'},setupDismissed:true},400);assert.equal(store.settings().setupDismissed,false);
  await patch({connections:{comfyui:true}});assert.deepEqual(store.settings().modelSelections,emptyModelSelections);
  await patch({modelSelections:{image:'sdxl-turbo'}});assert.equal(store.settings().pipelineSelections.image,'comfyui:sdxl-turbo');
  offline.add('synthetic-vpipe');await patch({connections:{vpipe:true},modelSelections:{video:'vpipe'}},409);
  assert.equal(store.settings().connections.vpipe,false);assert.equal(store.settings().modelSelections.video,null);
  for(const value of [{modelSelections:{image:'z-image-vpipe'}},{connections:{vpipe:'yes'}},{connections:{ollamaUrl:'http://other.example'}}])await patch(value,400);
});

test('ComfyUI images, Vpipe video and Ollama prompts coexist; unrelated offline services do not block images',async()=>{
  await patch({connections:{comfyui:true,vpipe:true,ollama:true}});
  await patch({modelSelections:{image:'sdxl-turbo',video:'vpipe',reference:'comfyui',prompt:'synthetic:writer'}});
  const state=await setup.health();assert.equal(state.capabilities!.image.ready,true);assert.equal(state.capabilities!.video.ready,true);assert.equal(state.capabilities!.reference.ready,true);assert.equal(state.ollama,true);assert.equal(state.capabilities!.upscale.configured,false);
  assert.deepEqual(missingSetup(state),[]);
  const image=await call('jobs','POST',request);assert.equal(image.status,201);assert.equal((await image.json()).job.runner,'comfyui');
  const video=await call('jobs','POST',{...request,mode:'video'});assert.equal(video.status,201);assert.equal((await video.json()).job.runner,'vpipe');
  const referenceId='11111111-1111-4111-8111-111111111111';
  store.saveMedia({id:referenceId,kind:'image',filename:'unused-synthetic.jpg',prompt:'Paper boat',enhancedPrompt:'Paper boat',width:640,height:480,seed:1,favorite:false,createdAt:new Date().toISOString(),origin:'upload'});
  const reference=await call('jobs','POST',{...request,mode:'reference',referenceIds:[referenceId]});assert.equal(reference.status,201);assert.equal((await reference.json()).job.runner,'comfyui');
  const refSetup=await call('setup','POST',{pipelineId:'comfyui:minimax-h3-reference'});assert.equal(refSetup.status,410);assert.ok(store.listJobs().every(job=>job.kind==='generate'));
  offline.add('synthetic-vpipe');offline.add('synthetic-ffmpeg');offline.add('19701');
  const next=await setup.health();assert.equal(generationBlocker(next,'image'),undefined);assert.ok(generationBlocker(next,'video'));assert.equal(next.ollama,false);
  assert.equal((await call('jobs','POST',request)).status,201);assert.equal((await call('jobs','POST',{...request,enhance:true})).status,409);
});

test('only installed completion models can enable enhancement, and clearing the choice disables it',async()=>{
  await patch({connections:{ollama:true}});
  assert.deepEqual((await setup.health()).ollamaModels,['synthetic:second','synthetic:writer']);assert.equal(store.settings().promptModelSetting,'');assert.equal((await setup.health()).ollama,true);
  await patch({modelSelections:{prompt:'synthetic:embedding'}},409);await patch({modelSelections:{prompt:'synthetic:missing'}},409);
  await patch({modelSelections:{prompt:'synthetic:writer'}});assert.equal((await setup.health()).ollama,true);
  models=models.filter(model=>model!=='synthetic:writer');assert.equal((await setup.health()).ollama,false);
  await patch({modelSelections:{prompt:null}});assert.equal((await setup.health()).capabilities!.prompt.configured,false);
});

test('queued jobs and retries retain runners and prompt models while preferences change',async()=>{
  await patch({connections:{vpipe:true,comfyui:true,ollama:true},modelSelections:{image:'sdxl-turbo',video:'vpipe',prompt:'synthetic:writer'}});
  const image=(await (await call('jobs','POST',{...request,enhance:true})).json()).job;
  const video=(await (await call('jobs','POST',{...request,mode:'video',enhance:true})).json()).job;
  await patch({modelSelections:{image:'krea-2-turbo',video:'comfyui',prompt:'synthetic:second'}});
  assert.equal(store.getJob(image.id)!.runner,'comfyui');assert.equal(store.getJob(video.id)!.runner,'vpipe');
  assert.equal(store.getJob(image.id)!.request.ollama?.model,'synthetic:writer');
  await prepareGenerationPrompts(image.request,undefined,new AbortController().signal);assert.deepEqual(chats,['synthetic:writer']);
  store.updateJob(video.id,{status:'failed'});
  const retried=await call(`jobs/${video.id}/retry`,'POST',{});assert.equal(retried.status,201,await retried.clone().text());
  const retry=(await retried.json()).job;assert.equal(retry.runner,'vpipe');assert.equal(retry.request.ollama.model,'synthetic:writer');
  await patch({connections:{vpipe:false}});assert.equal(store.getJob(video.id)!.runner,'vpipe');
  assert.equal((await call(`jobs/${video.id}/retry`,'POST',{})).status,409);
});

test('a connection changed in another tab during validation cannot queue work using stale readiness',async()=>{
  await patch({connections:{comfyui:true},modelSelections:{image:'sdxl-turbo'}});
  duringProbe=()=>store.setValue('connections',emptyConnections);
  const response=await call('jobs','POST',request);assert.equal(response.status,409);assert.match((await response.json()).error,/Settings changed/);assert.equal(store.listJobs().length,0);
});

test('a live protocol-6 worker cannot admit generation, setup, retries or queue starts',async()=>{
  const {workerStatus,workerProtocolVersion}=await import('../src/lib/worker-health');
  await patch({connections:{vpipe:true,ollama:true},modelSelections:{image:'krea-2-turbo'}});
  const keys=['workerPid','workerHeartbeat','workerProtocol'],before=keys.map(key=>registry.serviceValue(key,null));
  try {
    registry.setServiceValue('workerPid',process.pid);registry.setServiceValue('workerHeartbeat',Date.now());
    registry.setServiceValue('workerProtocol',{pid:process.pid,version:6});
    assert.ok(workerProtocolVersion>6);assert.equal(workerStatus().ready,false);assert.equal(workerStatus().outdated,true);
    const stopped=store.createJob({kind:'generate',runner:'vpipe',total:1,request:request as import('../src/lib/types').Generation});store.updateJob(stopped.id,{status:'failed'});
    const queued=store.createJob({kind:'generate',runner:'vpipe',total:1,request:request as import('../src/lib/types').Generation});
    for(const [endpoint,body] of [['jobs',request],[`jobs/${stopped.id}/retry`,{}],[`jobs/${queued.id}/start`,{}]] as const){
      const response=await call(endpoint,'POST',body);assert.equal(response.status,409);assert.match((await response.json()).error,/Restart Frok/);
    }
    assert.equal(store.listJobs().length,2);assert.equal(store.getJob(queued.id)!.status,'queued');
    registry.setServiceValue('workerProtocol',{pid:process.pid,version:workerProtocolVersion});assert.equal(workerStatus().ready,true);
  }finally{keys.forEach((key,index)=>registry.setServiceValue(key,before[index]));}
});

test('external tool changes during admission reject both new jobs and retries with stale readiness',async()=>{
  await patch({connections:{vpipe:true},modelSelections:{video:'vpipe'}});
  const input={...request,mode:'video'};
  const change=()=>store.setValue('runtimeOptions',{mediaToolsDirectory:path.join(directory,'replacement-tools')});
  duringProbe=change;
  const rejected=await call('jobs','POST',input);
  assert.equal(rejected.status,409);assert.match((await rejected.json()).error,/Settings changed/);assert.equal(store.listJobs().length,0);
  store.setValue('runtimeOptions',{});
  const accepted=await call('jobs','POST',input);assert.equal(accepted.status,201);
  const job=(await accepted.json()).job;store.updateJob(job.id,{status:'failed'});
  duringProbe=change;
  const retry=await call(`jobs/${job.id}/retry`,'POST',{});
  assert.equal(retry.status,409);assert.match((await retry.json()).error,/Settings changed/);assert.equal(store.listJobs().length,1);
});

test('saved legacy browser preferences migrate without changing independent image and video choices',()=>{
  store.setValue('runner','vpipe');store.setValue('imageModel','z-image-turbo');store.setValue('ollamaModel','synthetic:writer');store.setValue('setupDismissed',true);
  const settings=store.settings();assert.deepEqual(settings.connections,{vpipe:true,comfyui:true,ollama:true});assert.equal(settings.modelSelections.image,'z-image-turbo');assert.equal(settings.modelSelections.video,'vpipe');assert.equal(settings.modelSelections.reference,'vpipe');
});

test('Services and Generation keep optional capabilities separate from advanced maintenance',async()=>{
  let state=await setup.health();
  const props={health:state,onRefresh:()=>{}};
  const services=renderToStaticMarkup(createElement(Setup,{...props,section:'services'}));
  for(const name of ['Vpipe','ComfyUI','Ollama'])assert.ok(services.includes(name));
  assert.doesNotMatch(services,/Delete all my stuff|API tokens|Video tools folder|Workflow folder/);
  let html=renderToStaticMarkup(createElement(Setup,{...props,section:'generation'}));
  for(const id of ['comfyui:sdxl-turbo','vpipe:krea-2-turbo','comfyui:z-image-turbo'])assert.match(html,new RegExp(`<option value="${id}" disabled=""`));
  await patch({connections:{comfyui:true,ollama:true}});state=await setup.health();
  html=renderToStaticMarkup(createElement(Setup,{...props,health:state,section:'generation'}));
  assert.match(html,/<option value="comfyui:sdxl-turbo"/);assert.match(html,/<option value="comfyui:z-image-turbo"/);
  assert.doesNotMatch(html,/Ollama model|Pipeline details|Revision |Workflow folder|API tokens/);
  assert.match(html,/<option value="vpipe:krea-2-turbo" disabled=""/);
  assert.doesNotMatch(html,/<option value="comfyui:sdxl-turbo" disabled=""|<option value="synthetic:embedding"/);
  const ollama=renderToStaticMarkup(createElement(OllamaConnection,{...props,health:state,checking:false}));
  assert.match(ollama,/<option value="synthetic:writer"/);
  const advanced=renderToStaticMarkup(createElement(Setup,{...props,health:state,section:'advanced'}));
  assert.match(advanced,/Workflow folder/);assert.match(advanced,/API tokens/);assert.match(advanced,/Delete all my stuff/);
});





test('connecting Ollama cannot install a runtime or silently download a missing model',async()=>{
  models=[];await patch({connections:{ollama:true}});
  assert.equal((await call('setup/connection','POST',{connection:'ollama'})).status,410);
  for(const task of ['runtime','ollama-runtime'])assert.equal((await call('setup','POST',{task})).status,410);
  assert.equal(store.listJobs().length,0);
});





test('saved runner folders override defaults and immediately refresh pipeline readiness',async()=>{
  await patch({connections:{vpipe:true},pipelineSelections:{image:'vpipe:krea-2-turbo'}});
  assert.equal((await (await call('health')).json()).capabilities.image.ready,true);
  const folder=path.join(directory,'new-empty-vpipe');
  await patch({vpipeWorkdir:folder});
  assert.equal(store.settings().vpipeWorkdir,folder);
  const {vpipeModelsDirectory}=await import('../src/lib/model-access');
  assert.equal(vpipeModelsDirectory(),path.join(folder,'models'));
  const checked=await (await call('health')).json();
  assert.equal(checked.workdir,folder);assert.equal(checked.capabilities.image.ready,false);
  assert.equal(fs.existsSync(folder),false,'connection checks must not create or download a workspace');
  await patch({vpipeWorkdir:process.env.VPIPE_WORKDIR});
  assert.equal((await (await call('health')).json()).capabilities.image.ready,true);
});

test('invalid paths and failed runner checks preserve all saved settings',async()=>{
  const original=store.settings();
  for(const value of ['relative/path','/bad\u0000path'])await patch({vpipeWorkdir:value},400);
  for(const value of ['https://example.org','http://127.0.0.1:8000/path','file:///tmp/comfy','http://user:password@localhost:8000'])await patch({comfyUrl:value},400);
  const file=path.join(directory,'workspace-file');fs.writeFileSync(file,'synthetic');
  await patch({vpipeWorkdir:file},400);
  offline.add('synthetic-vpipe');
  await patch({vpipeWorkdir:path.join(directory,'failed-vpipe'),connections:{vpipe:true}},409);
  assert.deepEqual(store.settings(),original);
});

test('candidate runner settings do not leak into concurrent work',async()=>{
  const {withRunnerLocations}=await import('../src/lib/runner-locations');
  const original=store.settings().vpipeWorkdir,folder=path.join(directory,'candidate');
  let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});
  const check=withRunnerLocations({vpipeWorkdir:folder},async()=>{assert.equal(store.settings().vpipeWorkdir,folder);await wait;assert.equal(store.settings().vpipeWorkdir,folder);});
  assert.equal(store.settings().vpipeWorkdir,original);release();await check;
  assert.equal(store.settings().vpipeWorkdir,original);
});

test('queued work protects its workspace, including work queued during a check',async()=>{
  const original=store.settings().vpipeWorkdir;
  const queue=()=>store.createJob({kind:'setup',runner:'vpipe',total:1,request:{task:'runtime'}});
  const job=queue();
  await patch({vpipeWorkdir:path.join(directory,'blocked')},409);
  await patch({vpipeWorkdir:original});
  store.updateJob(job.id,{status:'completed'});
  duringProbe=()=>{queue();};
  await patch({vpipeWorkdir:path.join(directory,'raced')},409);
  assert.equal(store.settings().vpipeWorkdir,original);
});

test('local ComfyUI uses the saved base folder without environment flags or directory mappings',async()=>{
  delete process.env.FROK_COMFYUI_PRIVATE;
  const folder=path.join(directory,'desktop-comfy');
  for(const area of ['input','output','models'])fs.mkdirSync(path.join(folder,area),{recursive:true});
  mappedComfyFolder=folder;
  await patch({comfyDir:folder,comfyUrl:'http://127.0.0.1:19702/',connections:{comfyui:true}});
  assert.equal(store.settings().comfyDir,folder);assert.equal(store.settings().comfyUrl,'http://127.0.0.1:19702');
  assert.equal(store.comfyDirectory('input'),path.join(folder,'input'));
  assert.equal(store.comfyDirectory('output'),path.join(folder,'output'));
  assert.equal((await setup.health()).connections!.comfyui.available,true);
  for(const area of ['input','output'])assert.deepEqual(fs.readdirSync(path.join(folder,area,'frok/connection-check')),[]);
});

test('device defaults expand the current home and preserve existing locations until explicitly changed',async()=>{
  const {defaultRunnerLocations,resolveRunnerLocations}=await import('../src/lib/runner-locations');
  const {homedir}=await import('node:os');
  const defaults=defaultRunnerLocations();
  assert.equal(defaults.vpipeWorkdir,path.join(homedir(),'vpipe'));
  assert.ok(path.isAbsolute(defaults.comfyDir));assert.equal(path.basename(defaults.comfyDir),'ComfyUI');
  const previous=store.getValue('environmentDefaults',{});store.setValue('environmentDefaults',{});
  try {
    assert.equal(resolveRunnerLocations({}).vpipeWorkdir,defaults.vpipeWorkdir);
    assert.equal(resolveRunnerLocations({},'/synthetic/legacy').vpipeWorkdir,'/synthetic/legacy');
    assert.equal(resolveRunnerLocations({vpipeWorkdir:'/synthetic/saved'},'/synthetic/legacy').vpipeWorkdir,'/synthetic/saved');
  }finally{store.setValue('environmentDefaults',previous);}
});

test('a ComfyUI folder that does not match the connected service is not saved',async()=>{
  const original=store.settings(),folder=path.join(directory,'mismatched-comfy');
  for(const area of ['input','output','models'])fs.mkdirSync(path.join(folder,area),{recursive:true});
  mappedComfyFolder=folder;mappingMismatch=true;
  const response=await patch({comfyDir:folder,comfyUrl:'http://127.0.0.1:19702',connections:{comfyui:true}},400);
  assert.match((await response.json()).error,/does not match/);
  assert.deepEqual(store.settings(),original);
});

test('Settings shows direct editable connection and pipeline fields without redundant utilities',async()=>{
  await patch({connections:{vpipe:true},pipelineSelections:{image:'vpipe:krea-2-turbo'}});
  const props={health:await setup.health(),onRefresh:()=>{}};
  const generate=renderToStaticMarkup(createElement(Setup,{...props,section:'services'}));
  assert.match(generate,/Model workspace/);assert.match(generate,/Use default location/);assert.doesNotMatch(generate,/ComfyUI folder/);
  assert.doesNotMatch(generate,/<details|Shared utilities|Settings for this studio|readOnly|VPIPE_WORKDIR|COMFYUI_DIR/);
  const pipelines=renderToStaticMarkup(createElement(Setup,{...props,section:'generation'}));
  assert.match(pipelines,/Images workflow/);assert.doesNotMatch(pipelines,/Pipeline details/);assert.doesNotMatch(pipelines,/<details/);
});

test('blank connection fields persist as blanks and use the displayed device defaults',async()=>{
  const home=path.join(directory,'default-home'),previousDocuments=process.env.FROK_DOCUMENTS_DIR;
  const homeMock=mock.method(os,'homedir',()=>home);syncBuiltinESMExports();
  process.env.FROK_DOCUMENTS_DIR=path.join(home,'Documents');useDefaultEndpoints=true;
  try {
    const {defaultRunnerLocations}=await import('../src/lib/runner-locations');
    const defaults=defaultRunnerLocations();mappedComfyFolder=defaults.comfyDir;
    fs.mkdirSync(defaults.vpipeWorkdir,{recursive:true});
    for(const area of ['models','input','output'])fs.mkdirSync(path.join(defaults.comfyDir,area),{recursive:true});
    await patch({vpipeWorkdir:'  ',comfyDir:'',comfyUrl:' ',ollamaUrl:'',connections:{vpipe:true,comfyui:true,ollama:true}});
    assert.deepEqual(store.getValue('runnerLocations',{}),{vpipeWorkdir:'',comfyDir:'',comfyUrl:''});
    assert.equal(store.getValue('ollamaUrl','missing'),'');
    const state=await setup.health();
    assert.deepEqual(state.connectionFields!.values,{vpipeWorkdir:'',comfyDir:'',comfyUrl:'',ollamaUrl:''});
    assert.equal(state.workdir,defaults.vpipeWorkdir);assert.equal(state.comfyDir,defaults.comfyDir);
    assert.equal(state.comfyUrl,'http://127.0.0.1:8000');assert.equal(state.ollamaUrl,'http://127.0.0.1:11434');
    assert.ok(serviceAddresses.includes(state.ollamaUrl!));assert.ok(serviceAddresses.includes(state.comfyUrl!));
    const props={health:state,onRefresh:()=>{},checking:false};
    const html=renderToStaticMarkup(createElement(RunnerConnection,{...props,id:'vpipe'}))+renderToStaticMarkup(createElement(RunnerConnection,{...props,id:'comfyui'}))+renderToStaticMarkup(createElement(OllamaConnection,props));
    for(const placeholder of ['~/vpipe',state.connectionFields!.defaults.comfyDir,'http://127.0.0.1:8000','http://127.0.0.1:11434']) {
      const input=html.match(new RegExp(`<input[^>]*placeholder="${placeholder.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}"[^>]*>`))?.[0];
      assert.ok(input,placeholder);assert.match(input,/value=""/);assert.doesNotMatch(input,/required/);
    }
    assert.match(html,/<option value="" selected="">Default · synthetic:writer/);
    // Rechecking the same default must remain possible while work is queued.
    store.createJob({kind:'setup',runner:'vpipe',total:1,request:{task:'runtime'}});
    await patch({vpipeWorkdir:''});
    await patch({vpipeWorkdir:path.join(directory,'blocked-change')},409);
  }finally{
    homeMock.mock.restore();syncBuiltinESMExports();
    if(previousDocuments===undefined)delete process.env.FROK_DOCUMENTS_DIR;else process.env.FROK_DOCUMENTS_DIR=previousDocuments;
  }
});

test('default prompt selection stays empty, verifies the exact installed model, and remains distinct from Off',async()=>{
  assert.equal(store.settings().promptModelSetting,'');assert.equal((await setup.health()).ollama,false);
  await patch({connections:{ollama:true}});
  assert.equal(store.settings().promptModelSetting,'');assert.equal((await setup.health()).ollama,true);
  await patch({modelSelections:{prompt:'synthetic:second'}});
  assert.equal(store.settings().promptModelSetting,'synthetic:second');
  await patch({modelSelections:{prompt:''}});
  assert.equal(store.settings().promptModelSetting,'');assert.equal(store.settings().ollamaModel,'synthetic:writer');
  models=['synthetic:second'];
  assert.equal((await setup.health()).ollama,false,'Another installed model must not stand in for the missing default.');
  assert.equal((await setup.health()).capabilities!.prompt.configured,true);
  models.push('synthetic:writer');assert.equal((await setup.health()).ollama,true);
  await patch({modelSelections:{prompt:null}});await patch({connections:{ollama:true}});
  assert.equal(store.settings().promptModelSetting,null);assert.equal((await setup.health()).ollama,false);
});

test('retired installation endpoints and old job actions cannot create work',async()=>{
 const before=store.settings();
 for(const [endpoint,body] of [['setup',{task:'ollama'}],['setup',{pipelineId:'vpipe:krea-2-turbo'}],['setup/connection',{connection:'vpipe'}]] as const){
   const response=await call(endpoint,'POST',body);assert.equal(response.status,410);assert.match((await response.json()).error,/built-in Vpipe starter/);
 }
 assert.deepEqual(store.settings(),before);assert.equal(store.listJobs().length,0);
 const old=store.createJob({kind:'setup',request:{task:'pipeline'},runner:'vpipe',total:1});
 for(const action of ['start','next','move','retry'])assert.equal((await call(`jobs/${old.id}/${action}`,'POST',{})).status,410);
 assert.equal(store.listJobs().length,1);
 assert.equal((await call(`jobs/${old.id}/cancel`,'POST',{})).status,200);
 assert.equal((await call(`jobs/${old.id}/retry`,'POST',{})).status,410);
});
