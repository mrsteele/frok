import fs from 'node:fs/promises';
import path from 'node:path';
import { pipelineStatus } from './catalog';
import { dependencies, dependencyReady, comfyFile, verifyFile } from './dependencies';
import type { PipelineSnapshot } from './schema';
import { workdir } from '../db';
import { vpipeBin } from '../config';
import { runProcess } from '../process';
import { download } from '../download';
import { runSetup } from '../setup';
import { assertComfyPrivateBackend } from '../comfyui';

export async function preparePipeline(snapshot:PipelineSnapshot,directory:string,signal:AbortSignal,log:(line:string)=>void) {
  const initial=await pipelineStatus(snapshot);if(initial.ready){log('Pipeline dependencies are already installed and verified.\n');return;}
  if(!initial.canPrepare)throw Error(initial.detail);
  if(snapshot.metadata.runner==='local')await runSetup(snapshot.metadata.engine==='seedvr2'?'seedvr2':'upscale',signal,log);
  else if(snapshot.metadata.runner==='comfyui'){
    assertComfyPrivateBackend();
    for(const d of dependencies(snapshot))if(!await dependencyReady(snapshot,d,true)){
      if(!d.url)throw Error(`No download source declared for ${d.reference}.`);
      const file=await comfyFile(d.reference,true),staging=file+'.frok-download';
      if(await fs.lstat(file).catch(()=>undefined))throw Error(`${d.reference} exists but failed verification. Ask the administrator to move it aside before repairing; existing shared files are not overwritten.`);
      for(const candidate of [staging,staging+'.part'])if((await fs.lstat(candidate).catch(()=>undefined))?.isSymbolicLink())throw Error('Invalid download staging path.');
      await download(d.url,staging,signal,log);
      try{await verifyFile(staging,d,true);if(d.reference.endsWith('.safetensors')){const {tensorFile}=await import('../model-tensors');await tensorFile(staging);}signal.throwIfAborted();await fs.rename(staging,file);}catch(error){await fs.rm(staging,{force:true});throw error;}
    }
  }else{
    let graph=snapshot.prepare||{id:'prepare-dependencies',stages:dependencies(snapshot).filter(d=>d.fetch).map((d,i)=>({id:`fetch-${i}`,type:'model-fetch',config:{model_path:d.fetch!.model,...(d.fetch!.variant?{model_variant:d.fetch!.variant}:{}),...(d.fetch!.key?{model_key:d.fetch!.key}:{}),base_path:'./models',skip_existing_files:true,overwrite_existing:false}}))};
    if(snapshot.prepare){
      const missing=[];for(const dependency of dependencies(snapshot))if(!await dependencyReady(snapshot,dependency))missing.push(dependency);
      // Model-only repairs can fetch a known adapter without re-quantizing the
      // already verified base pack. Custom transforms keep their companion.
      if(missing.length&&missing.every(d=>d.fetch&&!d.generated))graph={id:'prepare-missing-dependencies',stages:missing.map((d,i)=>({id:`fetch-${i}`,type:'model-fetch',config:{model_path:d.fetch!.model,...(d.fetch!.variant?{model_variant:d.fetch!.variant}:{}),...(d.fetch!.key?{model_key:d.fetch!.key}:{}),base_path:'./models',skip_existing_files:true,overwrite_existing:false}}))};
    }
    const file=path.join(directory,'prepare.vpipeline');await fs.writeFile(file,JSON.stringify(graph,null,2),{mode:0o600});await fs.mkdir(workdir(),{recursive:true});
    log(`Preparing ${snapshot.metadata.name}. Shared model downloads are reused.\n`);
    await runProcess(vpipeBin(),['--launch',file],{cwd:workdir(),signal,onLog:log,timeout:24*60*60*1000});
  }
  signal.throwIfAborted();const final=await pipelineStatus(snapshot);
  if(!final.ready)throw Error(`Preparation did not make this pipeline ready. ${final.detail}`);
  log(`${snapshot.metadata.name}: all dependencies verified.\n`);
}
