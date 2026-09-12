import { z } from 'zod';
import type { PipelineMetadata, PipelineSnapshot } from './schema';

const config = z.record(z.string(), z.unknown());
const nativeGraph = z.object({
  stages: z.array(z.object({id:z.string().min(1),type:z.string().min(1),config,
    iports:z.array(z.object({src:z.string(),oport:z.number().int().nonnegative()}).passthrough()).optional(),
  }).passthrough()).min(1).max(300),
}).passthrough();
const comfyGraph = z.record(z.string(), z.object({class_type:z.string().min(1),inputs:config}).passthrough());
type Key = keyof PipelineMetadata['bindings'];

// Infer only known input semantics. In particular, negative conditioning and
// sampler/adapter settings must not become prompt or generation controls.
export function inferBindings(snapshot:PipelineSnapshot):string[] {
  const {metadata:m,graph}=snapshot,notes:string[]=[];
  let minimax=false;
  function checkOutputKind(types:string[],image:string,video:string) {
    if(snapshot.kind==='image'&&types.includes(video))throw Error('This workflow saves video. Choose Videos or Reference videos.');
    if(snapshot.kind!=='image'&&types.includes(image)&&!types.includes(video))throw Error('This workflow saves images. Choose Images.');
  }
  function bind(key:Key,node:string,field:string) {
    const bindings=m.bindings[key]??=[];
    if(!bindings.some(b=>b.node===node&&b.field===field))bindings.push({node,field});
    m.bindings[key]=bindings;
  }
  if(m.runner==='vpipe') {
    const parsed=nativeGraph.safeParse(graph);
    if(!parsed.success)throw Error('Choose a native Vpipe run pipeline with stages, IDs and configs.');
    const stages=parsed.data.stages,byId=new Map(stages.map(s=>[s.id,s]));
    checkOutputKind(stages.map(s=>s.type),'save-image','save-video');
    minimax=stages.some(s=>s.type==='minimax-h3-model-config');
    const promptNodes=new Set<string>();
    for(const stage of stages.filter(s=>['generate-image','generate-video'].includes(s.type))) {
      // These native stages receive positive conditioning on port zero.
      let current=byId.get(stage.iports?.[0]?.src||'');const seen=new Set<string>();
      while(current&&!seen.has(current.id)) {
        seen.add(current.id);
        if(current.type==='text-prompt'){promptNodes.add(current.id);break;}
        if(!['diffusion-conditioner','video-ref-encoder'].includes(current.type))break;
        current=byId.get(current.iports?.[0]?.src||'');
      }
      for(const key of ['seed','width','height','frames'] as const)if(typeof stage.config[key]==='number')bind(key,stage.id,key);
      // Port 5 is the encoded first frame in MiniMax's native generation graph.
      const model=byId.get(stage.iports?.[2]?.src||'');
      if(snapshot.kind==='video'&&stage.type==='generate-video'&&model?.type==='model-select'&&
        stage.iports?.some(p=>byId.get(p.src)?.type==='minimax-h3-model-config')&&!stage.iports?.[5]?.src) {
        m.source={target:stage.id,port:5,model:model.id};
      }
    }
    if(!promptNodes.size) {
      const text=stages.filter(s=>s.type==='text-prompt'&&typeof s.config.text==='string');
      if(text.length===1)promptNodes.add(text[0].id);
    }
    for(const id of promptNodes)if(typeof byId.get(id)?.config.text==='string')bind('prompt',id,'text');
    for(const stage of stages) {
      if(stage.type==='save-image'||stage.type==='save-video')bind('output',stage.id,stage.type==='save-image'?'path':'output_url');
      if(stage.type==='video-ref-encoder'&&snapshot.kind==='reference') {
        m.references={target:stage.id,field:'references',max:9};
        bind('frames',stage.id,'frames');bind('pixels',stage.id,'reference_image_max_pixels');
        // References will be supplied from the current Frok request.
        (graph.stages as typeof stages).find(s=>s.id===stage.id)!.config.references=[];
      }
    }
  }else {
    if('nodes' in graph)throw Error('Export the workflow from ComfyUI in API format, not the editor format.');
    const parsed=comfyGraph.safeParse(graph);
    if(!parsed.success||!Object.keys(parsed.data).length||Object.keys(parsed.data).length>300)throw Error('Choose a ComfyUI API workflow with node classes and inputs (up to 300 nodes).');
    const nodes=parsed.data;
    checkOutputKind(Object.values(nodes).map(n=>n.class_type),'SaveImage','SaveVideo');
    function promptInputs(link:unknown,seen=new Set<string>()):{node:string;field:string}[] {
      if(!Array.isArray(link)||typeof link[0]!=='string'||seen.has(link[0]))return [];
      const id=link[0],node=nodes[id];if(!node)return [];seen.add(id);
      if(node.class_type==='ConditioningZeroOut')return [];
      if(['CLIPTextEncode','CLIPTextEncodeSDXL'].includes(node.class_type))return ['text','text_g','text_l'].filter(field=>typeof node.inputs[field]==='string').map(field=>({node:id,field}));
      if(['MiniMaxH3ImageToVideo','MiniMaxH3ReferenceToVideo'].includes(node.class_type))return typeof node.inputs.prompt==='string'?[{node:id,field:'prompt'}]:[];
      return ['conditioning','conditioning_1','conditioning_2','conditioning_to','conditioning_from'].flatMap(field=>promptInputs(node.inputs[field],seen));
    }
    const positive=new Map<string,{node:string;field:string}>(),negative=new Set<string>();
    for(const [id,node] of Object.entries(nodes)) {
      const {class_type:type,inputs}=node;
      if(['KSampler','KSamplerAdvanced','SamplerCustom','BasicGuider','CFGGuider'].includes(type)) {
        for(const b of promptInputs(inputs.positive??inputs.conditioning))positive.set(`${b.node}:${b.field}`,b);
        for(const b of promptInputs(inputs.negative))negative.add(`${b.node}:${b.field}`);
      }
      const seed=type==='KSampler'?'seed':['KSamplerAdvanced','SamplerCustom','RandomNoise'].includes(type)?'noise_seed':undefined;
      if(seed&&typeof inputs[seed]==='number')bind('seed',id,seed);
      if(['EmptyLatentImage','EmptySD3LatentImage','MiniMaxH3ImageToVideo','MiniMaxH3ReferenceToVideo'].includes(type)) {
        for(const key of ['width','height'] as const)if(typeof inputs[key]==='number')bind(key,id,key);
        if(type.startsWith('MiniMaxH3')) {
          minimax=true;
          bind('frames',id,'length');
          if(type==='MiniMaxH3ImageToVideo'&&snapshot.kind==='video')m.source={target:id,field:'first_frame'};
          if(type==='MiniMaxH3ReferenceToVideo'&&snapshot.kind==='reference')m.references={target:id,field:'ref_images.ref_image_',max:9};
        }
      }
      if(type==='SaveImage'||type==='SaveVideo')bind('output',id,'filename_prefix');
    }
    for(const [key,b] of positive) {
      if(negative.has(key)){notes.push(`Prompt node ${b.node} also supplies negative conditioning. Separate it before adding a prompt binding.`);continue;}
      bind('prompt',b.node,b.field);
    }
  }
  if(!m.bindings.width?.length||!m.bindings.height?.length)notes.push('Dimensions could not be mapped. Add width/height bindings in meta.json to honor Frok’s size controls.');
  if(snapshot.kind!=='image'&&!m.bindings.frames?.length&&!m.bindings.duration?.length)notes.push('Video length could not be mapped. Add duration or frames bindings and verify fps, frameStride and frameOffset in meta.json.');
  if(snapshot.kind==='reference'&&!m.references)notes.push('The reference-image input could not be mapped. Add references in meta.json.');
  if(snapshot.kind!=='image'&&!minimax)notes.push('Review video timing in meta.json: the draft uses MiniMax defaults (24 fps, frame stride 17, offset 5). Adjust these for other video models.');
  // File outputs must be portable and will be replaced by private job storage.
  for(const output of m.bindings.output||[]) {
    const node=m.runner==='vpipe'?(graph.stages as z.infer<typeof nativeGraph>['stages']).find(s=>s.id===output.node)?.config:(graph[output.node] as {inputs:Record<string,unknown>})?.inputs;
    if(node)node[output.field]=m.runner==='comfyui'?'frok/render':snapshot.kind==='image'?'output.jpeg':'output.mp4';
  }
  return notes;
}
