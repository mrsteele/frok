import test from 'node:test';
import assert from 'node:assert/strict';
import { setupWorkflows } from '../src/lib/onboarding';
import { settingsPath, studioRoute } from '../src/lib/navigation';
import type { Health } from '../src/lib/types';

function health():Health {return {
  connections:{vpipe:{enabled:true,available:true,detail:''},comfyui:{enabled:true,available:true,detail:''}},
  pipelineSelections:{image:'vpipe:image',upscale:'comfyui:upscale'},
  pipelines:[{id:'vpipe:image',kind:'image',runner:'vpipe'},{id:'comfyui:upscale',kind:'upscale',runner:'comfyui'}],
  capabilities:{image:{ready:false},upscale:{ready:false}},
} as unknown as Health;}

test('setup summarizes explicitly selected capabilities and supports skipping everything',()=>{
  assert.deepEqual(setupWorkflows(undefined),[]);
  assert.deepEqual(setupWorkflows({...health(),pipelineSelections:{image:null,video:null,reference:null,upscale:null}}),[]);
  assert.deepEqual(setupWorkflows(health()).map(item=>item.kind),['image','upscale']);
});
test('unavailable services and missing definitions need attention; upscalers follow their own service connection',()=>{
  const state=health();state.connections!.vpipe.available=false;state.capabilities!.image.ready=true;
  let plan=setupWorkflows(state);assert.equal(plan[0].ready,false);assert.equal(plan[1].ready,false);
  state.connections!.comfyui.available=false;plan=setupWorkflows(state);assert.equal(plan[1].ready,false);
  state.pipelines=state.pipelines!.filter(item=>item.kind!=='image');plan=setupWorkflows(state);
  assert.equal(plan[0].workflow,undefined);assert.equal(plan[0].ready,false);
});
test('new settings sections and saved links resolve without duplicating pages',()=>{
  for(const [path,section]of Object.entries({'/settings':'services','/settings/services':'services','/settings/connection':'services','/settings/generate':'services','/settings/pipelines':'generation','/settings/models':'generation','/settings/generation':'generation','/settings/recipes':'recipes','/settings/advanced':'advanced','/settings/welcome':'welcome'}))assert.deepEqual(studioRoute(path),{view:'settings',section});
  assert.equal(settingsPath('services'),'/settings');assert.equal(settingsPath('generation'),'/settings/generation');
  assert.equal(studioRoute('/settings/advanced/extra'),null);
});
