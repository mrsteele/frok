import { legacyDefaults } from './preferences';
import { emptyPipelines } from './pipelines/schema';
import path from "node:path";
import { existsSync } from 'node:fs';
import { randomUUID } from "node:crypto";
import { dataDir, expandPath, comfyServiceUrl } from "./config";
import { defaultPipelinesDir } from './paths';
import { defaultRunnerLocations, resolveRunnerLocations, comfyUsesFolder, type RunnerLocations } from './runner-locations';
import type { Media, Job, Settings, Runner, Adapters, MediaFamily } from "./types";
import { defaultAdapters } from "./adapters";
import { groupMediaFamily } from "./media-family";
import { assetId } from "./asset-groups";
import { assignAssetNumber, migrateAssetNumbers } from './asset-numbers';
import { defaultOllamaUrl, machineOllamaConfig } from './ollama-defaults';
import { libraryStore } from "./library";
import { registerPromptJob, registerPromptMedia } from './prompt-library';
import { defaultImageModel, type ImageModelId } from './image-models';
import { modelConnection, connectionIds, type Connections, type ModelSelections } from './service-config';
export const db = libraryStore;
export function getValue<T>(key: string, fallback: T): T {
  const row = db.prepare("SELECT value FROM settings WHERE key=?").get(key) as { value: string } | undefined;
  return row ? JSON.parse(row.value) : fallback;
}
export function setValue(key: string, value: unknown) { db.prepare("INSERT OR REPLACE INTO settings VALUES (?,?)").run(key, JSON.stringify(value)); }
export function runnerLocations() {
  // Keep an older installation's workspace until its owner chooses another.
  const legacy=path.join(dataDir,'vpipe');
  const locations=resolveRunnerLocations(getValue<Partial<RunnerLocations>>('runnerLocations',{}),existsSync(legacy)?legacy:undefined,legacyDefaults());
  // Validate migrated defaults too, before exposing them through settings.
  comfyServiceUrl(locations.comfyUrl);
  return locations;
}
export function connectionFields() {
  const defaults={...defaultRunnerLocations(),ollamaUrl:defaultOllamaUrl()};
  const current=settings();
  // Show custom/legacy locations honestly, but leave default values empty.
  const values=Object.fromEntries(Object.entries(defaults).map(([key,value])=>{
    const field=key as keyof typeof defaults;
    const same=field==='ollamaUrl'||field==='comfyUrl'?new URL(current[field]).origin===new URL(value).origin:expandPath(current[field])===expandPath(value);
    return [field,same?'':current[field]];
  })) as typeof defaults;
  const home=path.dirname(defaults.vpipeWorkdir);
  const display=(folder:string)=>folder.startsWith(home+path.sep)?'~/'+path.relative(home,folder).split(path.sep).join('/'):folder;
  return {values,defaults:{...defaults,vpipeWorkdir:display(defaults.vpipeWorkdir),comfyDir:display(defaults.comfyDir)}};
}
export function comfyDirectory(area:'input'|'output'|'temp') {
  const saved=getValue<Partial<RunnerLocations>>('runnerLocations',{});
  if(!comfyUsesFolder(saved)&&legacyDefaults()[`COMFYUI_${area.toUpperCase()}_DIR`])return legacyDefaults()[`COMFYUI_${area.toUpperCase()}_DIR`];
  return area==='temp'?undefined:path.join(expandPath(runnerLocations().comfyDir),area);
}
export const pipelineDirectorySetting=()=>getValue<string>('pipelineDirectory',legacyDefaults().FROK_PIPELINES_DIR||'');
export const pipelineDirectory=()=>pipelineDirectorySetting()?expandPath(pipelineDirectorySetting()):defaultPipelinesDir;
export function settings(): Settings {
  const legacyRunner=getValue<Runner>('runner', legacyDefaults().AI_RUNNER === 'comfyui' ? 'comfyui' : 'vpipe');
  const legacySetup=getValue('setupDismissed',false), legacyVideo=getValue<Runner|null>('runner',null);
  // Only saved choices migrate. Detecting a runtime never enables it automatically.
  const savedModelSelections=getValue<ModelSelections>('modelSelections',{
    image:getValue<ImageModelId|null>('imageModel',legacySetup||legacyVideo?defaultImageModel(legacyRunner):null),
    video:legacySetup?legacyRunner:legacyVideo,reference:legacySetup?legacyRunner:null,
    prompt:getValue<string|null>('ollamaModel',legacySetup?machineOllamaConfig().model:''),
    upscale:getValue<Settings['upscaler']|null>('upscaler',legacySetup?(legacyDefaults().VIDEO_UPSCALER==='seedvr2'?'seedvr2':'realesrgan'):null),
  });
  const connections=getValue<Connections>('connections',Object.fromEntries(connectionIds.map(id=>[id,Object.keys(savedModelSelections).some(key=>modelConnection(key as keyof ModelSelections,savedModelSelections)===id)])) as Connections);
  const modelSelections={...savedModelSelections,prompt:savedModelSelections.prompt===''?(connections.ollama?machineOllamaConfig().model:null):savedModelSelections.prompt};
  // Legacy fields remain derived runner inputs; modelSelections controls whether each capability is enabled.
  return { pipelineDirectory:pipelineDirectorySetting(), connections, modelSelections, promptModelSetting:savedModelSelections.prompt, pipelineSelections:getValue('pipelineSelections',emptyPipelines),
    imageModel:modelSelections.image||defaultImageModel(legacyRunner),ollamaModel:modelSelections.prompt||machineOllamaConfig().model,ollamaUrl:getValue('ollamaUrl',machineOllamaConfig().url)||defaultOllamaUrl(),
    upscaler:modelSelections.upscale||'realesrgan',runner:modelSelections.video||legacyRunner,
    ...runnerLocations(),
    setupDismissed:getValue('setupDismissed',false),videoAdapters:getValue<Adapters>('videoAdapters',{...defaultAdapters}),referenceAdapters:getValue<Adapters>('referenceAdapters',{...defaultAdapters}) };
}

