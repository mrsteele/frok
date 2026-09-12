import fs from 'node:fs/promises';
import path from 'node:path';
import { comfyFetch, comfyIsolationIssue } from './comfyui';
import { expandPath } from './config';
import { settings } from './db';
import { zImageFiles, imageNodes } from './image-model-files';
import type { ImageHealth } from './types';

export async function zImageStatus(signal?: AbortSignal): Promise<ImageHealth> {
  const result: ImageHealth = {model:'z-image-turbo',runner:'comfyui',connected:false,ready:false,detail:''};
  const issue=comfyIsolationIssue();
  if(issue)return {...result,detail:issue};
  let info: Record<string, {input?:{required?:Record<string,unknown[]>;optional?:Record<string,unknown[]>}}>;
  try { info=await (await comfyFetch('/object_info',{signal})).json(); }
  catch { return {...result,detail:'Connect the protected ComfyUI service to use Z-Image-Turbo.'}; }
  result.connected=true;
  const missingNodes=imageNodes('z-image-turbo').filter(node=>!info[node]);
  if(missingNodes.length)return {...result,detail:`Update ComfyUI. Missing Z-Image nodes: ${missingNodes.join(', ')}.`};
  const choices=(node:string,input:string) => info[node]?.input?.required?.[input]?.[0] ?? info[node]?.input?.optional?.[input]?.[0];
  const has=(node:string,input:string,value:string) => {const values=choices(node,input);return Array.isArray(values)&&values.includes(value);};
  if(!has('CLIPLoader','type','lumina2')||!has('KSampler','sampler_name','res_multistep')||!has('KSampler','scheduler','simple'))return {...result,detail:'Update ComfyUI for Z-Image text encoding and sampling support.'};
  const directory=settings().comfyDir;
  if(!directory)return {...result,detail:'Choose your ComfyUI folder in Settings → Generate to verify Z-Image models.'};
  const missing:string[]=[];
  for(const file of zImageFiles) {
    const stat=await fs.stat(path.join(/* turbopackIgnore: true */ expandPath(directory),'models',file.directory,file.name)).catch(()=>undefined);
    if(!stat?.isFile()||stat.size!==file.size||!has(file.node,file.input,file.name))missing.push(file.name);
  }
  if(missing.length)return {...result,detail:`Download or repair Z-Image-Turbo’s model pack, then refresh ComfyUI’s model list. Missing or incomplete: ${missing.join(', ')}.`};
  return {...result,ready:true,detail:'Z-Image-Turbo, Qwen3 encoder and VAE are installed and available in ComfyUI.'};
}
