import fs from 'node:fs/promises';
import path from 'node:path';
import { digest, readDefinition } from './definition';
import { preparationFor } from './builtins';
import { settings, pipelineDirectory } from '../db';
import { pipelineKinds, pipelineMetadata, type PipelineKind, type PipelineSnapshot, type PipelineStatus } from './schema';
import { dependencies, dependencyReady } from './dependencies';
import { providerFor } from '../providers/registry';
import { providerDefinitions } from '../providers/definitions';
import type { InspectionContext } from '../providers/types';
import type { Health } from '../types';
import { connectionNames, type ConnectionStatus } from '../service-config';
import { dependencyRepository, downloadAccess, requiredGatedDownloads } from './download-access';
import { cachedDownloadAccess } from '../providers/huggingface-access';

export { digest, readDefinition } from './definition';
export function validatePipeline(snapshot:PipelineSnapshot) {
  providerFor(snapshot.metadata.runner).validate(snapshot);
}
export async function diskCatalog(base=pipelineDirectory()) {
  const entries:PipelineSnapshot[]=[],errors:string[]=[];
  try {if(!(await fs.stat(base)).isDirectory())throw Error('Not a folder.');}
  catch{return {entries,errors:['The pipeline folder is missing or unreadable. Check its location or restore the defaults.']};}
  for(const kind of pipelineKinds){
    const directory=path.join(base,kind),files=await fs.readdir(directory,{withFileTypes:true}).catch(error=>{if(error.code!=='ENOENT')errors.push(`${kind}: folder is unreadable.`);return [];});
    const definitions = files.filter(f=>f.isDirectory()&&!f.isSymbolicLink()).map(f=>({name:f.name,folder:path.join(directory,f.name),meta:'meta.json',base:'run'}));
    // Read old flat custom workflows during upgrades; bundled workflows use folders.
    definitions.push(...files.filter(f=>f.isFile()&&f.name.endsWith('.meta.json')).map(f=>({name:f.name,folder:directory,meta:f.name,base:f.name.slice(0,-10)})));
    for(const file of definitions.sort((a,b)=>a.name.localeCompare(b.name)))try{
      const definition=await readDefinition(path.join(file.folder,file.meta));
      if(definition.runner==='local')throw Error('This placeholder uses a retired built-in upscaler. Restore the bundled workflows in Advanced → Workflow files, or replace it with a ComfyUI video workflow.');
      const metadata=pipelineMetadata.parse(definition);
      const extension=providerDefinitions[metadata.runner].extension;
      const graph=await readDefinition(path.join(file.folder,file.base+extension));
      const snapshot:PipelineSnapshot={metadata,kind,graph,revision:digest([metadata,graph])};
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
export async function pipelineStatus(snapshot:PipelineSnapshot,connection?:ConnectionStatus,context?:InspectionContext):Promise<PipelineStatus> {
  const {metadata:m,kind}=snapshot;
  const result:PipelineStatus={id:m.id,name:m.name,runner:m.runner,kind,description:m.description,default:m.default,controls:m.controls,supportsSource:!!m.source,requiresSource:m.source?.required,maxReferences:m.references?.max||0,state:'missing',ready:false,detail:'',missing:[],revision:snapshot.revision,catalog:m.catalog};
  result.downloadAccess=downloadAccess('unknown');
  try{validatePipeline(snapshot);}catch(error){return {...result,state:'attention',detail:(error as Error).message};}
  const deps=dependencies(snapshot),missing:typeof deps=[];
  result.files=deps.map(d=>({reference:d.reference,ready:false,size:d.size,url:d.url,repository:dependencyRepository(d,m.runner)}));
  // Keep catalog choices visible without probing services the user has not connected.
  if(connection&&(!connection.enabled||!connection.available))return {...result,state:'attention',detail:`Connect ${connectionNames[m.runner]} to use ${m.name}.`};
  for(const d of deps)if(!await dependencyReady(snapshot,d))missing.push(d);
  result.missing=missing.map(d=>d.reference);
  result.files=deps.map(d=>({reference:d.reference,ready:!missing.includes(d),size:d.size,url:d.url,repository:dependencyRepository(d,m.runner)}));
  result.downloadAccess=cachedDownloadAccess(requiredGatedDownloads(result));
  result.preparation=missing.length?await preparationFor(snapshot):undefined;
  const issue=await providerFor(m.runner).inspect(snapshot,missing,context);
  if(issue)return {...result,state:'attention',detail:issue};
  result.ready=missing.length===0;result.state=result.ready?'ready':'missing';
  result.detail=result.ready?'All declared dependencies are installed.':`${m.name}: Install the missing dependencies in ${connectionNames[m.runner]}: ${result.missing.join(', ')}. Then refresh workflows in Frok.`;
  return result;
}
export async function pipelineHealth(state:Health):Promise<Health> {
  const list=await catalog(),selections=settings().pipelineSelections,statuses:PipelineStatus[]=[];
  const {pipelineLibraryAudit}=await import('./location');
  const pipelineLibrary=await pipelineLibraryAudit(list);
  const context:InspectionContext={responses:new Map()};
  for(const p of list.entries)statuses.push(await pipelineStatus(p,state.connections?.[p.metadata.runner]||{enabled:false,available:false,detail:''},context));
  const capabilities={...state.capabilities!};
  for(const kind of pipelineKinds){const p=statuses.find(p=>p.id===selections[kind]&&p.kind===kind),connection=p?.runner,c=connection&&state.connections?.[connection];const tools=kind==='image'||!!state.checks.find(c=>c.id==='ffmpeg')?.ready;
    capabilities[kind]={configured:!!selections[kind],connection,ready:!!p?.ready&&(!connection||!!c&&c.enabled&&c.available)&&tools,detail:!p?'Choose a pipeline in Settings → Generation.':connection&&(!c?.enabled||!c.available)?`Connect ${connectionNames[connection]} to use ${p.name}.`:!tools?`Video tools need setup. ${state.checks.find(c=>c.id==='ffmpeg')?.detail||''}`.trim():p.detail};
  }
  return {...state,pipelineLibrary,upscalerSupported:!!statuses.find(p=>p.kind==='upscale'),pipelines:statuses,pipelineSelections:selections,pipelineErrors:list.errors,capabilities,upscalerReady:capabilities.upscale.ready};
}
