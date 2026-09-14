import fs from 'node:fs/promises';
import { constants, createWriteStream } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { backup, DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { libraryDatabase, libraryDirectory } from './library';
import { pipelineDirectory, getValue } from './db';
import { dataDir } from './paths';
import { activeOperations, beginOperation, endOperation } from './registry';
import { assertAppRequest, HttpError, privateResponse } from './request-security';
import { readJson } from './request-body';
import { exportPreferencesSchema, type ExportPreferences, type LibraryExport } from './export-preferences';
import { writeArchive, type ArchiveEntry } from './tar';
import appPackage from '../../package.json';
import { retentionDefaults } from '../../desktop/preferences.mjs';

const lifetime=retentionDefaults.exportHours*60*60*1000;
const exportsDirectory=()=>path.join(/* turbopackIgnore: true */libraryDirectory(),'exports');
const json=(value:unknown)=>JSON.stringify(value,null,2)+'\n';
const excludedDirectories=new Set(['models','runtimes','node_modules','.git','downloads','cache','caches']);
const modelFile=/\.(?:safetensors|gguf|ggml|ckpt|pt|pth|onnx|npy|npz|bin|dylib|exe|metallib)$/i;
const filename=(id:string,date:Date)=>'frok-backup-'+date.toISOString().slice(0,10)+'-'+id.slice(0,8)+'.tar.gz';

async function regularDirectory(directory:string,create=false) {
  if(create)await fs.mkdir(/* turbopackIgnore: true */directory,{recursive:true,mode:0o700});
  const stat=await fs.lstat(/* turbopackIgnore: true */directory);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Export requires regular library and pipeline directories, not symbolic links.');
}
async function fileEntry(file:string,name:string):Promise<ArchiveEntry> {
  const stat=await fs.lstat(/* turbopackIgnore: true */file);
  if(!stat.isFile()||stat.isSymbolicLink())throw Error('An export file is missing or is a symbolic link.');
  return {name,file,size:stat.size,mtimeMs:stat.mtimeMs,dev:stat.dev,ino:stat.ino};
}
async function cleanExpiredExports() {
  // Do not unlink any archive while a download is using this directory.
  if(activeOperations().some(item=>item.kind==='download'))return;
  for(const entry of await fs.readdir(exportsDirectory(),{withFileTypes:true})) {
    if(!/^(?:building-[a-f0-9-]{36}|[a-f0-9-]{36}\.tar\.gz)$/.test(entry.name))continue;
    const file=path.join(exportsDirectory(),entry.name),stat=await fs.lstat(file);
    if(Date.now()-stat.mtimeMs>lifetime)await fs.rm(file,{recursive:true,force:true});
  }
}
function* metadata(database:DatabaseSync) {
  yield '{"format":"frok-library","version":1';
  for(const table of ['media','jobs','prompt_sections','settings'] as const) {
    yield ',"'+table+'":[';let first=true;
    const query=table==='settings'?'SELECT key,value FROM settings ORDER BY key':'SELECT data FROM '+table+' ORDER BY id';
    for(const row of database.prepare(query).iterate()) {
      if(!first)yield ',';first=false;
      yield table==='settings'?JSON.stringify({key:row.key,value:JSON.parse(String(row.value))}):String(row.data);
    }
    yield ']';
  }
  yield '}\n';
}

export async function createLibraryExport(preferences:ExportPreferences,signal:AbortSignal):Promise<LibraryExport> {
  const operation=beginOperation('export');
  let staging:string|undefined,archive:string|undefined,complete=false;
  try {
    // Requests already admitted before the export lock must finish first.
    const deadline=Date.now()+15_000;
    while(activeOperations().some(item=>item.kind==='request')) {
      signal.throwIfAborted();
      if(Date.now()>deadline)throw new HttpError(409,'Another change is still in progress. Please try exporting again shortly.');
      await delay(50,undefined,{signal});
    }
    const database=libraryDatabase();
    if(database.prepare("SELECT 1 FROM jobs WHERE status='running' LIMIT 1").get())throw new HttpError(409,'Wait for the running job to finish or cancel it before exporting.');
    signal.throwIfAborted();
    await regularDirectory(libraryDirectory());
    await regularDirectory(exportsDirectory(),true);
    await cleanExpiredExports();
    const id=randomUUID(),createdAt=new Date();
    staging=path.join(exportsDirectory(),'building-'+id);await fs.mkdir(staging,{mode:0o700});
    const entries:ArchiveEntry[]=[],skipped:{path:string;reason:string}[]=[],warnings:string[]=[];
    const add=async(file:string,name:string)=>{entries.push(await fileEntry(file,name));};
    const document=async(name:string,value:string)=>{
      const file=path.join(staging!,randomUUID());await fs.writeFile(file,value,{mode:0o600});await add(file,name);
    };
    const walk=async(directory:string,prefix:string,definitionsOnly=false):Promise<void>=>{
      const stat=await fs.lstat(/* turbopackIgnore: true */directory).catch(error=>{if(error.code==='ENOENT')return;throw error;});
      if(!stat)return;
      if(stat.isSymbolicLink()){skipped.push({path:prefix,reason:'Symbolic link; target was not read.'});return;}
      if(stat.isDirectory()) {
        for(const child of (await fs.readdir(/* turbopackIgnore: true */directory)).sort()) {
          signal.throwIfAborted();
          if(excludedDirectories.has(child)){skipped.push({path:prefix+'/'+child,reason:'Runner, model or cache directory.'});continue;}
          await walk(path.join(/* turbopackIgnore: true */directory,child),prefix+'/'+child,definitionsOnly);
        }
        return;
      }
      if(!stat.isFile()){skipped.push({path:prefix,reason:'Not a regular file.'});return;}
      if(/^\.env(?:\.|$)/.test(path.basename(prefix))||/\.(?:pem|key|p12|pfx)$/.test(prefix)){skipped.push({path:prefix,reason:'Environment or credential file.'});return;}
      if(modelFile.test(prefix)){skipped.push({path:prefix,reason:'Model weights or runtime binary.'});return;}
      if(definitionsOnly&&!/\.(?:vpipeline|json|md|txt)$/i.test(prefix)&&!/(?:LICENSE|NOTICE)$/.test(prefix)){skipped.push({path:prefix,reason:'Not a pipeline definition or its documentation.'});return;}
      // SQLite's online backup includes committed WAL contents; copying just the
      // main file can silently lose the latest records.
      if(prefix.endsWith('.sqlite')) {
        const source=new DatabaseSync(directory,{readOnly:true}),snapshot=path.join(staging!,randomUUID());
        try{await backup(source,snapshot);}finally{source.close();}
        await add(snapshot,prefix);
      }else if(!/\.sqlite-(?:wal|shm)$/.test(prefix))await add(directory,prefix);
    };

    const snapshot=path.join(staging,'frok.sqlite');
    await backup(database,snapshot);
    signal.throwIfAborted();
    await add(snapshot,'library/frok.sqlite');
    const copy=new DatabaseSync(snapshot,{readOnly:true});
    let mediaCount=0,jobCount=0;
    try {
      const details=path.join(staging,'library.json');
      await pipeline(Readable.from(metadata(copy)),createWriteStream(details,{flags:'wx',mode:0o600}),{signal});
      await add(details,'library.json');
      for(const name of ['media','jobs','deletions','publications'])await walk(path.join(/* turbopackIgnore: true */libraryDirectory(),name),'library/'+name);
      const included=new Set(entries.map(entry=>entry.name));
      for(const row of copy.prepare('SELECT data FROM media').iterate()) {
        const item=JSON.parse(String(row.data));
        if(typeof item.filename!=='string'||path.basename(item.filename)!==item.filename||!included.has('library/media/'+item.filename))throw Error('An image or video is missing or cannot be exported safely. Repair the missing media before deleting your library.');
        mediaCount++;
      }
      jobCount=Number(copy.prepare('SELECT COUNT(*) AS n FROM jobs').get()!.n);
    }finally{copy.close();}

    // Reset also removes retained pre-release content. Include it if present,
    // without following the runner/model symlinks inside old job directories.
    for(const name of ['users','media','jobs','deletions','frok.sqlite'])await walk(path.join(/* turbopackIgnore: true */dataDir,name),'retained-data/'+name);
    const pipelines=pipelineDirectory();
    const pipelineStat=await fs.lstat(/* turbopackIgnore: true */pipelines).catch(error=>{if(error.code==='ENOENT')return;throw error;});
    if(pipelineStat) {
      await regularDirectory(pipelines);
      for(const kind of ['image','video','reference','upscale'])await walk(path.join(/* turbopackIgnore: true */pipelines,kind),'pipelines/'+kind,true);
    for(const name of ['VPIPE-LICENSE','VPIPE-NOTICE','LICENSE','NOTICE'])await walk(path.join(/* turbopackIgnore: true */pipelines,name),'pipelines/'+name,true);
    }else warnings.push('The configured pipeline folder was not found; no pipeline files were included.');
    if(skipped.length)warnings.push('Some model, runtime, cache or linked files were excluded. See manifest.json for the list.');
    await document('preferences.json',json({version:1,localStorage:{...preferences,...getValue('interfacePreferences',{})}}));
    await document('README.txt',[
      'Frok library backup — format version 1','',
      'Extract this .tar.gz with your archive utility. Media are ordinary files in library/media.',
      'library.json contains all media metadata, prompts, favorites, jobs and saved service settings.',
      'library/frok.sqlite is a consistent SQLite backup. library/jobs contains retained job files and logs.',
      'preferences.json contains recipes and generation/audio preferences from the workspace. These are also saved in library/frok.sqlite.',
      'pipelines contains your pipeline definitions. retained-data, when present, contains older content also covered by Delete all my stuff.',
      'manifest.json lists exclusions. Models, runners, environment credentials and symlink targets are not bundled.','',
      'Manual recovery (there is no in-app Import button yet):',
      '1. Keep an untouched copy of this archive. Quit Frok completely, including its tray process.',
      '2. Move the current library folder aside, then put this archive’s library folder in its place.',
      '   Default location for desktop and browser development: ~/frok/data/library.',
      '   Do not merge old SQLite WAL/SHM files with the restored database.',
      '3. Restore custom pipeline definitions to your configured pipeline directory as needed; preserve existing files.',
      '4. Start Frok. Check connection paths on this machine. Reinstall models separately if needed.',
      '5. Recipes and generation/audio preferences restore with the database; no Electron profile is required.',
      'Queued jobs remain queued in the restored library. Finish or cancel pending work before restoring if you do not want it to run.',
      '', 'Confirm your downloaded archive opens successfully before deleting your data.',
    ].join('\n')+'\n');
    await document('manifest.json',json({format:'frok-backup',version:1,appVersion:appPackage.version,createdAt:createdAt.toISOString(),media:mediaCount,jobs:jobCount,pipelineDirectory:pipelines,files:entries.map(({name,size})=>({path:name,bytes:size})),skipped,warnings}));
    archive=path.join(exportsDirectory(),id+'.tar.gz');
    await writeArchive(entries,archive,signal);
    const bytes=(await fs.stat(/* turbopackIgnore: true */archive)).size;
    signal.throwIfAborted();complete=true;
    return {id,filename:filename(id,createdAt),bytes,download:'/api/library/export/'+id,warnings};
  }catch(error){
    if((error as NodeJS.ErrnoException).code==='ENOSPC')throw new HttpError(507,'There is not enough temporary disk space to prepare the backup. Free some space and try again; your library has not been changed.');
    throw error;
  }finally{
    try{if(!complete&&archive)await fs.rm(archive,{force:true});if(staging)await fs.rm(staging,{recursive:true,force:true});}
    finally{endOperation(operation);}
  }
}

export async function handleLibraryExport(request:Request,id?:string) {
  assertAppRequest(request);
  if(!id) {
    if(request.method!=='POST')throw new HttpError(405,'Method not allowed.');
    const body=z.object({preferences:exportPreferencesSchema.default({})}).strict().parse(await readJson(request,1_000_000));
    return privateResponse(Response.json(await createLibraryExport(body.preferences,request.signal)));
  }
  z.string().uuid().parse(id);
  if(!['GET','HEAD'].includes(request.method))throw new HttpError(405,'Method not allowed.');
  const operation=beginOperation('download');
  let file:Awaited<ReturnType<typeof fs.open>>|undefined,streaming=false;
  try {
    await regularDirectory(exportsDirectory());
    const source=path.join(exportsDirectory(),id+'.tar.gz');
    const entry=await fileEntry(source,'backup.tar.gz');
    if(Date.now()-entry.mtimeMs>lifetime)throw new HttpError(404,'This export expired. Create a new backup.');
    file=await fs.open(source,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
    const stat=await file.stat();
    if(stat.size!==entry.size||stat.ino!==entry.ino||stat.dev!==entry.dev)throw Error('The backup changed. Create a new export.');
    const headers={'Content-Type':'application/gzip','Content-Disposition':'attachment; filename="'+filename(id,new Date(entry.mtimeMs))+'"','Content-Length':String(entry.size)};
    if(request.method==='HEAD')return privateResponse(new Response(null,{headers}));
    const stream=file.createReadStream({signal:request.signal});
    stream.once('close',()=>endOperation(operation));
    streaming=true;
    return privateResponse(new Response(Readable.toWeb(stream) as ReadableStream,{headers}));
  }catch(error){
    if((error as NodeJS.ErrnoException).code==='ENOENT')throw new HttpError(404,'This export is no longer available. Create a new backup.');
    throw error;
  }finally{if(!streaming){try{await file?.close();}finally{endOperation(operation);}}}
}
