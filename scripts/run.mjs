import { launchSettings } from '../desktop/launch-settings.mjs';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import { ensurePipelines } from '../desktop/workspace.mjs';
dotenv.config({ path: process.env.FROK_ENV_FILE || ['.env.local', '.env'], quiet: true });
if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Frok requires Node.js 24 or newer.');
const mode=process.argv[2] || 'dev';
if(mode==='start'&&!existsSync('.next/BUILD_ID'))throw new Error('Run npm run build before npm start.');
const data=path.resolve(process.env.FROK_DATA_DIR||'.data');
const preferences=launchSettings(data);
const env={...process.env,NEXT_TELEMETRY_DISABLED:'1',FROK_OLLAMA_MANAGED:preferences.manageOllama?'1':'0',FROK_OLLAMA_ADDRESS:preferences.ollamaUrl};
const children=[];
await ensurePipelines({home:process.env.FROK_PIPELINE_HOME||process.env.FROK_HOME||path.join(os.homedir(),'frok'),templates:path.resolve('resources/pipelines'),groups:JSON.parse(await readFile('desktop/pipelines.json','utf8')),version:JSON.parse(await readFile('package.json','utf8')).version});
// Existing Ollama is independent of Frok. Starting a separate runtime is opt-in.
if(preferences.manageOllama){
  const ollamaUrl=preferences.ollamaUrl;
  const localBinary=process.env.OLLAMA_BIN||path.join(data,'runtimes','ollama','bin','ollama');
  const flatBinary=path.join(data,'runtimes','ollama','ollama');
  const binary=existsSync(localBinary)?localBinary:flatBinary;
  const ollamaOnline=await fetch(`${ollamaUrl}/api/tags`,{redirect:'error',signal:AbortSignal.timeout(1000)}).then(r=>r.ok).catch(()=>false);
  if(!ollamaOnline&&existsSync(binary)&&['127.0.0.1','localhost'].includes(new URL(ollamaUrl).hostname)){
    const models=path.join(data,'ollama','models');mkdirSync(models,{recursive:true});
    children.push(spawn(binary,['serve'],{stdio:'inherit',env:{...env,OLLAMA_HOST:new URL(ollamaUrl).host,OLLAMA_MODELS:models,OLLAMA_NO_CLOUD:'1',OLLAMA_NUM_PARALLEL:'1',OLLAMA_MAX_LOADED_MODELS:'1',OLLAMA_KEEP_ALIVE:'0'}}));
  }
}
children.push(spawn(process.execPath,['--import','tsx','src/worker/index.ts'],{stdio:'inherit',env}),spawn(process.execPath,['node_modules/next/dist/bin/next',mode,'--hostname','127.0.0.1','--port',process.env.PORT||'3000'],{stdio:'inherit',env}));
let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;process.exitCode=code;for(const child of children)child.kill('SIGTERM');setTimeout(()=>{for(const c of children)c.kill('SIGKILL');process.exit(code);},7000).unref();}
for(const child of children){child.on('error',e=>{console.error(e);stop(1);});child.on('exit',code=>{if(!stopping)stop(code||0);});}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
