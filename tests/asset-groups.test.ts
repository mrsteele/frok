import { createLibraryFixture } from './fixtures/library';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { assetId, groupAssets } from '../src/lib/asset-groups';
import { migrateAssetGroups } from '../src/lib/asset-migration';
import { sessionGallery } from '../src/lib/gallery';
import type { Media, Generation, Job } from '../src/lib/types';
const testDir=path.join(process.cwd(),'.data',`asset-groups-test-${process.pid}`);
process.env.FROK_DATA_DIR=testDir;
const fixture = await createLibraryFixture();
const { test, after, beforeEach } = fixture;
const store=await import('../src/lib/db');
const routes=await import('../src/app/api/[[...segments]]/route');
let tick=0;
function media(patch:Partial<Media>={}) {
  const id=randomUUID();
  return store.saveMedia({id,kind:'image',filename:`${id}.jpg`,prompt:'Synthetic fixture',enhancedPrompt:'',width:640,height:480,seed:1,favorite:false,origin:'generated',createdAt:new Date(Date.UTC(2026,0,1,0,0,tick++)).toISOString(),...patch});
}
const video=(root:Media,patch:Partial<Media>={})=>media({kind:'video',sourceId:root.id,rootId:root.id,duration:6,...patch});
const input:Generation={mode:'video',sourceId:undefined,prompt:'Synthetic',aspect:'1:1',duration:6,quality:'preview',count:1,enhance:false,referenceIds:[]};
beforeEach(()=>{store.db.exec('DELETE FROM media; DELETE FROM jobs; DELETE FROM settings;');tick=0;});
after(()=>{fixture.close();fs.rmSync(testDir,{recursive:true,force:true});});

test('favorited reference uploads stay attached to videos without becoming library assets',async()=>{
  const reference=media({origin:'upload',referenceOnly:true,favorite:true});
  const standalone=media({origin:'upload',referenceOnly:false});
  const root=media({kind:'video',favorite:true,generation:{...input,mode:'reference',referenceIds:[reference.id]}});
  assert.deepEqual(store.listAssets().media.map(item=>item.id),[root.id,standalone.id]);
  assert.deepEqual(store.listAssets(true).media.map(item=>item.id),[root.id]);
  assert.deepEqual(groupAssets(store.listMedia(false,200)).map(item=>item.id),[root.id,standalone.id]);
  const family=store.mediaFamily(root.id);
  assert.equal(family.references?.[0].media?.id,reference.id);assert.ok(store.getMedia(reference.id));
  const response=await routes.GET(fixture.request('http://localhost:3000/api/media?favorites=true'),{params:Promise.resolve({segments:['media']})});
  assert.deepEqual((await response.json()).media.map((item:Media)=>item.id),[root.id]);
});

test('cat, water, car, dog and text-to-video each occupy one card with the latest file',async()=>{
  const cat=media(),water=media();video(water);const waterLast=video(water);
  const car=media(),carSD=video(car),carHD=video(car,{origin:'upscale',sourceId:carSD.id,height:720});
  const dog=media(),dogOld=video(dog);video(dog,{origin:'upscale',sourceId:dogOld.id,height:720});const dogLast=video(dog);
  const poster=media({origin:'poster'}),jello=video(poster);
  for(const root of [cat,water,car,dog,poster])store.favoriteMedia(root.id,true);
  const expected=[jello,dogLast,carHD,waterLast,cat].map(item=>item.id);
  assert.deepEqual(store.listAssets().media.map(item=>item.id),expected);
  assert.deepEqual(store.listAssets(true).media.map(item=>item.id),expected);
  assert.deepEqual(groupAssets(store.listMedia(false,200)).map(item=>item.id),expected);
  const response=await routes.GET(fixture.request('http://localhost:3000/api/media?favorites=true'),{params:Promise.resolve({segments:['media']})});
  assert.equal(response.status,200);const body=await response.json();assert.equal(body.media.length,5);assert.equal(new Set(body.media.map(assetId)).size,5);
});

test('the heart is shared by the image, every video, every HD copy and later siblings',async()=>{
  const root=media(),a=video(root),b=video(root),hd=video(root,{origin:'upscale',sourceId:a.id});
  const response=await routes.PATCH(fixture.request(`http://localhost:3000/api/media/${hd.id}`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({favorite:true})}),{params:Promise.resolve({segments:['media',hd.id]})});
  assert.equal(response.status,200);
  for(const item of [root,a,b,hd])assert.equal(store.getMedia(item.id)?.favorite,true);
  assert.equal(store.listAssets(true).media.length,1);
  const appended=video(root,{favorite:false});assert.equal(appended.favorite,true);
  store.favoriteRender(b.id,false);
  for(const item of [root,a,b,hd,appended])assert.equal(store.getMedia(item.id)?.favorite,false);
  assert.equal(store.listAssets(true).media.length,0);
  assert.equal(video(root,{favorite:true}).favorite,false); // stale file flags cannot override the root
  const family=store.mediaFamily(hd.id);
  assert.equal(family.root.favorite,false);
  assert.ok(family.renders.every(render=>!render.media.favorite&&!render.hd?.favorite));
});

