import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { PipelineSnapshot } from '../src/lib/pipelines/schema';

const directory=await fs.mkdtemp(path.join(process.cwd(),'.data/pipeline-prepare-test-'));
process.env.FROK_DATA_DIR=directory;
process.env.VPIPE_WORKDIR=path.join(directory,'workspace');
process.env.VPIPE_BIN=path.join(directory,'prepare-fixture.mjs');
process.env.COMFYUI_DIR=path.join(directory,'comfy');
const {createLibraryFixture}=await import('./fixtures/library');
const fixture=await createLibraryFixture(),{test,after}=fixture;
const {preparePipeline}=await import('../src/lib/pipelines/prepare');
const {dependencyReady,verifyFile,comfyFile}=await import('../src/lib/pipelines/dependencies');
const {pipelineMetadata}=await import('../src/lib/pipelines/schema');
const {queueSetup}=await import('../src/lib/connection-setup');
const db=await import('../src/lib/db');
await fs.writeFile(process.env.VPIPE_BIN!,`#!${process.execPath}
// Only a file-writing preparation fixture; no renderer, models or downloads.
import fs from 'node:fs';import path from 'node:path';
const graph=JSON.parse(fs.readFileSync(process.argv.at(-1),'utf8'));
fs.writeFileSync('last-prepare.json',JSON.stringify(graph));
for(const s of graph.stages)if(s.type==='model-fetch'&&s.config.model_path==='fixture/download'){
 const file=path.join('models',s.config.model_path,'weights.txt');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,'verified fixture');
}
`,{mode:0o700});
after(async()=>{fixture.close();await fs.rm(directory,{recursive:true,force:true});});
function snapshot(reference='fixture/download'):PipelineSnapshot {
 return {kind:'image',revision:'one',graph:{stages:[]},metadata:pipelineMetadata.parse({version:1,id:'vpipe:fixture',name:'Fixture',runner:'vpipe',dependencies:[{kind:'model',reference,files:['weights.txt'],fetch:{model:reference}}]}),prepare:{id:'expensive-companion',stages:[{id:'expensive',type:'model-quantize',config:{}}]}};
}
async function jobDirectory(name:string){const dir=path.join(fixture.jobsDir,name);await fs.mkdir(dir,{recursive:true});return dir;}
test('known missing downloads bypass expensive preparation; installed dependencies are reused',async()=>{
 const p=snapshot(),dir=await jobDirectory('reuse');
 await preparePipeline(p,dir,new AbortController().signal,()=>{});
 const graph=JSON.parse(await fs.readFile(path.join(process.env.VPIPE_WORKDIR!,'last-prepare.json'),'utf8'));
 assert.equal(graph.stages.length,1);assert.equal(graph.stages[0].type,'model-fetch');
 await fs.rm(path.join(process.env.VPIPE_WORKDIR!,'last-prepare.json'));
 const messages:string[]=[];await preparePipeline(p,dir,new AbortController().signal,line=>messages.push(line));
 assert.match(messages.join(''),/already installed and verified/);
 await assert.rejects(fs.stat(path.join(process.env.VPIPE_WORKDIR!,'last-prepare.json')));
});
test('a successful CLI exit cannot certify missing model files',async()=>{
 await assert.rejects(preparePipeline(snapshot('fixture/not-downloaded'),await jobDirectory('incomplete'),new AbortController().signal,()=>{}),/did not make this pipeline ready/);
});
test('preparation deduplicates only the same revision and snapshots remain unchanged',()=>{
 const original=snapshot(),first=queueSetup({task:'pipeline',pipeline:original});
 assert.equal(queueSetup({task:'pipeline',pipeline:structuredClone(original)}).id,first.id);
 const changed=structuredClone(original);changed.revision='two';changed.prepare!.id='changed';
 assert.notEqual(queueSetup({task:'pipeline',pipeline:changed}).id,first.id);
 assert.equal((db.getJob(first.id)!.request as {pipeline:PipelineSnapshot}).pipeline.prepare!.id,'expensive-companion');
});
test('partial sharded models and invalid indices cannot become Ready',async()=>{
 const p=snapshot(),dep={kind:'model' as const,reference:'fixture/sharded',layout:'transformer' as const,files:[],generated:false};
 const dir=path.join(process.env.VPIPE_WORKDIR!,'models',dep.reference);await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'config.json'),'{}');
 function tensor(name:string){const header=Buffer.from(JSON.stringify({[name]:{dtype:'F32',shape:[1],data_offsets:[0,4]}})),length=Buffer.alloc(8);length.writeBigUInt64LE(BigInt(header.length));return Buffer.concat([length,header,Buffer.alloc(4)]);}
 await fs.writeFile(path.join(dir,'model-00001-of-00002.safetensors'),tensor('a'));
 assert.equal(await dependencyReady(p,dep),false);
 await fs.writeFile(path.join(dir,'model-00002-of-00002.safetensors'),tensor('b'));
 assert.equal(await dependencyReady(p,dep),true);
 await fs.writeFile(path.join(dir,'model.safetensors.index.json'),JSON.stringify({weight_map:{missing:'model-00002-of-00002.safetensors'}}));
 assert.equal(await dependencyReady(p,dep),false);
});
test('checksums and ComfyUI download paths reject bad files and escaping symlinks',async()=>{
 const dir=path.join(process.env.COMFYUI_DIR!,'models');await fs.mkdir(dir,{recursive:true});
 const file=path.join(dir,'weights.bin');await fs.writeFile(file,'bad');
 await assert.rejects(verifyFile(file,{kind:'file',reference:'weights.bin',files:[],generated:false,sha256:createHash('sha256').update('good').digest('hex')},true),/Checksum/);
 await fs.symlink(directory,path.join(dir,'escape'));
 await assert.rejects(comfyFile('escape/private.txt',true),/symlinks/);
});
