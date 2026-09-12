import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLibraryFixture } from './fixtures/library';
import { captureExportPreferences } from '../src/lib/export-preferences';
import { ResetLibrary } from '../src/components/reset-library';

const root=await fs.mkdtemp(path.resolve('.data/library-export-test-'));
Object.assign(process.env,{FROK_DATA_DIR:root,FROK_ENV_FILE:path.join(root,'absent.env'),FROK_ORIGIN:'http://127.0.0.1:3000',VPIPE_WORKDIR:path.join(root,'vpipe'),OLLAMA_URL:'http://127.0.0.1:11434',COMFYUI_URL:'http://127.0.0.1:8000'});
const fixture=await createLibraryFixture(),{test,beforeEach,after}=fixture;
const store=await import('../src/lib/db'),registry=await import('../src/lib/registry');
const routes=await import('../src/app/api/[[...segments]]/route');
const {createLibraryExport}=await import('../src/lib/library-export');
const exportsDir=path.join(fixture.directory,'exports');
const pipelines=path.join(root,'custom-pipelines');
const preferences={'frok-composer':'{"count":4,"enhance":true}','frok-video-audio':'{"muted":true,"volume":0.3}',userPrompts:'[{"id":"boat","name":"Boats","prompt":"A boat sails."}]'};
function call(endpoint:string,method:'GET'|'POST'|'DELETE'|'PATCH'|'HEAD'='POST',body?:unknown,headers:Record<string,string>={}){
  return routes[method](fixture.request('http://127.0.0.1:3000/api/'+endpoint,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})}),{params:Promise.resolve({segments:endpoint.split('/')})});
}
const exportData=()=>call('library/export','POST',{preferences});
async function waitFor(check:()=>boolean){for(let n=0;n<200;n++){if(check())return;await delay(10);}assert.fail('Operation did not settle.');}
async function write(file:string,data:string|Buffer){await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,data);}
beforeEach(async()=>{
  store.db.exec('DELETE FROM media; DELETE FROM jobs; DELETE FROM settings;');
  registry.registry.exec('DELETE FROM operations;');
  registry.setServiceValue('maintenance',false);
  for(const name of ['media','jobs','deletions','exports']){const dir=path.join(fixture.directory,name);await fs.rm(dir,{recursive:true,force:true});await fs.mkdir(dir);}
  await fs.rm(pipelines,{recursive:true,force:true});await fs.mkdir(pipelines,{recursive:true});
  store.setValue('pipelineDirectory',pipelines);
});
after(async()=>{fixture.close();await fs.rm(root,{recursive:true,force:true});});

test('Export is above Delete All, and only durable app preferences are captured',()=>{
  const html=renderToStaticMarkup(createElement(ResetLibrary));
  assert.ok(html.indexOf('Export all my data')<html.indexOf('Delete all my stuff'));
  assert.match(html,/Models and installed runners are not included/);
  const values={...preferences,'unrelated-secret':'omit','frok-browser-identity':'omit','frok-library-reset':'omit'};
  assert.deepEqual(captureExportPreferences({getItem:key=>values[key as keyof typeof values]??null}),preferences);
});

