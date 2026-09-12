import type { DatabaseSync } from 'node:sqlite';
import { assetId } from './asset-groups';
import type { PromptSection } from './envision';
import type { Generation, Job, Media } from './types';

type StoredSection = Omit<PromptSection, 'jobIds'>;
const mediaById = (db: DatabaseSync, id?: string): Media | undefined => {
  const row = id && db.prepare('SELECT data FROM media WHERE id=?').get(id);
  return row ? JSON.parse(String(row.data)) : undefined;
};
function rootFor(db: DatabaseSync, id?: string) {
  const item = mediaById(db, id);
  return item && (mediaById(db, assetId(item)) || item);
}
const sectionFor = (db: DatabaseSync, id: string): StoredSection | undefined => {
  const row = db.prepare('SELECT data FROM prompt_sections WHERE id=?').get(id);
  return row ? JSON.parse(String(row.data)) : undefined;
};
function saveSection(db: DatabaseSync, section: StoredSection) {
  db.prepare('INSERT OR REPLACE INTO prompt_sections VALUES (?,?,?)').run(section.id, section.createdAt, JSON.stringify(section));
}
function repeatRequest(request?: Generation): Generation | undefined {
  if (!request || request.mode === 'upscale') return;
  const { pipeline: _pipeline, ollama: _ollama, pipelineChoices: _choices, ...controls } = request;
  return controls;
}

// Called inside the same transaction that queues a job or saves an output.
export function registerPromptJob(db: DatabaseSync, job: Job, migrating = false): Job {
  if (job.kind !== 'generate') return job;
  const request = job.request as Generation;
  const source = rootFor(db, request.sourceId || request.rootId);
  const id = source?.sectionId || (source && (source.jobId || source.id)) || request.sectionId || job.id;
  const existing = sectionFor(db, id);
  if (!existing && request.sectionId && !source && !migrating) throw Error('This prompt section is no longer available. Start a new idea.');
  const nextRequest = repeatRequest(source?.generation?.mode === 'image' ? source.generation : request);
  saveSection(db, existing ? { ...existing, request: request.mode === 'image' || !existing.request ? nextRequest : existing.request } : {
    id, sourceId: source?.id, prompt: source?.prompt || request.prompt || request.videoPreset?.name || 'Uploaded image',
    createdAt: source?.createdAt || job.createdAt, request: nextRequest,
  });
  return { ...job, request: { ...request, sectionId: id } };
}
export function registerPromptMedia(db: DatabaseSync, media: Media): Media {
  if (media.referenceOnly || media.origin === 'poster') return media;
  const root = rootFor(db, media.rootId || media.sourceId);
  const row = media.jobId && db.prepare('SELECT data FROM jobs WHERE id=?').get(media.jobId);
  const job: Job | undefined = row ? JSON.parse(String(row.data)) : undefined;
  const request = media.generation || (job?.kind === 'generate' ? job.request as Generation : undefined);
  const id = root?.sectionId || media.sectionId || request?.sectionId || media.jobId || media.id;
  if (!sectionFor(db, id)) saveSection(db, {
    id, sourceId: media.origin === 'upload' ? media.id : undefined,
    prompt: root?.prompt || media.prompt || 'Uploaded image', createdAt: root?.createdAt || job?.createdAt || media.createdAt,
    request: repeatRequest(request),
  });
  return { ...media, sectionId: id };
}

