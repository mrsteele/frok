import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import childProcess from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { syncBuiltinESMExports } from 'node:module';
import { mock } from 'node:test';
import { createLibraryFixture } from './fixtures/library';
import { writeReferenceTurbo } from './fixtures/lora.mjs';
import { turboAdapters } from '../src/lib/adapters';
import { writeReferencePack } from './fixtures/reference-pack';

const directory=await fs.mkdtemp(path.join(process.cwd(),'.data/reference-readiness-test-'));
const workspace=path.join(directory,'workspace');
Object.assign(process.env,{FROK_DATA_DIR:directory,VPIPE_WORKDIR:workspace,VPIPE_REFERENCE_MODEL:'local/MiniMax-H3-Ref2VA-8bit',VPIPE_BIN:'synthetic-vpipe',FFMPEG_BIN:'synthetic-ffmpeg',FFPROBE_BIN:'synthetic-ffprobe',OLLAMA_BIN:'synthetic-ollama',OLLAMA_URL:'http://127.0.0.1:19751',FROK_COMFYUI_PRIVATE:'0'});
let prepares=0,turboPrepares=0,publish=false;
mock.method(childProcess,'spawn',(command:string,args:string[])=>{
  assert.match(command,/^synthetic-/);
  const encoders=command==='synthetic-ffmpeg'&&args.join(' ')==='-hide_banner -encoders';
  assert.ok(encoders||['--version','-version','--launch'].includes(args[0]));
  const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>true});
  queueMicrotask(()=>void(async()=>{
    if(args[0]==='--launch'){
      const graph=JSON.parse(await fs.readFile(args[1],'utf8'));
      if(graph.stages.some((s:{type:string})=>s.type==='model-quantize')){prepares++;if(publish)await writeReferencePack(workspace);}
      else{turboPrepares++;await writeReferenceTurbo(workspace);}
    }
    child.stdout.end(encoders?' V....D libx264 H.264\n A..... aac AAC\n':'Synthetic successful process exit');child.stderr.end();child.emit('close',0);
  })().catch(error=>child.emit('error',error)));
  return child;
});
mock.method(childProcess,'execFile',()=>{throw Error('No model catalogue launch in this test');});
syncBuiltinESMExports();
mock.method(globalThis,'fetch',async()=>Response.json({models:[]}));
mock.method(fs,'statfs',async()=>({bavail:300*1024**3,bsize:1}));
const fixture=await createLibraryFixture(),{test,beforeEach,after}=fixture;
const store=await import('../src/lib/db');
const registry=await import('../src/lib/registry');
const setup=await import('../src/lib/setup');
const {referenceModelStatus}=await import('../src/lib/reference-model-status');
const {generationBlocker}=await import('../src/lib/readiness');
const {buildPipeline,factoryPipeline}=await import('./fixtures/pipeline');
const {renderVpipe}=await import('../src/lib/vpipe');
const {preparePipeline}=await import('../src/lib/pipelines/prepare');
const pipeline=factoryPipeline('reference');
const routes=await import('../src/app/api/[[...segments]]/route');
const model=path.join(workspace,'models/local/MiniMax-H3-Ref2VA-8bit');
const referenceId='11111111-1111-4111-8111-111111111111';
const request={mode:'reference' as const,prompt:'A blue paper boat',aspect:'1:1' as const,quality:'preview' as const,duration:6 as const,count:1,enhance:false,referenceIds:[referenceId]};
const call=(endpoint:string)=>routes.POST(fixture.request(`http://localhost:3000/api/${endpoint}`,{method:'POST',body:JSON.stringify(request)}),{params:Promise.resolve({segments:endpoint.split('/')})});
beforeEach(async()=>{
  prepares=0;turboPrepares=0;publish=false;
  await fs.rm(workspace,{recursive:true,force:true});await fs.mkdir(workspace,{recursive:true});await writeReferenceTurbo(workspace);
  store.db.exec('DELETE FROM jobs; DELETE FROM settings; DELETE FROM media;');
  store.setValue('connections',{vpipe:true,comfyui:false,ollama:false});
  store.setValue('modelSelections',{image:'krea-2-turbo',video:'vpipe',reference:'vpipe',prompt:null,upscale:null});
  registry.setServiceValue('workerHeartbeat',Date.now());
  store.setValue('pipelineSelections',{image:null,video:null,reference:pipeline.metadata.id,upscale:null});
  store.saveMedia({id:referenceId,kind:'image',filename:'unused-synthetic.jpg',prompt:request.prompt,enhancedPrompt:request.prompt,width:32,height:32,seed:1,favorite:false,createdAt:new Date().toISOString(),origin:'upload'});
});
after(async()=>{mock.restoreAll();syncBuiltinESMExports();fixture.close();await fs.rm(directory,{recursive:true,force:true});});

