import fs from 'node:fs/promises';import path from 'node:path';import assert from 'node:assert/strict';import { test,after } from 'node:test';
const directory=await fs.mkdtemp(path.join(process.cwd(),'.data/pipeline-catalog-test-'));
process.env.FROK_DATA_DIR=directory;process.env.VPIPE_WORKDIR=path.join(directory,'workspace');process.env.COMFYUI_DIR=path.join(directory,'comfy');process.env.VPIPE_LIVE_PREVIEWS='0';
const {createLibraryFixture}=await import('./fixtures/library');const fixture=await createLibraryFixture();
const {diskCatalog,catalog,resolvePipeline,validatePipeline,pipelineStatus,pipelineHealth}=await import('../src/lib/pipelines/catalog');
const {bindPipeline}=await import('../src/lib/pipelines/bindings');
const {generationSchema}=await import('../src/lib/validation');
const {dependencyReady}=await import('../src/lib/pipelines/dependencies');
const db=await import('../src/lib/db');
const registry=await import('../src/lib/registry');
after(async()=>{fixture.close();await fs.rm(directory,{recursive:true,force:true});});
const input={request:{mode:'video' as const,prompt:'A tiny boat',aspect:'1:1',duration:6,quality:'preview' as const,count:1,enhance:false,referenceIds:[]},prompt:'A tiny boat',seed:99,width:512,height:512,output:'/private/job/output.mp4',directory:'/private/job',source:'/private/job/image.jpg',references:[]};
fixture.test('health includes disconnected workflows without probing their services or advertising readiness',async t=>{
 const fetch=t.mock.method(globalThis,'fetch',()=>{throw Error('Disconnected workflows must not probe a service.');});
 const before=db.settings().pipelineSelections;
 try{
  const entries=(await diskCatalog()).entries;
  db.setValue('pipelineSelections',{image:'vpipe:krea-2-turbo',video:null,reference:null,upscale:'comfyui:seedvr2'});
  const connections={vpipe:{enabled:false,available:true,detail:''},comfyui:{enabled:true,available:false,detail:''},ollama:{enabled:false,available:false,detail:''}};
  const state=await pipelineHealth({connections,capabilities:{},checks:[{id:'ffmpeg',ready:true}]} as import('../src/lib/types').Health);
  assert.deepEqual(state.pipelines!.map(p=>p.id).sort(),entries.map(p=>p.metadata.id).sort());
  assert.ok(state.pipelines!.every(p=>!p.ready&&!p.canPrepare));
  assert.equal(state.capabilities!.image.connection,'vpipe');assert.equal(state.capabilities!.image.configured,true);assert.equal(state.capabilities!.image.ready,false);
  assert.match(state.capabilities!.upscale.detail,/Connect ComfyUI to use/);assert.equal(state.upscalerReady,false);
  assert.equal(fetch.mock.callCount(),0);
 }finally{db.setValue('pipelineSelections',before);}
});
test('bundled native workflows register with colocated companions and no forward declarations',async()=>{
 const result=await diskCatalog();assert.deepEqual(result.errors,[]);assert.equal(result.entries.length,9);
 for(const pipeline of result.entries)validatePipeline(pipeline);
 const krea=result.entries.find(p=>p.metadata.id==='vpipe:krea-2-turbo')!;assert.ok(krea.prepare);assert.equal((krea.graph.stages as any[]).find(s=>s.type==='krea2-model-config').config.lora,undefined);
});
test('binding changes request inputs while preserving admin sampling, SOL and LoRA strengths',async()=>{
 const p=(await diskCatalog()).entries.find(p=>p.metadata.id==='vpipe:minimax-h3-turbo')!;const original=structuredClone(p);const graph=bindPipeline(p,input) as any;
 const model=graph.stages.find((s:any)=>s.id==='minimax-h3-model-config'),gen=graph.stages.find((s:any)=>s.id==='generate-video');assert.equal(model.config.lora_scale,1);assert.equal(gen.config.steps,6);assert.equal(gen.config.seed,99);assert.equal(gen.config.sol_attn,true);assert.equal(graph.stages.at(-1).config.output_url,input.output);
 const seen=new Set();for(const stage of graph.stages){for(const port of stage.iports||[])if(port.src)assert.ok(seen.has(port.src),port.src);seen.add(stage.id);}assert.deepEqual(p,original);
});
test('ComfyUI binding uses private namespace and uploaded first frame',async()=>{
 const p=(await diskCatalog()).entries.find(p=>p.metadata.id==='comfyui:minimax-h3')!;const graph=bindPipeline(p,input,'frok/browser/job/render','frok/browser/job/source.png') as any;
 assert.equal(graph['14'].inputs.filename_prefix,'frok/browser/job/render');assert.deepEqual(graph['5'].inputs.first_frame,['frok-input-image',0]);assert.equal(graph['frok-input-image'].inputs.image,'frok/browser/job/source.png');
});
fixture.test('old model selections cannot create invisible imported workflows',async()=>{
 db.setValue('connections',{vpipe:true,comfyui:false,ollama:false});db.setValue('modelSelections',{image:'krea-2-turbo',video:'vpipe',reference:null,prompt:null,upscale:null});db.setValue('videoAdapters',{primary:'',primaryWeight:0,secondary:'',secondaryWeight:0});
 const list=await catalog();assert.ok(list.entries.every(p=>!p.metadata.id.startsWith('imported:')));assert.equal(db.settings().pipelineSelections.video,null);await assert.rejects(resolvePipeline('video'),/Choose an available pipeline/);
});
test('public requests cannot submit executable workflow snapshots',()=>{const parsed=generationSchema.parse({...input.request,pipelineId:'vpipe:minimax-h3-turbo',pipeline:{graph:{evil:true}}});assert.ok(!('pipeline' in parsed));assert.throws(()=>generationSchema.parse({...input.request,pipelineId:'../../another-user'}));});
test('unbound outputs and uploaded file-loader nodes are rejected',async()=>{const p=structuredClone((await diskCatalog()).entries.find(p=>p.metadata.id==='comfyui:minimax-h3')!);p.metadata.bindings.output=[];assert.throws(()=>validatePipeline(p),/output/);p.graph['90']={class_type:'LoadImage',inputs:{image:'other-user.png'}};assert.throws(()=>validatePipeline(p),/private uploaded/);});
fixture.test('a missing file is never ready based on a setup receipt',async()=>{
 const p=(await diskCatalog()).entries.find(p=>p.metadata.id==='vpipe:krea-2-turbo')!;assert.equal((await pipelineStatus(p)).ready,false);db.setValue('prepared:image',true);assert.equal((await pipelineStatus(p)).ready,false);
 const dep={kind:'model' as const,reference:'custom/model',files:['encoder.safetensors'],generated:false};await fs.mkdir(path.join(process.env.VPIPE_WORKDIR!,'models/custom/model'),{recursive:true});await fs.writeFile(path.join(process.env.VPIPE_WORKDIR!,'models/custom/model/encoder.safetensors'),'incomplete');assert.equal(await dependencyReady(p,dep),false);
});
fixture.test('already installed native MiniMax packs are reused without renamed paths or preparation',async()=>{
 const {writeReferencePack}=await import('./fixtures/reference-pack');
 const workspace=process.env.VPIPE_WORKDIR!,reference=await writeReferencePack(workspace);
 await fs.cp(reference,path.join(workspace,'models/local/MiniMax-H3-FL2VA-8bit'),{recursive:true});
 const tensor=await fs.readFile(path.join(reference,'vae/minimax_h3_video_vae_fp16.safetensors'));
 for(const relative of ['larryvrh/MiniMax-H3-Turbo-Lora/minimax_h3_turbo_v4_step600_ema.safetensors','lightx2v/Minimax-h3-Turbo/minimax_h3_ref2v_turbo_4step_v0.1_bf16.safetensors']){const file=path.join(workspace,'models',relative);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,tensor);}
 const {preparePipeline}=await import('../src/lib/pipelines/prepare');
 for(const p of (await diskCatalog()).entries.filter(p=>p.metadata.runner==='vpipe'&&p.kind!=='image')){
   assert.match(p.metadata.dependencies[0].reference,/8bit$/);
   assert.equal((p.graph.stages as any[]).find(s=>s.type==='model-select').config.hf_dir,p.metadata.dependencies[0].reference);
   assert.equal((await pipelineStatus(p)).ready,true);
   const logs:string[]=[];await preparePipeline(p,path.join(fixture.jobsDir,'must-not-be-used'),new AbortController().signal,line=>logs.push(line));
   assert.match(logs.join(''),/already installed and verified/);
 }
});
fixture.test('an installed Krea base is ready without any fused model variant',async()=>{
 const p=(await diskCatalog()).entries.find(p=>p.metadata.id==='vpipe:krea-2-turbo')!;
 const base=path.join(process.env.VPIPE_WORKDIR!,'models/krea/Krea-2-Turbo');
 const header=Buffer.from(JSON.stringify({a:{dtype:'U8',shape:[1],data_offsets:[0,1]}})),size=Buffer.alloc(8);size.writeBigUInt64LE(BigInt(header.length));
 for(const component of ['transformer','text_encoder','vae']){await fs.mkdir(path.join(base,component),{recursive:true});await fs.writeFile(path.join(base,component,'model.safetensors'),Buffer.concat([size,header,Buffer.alloc(1)]));}
 await fs.mkdir(path.join(base,'tokenizer'),{recursive:true});await fs.writeFile(path.join(base,'tokenizer/tokenizer.json'),'{}');await fs.writeFile(path.join(base,'model_index.json'),'{}');
 const status=await pipelineStatus(p);assert.equal(status.ready,true);assert.deepEqual(status.missing,[]);assert.equal(p.metadata.dependencies.length,1);
});
fixture.test('resolving a pipeline copies its definition without changing administrator settings',async()=>{
 db.setValue('pipelineSelections',{image:null,video:'vpipe:minimax-h3-turbo',reference:null,upscale:null});
 const current=await resolvePipeline('video');(current.graph.stages as any[]).find(s=>s.type==='generate-video').config.steps=20;
 assert.equal(((await resolvePipeline('video')).graph.stages as any[]).find(s=>s.type==='generate-video').config.steps,6);
});
fixture.test('an old worker gets a restart notice before a setup job can be queued',async()=>{
 const {workerStatus,workerProtocolVersion}=await import('../src/lib/worker-health'),{queueSetup}=await import('../src/lib/connection-setup');
 const keys=['workerProtocol','workerPid','workerHeartbeat'],before=keys.map(key=>registry.serviceValue(key,null));
 try{
   registry.setServiceValue('workerPid',123);registry.setServiceValue('workerHeartbeat',Date.now());registry.setServiceValue('workerProtocol',null);
   assert.equal(workerStatus().ready,false);assert.equal(workerStatus().outdated,true);
   const count=db.listJobs().length;assert.throws(()=>queueSetup({task:'pipeline',pipeline:undefined}),/Restart Frok/);assert.equal(db.listJobs().length,count);
   registry.setServiceValue('workerProtocol',{pid:122,version:workerProtocolVersion});assert.equal(workerStatus().outdated,true);
   registry.setServiceValue('workerProtocol',{pid:123,version:workerProtocolVersion});assert.equal(workerStatus().ready,true);
 }finally{keys.forEach((key,i)=>registry.setServiceValue(key,before[i]));}
});
