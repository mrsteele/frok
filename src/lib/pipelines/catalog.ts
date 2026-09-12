import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { settings, pipelineDirectory } from '../db';
import { pipelineKinds, pipelineMetadata, type PipelineKind, type PipelineSnapshot, type PipelineStatus } from './schema';
import { dependencies, dependencyReady } from './dependencies';
import { comfyFetch, type Graph } from '../comfyui';
import type { Pipeline } from '../vpipe';
import { upscalerReady, upscalerSupported } from '../upscale';
import type { Health } from '../types';

export const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function readDefinition(file:string):Promise<Record<string,unknown>> {
  const stat=await fs.lstat(file);if(!stat.isFile()||stat.size>2*1024*1024)throw Error('Pipeline definitions must be regular JSON files under 2 MB.');
  const value=JSON.parse(await fs.readFile(file,'utf8'));if(!value||Array.isArray(value)||typeof value!=='object')throw Error('Expected a JSON object.');return value;
}
export function validatePipeline(snapshot:PipelineSnapshot) {
  const {metadata:m}=snapshot;
  if(m.runner==='local'){if(snapshot.kind!=='upscale'||!m.engine)throw Error('Local pipelines require an upscaling engine.');return;}
  if(snapshot.kind==='upscale')throw Error('Use a registered local AI upscaler. Native video-upscaling graphs need a video-input binding, which is not supported yet.');
  if(m.runner==='comfyui'&&snapshot.prepare&&!Array.isArray(snapshot.prepare.dependencies))throw Error('ComfyUI preparation companions must declare a dependencies array.');
  const configs=new Map<string,Record<string,unknown>>(),outputs:{node:string;field:string}[]=[];
  if(m.runner==='vpipe'){
    const graph=snapshot.graph as unknown as Pipeline;
    if(!Array.isArray(graph.stages)||!graph.stages.length||graph.stages.length>300||graph.subpipelines?.length)throw Error('Use a flat native generation pipeline.');
    const seen=new Set<string>();
    for(const stage of graph.stages){
      if(!stage.id||seen.has(stage.id)||stage.id.startsWith('frok-input-')||!stage.config)throw Error('Invalid or duplicate stage ID.');
      if(stage.iports?.some(port=>port.src&&!seen.has(port.src)))throw Error(`Forward or missing input at ${stage.id}.`);
      if(['shell','model-fetch','model-remove','model-quantize','lora-fuse','load-image','load-video','save-file'].includes(stage.type))throw Error(`Move ${stage.type} to preparation or use a source binding.`);
      if(stage.type==='save-image')outputs.push({node:stage.id,field:'path'});
      if(stage.type==='save-video')outputs.push({node:stage.id,field:'output_url'});
      seen.add(stage.id);configs.set(stage.id,stage.config);
    }
  }else{
    if('nodes' in snapshot.graph)throw Error('Export ComfyUI in API format.');
    for(const [id,node] of Object.entries(snapshot.graph as Graph)){
      if(!node.class_type||!node.inputs||id.startsWith('frok-'))throw Error('Invalid ComfyUI API node.');
      if(/Load(Image|Video|Audio)/i.test(node.class_type))throw Error('Use source/reference bindings for private uploaded media.');
      if(node.class_type==='SaveImage'||node.class_type==='SaveVideo')outputs.push({node:id,field:'filename_prefix'});
      else if(/save|upload|download|execute|shell/i.test(node.class_type))throw Error(`Unsupported file-writing node: ${node.class_type}.`);
      configs.set(id,node.inputs);
    }
  }
  for(const bindings of Object.values(m.bindings))for(const b of bindings)if(!configs.has(b.node)||['__proto__','prototype','constructor'].includes(b.field))throw Error('Invalid input binding.');
  for(const out of outputs)if(!m.bindings.output?.some(b=>b.node===out.node&&b.field===out.field))throw Error(`Bind every output to private job storage (${out.node}).`);
  if(!outputs.length||!m.bindings.prompt?.length||!m.bindings.seed?.length)throw Error('Declare prompt, seed and output bindings.');
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
export async function diskCatalog(base=pipelineDirectory()) {
  const entries:PipelineSnapshot[]=[],errors:string[]=[];
  try {if(!(await fs.stat(base)).isDirectory())throw Error('Not a folder.');}
  catch{return {entries,errors:['The pipeline folder is missing or unreadable. Check its location or restore the defaults.']};}
  for(const kind of pipelineKinds){
    const directory=path.join(base,kind),files=await fs.readdir(directory,{withFileTypes:true}).catch(error=>{if(error.code!=='ENOENT')errors.push(`${kind}: folder is unreadable.`);return [];});
    const definitions = files.filter(f=>f.isDirectory()&&!f.isSymbolicLink()).map(f=>({name:f.name,folder:path.join(directory,f.name),meta:'meta.json',base:'run',prep:'prepare'}));
    // Read old flat custom workflows during upgrades; bundled workflows use folders.
    definitions.push(...files.filter(f=>f.isFile()&&f.name.endsWith('.meta.json')).map(f=>({name:f.name,folder:directory,meta:f.name,base:f.name.slice(0,-10),prep:f.name.slice(0,-10)+'.prepare'})));
    for(const file of definitions.sort((a,b)=>a.name.localeCompare(b.name)))try{
      const metadata=pipelineMetadata.parse(await readDefinition(path.join(file.folder,file.meta)));
      const extension=metadata.runner==='vpipe'?'.vpipeline':'.json';
      const graph=await readDefinition(path.join(file.folder,file.base+extension));
      const prepare=await readDefinition(path.join(file.folder,file.prep+extension)).catch(e=>{if(e.code==='ENOENT')return undefined;throw e;});
      if(prepare&&metadata.runner==='vpipe'&&!Array.isArray(prepare.stages))throw Error('The prepare companion must contain a stages array.');
      const snapshot:PipelineSnapshot={metadata,kind,graph,prepare,revision:digest([metadata,graph,prepare])};
      validatePipeline(snapshot);
      if(entries.some(p=>p.metadata.id===metadata.id))throw Error('Duplicate pipeline ID.');
      entries.push(snapshot);
    }catch(error){errors.push(`${kind}/${file.name}: ${(error as Error).message}`);}
    for(const file of files)if(file.isFile()&&/\.(vpipeline|json)$/.test(file.name)&&!file.name.includes('.meta.')&&!file.name.includes('.prepare.')&&!files.some(f=>f.name===file.name.replace(/\.(vpipeline|json)$/,'.meta.json')))errors.push(`${kind}/${file.name}: put run and meta.json together in a pipeline folder.`);
  }
  return {entries,errors};
}

export async function catalog(){return diskCatalog();}
export async function resolvePipeline(kind:PipelineKind,id?:string) {
  const list=await catalog(),selected=id||settings().pipelineSelections[kind];
  const snapshot=list.entries.find(p=>p.kind===kind&&p.metadata.id===selected);
  if(!snapshot)throw Error('Choose an available pipeline in Settings → Pipelines.');
  const runner=snapshot.metadata.runner;
  if(runner!=='local'&&!settings().connections[runner])throw Error(`Connect ${runner} before using this pipeline.`);
  return structuredClone(snapshot);
}
export async function pipelineStatus(snapshot:PipelineSnapshot):Promise<PipelineStatus> {
  const {metadata:m,kind}=snapshot;
  const result:PipelineStatus={id:m.id,name:m.name,runner:m.runner,kind,description:m.description,default:m.default,controls:m.controls,supportsSource:!!m.source,maxReferences:m.references?.max||0,state:'missing',ready:false,detail:'',missing:[],canPrepare:false,revision:snapshot.revision};
  if(m.runner==='local'){
    result.ready=await upscalerReady(m.engine);result.canPrepare=upscalerSupported(m.engine);result.state=result.ready?'ready':result.canPrepare?'missing':'attention';result.detail=result.ready?'AI upscaler installed.':result.canPrepare?'Prepare the AI model and local runtime.':'This upscaler is not supported on this machine.';return result;
  }
  const deps=dependencies(snapshot),missing:typeof deps=[];
  for(const d of deps)if(!await dependencyReady(snapshot,d))missing.push(d);
  result.missing=missing.map(d=>d.reference);result.canPrepare=!!snapshot.prepare||missing.length>0&&missing.every(d=>m.runner==='vpipe'?!!d.fetch&&!d.generated:!!d.url);
  if(m.runner==='comfyui'){
    try{const info=await (await comfyFetch('/object_info')).json();const nodes=[...new Set(Object.values(snapshot.graph as Graph).map(n=>n.class_type))];if(m.source||m.references)nodes.push('LoadImage');const absent=nodes.filter(n=>!info[n]);if(absent.length){result.state='attention';result.detail=`Install or update ComfyUI nodes: ${absent.join(', ')}.`;return result;}
      for(const node of Object.values(snapshot.graph as Graph))for(const [field,value] of Object.entries(node.inputs)){const options=info[node.class_type]?.input?.required?.[field]?.[0]??info[node.class_type]?.input?.optional?.[field]?.[0];if(Array.isArray(options)&&!Array.isArray(value)&&!options.includes(value)){result.state='attention';result.detail=`Refresh ComfyUI’s available models or update ${node.class_type}: ${field} is unavailable.`;return result;}}}
    catch{result.state='attention';result.detail='Connect the protected ComfyUI service to check its nodes.';return result;}
  }
  result.ready=missing.length===0;result.state=result.ready?'ready':result.canPrepare?'missing':'attention';
  const needsVariant=missing.length>0&&missing.every(d=>d.generated)&&deps.some(d=>d.kind==='model'&&!d.generated);
  result.prepareLabel=needsVariant?'Prepare model variant':'Download & prepare';
  result.detail=result.ready?'All declared dependencies are installed.':result.canPrepare?needsVariant?`${m.name}: the base model is installed. Prepare this pipeline’s fused or processed model variant; existing base files will be reused.`:`${m.name} needs preparation before you can generate. Download and prepare its missing dependencies.`:`${m.name} is missing dependencies without preparation instructions. Ask the administrator to add the download sources or a prepare companion.`;return result;
}
export async function pipelineHealth(state:Health):Promise<Health> {
  const list=await catalog(),selections=settings().pipelineSelections,statuses:PipelineStatus[]=[];
  const {pipelineLibraryAudit}=await import('./location');
  const pipelineLibrary=await pipelineLibraryAudit(list);
  for(const p of list.entries)if(p.metadata.runner==='local'||state.connections?.[p.metadata.runner].enabled)statuses.push(await pipelineStatus(p));
  const capabilities={...state.capabilities!};
  for(const kind of pipelineKinds){const p=statuses.find(p=>p.id===selections[kind]&&p.kind===kind),connection=p?.runner!=='local'?p?.runner:undefined,c=connection&&state.connections?.[connection];const tools=kind==='image'||!!state.checks.find(c=>c.id==='ffmpeg')?.ready;
    capabilities[kind]={configured:!!selections[kind],connection,ready:!!p?.ready&&(!connection||!!c&&c.enabled&&c.available)&&tools,detail:!p?'Choose a pipeline in Settings → Pipelines.':c&&(!c.enabled||!c.available)?`Connect ${connection} to use ${p.name}.`:!tools?`Video tools need setup. ${state.checks.find(c=>c.id==='ffmpeg')?.detail||''}`.trim():p.detail};
  }
  const engine=list.entries.find(p=>p.metadata.id===selections.upscale)?.metadata.engine;
  return {...state,pipelineLibrary,upscaler:engine||state.upscaler,upscalerSupported:upscalerSupported(engine),pipelines:statuses,pipelineSelections:selections,pipelineErrors:list.errors,capabilities,upscalerReady:capabilities.upscale.ready};
}
