import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkflowSelect } from '../src/components/generation/workflow-select';
import { PipelineSelect } from '../src/components/generation/pipeline-select';
import { PipelineSettings } from '../src/components/settings/pipeline-settings';
import { pipelineMetadata, type PipelineKind, type PipelineStatus } from '../src/lib/pipelines/schema';
import type { Health } from '../src/lib/types';

function workflow(id:string,kind:PipelineKind,runner:PipelineStatus['runner'],ready=false):PipelineStatus {
  const metadata=pipelineMetadata.parse({version:1,id,name:id,runner});
  return {...metadata,kind,supportsSource:false,maxReferences:0,ready,state:ready?'ready':'missing',detail:'',missing:[],canPrepare:!ready,revision:'test'};
}
function health():Health {
  return {
    worker:true,checks:[],connections:{vpipe:{enabled:true,available:true,detail:''},comfyui:{enabled:false,available:true,detail:''},ollama:{enabled:false,available:false,detail:''}},
    pipelines:[workflow('custom-image','image','vpipe'),workflow('custom-alternative','image','comfyui'),workflow('custom-video','video','vpipe',true),workflow('custom-reference','reference','comfyui'),workflow('custom-upscaler','upscale','comfyui')],
    pipelineSelections:{image:'custom-image',video:null,reference:null,upscale:null},
  } as unknown as Health;
}
function options(markup:string) {
  return [...markup.matchAll(/<option\b([^>]*)>(.*?)<\/option>/g)].map(([,attributes,label])=>({value:attributes.match(/value="([^"]*)"/)?.[1],disabled:attributes.includes('disabled=""'),selected:attributes.includes('selected=""'),label}));
}
function render(state:Health,value='',kind:PipelineKind='image') {
  return renderToStaticMarkup(createElement(WorkflowSelect,{health:state,kind,value,onChange:()=>{}}));
}

test('custom workflows stay visible and requirements come from their runner metadata',()=>{
  const state=health();
  let choices=options(render(state));
  assert.ok(!choices.find(o=>o.value==='custom-image')?.disabled,'Missing models must not block selecting a workflow for preparation.');
  assert.deepEqual(choices.find(o=>o.value==='custom-alternative'),{value:'custom-alternative',disabled:true,selected:false,label:'custom-alternative (requires ComfyUI)'});
  for(const kind of ['reference','upscale'] as const)assert.match(render(state,'',kind),/disabled=""[^>]*>custom-.*\(requires ComfyUI\)/);
  state.connections!.comfyui.enabled=true;
  choices=options(render(state));
  assert.equal(choices.find(o=>o.value==='custom-alternative')?.disabled,false);
  state.connections!.comfyui.available=false;
  assert.equal(options(render(state)).find(o=>o.value==='custom-alternative')?.disabled,true);
  delete state.connections;
  assert.ok(options(render(state)).every(o=>o.disabled));
});

test('disconnecting preserves the named selection; removed definitions have a disabled fallback',()=>{
  const state=health();
  assert.deepEqual(options(render(state,'custom-alternative')).find(o=>o.selected),{value:'custom-alternative',disabled:true,selected:true,label:'custom-alternative (requires ComfyUI)'});
  state.pipelines=[];
  assert.deepEqual(options(render(state,'removed-workflow')).find(o=>o.selected),{value:'removed-workflow',disabled:true,selected:true,label:'Selected workflow unavailable'});
  assert.match(render(state),/No workflows found/);
});

test('Settings and onboarding share the options, including unavailable services and opting out',()=>{
  const state=health();
  const settings=renderToStaticMarkup(createElement(PipelineSettings,{health:state,jobs:[],checking:false,onRefresh:()=>{}}));
  const wizard=renderToStaticMarkup(createElement(PipelineSettings,{health:state,jobs:[],checking:false,wizard:true,onRefresh:()=>{}}));
  assert.deepEqual(options(settings),options(wizard));
  assert.equal(options(settings).filter(o=>o.value==='').length,4);
  assert.ok(options(settings).filter(o=>o.value==='').every(o=>!o.disabled));
  for(const id of ['custom-alternative','custom-reference','custom-upscaler'])assert.equal(options(settings).find(o=>o.value===id)?.disabled,true);
  assert.doesNotMatch(settings+wizard,/included upscaling workflows|compatible service to see its workflows/);
});

test('generation controls retain defaults and source compatibility with the shared service requirements',()=>{
  const state=health();
  const markup=renderToStaticMarkup(createElement(PipelineSelect,{kind:'image',health:state,onChange:()=>{}}));
  assert.match(options(markup).find(o=>o.selected)!.label,/custom-image \(Default\)/);
  assert.equal(options(markup).find(o=>o.value==='custom-alternative')?.disabled,true);
  state.pipelines!.push({...workflow('image-capable-video','video','comfyui'),supportsSource:true});
  const fromImage=renderToStaticMarkup(createElement(PipelineSelect,{kind:'video',source:true,health:state,onChange:()=>{}}));
  assert.ok(!options(fromImage).some(o=>o.value==='custom-video'));
  assert.equal(options(fromImage).find(o=>o.value==='image-capable-video')?.disabled,true);
});
