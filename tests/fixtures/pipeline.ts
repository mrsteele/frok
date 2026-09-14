import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pipelineMetadata, type PipelineKind, type PipelineSnapshot } from '../../src/lib/pipelines/schema';
import { buildPipeline as build, renderVpipe as render, type RenderInput } from '../../src/lib/vpipe';

// Tests exercise the same registered factory definitions selected by the UI.
// No compatibility graph builder or installed model is used by this fixture.
export function factoryPipeline(kind:PipelineKind, runner:'vpipe'|'comfyui'=kind==='upscale'?'comfyui':'vpipe', imageModel?:string):PipelineSnapshot {
  const name=kind==='image'?runner==='vpipe'?'krea-2-turbo':imageModel==='z-image-turbo'?'z-image-turbo':'sdxl-turbo'
    :kind==='video'?runner==='vpipe'?'minimax-h3-turbo':'minimax-h3'
    :kind==='reference'?runner==='vpipe'?'minimax-h3-reference':'minimax-h3-reference-comfy':'realesrgan';
  const folder=path.resolve('resources/pipelines',kind,name),extension=runner==='vpipe'?'.vpipeline':'.json';
  const metadata=pipelineMetadata.parse(JSON.parse(readFileSync(path.join(folder,'meta.json'),'utf8')));
  const graph=JSON.parse(readFileSync(path.join(folder,'run'+extension),'utf8'));
  let prepare;try{prepare=JSON.parse(readFileSync(path.join(folder,'prepare'+extension),'utf8'));}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  return {kind,metadata,graph,prepare,revision:createHash('sha256').update(JSON.stringify([metadata,graph,prepare])).digest('hex')};
}
export function vpipeInput<T extends Omit<RenderInput,'signal'|'log'>>(input:T):T {
  return {...input,request:{...input.request,pipeline:input.request.pipeline||factoryPipeline(input.request.mode)}};
}
export function buildPipeline(input:Omit<RenderInput,'signal'|'log'>){return build(vpipeInput(input));}
export function renderVpipe(input:RenderInput){return render(vpipeInput(input));}
