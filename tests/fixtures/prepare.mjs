#!/usr/bin/env node
// Synthetic preparation only. Writes tiny tensor fixtures and never downloads models.
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { writeLora } from './lora.mjs';
if(process.argv.includes('--version')){console.log('synthetic preparation runner');process.exit(0);}
if(process.argv.includes('--gpu-thermal')){console.log('{}');process.exit(0);}
const pipeline=JSON.parse(await fs.readFile(process.argv[process.argv.indexOf('--launch')+1],'utf8'));
if(pipeline.id!=='prepare-krea-2-turbo')throw Error('Unexpected preparation graph');
if(process.env.HF_TOKEN!=='hf_SyntheticPreparationToken')throw Error('Hugging Face token was not passed to the synthetic runner');
const mode=await fs.readFile('.test-prepare-mode','utf8').catch(()=>'success');
console.log('Synthetic starter began');
if(mode==='wait')await delay(10000);
if(mode==='fail')throw Error('Synthetic starter failure');
if(mode==='unauthorized'||mode==='forbidden'){
  console.error(`[ERROR] ModelFetchStage('fetch-krea-2'): download of 'model_index.json' failed: HTTP ${mode==='unauthorized'?401:403}`);
  console.log('Error reported ; entering drain');
  process.exit(mode==='unauthorized'?0:1);
}
if(mode==='stage-error'){
  console.error("[ERROR] ModelFetchStage('fetch-krea-2'): Synthetic disk full");
  process.exit(0);
}
const base=path.join(process.cwd(),'models/krea/Krea-2-Turbo');
for(const component of ['transformer','text_encoder','vae'])await writeLora(path.join(base,component,'model.safetensors'));
await fs.mkdir(path.join(base,'tokenizer'),{recursive:true});
await fs.writeFile(path.join(base,'tokenizer/tokenizer.json'),'{}');
await fs.writeFile(path.join(base,'model_index.json'),'{}');
console.log('Synthetic starter finished');
