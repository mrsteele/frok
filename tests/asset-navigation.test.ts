import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {assignAssetNumber,migrateAssetNumbers} from '../src/lib/asset-numbers';
import {studioRoute,assetPath,mediaPath} from '../src/lib/navigation';
import {familySelection,familySlides,groupMediaFamily} from '../src/lib/media-family';
import type {Media} from '../src/lib/types';

const image=(id='root'):Media=>({id,rootId:id,kind:'image',filename:`${id}.jpg`,prompt:'Synthetic landscape',enhancedPrompt:'Synthetic landscape',width:16,height:16,seed:1,favorite:false,origin:'generated',createdAt:'2026-01-01'});
const video=(id:string,sourceId='root',origin:Media['origin']='generated'):Media=>({...image(id),kind:'video',rootId:'root',sourceId,origin,createdAt:`2026-01-02-${id}`});
function database(){const db=new DatabaseSync(':memory:');db.exec('CREATE TABLE media(id TEXT PRIMARY KEY,data TEXT);CREATE TABLE settings(key TEXT PRIMARY KEY,value TEXT)');return db;}
function insert(db:DatabaseSync,item:Media){db.prepare('INSERT OR REPLACE INTO media VALUES (?,?)').run(item.id,JSON.stringify(item));}
function save(db:DatabaseSync,item:Media){db.exec('BEGIN IMMEDIATE');try{const saved={...item,assetNumber:assignAssetNumber(db,item,item.rootId||item.id)};insert(db,saved);db.exec('COMMIT');return saved;}catch(e){db.exec('ROLLBACK');throw e;}}
const get=(db:DatabaseSync,id:string):Media=>JSON.parse(String(db.prepare('SELECT data FROM media WHERE id=?').get(id)!.data));

test('render numbers survive deletion, preserve updates, and are shared by SD/HD',()=>{
  const db=database();try{
    migrateAssetNumbers(db);assert.equal(save(db,image()).assetNumber,1);
    assert.equal(save(db,video('a')).assetNumber,2);assert.equal(save(db,video('b')).assetNumber,3);assert.equal(save(db,video('c')).assetNumber,4);
    assert.equal(save(db,video('c-hd','c','upscale')).assetNumber,4);assert.equal(save(db,video('c-hd-again','c-hd','upscale')).assetNumber,4);
    assert.equal(save(db,{...video('c'),assetNumber:999,favorite:true}).assetNumber,4);
    db.prepare('DELETE FROM media WHERE id=?').run('b');assert.equal(save(db,{...video('d'),assetNumber:3}).assetNumber,5);
    db.exec("DELETE FROM media WHERE json_extract(data,'$.kind')='video'");migrateAssetNumbers(db);assert.equal(save(db,video('e')).assetNumber,6);
    assert.equal(save(db,image('another-root')).assetNumber,1);assert.equal(save(db,{...video('another-video'),rootId:'another-root',sourceId:'another-root'}).assetNumber,2);
  }finally{db.close();}
});
test('legacy records get deterministic numbers; HD does not consume a render number',()=>{
  const db=database();try{
    for(const item of [video('c'),video('a'),image(),{...video('a-hd','a','upscale'),createdAt:'2025'},video('b')])insert(db,item);
    migrateAssetNumbers(db);assert.equal(get(db,'root').assetNumber,1);assert.equal(get(db,'a').assetNumber,2);
    assert.equal(get(db,'a-hd').assetNumber,2);assert.equal(get(db,'b').assetNumber,3);assert.equal(get(db,'c').assetNumber,4);assert.equal(save(db,video('d')).assetNumber,5);
  }finally{db.close();}
});
test('allocation rolls back on a failed save',()=>{
  const db=database();try{migrateAssetNumbers(db);save(db,image());db.exec('BEGIN IMMEDIATE');assert.equal(assignAssetNumber(db,video('failed'),'root'),2);db.exec('ROLLBACK');assert.equal(save(db,video('success')).assetNumber,2);}finally{db.close();}
});
test('a late output from a previous worker is numbered without reusing a deleted address',()=>{
  const db=database();try{
    migrateAssetNumbers(db);save(db,image());save(db,video('a'));save(db,video('b'));
    db.prepare('DELETE FROM media WHERE id=?').run('b');
    insert(db,video('late'));migrateAssetNumbers(db);
    assert.equal(get(db,'a').assetNumber,2);assert.equal(get(db,'late').assetNumber,4);
    assert.equal(save(db,video('next')).assetNumber,5);
  }finally{db.close();}
});
test('canonical and legacy routes validate opaque IDs and positive safe render numbers',()=>{
  assert.deepEqual(studioRoute('/asset/root'),{view:'media',id:'root',renderNumber:1});assert.deepEqual(studioRoute('/asset/root/5'),{view:'media',id:'root',renderNumber:5});
  for(const path of ['/asset/root/0','/asset/root/-1','/asset/root/2.5','/asset/root/02','/asset/root/1e2','/asset/root/9007199254740992','/asset/root/2/extra','/asset/%2e%2e'])assert.equal(studioRoute(path),null,path);
  for(const prefix of ['images','videos','image','video'])assert.equal(studioRoute(`/${prefix}/old`)?.view,'media');
  assert.equal(assetPath('root',1),'/asset/root');assert.equal(mediaPath({...video('hd'),assetNumber:4}),'/asset/root/4');
});
test('selection uses permanent numbers, not list positions, and does not duplicate a video root',()=>{
  const root={...image(),assetNumber:1},a={...video('a'),assetNumber:2},c={...video('c'),assetNumber:4},hd={...video('c-hd','c','upscale'),assetNumber:4};
  const family=groupMediaFamily(root,[root,a,c,hd]);
  assert.equal(familySelection(family,1)?.id,'root');assert.equal(familySelection(family,4)?.id,'c');assert.equal(familySelection(family,3),undefined);
  assert.deepEqual(familySlides(family).map(mediaPath),['/asset/root','/asset/root/2','/asset/root/4']);
  const standalone={...a,id:'jello',rootId:'jello',sourceId:undefined,assetNumber:1};assert.equal(familySlides(groupMediaFamily(standalone,[standalone])).length,1);
});
