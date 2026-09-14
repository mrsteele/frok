import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { readFile } from 'node:fs/promises';
import { ensurePipelines } from '../desktop/workspace.mjs';
import { requireSupportedNode } from './node-version.mjs';
import { storagePaths, applicationPaths } from '../desktop/storage-paths.mjs';
import { migrateApplicationData } from '../desktop/application-data.mjs';
import { processLog } from '../desktop/process-log.mjs';
dotenv.config({ path: process.env.FROK_ENV_FILE || ['.env.local', '.env'], quiet: true });
requireSupportedNode();
const mode=process.argv[2] || 'dev';
if(mode==='start'&&!existsSync('.next/BUILD_ID'))throw new Error('Run npm run build before npm start.');
const storage=storagePaths(),data=storage.data,machine=applicationPaths();
migrateApplicationData({home:storage.home,...machine});
const pipelineStateDirectory=applicationPaths({...process.env,FROK_HOME:storage.pipelineHome}).state;
const env={...process.env,FROK_HOME:storage.home,FROK_DATA_DIR:data,FROK_PIPELINE_HOME:storage.pipelineHome,FROK_PIPELINE_STATE_DIR:pipelineStateDirectory,FROK_LOG_DIR:machine.logs,NEXT_TELEMETRY_DISABLED:'1'};
const log=processLog(machine.logs,env);
const children=[];
await ensurePipelines({home:storage.pipelineHome,stateDirectory:pipelineStateDirectory,templates:path.resolve('resources/pipelines'),groups:JSON.parse(await readFile('desktop/pipelines.json','utf8')),version:JSON.parse(await readFile('package.json','utf8')).version});
children.push(spawn(process.execPath,['--import','tsx','src/worker/index.ts'],{stdio:['inherit','pipe','pipe'],env}),spawn(process.execPath,['node_modules/next/dist/bin/next',mode,'--hostname','127.0.0.1','--port',process.env.PORT||'3000'],{stdio:['inherit','pipe','pipe'],env}));
for(const child of children)for(const stream of ['stdout','stderr'])child[stream]?.on('data',chunk=>{process[stream].write(chunk);log.write(chunk);});
let stopping=false;
function stop(code=0){if(stopping)return;stopping=true;process.exitCode=code;for(const child of children)child.kill('SIGTERM');setTimeout(()=>{for(const c of children)c.kill('SIGKILL');process.exit(code);},7000).unref();}
for(const child of children){child.on('error',e=>{console.error(e);log.write(e.message+'\n');stop(1);});child.on('exit',code=>{if(!stopping)stop(code||0);if(children.every(c=>c.exitCode!==null||c.signalCode!==null))void log.close();});}
process.on('SIGINT',()=>stop());process.on('SIGTERM',()=>stop());
