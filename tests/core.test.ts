import { createLibraryFixture } from './fixtures/library';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import http from 'node:http';
import sharp from 'sharp';
import { writeLora, writeReferenceTurbo } from './fixtures/lora.mjs';
import { writeReferencePack } from './fixtures/reference-pack';
import type { Generation, Job, Media } from '../src/lib/types';
import { withRunnerLocations } from '../src/lib/runner-locations';
import { animationRequest } from '../src/lib/media-family';
import { resolveMediaTool } from '../src/lib/media-tools';
import type { Graph } from '../src/lib/comfyui';

const testDir=path.join(process.cwd(),'.data',`test-${process.pid}`);
process.env.FROK_DATA_DIR=testDir;
process.env.VPIPE_WORKDIR=path.join(testDir,'vpipe');
const comfyDir=path.join(testDir,'comfy');
const comfyRoots={input:path.join(comfyDir,'input'),output:path.join(comfyDir,'output')};
process.env.COMFYUI_DIR=comfyDir;
process.env.OLLAMA_MODEL='synthetic:writer';process.env.VPIPE_IMAGE_MODEL='krea/Krea-2-Turbo';process.env.FROK_COMFYUI_PRIVATE='0';
process.env.VPIPE_BIN=path.join(process.cwd(),'tests/fixtures/vpipe.mjs');
const imageBytes=await sharp({create:{width:80,height:80,channels:3,background:'#228844'}}).png().toBuffer();
const motionCalls: {messages:{role:string;content:string}[];keep_alive:number}[]=[];
const uuidPattern='[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}';
const upscaleNamespace=new RegExp(`^frok/local/${uuidPattern}/${uuidPattern}$`);
const upscaleUploads:{filename:string;subfolder:string;size:number}[]=[];
const upscaleSubmissions:{promptId:string;clientId:string;namespace:string;graph:Graph;filename:string;historyRead:boolean;historyDeleted:boolean}[]=[];
const mappingRequests:{area:string;subfolder:string}[]=[];
const runFixture=promisify(execFile);
let submittedGraph:unknown,uploaded=false,comfyFail=false;
const comfyServer=http.createServer(async(req,res)=>{
  const route=req.url||'';let raw=Buffer.alloc(0);for await(const chunk of req)raw=Buffer.concat([raw,chunk]);
  res.setHeader('Content-Type','application/json');
  if(route==='/api/tags')return res.end(JSON.stringify({models:[{name:'synthetic:writer'}]}));
  if(route==='/api/show')return res.end(JSON.stringify({capabilities:['completion']}));
  if(route==='/api/chat'){
    const input=JSON.parse(raw.toString());motionCalls.push(input);
    if(input.format?.properties?.details){
      const brief=JSON.parse(input.messages[1].content);
      return res.end(JSON.stringify({message:{content:JSON.stringify({details:Array.from({length:brief.count},(_,index)=>`Soft lighting variation ${index+1}, soft reflections and detailed texture.`)})},done_reason:'stop'}));
    }
    if(input.messages.some((m:{content:string})=>m.content.includes('force-motion-fallback'))){res.statusCode=503;return res.end('{}');}
    return res.end(JSON.stringify({message:{content:'<think>Internal planning</think>A blue paper boat twirls playfully on the pond, then settles into a gentle drift.'}}));
  }
  if(route==='/upload/image'){
    uploaded=true;
    const form=await new Response(new Uint8Array(raw),{headers:{'Content-Type':req.headers['content-type']!}}).formData();
    const file=form.get('image');assert.ok(file instanceof File);
    if(file.name.endsWith('.mp4')){
      const subfolder=String(form.get('subfolder'));assert.match(subfolder,upscaleNamespace);assert.match(file.name,new RegExp(`^${uuidPattern}\\.mp4$`));
      assert.equal(form.get('type'),'input');assert.equal(form.get('overwrite'),'false');
      await fs.mkdir(path.join(comfyRoots.input,subfolder),{recursive:true});
      await fs.writeFile(path.join(comfyRoots.input,subfolder,file.name),new Uint8Array(await file.arrayBuffer()));
      upscaleUploads.push({filename:file.name,subfolder,size:file.size});
      return res.end(JSON.stringify({name:file.name,subfolder,type:'input'}));
    }
    return res.end(JSON.stringify({name:'reference.png',subfolder:'frok'}));
  }
  if(route==='/object_info')return res.end(JSON.stringify(Object.fromEntries(['CheckpointLoaderSimple','CLIPTextEncode','EmptyLatentImage','KSampler','VAEDecode','SaveImage','UNETLoader','CLIPLoader','VAELoader','MiniMaxH3ImageToVideo','RandomNoise','BasicGuider','KSamplerSelect','BasicScheduler','SamplerCustomAdvanced','VAEDecodeAudio','CreateVideo','SaveVideo','LoadImage','MiniMaxH3ReferenceToVideo','LoadVideo','GetVideoComponents','UpscaleModelLoader','ImageUpscaleWithModel','ImageScale'].map(n=>[n,{}]))));
  if(route==='/prompt'){
    const input=JSON.parse(raw.toString()) as {prompt:Graph;prompt_id:string;client_id:string};submittedGraph=input.prompt;
    if(input.prompt['load-video']?.class_type==='LoadVideo'){
      const graph=input.prompt,source=String(graph['load-video'].inputs.file),namespace=path.posix.dirname(source),filename='render_00001.mp4';
      assert.match(namespace,upscaleNamespace);assert.match(input.prompt_id,new RegExp(`^${uuidPattern}$`));
      assert.equal(input.client_id,`frok-local-${namespace.split('/').slice(2).join('-')}`);
      assert.equal(graph.upscale.class_type,'ImageUpscaleWithModel');assert.equal(graph.resize.class_type,'ImageScale');
      assert.equal(graph['save-video'].class_type,'SaveVideo');assert.equal(graph['save-video'].inputs.filename_prefix,`${namespace}/render`);
      assert.ok(upscaleUploads.some(file=>`${file.subfolder}/${file.filename}`===source));
      await fs.mkdir(path.join(comfyRoots.output,namespace),{recursive:true});
      // Only FFmpeg scales synthetic fixture frames. The worker restores the original audio.
      await runFixture(resolveMediaTool('ffmpeg'),['-v','error','-y','-i',path.join(comfyRoots.input,source),'-map','0:v:0','-an','-vf',`scale=${graph.resize.inputs.width}:${graph.resize.inputs.height}:flags=lanczos`,'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p',path.join(comfyRoots.output,namespace,filename)],{timeout:10_000});
      upscaleSubmissions.push({promptId:input.prompt_id,clientId:input.client_id,namespace,graph,filename,historyRead:false,historyDeleted:false});
      return res.end(JSON.stringify({prompt_id:input.prompt_id,node_errors:{}}));
    }
    return res.end(JSON.stringify({prompt_id:'frok-test',node_errors:{}}));
  }
  if(route.startsWith('/history/')){
    const entry=upscaleSubmissions.find(item=>item.promptId===route.slice('/history/'.length)&&!item.historyDeleted);
    if(entry){entry.historyRead=true;return res.end(JSON.stringify({[entry.promptId]:{status:{completed:true,status_str:'success'},outputs:{'save-video':{videos:[{filename:entry.filename,subfolder:entry.namespace,type:'output'}]}}}}));}
    return res.end(JSON.stringify({'frok-test':comfyFail?{status:{status_str:'error',messages:['Intentional ComfyUI failure']}}:{status:{completed:true,status_str:'success'},outputs:{'7':{images:[{filename:'generated.png',type:'output'}]}}}}));
  }
  if(route==='/history'&&req.method==='POST'){
    const ids=JSON.parse(raw.toString()).delete as string[];
    for(const entry of upscaleSubmissions)if(ids.includes(entry.promptId))entry.historyDeleted=true;
    return res.end('{}');
  }
  if(route.startsWith('/view?')){
    const query=new URL(route,'http://localhost').searchParams,filename=query.get('filename')!;
    if(filename==='mapping.txt'||filename.endsWith('.mp4')){
      const area=query.get('type'),subfolder=query.get('subfolder')!;
      assert.ok(area==='input'||area==='output');assert.ok(subfolder.startsWith('frok/'));assert.ok(!subfolder.split('/').includes('..'));assert.equal(path.basename(filename),filename);
      if(filename==='mapping.txt')mappingRequests.push({area,subfolder});
      res.setHeader('Content-Type',filename==='mapping.txt'?'text/plain':'video/mp4');
      return res.end(await fs.readFile(path.join(comfyRoots[area],subfolder,filename)));
    }
    res.setHeader('Content-Type','image/png');return res.end(imageBytes);
  }
  if(route==='/queue')return res.end(JSON.stringify({queue_running:[],queue_pending:[]}));
  res.end('{}');
});
comfyServer.listen(0,'127.0.0.1');await once(comfyServer,'listening');
process.env.COMFYUI_URL=`http://127.0.0.1:${(comfyServer.address() as {port:number}).port}`;
process.env.OLLAMA_URL=process.env.COMFYUI_URL;
const fixture = await createLibraryFixture();
const { test, after, before } = fixture;
const { serviceValue } = await import('../src/lib/registry');
const store=await import('../src/lib/db');
const routes=await import('../src/app/api/[[...segments]]/route');
const {generationSchema,dimensions,frameCount,hdDimensions}=await import('../src/lib/validation');
const {buildPipeline,factoryPipeline}=await import('./fixtures/pipeline');
const {dependencies}=await import('../src/lib/pipelines/dependencies');
const {buildComfyGraph,renderComfy}=await import('../src/lib/comfyui');
const {health:readHealth}=await import('../src/lib/setup');
const {generationBlocker}=await import('../src/lib/readiness');
const {parseGpuSample,parseStepProgress,telemetry}=await import('../src/lib/telemetry');
const base:Generation={mode:'image',prompt:'test creative brief',aspect:'1:1',duration:6,quality:'preview',count:2,enhance:false,referenceIds:[]};
let worker:ChildProcess;let workerLog='';
async function call(method:'GET'|'POST'|'PATCH'|'HEAD',endpoint:string,data?:unknown,headers:Record<string,string>={}){
  const [pathname]=endpoint.split('?');
  return routes[method](fixture.request(`http://localhost:3000/api/${endpoint}`,{method,headers:{...(data instanceof FormData?{}:data?{'Content-Type':'application/json'}:{}),...headers},body:data instanceof FormData?data:data?JSON.stringify(data):undefined}),{params:Promise.resolve({segments:pathname.split('/')})});
}
async function waitFor(fn:()=>boolean,timeout=15000){const start=Date.now();while(!fn()){if(Date.now()-start>timeout)throw new Error(`Timed out. Worker: ${workerLog}`);await delay(60);}}
async function enqueue(request:Generation){const response=await call('POST','jobs',request);assert.equal(response.status,201,JSON.stringify(await response.clone().json()));return (await response.json()).job as Job;}
async function complete(job:Job){await waitFor(()=>['completed','failed','cancelled'].includes(store.getJob(job.id)!.status),25000);const result=store.getJob(job.id)!;assert.equal(result.status,'completed',result.error);return result;}
async function upload(purpose='image'){const form=new FormData();form.set('purpose',purpose);form.set('image',new Blob([new Uint8Array(await sharp({create:{width:850,height:1100,channels:3,background:'#334466'}}).png().toBuffer())],{type:'image/png'}),'test.png');const response=await call('POST','upload',form);assert.equal(response.status,201);return (await response.json()).media as Media;}
before(async()=>{
  for(const directory of Object.values(comfyRoots))await fs.mkdir(directory,{recursive:true});
  const dependency=dependencies(factoryPipeline('upscale','comfyui')).find(item=>item.reference==='upscale_models/RealESRGAN_x4plus.pth')!;
  assert.ok(dependency.size);
  const modelFile=path.join(comfyDir,'models',dependency.reference);await fs.mkdir(path.dirname(modelFile),{recursive:true});
  const model=await fs.open(modelFile,'w');
  // Sparse synthetic marker satisfies declared size checks; no AI weights are loaded.
  try{await model.writeFile('Synthetic ComfyUI upscale model fixture');await model.truncate(dependency.size);}finally{await model.close();}
  await fs.mkdir(process.env.VPIPE_WORKDIR!,{recursive:true});
  const referencePack=await writeReferencePack(process.env.VPIPE_WORKDIR!);
  await fs.cp(referencePack,path.join(process.env.VPIPE_WORKDIR!,'models/local/MiniMax-H3-FL2VA-8bit'),{recursive:true});
  const baseModel=path.join(process.env.VPIPE_WORKDIR!,'models/krea/Krea-2-Turbo');
  for(const component of ['transformer','text_encoder','vae'])await writeLora(path.join(baseModel,component,'model.safetensors'));
  await fs.mkdir(path.join(baseModel,'tokenizer'),{recursive:true});await fs.writeFile(path.join(baseModel,'tokenizer/tokenizer.json'),'{}');await fs.writeFile(path.join(baseModel,'model_index.json'),'{}');
  await writeLora(path.join(process.env.VPIPE_WORKDIR!,'models/mgwr/M87/m87_lora_v1.safetensors'));
  store.setValue('runnerLocations',{comfyDir,comfyUrl:process.env.COMFYUI_URL!});
  store.setValue('connections',{vpipe:true,comfyui:true,ollama:true});
  store.setValue('modelSelections',{image:'krea-2-turbo',video:'vpipe',reference:'vpipe',prompt:'synthetic:writer',upscale:null});
  store.setValue('pipelineSelections',Object.fromEntries(['image','video','reference','upscale'].map(kind=>[kind,factoryPipeline(kind as import('../src/lib/pipelines/schema').PipelineKind,kind==='upscale'?'comfyui':'vpipe').metadata.id])));
  await writeReferenceTurbo(process.env.VPIPE_WORKDIR!);
  await writeLora(path.join(process.env.VPIPE_WORKDIR!,'models/larryvrh/MiniMax-H3-Turbo-Lora/minimax_h3_turbo_v4_step600_ema.safetensors'));
  worker=spawn(process.execPath,['--import','tsx','src/worker/index.ts'],{cwd:process.cwd(),env:process.env,stdio:['ignore','pipe','pipe']});
  worker.stdout?.on('data',b=>workerLog+=b);worker.stderr?.on('data',b=>workerLog+=b);
  await waitFor(()=>serviceValue('workerHeartbeat',0)>0);
});
after(async()=>{
  worker?.kill('SIGTERM');if(worker?.exitCode===null)await once(worker,'exit');
  comfyServer.close();fixture.close();await fs.rm(testDir,{recursive:true,force:true});
});