test('archive contains all records and exact media, SQLite WAL data, recipes, logs and private pipeline definitions',async()=>{
  for(let index=0;index<80;index++){
    const id=randomUUID(),filename=index===0?'旅行 '+('long-name-'.repeat(15))+'.jpg':id+'.jpg';
    await write(path.join(fixture.mediaDir,filename),'synthetic-image-'+index);
    store.saveMedia({id,kind:'image',filename,prompt:'Prompt '+index,enhancedPrompt:'Actual prompt '+index,width:16,height:16,seed:index,favorite:index%2===0,createdAt:new Date().toISOString(),origin:'upload'});
  }
  const videoId=randomUUID();await write(path.join(fixture.mediaDir,videoId+'.mp4'),Buffer.from([0,1,2,255]));
  store.saveMedia({id:videoId,kind:'video',filename:videoId+'.mp4',prompt:'Motion',enhancedPrompt:'Motion enriched',width:480,height:480,seed:9,favorite:true,createdAt:new Date().toISOString(),origin:'generated'});
  for(let n=0;n<120;n++){const job=store.createJob({kind:'generate',runner:'vpipe',total:1,request:{mode:'image',prompt:'Synthetic job',count:1,duration:6,quality:'preview',aspect:'1:1',referenceIds:[],enhance:false}});store.updateJob(job.id,{status:'completed',dismissedAt:new Date().toISOString()});}
  store.setValue('synthetic-connection',{runner:'vpipe'});
  await write(path.join(fixture.jobsDir,'retained-job/runner.log'),'synthetic runner log');
  await write(path.join(fixture.directory,'publications/interrupted.json'),JSON.stringify({filename:`${videoId}.mp4`}));
  await write(path.join(pipelines,'image/private.local/run.vpipeline'),'{"pipeline":"private"}');
  await write(path.join(pipelines,'image/private.local/meta.json'),'{"name":"Custom pipeline"}');
  await write(path.join(pipelines,'.env'),'DO_NOT_EXPORT_ENV');
  await write(path.join(root,'vpipe/models/keep.safetensors'),'DO_NOT_EXPORT_MODELS');
  await write(path.join(root,'media/old-content.jpg'),'retained synthetic image');
  try{await fs.symlink(path.join(root,'vpipe/models'),path.join(fixture.jobsDir,'model-link'),'dir');}
  catch(error){if(process.platform!=='win32'||(error as NodeJS.ErrnoException).code!=='EPERM')throw error;}
  const response=await exportData();assert.equal(response.status,200,await response.clone().text());
  const result=await response.json();assert.equal(registry.serviceValue('maintenance',true),false);
  const download=await call('library/export/'+result.id,'GET');
  assert.equal(download.status,200);assert.match(download.headers.get('content-disposition')!,/attachment; filename="frok-backup-/);assert.match(download.headers.get('cache-control')!,/no-store/);
  assert.ok(registry.activeOperations().some(item=>item.kind==='download'));
  assert.equal((await call('library','DELETE',{confirm:'DELETE ALL DATA'})).status,409);
  const bytes=Buffer.from(await download.arrayBuffer());assert.equal(bytes.length,result.bytes);
  await waitFor(()=>!registry.activeOperations().some(item=>item.kind==='download'));
  const archive=path.join(root,'test-backup.tar.gz'),unpacked=path.join(root,'unpacked');
  await fs.writeFile(archive,bytes);await fs.mkdir(unpacked,{recursive:true});
  // Independent native tar implementation validates the gzip, pax headers and payloads.
  execFileSync('tar',['-xzf',archive,'-C',unpacked]);
  const metadata=JSON.parse(await fs.readFile(path.join(unpacked,'library.json'),'utf8'));
  assert.equal(metadata.media.length,81);assert.equal(metadata.jobs.length,120);assert.ok(metadata.jobs.every((job:{dismissedAt?:string})=>job.dismissedAt));
  assert.ok(metadata.prompt_sections.some((section:{id:string})=>section.id===videoId));
  assert.equal(metadata.settings.find((row:{key:string})=>row.key==='synthetic-connection').value.runner,'vpipe');
  const copied=new DatabaseSync(path.join(unpacked,'library/frok.sqlite'),{readOnly:true});
  try{assert.equal(copied.prepare('SELECT COUNT(*) AS n FROM media').get()!.n,81);assert.equal(copied.prepare('PRAGMA integrity_check').get()!.integrity_check,'ok');}finally{copied.close();}
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(unpacked,'preferences.json'),'utf8')).localStorage,preferences);
  for(const item of metadata.media)assert.deepEqual(await fs.readFile(path.join(unpacked,'library/media',item.filename)),await fs.readFile(path.join(fixture.mediaDir,item.filename)));
  assert.equal(await fs.readFile(path.join(unpacked,'library/jobs/retained-job/runner.log'),'utf8'),'synthetic runner log');
  assert.equal(await fs.readFile(path.join(unpacked,'library/publications/interrupted.json'),'utf8'),JSON.stringify({filename:`${videoId}.mp4`}));
  assert.equal(await fs.readFile(path.join(unpacked,'pipelines/image/private.local/run.vpipeline'),'utf8'),'{"pipeline":"private"}');
  assert.equal(await fs.readFile(path.join(unpacked,'retained-data/media/old-content.jpg'),'utf8'),'retained synthetic image');
  for(const excluded of ['pipelines/.env','vpipe/models/keep.safetensors','library/jobs/model-link'])await assert.rejects(fs.stat(path.join(unpacked,excluded)),{code:'ENOENT'});
  assert.equal((await call('library/export/'+result.id,'HEAD')).status,200);
  assert.equal(store.listMedia().length,72,'export must not change or use gallery pagination');
});

test('export rejects cross-site calls, invalid preference keys and arbitrary download paths',async()=>{
  assert.equal((await call('library/export','POST',{preferences},{Origin:'https://evil.example'})).status,403);
  assert.equal((await call('library/export','POST',{preferences},{'X-Frok-Request':'0'})).status,403);
  assert.equal((await call('library/export','POST',{preferences:{'unrelated-secret':'no'}})).status,400);
  assert.equal((await call('library/export','GET')).status,405);
  assert.equal((await call('library/export/not-a-uuid','GET')).status,400);
  assert.equal((await call('library/export/'+randomUUID(),'GET')).status,404);
  assert.deepEqual(await fs.readdir(exportsDir),[]);
});

