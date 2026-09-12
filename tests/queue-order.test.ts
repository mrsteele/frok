import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createLibraryFixture } from './fixtures/library';
import { queueView } from '../src/lib/queue-view';
import type { Generation } from '../src/lib/types';
const directory=path.join(process.cwd(),'.data',`queue-order-test-${process.pid}`);
process.env.FROK_DATA_DIR=directory;
const fixture=await createLibraryFixture();
const {test,beforeEach,after}=fixture;
const store=await import('../src/lib/db');
const request:Generation={mode:'image',prompt:'Queue test',aspect:'1:1',duration:6,quality:'preview',count:3,enhance:false,referenceIds:[]};
const create=()=>store.createJob({kind:'generate',request,runner:'vpipe',total:3});
const pending=()=>queueView(store.listJobs()).pending.map(job=>job.id);
beforeEach(()=>store.db.exec('DELETE FROM jobs'));
after(async()=>{fixture.close();await fs.rm(directory,{recursive:true,force:true});});

test('moves persist and claims follow the displayed order, with new arrivals at the end',()=>{
  const a=create(),b=create(),c=create();
  store.moveQueuedJob(a.id,'next');store.moveQueuedJob(b.id,'move',a.id);
  store.moveQueuedJob(c.id,'move',null);
  const d=create();assert.deepEqual(pending(),[b.id,a.id,c.id,d.id]);
  assert.equal(store.claimJob()?.id,b.id);
  assert.equal(store.claimJob(),undefined);
  store.updateJob(b.id,{status:'completed'});
  assert.equal(store.claimJob()?.id,a.id);
});

test('start immediately keeps the active job running until it acknowledges the stop and resumes saved progress',()=>{
  const a=create();store.claimJob();store.updateJob(a.id,{completed:1});
  const b=create(),c=create();store.moveQueuedJob(c.id,'start');
  assert.equal(store.getJob(a.id)?.status,'running');
  assert.equal(store.getJob(a.id)?.pauseRequested,true);
  assert.equal(store.claimJob(),undefined);
  store.resumeInterruptedJob(a.id,12);
  assert.deepEqual(pending(),[c.id,a.id,b.id]);
  assert.equal(store.getJob(a.id)?.completed,1);
  assert.equal(store.getJob(a.id)?.accumulatedSeconds,12);
  assert.equal(store.claimJob()?.id,c.id);
  store.updateJob(c.id,{status:'completed'});
  assert.equal(store.claimJob()?.id,a.id);
  assert.equal(store.getJob(a.id)?.completed,1);
});

test('stale moves roll back and next up never interrupts the current job',()=>{
  const a=create();store.claimJob();const b=create(),c=create();
  store.moveQueuedJob(c.id,'next');
  const order=pending();assert.deepEqual(order,[c.id,b.id]);
  assert.throws(()=>store.moveQueuedJob(a.id,'next'),/Only pending/);
  assert.throws(()=>store.moveQueuedJob(b.id,'move',a.id),/no longer pending/);
  assert.deepEqual(pending(),order);
  assert.equal(store.getJob(a.id)?.pauseRequested,undefined);
});

test('cancellation wins over a pending pause acknowledgement',()=>{
  const a=create();store.claimJob();const b=create();store.moveQueuedJob(b.id,'start');
  store.updateJob(a.id,{status:'cancelled'});
  store.resumeInterruptedJob(a.id,12);
  assert.equal(store.getJob(a.id)?.status,'cancelled');
  assert.equal(store.claimJob()?.id,b.id);
});

test('queue API validates moves and returns the refreshed queue',async()=>{
  const routes=await import('../src/app/api/[[...segments]]/route');
  const a=create();store.claimJob();const b=create(),c=create();
  const call=(id:string,action:string,body:unknown)=>routes.POST(fixture.request(`http://localhost:3000/api/jobs/${id}/${action}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),{params:Promise.resolve({segments:['jobs',id,action]})});
  const moved=await call(c.id,'next',{});assert.equal(moved.status,200);
  assert.deepEqual(queueView((await moved.json()).jobs).pending.map(job=>job.id),[c.id,b.id]);
  assert.equal((await call(b.id,'move',{beforeId:a.id})).status,409);
  assert.equal((await call(b.id,'move',{beforeId:42})).status,400);
  assert.equal((await call(c.id,'start',{})).status,200);
  assert.equal(store.getJob(a.id)?.pauseRequested,true);
});
