import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { createLibraryFixture } from './fixtures/library';
import type { Job } from '../src/lib/types';

const directory=path.resolve('.data/builtin-preparation-test');
process.env.FROK_DATA_DIR=directory;
process.env.VPIPE_WORKDIR=path.join(directory,'vpipe');
process.env.VPIPE_BIN=path.resolve('tests/fixtures/prepare.mjs');
process.env.HF_TOKEN='hf_SyntheticPreparationToken';
const fixture=await createLibraryFixture(),{test,before,beforeEach,after}=fixture;
const store=await import('../src/lib/db');
const registry=await import('../src/lib/registry');
const {catalog,pipelineStatus,digest}=await import('../src/lib/pipelines/catalog');
const {preparationFor,builtinPreparation}=await import('../src/lib/pipelines/builtins');
const routes=await import('../src/app/api/[[...segments]]/route');
const id='vpipe:krea-2-turbo';
let worker:ChildProcess,logs='';
async function call(endpoint:string,input:unknown={}) {
  return routes.POST(fixture.request(`http://localhost:3000/api/${endpoint}`,{method:'POST',body:JSON.stringify(input)}),{params:Promise.resolve({segments:endpoint.split('/')})});
}
async function waitFor(check:()=>boolean) {
  for(let i=0;i<160;i++){if(check())return;await delay(50);}
  throw Error(`Worker timed out: ${logs}`);
}
async function enqueue() {
  const response=await call('pipelines/prepare',{id});
  assert.equal(response.status,201,await response.clone().text());
  return (await response.json()).job as Job;
}
before(async()=>{
  await fs.mkdir(process.env.VPIPE_WORKDIR!,{recursive:true});
  worker=spawn(process.execPath,['--import','tsx','src/worker/index.ts'],{env:process.env,stdio:['ignore','pipe','pipe']});
  worker.stdout?.on('data',chunk=>logs+=chunk);worker.stderr?.on('data',chunk=>logs+=chunk);
  await waitFor(()=>registry.serviceValue('workerHeartbeat',0)>0);
});
beforeEach(async()=>{
  await waitFor(()=>!registry.activeOperations().some(operation=>operation.kind==='worker'));
  store.db.exec('DELETE FROM jobs');
  store.setValue('connections',{vpipe:true,comfyui:false,ollama:false});
  store.setValue('pipelineSelections',{image:id,video:null,reference:null,upscale:null});
  store.setValue('pipelineDirectory',path.resolve('resources/pipelines'));
  await fs.rm(path.join(process.env.VPIPE_WORKDIR!,'models'),{recursive:true,force:true});
  await fs.writeFile(path.join(process.env.VPIPE_WORKDIR!,'.test-prepare-mode'),'success');
});
after(async()=>{
  worker?.kill('SIGTERM');if(worker?.exitCode===null)await once(worker,'exit');
  fixture.close();await fs.rm(directory,{recursive:true,force:true});
});

