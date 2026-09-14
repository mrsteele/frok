import path from 'node:path';
import { ffmpeg, ffprobe, mediaDir } from './config';
import { runProcess } from './process';
import type { Media } from './types';

export function validateUpscaleOutput(source:Pick<Media,'width'|'height'|'duration'>,video:{width:number;height:number;duration:number}) {
  if(!Number.isFinite(video.width)||!Number.isFinite(video.height)||video.width<=source.width||video.height<=source.height)
    throw Error('The upscaling workflow did not increase the video dimensions. Check its output and resize settings.');
  if(Math.abs(video.width/video.height-source.width/source.height)>0.02)
    throw Error('The upscaling workflow changed the aspect ratio. Configure it to preserve the source proportions.');
  if(!Number.isFinite(video.duration)||!source.duration||Math.abs(video.duration-source.duration)>0.15)
    throw Error('The upscaling workflow changed the video length. Connect the original frame rate to its video output.');
}

// Enhancement happens in the service graph. Frok only validates its result and
// packages it for the player, retaining the original soundtrack when present.
export async function finishUpscale(source:Media,raw:string,output:string,signal:AbortSignal,log:(line:string)=>void) {
  const result=JSON.parse(await runProcess(ffprobe(),['-v','error','-show_streams','-show_format','-of','json',raw],{signal}));
  const stream=result.streams?.find((s:{codec_type:string})=>s.codec_type==='video');
  if(!stream)throw Error('The upscaling workflow produced no video.');
  validateUpscaleOutput(source,{width:stream.width,height:stream.height,duration:Number(result.format?.duration)});
  log('Saving the enhanced video with its original audio…\n');
  await runProcess(ffmpeg(),['-hide_banner','-y','-i',raw,'-i',path.join(mediaDir(),source.filename),'-map','0:v:0','-map','1:a?','-vf','pad=ceil(iw/2)*2:ceil(ih/2)*2','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-c:a','aac','-t',String(source.duration),'-movflags','+faststart',output],{signal,onLog:log});
}
