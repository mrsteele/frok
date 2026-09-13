#!/usr/bin/env node
// A deliberately synthetic runner used ONLY by automated tests. Never a UI/demo provider.
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { resolveMediaTool } from '../../src/lib/media-tools.ts';
import { fileURLToPath } from 'node:url';
import { writeReferenceTurbo } from './lora.mjs';
if(process.argv.includes('--list-models')){console.log('[]');process.exit(0);}
if(process.argv.includes('--version')||process.argv.includes('-version')){console.log('test-fixture 1.0');process.exit(0);}
if(process.argv.includes('--gpu-thermal')){console.log(JSON.stringify({gpu_active_pct:31.5}));process.exit(0);}
const file=process.argv[process.argv.indexOf('--launch')+1];
const p=JSON.parse(await fs.readFile(file,'utf8'));
// Native Vpipe resolves input ports in declaration order; reject forward references here too.
const declared=new Set();
for(const node of p.stages){
  for(const [index,input] of (node.iports||[]).entries()){
    if(input.src&&!declared.has(input.src)){
      console.error(`stage '${node.id}' iports[${index}] references unknown / forward-declared stage '${input.src}'`);
      process.exit(7);
    }
  }
  declared.add(node.id);
}
if(p.id==='prepare-minimax-h3-ref2va-turbo-lora'){await writeReferenceTurbo(process.cwd());console.log('Synthetic reference Turbo metadata');process.exit(0);}
if(['prepare-minimax-h3-8bit','prepare-minimax-h3-turbo-lora'].includes(p.id)){console.log('Synthetic base model preparation');process.exit(0);}
const stage=id=>p.stages.find(s=>s.id===id);
const prompt=stage('text-prompt').config.text;
if(prompt==='fail'){console.error('Intentional test runner failure');process.exit(7);}
if(prompt==='slow')console.log("[PROGRESS] 30% of 'denoise' completed at 15:38:23 (3/10)");
await delay(prompt==='slow'?10000:100);
const image=stage('generate-image'),video=stage('generate-video');
if(image){const {width,height,seed}=image.config;await sharp({create:{width,height,channels:3,background:{r:seed%255,g:88,b:122}}}).jpeg().toFile(stage('save-image').config.path);}
else if(video){const {width,height,frames,fps}=video.config;const result=spawnSync(resolveMediaTool('ffmpeg',{bundledDirectory:fileURLToPath(new URL(`../../.media-tools/${process.platform}-${process.arch}/`,import.meta.url))}),['-v','error','-y','-f','lavfi','-i',`color=c=0x436450:s=${width}x${height}:r=${fps}`,'-f','lavfi','-i','sine=frequency=220:sample_rate=32000','-t',String(prompt==='short-video'?1:frames/fps),'-c:v','libx264','-preset','ultrafast','-pix_fmt','yuv420p','-c:a','aac',stage('save-video').config.output_url],{encoding:'utf8'});if(result.error)throw result.error;if(result.status){console.error(result.stderr);process.exit(result.status);}}
console.log('Synthetic test media saved');