export const workdir = () => expandPath(settings().vpipeWorkdir);
export function listMedia(favorites = false, limit = 72, before?: string): Media[] {
  return (db.prepare(`SELECT data FROM media WHERE (? = 0 OR json_extract(data,'$.favorite') = 1) AND (? IS NULL OR json_extract(data,'$.createdAt') < ?) ORDER BY json_extract(data,'$.createdAt') DESC LIMIT ?`).all(favorites ? 1 : 0, before || null, before || null, limit) as {data: string}[]).map(r=>JSON.parse(r.data));
}
export function getMedia(id: string): Media | undefined { const r = db.prepare("SELECT data FROM media WHERE id=?").get(id) as { data: string } | undefined; return r && JSON.parse(r.data); }
export function saveMedia(media: Media, publishFile?: () => void) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const parent = media.kind === 'video' ? getMedia(media.rootId || media.sourceId || '') : undefined;
    const rootId = parent ? assetId(parent) : media.kind === 'image' ? media.id : assetId(media);
    const root = getMedia(rootId);
    // The root owns the heart. Appending a render cannot restore stale per-file state.
    const saved = registerPromptMedia(db, { ...media, rootId, assetNumber:assignAssetNumber(db,media,rootId), favorite: root?.favorite ?? parent?.favorite ?? media.favorite });
    // File publication shares this write lock with registration and recovery.
    publishFile?.();
    db.prepare("INSERT OR REPLACE INTO media(id,data) VALUES (?,?)").run(saved.id, JSON.stringify(saved));
    db.exec('COMMIT'); return saved;
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function favoriteMedia(id: string, favorite: boolean) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const item = getMedia(id);
    if (item) {
      db.prepare("UPDATE media SET data=json_set(data,'$.favorite',json(?)) WHERE id=? OR json_extract(data,'$.rootId')=?").run(JSON.stringify(favorite), assetId(item), assetId(item));
      setValue('mediaRevision', getValue('mediaRevision', 0) + 1);
    }
    db.exec('COMMIT'); return item && getMedia(id);
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function getJob(id: string): Job | undefined { const r = db.prepare("SELECT data FROM jobs WHERE id=?").get(id) as { data: string } | undefined; return r && JSON.parse(r.data); }
export function listJobs(): Job[] { return (db.prepare("SELECT data FROM jobs WHERE json_extract(data,'$.dismissedAt') IS NULL AND (status IN ('queued','running') OR id IN (SELECT id FROM jobs WHERE status NOT IN ('queued','running') AND json_extract(data,'$.dismissedAt') IS NULL ORDER BY created_at DESC LIMIT 100)) ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END, created_at DESC").all() as {data: string}[]).map(r=>JSON.parse(r.data)); }
export function createJob(input: Pick<Job, "kind" | "request" | "runner" | "total">) {
  const now = new Date().toISOString();
  let job: Job = { ...input, id: randomUUID(), status: "queued", completed: 0, message: "Waiting for the local runner", createdAt: now, updatedAt: now };
  db.exec('BEGIN IMMEDIATE');
  try {
    if(input.kind==='generate') {
      const request=input.request as import('./types').Generation;
      for(const id of [request.sourceId,request.rootId,...request.referenceIds])if(id&&!getMedia(id))throw new Error('Source media was deleted. Choose an available image or video.');
    }
    job = registerPromptJob(db, job);
    db.prepare("INSERT INTO jobs VALUES (?,?,?,?)").run(job.id, job.status, now, JSON.stringify(job));
    db.exec('COMMIT');return job;
  }catch(error){db.exec('ROLLBACK');throw error;}

}
export function updateJob(id: string, patch: Partial<Job>): Job | undefined {
  db.exec("BEGIN IMMEDIATE");
  try {
    const job = getJob(id);
    if (!job) { db.exec("COMMIT"); return; }
    // Cancellation wins races against worker progress and completion.
    if (job.status === "cancelled" && patch.status !== "cancelled") { db.exec("COMMIT"); return job; }
    const now=new Date().toISOString();
    if(patch.status==='running' && job.status==='queued')job.startedAt=now;
    if(patch.status && ['completed','failed','cancelled'].includes(patch.status) && !job.finishedAt) {
      job.finishedAt=patch.finishedAt || now;
      if(job.startedAt)job.elapsedSeconds=(job.accumulatedSeconds||0)+Math.max(0,(Date.parse(job.finishedAt)-Date.parse(job.startedAt))/1000);
    }
    Object.assign(job, patch, { updatedAt: now });
    db.prepare("UPDATE jobs SET status=?,data=? WHERE id=?").run(job.status, JSON.stringify(job), id);
    db.exec("COMMIT"); return job;
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}
// Serialize moves with worker claims so stale drag targets cannot move running jobs.
export function moveQueuedJob(id: string, action: 'move' | 'next' | 'start', beforeId?: string | null): Job {
  db.exec('BEGIN IMMEDIATE');
  try {
    const job=getJob(id);
    if(!job || job.status!=='queued')throw new Error('Only pending jobs can be moved. Refresh the queue and try again.');
    const pending=(db.prepare("SELECT data FROM jobs WHERE status='queued' ORDER BY COALESCE(json_extract(data,'$.queuePosition'), (julianday(created_at)-2440587.5)*86400000), created_at, id").all() as {data:string}[]).map(row=>JSON.parse(row.data) as Job).filter(item=>item.id!==id);
    let index=0;
    if(action==='move') {
      index=beforeId==null?pending.length:pending.findIndex(item=>item.id===beforeId);
      if(index<0)throw new Error('The drop target is no longer pending. Refresh the queue and try again.');
    }
    pending.splice(index,0,job);
    if(action==='start') {
      const row=db.prepare("SELECT data FROM jobs WHERE status='running' LIMIT 1").get() as {data:string}|undefined;
      if(row){const current=JSON.parse(row.data) as Job;current.pauseRequested=true;current.message='Stopping to run the selected job; remaining outputs will resume';pending.splice(1,0,current);}
    }
    const now=new Date().toISOString();
    pending.forEach((item,position)=>{item.queuePosition=position;item.updatedAt=now;db.prepare('UPDATE jobs SET data=? WHERE id=?').run(JSON.stringify(item),item.id);});
    db.exec('COMMIT');return job;
  } catch(error){db.exec('ROLLBACK');throw error;}
}

export function resumeInterruptedJob(id: string, elapsedSeconds: number) {
  return updateJob(id,{status:'queued',pauseRequested:false,accumulatedSeconds:elapsedSeconds,elapsedSeconds:undefined,startedAt:undefined,finishedAt:undefined,step:null,videoProgress:undefined,error:undefined,message:'Waiting to resume remaining outputs'});
}

export function claimJob(): Job | undefined {
  db.exec("BEGIN IMMEDIATE");
  try {
    if(db.prepare("SELECT 1 FROM jobs WHERE status='running' LIMIT 1").get()){db.exec('COMMIT');return;}
    const row = db.prepare("SELECT data FROM jobs WHERE status='queued' ORDER BY COALESCE(json_extract(data,'$.queuePosition'), (julianday(created_at)-2440587.5)*86400000), created_at, id LIMIT 1").get() as {data: string} | undefined;
    if (!row) { db.exec("COMMIT"); return; }
    const job: Job = JSON.parse(row.data); job.status = "running"; job.startedAt = job.updatedAt = new Date().toISOString();
    db.prepare("UPDATE jobs SET status='running',data=? WHERE id=?").run(JSON.stringify(job), job.id);
    db.exec("COMMIT"); return job;
  } catch (e) { db.exec("ROLLBACK"); throw e; }
}

export function mediaRoot(id: string): Media | undefined {
  const seen=new Set<string>(); let current=getMedia(id);
  while(current && (current.kind!=='image'||current.origin==='poster')){
    if(seen.has(current.id))throw new Error('This media has an invalid source chain.');
    seen.add(current.id);
    const parent=current.rootId || current.sourceId;
    if(!parent||parent===current.id)return current;
    current=getMedia(parent);
  }
  return current;
}
export function mediaFamily(id: string): MediaFamily {
  migrateAssetNumbers(db);
  const root=mediaRoot(id);if(!root)throw new Error('The starting asset is no longer available.');
  const rows=db.prepare(`WITH RECURSIVE related(id) AS (
    SELECT ? UNION SELECT m.id FROM media m JOIN related r ON json_extract(m.data,'$.sourceId')=r.id OR json_extract(m.data,'$.rootId')=r.id
  ) SELECT data FROM media WHERE id IN (SELECT id FROM related)`).all(root.id) as {data:string}[];
  const members=rows.map(row=>JSON.parse(row.data) as Media);
  return {...groupMediaFamily(root,members),legacyRootIds:members.filter(item=>item.origin==='poster').map(item=>item.id),references:root.generation?.mode==='reference'?root.generation.referenceIds.map(id=>({id,media:getMedia(id)})):undefined};
}

// Retained API name; a heart always applies to the entire creation.
export const favoriteRender = favoriteMedia;

export function listAssets(favorites = false, limit = 72, before?: string, kind?: 'image' | 'video') {
  migrateAssetNumbers(db);
  let time: string | null = null, cursorId: string | null = null;
  if (before) {
    const parsed = JSON.parse(Buffer.from(before, 'base64url').toString('utf8'));
    if (!Array.isArray(parsed) || parsed.length !== 2 || !parsed.every(value => typeof value === 'string')) throw new Error('Invalid library cursor.');
    [time, cursorId] = parsed;
  }
  // Rank whole groups BEFORE filtering or paginating, so older siblings never reappear.
  const rows = db.prepare(`WITH ranked AS (
    SELECT id, data, ROW_NUMBER() OVER (PARTITION BY json_extract(data,'$.rootId') ORDER BY
      json_extract(data,'$.createdAt') DESC, json_extract(data,'$.kind')='video' DESC,
      json_extract(data,'$.origin')='upscale' DESC, id DESC) AS position FROM media
  ) SELECT data FROM ranked WHERE position=1
    AND (?=0 OR json_extract(data,'$.favorite')=1)
    AND json_extract(data,'$.origin')!='poster' AND COALESCE(json_extract(data,'$.referenceOnly'),0)=0
    AND (? IS NULL OR json_extract(data,'$.kind')=?)
    AND (? IS NULL OR json_extract(data,'$.createdAt')<? OR (json_extract(data,'$.createdAt')=? AND id<?))
    ORDER BY json_extract(data,'$.createdAt') DESC,id DESC LIMIT ?`).all(favorites ? 1 : 0, kind || null, kind || null, time, time, time, cursorId, limit + 1) as { data: string }[];
  const media = rows.slice(0, limit).map(row => JSON.parse(row.data) as Media), last = media.at(-1);
  return { media, nextCursor: rows.length > limit && last ? Buffer.from(JSON.stringify([last.createdAt,last.id])).toString('base64url') : null };
}

export function listSessionMedia(jobIds: string[]): Media[] {
  migrateAssetNumbers(db);
  if (!jobIds.length) return [];
  const ids = JSON.stringify(jobIds);
  const rows = db.prepare(`WITH roots(id) AS (
    SELECT json_extract(data,'$.rootId') FROM media WHERE json_extract(data,'$.jobId') IN (SELECT value FROM json_each(?))
    UNION SELECT json_extract(m.data,'$.rootId') FROM jobs j JOIN media m ON m.id=COALESCE(json_extract(j.data,'$.request.sourceId'),json_extract(j.data,'$.request.rootId'))
      WHERE j.id IN (SELECT value FROM json_each(?))
  ) SELECT data FROM media WHERE json_extract(data,'$.rootId') IN (SELECT id FROM roots)`).all(ids,ids) as { data: string }[];
  return rows.map(row => JSON.parse(row.data));
}
