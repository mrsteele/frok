import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import type { Generation } from '../src/lib/types';

const directory=await fs.mkdtemp(path.join(process.cwd(),'.data/pipeline-rendering-test-'));
process.env.FROK_DATA_DIR=directory;
const {createLibraryFixture}=await import('./fixtures/library');
const fixture=await createLibraryFixture();
const {diskCatalog,catalog}=await import('../src/lib/pipelines/catalog');
const {buildPipeline}=await import('../src/lib/vpipe');
const {buildComfyGraph}=await import('../src/lib/comfyui');
const {setValue,settings}=await import('../src/lib/db');
after(async()=>{fixture.close();await fs.rm(directory,{recursive:true,force:true});});

test('all factory generation pipelines bind saved snapshots without legacy builders or model inference',async()=>{
  const {entries,errors}=await diskCatalog();assert.deepEqual(errors,[]);
  for(const pipeline of entries.filter(p=>p.kind!=='upscale')){
    for(const duration of [6,8,10]){
      const original=structuredClone(pipeline);
      const request:Generation={pipeline,mode:pipeline.kind,prompt:'A paper boat floating on a pond',aspect:'4:3',duration,quality:'preview',count:1,enhance:false,referenceIds:[]};
      const input={request,prompt:request.prompt,seed:73,width:640,height:480,output:path.join(fixture.jobsDir,'output'),directory:fixture.jobsDir,source:pipeline.kind==='video'?'/synthetic/first-frame.png':undefined,references:pipeline.kind==='reference'?['/synthetic/reference.png']:[]};
      const graph=pipeline.metadata.runner==='vpipe'?await buildPipeline(input):buildComfyGraph(input,input.source?'frok/source.png':undefined,input.references.length?['frok/reference.png']:[],'frok/test/render');
      for(const binding of pipeline.metadata.bindings.prompt!){
        const config=pipeline.metadata.runner==='vpipe'?(graph as import('../src/lib/vpipe').Pipeline).stages.find(s=>s.id===binding.node)!.config:(graph as import('../src/lib/comfyui').Graph)[binding.node].inputs;
        assert.equal(config[binding.field],request.prompt);
      }
      if(pipeline.metadata.runner==='vpipe'){
        const seen=new Set<string>();
        for(const stage of (graph as import('../src/lib/vpipe').Pipeline).stages){for(const port of stage.iports||[])if(port.src)assert.ok(seen.has(port.src),`${stage.id} depends on ${port.src}`);seen.add(stage.id);}
      }
      assert.deepEqual(pipeline,original,'Saved pipeline snapshots must remain unchanged.');
    }
  }
});

test('catalog discovery never creates hidden imported pipelines or changes selections',async()=>{
  setValue('modelSelections',{image:'krea-2-turbo',video:'vpipe',reference:'vpipe',prompt:null,upscale:null});
  const before=settings().pipelineSelections;
  const result=await catalog();
  assert.equal(result.entries.length,9);
  assert.ok(result.entries.every(p=>!p.metadata.id.startsWith('imported:')));
  assert.deepEqual(settings().pipelineSelections,before);
});
