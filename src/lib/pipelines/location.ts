import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { root, pipelineHome, defaultPipelinesDir, pipelineTemplatesDir } from '../paths';
import { expandPath } from '../config';
import { pipelineDirectory, pipelineDirectorySetting, setValue } from '../db';
import { HttpError } from '../request-security';
import { resetPipelines } from '../../../desktop/workspace.mjs';
import { diskCatalog } from './catalog';
import { dependencies } from './dependencies';

export type PipelineLibrary={configured:string;path:string;defaultPath:string;counts:{vpipe:number;comfyui:number;local:number};errors:string[];warnings:string[]};

export async function pipelineLibraryAudit(list?:Awaited<ReturnType<typeof diskCatalog>>):Promise<PipelineLibrary> {
  list??=await diskCatalog();
  const counts={vpipe:0,comfyui:0,local:0},warnings:string[]=[];
  for(const entry of list.entries){
    counts[entry.metadata.runner]++;
    if(entry.metadata.runner!=='local'&&!entry.prepare&&dependencies(entry).some(d=>d.generated||(entry.metadata.runner==='vpipe'?!d.fetch:!d.url)))
      warnings.push(`${entry.metadata.name}: no prepare companion or complete download instructions. Install its dependencies manually or add a prepare file.`);
  }
  return {configured:pipelineDirectorySetting(),path:pipelineDirectory(),defaultPath:defaultPipelinesDir,counts,errors:list.errors,warnings};
}

export async function savePipelineDirectory(value:string,signal:AbortSignal) {
  value=value.trim();
  if(value&&(/[\x00-\x1f\x7f]/.test(value)||(!path.isAbsolute(value)&&!/^~[/\\]/.test(value))))throw new HttpError(400,'Enter a full folder path, or leave it empty to use the default.');
  const selected=value?expandPath(value):defaultPipelinesDir;
  try {if(!(await fs.stat(selected)).isDirectory())throw Error();await fs.access(selected,constants.R_OK|constants.X_OK);}
  catch{throw new HttpError(400,'This pipeline folder is missing or unreadable. Choose an existing folder, or restore the default pipelines.');}
  const before=pipelineDirectorySetting(),list=await diskCatalog(selected);
  signal.throwIfAborted();
  if(pipelineDirectorySetting()!==before)throw new HttpError(409,'The pipeline location changed during the check. Refresh and try again.');
  setValue('pipelineDirectory',value?selected:'');
  return pipelineLibraryAudit(list);
}

export async function resetDefaultPipelines() {
  const groups=JSON.parse(await fs.readFile(path.join(root,'desktop/pipelines.json'),'utf8'));
  const pkg=await fs.readFile(path.join(root,'frok-package.json'),'utf8').catch(()=>fs.readFile(path.join(root,'package.json'),'utf8'));
  await resetPipelines({home:pipelineHome,templates:pipelineTemplatesDir,groups,version:JSON.parse(pkg).version});
  return pipelineLibraryAudit();
}
