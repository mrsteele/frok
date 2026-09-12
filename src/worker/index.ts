import { mediaToolsStatus } from '../lib/media-tool-status';
import { recoverInterruptedLibraryReset } from '../lib/library-reset';
import { cleanupExpiredJobs } from '../lib/job-deletion';
import { preparePipeline } from '../lib/pipelines/prepare';
import { WorkerControl } from '../../desktop/worker-control.mjs';
import { workerProtocolVersion } from '../lib/worker-health';
import { pipelineStatus } from '../lib/pipelines/catalog';
import fs from "node:fs/promises";
import { createWriteStream, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import sharp from "sharp";
import { mediaDir, jobsDir, ffmpeg, ffprobe, dataDir } from "../lib/config";
import { db, listJobs, resumeInterruptedJob, getJob, getMedia, favoriteMedia, updateJob, mediaRoot } from "../lib/db";
import { publishMedia } from '../lib/media-publication';
import { registry, serviceValue as getValue, setServiceValue as setValue, activeOperations, endOperation, isAlive } from '../lib/registry';
import { libraryDatabase, closeLibraryDatabase } from '../lib/library';
import { claimNextJob } from '../lib/worker-queue';
import { dimensions } from "../lib/validation";
import { prepareGenerationPrompts } from "../lib/generation-prompt";
import { generationSeeds } from "../lib/generation-seeds";
import { recoverJobTimes } from "../lib/recover-job-times";
import { upscaleVideo } from "../lib/upscale";
import { renderVpipe } from "../lib/vpipe";
import { renderComfy } from "../lib/comfyui";
import { runProcess } from "../lib/process";
import { runSetup } from "../lib/setup";
import { activateVerifiedPrompt } from '../lib/connection-setup';
import { sampleGpu } from '../lib/telemetry';
import { tracksVideoStages, parseProgressLog, preparingVideoProgress, finishingVideoProgress, completedVideoProgress, videoPhaseLabel } from '../lib/progress';
import type { Job, Generation, Media, SetupRequest } from "../lib/types";
// An OS pid plus SQLite lock prevents two workers sharing the same queue/GPU.
// During an upgrade, the previous worker still records its PID in the legacy DB.
const legacyPath=path.join(dataDir,'frok.sqlite');
if(!getValue('singleLibraryVersion',0)&&existsSync(legacyPath)) {
  const legacy=new DatabaseSync(legacyPath,{readOnly:true});
  let legacyAlive=false;
  try { const row=legacy.prepare("SELECT value FROM settings WHERE key='workerPid'").get() as {value:string}|undefined;legacyAlive=!!row&&isAlive(JSON.parse(row.value)); }
  finally { legacy.close(); }
  if(legacyAlive){console.error('Stop the existing Frok worker before starting the upgraded app.');process.exit(1);}
}
registry.exec("BEGIN IMMEDIATE");
const operations=activeOperations();
const prior=getValue<number>("workerPid",0);
const lastWorkerHeartbeat=getValue<number>("workerHeartbeat",0);
if(isAlive(prior)||(getValue('maintenance',false)&&!getValue('libraryResetPending',false))||operations.some(row=>row.kind==='delete'||row.kind==='export')){registry.exec("COMMIT");console.error("Frok worker is already running or maintenance is in progress.");process.exit(1);}
setValue("workerPid",process.pid);setValue("workerHeartbeat",Date.now());setValue('workerProtocol',{pid:process.pid,version:workerProtocolVersion});registry.exec("COMMIT");
await recoverInterruptedLibraryReset();
libraryDatabase();
for(const job of listJobs().filter(j=>j.status==="running")) {
  // The last heartbeat bounds an interrupted run; time with the app stopped is not processing time.
  const lastSeen=Math.min(Date.now(),Math.max(lastWorkerHeartbeat,Date.parse(job.updatedAt)));
  if(job.pauseRequested){resumeInterruptedJob(job.id,(job.accumulatedSeconds||0)+Math.max(0,(lastSeen-Date.parse(job.startedAt||job.updatedAt))/1000));continue;}
  updateJob(job.id,{status:"failed",finishedAt:new Date(lastSeen).toISOString(),error:"Generation was interrupted by an app restart. Completed images were kept; retry to continue.",message:"Interrupted by restart"});
}
let activeJobId: string|undefined;
let stopping=false;let active:AbortController|undefined;
const stop=()=>{stopping=true;active?.abort();};process.on("SIGTERM",stop);process.on("SIGINT",stop);
const desktopControl=new WorkerControl();
function reportDesktopQueue(){
  if(!process.connected||!process.send)return;
  const count=db.prepare("SELECT COUNT(*) AS total FROM jobs WHERE status='queued'").get() as {total:number};
  process.send({type:'queue-state',running:!!activeJobId,queued:count.total,draining:desktopControl.draining});
}
process.on('message',message=>{if(desktopControl.accept(message))stop();reportDesktopQueue();});
if(process.send)process.on('disconnect',stop);
let sampling=false;
const gpuTimer=setInterval(()=>{if(active&&!sampling){sampling=true;void sampleGpu().catch(()=>{}).finally(()=>{sampling=false;});}},3000);
const heartbeat=setInterval(()=>{setValue("workerHeartbeat",Date.now());reportDesktopQueue();},3000);
reportDesktopQueue();
console.log(`Frok generation worker ready · ${dataDir}`);
let cleaning: Promise<unknown> | undefined;
function cleanJobs() {
  if (stopping || cleaning) return;
  cleaning = cleanupExpiredJobs().catch(error => { if (error?.status !== 409) console.error('Job cleanup will retry:', error.message); }).finally(() => { cleaning = undefined; });
}
const cleanupTimer = setInterval(cleanJobs, 60_000);


async function generate(job:Job,signal:AbortSignal,log:(s:string)=>void,onFinishingVideo:()=>void) {
  const request=job.request as Generation;
  if(request.pipeline)log(`Pipeline: ${request.pipeline.metadata.name} · ${request.pipeline.revision.slice(0,12)}\n`);
  else if(job.runner==='vpipe' && ['video','reference'].includes(request.mode))log('Video attention: SOL (Vpipe 0.1.46+)\n');
  const source=request.sourceId?getMedia(request.sourceId):undefined;
  const video=request.mode!=="image";
  if(video){const tools=await mediaToolsStatus({ffmpeg:ffmpeg(),ffprobe:ffprobe()},signal);if(!tools.ready)throw new Error(tools.detail);}
  const dir=path.join(jobsDir(),job.id);await fs.mkdir(dir,{recursive:true});
  if((job.request as Generation).pipeline){const state=await pipelineStatus((job.request as Generation).pipeline!);if(!state.ready)throw Error(state.detail);}
  const prompts=await prepareGenerationPrompts(request,source,signal,{
    enhancing:style=>updateJob(job.id,{message:style?`Planning ${request.videoPreset?.name || style} motion…`:request.mode==='image'&&request.count>1?`Planning ${request.count} image variations…`:"Adding detail to your prompt…"}),
    fallback:error=>log(`${(error as Error).message} ${request.mode==='image'?"Using your original prompt with different seeds.":"Using your original prompt and motion direction."}\n`),
  });
  const refs=request.referenceIds.map(id=>getMedia(id)!);
  const {width,height,outputWidth,outputHeight}=dimensions(request.aspect,request.quality,video,source?.kind==="image"?source:undefined);
  let sourcePath:string|undefined;
  if(source?.kind==="image"){
    sourcePath=path.join(dir,"starting-frame.png");
    const anchor=path.join(mediaDir(),source.filename);
    await sharp(anchor).resize(outputWidth,outputHeight,{fit:"contain",background:"#000000",withoutEnlargement:true}).extend({top:Math.floor((height-outputHeight)/4)*2,bottom:height-outputHeight-Math.floor((height-outputHeight)/4)*2,left:Math.floor((width-outputWidth)/4)*2,right:width-outputWidth-Math.floor((width-outputWidth)/4)*2,background:"#000000"}).png().toFile(sourcePath);
  }
  const count=request.mode==="image"?request.count:1;
  const seeds=generationSeeds(count,request.seed);
  for(let i=job.completed;i<count;i++){
    signal.throwIfAborted();
    const outputStarted=performance.now();
    const {prompt,videoStyle,promptTrace}=prompts[i];
    const id=randomUUID(),seed=seeds[i];
    const itemDir=path.join(dir,String(i));await fs.mkdir(itemDir,{recursive:true});
    const raw=path.join(itemDir,video?"raw.mp4":"raw.jpeg");
    const filename=`${id}.${video?"mp4":"jpg"}`;const output=path.join(itemDir,`finished.${video?"mp4":"jpg"}`);
    updateJob(job.id,{step:null,message:request.mode==="upscale"?"Enhancing video to 720p…":video?"Rendering your video…":`Creating image ${i+1} of ${count}…`});
    let runnerSeconds:number|undefined;
    if(request.mode==="upscale") {
      if(!source||source.kind!=="video")throw new Error("Choose an existing video to upscale.");
      await upscaleVideo(source,output,itemDir,signal,log,(done,total,message)=>updateJob(job.id,{step:{current:Math.round(done/total*100),total:100,label:'AI upscaling'},message:message||`Enhancing frame ${done} of ${total}`}),request.upscaler,seed);
    } else {
      const render=job.runner==="vpipe"?renderVpipe:renderComfy;
      const previousRunnerSeconds=getJob(job.id)?.runnerSeconds || 0;
      await render({request,prompt,seed,width,height,output:raw,directory:itemDir,source:sourcePath,references:refs.map(r=>path.join(mediaDir(),r.filename)),signal,log,waitForStop:()=>!!getJob(job.id)?.pauseRequested,onRuntime:(seconds:number)=>{runnerSeconds=seconds;updateJob(job.id,{runnerSeconds:previousRunnerSeconds+seconds});}});
      signal.throwIfAborted();
      if(video) {
        onFinishingVideo();
        // H3 runs on a 17n+5 grid. Trim the extra frames to the exact selected duration.
        await runProcess(ffmpeg(),["-hide_banner","-y","-i",raw,"-vf",`crop=${outputWidth}:${outputHeight}`,"-t",String(request.duration),"-map","0:v:0","-map","0:a?","-c:v","libx264","-preset","fast","-crf","18","-pix_fmt","yuv420p","-c:a","aac","-movflags","+faststart",output],{signal,onLog:log});
      }else{await sharp(raw).jpeg({quality:94}).toFile(output);}
    }
    signal.throwIfAborted();
    let actualWidth=width,actualHeight=height,duration:number|undefined;
    if(video){
      const metadata=JSON.parse(await runProcess(ffprobe(),["-v","error","-show_streams","-show_format","-of","json",output],{signal}));
      const stream=metadata.streams.find((s:{codec_type:string})=>s.codec_type==="video");if(!stream)throw new Error("Runner output has no video stream.");
      actualWidth=stream.width;actualHeight=stream.height;duration=Number(metadata.format.duration);
      if(Math.abs(duration!-(request.mode==="upscale"?source!.duration!:request.duration))>0.15)throw new Error(`Runner produced ${duration?.toFixed(2)}s instead of ${request.duration}s. Inspect job log.`);
    }else{const m=await sharp(output).metadata();actualWidth=m.width;actualHeight=m.height;}
    signal.throwIfAborted();
    const sourceId=source?.id;
    if(video){if(sourceId)favoriteMedia(sourceId,true);refs.filter(r=>!r.referenceOnly).forEach(r=>favoriteMedia(r.id,true));}
    const media:Media={id,...(!video&&request.imageModel?{imageModel:request.imageModel}:{}),batchIndex:i,promptTrace,runnerSeconds,elapsedSeconds:(performance.now()-outputStarted)/1000,rootId:video?(request.mode==="upscale"?mediaRoot(source!.id)?.id:request.rootId || sourceId || id):undefined,generation:request.mode==="upscale"?source?.generation:structuredClone(request),videoStyle:request.mode==="upscale"?source?.videoStyle:videoStyle,kind:video?"video":"image",filename,prompt:request.mode==="upscale"?source!.prompt:request.prompt,enhancedPrompt:prompt,width:actualWidth,height:actualHeight,duration,seed,favorite:video,sourceId,createdAt:new Date().toISOString(),jobId:job.id,origin:request.mode==="upscale"?"upscale":"generated",runner:job.runner,upscaler:request.mode==='upscale'?(request.upscaler||'realesrgan'):undefined,quality:request.mode==="upscale"?(Math.min(actualWidth,actualHeight)>=720?`HD 720p · ${request.upscaler==='seedvr2'?'SeedVR2':'Real-ESRGAN'}`:`AI enhanced · ${request.upscaler==='seedvr2'?'SeedVR2':'Real-ESRGAN'}`):request.quality};
    publishMedia(media,output);updateJob(job.id,{step:null,completed:i+1,message:video?"Video saved to favorites":`${i+1} of ${count} images ready`});
    await fs.rm(raw,{force:true});
  }
}

try {
  await recoverJobTimes(db,jobsDir());
  cleanJobs();
  while(!stopping){
    if(!desktopControl.mayClaim){await delay(100);continue;}
    await recoverInterruptedLibraryReset();
    const claimed=claimNextJob();if(!claimed){await delay(700);continue;}
    const {job,operation}=claimed;activeJobId=job.id;reportDesktopQueue();
    try {
    const jobStarted=performance.now();
    active=new AbortController();const signal=active.signal;
    let videoProgress=tracksVideoStages(job)&&job.runner==='vpipe'?preparingVideoProgress():undefined;
    if(videoProgress)updateJob(job.id,{videoProgress});
    const cancel=setInterval(()=>{if((getJob(job.id)?.status==="cancelled"||getJob(job.id)?.pauseRequested)||getValue('maintenance',false))active?.abort();},500);
    const dir=path.join(jobsDir(),job.id);await fs.mkdir(dir,{recursive:true});
    const stream=createWriteStream(path.join(dir,"runner.log"),{flags:"a"});let last=0;let pendingLog="";
    const log=(text:string)=>{
      const clean=text.replace(/hf_[A-Za-z0-9]+/g,"[redacted]");stream.write(clean);
      pendingLog=(pendingLog+clean).slice(-8000);
      const lines=pendingLog.split(/[\r\n]/);pendingLog=lines.pop()||'';
      const parsed=parseProgressLog(lines.join('\n'),videoProgress);
      const step=job.kind==='generate'&&(job.request as Generation).mode==='upscale'?undefined:parsed.step;videoProgress=parsed.videoProgress;
      if(step)updateJob(job.id,{step,...(videoProgress?{videoProgress,...(videoProgress.phase!=='preparing'?{message:videoPhaseLabel(videoProgress)}:{})}:{}),...(job.kind==='setup'&&step.label?{message:`${step.label} · ${step.current}%`}:{})});
      else if(job.kind==='setup'&&Date.now()-last>800){
        updateJob(job.id,{message:lines.filter(Boolean).at(-1)?.slice(-250)||"Preparing models…"});last=Date.now();
      }
    };
    try {
      if(job.kind==="setup"){const request=job.request as SetupRequest;if(request.pipeline)await preparePipeline(request.pipeline,dir,signal,log);else await runSetup(request.task,signal,log,request.ollama);}else await generate(job,signal,log,()=>{
        videoProgress=finishingVideoProgress();
        updateJob(job.id,{step:null,videoProgress,message:"Finishing video and saving audio…"});
      });
      signal.throwIfAborted();
      if(job.kind==='setup')activateVerifiedPrompt(job);
      updateJob(job.id,{status:"completed",elapsedSeconds:(job.accumulatedSeconds||0)+(performance.now()-jobStarted)/1000,completed:job.total,...(tracksVideoStages(job)?{videoProgress:completedVideoProgress()}:{}),message:job.kind==="setup"?"Setup step complete":"All done"});
    }catch(e){
      const current=getJob(job.id),cancelled=signal.aborted||current?.status==="cancelled";
      if(current?.pauseRequested&&current.status==='running'){log('Paused; remaining outputs will resume after the selected job.\n');resumeInterruptedJob(job.id,(job.accumulatedSeconds||0)+(performance.now()-jobStarted)/1000);}
      else {
      const message=(e as Error).message||String(e);log(`${cancelled?"Cancelled":message}\n`);
      updateJob(job.id,{status:cancelled?"cancelled":"failed",elapsedSeconds:current?.status==="cancelled"?current.elapsedSeconds:(job.accumulatedSeconds||0)+(performance.now()-jobStarted)/1000,error:cancelled?undefined:message,message:cancelled?"Stopped":"Needs attention"});
      }
    }
    finally{clearInterval(cancel);await new Promise<void>(resolve=>stream.end(resolve));active=undefined;}
    } finally { active=undefined;activeJobId=undefined;while(sampling)await delay(30);endOperation(operation);setValue('activeJob',null);reportDesktopQueue(); }
  }
} finally {clearInterval(cleanupTimer);await cleaning;clearInterval(heartbeat);clearInterval(gpuTimer);while(sampling)await delay(50);setValue("workerHeartbeat",0);setValue("workerPid",0);closeLibraryDatabase();registry.close();}
