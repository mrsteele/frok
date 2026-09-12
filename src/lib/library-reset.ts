import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { libraryDatabase, libraryDirectory, libraryJobsDir } from './library';
import { activeOperations, beginOperation, endOperation, serviceValue, setServiceValue } from './registry';
import { listJobs, updateJob } from './db';
import { cleanupComfyJob } from './comfyui';
import { dataDir } from './paths';

export async function resetLibrary(){
  const operation=beginOperation('delete');
  let destructive=serviceValue('libraryResetPending',false);
  let complete=false;
  try {
    setServiceValue('libraryResetPending',true);
    const db=libraryDatabase();
    for(const job of listJobs())if(['queued','running'].includes(job.status))updateJob(job.id,{status:'cancelled',message:'Resetting the library.'});
    const deadline=Date.now()+25_000;
    while(activeOperations().some(item=>item.id!==operation)){
      if(Date.now()>deadline)throw Error('Waiting for running jobs or file requests to stop. Please retry the reset.');
      await delay(100);
    }
    const jobs=await fs.readdir(libraryJobsDir(),{withFileTypes:true}).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
    for(const job of jobs.filter(item=>item.isDirectory()&&/^[a-f0-9-]{36}$/.test(item.name))){
      const dir=path.join(libraryJobsDir(),job.name),children=await fs.readdir(dir,{withFileTypes:true});
      for(const item of [dir,...children.filter(item=>item.isDirectory()&&/^\d+$/.test(item.name)).map(item=>path.join(dir,item.name))]){
        if((await cleanupComfyJob(item)).pending)throw Error('ComfyUI still has a retained render. Finish its cleanup and retry; library data has been kept.');
      }
    }
    // Only content directories are removed. Model workspaces, pipelines,
    // downloads, runtimes, and connection environment files are never targets.
    destructive=true;
    for(const name of ['media','jobs','deletions','publications','exports']){
      const dir=path.join(/* turbopackIgnore: true */ libraryDirectory(),name);await fs.rm(dir,{recursive:true,force:true});
      await fs.mkdir(dir,{recursive:true,mode:0o700});
    }
    db.exec('BEGIN IMMEDIATE');
    try {db.exec("DELETE FROM media; DELETE FROM jobs; DELETE FROM prompt_sections; DELETE FROM settings; INSERT INTO settings(key,value) VALUES ('environmentDefaults','{}');");db.exec('COMMIT');}
    catch(error){db.exec('ROLLBACK');throw error;}
    // The upgrade retained original content as recovery copies. A confirmed
    // whole-library reset includes those copies so old assets cannot return.
    for(const name of ['users','media','jobs','deletions','frok.sqlite','frok.sqlite-wal','frok.sqlite-shm'])await fs.rm(path.join(/* turbopackIgnore: true */ dataDir,name),{recursive:true,force:true});
    setServiceValue('gpuHistory',[]);
    const epoch=randomUUID();setServiceValue('libraryResetEpoch',epoch);complete=true;return {deleted:true,epoch};
  }finally {
    // A preflight failure leaves a coherent library. Once deletion has started,
    // including an abandoned legacy reset, only successful completion unlocks it.
    if(complete||!destructive)setServiceValue('libraryResetPending',false);
    endOperation(operation);
  }
}

export async function recoverInterruptedLibraryReset(){
  const active=activeOperations();
  if(serviceValue('libraryResetPending',false)&&!active.some(row=>['delete','export','cleanup','worker'].includes(row.kind))){
    try {await resetLibrary();}
    catch(error){throw Error(`Could not finish the interrupted library reset. ${(error as Error).message}`);}
  }
}
