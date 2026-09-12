import type { DatabaseSync } from 'node:sqlite';

type Member = {id:string;rootId?:string;sourceId?:string;origin?:string;assetNumber?:number};
const valid = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0;

// Called inside the writer's transaction. Counters deliberately outlive deleted renders.
export function assignAssetNumber(db:DatabaseSync, item:Member, rootId:string):number {
  const previous=db.prepare("SELECT json_extract(data,'$.assetNumber') AS number FROM media WHERE id=?").get(item.id)?.number;
  if(valid(previous))return previous;
  if(item.id===rootId){
    db.prepare('INSERT OR IGNORE INTO asset_counters(root_id,next_number) VALUES (?,2)').run(rootId);
    return 1;
  }
  if(item.origin==='upscale'&&item.sourceId){
    const source=db.prepare("SELECT json_extract(data,'$.assetNumber') AS number FROM media WHERE id=? AND json_extract(data,'$.rootId')=?").get(item.sourceId,rootId)?.number;
    if(valid(source))return source;
  }
  db.prepare('INSERT OR IGNORE INTO asset_counters(root_id,next_number) VALUES (?,2)').run(rootId);
  const number=Number(db.prepare('UPDATE asset_counters SET next_number=next_number+1 WHERE root_id=? RETURNING next_number-1 AS number').get(rootId)!.number);
  if(!valid(number)||!Number.isSafeInteger(number+1))throw Error('This creation has exhausted its render numbers.');
  return number;
}

export function migrateAssetNumbers(db:DatabaseSync) {
  // A previous worker may finish a job during a development upgrade. Repair only
  // missing numbers, while retaining the counter and every existing address.
  const initialized=db.prepare("SELECT value FROM settings WHERE key='assetNumbersVersion'").get()?.value==='1';
  if(initialized&&!db.prepare("SELECT 1 FROM media WHERE json_extract(data,'$.assetNumber') IS NULL LIMIT 1").get())return;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS asset_counters(root_id TEXT PRIMARY KEY,next_number INTEGER NOT NULL)');
    // Relationship metadata only: no generated files or prompt text are read.
    const members=db.prepare(`SELECT id,json_extract(data,'$.rootId') AS rootId,
      json_extract(data,'$.sourceId') AS sourceId,json_extract(data,'$.origin') AS origin,
      json_extract(data,'$.assetNumber') AS assetNumber FROM media ORDER BY json_extract(data,'$.createdAt'),id`).all() as unknown as Member[];
    const byId=new Map(members.map(item=>[item.id,item]));
    const reserve=db.prepare('INSERT INTO asset_counters(root_id,next_number) VALUES (?,?) ON CONFLICT(root_id) DO UPDATE SET next_number=MAX(next_number,excluded.next_number)');
    for(const item of members)reserve.run(item.rootId||item.id,valid(item.assetNumber)?item.assetNumber+1:2);
    const visited=new Set<string>(),visiting=new Set<string>();
    const update=db.prepare("UPDATE media SET data=json_set(data,'$.assetNumber',?) WHERE id=?");
    function assign(item:Member){
      if(visited.has(item.id))return;
      if(visiting.has(item.id))throw Error('Cannot number an invalid media source chain.');
      visiting.add(item.id);
      if(item.origin==='upscale'&&item.sourceId&&item.sourceId!==item.id){const source=byId.get(item.sourceId);if(source)assign(source);}
      update.run(assignAssetNumber(db,item,item.rootId||item.id),item.id);
      visiting.delete(item.id);visited.add(item.id);
    }
    for(const item of members.filter(item=>item.origin!=='upscale'))assign(item);
    for(const item of members.filter(item=>item.origin==='upscale'))assign(item);
    db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('assetNumbersVersion','1')").run();
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}
