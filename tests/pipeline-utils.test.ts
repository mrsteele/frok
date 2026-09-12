import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { crc32 } from 'node:zlib';
import type { PipelineSnapshot } from '../src/lib/pipelines/schema';

const directory=await fs.mkdtemp(path.join(process.cwd(),'.data/pipeline-utils-test-'));
process.env.FROK_DATA_DIR=directory;
const {createLibraryFixture}=await import('./fixtures/library');
const fixture=await createLibraryFixture(),{test,after}=fixture;
const {buildPipelineBundle,zipFiles}=await import('../src/lib/pipelines/utils');
const {diskCatalog,validatePipeline}=await import('../src/lib/pipelines/catalog');
const {bindPipeline}=await import('../src/lib/pipelines/bindings');
const {pipelineMetadata}=await import('../src/lib/pipelines/schema');
const routes=await import('../src/app/api/[[...segments]]/route');
const db=await import('../src/lib/db');
after(async()=>{fixture.close();await fs.rm(directory,{recursive:true,force:true});});

async function template(id:string){const p=(await diskCatalog()).entries.find(p=>p.metadata.id===id);assert.ok(p);return p;}
function unpack(result:Awaited<ReturnType<typeof buildPipelineBundle>>,kind:PipelineSnapshot['kind']):PipelineSnapshot {
  const read=(suffix:string)=>JSON.parse(result.files.find(f=>f.name.endsWith(suffix))!.content);
  const metadata=pipelineMetadata.parse(read('/meta.json')),ext=metadata.runner==='vpipe'?'vpipeline':'json';
  return {kind,metadata,graph:read(`/run.${ext}`),prepare:read(`/prepare.${ext}`),revision:'test'};
}
const input={request:{mode:'video' as const,prompt:'A boat',aspect:'1:1',duration:6,quality:'preview' as const,count:1,enhance:false,referenceIds:[]},prompt:'A boat in motion',seed:739,width:512,height:384,output:'private/output.mp4',directory:'private',references:[]};

test('every bundled native workflow exports a discoverable complete folder with working bindings',async()=>{
  const exported=path.join(directory,'exports');await fs.mkdir(exported);
  const templates=(await diskCatalog()).entries.filter(p=>p.metadata.runner!=='local');
  for(const source of templates) {
    const before=structuredClone(source);
    const result=await buildPipelineBundle({name:source.metadata.name,kind:source.kind,runner:source.metadata.runner,graph:source.graph});
    assert.equal(result.files.length,4);assert.deepEqual(result.unresolved,[],source.metadata.id);
    for(const file of result.files){const target=path.join(exported,file.name);await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,file.content);}
    const p=unpack(result,source.kind);validatePipeline(p);
    assert.deepEqual(p.metadata.bindings,source.metadata.bindings,source.metadata.id);
    assert.deepEqual(p.metadata.source,source.metadata.source);assert.deepEqual(p.metadata.references,source.metadata.references);
    const graph=bindPipeline(p,{...input,...(p.metadata.source?{source:'private/first-frame.png'}:{}),references:p.metadata.references?['private/reference.png']:[]});
    for(const b of p.metadata.bindings.prompt||[]){const config=p.metadata.runner==='vpipe'?(graph.stages as any[]).find(s=>s.id===b.node).config:(graph[b.node] as any).inputs;assert.equal(config[b.field],input.prompt);}
    assert.deepEqual(source,before,'Export must not mutate its source.');
  }
  const catalog=await diskCatalog(exported);assert.deepEqual(catalog.errors,[]);assert.equal(catalog.entries.length,7);
});

test('Krea exports use just the base model with no hidden adapters or projector edits',async()=>{
  const source=await template('vpipe:krea-2-turbo');
  assert.deepEqual(source.metadata.dependencies.map(d=>d.reference),['krea/Krea-2-Turbo']);
  const stages=source.graph.stages as any[];assert.equal(stages.find(s=>s.type==='generate-image').config.dit_dir,undefined);
  assert.ok(stages.every(s=>!s.config.lora&&!s.config.lora2));assert.doesNotMatch(JSON.stringify(source.graph),/--preview/);
  assert.deepEqual((source.prepare!.stages as any[]).map(s=>s.type),['model-fetch']);
  const result=await buildPipelineBundle({name:'My Krea',kind:'image',runner:'vpipe',graph:source.graph});
  const p=unpack(result,'image');assert.deepEqual(p.metadata.dependencies,source.metadata.dependencies);
  assert.deepEqual((p.prepare!.stages as any[]).map(s=>[s.type,s.config.model_path]),[['model-fetch','krea/Krea-2-Turbo']]);
});

test('ComfyUI prompt inference follows positive conditioning after node renaming and preserves negative and LoRA strengths',async()=>{
  const p=await template('comfyui:sdxl-turbo'),graph=p.graph as Record<string,any>;
  graph['3'].inputs.text='No blurry images';graph['adapter']={class_type:'LoraLoader',inputs:{lora_name:'custom.safetensors',strength_model:.37,strength_clip:.19,model:['1',0],clip:['1',1]}};
  graph['5'].inputs.model=['adapter',0];
  const renamed=Object.fromEntries(Object.entries(graph).map(([id,node])=>['node-'+id,{...node,inputs:Object.fromEntries(Object.entries(node.inputs).map(([field,value])=>[field,Array.isArray(value)?['node-'+value[0],value[1]]:value]))}]));
  const result=await buildPipelineBundle({name:'Renamed',kind:'image',runner:'comfyui',graph:renamed});
  assert.ok(result.unresolved.some(s=>s.includes('loras/custom.safetensors')));
  const draft=unpack(result,'image'),bound=bindPipeline(draft,input) as Record<string,any>;
  assert.deepEqual(draft.metadata.bindings.prompt,[{node:'node-2',field:'text'}]);
  assert.equal(bound['node-3'].inputs.text,'No blurry images');assert.equal(bound['node-adapter'].inputs.strength_model,.37);assert.equal(bound['node-adapter'].inputs.strength_clip,.19);
  assert.equal(bound['node-5'].inputs.steps,4);assert.equal(bound['node-5'].inputs.seed,input.seed);
});

