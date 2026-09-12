import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsAttention } from '../src/lib/settings-attention';
import { capabilityStatus } from '../src/lib/capabilities';
import { emptyModelSelections } from '../src/lib/service-config';
import type { Health } from '../src/lib/types';
function state(connected=false,ready=false):Health {
  const connections={vpipe:{enabled:connected,available:true,detail:''},comfyui:{enabled:false,available:false,detail:''},ollama:{enabled:false,available:false,detail:''}};
  const selections={...emptyModelSelections,image:connected?'krea-2-turbo' as const:null};
  return {connections,capabilities:capabilityStatus(selections,connections,{image:ready},{model:'krea-2-turbo',runner:'vpipe',connected,ready,detail:''},false,true,false)} as Health;
}
test('first-run and offline connections gate model selection and draw attention to Connections',()=>{
  assert.equal(settingsAttention().modelsLocked,true);assert.equal(settingsAttention().connection,undefined);
  const empty=settingsAttention(state());assert.equal(empty.modelsLocked,true);assert.equal(empty.connection,'error');assert.equal(empty.models,undefined);
  const offline=state(true);offline.connections!.vpipe.available=false;
  assert.equal(settingsAttention(offline).modelsLocked,true);assert.match(settingsAttention(offline).connectionMessage,/Reconnect/);
});
test('selected models need attention until ready; unselected optional capabilities do not',()=>{
  const unready=settingsAttention(state(true));assert.equal(unready.modelsLocked,false);assert.equal(unready.connection,undefined);assert.equal(unready.models,'warning');
  const ready=state(true,true);assert.equal(settingsAttention(ready).models,undefined);
  ready.connections!.ollama.enabled=true;assert.equal(settingsAttention(ready).connection,'warning');
});