test('stale receipt and intermediate-only output cannot report Ready or enqueue reference jobs',async()=>{
  await fs.mkdir(`${model}-dit/diffusion_models`,{recursive:true});
  const state=await setup.health();
  assert.equal(state.capabilities!.reference.ready,false);assert.equal(state.capabilities!.reference.ready,false);
  assert.match(state.capabilities!.reference.detail,/needs preparation/);
  assert.ok(generationBlocker(state,'image'));assert.ok(generationBlocker(state,'video')); // Empty synthetic packs no longer pass on receipts alone.
  assert.equal((await call('jobs')).status,409);assert.equal(store.listJobs().length,0);
  const failed=store.createJob({kind:'generate',request,runner:'vpipe',total:1});store.updateJob(failed.id,{status:'failed'});
  assert.equal((await call(`jobs/${failed.id}/retry`)).status,409);
});

test('complete model is ready; missing, truncated and misindexed components are not',async()=>{
  await writeReferencePack(workspace);
  assert.equal((await referenceModelStatus()).ready,true);
  assert.equal((await setup.health()).capabilities!.reference.ready,true);
  assert.equal((await call('jobs')).status,201);
  for(const name of ['diffusion_models/model-00001-of-00001.safetensors','text_encoders/model-00001-of-00001.safetensors','vae/minimax_h3_video_vae_fp16.safetensors','vae/minimax_h3_audio_vae_fp32.safetensors','tokenizer/tokenizer.json','tokenizer/tokenizer_config.json']){
    await fs.unlink(path.join(model,name));assert.equal((await referenceModelStatus()).ready,false,name);
    await writeReferencePack(workspace);
  }
  await fs.truncate(path.join(model,'diffusion_models/model-00001-of-00001.safetensors'),20);
  assert.equal((await referenceModelStatus()).ready,false);
  await writeReferencePack(workspace);
  await fs.unlink(path.join(model,'diffusion_models/model.safetensors.index.json'));
  assert.equal((await referenceModelStatus()).ready,false);
  await writeReferencePack(workspace);
  await fs.writeFile(path.join(model,'diffusion_models/model.safetensors.index.json'),JSON.stringify({weight_map:{absent:'model-00001-of-00001.safetensors'}}));
  assert.equal((await referenceModelStatus()).ready,false);
});

test('model readiness preserves trusted-path and symlink protections',async()=>{
  await writeReferencePack(workspace);
  const outside=path.join(directory,'outside.safetensors');await fs.writeFile(outside,'synthetic');
  await fs.symlink(outside,path.join(model,'escaped.safetensors'));
  assert.equal((await referenceModelStatus()).ready,false);
  assert.equal((await referenceModelStatus('../outside')).ready,false);
  await fs.unlink(path.join(model,'escaped.safetensors'));
  await fs.writeFile(path.join(model,'diffusion_models/model.safetensors.index.json'),JSON.stringify({weight_map:{synthetic:'../../../outside.safetensors'}}));
  assert.equal((await referenceModelStatus()).ready,false);
});

test('successful process exit without a final pack clears stale readiness and fails preparation',async()=>{
  await assert.rejects(preparePipeline(pipeline,fixture.jobsDir,new AbortController().signal,()=>{}),/Preparation did not make this pipeline ready/);
  assert.equal(prepares,1);assert.equal((await setup.health()).capabilities!.reference.ready,false);
});

test('preparation verifies final output, and verifying an installed model skips quantization',async()=>{
  publish=true;await preparePipeline(pipeline,fixture.jobsDir,new AbortController().signal,()=>{});
  assert.equal(prepares,1);assert.equal((await setup.health()).capabilities!.reference.ready,true);
  await preparePipeline(pipeline,fixture.jobsDir,new AbortController().signal,()=>{});
  assert.equal(prepares,1);
});

