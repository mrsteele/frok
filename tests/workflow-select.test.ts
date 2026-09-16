import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { WorkflowSelect } from '../src/components/generation/workflow-select';
import { PipelineSelect } from '../src/components/generation/pipeline-select';
import { PipelineSettings } from '../src/components/settings/pipeline-settings';
import { WorkflowSummary } from '../src/components/generation/workflow-summary';
import { pipelineMetadata, type PipelineKind, type PipelineStatus } from '../src/lib/pipelines/schema';
import type { Health } from '../src/lib/types';

function workflow(id:string,kind:PipelineKind,runner:PipelineStatus['runner'],ready=false):PipelineStatus {
  const metadata=pipelineMetadata.parse({version:1,id,name:id,runner});
  return {...metadata,kind,supportsSource:false,maxReferences:0,ready,state:ready?'ready':'missing',detail:'',missing:[],revision:'test'};
}
function health():Health {
  return {
    worker:true,checks:[],connections:{vpipe:{enabled:true,available:true,detail:''},comfyui:{enabled:false,available:true,detail:''},ollama:{enabled:false,available:false,detail:''}},
    pipelines:[workflow('custom-image','image','vpipe'),workflow('custom-alternative','image','comfyui'),workflow('custom-video','video','vpipe',true),workflow('custom-reference','reference','comfyui'),workflow('custom-upscaler','upscale','comfyui')],
    pipelineSelections:{image:'custom-image',video:null,reference:null,upscale:null},
    capabilities:Object.fromEntries(['image','video','reference','upscale','prompt'].map(kind=>[kind,{configured:kind==='image',ready:false,detail:'',connection:'vpipe'}])),
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

test('connected providers come first even with missing models; unavailable providers stay grouped below',()=>{
  const state=health();
  state.pipelines=[
    workflow('comfy-first','image','comfyui',true),
    workflow('vpipe-missing','image','vpipe'),
    workflow('comfy-second','image','comfyui'),
    workflow('vpipe-ready','image','vpipe',true),
  ];
  const ordered=()=>options(render(state,'comfy-first')).map(o=>o.value);
  assert.deepEqual(ordered(),['vpipe-missing','vpipe-ready','comfy-first','comfy-second']);
  assert.match(render(state),/<optgroup label="Needs a connection"><option value="comfy-first" disabled=""/);
  assert.equal(options(render(state,'comfy-first')).find(o=>o.selected)?.value,'comfy-first','ordering preserves the saved selection');

  state.connections!.comfyui.enabled=true;
  state.connections!.vpipe.available=false;
  assert.deepEqual(ordered(),['comfy-first','comfy-second','vpipe-missing','vpipe-ready']);
  assert.match(render(state),/<optgroup label="Needs a connection"><option value="vpipe-missing" disabled=""/);

  state.connections!.vpipe.available=true;
  assert.deepEqual(ordered(),state.pipelines.map(p=>p.id),'connected choices retain their catalog order');
  assert.doesNotMatch(render(state),/<optgroup/);
  delete state.connections;
  assert.deepEqual(ordered(),state.pipelines.map(p=>p.id),'all workflows remain discoverable without connections');
  assert.ok(options(render(state)).every(o=>o.disabled));
});

test('Settings and onboarding share accessible rich triggers with their selected names and metrics',()=>{
  const state=health();
  const settings=renderToStaticMarkup(createElement(PipelineSettings,{health:state,checking:false,onRefresh:()=>{}}));
  const wizard=renderToStaticMarkup(createElement(PipelineSettings,{health:state,checking:false,wizard:true,onRefresh:()=>{}}));
  for(const html of [settings,wizard]) {
    assert.equal((html.match(/aria-haspopup="dialog"/g)||[]).length,4);
    assert.match(html,/Images workflow: custom-image/);
    assert.match(html,/aria-describedby="[^"]+-metrics-state [^"]+-metrics"/);
    assert.match(html,/Speed.*Unrated/);assert.match(html,/Adherence.*Unrated/);
    assert.doesNotMatch(html,/Browse models &amp; details|pipeline-stats|<select/);
  }
  assert.doesNotMatch(settings+wizard,/included upscaling workflows|compatible service to see its workflows/);
});

test('manual setup instructions appear only for selected workflows that need setup',()=>{
  const state=health();
  const markup=()=>renderToStaticMarkup(createElement(PipelineSettings,{health:state,checking:false,onRefresh:()=>{}}));
  assert.match(markup(),/href="\/docs\/guide\/model-setup.html"/);
  state.pipelines![0].ready=state.capabilities!.image.ready=true;
  assert.doesNotMatch(markup(),/Setup instructions/);
  state.pipelines![0].ready=state.capabilities!.image.ready=false;
  state.pipelineSelections!.image=null;
  assert.doesNotMatch(markup(),/Setup instructions/);
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

test('rich model rows preserve fractional and zero ratings and distinguish download size from memory',()=>{
  const p=workflow('rated-image','image','vpipe');
  p.catalog=pipelineMetadata.parse({version:1,id:p.id,name:p.name,runner:p.runner,catalog:{
    family:'Example',model:'Example',flavor:'Example',documentation:'https://example.com',setup:'Manual setup',
    ratings:{speed:{score:4.5,basis:'Synthetic benchmark',source:'https://example.com'},adherence:{score:0,basis:'Synthetic benchmark',source:'https://example.com'}},
  }}).catalog;
  p.files=[{reference:'one',ready:false,size:2e9},{reference:'two',ready:true,size:3e9}];
  const html=renderToStaticMarkup(createElement(WorkflowSummary,{pipeline:p,connection:{enabled:true,available:true,detail:''}}));
  assert.match(html,/4.5\/5/);assert.match(html,/0\/5/);assert.match(html,/5.0 GB/);
  assert.match(html,/Full download/);assert.match(html,/not runtime memory/);assert.match(html,/Needs download/);
});

test('rich model rows do not invent ratings, partial size totals, or missing-download status while offline',()=>{
  const p=workflow('unknown-image','image','vpipe');
  p.files=[{reference:'one',ready:false,size:2e9},{reference:'two',ready:false}];
  const html=renderToStaticMarkup(createElement(WorkflowSummary,{pipeline:p,connection:{enabled:true,available:false,detail:''}}));
  assert.equal((html.match(/>Unrated</g)||[]).length,2);
  assert.match(html,/Size unknown/);assert.match(html,/Connect Vpipe/);assert.doesNotMatch(html,/2.0 GB|Needs download/);
});

test('a gated installed model is shown as ready; missing custom nodes are setup rather than a download',()=>{
  const p=workflow('gated-image','image','vpipe',true);
  p.catalog=pipelineMetadata.parse({version:1,id:p.id,name:p.name,runner:p.runner,catalog:{
    family:'Example',model:'Example',flavor:'Example',documentation:'https://example.com',setup:'Manual setup',
    access:[{name:'Example',url:'https://example.com',gated:true}],
  }}).catalog;
  const render=()=>renderToStaticMarkup(createElement(WorkflowSummary,{pipeline:p,connection:{enabled:true,available:true,detail:''}}));
  assert.match(render(),/Gated Hugging Face download/);assert.match(render(),/>Ready</);assert.doesNotMatch(render(),/Needs download/);
  p.ready=false;p.state='attention';p.detail='Install the required custom nodes.';
  assert.match(render(),/>Setup needed</);assert.doesNotMatch(render(),/Needs download/);
});
