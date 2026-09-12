import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './paths';
import { migrateAssetGroups } from './asset-migration';
import { migrateAssetNumbers } from './asset-numbers';
import { migrateVideoRoots } from './video-root-migration';
import { initializePromptLibrary } from './prompt-library';

export const libraryDirectory=()=>path.join(dataDir,'library');
export const libraryMediaDir=()=>path.join(libraryDirectory(),'media');
export const libraryJobsDir=()=>path.join(libraryDirectory(),'jobs');
const globals=globalThis as unknown as {frokLibraries?:Map<string,DatabaseSync>};
const databases=globals.frokLibraries??=new Map<string,DatabaseSync>();
const numbered=new WeakSet<DatabaseSync>();
export function libraryDatabase(){
  const dir=libraryDirectory();let database=databases.get(dir);
  if(!database){
    for(const name of ['', 'media','jobs'])fs.mkdirSync(path.join(/* turbopackIgnore: true */dir,name),{recursive:true,mode:0o700});
    database=new DatabaseSync(path.join(/* turbopackIgnore: true */dir,'frok.sqlite'));
    database.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS media (id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY,status TEXT NOT NULL,created_at TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
    try {migrateAssetGroups(database);migrateAssetNumbers(database);migrateVideoRoots(database);initializePromptLibrary(database);numbered.add(database);}
    catch(error){database.close();throw error;}
    database.exec("CREATE INDEX IF NOT EXISTS media_group ON media(json_extract(data,'$.rootId')); CREATE INDEX IF NOT EXISTS media_job ON media(json_extract(data,'$.jobId')); CREATE INDEX IF NOT EXISTS media_unnumbered ON media(id) WHERE json_extract(data,'$.assetNumber') IS NULL;");
    databases.set(dir,database);
  }
  // Also initialize a cached connection when the dev server hot-reloads this module.
  if(!numbered.has(database)){migrateAssetNumbers(database);migrateVideoRoots(database);initializePromptLibrary(database);numbered.add(database);}
  return database;
}
export function closeLibraryDatabase(){const dir=libraryDirectory(),database=databases.get(dir);if(database){database.close();databases.delete(dir);}}
export const libraryStore=new Proxy({} as DatabaseSync,{get(_target,property){const database=libraryDatabase(),value=Reflect.get(database,property,database);return typeof value==='function'?value.bind(database):value;}});
