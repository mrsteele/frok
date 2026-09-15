import path from 'node:path';
import folders from '../../../desktop/preparations.json';
import { pipelineTemplatesDir } from '../paths';
import { pipelineMetadata, type PipelineKind, type PipelineSnapshot } from './schema';
import { digest, readDefinition } from './definition';

// Only shipped starters are executable. Editable/custom preparation companions
// are never read, and a modified generation workflow keeps manual setup guidance.
async function builtin(folder:string) {
  if (!folders.includes(folder)) throw Error('Choose an available built-in preparation.');
  const base=path.join(pipelineTemplatesDir,folder);
  const metadata=pipelineMetadata.parse(await readDefinition(path.join(base,'meta.json')));
  const graph=await readDefinition(path.join(base,'run.vpipeline'));
  return {folder,snapshot:{metadata,graph,kind:folder.split('/')[0] as PipelineKind,revision:digest([metadata,graph])}};
}
export async function preparationFor(snapshot:PipelineSnapshot) {
  if(snapshot.metadata.runner!=='vpipe')return;
  for(const folder of folders) {
    const starter=await builtin(folder);
    if(starter.snapshot.kind===snapshot.kind&&starter.snapshot.revision===snapshot.revision)return folder;
  }
}
export async function builtinPreparation(folder:string) {
  const starter=await builtin(folder);
  return {...starter,graph:await readDefinition(path.join(pipelineTemplatesDir,folder,'prepare.vpipeline'))};
}