test('unknown fused models receive explicit preparation and readiness notes without invented downloads',async()=>{
  const source=await template('vpipe:krea-2-turbo');
  (source.graph.stages as any[]).find(s=>s.type==='generate-image').config.dit_dir='models/custom/my-fused-model';
  const result=await buildPipelineBundle({name:'Custom fusion',kind:'image',runner:'vpipe',graph:source.graph}),p=unpack(result,'image');
  assert.ok(result.unresolved.some(s=>s.includes('custom/my-fused-model')&&s.includes('download source')));
  assert.ok(result.unresolved.some(s=>s.includes('required files')));
  assert.equal((p.prepare!.stages as any[]).length,1);assert.equal(p.metadata.dependencies.find(d=>d.reference==='custom/my-fused-model')!.fetch,undefined);
});

test('MiniMax preparation is reused only when its requested adapters also match',async()=>{
  const source=await template('vpipe:minimax-h3-turbo');
  const model=(source.graph.stages as any[]).find(s=>s.type==='minimax-h3-model-config');delete model.config.lora;
  const result=await buildPipelineBundle({name:'No turbo',kind:'video',runner:'vpipe',graph:source.graph}),p=unpack(result,'video');
  assert.ok(result.unresolved.some(s=>s.includes('custom fusion or quantization')));
  assert.deepEqual(p.prepare!.stages,[],'Do not silently prepare an adapter that the uploaded workflow removed.');
});

test('unmapped positive prompts and private file loaders are clearly flagged for manual review',async()=>{
  const source=await template('comfyui:sdxl-turbo'),graph=source.graph as Record<string,any>;
  graph['5'].inputs.positive=['3',0]; // Same text node used for negative conditioning.
  graph['extra']={class_type:'LoadImage',inputs:{image:'old-image.png'}};
  const result=await buildPipelineBundle({name:'Needs work',kind:'image',runner:'comfyui',graph});
  assert.ok(result.unresolved.some(s=>s.includes('negative conditioning')));assert.ok(result.unresolved.some(s=>s.includes('private uploaded media')));
  assert.equal(unpack(result,'image').metadata.bindings.prompt,undefined);
});

test('ZIP paths are safe and portable; every file and checksum round-trips',async()=>{
  const graph=(await template('vpipe:krea-2-turbo')).graph;
  const result=await buildPipelineBundle({name:'../../My café \\ test',kind:'image',runner:'vpipe',graph});
  assert.match(result.folder,/^image\/[a-z0-9-]+\.local$/);
  const zip=zipFiles(result.files);let offset=0;
  for(const file of result.files){assert.equal(zip.readUInt32LE(offset),0x04034b50);const size=zip.readUInt32LE(offset+18),nameLength=zip.readUInt16LE(offset+26),start=offset+30+nameLength;
    assert.equal(zip.subarray(offset+30,start).toString(),file.name);const data=zip.subarray(start,start+size);assert.equal(data.toString(),file.content);assert.equal(crc32(data),zip.readUInt32LE(offset+14));offset=start+size;}
  assert.equal(zip.readUInt32LE(offset),0x02014b50);
  const changed=await buildPipelineBundle({name:'Another pipeline',kind:'image',runner:'vpipe',graph});assert.notEqual(changed.folder,result.folder);
});

test('utility API is read-only, works with no connections, and removes both obsolete endpoints',async()=>{
  const input={name:'API test',kind:'image',runner:'vpipe',graph:(await template('vpipe:krea-2-turbo')).graph};
  const before={settings:db.settings(),jobs:db.listJobs()};
  const request=(endpoint:string,body:unknown)=>routes.POST(fixture.request(`http://localhost:3000/api/${endpoint}`,{method:'POST',body:JSON.stringify(body)}),{params:Promise.resolve({segments:endpoint.split('/')})});
  const response=await request('utils/pipeline',input);assert.equal(response.status,200,await response.clone().text());
  const result=await response.json();assert.equal(Buffer.from(result.base64,'base64').readUInt32LE(),0x04034b50);assert.match(result.filename,/\.zip$/);assert.deepEqual(result.unresolved,[]);
  assert.deepEqual({settings:db.settings(),jobs:db.listJobs()},before);
  assert.equal((await request('utils/krea',input)).status,404);assert.equal((await request('utils/prepare',input)).status,404);
  assert.equal((await request('utils/pipeline',{...input,kind:'../../outside'})).status,400);
  assert.equal((await request('utils/pipeline',{...input,runner:'comfyui',graph:{nodes:[]}})).status,400);
  await assert.rejects(buildPipelineBundle({...input,graph:{stages:[null]}}),/native Vpipe/);
  await assert.rejects(buildPipelineBundle({...input,kind:'video'}),/Choose Images/);
  await assert.rejects(buildPipelineBundle({...input,graph:(await template('vpipe:minimax-h3-turbo')).graph}),/Choose Videos/);
});
