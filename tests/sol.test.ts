import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { buildPipeline, factoryPipeline } from './fixtures/pipeline';
import { turboAdapters } from '../src/lib/adapters';
import type { Generation } from '../src/lib/types';
const base:Generation={mode:'video',prompt:'A paper boat',aspect:'4:3',duration:6,quality:'preview',count:1,enhance:false,referenceIds:[]};
const graph=(request:Generation,source?:string)=>buildPipeline({request,prompt:base.prompt,seed:42,width:640,height:480,output:'unused.mp4',directory:'/synthetic',source,references:request.mode==='reference'?['/synthetic/ref.png']:[]});

test('all video modes and durations use SOL, using saved pipeline snapshots; conditioning stages precede consumers',async()=>{
  for(const duration of [6,8,10])for(const quality of ['preview','standard'] as const)for(const kind of ['text','image','redo','reference']){
    const request={...base,duration,quality,mode:kind==='reference'?'reference' as const:'video' as const,videoAcceleration:'obsolete'};
    const pipeline=await graph(request,kind==='image'||kind==='redo'?'/synthetic/first.png':undefined);
    const config=pipeline.stages.find(stage=>stage.id==='minimax-h3-model-config')!.config;
    const generate=pipeline.stages.find(stage=>stage.id==='generate-video')!;
    assert.equal(config.linear_branch,undefined);assert.equal(generate.config.sol_attn,true);
    assert.deepEqual([generate.config.sol_tau,generate.config.sol_key_block,generate.config.sol_dense_layers,generate.config.sol_local_radius],[1,64,1,1]);
    const turbo=turboAdapters[request.mode];assert.equal(config.lora,turbo.alias);assert.equal(generate.config.steps,turbo.steps);assert.equal(config.video_shift,turbo.shift);assert.equal(config.audio_shift,3);
    const declared=new Set();for(const stage of pipeline.stages){for(const input of stage.iports||[])if(input.src)assert.ok(declared.has(input.src),`${stage.id} forward reference`);declared.add(stage.id);}
    if(kind==='image'||kind==='redo')assert.equal(generate.iports![5].src,'frok-input-encode');
  }
});

test('custom and disabled adapters do not inherit Turbo’s abbreviated sampling schedule',async()=>{
  for(const mode of ['video','reference'] as const)for(const primary of ['', 'local/style.safetensors']) {
    const snapshot=factoryPipeline(mode);
    const stages=snapshot.graph.stages as import('../src/lib/vpipe').Stage[];
    const model=stages.find(s=>s.type==='minimax-h3-model-config')!.config;
    delete model.lora;delete model.lora_scale;
    if(primary){model.lora=primary;model.lora_scale=.8;}
    model.lora2='local/other.safetensors';model.lora2_scale=.7;
    stages.find(s=>s.type==='generate-video')!.config.steps=16;
    const pipeline=await graph({...base,mode,quality:'standard',pipeline:snapshot});
    const config=pipeline.stages.find(stage=>stage.id==='minimax-h3-model-config')!.config;
    assert.equal(config.lora,primary||undefined);assert.equal(config.lora_scale,primary ? .8 : undefined);
    assert.equal(config.lora2,'local/other.safetensors');assert.equal(config.lora2_scale,.7);
    assert.equal(pipeline.stages.find(stage=>stage.id==='generate-video')!.config.steps,16);
  }
});

test('all shipped MiniMax generation examples use SOL and reference Turbo preparation fetches only its exact variant',async()=>{
  for(const file of ['video/minimax-h3-turbo','reference/minimax-h3-reference']){
    const p=JSON.parse(await fs.readFile(path.join('resources/pipelines',file,'run.vpipeline'),'utf8'));
    assert.equal(p.stages.find((s:{type:string})=>s.type==='minimax-h3-model-config').config.linear_branch,undefined,file);
    assert.equal(p.stages.find((s:{type:string})=>s.type==='generate-video').config.sol_attn,true,file);
  }
  const p=JSON.parse(await fs.readFile('resources/pipelines/reference/minimax-h3-reference/prepare.vpipeline','utf8'));
  const fetches=p.stages.filter((s:{config:{model_variant?:string}})=>s.config.model_variant===turboAdapters.reference.alias);assert.equal(fetches.length,1);
  assert.equal(fetches[0].config.skip_existing_files,true);assert.equal(fetches[0].config.overwrite_existing,false);
});
