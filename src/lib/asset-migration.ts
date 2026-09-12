import type { DatabaseSync } from 'node:sqlite';
import { resolveAssetRoots, type AssetMember } from './asset-groups';

export function migrateAssetGroups(db: DatabaseSync) {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (db.prepare("SELECT value FROM settings WHERE key='assetGroupsVersion'").get()?.value === '1') { db.exec('COMMIT'); return; }
    // Read only relationship metadata. No media files or prompt content are needed.
    const members = db.prepare(`SELECT id, json_extract(data,'$.kind') AS kind,
      json_extract(data,'$.rootId') AS rootId, json_extract(data,'$.sourceId') AS sourceId,
      json_extract(data,'$.favorite') AS favorite FROM media`).all() as unknown as (AssetMember & { favorite: number })[];
    const roots = resolveAssetRoots(members), saved = new Set(members.filter(item => item.favorite).map(item => roots.get(item.id)!));
    const update = db.prepare("UPDATE media SET data=json_set(data,'$.rootId',?,'$.favorite',json(?)) WHERE id=?");
    for (const member of members) { const root = roots.get(member.id)!; update.run(root, JSON.stringify(saved.has(root)), member.id); }
    db.prepare("INSERT OR REPLACE INTO settings(key,value) VALUES ('assetGroupsVersion','1')").run();
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
