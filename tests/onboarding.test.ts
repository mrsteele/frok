import test from 'node:test';
import assert from 'node:assert/strict';
import { setupWorkflows } from '../src/lib/onboarding';
import { settingsPath, studioRoute } from '../src/lib/navigation';
import type { Health, Job } from '../src/lib/types';

function health():Health {return {
  connections:{vpipe:{enabled:true,available:true,detail:''},comfyui:{enabled:true,available:true,detail:''}},
  pipelineSelections:{image:'vpipe:image',upscale:'comfyui:upscale'},
  pipelines:[{id:'vpipe:image',kind:'image',runner:'vpipe',canPrepare:true},{id:'comfyui:upscale',kind:'upscale',runner:'comfyui',canPrepare:true}],
  capabilities:{image:{ready:false},upscale:{ready:false}},
} as unknown as Health;}

test('setup only prepares explicitly selected capabilities and supports skipping everything',()=>{
  assert.deepEqual(setupWorkflows(undefined,[]),[]);
  assert.deepEqual(setupWorkflows({...health(),pipelineSelections:{image:null,video:null,reference:null,upscale:null}},[]),[]);
  assert.deepEqual(setupWorkflows(health(),[]).filter(item=>item.canPrepare).map(item=>item.kind),['image','upscale']);
});
test('ready and already queued workflows are not prepared again',()=>{
  const state=health();state.capabilities!.image.ready=true;
  const job={id:'setup-job',kind:'setup',status:'queued',request:{pipeline:{metadata:{id:'comfyui:upscale'}}}} as Job;
  const plan=setupWorkflows(state,[job]);
  assert.equal(plan[0].ready,true);assert.equal(plan[1].job?.id,job.id);
  assert.ok(plan.every(item=>!item.canPrepare));
});
test('unavailable services and missing definitions need attention; upscalers follow their own service connection',()=>{
  const state=health();state.connections!.vpipe.available=false;state.capabilities!.image.ready=true;
  let plan=setupWorkflows(state,[]);assert.equal(plan[0].ready,false);assert.equal(plan[0].canPrepare,false);assert.equal(plan[1].canPrepare,true);
  state.connections!.comfyui.available=false;plan=setupWorkflows(state,[]);assert.equal(plan[1].canPrepare,false);
  state.pipelines=state.pipelines!.filter(item=>item.kind!=='image');plan=setupWorkflows(state,[]);
  assert.equal(plan[0].workflow,undefined);assert.equal(plan[0].ready,false);assert.equal(plan[0].canPrepare,false);
});
test('new settings sections and saved links resolve without duplicating pages',()=>{
  for(const [path,section]of Object.entries({'/settings':'services','/settings/services':'services','/settings/connection':'services','/settings/generate':'services','/settings/pipelines':'generation','/settings/models':'generation','/settings/generation':'generation','/settings/recipes':'recipes','/settings/advanced':'advanced','/settings/welcome':'welcome'}))assert.deepEqual(studioRoute(path),{view:'settings',section});
  assert.equal(settingsPath('services'),'/settings');assert.equal(settingsPath('generation'),'/settings/generation');
  assert.equal(studioRoute('/settings/advanced/extra'),null);
});
