#!/usr/bin/env node
// Synthetic runner: verify the submitted graph and imitate only its output shape.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const graph=JSON.parse(await fs.readFile(process.argv[process.argv.indexOf('--launch')+1],'utf8'));
const stage=type=>graph.stages.find(s=>s.type===type);
for(const s of graph.stages)for(const key of ['hf_dir','encoder_dir'])if(s.config[key])assert.ok(path.isAbsolute(s.config[key]));
assert.equal(process.env.HF_TOKEN,undefined);
const fps=stage('rgb-to-video').config.fps,source=stage('load-video').config.input_url,output=stage('save-video').config.output_url;
assert.ok(source.startsWith(path.dirname(output)));
assert.ok(process.cwd().includes('/vpipe-'));
const generator=stage('generate-video'),args=['-v','error','-y','-i',source,'-an'];
if(generator){
  const {frames,width,height}=generator.config;
  assert.equal(frames%8,1);assert.ok(frames>=25);assert.equal(width%128,0);assert.equal(height%128,0);
  assert.equal(stage('temporal-stack').config.group_size,frames);
  assert.ok(stage('temporal-stack').config.max_mb*1024**2>frames*width*height*3);
  args.push('-frames:v',String(frames-4));
}
args.push('-r',String(fps),'-c:v','libx264','-preset','ultrafast','-crf','0',output);
const result=spawnSync(process.env.FFMPEG_BIN,args,{encoding:'utf8'});
if(result.status!==0)throw Error(result.stderr||result.error?.message);
