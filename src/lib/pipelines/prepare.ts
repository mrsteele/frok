import fs from 'node:fs/promises';
import path from 'node:path';
import { catalog, pipelineStatus } from './catalog';
import { builtinPreparation, preparationFor } from './builtins';
import { createJob, listJobs, settings, workdir } from '../db';
import { vpipeBin } from '../config';
import { runProcess } from '../process';
import { workerStatus } from '../worker-health';
import { isPreparationJob } from '../preparation-job';
import { HttpError } from '../request-security';
import type { SetupRequest } from '../types';

function preparationError(output:string) {
  const denied=output.match(/ModelFetchStage[^\r\n]*HTTP\s+(401|403)\b/i);
  if(denied)return `Hugging Face denied the model download (HTTP ${denied[1]}). Confirm that your account has access to the model and your token permits reading it. In Frok Desktop, save the token under Settings → Advanced → API tokens, then quit and reopen Frok before retrying. In browser mode, set HF_TOKEN before starting Frok.`;
  return output.split(/\r?\n/).find(line=>/\[ERROR\]/.test(line));
}

export async function queuePreparation(id:string,signal:AbortSignal) {
  const worker=workerStatus();
  if(!worker.ready)throw new HttpError(409,worker.detail);
  const before=settings();
  const snapshot=(await catalog()).entries.find(p=>p.metadata.id===id&&before.pipelineSelections[p.kind]===id);
  if(!snapshot||!before.connections.vpipe)throw new HttpError(409,'Select a built-in Vpipe workflow and connect Vpipe first.');
  const preparation=await preparationFor(snapshot);
  if(!preparation)throw new HttpError(409,'This workflow uses manual setup. Follow its setup instructions.');
  const status=await pipelineStatus(snapshot);
  if(status.ready)throw new HttpError(409,'This workflow is already ready.');
  signal.throwIfAborted();
  if(JSON.stringify(settings())!==JSON.stringify(before))throw new HttpError(409,'Settings changed. Refresh and try again.');
  const existing=listJobs().find(job=>isPreparationJob(job)&&(job.request as SetupRequest).preparation===preparation&&['queued','running'].includes(job.status));
  return existing||createJob({kind:'setup',runner:'vpipe',total:1,request:{task:'builtin-preparation',preparation,name:snapshot.metadata.name}});
}

export async function runPreparation(request:SetupRequest,directory:string,signal:AbortSignal,log:(text:string)=>void) {
  if(request.task!=='builtin-preparation'||!request.preparation)throw Error('This older installation job cannot be run. Queue a built-in starter from Generation settings.');
  const starter=await builtinPreparation(request.preparation);
  if(!settings().connections.vpipe)throw Error('Connect Vpipe before running preparation.');
  if((await pipelineStatus(starter.snapshot)).ready){log('Dependencies are already installed.\n');return;}
  const file=path.join(directory,'prepare.vpipeline');
  await fs.writeFile(file,JSON.stringify(starter.graph,null,2),{mode:0o600});
  await fs.mkdir(workdir(),{recursive:true});
  log(`Running the built-in ${starter.snapshot.metadata.name} starter in ${workdir()}.\n`);
  log(`Hugging Face token: ${process.env.HF_TOKEN ? 'available to Vpipe' : 'not set'}.\n`);
  let output:string;
  try {
    output=await runProcess(vpipeBin(),['--launch',file],{cwd:workdir(),signal,onLog:log,timeout:24*60*60*1000});
  } catch(error) {
    const message=(error as Error).message;
    throw Error(preparationError(message)||message);
  }
  signal.throwIfAborted();
  // Vpipe can report a failed stage and still exit successfully after draining.
  const failure=preparationError(output);
  if(failure)throw Error(failure);
  const status=await pipelineStatus(starter.snapshot);
  if(!status.ready)throw Error(`The starter finished, but dependencies still need attention. ${status.detail} Follow the manual setup instructions.`);
  log('Workflow ready.\n');
}
