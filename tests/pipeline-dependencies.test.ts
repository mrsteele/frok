import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import type { PipelineSnapshot } from '../src/lib/pipelines/schema';

const directory=await fs.mkdtemp(path.join(process.cwd(),'.data/pipeline-dependencies-test-'));
process.env.FROK_DATA_DIR=directory;
process.env.VPIPE_WORKDIR=path.join(directory,'workspace');
process.env.COMFYUI_DIR=path.join(directory,'comfy');
const {createLibraryFixture}=await import('./fixtures/library');
const fixture=await createLibraryFixture(),{test,after}=fixture;
const {dependencyReady,comfyFile}=await import('../src/lib/pipelines/dependencies');
const {pipelineMetadata}=await import('../src/lib/pipelines/schema');
after(async()=>{fixture.close();await fs.rm(directory,{recursive:true,force:true});});
function snapshot():PipelineSnapshot {
 return {kind:'image',revision:'one',graph:{},metadata:pipelineMetadata.parse({version:1,id:'vpipe:fixture',name:'Fixture',runner:'vpipe'})};
}
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
test('externally prepared transformer models need no Frok receipt',async()=>{
 const p=snapshot(),dep={kind:'model' as const,reference:'fixture/external',layout:'transformer' as const,files:[],generated:true};
 const dir=path.join(process.env.VPIPE_WORKDIR!,'models',dep.reference);await fs.mkdir(dir,{recursive:true});
 const header=Buffer.from(JSON.stringify({a:{dtype:'F32',shape:[1],data_offsets:[0,4]}})),length=Buffer.alloc(8);length.writeBigUInt64LE(BigInt(header.length));
 await fs.writeFile(path.join(dir,'model.safetensors'),Buffer.concat([length,header,Buffer.alloc(4)]));
 await fs.writeFile(path.join(dir,'config.json'),'{}');
 assert.equal(await dependencyReady(p,dep),true);
 await assert.rejects(fs.stat(path.join(dir,'frok-prepared.json')));
});
test('read-only ComfyUI checks reject escaping symlinks',async()=>{
 const dir=path.join(process.env.COMFYUI_DIR!,'models');await fs.mkdir(dir,{recursive:true});
 await fs.symlink(directory,path.join(dir,'escape'));
 await assert.rejects(comfyFile('escape/private.txt'),/symlinks/);
});
