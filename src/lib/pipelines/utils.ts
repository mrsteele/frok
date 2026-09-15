import { z } from 'zod';
import { crc32 } from 'node:zlib';
import { diskCatalog, digest, validatePipeline } from './catalog';
import { dependencies } from './dependencies';
import { pipelineMetadata, type PipelineSnapshot } from './schema';
import { pipelineTemplatesDir } from '../paths';
import { inferBindings } from './infer-bindings';

export type UtilityFile={name:string;content:string};
export function zipFiles(files:UtilityFile[]) {
  const local:Buffer[]=[],central:Buffer[]=[];let offset=0;
  for(const file of files){const name=Buffer.from(file.name),data=Buffer.from(file.content),crc=crc32(data),header=Buffer.alloc(30),directory=Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);header.writeUInt16LE(20,4);header.writeUInt32LE(crc,14);header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);
    directory.writeUInt32LE(0x02014b50);directory.writeUInt16LE(20,4);directory.writeUInt16LE(20,6);directory.writeUInt32LE(crc,16);directory.writeUInt32LE(data.length,20);directory.writeUInt32LE(data.length,24);directory.writeUInt16LE(name.length,28);directory.writeUInt32LE(offset,42);
    local.push(header,name,data);central.push(directory,name);offset+=header.length+name.length+data.length;
  }
  const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...local,directory,end]);
}
const bundleInput=z.object({
  name:z.string().trim().min(1).max(80),
  kind:z.enum(['image','video','reference','upscale']),
  runner:z.enum(['vpipe','comfyui']),
  graph:z.record(z.string(),z.unknown()),
}).strict();
const serialize=(value:unknown)=>JSON.stringify(value,null,2)+'\n';

export async function buildPipelineBundle(input:unknown) {
  const value=bundleInput.parse(input);
  const slug=value.name.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60)||'pipeline';
  const key=digest(value).slice(0,10),stem=`${slug}-${key}.local`,folder=`${value.kind}/${stem}`;
  const snapshot:PipelineSnapshot={kind:value.kind,graph:structuredClone(value.graph),revision:key,metadata:pipelineMetadata.parse({
    version:1,id:`${value.runner}:user-${slug}-${key}`,name:value.name,runner:value.runner,
    description:'Created with Frok Utilities. Review the companion REVIEW.txt before use.',
  })};
  const unresolved=inferBindings(snapshot);
  const [factory,installed]=await Promise.all([diskCatalog(pipelineTemplatesDir),diskCatalog()]);
  const known=[...factory.entries,...installed.entries].filter(p=>p.metadata.runner===value.runner).flatMap(p=>dependencies(p));
  const inferred=dependencies(snapshot);
  snapshot.metadata.dependencies=inferred.map(d=>structuredClone(known.find(k=>k.kind===d.kind&&k.reference===d.reference)||d));
  const deps=snapshot.metadata.dependencies;
  for(const d of deps)if(!d.url&&!d.fetch&&!d.generated)unresolved.push(`${d.reference}: download source is unknown; install the correct files in your runner.`);
  if(!deps.length)unresolved.push('No supported model-loader dependencies were found. Declare the required models and custom-node requirements.');
  for(const d of deps)if(value.runner==='vpipe'&&d.kind!=='lora'&&!d.layout&&!d.files.length)unresolved.push(`${d.reference}: declare its model layout or required files in meta.json so Frok can verify installation.`);
  snapshot.metadata=pipelineMetadata.parse(snapshot.metadata);
  try{validatePipeline(snapshot);}catch(error){unresolved.push(`Frok registration: ${(error as Error).message}`);}
  const extension=value.runner==='vpipe'?'vpipeline':'json';
  const review=[
    `${value.name} — Frok pipeline folder`,
    `Extract this archive into your configured pipeline location (default: ~/frok/pipelines).`,
    `It creates ${folder}/. Keep run.${extension} and meta.json together.`,
    'Review the files, then refresh Settings → Generation and select the new pipeline.',
    'This utility does not execute workflows, download models or modify the pipeline catalog.',
    '',
    unresolved.length?'Needs review before use:\n'+unresolved.map(s=>'- '+s).join('\n'):'Known inputs and dependencies were mapped. Review the workflow and install its dependencies in your runner.',
    '',
    'Required dependencies (install outside Frok):',
    ...deps.map(d=>`- ${d.reference}${d.url?`: ${d.url}`:d.fetch?`: ${d.fetch.model}`:''}`),
    '',
    'Input bindings:',
    ...Object.entries(snapshot.metadata.bindings).map(([key,bindings])=>`- ${key}: ${bindings.map(b=>`${b.node}.${b.field}`).join(', ')}`),
    '',
    'Sampler settings and adapter strengths are retained from the uploaded workflow. Output paths are made portable; Frok supplies its own job paths at generation time.',
    'Install models and custom nodes in the runner before using this workflow. Frok does not create or run preparation scripts.',
    'If the workflow requires unsupported inputs, add or fix the bindings in meta.json. Frok will report invalid definitions when you refresh. This draft is not an inference or memory-compatibility test.',
    '',
  ].join('\n');
  const files:UtilityFile[]=[
    {name:`${folder}/run.${extension}`,content:serialize(snapshot.graph)},
    {name:`${folder}/meta.json`,content:serialize(snapshot.metadata)},
    {name:`${folder}/REVIEW.txt`,content:review},
  ];
  return {files,unresolved,folder,filename:`${stem}.zip`};
}
