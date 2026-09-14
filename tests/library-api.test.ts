import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';

const root=fs.mkdtempSync(path.resolve('.data/library-api-test-'));
process.env.FROK_DATA_DIR=root;process.env.FROK_ENV_FILE=path.join(root,'absent.env');
process.env.FROK_ORIGIN='http://127.0.0.1:3000';process.env.VPIPE_WORKDIR=path.join(root,'vpipe');
const store=await import('../src/lib/db'),library=await import('../src/lib/library'),registry=await import('../src/lib/registry');
const api=await import('../src/app/api/[[...segments]]/route');
const call=(resource:string,method:'GET'|'DELETE'='GET',body?:unknown,headers:Record<string,string>={})=>api[method](new Request(`http://127.0.0.1:3000/api/${resource}`,{method,headers:{Origin:'http://127.0.0.1:3000','X-Frok-Request':'1',...headers},body:body?JSON.stringify(body):undefined}),{params:Promise.resolve({segments:resource.split('/')})});
after(()=>{library.closeLibraryDatabase();registry.registry.close();fs.rmSync(root,{recursive:true,force:true});});
test('first startup creates an empty local library without importing other directories',()=>{
  library.libraryDatabase();assert.equal(store.listMedia().length,0);
  assert.equal(fs.existsSync(path.join(root,'users')),false);
  for(let index=0;index<2;index++){
    const item={id:randomUUID(),kind:'image' as const,filename:`fixture-${index}.jpg`,prompt:`synthetic ${index}`,enhancedPrompt:'',width:16,height:16,seed:index,favorite:true,createdAt:'2026-01-01T00:00:00Z',origin:'upload' as const};
    store.saveMedia(item);fs.writeFileSync(path.join(library.libraryMediaDir(),item.filename),'synthetic file; not an image');
  }
  store.setValue('example',1);
});
test('all local callers see the same library and old cookies expire',async()=>{
  const a=await call('media'),b=await call('media','GET',undefined,{Cookie:'frok_session=retired'});
  assert.equal(a.status,200);assert.deepEqual(await a.json(),await b.json());assert.match(b.headers.get('set-cookie')!,/Max-Age=0/);
  assert.equal((await call('session')).status,404);
});
test('Envision returns persistent sections and rejects cross-site access',async()=>{
  const page=await call('envision');assert.equal(page.status,200);
  const data=await page.json();assert.equal(data.sections.length,2);assert.equal(data.media.length,2);
  library.closeLibraryDatabase();
  assert.deepEqual(await (await call('envision')).json(),data);
  assert.equal((await call('envision','GET',undefined,{Origin:'https://evil.example'})).status,403);
});
test('cross-site calls and unconfirmed resets cannot remove library content',async()=>{
  assert.equal((await call('library','DELETE',{confirm:'DELETE ALL DATA'},{Origin:'https://evil.example'})).status,403);
  assert.equal((await call('library','DELETE',{confirm:'no'})).status,400);assert.equal(store.listMedia().length,2);
});
test('reset waits for active operations, clears all content and settings, and preserves models and pipelines',async()=>{
  const publications=path.join(library.libraryDirectory(),'publications');fs.mkdirSync(publications,{recursive:true});fs.writeFileSync(path.join(publications,'interrupted.json'),'{}');
  for(const name of ['vpipe/models/keep','runtimes/keep','pipelines/keep']){fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.writeFileSync(path.join(root,name),'preserve');}
  registry.setServiceValue('prepared:synthetic',{ready:true});store.setValue('connections',{vpipe:true});
  const operation=registry.beginOperation('worker');let released=false;
  setTimeout(()=>{released=true;registry.endOperation(operation);},100);
  const response=await call('library','DELETE',{confirm:'DELETE ALL DATA'});assert.equal(response.status,200);assert.equal(released,true);
  assert.deepEqual((await import('../src/lib/preferences')).runtimeOptions(), {liveImagePreviews:true,jobTimeoutMinutes:180,jobRetentionHours:3,mediaToolsDirectory:''});
  assert.deepEqual(store.listMedia(),[]);assert.deepEqual(store.listJobs(),[]);assert.equal(store.getValue('example',null),null);assert.equal(fs.existsSync(path.join(root,'users')),false);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM prompt_sections').get()!.n,0);
  assert.deepEqual(fs.readdirSync(publications),[]);
  for(const name of ['vpipe/models/keep','runtimes/keep','pipelines/keep'])assert.equal(fs.readFileSync(path.join(root,name),'utf8'),'preserve');
  assert.deepEqual(registry.serviceValue('prepared:synthetic',null),{ready:true});assert.notEqual(registry.serviceValue('libraryResetEpoch','initial'),'initial');
  library.closeLibraryDatabase();assert.equal(library.libraryDatabase().prepare('SELECT COUNT(*) AS n FROM media').get()!.n,0);
});