test('validates creative modes, reference limits, duration, and seed bounds',()=>{
  assert.equal(generationSchema.parse(base).count,2);
  for(const input of [{...base,prompt:''},{...base,duration:7},{...base,seed:-1},{...base,mode:'reference'},{...base,mode:'image',sourceId:'c8cc9bd3-aed2-4e41-84b5-b1e9fc4b74f8'}])assert.equal(generationSchema.safeParse(input).success,false);
});
test('480p default and 720p HD align the model canvas and preserve portrait dimensions',()=>{
  assert.deepEqual(dimensions('16:9','preview',true),{width:864,height:480,outputWidth:854,outputHeight:480});
  assert.deepEqual(dimensions('16:9','standard',true),{width:1280,height:736,outputWidth:1280,outputHeight:720});
  const portrait=dimensions('16:9','preview',true,{width:850,height:1100});assert.equal(portrait.outputWidth,480);assert.equal(portrait.outputHeight,622);
  assert.equal(portrait.width%32,0);assert.equal(portrait.height%32,0);
  for(const s of [6,8,10]){assert.equal(frameCount(s)%17,5);assert.ok(frameCount(s)>=s*24);assert.ok(frameCount(s)-s*24<17);}
});
test('Vpipe wires the actual image anchor and multiple reference paths to distinct checkpoints',async()=>{
  const input={request:{...base,mode:'video' as const},prompt:'Literal "text" and $() preserved',seed:44,width:480,height:640,output:'/tmp/output.mp4',directory:'/tmp',source:'/tmp/source.png',references:[]};
  const p=await buildPipeline(input);const gen=p.stages.find(s=>s.id==='generate-video')!;
  assert.equal(gen.iports![5].src,'frok-input-encode');assert.equal(gen.config.frames,158);
  assert.equal(p.stages.find(s=>s.id==='text-prompt')!.config.text,input.prompt);
  const ref=await buildPipeline({...input,source:undefined,request:{...base,mode:'reference'},references:['/one.png','/two.png']});
  assert.deepEqual(ref.stages.find(s=>s.id==='frok-references')!.config.references,['/one.png','/two.png']);
  assert.equal(ref.stages.find(s=>s.id==='generate-video')!.iports![7].src,'frok-references');
  assert.equal(ref.stages.find(s=>s.id==='minimax-h3-model-config')!.config.lora,'lightx2v/Minimax-h3-Turbo-ref2va-4step-split');
});
test('every generated Vpipe graph declares dependencies before their consumers',async()=>{
  const input={request:base,prompt:'A synthetic test scene',seed:5,width:480,height:640,output:path.join(testDir,'graph.mp4'),directory:testDir,references:[] as string[]};
  const cases=[input,{...input,request:{...base,mode:'video' as const}},{...input,request:{...base,mode:'video' as const},source:path.join(testDir,'synthetic-source.png')},{...input,request:{...base,mode:'reference' as const},references:[path.join(testDir,'synthetic-reference.png')]}];
  for(const entry of cases){
    const pipeline=await buildPipeline(entry),declared=new Set<string>();
    for(const node of pipeline.stages){
      assert.ok(!declared.has(node.id),`Duplicate stage: ${node.id}`);
      for(const [index,input] of (node.iports||[]).entries())if(input.src)assert.ok(declared.has(input.src),`${pipeline.id}: ${node.id} iports[${index}] references ${input.src} before it is declared`);
      declared.add(node.id);
    }
  }
});
test('ComfyUI graph uses native H3 conditioning and per-reference autogrow inputs',()=>{
  const input={request:{...base,mode:'reference' as const},prompt:'<Picture 1> in a forest',seed:99,width:480,height:480,output:'x.mp4',directory:testDir,references:[]};
  const g=buildComfyGraph(input,undefined,['a.png','b.png']);assert.equal(g['5'].class_type,'MiniMaxH3ReferenceToVideo');assert.deepEqual(g['5'].inputs['ref_images.ref_image_1'],['31',0]);assert.deepEqual(g['10'].inputs.latent_image,['5',1]);assert.equal(g['14'].class_type,'SaveVideo');
});
test('an unprotected remote ComfyUI is rejected before sending a graph or source',async()=>{
  const directory=path.join(fixture.jobsDir,'comfy');await fs.mkdir(directory,{recursive:true});const source=path.join(directory,'source.png');await fs.writeFile(source,imageBytes);
  await withRunnerLocations({comfyUrl:'https://untrusted.example'},()=>assert.rejects(renderComfy({request:base,prompt:'test',seed:4,width:512,height:512,output:path.join(directory,'result.png'),directory,source,references:[],signal:new AbortController().signal,log:()=>{}}),/protected backend/));
  assert.equal(uploaded,false);assert.equal(submittedGraph,undefined);
});
test('rejects cross-site mutations and invalid upload content',async()=>{
  const denied=await call('POST','jobs',base,{Origin:'https://attacker.example'});assert.equal(denied.status,403);
  const bad=new FormData();bad.set('image',new Blob(['not an image'],{type:'image/png'}),'fake.png');assert.equal((await call('POST','upload',bad)).status,400);
});
test('serial queue supports cancelling queued and actively running work',async()=>{
  const slow=await enqueue({...base,prompt:'slow',count:1});await waitFor(()=>store.getJob(slow.id)?.status==='running');
  const queued=await enqueue(base);await delay(200);assert.equal(store.getJob(queued.id)?.status,'queued');
  assert.equal((await call('POST',`jobs/${queued.id}/cancel`,{})).status,200);assert.equal(store.getJob(queued.id)?.status,'cancelled');
  await call('POST',`jobs/${slow.id}/cancel`,{});await delay(1000);assert.equal(store.getJob(slow.id)?.status,'cancelled');
  assert.equal(store.listMedia().length,0);
});
test('image batches persist distinct seeds and favorites can be saved and removed',async()=>{
  const job=await enqueue({...base,seed:42});await complete(job);
  const images=store.listMedia().filter(m=>m.jobId===job.id);assert.equal(images.length,2);assert.deepEqual(images.map(m=>m.batchIndex).sort(),[0,1]);assert.deepEqual(images.map(m=>m.seed).sort(),[42,43]);
  const id=images[0].id;await call('PATCH',`media/${id}`,{favorite:true});assert.ok(store.getMedia(id)?.favorite);
  const response=await call('GET','media?favorites=true');assert.ok((await response.json()).media.some((m:Media)=>m.id===id));
  await call('PATCH',`media/${id}`,{favorite:false});assert.equal(store.getMedia(id)?.favorite,false);
  assert.equal((await call('POST',`jobs/${job.id}/cancel`,{})).status,400);
});
test('enhanced image batches send and save an individual prompt and seed for every image',async()=>{
  const before=motionCalls.length;
  const job=await enqueue({...base,prompt:'A blue paper boat',count:4,seed:420,enhance:true});await complete(job);
  const images=store.listMedia().filter(item=>item.jobId===job.id).sort((a,b)=>a.batchIndex!-b.batchIndex!);
  assert.equal(images.length,4);
  assert.equal(motionCalls.length-before,1);
  assert.deepEqual(images.map(item=>item.seed),[420,421,422,423]);
  assert.equal(new Set(images.map(item=>item.enhancedPrompt)).size,4);
  for(const item of images){
    assert.equal(item.prompt,'A blue paper boat');
    assert.equal(item.promptTrace?.raw,item.prompt);
    assert.equal(item.promptTrace?.enhanced,true);
    const pipeline=JSON.parse(await fs.readFile(path.join(fixture.directory,'jobs',job.id,String(item.batchIndex),'pipeline.vpipeline'),'utf8'));
    assert.equal(pipeline.stages.find((stage:{id:string})=>stage.id==='text-prompt').config.text,item.enhancedPrompt);
    assert.equal(pipeline.stages.find((stage:{id:string})=>stage.id==='generate-image').config.seed,item.seed);
    const graph=buildComfyGraph({request:{...base,enhance:true},prompt:item.enhancedPrompt,seed:item.seed,width:512,height:512,output:'unused.png',directory:testDir,references:[]});
    assert.equal(graph['2'].inputs.text,item.enhancedPrompt);
    assert.equal(graph['5'].inputs.seed,item.seed);
  }
});
test('failed jobs keep diagnostics and do not block the next generation',async()=>{
  const bad=await enqueue({...base,prompt:'fail',count:1});const next=await enqueue({...base,count:1});await complete(next);
  assert.equal(store.getJob(bad.id)?.status,'failed');assert.match(store.getJob(bad.id)!.error!,/Intentional test runner failure/);
  const log=await (await call('GET',`jobs/${bad.id}/log`)).json();assert.match(log.log,/Intentional/);
});
test('failed final video validation keeps the output with its job and leaves no untracked library file',async()=>{
  const before=(await fs.readdir(fixture.mediaDir)).sort();
  const job=await enqueue({...base,mode:'video',prompt:'short-video',count:1});
  await waitFor(()=>store.getJob(job.id)?.status==='failed');
  assert.match(store.getJob(job.id)!.error!,/Runner produced.*instead of/);
  assert.equal(store.listMedia().some(item=>item.jobId===job.id),false);
  assert.deepEqual((await fs.readdir(fixture.mediaDir)).sort(),before);
  assert.ok((await fs.stat(path.join(fixture.jobsDir,job.id,'0','finished.mp4'))).size>0);
});
test('text to video trims to six seconds and ComfyUI upscale retains audio and the video root',async()=>{
  const job=await enqueue({...base,mode:'video',aspect:'16:9',count:1});await complete(job);
  const result=store.listMedia().find(m=>m.jobId===job.id&&m.kind==='video')!;assert.ok(result);assert.equal(result.width,854);assert.equal(result.height,480);assert.ok(Math.abs(result.duration!-6)<.1);assert.ok(result.favorite);assert.equal(result.sourceId,undefined);assert.equal(result.rootId,result.id);assert.equal(store.listMedia().filter(m=>m.jobId===job.id).length,1);
  const {ffprobe}=await import('../src/lib/config');const {runProcess}=await import('../src/lib/process');const metadata=JSON.parse(await runProcess(ffprobe(),['-v','error','-show_streams','-of','json',path.join(fixture.directory,'media',result.filename)]));assert.ok(metadata.streams.some((s:{codec_type:string})=>s.codec_type==='audio'));
  const range=await call('GET',`media/${result.id}`,undefined,{Range:'bytes=0-31'});assert.equal(range.status,206);assert.equal((await range.arrayBuffer()).byteLength,32);
  const suffix=await call('GET',`media/${result.id}`,undefined,{Range:'bytes=-12'});assert.equal((await suffix.arrayBuffer()).byteLength,12);
  assert.equal((await call('GET',`media/${result.id}`,undefined,{Range:'bytes=999999999-'})).status,416);
  const head=await call('HEAD',`media/${result.id}`);assert.equal(head.status,200);assert.ok(Number(head.headers.get('content-length'))>0);
  const hd=await enqueue({...base,mode:'upscale',sourceId:result.id,count:1});await complete(hd);
  assert.equal(hd.runner,'comfyui');assert.equal(hd.request.pipeline?.metadata.id,'comfyui:realesrgan');
  const entry=upscaleSubmissions.find(item=>item.namespace.split('/')[2]===hd.id)!;assert.ok(entry);
  const videoUpload=upscaleUploads.find(item=>item.subfolder===entry.namespace)!;assert.ok(videoUpload);
  assert.notEqual(videoUpload.filename,result.filename);assert.equal(videoUpload.size,(await fs.stat(path.join(fixture.mediaDir,result.filename))).size);
  assert.equal(entry.graph['load-video'].inputs.file,`${entry.namespace}/${videoUpload.filename}`);
  assert.equal(entry.graph.model.inputs.model_name,'RealESRGAN_x4plus.pth');
  assert.deepEqual(entry.graph.upscale.inputs,{upscale_model:['model',0],image:['components',0]});
  assert.deepEqual([entry.graph.resize.inputs.width,entry.graph.resize.inputs.height],[1282,720]);
  assert.deepEqual(entry.graph['create-video'].inputs,{images:['resize',0],audio:['components',1],fps:['components',2]});
  assert.deepEqual(mappingRequests.filter(item=>item.subfolder.startsWith(`${entry.namespace}/`)).map(item=>item.area).sort(),['input','output']);
  assert.ok(entry.historyRead);assert.ok(entry.historyDeleted);
  for(const directory of Object.values(comfyRoots))await assert.rejects(fs.access(path.join(directory,entry.namespace)),{code:'ENOENT'});
  assert.ok(!(await fs.readdir(path.join(fixture.jobsDir,hd.id,'0'))).some(name=>name.startsWith('comfy-cleanup-')));
  const upscaled=store.listMedia().find(m=>m.jobId===hd.id)!;assert.equal(upscaled.width,1282);assert.equal(upscaled.height,720);assert.equal(upscaled.quality,'HD 720p · Real-ESRGAN');
  assert.equal(upscaled.runner,'comfyui');assert.deepEqual(upscaled.upscalePipeline,{id:hd.request.pipeline!.metadata.id,name:'Real-ESRGAN',revision:hd.request.pipeline!.revision});
  assert.equal((await call('POST','jobs',{...base,mode:'upscale',sourceId:upscaled.id,count:1})).status,400);
  const hdMeta=JSON.parse(await runProcess(ffprobe(),['-v','error','-show_streams','-show_format','-of','json',path.join(fixture.directory,'media',upscaled.filename)]));assert.ok(hdMeta.streams.some((s:{codec_type:string})=>s.codec_type==='audio'));assert.ok(Math.abs(Number(hdMeta.format.duration)-6)<.1);assert.ok(store.getMedia(result.id)?.favorite);
  const family=await (await call('GET',`media/${upscaled.id}/family`)).json();
  assert.equal(family.root.id,result.id);assert.equal(family.renders.length,1);assert.equal(family.renders[0].media.id,result.id);assert.equal(family.renders[0].hd.id,upscaled.id);
  await call('PATCH',`media/${upscaled.id}`,{favorite:false});assert.equal(store.getMedia(result.id)?.favorite,false);assert.equal(store.getMedia(upscaled.id)?.favorite,false);
});
test('image to video preserves portrait shape; 8s and 10s are exported exactly',async()=>{
  const source=await upload();
  for(const duration of [8,10]){
    const job=await enqueue({...base,mode:'video',sourceId:source.id,duration,count:1});await complete(job);
    const result=store.listMedia().find(m=>m.jobId===job.id&&m.kind==='video')!;assert.equal(result.sourceId,source.id);assert.equal(result.width,480);assert.equal(result.height,622);assert.ok(Math.abs(result.duration!-duration)<.1);
  }
  assert.ok(store.getMedia(source.id)?.favorite);
});
test('reference video preserves each uploaded reference as a favorite',async()=>{
  const a=await upload(),b=await upload();const job=await enqueue({...base,mode:'reference',referenceIds:[a.id,b.id],count:1});await complete(job);assert.ok(store.getMedia(a.id)?.favorite);assert.ok(store.getMedia(b.id)?.favorite);
});

