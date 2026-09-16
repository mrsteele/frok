import fs from 'node:fs/promises';
import path from 'node:path';
import { dependencySchema, type Dependency, type PipelineSnapshot } from './schema';
import { resolveModelAdapter, resolveVpipeModel } from '../model-access';
import { tensorFile, modelTensors } from '../model-tensors';
import { referenceModelStatus } from '../reference-model-status';
import { expandPath } from '../config';
import { settings } from '../db';
import type { Pipeline } from '../vpipe';
import type { Graph } from '../comfyui';

// Native loader inputs remain authoritative even when an administrator forgets
// to add a matching dependency declaration. Unknown origins cannot be downloaded.
export function comfyModelReference(node:Graph[string],field:string):string|undefined {
  const folders:Record<string,string>={ckpt_name:'checkpoints',unet_name:'diffusion_models',clip_name:'text_encoders',text_encoder:'text_encoders',vae_name:'vae',lora_name:'loras'};
  const folder=folders[field]||(node.class_type==='UpscaleModelLoader'&&field==='model_name'?'upscale_models':node.class_type==='LatentUpscaleModelLoader'&&field==='model_name'?'latent_upscale_models':/^SeedVR2Load(DiT|VAE)Model$/.test(node.class_type)&&field==='model'?'SEEDVR2':undefined);
  return folder&&typeof node.inputs[field]==='string'?`${folder}/${node.inputs[field]}`:undefined;
}
export function dependencies(snapshot:PipelineSnapshot):Dependency[] {
  const result=[...snapshot.metadata.dependencies];
  function add(kind:Dependency['kind'],reference:unknown){if(snapshot.metadata.runner==='vpipe'&&typeof reference==='string')reference=reference.replace(/^models\//,'');if(typeof reference==='string'&&reference&&!result.some(d=>d.reference===reference))result.push(dependencySchema.parse({kind,reference}));}
  if(snapshot.metadata.runner==='vpipe')for(const s of (snapshot.graph as unknown as Pipeline).stages){
    for(const key of ['hf_dir','dit_dir','encoder_dir'])add('model',s.config[key]);
    for(const key of ['lora','lora2'])add('lora',s.config[key]);
  }
  if(snapshot.metadata.runner==='comfyui')for(const s of Object.values(snapshot.graph as Graph)){
    for(const field of Object.keys(s.inputs)){const reference=comfyModelReference(s,field);if(reference)add('file',reference);}
  }
  return result;
}
export async function comfyFile(reference:string) {
  dependencySchema.parse({kind:'file',reference});
  if(!settings().comfyDir)throw Error('Choose your ComfyUI folder in Settings → Services to verify model files.');
  const base=path.join(expandPath(settings().comfyDir),'models');
  const root=await fs.realpath(base),file=path.join(root,reference);
  // Bound both read-only checks and explicit preparation to this model root.
  let dir=root;
  for(const part of reference.split('/')){dir=path.join(dir,part);const stat=await fs.lstat(dir).catch(e=>{if(e.code!=='ENOENT')throw e;return undefined;});if(stat?.isSymbolicLink())throw Error('Model paths cannot contain symlinks.');}
  return file;
}
export async function verifyFile(file:string,d:Dependency) {
  const stat=await fs.stat(file);if(!stat.isFile()||!stat.size||d.size&&stat.size!==d.size)throw Error('Missing or incomplete file.');
  if(file.endsWith('.safetensors'))await tensorFile(file);
}
async function completeModel(directory:string) {
  const tensors=await modelTensors(directory);
  const names=new Set(tensors.map(file=>path.basename(file.filename)));
  for(const name of names){
    const shard=/^(.*)-(\d{5})-of-(\d{5})\.safetensors$/.exec(name);
    if(!shard)continue;
    const total=Number(shard[3]);if(total<1||total>1000)throw Error('Invalid shard count.');
    for(let i=1;i<=total;i++)if(!names.has(`${shard[1]}-${String(i).padStart(5,'0')}-of-${shard[3]}.safetensors`))throw Error('Missing model shard.');
  }
  for(const name of (await fs.readdir(directory)).filter(name=>name.endsWith('.safetensors.index.json'))){
    const file=path.join(directory,name),stat=await fs.stat(file);
    if(stat.size>8*1024*1024)throw Error('Model index is too large.');
    const index=JSON.parse(await fs.readFile(file,'utf8'));
    if(!index.weight_map||typeof index.weight_map!=='object')throw Error('Invalid model index.');
    for(const [tensor,shard]of Object.entries(index.weight_map))if(typeof shard!=='string'||!tensors.some(file=>path.basename(file.filename)===shard&&file.tensors[tensor]))throw Error('Model index references missing weights.');
  }
}
export async function dependencyReady(snapshot:PipelineSnapshot,d:Dependency):Promise<boolean> {
  try {
    if(snapshot.metadata.runner==='comfyui'){await verifyFile(await comfyFile(d.reference),d);return true;}
    if(d.kind==='lora'){await verifyFile(await resolveModelAdapter(d.reference),d);return true;}
    const dir=await resolveVpipeModel(d.reference);
    if(d.layout==='minimax')return (await referenceModelStatus(d.reference)).ready;
    if(d.layout==='ltx') {
      for(const component of ['diffusion_models','text_encoders']) {
        // Runner-owned model files are runtime data, never desktop bundle inputs.
        const folder=path.join(/* turbopackIgnore: true */ dir,component);
        const entries=await fs.readdir(/* turbopackIgnore: true */ folder,{withFileTypes:true});
        if(!entries.length)throw Error('Missing LTX component.');
        let found=false;
        for(const entry of entries) {
          const file=path.join(/* turbopackIgnore: true */ folder,entry.name);
          if(entry.isDirectory()){await completeModel(file);found=true;}
          else if(entry.name.endsWith('.safetensors')){await tensorFile(file);found=true;}
        }
        if(!found)throw Error('Missing LTX weights.');
      }
      for(const name of ['ltx-2.5-video-vae-conv-bf16.safetensors','ltx-2.5-audio-vae-bf16.safetensors'])await tensorFile(path.join(/* turbopackIgnore: true */ dir,'vae',name));
    }
    else if(d.layout==='krea'||d.layout==='diffusers'){for(const component of ['transformer','text_encoder','vae'])await completeModel(path.join(/* turbopackIgnore: true */ dir,component));for(const component of ['tokenizer/tokenizer.json','model_index.json'])await verifyFile(path.join(/* turbopackIgnore: true */ dir,component),{...d,size:undefined,sha256:undefined});}
    else if(d.layout==='transformer'){await completeModel(dir);await verifyFile(path.join(dir,'config.json'),{...d,size:undefined,sha256:undefined});}
    else if(!d.files.length)throw Error('Declare the required files or model layout in pipeline metadata.');
    for(const name of d.files)await verifyFile(path.join(dir,name),{...d,size:undefined,sha256:undefined});
    return true;
  }catch{return false;}
}
