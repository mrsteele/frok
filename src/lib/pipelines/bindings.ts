import type { PipelineSnapshot } from './schema';
import type { RenderInput, Pipeline, Stage } from '../vpipe';
import type { Graph } from '../comfyui';
export function bindPipeline(snapshot:PipelineSnapshot,input:Omit<RenderInput,'signal'|'log'>,output=input.output,source=input.source,references=input.references) {
  const {metadata:m}=snapshot,graph=structuredClone(snapshot.graph);
  const frames=Math.ceil((input.request.duration*m.controls.fps-m.controls.frameOffset)/m.controls.frameStride)*m.controls.frameStride+m.controls.frameOffset;
  const values={prompt:input.prompt,seed:input.seed,width:input.width,height:input.height,pixels:input.width*input.height,frames,duration:input.request.duration,output};
  const stages=(graph as unknown as Pipeline).stages;
  function config(id:string):Record<string,unknown> {
    const value=m.runner==='vpipe'?stages.find(stage=>stage.id===id)?.config:(graph as Graph)[id]?.inputs;
    if(!value)throw new Error(`Pipeline ${m.name} has a missing input node: ${id}.`);return value;
  }
  for(const [key,bindings] of Object.entries(m.bindings))if(key!=='device')for(const binding of bindings)config(binding.node)[binding.field]=values[key as keyof typeof values];
  if(m.videoSource) {
    if(!source)throw Error('This workflow requires a source video.');
    config(m.videoSource.node)[m.videoSource.field]=source;
  } else if(source) {
    if(!m.source)throw new Error('This pipeline does not accept a starting image.');
    if(m.runner==='vpipe') {
      const target=stages.find(stage=>stage.id===m.source!.target);if(!target||m.source.port===undefined||!m.source.model)throw Error('Invalid starting-image binding.');
      const added:Stage[]=[{id:'frok-input-image',type:'load-image',config:{url:[source]},iports:[]},{id:'frok-input-encode',type:'vae-encode',config:{unload_when_idle:'always'},iports:[{src:'frok-input-image',oport:0},{src:m.source.model,oport:0}]}];
      if(stages.some(stage=>added.some(item=>item.id===stage.id)))throw Error('Pipeline uses a reserved Frok input ID.');
      stages.splice(stages.indexOf(target),0,...added);target.iports??=[];target.iports[m.source.port]={src:'frok-input-encode',oport:0};
    } else { (graph as Graph)['frok-input-image']={class_type:'LoadImage',inputs:{image:source}};config(m.source.target)[m.source.field!]=['frok-input-image',0]; }
  }
  if(references.length) {
    if(!m.references||references.length>m.references.max)throw Error('This pipeline does not support these references.');
    if(m.runner==='vpipe')config(m.references.target)[m.references.field]=references;
    else references.forEach((file,i)=>{const id=`frok-ref-${i}`;(graph as Graph)[id]={class_type:'LoadImage',inputs:{image:file}};config(m.references!.target)[`${m.references!.field}${i}`]=[id,0];});
  }
  if(m.runner==='vpipe')graph.id=`frok-${input.request.mode}-${input.seed}`;
  return graph;
}
