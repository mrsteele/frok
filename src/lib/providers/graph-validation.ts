import { pipelineRunners, type PipelineSnapshot } from '../pipelines/schema';
import { dependencies } from '../pipelines/dependencies';
import type { Pipeline } from '../vpipe';
import type { Graph } from '../comfyui';
export function validateNativeGraph(snapshot:PipelineSnapshot) {
  const {metadata:m}=snapshot;
  if(!pipelineRunners.includes(m.runner))throw Error('This workflow uses a retired built-in engine. Select a service workflow in Settings → Generation.');
  if(m.plugins?.length&&m.runner!=='vpipe')throw Error('Native plugins require the Vpipe provider.');
  if(snapshot.kind==='upscale'&&!m.videoSource)throw Error('Upscaling requires a workflow with a videoSource binding.');
  if(m.videoSource&&(snapshot.kind!=='upscale'||m.source||m.references))throw Error('Video inputs are only supported by upscaling workflows.');
  if(m.upscale&&(snapshot.kind!=='upscale'||m.runner!=='vpipe'))throw Error('Input alignment is only supported by native upscaling workflows.');
  const configs=new Map<string,Record<string,unknown>>(),outputs:{node:string;field:string}[]=[];
  if(m.runner==='vpipe'){
    const graph=snapshot.graph as unknown as Pipeline;
    if(!Array.isArray(graph.stages)||!graph.stages.length||graph.stages.length>300||graph.subpipelines?.length)throw Error('Use a flat native generation pipeline.');
    const seen=new Set<string>();
    for(const stage of graph.stages){
      if(!stage.id||seen.has(stage.id)||stage.id.startsWith('frok-input-')||!stage.config)throw Error('Invalid or duplicate stage ID.');
      if(stage.iports?.some(port=>port.src&&!seen.has(port.src)))throw Error(`Forward or missing input at ${stage.id}.`);
      if(['shell','model-fetch','model-remove','model-quantize','lora-fuse','load-image','load-video','save-file'].includes(stage.type)&&!(stage.type==='load-video'&&m.videoSource?.node===stage.id&&m.videoSource.field==='input_url'))throw Error(`Run ${stage.type} in your runner outside Frok, or use a source binding.`);
      if(stage.type==='save-image')outputs.push({node:stage.id,field:'path'});
      if(stage.type==='save-video')outputs.push({node:stage.id,field:'output_url'});
      seen.add(stage.id);configs.set(stage.id,stage.config);
    }
  }else{
    if('nodes' in snapshot.graph)throw Error('Export ComfyUI in API format.');
    for(const [id,node] of Object.entries(snapshot.graph as Graph)){
      if(!node.class_type||!node.inputs||id.startsWith('frok-'))throw Error('Invalid ComfyUI API node.');
      if(/Load(Image|Video|Audio)/i.test(node.class_type)&&!(node.class_type==='LoadVideo'&&m.videoSource?.node===id&&m.videoSource.field==='file'))throw Error('Use source/reference bindings for private uploaded media.');
      if(node.class_type==='SaveImage'||node.class_type==='SaveVideo')outputs.push({node:id,field:'filename_prefix'});
      else if(/save|upload|download|execute|shell/i.test(node.class_type))throw Error(`Unsupported file-writing node: ${node.class_type}.`);
      configs.set(id,node.inputs);
    }
  }
  for(const bindings of Object.values(m.bindings))for(const b of bindings)if(!configs.has(b.node)||['__proto__','prototype','constructor'].includes(b.field))throw Error('Invalid input binding.');
  for(const out of outputs)if(!m.bindings.output?.some(b=>b.node===out.node&&b.field===out.field))throw Error(`Bind every output to private job storage (${out.node}).`);
  if(snapshot.kind==='upscale'){
    const native=m.runner==='vpipe',stages=native?(snapshot.graph as unknown as Pipeline).stages:[];
    const loader=native?stages.find(s=>s.id===m.videoSource!.node)?.type:(snapshot.graph as Graph)[m.videoSource!.node]?.class_type;
    if(loader!==(native?'load-video':'LoadVideo')||m.videoSource!.field!==(native?'input_url':'file'))throw Error('Bind videoSource to the video loader input.');
    if(!outputs.length||outputs.some(out=>native?stages.find(s=>s.id===out.node)?.type!=='save-video':(snapshot.graph as Graph)[out.node].class_type!=='SaveVideo'))throw Error('Upscaling workflows must save a video.');
    if(native&&!m.bindings.fps?.length)throw Error('Native upscaling workflows must bind the source frame rate to their video output.');
    if(Object.values(m.bindings).flat().some(b=>b.node===m.videoSource!.node))throw Error('Only videoSource may bind the video loader.');
  }else if(!outputs.length||!m.bindings.prompt?.length||!m.bindings.seed?.length)throw Error('Declare prompt, seed and output bindings.');
  if(m.source&&!configs.has(m.source.target)||m.references&&!configs.has(m.references.target))throw Error('Invalid source/reference target.');
  if(m.source){
    if(m.runner==='vpipe'){
      const stages=(snapshot.graph as unknown as Pipeline).stages;
      if(m.source.port===undefined||!m.source.model||!configs.has(m.source.model)||stages.findIndex(s=>s.id===m.source!.model)>=stages.findIndex(s=>s.id===m.source!.target))throw Error('The source encoder needs a preceding model stage and input port.');
    }else if(!m.source.field||['__proto__','constructor','prototype'].includes(m.source.field))throw Error('Declare a valid starting-image field.');
  }
  if(m.references&&['__proto__','constructor','prototype'].includes(m.references.field))throw Error('Invalid reference field.');
  dependencies(snapshot);
}