test('running jobs are left untouched; queued jobs can be archived without starting them',async()=>{
  const job=store.createJob({kind:'setup',runner:'vpipe',total:1,request:{task:'runtime'}});
  store.updateJob(job.id,{status:'running'});const worker=registry.beginOperation('worker');
  assert.equal((await exportData()).status,409);assert.equal(store.getJob(job.id)!.status,'running');
  registry.endOperation(worker);
  assert.equal((await exportData()).status,409);assert.equal(registry.serviceValue('maintenance',true),false);
  store.updateJob(job.id,{status:'queued'});
  assert.equal((await exportData()).status,200);assert.equal(store.getJob(job.id)!.status,'queued');
});

test('export drains earlier writes and blocks workers, mutations and reset while allowing reads',async()=>{
  const writing=registry.beginOperation('request');
  const pending=exportData();
  await waitFor(()=>registry.activeOperations().some(item=>item.kind==='export'));
  assert.equal(registry.serviceValue('maintenance',false),true);
  assert.throws(()=>registry.beginOperation('worker'),/backup/);
  assert.equal((await call('settings','PATCH',{setupDismissed:true})).status,409);
  assert.equal((await call('media','GET')).status,200);
  assert.equal((await call('deletion','GET')).status,409);
  assert.equal((await call('library','DELETE',{confirm:'DELETE ALL DATA'})).status,409);
  registry.endOperation(writing);
  assert.equal((await pending).status,200);
  assert.equal(registry.serviceValue('maintenance',true),false);
  const worker=registry.beginOperation('worker');registry.endOperation(worker);
});

test('cancelled export releases the write gate and leaves data intact',async()=>{
  store.setValue('keep','yes');const writing=registry.beginOperation('request'),controller=new AbortController();
  const pending=createLibraryExport(preferences,controller.signal);
  controller.abort();await assert.rejects(pending,{name:'AbortError'});
  registry.endOperation(writing);
  assert.equal(store.getValue('keep','no'),'yes');assert.equal(registry.serviceValue('maintenance',true),false);
  assert.deepEqual(await fs.readdir(exportsDir),[]);
});

test('missing media fails the backup and removes staging instead of claiming success',async()=>{
  store.saveMedia({id:randomUUID(),kind:'image',filename:'missing.jpg',prompt:'Missing fixture',enhancedPrompt:'',width:16,height:16,seed:1,favorite:true,createdAt:new Date().toISOString(),origin:'upload'});
  const response=await exportData();assert.equal(response.status,400);assert.match((await response.json()).error,/missing/);
  assert.deepEqual(await fs.readdir(exportsDir),[]);assert.equal(store.listMedia().length,1);assert.equal(registry.serviceValue('maintenance',true),false);
});

test('cancellation while writing an archive removes partial output and resumes the queue',async()=>{
  const source=path.join(fixture.mediaDir,'synthetic-large.mp4');
  const file=await fs.open(source,'w');
  try{await file.truncate(32*1024**2);}finally{await file.close();}
  const controller=new AbortController();
  const result=createLibraryExport(preferences,controller.signal).then(()=>{throw Error('The cancelled export unexpectedly finished.');},error=>error);
  for(let n=0;n<1000;n++){
    if((await fs.readdir(exportsDir)).some(name=>name.endsWith('.tar.gz')))break;
    await delay(1);
  }
  controller.abort();
  assert.equal((await result).name,'AbortError');
  assert.deepEqual(await fs.readdir(exportsDir),[]);
  assert.equal((await fs.stat(source)).size,32*1024**2);
  assert.equal(registry.serviceValue('maintenance',true),false);
  const worker=registry.beginOperation('worker');registry.endOperation(worker);
});

test('cancelled downloads release reset protection; reset removes server backup copies but keeps models and pipelines',async()=>{
  await write(path.join(root,'vpipe/models/keep.txt'),'model fixture');
  const result=await (await exportData()).json();
  const download=await call('library/export/'+result.id,'GET');
  await download.body!.cancel();
  await waitFor(()=>!registry.activeOperations().some(item=>item.kind==='download'));
  const response=await call('library','DELETE',{confirm:'DELETE ALL DATA'});assert.equal(response.status,200,await response.clone().text());
  assert.deepEqual(await fs.readdir(exportsDir),[]);
  assert.equal(await fs.readFile(path.join(root,'vpipe/models/keep.txt'),'utf8'),'model fixture');
  assert.ok((await fs.stat(pipelines)).isDirectory());
});

test('expired exports are rejected and removed when a new export is prepared',async()=>{
  const previous=await (await exportData()).json(),file=path.join(exportsDir,previous.id+'.tar.gz');
  await fs.utimes(file,1,1);
  assert.equal((await call('library/export/'+previous.id,'GET')).status,404);
  assert.equal((await exportData()).status,200);
  await assert.rejects(fs.stat(file),{code:'ENOENT'});
});
