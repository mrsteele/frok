import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createLibraryFixture } from './fixtures/library';
import { writeLora, writeReferenceTurbo } from './fixtures/lora.mjs';
import { defaultAdapters, turboAdapters } from '../src/lib/adapters';
const directory=await fs.mkdtemp(path.join(process.cwd(),'.data/adapter-test-'));
Object.assign(process.env,{FROK_DATA_DIR:directory,VPIPE_WORKDIR:path.join(directory,'workspace')});
const fixture=await createLibraryFixture(),{test,after}=fixture;
const {installedAdapters,validateInstalledAdapters}=await import('../src/lib/installed-adapters');
const store=await import('../src/lib/db');
const routes=await import('../src/app/api/[[...segments]]/route');
const models=path.join(process.env.VPIPE_WORKDIR!,'models');
const call=(method:'GET'|'PATCH',endpoint:string,body?:unknown)=>routes[method](fixture.request(`http://localhost:3000/api/${endpoint}`,{method,body:body?JSON.stringify(body):undefined}),{params:Promise.resolve({segments:[endpoint]})});
after(async()=>{fixture.close();await fs.rm(directory,{recursive:true,force:true});});

test('discovers complete LoRA metadata in model subfolders while excluding base weights, incomplete downloads and symlinks',async()=>{
  await writeLora(path.join(models,'styles/paint.safetensors'));
  await writeReferenceTurbo(process.env.VPIPE_WORKDIR!);
  await writeLora(path.join(models,turboAdapters.video.file));
  await fs.writeFile(path.join(models,'partial.safetensors'),'incomplete');
  const header=JSON.stringify({'model.weight':{dtype:'U8',shape:[1,1],data_offsets:[0,1]}}),size=Buffer.alloc(8);size.writeBigUInt64LE(BigInt(header.length));
  await fs.writeFile(path.join(models,'base.safetensors'),Buffer.concat([size,Buffer.from(header),Buffer.alloc(1)]));
  await writeLora(path.join(fixture.mediaDir,'private.safetensors'));
  await fs.symlink(fixture.mediaDir,path.join(models,'private-link'));
  const result=await installedAdapters();
  assert.deepEqual(result.adapters.map(item=>item.value).sort(),[turboAdapters.video.file,turboAdapters.reference.file,'styles/paint.safetensors'].sort());
  assert.equal(result.adapters.find(item=>item.value===turboAdapters.reference.file)?.profile,'reference');
  assert.equal(result.truncated,false);
});

test('validation rejects unrelated files, incompatible profiles and ordinary model tensors',async()=>{
  for(const primary of ['../private.safetensors','private-link/private.safetensors','base.safetensors',turboAdapters.reference.file])await assert.rejects(validateInstalledAdapters('video',{...defaultAdapters,primary}));
  await validateInstalledAdapters('video',{...defaultAdapters,primary:'styles/paint.safetensors'});
  await validateInstalledAdapters('reference',defaultAdapters,true);
  await fs.truncate(path.join(models,'styles/paint.safetensors'),9);
  await assert.rejects(validateInstalledAdapters('video',{...defaultAdapters,primary:'styles/paint.safetensors'}));
  await writeLora(path.join(models,'styles/paint.safetensors'));
});

test('legacy adapters remain private and cannot be changed by the removed browser controls',async()=>{
  const job=store.createJob({kind:'generate',runner:'vpipe',total:1,request:{mode:'video',prompt:'Synthetic boat',aspect:'1:1',duration:6,quality:'preview',count:1,enhance:false,referenceIds:[],adapters:{...defaultAdapters}}});
    const saved={...defaultAdapters,primary:'styles/paint.safetensors',primaryWeight:.5};store.setValue('videoAdapters',saved);
    assert.equal((await call('PATCH','settings',{videoAdapters:defaultAdapters})).status,400);
    assert.deepEqual(store.settings().videoAdapters,saved);
    assert.deepEqual((store.getJob(job.id)!.request as {adapters:unknown}).adapters,defaultAdapters);
});