test('pagination ranks groups before limiting and uses an ID tie-breaker for equal timestamps',()=>{
  const roots=Array.from({length:6},()=>media({createdAt:'2026-01-01'}));
  for(let i=0;i<90;i++)video(roots[0],{createdAt:'2026-01-01'});
  let cursor:string|null=null;const seen:Media[]=[];
  do {const page=store.listAssets(false,2,cursor||undefined);seen.push(...page.media);cursor=page.nextCursor;}while(cursor);
  assert.equal(seen.length,6);assert.equal(new Set(seen.map(assetId)).size,6);
  assert.equal(store.listAssets(false,72,undefined,'image').media.length,5);
  assert.equal(store.listAssets(false,72,undefined,'video').media.length,1);
  assert.throws(()=>store.listAssets(false,2,'bad cursor'));
});

test('a text-to-video output wins over its internal poster even with identical timestamps',()=>{
  const poster=media({id:'ffffffff-ffff-4fff-bfff-ffffffffffff',origin:'poster',createdAt:'2026-01-01'});
  const clip=video(poster,{id:'00000000-0000-4000-8000-000000000001',createdAt:poster.createdAt});
  assert.deepEqual(store.listAssets().media.map(item=>item.id),[clip.id]);
  assert.deepEqual(groupAssets([poster,clip]).map(item=>item.id),[clip.id]);
});

test('sessions include the full touched group even when later renders belong to another job',()=>{
  const job=store.createJob({kind:'generate',request:{...input,mode:'image'},runner:'vpipe',total:1});
  const root=media({jobId:job.id}),clip=video(root,{jobId:randomUUID()}),hd=video(root,{origin:'upscale',sourceId:clip.id,jobId:randomUUID()});media();
  assert.deepEqual(new Set(store.listSessionMedia([job.id]).map(item=>item.id)),new Set([root.id,clip.id,hd.id]));
  const animation=store.createJob({kind:'generate',request:{...input,sourceId:root.id},runner:'vpipe',total:1});
  assert.equal(store.listSessionMedia([animation.id]).length,3);
  assert.deepEqual(store.listSessionMedia([]),[]);
});

test('an image batch keeps its slots while videos and HD results replace the same group card',()=>{
  const root=media({jobId:'batch',batchIndex:0}),clip=video(root,{jobId:'animation'}),hd=video(root,{origin:'upscale',sourceId:clip.id,jobId:'upscale'});
  const job:Job={id:'batch',kind:'generate',request:{...input,mode:'image'},runner:'vpipe',status:'running',completed:1,total:4,message:'',createdAt:'2026-01-01',updatedAt:'2026-01-01'};
  const jobs=[job,{...job,id:'animation',request:{...input,sourceId:root.id},total:1,status:'completed' as const},{...job,id:'upscale',request:{...input,mode:'upscale' as const,sourceId:clip.id},total:1,status:'completed' as const}];
  const entries=sessionGallery([root,clip,hd],jobs,jobs.map(job=>job.id));
  assert.equal(entries.length,4);assert.equal(entries[0].key,'batch:0');
  assert.ok(entries[0].kind==='media'&&entries[0].media.id===hd.id);
  assert.equal(entries.filter(entry=>entry.kind==='pending').length,3);
  const waiting=sessionGallery([root,clip],[{...jobs[2],status:'running',completed:0}],['upscale']);
  assert.equal(waiting.length,1);assert.ok(waiting[0].kind==='media'&&waiting[0].media.id===clip.id);
});

test('legacy migration preserves any saved member and resolves chained HD copies without reading files',()=>{
  const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE media(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);');
  const base={kind:'image',favorite:false};
  const records=[{...base,id:'root'},{...base,id:'sd',kind:'video',sourceId:'root'},{...base,id:'hd',kind:'video',sourceId:'sd',favorite:true},{...base,id:'hd2',kind:'video',sourceId:'hd'},{...base,id:'separate'}];
  for(const item of records)db.prepare('INSERT INTO media VALUES (?,?)').run(item.id,JSON.stringify(item));
  migrateAssetGroups(db);
  const read=()=>db.prepare('SELECT data FROM media ORDER BY id').all().map(row=>JSON.parse(String(row.data)));
  for(const item of read())assert.deepEqual([item.rootId,item.favorite],item.id==='separate'?['separate',false]:['root',true]);
  db.exec("UPDATE media SET data=json_set(data,'$.favorite',json('false')) WHERE json_extract(data,'$.rootId')='root'");
  migrateAssetGroups(db);assert.ok(read().every(item=>!item.favorite));db.close();
});
