import fs from 'node:fs/promises';
import path from 'node:path';
import { ffmpeg, ffprobe } from './config';
import { runProcess } from './process';
import type { PipelineMetadata } from './pipelines/schema';
import type { RenderInput } from './providers/types';

export function upscaleGeometry(width:number,height:number,frames:number,alignment?:PipelineMetadata['upscale']) {
  const {spatialMultiple=1,frameStride=1,frameOffset=0,minimumFrames=1,extraFrames=0}=alignment??{};
  return {width:Math.ceil(width/spatialMultiple)*spatialMultiple,height:Math.ceil(height/spatialMultiple)*spatialMultiple,
    frames:Math.ceil((Math.max(minimumFrames,frames+extraFrames)-frameOffset)/frameStride)*frameStride+frameOffset};
}

async function videoInfo(file:string,signal:AbortSignal) {
  const result=JSON.parse(await runProcess(ffprobe(),['-v','error','-select_streams','v:0','-count_frames','-show_entries','stream=width,height,avg_frame_rate,nb_read_frames','-of','json',file],{signal}));
  const stream=result.streams?.[0],rate=String(stream?.avg_frame_rate??'').split('/').map(Number);
  const fps=rate[0]/(rate[1]??1),frames=Number(stream?.nb_read_frames);
  if(!Number.isFinite(fps)||fps<=0||fps>240||!Number.isSafeInteger(frames)||frames<1)throw Error('Cannot determine the video’s frame rate and frame count for native upscaling.');
  return {width:Number(stream.width),height:Number(stream.height),fps,frames};
}

// Native restorers lose timing sidebands. Supply the source rate explicitly and
// pad without cropping. FlashVSR 0.1.51 decodes four fewer frames than its 8k+1
// input; cloned end frames provide context without dropping the end of the take.
export async function prepareNativeUpscale(input:RenderInput) {
  if(!input.source||!input.request.pipeline?.metadata.videoSource)throw Error('Native upscaling requires a source video.');
  const source=await videoInfo(input.source,input.signal);
  const geometry=upscaleGeometry(input.width,input.height,source.frames,input.request.pipeline.metadata.upscale);
  if(geometry.width*geometry.height*geometry.frames*3>8*1024**3)throw Error('This clip is too large for the native upscaling workflow. Use a shorter clip or a ComfyUI upscaler.');
  const directory=await fs.mkdtemp(path.join(input.directory,'upscale-'));
  const prepared=path.join(directory,'input.mp4'),output=path.join(directory,'restored.mp4');
  input.log(`Preparing ${source.frames} frames at ${source.fps.toFixed(3)} fps for ${input.request.pipeline.metadata.name}…\n`);
  const filters=[`scale=${input.width}:${input.height}:flags=bicubic`,`pad=${geometry.width}:${geometry.height}:0:0`,
    `tpad=stop_mode=clone:stop=${geometry.frames-source.frames}`,`setpts=N/(${source.fps}*TB)`];
  await runProcess(ffmpeg(),['-hide_banner','-y','-i',input.source,'-map','0:v:0','-an','-vf',filters.join(','),'-frames:v',String(geometry.frames),'-r',String(source.fps),'-c:v','libx264','-preset','ultrafast','-crf','0','-pix_fmt','yuv420p',prepared],{signal:input.signal,onLog:input.log});
  return {input:{...input,...geometry,fps:source.fps,source:prepared,output},source,directory};
}

export async function finishNativeUpscale(prepared:Awaited<ReturnType<typeof prepareNativeUpscale>>,original:RenderInput) {
  const result=await videoInfo(prepared.input.output,original.signal);
  if(result.width!==prepared.input.width||result.height!==prepared.input.height||result.frames<prepared.source.frames)
    throw Error('The native upscaler returned incomplete frames or unexpected dimensions. Check the job log and Vpipe version.');
  if(Math.abs(result.fps-prepared.source.fps)>0.01)throw Error('The native upscaler did not preserve the source frame rate. Check its fps binding.');
  await runProcess(ffmpeg(),['-hide_banner','-y','-i',prepared.input.output,'-map','0:v:0','-an','-vf',`crop=${original.width}:${original.height}:0:0,setpts=N/(${prepared.source.fps}*TB)`,
    '-frames:v',String(prepared.source.frames),'-r',String(prepared.source.fps),'-c:v','libx264','-preset','ultrafast','-crf','0','-pix_fmt','yuv420p',original.output],{signal:original.signal,onLog:original.log});
  await fs.rm(prepared.directory,{recursive:true,force:true});
}
