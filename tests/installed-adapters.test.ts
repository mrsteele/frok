import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createLibraryFixture } from './fixtures/library';
import { defaultAdapters } from '../src/lib/adapters';
const directory=await fs.mkdtemp(path.join(process.cwd(),'.data/adapter-test-'));
Object.assign(process.env,{FROK_DATA_DIR:directory,VPIPE_WORKDIR:path.join(directory,'workspace')});
const fixture=await createLibraryFixture(),{test,after}=fixture;
const store=await import('../src/lib/db');
const routes=await import('../src/app/api/[[...segments]]/route');
const call=(method:'GET'|'PATCH',endpoint:string,body?:unknown)=>routes[method](fixture.request(`http://localhost:3000/api/${endpoint}`,{method,body:body?JSON.stringify(body):undefined}),{params:Promise.resolve({segments:[endpoint]})});
after(async()=>{fixture.close();await fs.rm(directory,{recursive:true,force:true});});

test('the retired LoRA picker endpoint no longer enumerates model folders',async()=>{
  store.setValue('connections',{vpipe:true,comfyui:false,ollama:false});
  assert.equal((await call('GET','adapters')).status,404);
});

test('legacy adapters remain private and cannot be changed by the removed browser controls',async()=>{
  const job=store.createJob({kind:'generate',runner:'vpipe',total:1,request:{mode:'video',prompt:'Synthetic boat',aspect:'1:1',duration:6,quality:'preview',count:1,enhance:false,referenceIds:[],adapters:{...defaultAdapters}}});
    const saved={...defaultAdapters,primary:'styles/paint.safetensors',primaryWeight:.5};store.setValue('videoAdapters',saved);
    assert.equal((await call('PATCH','settings',{videoAdapters:defaultAdapters})).status,400);
    assert.deepEqual(store.settings().videoAdapters,saved);
    assert.deepEqual((store.getJob(job.id)!.request as {adapters:unknown}).adapters,defaultAdapters);
});
