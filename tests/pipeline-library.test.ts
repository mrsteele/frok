import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {createLibraryFixture} from './fixtures/library';
import {ensurePipelines} from '../desktop/workspace.mjs';
import {PipelineLibrary} from '../src/components/pipeline-library';
import type {Health} from '../src/lib/types';

const directory=await fs.mkdtemp(path.join(process.cwd(),'.data/pipeline-library-test-'));
process.env.FROK_DATA_DIR=directory;
const fixture=await createLibraryFixture(),{test,beforeEach,after}=fixture;
const {pipelineHome,pipelineStateDirectory,defaultPipelinesDir}=await import('../src/lib/paths');
assert.equal(pipelineHome,path.join(directory,'pipeline-home'),'Tests must never reset the real user directory.');
const db=await import('../src/lib/db');
const routes=await import('../src/app/api/[[...segments]]/route');
const {catalog}=await import('../src/lib/pipelines/catalog');
const options={home:pipelineHome,stateDirectory:pipelineStateDirectory,templates:path.resolve('resources/pipelines'),groups:JSON.parse(await fs.readFile('desktop/pipelines.json','utf8')),version:'0.1.0'};
function call(endpoint:string,method:'GET'|'PATCH'|'POST'='GET',body?:unknown) {
  return routes[method](fixture.request(`http://localhost:3000/api/${endpoint}`,{method,...(body?{body:JSON.stringify(body)}:{})}),{params:Promise.resolve({segments:endpoint.split('/')})});
}
beforeEach(async()=>{
  db.db.exec('DELETE FROM settings; DELETE FROM jobs;');db.setValue('pipelineDirectory','');
  await fs.rm(pipelineHome,{recursive:true,force:true});await ensurePipelines(options);
});
after(async()=>{fixture.close();await fs.rm(directory,{recursive:true,force:true});});

test('empty location uses the external default and audits all installed definitions without connections',async()=>{
  const response=await call('pipelines/library');assert.equal(response.status,200);
  const audit=await response.json();
  assert.equal(audit.configured,'');assert.equal(audit.path,defaultPipelinesDir);
  assert.deepEqual(audit.counts,{vpipe:3,comfyui:6});assert.deepEqual(audit.errors,[]);
  const html=renderToStaticMarkup(createElement(PipelineLibrary,{health:{pipelineLibrary:audit} as Health,checking:false,onRefresh:()=>{}}));
  assert.match(html,/Workflow folder/);assert.match(html,/value=""/);assert.match(html,/Vpipe workflows/);assert.match(html,/Reset default pipelines/);
});
test('location edits rescan immediately, retain selections and do not alter queued snapshots',async()=>{
  const current=(await catalog()).entries[0],snapshot=structuredClone(current);
  db.setValue('pipelineSelections',{image:current.metadata.id,video:null,reference:null,upscale:null});
  const job=db.createJob({kind:'setup',runner:'vpipe',total:1,request:{task:'pipeline',pipeline:snapshot}});
  const custom=path.join(directory,'custom');await fs.mkdir(custom,{recursive:true});
  const saved=await call('pipelines/library','PATCH',{path:custom});assert.equal(saved.status,200);
  assert.deepEqual((await saved.json()).counts,{vpipe:0,comfyui:0});assert.equal((await catalog()).entries.length,0);
  assert.equal(db.settings().pipelineSelections.image,current.metadata.id);assert.deepEqual(db.getJob(job.id)!.request.pipeline,snapshot);
  const cleared=await call('pipelines/library','PATCH',{path:''});assert.equal(cleared.status,200);
  assert.equal(db.pipelineDirectorySetting(),'');assert.equal((await catalog()).entries.length,9);
});
test('invalid locations preserve the old setting; malformed files and missing preparation are reported',async()=>{
  for(const value of ['relative/path',path.join(directory,'missing')])assert.equal((await call('pipelines/library','PATCH',{path:value})).status,400);
  assert.equal(db.pipelineDirectorySetting(),'');
  const custom=path.join(directory,'audit'),bundle=path.join(custom,'image/krea');
  await fs.mkdir(path.dirname(bundle),{recursive:true});await fs.cp(path.join(options.templates,'image/krea-2-turbo'),bundle,{recursive:true});
  await fs.rm(path.join(bundle,'prepare.vpipeline'));
  const metaFile=path.join(bundle,'meta.json'),metadata=JSON.parse(await fs.readFile(metaFile,'utf8'));
  metadata.dependencies.push({kind:'model',reference:'custom/fused-transformer',layout:'transformer',generated:true});
  await fs.writeFile(metaFile,JSON.stringify(metadata));
  await fs.mkdir(path.join(custom,'image/broken'));await fs.writeFile(path.join(custom,'image/broken/meta.json'),'{invalid');
  const response=await call('pipelines/library','PATCH',{path:custom});assert.equal(response.status,200);
  const audit=await response.json();assert.equal(audit.counts.vpipe,1);assert.equal(audit.errors.length,1);assert.match(audit.errors[0],/broken/);assert.equal(audit.warnings.length,1);assert.match(audit.warnings[0],/prepare companion/);
});
test('reset requires confirmation and replaces only the fixed default directory',async()=>{
  const custom=path.join(directory,'custom-preserved');await fs.mkdir(custom,{recursive:true});await fs.writeFile(path.join(custom,'keep.txt'),'custom');
  await call('pipelines/library','PATCH',{path:custom});
  await fs.writeFile(path.join(defaultPipelinesDir,'private.txt'),'personal pipeline');
  await fs.writeFile(path.join(directory,'model-marker.txt'),'model outside pipeline directory');
  const run=path.join(defaultPipelinesDir,'image/krea-2-turbo/run.vpipeline');await fs.writeFile(run,'edited');
  assert.equal((await call('pipelines/reset','POST',{confirm:'wrong'})).status,400);
  assert.equal(await fs.readFile(run,'utf8'),'edited');
  const result=await call('pipelines/reset','POST',{confirm:'RESET DEFAULT PIPELINES'});assert.equal(result.status,200,await result.clone().text());
  assert.equal(await fs.readFile(run,'utf8'),await fs.readFile(path.join(options.templates,'image/krea-2-turbo/run.vpipeline'),'utf8'));
  await assert.rejects(fs.stat(path.join(defaultPipelinesDir,'private.txt')),{code:'ENOENT'});
  assert.equal(db.pipelineDirectory(),custom);assert.equal(await fs.readFile(path.join(custom,'keep.txt'),'utf8'),'custom');
  assert.equal(await fs.readFile(path.join(directory,'model-marker.txt'),'utf8'),'model outside pipeline directory');
});
test('reset cannot be redirected by an extra request path or an unrelated website',async()=>{
  assert.equal((await call('pipelines/reset','POST',{confirm:'RESET DEFAULT PIPELINES',path:'/tmp'})).status,400);
  const response=await routes.POST(new Request('http://localhost:3000/api/pipelines/reset',{method:'POST',headers:{Origin:'https://unrelated.example'},body:JSON.stringify({confirm:'RESET DEFAULT PIPELINES'})}),{params:Promise.resolve({segments:['pipelines','reset']})});
  assert.equal(response.status,403);
});
