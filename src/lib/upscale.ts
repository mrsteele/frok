import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { mediaDir, ffmpeg, ffprobe, upscalerDir, upscalerBin, upscalerModels, jobTimeoutMs } from './config';
import { download } from './download';
import { runProcess } from './process';
import { hdDimensions } from './validation';
import { seedvr2Ready, seedvr2Supported, upscaleSeedvr2 } from './seedvr2';
import type { Media, Upscaler } from './types';

export const upscaleModel = 'realesrgan-x4plus';
export function upscalerSupported(engine:Upscaler='realesrgan') {
  if(engine==='seedvr2')return seedvr2Supported();
  return process.platform==='darwin'&&['arm64','x64'].includes(process.arch) || ['linux','win32'].includes(process.platform)&&process.arch==='x64';
}
export async function upscalerReady(engine:Upscaler='realesrgan') {
  if(engine==='seedvr2')return seedvr2Ready();
  try {
    await fs.access(upscalerBin(),process.platform==='win32'?constants.F_OK:constants.X_OK);
    for(const extension of ['bin','param']) if(!(await fs.stat(path.join(upscalerModels(),`${upscaleModel}.${extension}`))).size)return false;
    return true;
  } catch { return false; }
}
export async function installUpscaler(signal: AbortSignal, log: (line:string)=>void) {
  if(await upscalerReady()){log('AI video enhancement is already ready.\n');return;}
  if(!upscalerSupported())throw new Error('Set REALESRGAN_BIN and REALESRGAN_MODEL_DIR to a compatible local build for your platform.');
  const platform=process.platform==='darwin'?'macos':process.platform==='win32'?'windows':'ubuntu';
  const name=`realesrgan-ncnn-vulkan-20220424-${platform}.zip`;
  await fs.mkdir(upscalerDir,{recursive:true});
  const archive=path.join(upscalerDir,name);
  log('Downloading the official Real-ESRGAN runtime and neural upscaling models into this project…\n');
  await download(`https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/${name}`,archive,signal,log);
  const unpack=await fs.mkdtemp(path.join(upscalerDir,'unpack-'));
  try {
    if(process.platform==='darwin') await runProcess('ditto',['-xk',archive,unpack],{signal,onLog:log});
    else if(process.platform==='win32') await runProcess('powershell.exe',['-NoProfile','-NonInteractive','-Command','Expand-Archive -LiteralPath $env:FROK_UPSCALE_ARCHIVE -DestinationPath $env:FROK_UPSCALE_UNPACK -Force'],{signal,onLog:log,env:{...process.env,FROK_UPSCALE_ARCHIVE:archive,FROK_UPSCALE_UNPACK:unpack}});
    else await runProcess('unzip',['-q','-o',archive,'-d',unpack],{signal,onLog:log});
    async function findBinary(dir:string,depth=0):Promise<string|undefined> {
      for(const entry of await fs.readdir(dir,{withFileTypes:true})) {
        if(entry.isFile()&&entry.name===`realesrgan-ncnn-vulkan${process.platform==='win32'?'.exe':''}`)return path.join(dir,entry.name);
        if(entry.isDirectory()&&depth<4){const found=await findBinary(path.join(dir,entry.name),depth+1);if(found)return found;}
      }
    }
    const binary=await findBinary(unpack);if(!binary)throw new Error('The upscaler archive did not contain its runtime.');
    await fs.cp(path.dirname(binary),path.join(upscalerDir,'runtime'),{recursive:true});
    if(process.platform!=='win32')await fs.chmod(path.join(upscalerDir,'runtime','realesrgan-ncnn-vulkan'),0o755);
    if(!await upscalerReady())throw new Error('AI upscaler setup is incomplete. Check the runtime and realesrgan-x4plus model files.');
    log('Real-ESRGAN is ready for AI video enhancement.\n');
  } finally {await fs.rm(unpack,{recursive:true,force:true});}
}

export async function upscaleVideo(source:Media,output:string,directory:string,signal:AbortSignal,log:(line:string)=>void,onProgress:(done:number,total:number,message?:string)=>void,engine:Upscaler='realesrgan',seed=source.seed) {
  if(engine==='seedvr2')return upscaleSeedvr2(source,output,directory,signal,log,onProgress,seed);
  if(!await upscalerReady())throw new Error('Set up AI video enhancement in Settings before upscaling.');
  const input=path.join(mediaDir(),source.filename),frames=path.join(directory,'sd-frames'),enhanced=path.join(directory,'ai-frames');
  const target=hdDimensions(source.width,source.height);
  const metadata=JSON.parse(await runProcess(ffprobe(),['-v','error','-show_streams','-show_format','-of','json',input],{signal}));
  const video=metadata.streams.find((s:{codec_type:string})=>s.codec_type==='video');
  const fps=String(video?.avg_frame_rate || video?.r_frame_rate || '24/1');
  const [numerator,denominator=1]=fps.split('/').map(Number);
  const rate=numerator/denominator,duration=Number(metadata.format.duration);
  if(!Number.isFinite(rate)||rate<=0||rate>120||!Number.isFinite(duration)||duration<=0||duration>60)throw new Error('AI enhancement supports videos up to 60 seconds and 120 fps.');
  await fs.mkdir(frames,{recursive:true});await fs.mkdir(enhanced,{recursive:true});
  try {
    log('Extracting video frames for neural enhancement…\n');
    await runProcess(ffmpeg(),['-hide_banner','-y','-i',input,'-map','0:v:0','-vsync','0',path.join(frames,'%08d.png')],{signal,onLog:log});
    const names=(await fs.readdir(frames)).filter(name=>/^\d{8}\.png$/.test(name)).sort();
    if(!names.length)throw new Error('The source video has no frames.');
    onProgress(0,names.length);
    let last=0,poll:Promise<void>|undefined;
    const sample=async()=>{const count=(await fs.readdir(enhanced)).filter(name=>/^\d{8}\.png$/.test(name)).length;if(count!==last){last=count;onProgress(count,names.length);}};
    const timer=setInterval(()=>{if(!poll)poll=sample().catch(()=>{}).finally(()=>{poll=undefined;});},750);
    try {
      // Bounded tiles and a single inference thread keep unified-memory use predictable.
      await runProcess(upscalerBin(),['-i',frames,'-o',enhanced,'-n',upscaleModel,'-s','4','-t','128','-m',upscalerModels(),'-j','1:1:1','-f','png'],{signal,onLog:log,timeout:jobTimeoutMs()});
    } finally {clearInterval(timer);await poll;}
    const saved=new Set(await fs.readdir(enhanced));
    for(const name of names)if(!saved.has(name)||!(await fs.stat(path.join(enhanced,name))).size)throw new Error('The AI upscaler did not finish every frame.');
    onProgress(names.length,names.length);
    log('Saving the enhanced video with its original audio…\n');
    await runProcess(ffmpeg(),['-hide_banner','-y','-framerate',fps,'-start_number','1','-i',path.join(enhanced,'%08d.png'),'-i',input,'-map','0:v:0','-map','1:a?','-vf',`scale=${target.width}:${target.height}:flags=lanczos`,'-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','copy','-t',String(duration),'-movflags','+faststart',output],{signal,onLog:log});
  } finally {await fs.rm(frames,{recursive:true,force:true});await fs.rm(enhanced,{recursive:true,force:true});}
}
