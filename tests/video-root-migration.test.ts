import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { migrateVideoRoots } from '../src/lib/video-root-migration';

test('legacy video roots replace only internal posters, preserving references, aliases and render counters',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE media(id TEXT PRIMARY KEY,data TEXT); CREATE TABLE jobs(id TEXT,status TEXT,data TEXT); CREATE TABLE asset_counters(root_id TEXT PRIMARY KEY,next_number INTEGER);');
  const records=[
    {id:'poster',kind:'image',origin:'poster',rootId:'poster',favorite:true,assetNumber:1},
    {id:'video',kind:'video',origin:'generated',rootId:'poster',sourceId:'poster',assetNumber:2,generation:{mode:'reference',referenceIds:['ref']}},
    {id:'hd',kind:'video',origin:'upscale',rootId:'poster',sourceId:'video',assetNumber:2},
    {id:'sibling',kind:'video',origin:'generated',rootId:'poster',sourceId:'poster',assetNumber:4,generation:{mode:'video',sourceId:'poster'}},
    {id:'ref',kind:'image',origin:'upload',rootId:'ref',favorite:true},
    {id:'image-video',kind:'video',origin:'generated',rootId:'ref',sourceId:'ref',assetNumber:2},
  ];
  for(const item of records)db.prepare('INSERT INTO media VALUES (?,?)').run(item.id,JSON.stringify(item));
  db.prepare('INSERT INTO asset_counters VALUES (?,?)').run('poster',9);
  const read=(id:string)=>JSON.parse(db.prepare('SELECT data FROM media WHERE id=?').get(id)!.data as string);
  migrateVideoRoots(db);
  assert.equal(read('video').rootId,'video');assert.equal(read('video').sourceId,undefined);assert.equal(read('video').assetNumber,1);
  assert.deepEqual(read('video').generation.referenceIds,['ref']);
  assert.equal(read('hd').rootId,'video');assert.equal(read('hd').assetNumber,1);
  assert.equal(read('sibling').rootId,'video');assert.equal(read('sibling').assetNumber,4);
  assert.equal(read('poster').rootId,'video');assert.equal(read('poster').favorite,false);
  assert.deepEqual(read('ref'),records[4]);assert.deepEqual(read('image-video'),records[5]);
  assert.equal(db.prepare('SELECT next_number FROM asset_counters WHERE root_id=?').get('video')!.next_number,9);
  const after=db.prepare('SELECT * FROM media').all();migrateVideoRoots(db);assert.deepEqual(db.prepare('SELECT * FROM media').all(),after);
  db.close();
});