test('text video redo belongs to its video root and rejects custom prompts or image inputs',async()=>{
  const first=await enqueue({...base,mode:'video',count:1});await complete(first);
  const root=store.listMedia().find(m=>m.jobId===first.id&&m.kind==='video')!;
  const request=animationRequest(root,root,undefined,false,{seed:0});
  const next=await enqueue(request);await complete(next);
  const result=store.listMedia().find(m=>m.jobId===next.id)!;
  assert.equal(result.rootId,root.id);assert.equal(result.sourceId,undefined);assert.equal(result.seed,0);
  const family=await (await call('GET',`media/${result.id}/family`)).json();
  assert.equal(family.root.id,root.id);assert.deepEqual(family.renders.map((r:{media:Media})=>r.media.id),[root.id,result.id]);
  await assert.rejects(fs.access(path.join(fixture.directory,'jobs',next.id,'starting-frame.png')));
  assert.equal((await call('POST','jobs',{...request,prompt:'An unrelated scene'})).status,400);
  assert.equal((await call('POST','jobs',{...request,sourceId:(await upload()).id})).status,400);
});

test('reference video prompt edits preserve saved references and expose downloadable previews',async()=>{
  const a=await upload('reference'),b=await upload('reference');
  const first=await enqueue({...base,mode:'reference',referenceIds:[a.id,b.id],count:1});await complete(first);
  const root=store.listMedia().find(m=>m.jobId===first.id&&m.kind==='video')!;
  const request=animationRequest(root,root,{prompt:'The paper boat turns right'},false);
  const next=await enqueue(request);await complete(next);
  const result=store.listMedia().find(m=>m.jobId===next.id)!;
  assert.equal(result.rootId,root.id);assert.equal(result.generation?.mode,'reference');assert.equal(result.prompt,request.prompt);
  const family=await (await call('GET',`media/${result.id}/family`)).json();
  assert.equal(store.listAssets().media.some(item=>[a.id,b.id].includes(item.id)),false);
  assert.equal(store.getMedia(a.id)?.favorite,false);
  assert.equal(family.root.kind,'video');assert.deepEqual(family.references.map((ref:{id:string})=>ref.id),[a.id,b.id]);
  assert.equal((await call('GET',`media/${a.id}?download=1`)).status,200);
  assert.equal((await call('POST','jobs',{...request,referenceIds:[b.id,a.id]})).status,400);
  assert.equal((await call('POST','jobs',{...request,mode:'video',referenceIds:[]})).status,400);
  await assert.rejects(fs.access(path.join(fixture.directory,'jobs',next.id,'starting-frame.png')));
});


