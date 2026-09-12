import { catalog, resolvePipeline, pipelineStatus } from './catalog';
import { pipelineKinds, type PipelineSelections, type PipelineSnapshot } from './schema';
import { settings } from '../db';
import type { Connections } from '../service-config';
import type { Generation, Health } from '../types';
export async function validatePipelineSelections(patch:Partial<PipelineSelections>,connections:Connections) {
  const entries=(await catalog()).entries;
  for(const kind of pipelineKinds)if(patch[kind]){
    const p=entries.find(p=>p.kind===kind&&p.metadata.id===patch[kind]);if(!p)throw Error('This pipeline is no longer available. Refresh the list.');
    if(p.metadata.runner!=='local'&&!connections[p.metadata.runner])throw Error('Connect the pipeline’s runner first.');
  }
  return {...settings().pipelineSelections,...patch};
}
export async function checkPipelineRequest(snapshot:PipelineSnapshot,input:Generation,state:Health) {
  const m=snapshot.metadata;
  if(!state.worker)throw Error(state.checks.find(check=>check.id==='worker')?.detail||'The generation queue is offline.');
  if(m.runner!=='local'&&(!state.connections?.[m.runner].enabled||!state.connections[m.runner].available))throw Error(`Connect ${m.runner} to use this pipeline.`);
  if(input.mode!=='image'&&!state.checks.find(c=>c.id==='ffmpeg')?.ready)throw Error(state.checks.find(c=>c.id==='ffmpeg')?.detail||'Video tools need setup.');
  if(input.sourceId&&input.mode!=='upscale'&&!m.source)throw Error('Choose a pipeline that accepts a starting image.');
  if(input.referenceIds.length>(m.references?.max||0))throw Error('Too many references for this pipeline.');
  if(input.mode!=='upscale'&&(!m.controls.qualities.includes(input.quality)||!input.sourceId&&!m.controls.aspects.some(aspect=>aspect===input.aspect)||input.mode!=='image'&&!m.controls.durations.includes(input.duration as 6|8|10)))throw Error('These generation settings are not supported by this pipeline.');
  const status=await pipelineStatus(snapshot);if(!status.ready)throw Error(status.detail);
}
export async function snapshotRequest(input:Generation,state:Health){const snapshot=await resolvePipeline(input.mode,input.pipelineId);await checkPipelineRequest(snapshot,input,state);input.pipeline=snapshot;input.pipelineId=snapshot.metadata.id;delete input.adapters;delete input.imageModel;if(input.mode==='upscale')input.upscaler=snapshot.metadata.engine;return snapshot.metadata.runner==='comfyui'?'comfyui' as const:'vpipe' as const;}
