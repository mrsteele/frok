import { catalog, pipelineStatus } from './pipelines/catalog';
import { pipelineKinds, type PipelineSnapshot } from './pipelines/schema';
import { createJob, getJob, getValue, listJobs, settings, setValue } from './db';
import { health } from './setup';
import { connectionDefaults } from './connection-defaults';
import { connectionNames, type ConnectionId } from './service-config';
import { ollamaConfigKey } from './ollama-config';
import { ollamaModelKey } from './ollama-models';
import { HttpError } from './request-security';
import { assertComfyPrivateBackend } from './comfyui';
import type { Job, SetupRequest } from './types';
import { workerStatus } from './worker-health';

export function queueSetup(request:SetupRequest):Job {
  const worker=workerStatus();if(worker.outdated)throw new HttpError(409,worker.detail);
  const existing=listJobs().find(job=>{
    const prior=job.request as SetupRequest;
    return job.kind==='setup'&&['queued','running'].includes(job.status)&&prior.task===request.task
      &&prior.pipeline?.metadata.id===request.pipeline?.metadata.id&&prior.pipeline?.revision===request.pipeline?.revision
      &&(!request.ollama||!!prior.ollama&&ollamaConfigKey(prior.ollama)===ollamaConfigKey(request.ollama));
  });
  return existing||createJob({kind:'setup',request,runner:request.pipeline?.metadata.runner==='comfyui'||request.task.startsWith('comfy-')?'comfyui':'vpipe',total:1});
}

export async function prepareConnection(id:ConnectionId,signal:AbortSignal,promptModel?:string) {
  if(promptModel&&id!=='ollama')throw new HttpError(400,'Prompt models belong to the Ollama connection.');
  await catalog();
  const before=settings();
  if(!before.connections[id])throw new HttpError(409,`Connect ${connectionNames[id]} first.`);
  const state=await health();
  signal.throwIfAborted();
  if(JSON.stringify(settings())!==JSON.stringify(before))throw new HttpError(409,'Settings changed while checking the connection. Please try again.');
  if(!state.connections?.[id].available)throw new HttpError(409,state.connections?.[id].detail||'The service is offline.');
  const worker=workerStatus();if(worker.outdated)throw new HttpError(409,worker.detail);
  if(id==='comfyui')assertComfyPrivateBackend();
  if(id!=='ollama'){
    const list=await catalog(),selections={...before.pipelineSelections},requests:SetupRequest[]=[];
    for(const kind of pipelineKinds){
      if(kind==='upscale')continue;
      const existing=list.entries.find(p=>p.kind===kind&&p.metadata.id===selections[kind]);
      const selected:PipelineSnapshot|undefined=existing||list.entries.find(p=>p.kind===kind&&p.metadata.runner===id&&p.metadata.default);
      if(!selected||selected.metadata.runner!==id)continue;
      selections[kind]=selected.metadata.id;
      const status=await pipelineStatus(selected);
      if(!status.ready&&status.canPrepare)requests.push({task:'pipeline',pipeline:selected});
    }
    signal.throwIfAborted();
    if(JSON.stringify(settings())!==JSON.stringify(before))throw new HttpError(409,'Settings changed while checking pipelines. Please try again.');
    setValue('pipelineSelections',selections);
    return {jobs:requests.map(queueSetup),settings:settings()};
  }
  const plan=connectionDefaults(id,state);
  if(promptModel){
    if(!state.ollamaModels?.some(model=>ollamaModelKey(model)===ollamaModelKey(promptModel)))throw new HttpError(409,'That model is no longer available for text generation. Refresh the installed models.');
    plan.promptModel=promptModel;plan.selections.prompt=promptModel;
  }
  if(id==='ollama'&&!plan.promptModel)throw new HttpError(409,'No compatible prompt model is available. Choose a model in Settings → Generate → Ollama.');
  // All checks finish before this synchronous studio settings update. Preparation
  // reuses existing model files and verifies them through the regular setup queue.
  setValue('modelSelections',plan.selections);
  const jobs=plan.tasks.map(task=>queueSetup({task,
    ...(task==='ollama'?{ollama:{url:state.ollamaUrl!,model:plan.promptModel!}}:{}),
  }));
  if(id==='ollama')setValue('pendingPromptSetup',jobs[0]?{jobId:jobs[0].id,model:plan.promptModel}:null);
  return {jobs,settings:settings()};
}

// Called only after runSetup has verified the downloaded completion model.
// Explicit model edits or disconnection clear this intent in the settings API.
export function activateVerifiedPrompt(job:Job) {
  const pending=getValue<{jobId:string;model:string}|null>('pendingPromptSetup',null);
  if(job.kind!=='setup'||(job.request as SetupRequest).task!=='ollama'||pending?.jobId!==job.id||getJob(job.id)?.status==='cancelled')return;
  const current=settings(),config=(job.request as SetupRequest).ollama;
  if(current.connections.ollama&&config?.url===current.ollamaUrl&&config?.model===pending.model&&(!current.modelSelections.prompt||current.modelSelections.prompt===pending.model))
    setValue('modelSelections',{...current.modelSelections,prompt:pending.model});
  setValue('pendingPromptSetup',null);
}

export function retryPromptSetup(previous:Job,next:Job) {
  const pending=getValue<{jobId:string;model:string}|null>('pendingPromptSetup',null);
  if(pending?.jobId===previous.id)setValue('pendingPromptSetup',{...pending,jobId:next.id});
}