test('HD generation exports a true 1280×720 file from the aligned H3 canvas',async()=>{
  const job=await enqueue({...base,mode:'video',aspect:'16:9',quality:'standard',count:1});await complete(job);
  const result=store.listMedia().find(m=>m.jobId===job.id&&m.kind==='video')!;assert.equal(result.width,1280);assert.equal(result.height,720);
});
test('a second worker cannot claim the same GPU queue',async()=>{
  const other=spawn(process.execPath,['--import','tsx','src/worker/index.ts'],{cwd:process.cwd(),env:process.env,stdio:'ignore'});
  const [code]=await once(other,'exit');assert.equal(code,1);assert.equal(serviceValue('workerPid',0),worker.pid);
});


test('blocks unprepared modes at the API, including retries, without blocking prepared modes',async()=>{
  const file=path.join(process.env.VPIPE_WORKDIR!,'models/krea/Krea-2-Turbo/tokenizer/tokenizer.json');await fs.rename(file,file+'.held');
  try {
    const response=await call('POST','jobs',base);assert.equal(response.status,409);assert.match((await response.json()).error,/needs preparation/);
    const h=await readHealth();assert.match(generationBlocker(h,'image')!,/Krea 2 Turbo/);assert.equal(generationBlocker(h,'video'),undefined);assert.equal(generationBlocker(h,'upscale'),undefined);
    const failed=store.createJob({kind:'generate',request:base,runner:'vpipe',total:2});store.updateJob(failed.id,{status:'failed'});
    assert.equal((await call('POST',`jobs/${failed.id}/retry`,{})).status,409);
  } finally {await fs.rename(file+'.held',file);}
});
test('finished jobs are deleted with logs while saved media stays and active jobs are protected',async()=>{
  const job=await enqueue({...base,count:1});await complete(job);await waitFor(()=>serviceValue<{id:string}|null>('activeJob',null)?.id!==job.id);const saved=store.listMedia().find(m=>m.jobId===job.id)!;
  assert.equal((await call('POST',`jobs/${job.id}/dismiss`,{})).status,200);assert.ok(!store.listJobs().some(j=>j.id===job.id));assert.ok(store.getMedia(saved.id));assert.equal(store.getJob(job.id),undefined);assert.equal(await fs.stat(path.join(fixture.jobsDir,job.id)).then(()=>true,()=>false),false);
  assert.equal((await call('GET',`jobs/${job.id}/log`)).status,404);
  const active=await enqueue({...base,prompt:'slow',count:1});await waitFor(()=>store.getJob(active.id)?.status==='running');
  assert.equal((await call('POST',`jobs/${active.id}/dismiss`,{})).status,409);
  await call('POST','jobs/clear',{});assert.ok(store.listJobs().some(j=>j.id===active.id));assert.ok(store.listJobs().every(j=>['queued','running'].includes(j.status)));
  await call('POST',`jobs/${active.id}/cancel`,{});await delay(1000);
  await call('POST',`jobs/${active.id}/dismiss`,{});assert.ok(!store.listJobs().some(j=>j.id===active.id));
});
test('pipeline adapter settings remain authoritative over per-request adapter fields',async()=>{
  const pipeline=factoryPipeline('video');
  const model=(pipeline.graph.stages as import('../src/lib/vpipe').Stage[]).find(s=>s.type==='minimax-h3-model-config')!.config;
  Object.assign(model,{lora:'local/custom',lora_scale:.5,lora2:'local/identity.safetensors',lora2_scale:.7});
  const input={request:{...base,mode:'video' as const,pipeline,adapters:{primary:'ignored',primaryWeight:0,secondary:'',secondaryWeight:0}},prompt:'subject',seed:1,width:480,height:640,output:'/tmp/output.mp4',directory:'/tmp',references:[]};
  const result=(await buildPipeline(input)).stages.find(s=>s.type==='minimax-h3-model-config')!.config;
  assert.equal(result.lora,'local/custom');assert.equal(result.lora_scale,.5);assert.equal(result.lora2,'local/identity.safetensors');assert.equal(result.lora2_scale,.7);
});
test('telemetry uses real utilization, handles missing/stale samples and parses explicit progress',()=>{
  assert.equal(parseGpuSample('{"gpu_active_pct":37.25}',123).busy,37.25);
  for(const s of ['{}','{"gpu_active_pct":null}','{"gpu_active_pct":-1}','{"gpu_active_pct":200}','{"gpu_active_pct":"38"}','bad'])assert.equal(parseGpuSample(s).busy,null);
  store.setValue('gpuHistory',[{at:Date.now()-20000,busy:67}]);assert.equal(telemetry().busy,null);
  store.setValue('gpuHistory',[{at:Date.now(),busy:67}]);assert.equal(telemetry().busy,67);
  assert.deepEqual(parseStepProgress("GenerateVideoStage('generate-video'): step 3/8 sigma 0.5"),{current:3,total:8});
  assert.deepEqual(parseStepProgress("[PROGRESS] 30% of 'denoise' completed at 15:38:23 (500/1500)"),{current:30,total:100,label:'Denoising'});
  assert.deepEqual(parseStepProgress("[PROGRESS] 20% of 'weights.safetensors' completed at 15:38:23 (100/500)"),{current:20,total:100,label:'weights.safetensors'});
  assert.equal(parseStepProgress('GPU 93% elapsed 80 seconds'),undefined);
});
test('720p enhancement preserves portrait and ultrawide shapes within export limits',()=>{
  assert.deepEqual(hdDimensions(480,640),{width:720,height:960});
  assert.deepEqual(hdDimensions(854,480),{width:1282,height:720});
  assert.deepEqual(hdDimensions(1280,240),{width:1920,height:360});
  assert.throws(()=>hdDimensions(1280,720),/already HD/);
});


