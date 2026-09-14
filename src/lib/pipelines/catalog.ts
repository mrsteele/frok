import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { settings, pipelineDirectory } from '../db';
import { pipelineKinds, pipelineRunners, pipelineMetadata, type PipelineKind, type PipelineSnapshot, type PipelineStatus } from './schema';
import { dependencies, dependencyReady, comfyModelReference } from './dependencies';
import { comfyFetch, type Graph } from '../comfyui';
import type { Pipeline } from '../vpipe';
import { resolveComfyDevices, comfyOptions } from './comfy-devices';
import type { Health } from '../types';
import { connectionNames, type ConnectionStatus } from '../service-config';

export const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function readDefinition(file:string):Promise<Record<string,unknown>> {
  const stat=await fs.lstat(file);if(!stat.isFile()||stat.size>2*1024*1024)throw Error('Pipeline definitions must be regular JSON files under 2 MB.');
  const value=JSON.parse(await fs.readFile(file,'utf8'));if(!value||Array.isArray(value)||typeof value!=='object')throw Error('Expected a JSON object.');return value;
}
export function validatePipeline(snapshot:PipelineSnapshot) {
  const {metadata:m}=snapshot;
  if(!pipelineRunners.includes(m.runner))throw Error('This workflow uses a retired built-in engine. Select a service workflow in Settings → Generation.');
  if(snapshot.kind==='upscale'&&(m.runner!=='comfyui'||!m.videoSource))throw Error('Upscaling requires a ComfyUI workflow with a videoSource binding.');
  if(m.videoSource&&(snapshot.kind!=='upscale'||m.runner!=='comfyui'||m.source||m.references))throw Error('Video inputs are only supported by ComfyUI upscaling workflows.');
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
      if(/Load(Image|Video|Audio)/i.test(node.class_type)&&!(node.class_type==='LoadVideo'&&m.videoSource?.node===id&&m.videoSource.field==='file'))throw Error('Use source/reference bindings for private uploaded media.');
      if(node.class_type==='SaveImage'||node.class_type==='SaveVideo')outputs.push({node:id,field:'filename_prefix'});
      else if(/save|upload|download|execute|shell/i.test(node.class_type))throw Error(`Unsupported file-writing node: ${node.class_type}.`);
      configs.set(id,node.inputs);
    }
  }
  for(const bindings of Object.values(m.bindings))for(const b of bindings)if(!configs.has(b.node)||['__proto__','prototype','constructor'].includes(b.field))throw Error('Invalid input binding.');
  for(const out of outputs)if(!m.bindings.output?.some(b=>b.node===out.node&&b.field===out.field))throw Error(`Bind every output to private job storage (${out.node}).`);
  if(snapshot.kind==='upscale'){
    if((snapshot.graph as Graph)[m.videoSource!.node]?.class_type!=='LoadVideo'||m.videoSource!.field!=='file')throw Error('Bind videoSource to a LoadVideo file input.');
    if(!outputs.length||outputs.some(out=>(snapshot.graph as Graph)[out.node].class_type!=='SaveVideo'))throw Error('Upscaling workflows must save a video.');
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
      const definition=await readDefinition(path.join(file.folder,file.meta));
      if(definition.runner==='local')throw Error('This placeholder uses a retired built-in upscaler. Restore the bundled workflows in Advanced → Workflow files, or replace it with a ComfyUI video workflow.');
      const metadata=pipelineMetadata.parse(definition);
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
  if(!snapshot)throw Error('Choose an available pipeline in Settings → Generation.');
  const runner=snapshot.metadata.runner;
  if(!settings().connections[runner])throw Error(`Connect ${connectionNames[runner]} before using this pipeline.`);
  return structuredClone(snapshot);
}
export async function pipelineStatus(snapshot:PipelineSnapshot,connection?:ConnectionStatus):Promise<PipelineStatus> {
  const {metadata:m,kind}=snapshot;
  const result:PipelineStatus={id:m.id,name:m.name,runner:m.runner,kind,description:m.description,default:m.default,controls:m.controls,supportsSource:!!m.source,maxReferences:m.references?.max||0,state:'missing',ready:false,detail:'',missing:[],canPrepare:false,revision:snapshot.revision};
  try{validatePipeline(snapshot);}catch(error){return {...result,state:'attention',detail:(error as Error).message};}
  // Keep catalog choices visible without probing services the user has not connected.
  if(connection&&(!connection.enabled||!connection.available))return {...result,state:'attention',detail:`Connect ${connectionNames[m.runner]} to use ${m.name}.`};
  const deps=dependencies(snapshot),missing:typeof deps=[];
  for(const d of deps)if(!await dependencyReady(snapshot,d))missing.push(d);
  result.missing=missing.map(d=>d.reference);result.canPrepare=!!snapshot.prepare||missing.length>0&&missing.every(d=>m.runner==='vpipe'?!!d.fetch&&!d.generated:!!d.url);
  if(m.runner==='comfyui'){
    let info;
    try{info=await (await comfyFetch('/object_info')).json();}
    catch{return {...result,state:'attention',canPrepare:false,detail:'Connect the protected ComfyUI service to check its nodes.'};}
    const graph=structuredClone(snapshot.graph) as Graph;
    const nodes=[...new Set(Object.values(graph).map(n=>n.class_type))];if(m.source||m.references)nodes.push('LoadImage');
    const absent=nodes.filter(n=>!info[n]);
    if(absent.length)return {...result,state:'attention',canPrepare:false,detail:`Install or update these nodes in ComfyUI, then restart it: ${absent.join(', ')}.`};
    try{resolveComfyDevices(graph,m,info);}catch(error){return {...result,state:'attention',canPrepare:false,detail:(error as Error).message};}
    for(const [id,node] of Object.entries(graph))for(const [field,value] of Object.entries(node.inputs)){
      if(m.videoSource?.node===id&&m.videoSource.field===field)continue; // Uploaded per job, never a shared input file.
      const reference=comfyModelReference(node,field);
      if(reference&&missing.some(d=>d.reference===reference))continue; // Missing models must keep their download action.
      const options=comfyOptions(info,node.class_type,field);
      if(options&&!Array.isArray(value)&&!options.includes(value))return {...result,state:'attention',canPrepare:false,detail:`Refresh ComfyUI’s available models or update ${node.class_type}: ${field} is unavailable.`};
    }
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
  for(const p of list.entries)statuses.push(await pipelineStatus(p,state.connections?.[p.metadata.runner]||{enabled:false,available:false,detail:''}));
  const capabilities={...state.capabilities!};
  for(const kind of pipelineKinds){const p=statuses.find(p=>p.id===selections[kind]&&p.kind===kind),connection=p?.runner,c=connection&&state.connections?.[connection];const tools=kind==='image'||!!state.checks.find(c=>c.id==='ffmpeg')?.ready;
    capabilities[kind]={configured:!!selections[kind],connection,ready:!!p?.ready&&(!connection||!!c&&c.enabled&&c.available)&&tools,detail:!p?'Choose a pipeline in Settings → Generation.':connection&&(!c?.enabled||!c.available)?`Connect ${connectionNames[connection]} to use ${p.name}.`:!tools?`Video tools need setup. ${state.checks.find(c=>c.id==='ffmpeg')?.detail||''}`.trim():p.detail};
  }
  return {...state,pipelineLibrary,upscalerSupported:!!statuses.find(p=>p.kind==='upscale'),pipelines:statuses,pipelineSelections:selections,pipelineErrors:list.errors,capabilities,upscalerReady:capabilities.upscale.ready};
}