test('queued references fail with actionable setup guidance before launching a renderer',async()=>{
  const jobDirectory=path.join(fixture.jobsDir,'synthetic-job','0');await fs.mkdir(jobDirectory,{recursive:true});
  await assert.rejects(renderVpipe({request,prompt:request.prompt,seed:1,width:32,height:32,output:path.join(jobDirectory,'out.mp4'),directory:jobDirectory,references:[],signal:new AbortController().signal,log:()=>{}}),/no pipeline/);
  assert.equal(prepares,0);
  const graph=await buildPipeline({request,prompt:request.prompt,seed:1,width:32,height:32,output:'unused.mp4',directory:jobDirectory,references:['synthetic-reference.png']});
  assert.equal(graph.stages.find(s=>s.id==='model-select')!.config.hf_dir,'local/MiniMax-H3-Ref2VA-8bit');
  assert.equal(graph.stages.find(s=>s.id==='minimax-h3-model-config')!.config.lora,turboAdapters.reference.alias);
});

test('existing reference pack with missing Turbo is blocked and prepares only the adapter',async()=>{
  await writeReferencePack(workspace);
  await fs.unlink(path.join(workspace,'models',turboAdapters.reference.file));
  const state=await setup.health();
  assert.equal(state.capabilities!.reference.ready,false);assert.match(state.capabilities!.reference.detail,/needs preparation/);
  assert.equal((await call('jobs')).status,409);
  await preparePipeline(pipeline,fixture.jobsDir,new AbortController().signal,()=>{});
  assert.equal(prepares,0);assert.equal(turboPrepares,1);assert.equal((await setup.health()).capabilities!.reference.ready,true);
});

test('reference preparation quantizes both components to 8-bit from the original Ref2VA partition',async()=>{
  const graph=JSON.parse(await fs.readFile('resources/pipelines/reference/minimax-h3-reference/prepare.vpipeline','utf8'));
  const stage=(id:string)=>graph.stages.find((item:{id:string})=>item.id===id).config;
  assert.equal(stage('fetch').model_variant,'ref2va');
  assert.equal(stage('quant-dit').src_model,'Comfy-Org/MiniMax-H3-Ref2VA');
  assert.equal(stage('quant-dit').bits,8);
  assert.equal(stage('quant-enc').bits,8);
  assert.equal(stage('quant-enc').src_model,stage('quant-dit').output_name);
  assert.equal(stage('quant-enc').output_name,'local/MiniMax-H3-Ref2VA-8bit');
  assert.equal(stage('remove-dit-intermediate').model,stage('quant-dit').output_name);
});

test('an installed 4-bit pack and its receipt cannot satisfy 8-bit reference readiness',async()=>{
  await writeReferencePack(workspace);
  await fs.rename(model,model.replace('Ref2VA-8bit','Ref2VA-4bit'));
  registry.setServiceValue('prepared:reference',{fingerprint:JSON.stringify('local/MiniMax-H3-Ref2VA-4bit'),at:Date.now()});
  assert.equal((await setup.health()).capabilities!.reference.ready,false);
  assert.equal((await call('jobs')).status,409);
  publish=true;await preparePipeline(pipeline,fixture.jobsDir,new AbortController().signal,()=>{});
  assert.equal(prepares,1);
  assert.equal((await setup.health()).capabilities!.reference.ready,true);
  assert.equal((await fs.stat(model.replace('Ref2VA-8bit','Ref2VA-4bit'))).isDirectory(),true);
});

test('image references wire conditioning and video rows without an empty audio-reference tensor',async()=>{
  for(const references of [['one.png'],['one.png','two.png']]) {
    const graph=await buildPipeline({request,prompt:request.prompt,seed:1,width:512,height:512,output:'unused.mp4',directory:fixture.jobsDir,references});
    const encoder=graph.stages.find(s=>s.id===pipeline.metadata.references!.target)!;
    const generator=graph.stages.find(s=>s.id==='generate-video')!;
    assert.deepEqual(encoder.config.references,references);
    assert.deepEqual(generator.iports![0],{src:encoder.id,oport:0});
    assert.deepEqual(generator.iports![7],{src:encoder.id,oport:1});
    assert.deepEqual(generator.iports![8],{src:'',oport:0});
    // Reference-audio input is independent of the generated soundtrack.
    const audio=graph.stages.find(s=>s.type==='audio-vae-decode')!;
    assert.ok(audio.iports!.some(port=>port.src===generator.id&&port.oport===1));
  }
});
