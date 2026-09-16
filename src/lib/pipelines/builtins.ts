import path from 'node:path';
import { z } from 'zod';
import folders from '../../../desktop/preparations.json';
import { pipelineTemplatesDir } from '../paths';
import { providerDefinitions } from '../providers/definitions';
import { dependencySchema, pipelineMetadata, type PipelineKind, type PipelineSnapshot } from './schema';
import { digest, readDefinition } from './definition';

const filePlan = z.object({ version: z.literal(1), files: z.array(dependencySchema).min(1).max(100) }).strict();

// Only the application's bundled preparations may execute. Editable companions
// are never read, and a modified generation workflow keeps manual setup guidance.
async function builtin(folder: string) {
  if (!folders.includes(folder)) throw Error('Choose an available built-in preparation.');
  const base = path.join(pipelineTemplatesDir, folder);
  const metadata = pipelineMetadata.parse(await readDefinition(path.join(base, 'meta.json')));
  const graph = await readDefinition(path.join(base, 'run' + providerDefinitions[metadata.runner].extension));
  const snapshot: PipelineSnapshot = { metadata, graph, kind: folder.split('/')[0] as PipelineKind, revision: digest([metadata, graph]) };
  return { folder, snapshot };
}

let starters: Promise<Awaited<ReturnType<typeof builtin>>[]> | undefined;
export async function preparationFor(snapshot: PipelineSnapshot) {
  starters ??= Promise.all(folders.map(builtin));
  const revision = digest([snapshot.metadata, snapshot.graph]);
  return (await starters).find(starter => starter.snapshot.kind === snapshot.kind && starter.snapshot.revision === revision)?.folder;
}

export async function builtinPreparation(folder: string) {
  const starter = await builtin(folder);
  const base = path.join(pipelineTemplatesDir, folder);
  if (providerDefinitions[starter.snapshot.metadata.runner].setup === 'native') {
    const graph = await readDefinition(path.join(base, 'prepare.vpipeline'));
    return { ...starter, graph, files: undefined, revision: digest([starter.snapshot.revision, graph]) };
  }
  const { files } = filePlan.parse(await readDefinition(path.join(base, 'prepare.json')));
  if (files.some(file => !file.url || !file.sha256 || !file.size)) throw Error('Incomplete bundled download manifest.');
  if (digest(files) !== digest(starter.snapshot.metadata.dependencies)) throw Error('The bundled download manifest does not match the workflow dependencies.');
  return { ...starter, graph: undefined, files, revision: digest([starter.snapshot.revision, files]) };
}
