import type { Health, Job, SetupRequest } from './types';

export const generationOptions = [
  {kind:'image',name:'Images',description:'Turn a prompt into a picture.'},
  {kind:'video',name:'Videos',description:'Create a video or bring an image to life.'},
  {kind:'reference',name:'Reference videos',description:'Create a video from several reference images.'},
  {kind:'upscale',name:'Video upscaling',description:'Enhance detail in a finished video.'},
] as const;

export function setupWorkflows(health:Health|undefined,jobs:Job[]) {
  return generationOptions.flatMap(option=>{
    const id=health?.pipelineSelections?.[option.kind];
    if(!id)return [];
    const workflow=health?.pipelines?.find(item=>item.id===id&&item.kind===option.kind);
    const job=jobs.find(item=>item.kind==='setup'&&['queued','running'].includes(item.status)&&(item.request as SetupRequest).pipeline?.metadata.id===id);
    const connected=!!workflow&&!!health?.connections?.[workflow.runner]?.enabled&&!!health.connections[workflow.runner].available;
    const ready=connected&&!!health?.capabilities?.[option.kind].ready;
    return [{...option,id,workflow,job,ready,canPrepare:!!workflow?.canPrepare&&connected&&!ready&&!job}];
  });
}