export function initializePromptLibrary(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS prompt_sections (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS prompt_section_order ON prompt_sections(created_at DESC,id DESC);
    CREATE INDEX IF NOT EXISTS media_section ON media(json_extract(data,'$.sectionId'));
    CREATE INDEX IF NOT EXISTS job_section ON jobs(json_extract(data,'$.request.sectionId'));
    CREATE INDEX IF NOT EXISTS media_without_section ON media(id) WHERE json_extract(data,'$.sectionId') IS NULL;`);
  if (db.prepare("SELECT 1 FROM settings WHERE key='promptLibraryVersion'").get()) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    const media = (db.prepare("SELECT data FROM media ORDER BY json_extract(data,'$.createdAt'),id").all() as {data:string}[]).map(row => JSON.parse(row.data) as Media);
    // Roots first, so all SD/HD versions inherit the original image's section.
    for (const item of [...media.filter(item => assetId(item) === item.id), ...media.filter(item => assetId(item) !== item.id)]) {
      db.prepare('UPDATE media SET data=? WHERE id=?').run(JSON.stringify(registerPromptMedia(db, item)), item.id);
    }
    for (const row of db.prepare('SELECT data FROM jobs ORDER BY created_at,id').all() as {data:string}[]) {
      const job = registerPromptJob(db, JSON.parse(row.data), true);
      db.prepare('UPDATE jobs SET data=? WHERE id=?').run(JSON.stringify(job), job.id);
    }
    db.prepare("INSERT INTO settings VALUES ('promptLibraryVersion','1')").run();
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

function decodeCursor(value?: string): [string, string] | undefined {
  if (!value) return;
  const parsed: unknown = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
  if (!Array.isArray(parsed) || parsed.length !== 2 || !parsed.every(item => typeof item === 'string')) throw Error('Invalid prompt cursor.');
  return parsed as [string, string];
}
export type PromptLibraryPage = { sections: PromptSection[]; media: Media[]; nextCursor: string | null; endCursor: string | null; revision: number };
// A worker started before the upgrade may finish later with the previous record shape.
function includeLateOutputs(db: DatabaseSync) {
  const missing = () => db.prepare("SELECT data FROM media WHERE json_extract(data,'$.sectionId') IS NULL AND COALESCE(json_extract(data,'$.referenceOnly'),0)=0 AND json_extract(data,'$.origin')!='poster' ORDER BY json_extract(data,'$.createdAt'),id").all() as {data:string}[];
  if (!missing().length) return;
  db.exec('BEGIN IMMEDIATE');
  try {
    const media=missing().map(row=>JSON.parse(row.data) as Media);
    for (const item of [...media.filter(item=>assetId(item)===item.id),...media.filter(item=>assetId(item)!==item.id)]) {
      db.prepare('UPDATE media SET data=? WHERE id=?').run(JSON.stringify(registerPromptMedia(db,item)),item.id);
    }
    db.exec('COMMIT');
  } catch(error) { db.exec('ROLLBACK'); throw error; }
}
export function listPromptLibrary(db: DatabaseSync, options: {before?: string; through?: string; limit?: number} = {}): PromptLibraryPage {
  const before = decodeCursor(options.before), through = decodeCursor(options.through), limit = options.limit ?? 12;
  includeLateOutputs(db);
  const rows = db.prepare(`SELECT s.id,s.created_at,s.data FROM prompt_sections s WHERE
    (EXISTS(SELECT 1 FROM media m WHERE json_extract(m.data,'$.sectionId')=s.id AND COALESCE(json_extract(m.data,'$.referenceOnly'),0)=0 AND json_extract(m.data,'$.origin')!='poster')
      OR EXISTS(SELECT 1 FROM jobs j WHERE json_extract(j.data,'$.request.sectionId')=s.id AND j.status IN ('queued','running','failed')))
    ORDER BY s.created_at DESC,s.id DESC`).all() as {id:string;created_at:string;data:string}[];
  const candidates = rows.filter(row => !before || row.created_at < before[0] || (row.created_at === before[0] && row.id < before[1]));
  const selected = through ? candidates.filter(row => row.created_at > through[0] || (row.created_at === through[0] && row.id >= through[1])) : candidates.slice(0, limit);
  const ids = JSON.stringify(selected.map(row => row.id));
  const media = (db.prepare("SELECT data FROM media WHERE json_extract(data,'$.sectionId') IN (SELECT value FROM json_each(?)) ORDER BY json_extract(data,'$.createdAt'),id").all(ids) as {data:string}[]).map(row => JSON.parse(row.data) as Media);
  const jobs = db.prepare("SELECT id,created_at,json_extract(data,'$.request.sectionId') AS section FROM jobs WHERE json_extract(data,'$.request.sectionId') IN (SELECT value FROM json_each(?)) ORDER BY created_at,id").all(ids) as {id:string;created_at:string;section:string}[];
  const sections = selected.map(row => {
    const section: StoredSection = JSON.parse(row.data);
    const members = media.filter(item => item.sectionId === row.id), ordered = new Map<string,string>();
    for (const job of jobs.filter(job => job.section === row.id)) ordered.set(job.id, job.created_at);
    for (const item of members) if (item.jobId && !ordered.has(item.jobId)) ordered.set(item.jobId, item.createdAt);
    return { ...section, jobIds: [...ordered].sort((a,b) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0])).map(([id]) => id) };
  });
  const last = selected.at(-1), endCursor = last ? Buffer.from(JSON.stringify([last.created_at,last.id])).toString('base64url') : null;
  const revision = db.prepare("SELECT value FROM settings WHERE key='mediaRevision'").get();
  return { sections, media, endCursor, nextCursor: selected.length < candidates.length ? endCursor : null, revision: revision ? JSON.parse(String(revision.value)) : 0 };
}