test('worker publishes native progress and GPU samples during a running job',async()=>{
  store.setValue('gpuHistory',[]);
  const job=await enqueue({...base,prompt:'slow',count:1});
  await waitFor(()=>store.getJob(job.id)?.step?.current===30);
  assert.equal(store.getJob(job.id)?.step?.label,'Denoising');
  await waitFor(()=>store.getValue<{busy:number}[]>('gpuHistory',[]).some(s=>s.busy===31.5));
  const t=await (await call('GET','telemetry')).json();assert.equal(t.busy,31.5);assert.ok(t.samples.length);
  await call('POST',`jobs/${job.id}/cancel`,{});await delay(1000);
});


test('one-click image animation uses the saved image context with local Ollama and stores both motion prompts',async()=>{
  const source=await upload();store.saveMedia({...source,prompt:'A paper boat',enhancedPrompt:'A blue paper boat on a pond'});
  const job=await enqueue({...base,mode:'video',sourceId:source.id,videoStyle:'fun',prompt:'',enhance:true,count:1});await complete(job);
  const call=motionCalls.at(-1)!;
  assert.equal(call.keep_alive,0);assert.match(call.messages[0].content,/Preserve the requested motion/);assert.match(call.messages[1].content,/playful, exaggerated movement/);assert.match(call.messages[1].content,/A blue paper boat on a pond/);
  const result=store.listMedia().find(m=>m.jobId===job.id&&m.kind==='video')!;
  assert.equal(result.prompt,'');assert.equal(result.videoStyle,'fun');assert.match(result.enhancedPrompt,/twirls playfully/);assert.ok(!result.enhancedPrompt.includes('<think>'));
  assert.ok(result.favorite);assert.ok(store.getMedia(source.id)?.favorite);assert.equal(result.sourceId,source.id);
  const pipeline=JSON.parse(await fs.readFile(path.join(fixture.directory,'jobs',job.id,'0','pipeline.vpipeline'),'utf8'));
  assert.equal(pipeline.stages.find((s:{id:string})=>s.id==='text-prompt').config.text,result.enhancedPrompt);
});
test('unavailable Ollama falls back to the selected style while retaining custom direction',async()=>{
  const source=await upload();
  const prompt='force-motion-fallback: gently pan left';
  const job=await enqueue({...base,mode:'video',sourceId:source.id,videoStyle:'custom',prompt,enhance:true,count:1});await complete(job);
  const result=store.listMedia().find(m=>m.jobId===job.id&&m.kind==='video')!;
  assert.equal(result.prompt,prompt);assert.equal(result.videoStyle,'custom');assert.equal(result.enhancedPrompt,prompt);
  const log=await (await call('GET',`jobs/${job.id}/log`)).json();assert.match(log.log,/Using your original prompt and motion direction/);
  const natural=await enqueue({...base,mode:'video',sourceId:source.id,videoStyle:'normal',prompt:'',enhance:false,count:1});await complete(natural);
  assert.match(store.listMedia().find(m=>m.jobId===natural.id&&m.kind==='video')!.enhancedPrompt,/basic movement, no fast camera changes/);
});