test('only unchanged bundled workflows offer a starter; custom code and extra request fields are rejected',async()=>{
  const snapshot=(await catalog()).entries.find(item=>item.metadata.id===id)!;
  assert.equal((await pipelineStatus(snapshot)).preparation,'image/krea-2-turbo');
  const changed=structuredClone(snapshot);changed.graph.description='custom workflow';changed.revision=digest([changed.metadata,changed.graph]);
  assert.equal(await preparationFor(changed),undefined);
  await assert.rejects(builtinPreparation('../../external'),/built-in/);
  assert.equal((await call('pipelines/prepare',{id,graph:{stages:[]}})).status,400);
  assert.equal((await call('pipelines/prepare',{id:'custom:workflow'})).status,409);
  assert.equal(store.listJobs().length,0);
});
test('a queued starter runs through the worker, keeps its log and makes the workflow ready',async()=>{
  const custom=path.join(directory,'custom-pipelines'),folder=path.join(custom,'image/krea');
  await fs.mkdir(path.dirname(folder),{recursive:true});
  await fs.cp(path.resolve('resources/pipelines/image/krea-2-turbo'),folder,{recursive:true});
  await fs.writeFile(path.join(folder,'prepare.vpipeline'),JSON.stringify({id:'not-bundled',stages:[{type:'shell',config:{command:'must never run'}}]}));
  store.setValue('pipelineDirectory',custom);
  const job=await enqueue();
  assert.deepEqual(job.request,{task:'builtin-preparation',preparation:'image/krea-2-turbo',name:'Krea 2 Turbo'});
  await waitFor(()=>['completed','failed'].includes(store.getJob(job.id)!.status));
  assert.equal(store.getJob(job.id)!.status,'completed',store.getJob(job.id)!.error);
  assert.equal(store.getJob(job.id)!.step,null);
  assert.match(await fs.readFile(path.join(fixture.jobsDir,job.id,'runner.log'),'utf8'),/Synthetic starter finished/);
  assert.ok(!(await fs.readFile(path.join(fixture.jobsDir,job.id,'prepare.vpipeline'),'utf8')).includes(process.env.HF_TOKEN!));
  const snapshot=(await catalog()).entries.find(item=>item.metadata.id===id)!;
  const status=await pipelineStatus(snapshot);assert.equal(status.ready,true);assert.equal(status.preparation,undefined);
  assert.equal((await call('pipelines/prepare',{id})).status,409);
});
test('duplicate clicks reuse the active job and cancellation stops preparation without making models ready',async()=>{
  await fs.writeFile(path.join(process.env.VPIPE_WORKDIR!,'.test-prepare-mode'),'wait');
  const job=await enqueue(),duplicate=await enqueue();assert.equal(duplicate.id,job.id);
  await waitFor(()=>store.getJob(job.id)!.status==='running');
  assert.equal((await call(`jobs/${job.id}/start`)).status,409);
  assert.equal((await call(`jobs/${job.id}/cancel`)).status,200);
  await waitFor(()=>!registry.activeOperations().some(operation=>operation.kind==='worker'));
  assert.equal(store.getJob(job.id)!.status,'cancelled');
  assert.equal((await pipelineStatus((await catalog()).entries.find(item=>item.metadata.id===id)!)).ready,false);
});
test('failures stay in the ordinary queue and retry uses the bundled starter',async()=>{
  await fs.writeFile(path.join(process.env.VPIPE_WORKDIR!,'.test-prepare-mode'),'fail');
  const job=await enqueue();await waitFor(()=>store.getJob(job.id)!.status==='failed');
  assert.match(store.getJob(job.id)!.error!,/Synthetic starter failure/);
  await fs.writeFile(path.join(process.env.VPIPE_WORKDIR!,'.test-prepare-mode'),'success');
  const response=await call(`jobs/${job.id}/retry`);assert.equal(response.status,201,await response.clone().text());
  const retry=(await response.json()).job;assert.notEqual(retry.id,job.id);
  await waitFor(()=>['completed','failed'].includes(store.getJob(retry.id)!.status));
  assert.equal(store.getJob(retry.id)!.status,'completed',store.getJob(retry.id)!.error);
});
test('Hugging Face denial explains model access and token setup, including a zero runner exit',async()=>{
  for(const mode of ['unauthorized','forbidden']) {
    await fs.writeFile(path.join(process.env.VPIPE_WORKDIR!,'.test-prepare-mode'),mode);
    const job=await enqueue();await waitFor(()=>store.getJob(job.id)!.status==='failed');
    const error=store.getJob(job.id)!.error!;
    assert.match(error,/Hugging Face denied the model download/);
    assert.match(error,mode==='unauthorized'?/HTTP 401/:/HTTP 403/);
    assert.match(error,/Settings → Advanced → API tokens/);
    assert.match(error,/quit and reopen Frok/);
    assert.doesNotMatch(error,/starter finished/);
    const log=await fs.readFile(path.join(fixture.jobsDir,job.id,'runner.log'),'utf8');
    assert.match(log,/Hugging Face token: available to Vpipe/);
    assert.ok(!log.includes(process.env.HF_TOKEN!));
  }
});
test('a stage error with a zero runner exit remains the job failure',async()=>{
  await fs.writeFile(path.join(process.env.VPIPE_WORKDIR!,'.test-prepare-mode'),'stage-error');
  const job=await enqueue();await waitFor(()=>store.getJob(job.id)!.status==='failed');
  assert.match(store.getJob(job.id)!.error!,/Synthetic disk full/);
  assert.doesNotMatch(store.getJob(job.id)!.error!,/starter finished/);
});
