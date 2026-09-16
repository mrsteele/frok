import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { resolveMediaTool } from '../src/lib/media-tools';
import type { Media } from '../src/lib/types';
import type { Pipeline } from '../src/lib/vpipe';
import type { RenderInput } from '../src/lib/providers/types';

await fs.mkdir('.data',{recursive:true});
const directory=await fs.mkdtemp(path.resolve('.data/native-upscale-test-'));
Object.assign(process.env,{FROK_DATA_DIR:directory,VPIPE_WORKDIR:path.join(directory,'vpipe'),VPIPE_BIN:path.resolve('tests/fixtures/native-upscale.mjs'),FFMPEG_BIN:resolveMediaTool('ffmpeg'),HF_TOKEN:'hf_SyntheticUpscaleTest'});
const {createLibraryFixture}=await import('./fixtures/library');
const fixture=await createLibraryFixture(),{test,after}=fixture;
const {diskCatalog,validatePipeline,pipelineStatus}=await import('../src/lib/pipelines/catalog');
const {dependencies}=await import('../src/lib/pipelines/dependencies');
const {upscaleGeometry,prepareNativeUpscale,finishNativeUpscale}=await import('../src/lib/native-upscale');
const {renderVpipe}=await import('../src/lib/vpipe');
const {finishUpscale}=await import('../src/lib/upscale-workflow');
const {runProcess}=await import('../src/lib/process');
const {ffmpeg,ffprobe}=await import('../src/lib/config');
const pipelines=(await diskCatalog()).entries.filter(p=>p.kind==='upscale'&&p.metadata.runner==='vpipe');
after(async()=>{fixture.close();await fs.rm(directory,{recursive:true,force:true});});

test('native upscalers register beside ComfyUI and offer starters for every required model',async()=>{
  assert.deepEqual(pipelines.map(p=>p.metadata.id),['vpipe:flashvsr','vpipe:vosr-2']);
  for(const p of pipelines){
    validatePipeline(p);
    const status=await pipelineStatus(p);
    assert.equal(status.ready,false);assert.equal(status.preparation,`upscale/${p.metadata.id.split(':')[1]}`);
    assert.deepEqual(dependencies(p),p.metadata.dependencies);
  }
  const flash=pipelines[0],vosr=pipelines[1];
  assert.ok(flash.metadata.dependencies[0].files.includes('posi_prompt.pth'));
  const undeclared=structuredClone(vosr);undeclared.metadata.dependencies=[];
  assert.ok(dependencies(undeclared).some(d=>d.reference==='facebook/dinov2-large'));
});

test('native video inputs cannot read unbound files or escape private output bindings',()=>{
  for(const p of pipelines){
    for(const change of [(p:typeof pipelines[number])=>{(p.graph as unknown as Pipeline).stages.unshift({id:'other',type:'load-video',config:{input_url:'/private.mp4'}});},
      (p:typeof pipelines[number])=>{p.metadata.videoSource!.field='other';},
      (p:typeof pipelines[number])=>{p.metadata.bindings.output=[];},
      (p:typeof pipelines[number])=>{p.metadata.bindings.fps=[];},
      (p:typeof pipelines[number])=>{p.metadata.bindings.seed=[{node:p.metadata.videoSource!.node,field:'input_url'}];}]){
      const invalid=structuredClone(p);change(invalid);assert.throws(()=>validatePipeline(invalid));
    }
  }
});

test('FlashVSR padding keeps every source frame across short clips and temporal boundaries',()=>{
  for(const frames of [1,20,21,24,25,29,31,37,41,144,192,240])for(const [width,height] of [[1280,720],[720,1280],[720,720],[1080,720]]){
    const size=upscaleGeometry(width,height,frames,pipelines[0].metadata.upscale);
    assert.equal(size.width%128,0);assert.equal(size.height%128,0);assert.equal(size.frames%8,1);
    assert.ok(size.frames>=25);assert.ok(size.frames-4>=frames);assert.ok(size.width>=width&&size.height>=height);
  }
});

async function probe(file:string){return JSON.parse(await runProcess(ffprobe(),['-v','error','-count_frames','-show_streams','-show_format','-of','json',file]));}
async function inputFor(index:number):Promise<RenderInput>{
  const folder=path.join(fixture.jobsDir,`native-${index}`);await fs.mkdir(folder,{recursive:true});
  const source=path.join(fixture.mediaDir,`native-${index}.mp4`);await fs.mkdir(fixture.mediaDir,{recursive:true});
  await runProcess(ffmpeg(),['-v','error','-y','-f','lavfi','-i','testsrc2=size=64x48:rate=30000/1001','-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-frames:v','31','-t',String(31*1001/30000),'-c:v','libx264','-c:a','aac','-pix_fmt','yuv420p',source]);
  return {request:{mode:'upscale',prompt:'',aspect:'4:3',duration:31*1001/30000,quality:'standard',count:1,enhance:false,referenceIds:[],pipeline:pipelines[index]},prompt:'',seed:42,width:96,height:72,source,output:path.join(folder,'raw.mp4'),directory:folder,references:[],signal:new AbortController().signal,log:()=>{}};
}

test('native render submits aligned private clips and restores frame count, framing, rate and audio',async()=>{
  const header=Buffer.from(JSON.stringify({a:{dtype:'U8',shape:[1],data_offsets:[0,1]}})),length=Buffer.alloc(8);length.writeBigUInt64LE(BigInt(header.length));
  for(const p of pipelines)for(const d of p.metadata.dependencies)for(const name of d.files){const file=path.join(process.env.VPIPE_WORKDIR!,'models',d.reference,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,name.endsWith('.safetensors')?Buffer.concat([length,header,Buffer.from([1])]):'synthetic');}
  for(const [index,p] of pipelines.entries()){
    assert.equal((await pipelineStatus(p)).ready,true);
    const input=await inputFor(index),before=createHash('sha256').update(await fs.readFile(input.source!)).digest('hex');
    await renderVpipe(input);
    const result=await probe(input.output),stream=result.streams.find((s:any)=>s.codec_type==='video');
    assert.equal(stream.width,96);assert.equal(stream.height,72);assert.equal(Number(stream.nb_read_frames),31);
    assert.ok(Math.abs(Number(result.format.duration)-input.request.duration)<0.02);
    const saved=JSON.parse(await fs.readFile(path.join(input.directory,'pipeline.vpipeline'),'utf8')) as Pipeline;
    assert.ok(saved.stages.filter(s=>s.config.encoder_dir).every(s=>path.isAbsolute(String(s.config.encoder_dir))));
    const finished=path.join(input.directory,'finished.mp4');
    await finishUpscale({filename:path.basename(input.source!),width:64,height:48,duration:input.request.duration} as Media,input.output,finished,input.signal,input.log);
    const final=await probe(finished);assert.ok(final.streams.some((s:any)=>s.codec_type==='audio'));
    assert.equal(createHash('sha256').update(await fs.readFile(input.source!)).digest('hex'),before);
    assert.ok(!(await fs.readdir(input.directory)).some(name=>name.startsWith('upscale-')));
  }
});

test('truncated native output is rejected instead of silently filling missing motion',async()=>{
  const input=await inputFor(0),prepared=await prepareNativeUpscale(input);
  await runProcess(ffmpeg(),['-v','error','-y','-i',prepared.input.source!,'-frames:v','20','-c:v','libx264',prepared.input.output]);
  await assert.rejects(finishNativeUpscale(prepared,input),/incomplete frames/);
});