test('generation and retry keep a pipeline snapshot and ignore browser adapter overrides',async()=>{
  const blocker=await enqueue({...base,prompt:'slow',count:1});await waitFor(()=>store.getJob(blocker.id)?.status==='running');
  const jobs:Job[]=[];
  try{
    const attempted={primary:'local/ignored',primaryWeight:.1,secondary:'',secondaryWeight:0};
    assert.equal((await call('PATCH','settings',{videoAdapters:attempted})).status,400);
    const job=await enqueue({...base,mode:'video',count:1,adapters:attempted});jobs.push(job);assert.ok(job.request.pipeline);assert.equal((job.request as Generation).adapters,undefined);
    await call('POST',`jobs/${job.id}/cancel`,{});
    const response=await call('POST',`jobs/${job.id}/retry`,{});assert.equal(response.status,201);const retry=(await response.json()).job;jobs.push(retry);assert.deepEqual(retry.request.pipeline,job.request.pipeline);
  }finally{for(const job of [...jobs,blocker])if(['queued','running'].includes(store.getJob(job.id)!.status))await call('POST',`jobs/${job.id}/cancel`,{});}
});
test('video variations always use the root image and group with sibling renders',async()=>{
  const source=await upload();
  const first=await enqueue({...base,mode:'video',sourceId:source.id,prompt:'',videoStyle:'custom',count:1});await complete(first);
  const video=store.listMedia().find(m=>m.jobId===first.id&&m.kind==='video')!;
  assert.equal(video.videoStyle,'normal');
  const next=await enqueue({...base,mode:'video',sourceId:source.id,prompt:'Drift gently to the left',enhance:true,count:1});await complete(next);
  const result=store.listMedia().find(m=>m.jobId===next.id&&m.kind==='video')!;
  assert.equal(result.rootId,source.id);assert.equal('fromVideoId' in result.generation!,false);assert.equal(result.prompt,'Drift gently to the left');
  const firstPixels=await sharp(path.join(fixture.directory,'jobs',first.id,'starting-frame.png')).raw().toBuffer();
  const nextPixels=await sharp(path.join(fixture.directory,'jobs',next.id,'starting-frame.png')).raw().toBuffer();
  assert.deepEqual(nextPixels,firstPixels);
  await assert.rejects(fs.access(path.join(fixture.directory,'jobs',next.id,'previous-first-frame.png')));
  const family=await (await call('GET',`media/${result.id}/family`)).json();
  assert.equal(family.root.id,source.id);assert.deepEqual(family.renders.map((r:{media:Media})=>r.media.id),[video.id,result.id]);

});
