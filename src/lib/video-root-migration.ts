import type { DatabaseSync } from 'node:sqlite';
import type { Media } from './types';

// Keep old poster records as address aliases; never delete an uploaded image or media file.
export function migrateVideoRoots(db:DatabaseSync) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const posters=db.prepare("SELECT data FROM media WHERE json_extract(data,'$.origin')='poster' AND (json_extract(data,'$.rootId')=id OR json_extract(data,'$.rootId') IS NULL)").all() as {data:string}[];
    const update=db.prepare('UPDATE media SET data=? WHERE id=?');
    for(const row of posters){
      const poster=JSON.parse(row.data) as Media;
      // Let already running jobs finish before changing their family's identity.
      if(db.prepare("SELECT 1 FROM jobs WHERE status IN ('queued','running') AND json_extract(data,'$.request.sourceId')=? LIMIT 1").get(poster.id))continue;
      const members=(db.prepare("SELECT data FROM media WHERE json_extract(data,'$.rootId')=? ORDER BY json_extract(data,'$.createdAt'),id").all(poster.id) as {data:string}[]).map(row=>JSON.parse(row.data) as Media);
      const root=members.find(item=>item.kind==='video'&&item.origin==='generated'&&!item.generation?.sourceId);
      if(!root)continue;
      const oldNumber=root.assetNumber;
      for(const member of members){
        member.rootId=root.id;
        if(member.id===root.id){delete member.sourceId;member.assetNumber=1;}
        else if(member.sourceId===poster.id)member.sourceId=root.id;
        if(member.origin==='upscale'&&member.assetNumber===oldNumber)member.assetNumber=1;
        if(member.id===poster.id)member.favorite=false;
        update.run(JSON.stringify(member),member.id);
      }
      const counter=Number(db.prepare('SELECT next_number FROM asset_counters WHERE root_id=?').get(poster.id)?.next_number || 2);
      db.prepare('INSERT INTO asset_counters(root_id,next_number) VALUES (?,?) ON CONFLICT(root_id) DO UPDATE SET next_number=MAX(next_number,excluded.next_number)').run(root.id,counter);
    }
    db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
}
