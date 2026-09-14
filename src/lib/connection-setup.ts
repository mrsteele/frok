import { catalog, pipelineStatus } from './pipelines/catalog';
import { pipelineKinds, type PipelineSnapshot } from './pipelines/schema';
import { createJob, listJobs, settings, setValue } from './db';
import { health } from './setup';
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
  const installed=state.ollamaModels||[];
  if(promptModel&&!installed.some(model=>ollamaModelKey(model)===ollamaModelKey(promptModel)))throw new HttpError(409,'That model is no longer available for text generation. Refresh the installed models.');
  const selected=promptModel||installed.find(model=>ollamaModelKey(model)===ollamaModelKey(before.modelSelections.prompt||''))
    ||installed.find(model=>ollamaModelKey(model)===ollamaModelKey(state.recommendedPromptModel||''))||installed[0];
  if(!selected)throw new HttpError(409,'No compatible prompt model is available. Install a model in Ollama, then check the connection.');
  setValue('modelSelections',{...before.modelSelections,prompt:selected});
  return {jobs:[],settings:settings()};
}
