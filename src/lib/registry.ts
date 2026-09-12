import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { dataDir } from './paths';
import { HttpError } from './request-security';

fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const globals = globalThis as unknown as { frokRegistries?: Map<string, DatabaseSync> };
const registries = globals.frokRegistries ??= new Map();
function openRegistry() {
  const result = new DatabaseSync(path.join(dataDir, 'registry.sqlite'));
  result.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, key_hash TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'active');
    CREATE TABLE IF NOT EXISTS service (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, pid INTEGER NOT NULL, kind TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS leases (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, pid INTEGER NOT NULL, kind TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS leases_user ON leases(user_id);`);
  // Only downloaded-model receipts cross the old single-user boundary. Personal
  // settings, prompts, jobs and files remain unassigned until an offline import.
  const legacy = path.join(dataDir, 'frok.sqlite');
  if (fs.existsSync(legacy) && !result.prepare("SELECT 1 FROM service WHERE key='legacyModelReceipts'").get()) {
    const old = new DatabaseSync(legacy, { readOnly: true });
    try {
      const rows = old.prepare("SELECT key,value FROM settings WHERE key LIKE 'prepared:%'").all() as {key:string;value:string}[];
      result.exec('BEGIN IMMEDIATE');
      for (const row of rows) result.prepare('INSERT OR IGNORE INTO service VALUES (?,?)').run(row.key,row.value);
      result.prepare("INSERT INTO service VALUES ('legacyModelReceipts','true')").run();
      result.exec('COMMIT');
    } catch (error) { if (result.isTransaction) result.exec('ROLLBACK'); throw error; }
    finally { old.close(); }
  }
  return result;
}
export const registry = registries.get(dataDir) ?? openRegistry();
registries.set(dataDir, registry);
export function serviceValue<T>(key: string, fallback: T): T {
  const row = registry.prepare('SELECT value FROM service WHERE key=?').get(key) as {value:string}|undefined;
  return row ? JSON.parse(row.value) : fallback;
}
export function setServiceValue(key: string, value: unknown) { registry.prepare('INSERT OR REPLACE INTO service VALUES (?,?)').run(key,JSON.stringify(value)); }
export function isAlive(pid: number) { try { if (!Number.isInteger(pid) || pid <= 0) return false; process.kill(pid,0); return true; } catch(error) { return (error as NodeJS.ErrnoException).code==='EPERM'; } }
function registryChange<T>(change:()=>T):T {
  const ownsTransaction=!registry.isTransaction;
  if(ownsTransaction)registry.exec('BEGIN IMMEDIATE');
  try {const result=change();if(ownsTransaction)registry.exec('COMMIT');return result;}
  catch(error){if(ownsTransaction)registry.exec('ROLLBACK');throw error;}
}
// Whole-library reset coordination, independent of retired browser accounts.
export function beginOperation(kind:'request'|'read'|'worker'|'delete'|'export'|'download'|'cleanup') {
  // Commit dead-owner recovery even if admission below is refused.
  activeOperations();
  return registryChange(()=>{
    const active=activeOperations(),exporting=active.some(item=>item.kind==='export');
    if(serviceValue('libraryResetPending',false)&&kind!=='delete')throw new HttpError(409,'An interrupted library reset must finish before the library can be used. Restart Frok to resume it, or retry Delete all my stuff.');
    if(active.some(item=>item.kind==='cleanup')&&kind!=='read')throw new HttpError(409,'Job cleanup is in progress. Please retry shortly.');
    if(kind==='cleanup'&&active.some(item=>['delete','export','download'].includes(item.kind)))throw new HttpError(409,'Wait for the library reset or backup to finish before deleting job details.');
    if(kind==='delete'&&active.some(item=>['export','download'].includes(item.kind)))throw new HttpError(409,'Wait for the export or backup download to finish before deleting your data.');
    if(exporting&&!['read','download'].includes(kind))throw new HttpError(409,'A backup is being prepared. Please wait before making changes.');
    if(serviceValue('maintenance',false)&&kind!=='delete'&&!(exporting&&['read','download'].includes(kind)))throw new HttpError(409,'The library is being reset. Please wait.');
    if(kind==='delete'&&active.some(item=>item.kind==='delete'))throw Error('A reset is already in progress.');
    if(kind==='export'&&active.some(item=>['worker','delete'].includes(item.kind)))throw new HttpError(409,'Wait for the current job or library reset to finish, then export again.');
    const id=randomUUID();registry.prepare('INSERT INTO operations VALUES (?,?,?)').run(id,process.pid,kind);
    // The existing maintenance flag also pauses workers launched before this
    // code update; queued jobs resume as soon as the snapshot is complete.
    if(kind==='export'||kind==='delete')setServiceValue('maintenance',true);
    return id;
  });
}
export function endOperation(id:string){
  registryChange(()=>{
    const row=registry.prepare('SELECT kind FROM operations WHERE id=?').get(id);
    registry.prepare('DELETE FROM operations WHERE id=?').run(id);
    if(row?.kind==='export'||row?.kind==='delete')setServiceValue('maintenance',serviceValue('libraryResetPending',false)||!!registry.prepare("SELECT 1 FROM operations WHERE kind IN ('export','delete') LIMIT 1").get());
  });
}
export function activeOperations(){
  return registryChange(()=>{
    const rows=registry.prepare('SELECT id,pid,kind FROM operations').all() as {id:string;pid:number;kind:string}[];
    const active:typeof rows=[];let abandonedMaintenance=false;
    for(const row of rows){
      if(isAlive(row.pid)){active.push(row);continue;}
      // A legacy reset has no phase journal. It may already have removed files;
      // retain its confirmed intent and finish it before exposing library data.
      if(row.kind==='delete')setServiceValue('libraryResetPending',true);
      if(row.kind==='delete'||row.kind==='export')abandonedMaintenance=true;
      registry.prepare('DELETE FROM operations WHERE id=?').run(row.id);
    }
    // Keep legacy workers paused too while a confirmed reset needs completion.
    if((abandonedMaintenance||serviceValue('libraryResetPending',false))&&!active.some(row=>row.kind==='delete'||row.kind==='export'))setServiceValue('maintenance',serviceValue('libraryResetPending',false));
    return active;
  });
}
