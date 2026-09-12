import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { settings, comfyDirectory } from './db';
import { queueBusy } from './worker-queue';
import { expandPath } from './config';
import { HttpError } from './request-security';
import { isLocalService, withRunnerLocations, type RunnerLocations } from './runner-locations';

export const runnerLocationFields=['vpipeWorkdir','comfyDir','comfyUrl'] as const;
export function normalizeRunnerLocations(input:Partial<RunnerLocations>):Partial<RunnerLocations> {
  const result:Partial<RunnerLocations>={};
  for(const field of runnerLocationFields) {
    if(input[field]===undefined)continue;
    const value=input[field]!.trim();
    if(!value){result[field]='';continue;}
    if(field==='comfyUrl') {
      if(!isLocalService(value))throw new HttpError(400,'Use a local ComfyUI service address, such as http://127.0.0.1:8000.');
      result[field]=new URL(value).origin;
    } else {
      if(!value||/[\x00-\x1f\x7f]/.test(value)||(!path.isAbsolute(value)&&!/^~[/\\]/.test(value)))throw new HttpError(400,'Enter a full folder path, or a path starting with ~/.');
      result[field]=expandPath(value);
    }
  }
  return result;
}

export function assertRunnerLocationsIdle(locations:Partial<RunnerLocations>) {
  const current=settings();
  const candidate=withRunnerLocations(locations,settings);
  const changed=runnerLocationFields.some(field=>locations[field]!==undefined&&(field==='comfyUrl'?new URL(candidate[field]).origin!==new URL(current[field]).origin:expandPath(candidate[field])!==expandPath(current[field])));
  const changedMappings=locations.comfyDir!==undefined&&(['input','output','temp'] as const).some(area=>comfyDirectory(area)!==withRunnerLocations(locations,()=>comfyDirectory(area)));
  if((changed||changedMappings)&&queueBusy())
    throw new HttpError(409,'Finish or cancel queued jobs and wait for the runner to stop before changing runner locations. You can still check the saved connection.');
}

// A workspace can be new: preparation creates it. Testing never creates it.
export async function checkVpipeWorkspace(directory:string) {
  let candidate=directory;
  while(true) {
    try {
      const stat=await fs.stat(candidate);
      if(!stat.isDirectory())throw new HttpError(400,'The model workspace must be a folder.');
      await fs.access(candidate,constants.R_OK|constants.W_OK|constants.X_OK);
      return;
    }catch(error) {
      if((error as NodeJS.ErrnoException).code!=='ENOENT') {
        if(error instanceof HttpError)throw error;
        throw new HttpError(400,'Frok cannot access this model workspace. Choose a readable, writable folder.');
      }
      const parent=path.dirname(candidate);
      if(parent===candidate)throw new HttpError(400,'Choose an accessible model workspace.');
      candidate=parent;
    }
  }
}
