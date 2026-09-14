import fs from 'node:fs/promises';
import path from 'node:path';
import { modelNames } from './config';
import { resolveVpipeModel } from './model-access';
import { tensorFile } from './model-tensors';

async function weights(directory:string, component:string) {
  const files=await fs.readdir(directory);
  const indexName='model.safetensors.index.json';
  let map:Record<string,string>|undefined;
  if(files.includes(indexName)) {
    const index=await fs.open(path.join(directory,indexName),'r');
    try {
      if((await index.stat()).size>16*1024*1024)throw Error(`Invalid ${component} shard index.`);
      map=JSON.parse(await index.readFile('utf8')).weight_map;
      if(!map||typeof map!=='object'||Array.isArray(map)||!Object.keys(map).length)throw Error(`Invalid ${component} shard index.`);
    } finally {await index.close();}
  }
  const names=map?[...new Set(Object.values(map))]:files.filter(name=>name.endsWith('.safetensors'));
  if(!names.length)throw Error(`Missing ${component} weights.`);
  if(!map&&names.some(name=>/-\d+-of-\d+\.safetensors$/.test(name)))throw Error(`Missing ${component} shard index.`);
  for(const name of names) {
    if(typeof name!=='string'||!/^[\w.-]+\.safetensors$/.test(name))throw Error(`Invalid ${component} shard name.`);
    // Read bounded headers and compare their declared payload length with the
    // file size. Never load multi-GB tensor data for a readiness check.
    const file=await tensorFile(path.join(directory,name));
    if(map&&Object.entries(map).some(([key,shard])=>shard===name&&!Object.hasOwn(file.tensors,key)))throw Error(`Incomplete ${component} shard: ${name}.`);
  }
}

/** Use the same trusted root as rendering, not just a previous setup receipt. */
export async function referenceModelStatus(model=modelNames.reference):Promise<{ready:boolean;detail:string}> {
  const retry='Use Settings → Generation → Reference video → Download & prepare to finish preparation.';
  let directory:string;
  try {directory=await resolveVpipeModel(model);}
  catch {return {ready:false,detail:`MiniMax H3 Ref2VA is missing or inaccessible (${model}). ${retry}`};}
  try {
    await weights(path.join(directory,'diffusion_models'),'Ref2VA diffusion');
    await weights(path.join(directory,'text_encoders'),'prompt encoder');
    for(const name of ['minimax_h3_video_vae_fp16.safetensors','minimax_h3_audio_vae_fp32.safetensors'])await tensorFile(path.join(directory,'vae',name));
    for(const name of ['tokenizer.json','tokenizer_config.json']) {
      const file=await fs.stat(path.join(directory,'tokenizer',name));
      if(!file.isFile()||!file.size)throw Error(`Missing tokenizer file: ${name}.`);
    }
    return {ready:true,detail:'MiniMax H3 Ref2VA diffusion weights, prompt encoder, VAEs and tokenizer are installed.'};
  } catch(error) {
    const detail=(error as NodeJS.ErrnoException).code==='ENOENT'?'A required model file is missing.':(error as Error).message;
    return {ready:false,detail:`MiniMax H3 Ref2VA preparation is incomplete. ${detail} ${retry}`};
  }
}
