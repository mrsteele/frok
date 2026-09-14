import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { db, getJob, getMedia, getValue, setValue } from './db';
import { libraryDirectory, libraryJobsDir, libraryMediaDir } from './library';
import { activeOperations, serviceValue } from './registry';
import { HttpError } from './request-security';
import { workerStatus } from './worker-health';
import { referencesReleasedByDeletion } from './reference-cleanup';
import type { Job, Media } from './types';

export const storedMedia = () => (db.prepare('SELECT data FROM media').all() as { data: string }[]).map(row => JSON.parse(row.data) as Media);
export const storedJobs = () => (db.prepare('SELECT data FROM jobs').all() as { data: string }[]).map(row => JSON.parse(row.data) as Job);

type Entry = { id: string; filename: string; kind?: 'job' };
const stagingRoot = () => path.join(libraryDirectory(), 'deletions');
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
function location(entry: Entry) {
  if (entry.kind === 'job') {
    if (!uuid.test(entry.id) || entry.filename !== `job-${entry.id}`) throw Error('Invalid job deletion path.');
    return path.join(libraryJobsDir(), entry.id);
  }
  if (!entry.filename || entry.filename !== path.basename(entry.filename) || ['.', '..'].includes(entry.filename)) throw Error('Invalid media filename.');
  return path.join(libraryMediaDir(), entry.filename);
}

export function assertJobDeletable(id: string) {
  if (!uuid.test(id)) throw Error('Invalid job ID.');
  const job = getJob(id);
  if (job && ['queued', 'running'].includes(job.status)) throw new HttpError(409, 'Finish or cancel the job before deleting its details.');
  const workers = activeOperations().filter(item => item.kind === 'worker');
  const active = serviceValue<{ id: string; pid: number } | null>('activeJob', null);
  if (workers.some(item => item.pid === active?.pid) && active?.id === id) throw new HttpError(409, 'The runner is still stopping. Try deleting this job again when it has stopped.');
  if (workers.length && (workers.some(item => item.pid !== active?.pid) || workerStatus().outdated)) throw new HttpError(409, 'Restart Frok before deleting job details so the running worker can finish safely.');
}

// Old media-only journals use the same array format, without kind: 'job'.
export function recoverDeletionFiles() {
  if (!fs.existsSync(stagingRoot())) return;
  for (const name of fs.readdirSync(stagingRoot())) {
    if (!uuid.test(name)) continue;
    const dir = path.join(stagingRoot(), name), manifest = path.join(dir, 'manifest.json');
    if (!fs.existsSync(manifest)) continue;
    const entries = JSON.parse(fs.readFileSync(manifest, 'utf8')) as Entry[];
    for (const entry of entries) {
      const destination = location(entry), staged = path.join(dir, entry.filename);
      const retained = entry.kind === 'job' ? getJob(entry.id) : getMedia(entry.id);
      if (retained && fs.existsSync(staged) && !fs.existsSync(destination)) fs.renameSync(staged, destination);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Move files first, commit records together, then remove the staged files.
// A crash can therefore restore an uncommitted deletion or finish a committed one.
export function commitDeletion(select: () => { media: Media[]; jobIds: string[] }) {
  db.exec('BEGIN IMMEDIATE');
  let stage: string | undefined, committed = false;
  const moved: { original: string; staged: string }[] = [];
  try {
    recoverDeletionFiles();
    const selection = select(), ids = [...new Set(selection.jobIds)], all = storedMedia();
    const media = [...selection.media, ...referencesReleasedByDeletion(all, storedJobs(), selection.media, ids)];
    ids.forEach(assertJobDeletable);
    const deleted = new Set(media.map(item => item.id));
    const survivingFiles = new Set(all.filter(item => !deleted.has(item.id)).map(item => item.filename));
    const entries: Entry[] = [
      ...new Map(media.filter(item => !survivingFiles.has(item.filename)).map(item => [item.filename, { id: item.id, filename: item.filename }])).values(),
      ...ids.map(id => ({ id, filename: `job-${id}`, kind: 'job' as const })),
    ];
    entries.forEach(location);
    if (new Set(entries.map(entry => entry.filename)).size !== entries.length) throw Error('Conflicting deletion paths.');
    if (entries.length) {
      stage = path.join(stagingRoot(), randomUUID()); fs.mkdirSync(stage, { recursive: true });
      fs.writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(entries));
      for (const entry of entries) {
        const original = location(entry), staged = path.join(stage, entry.filename);
        if (fs.existsSync(original)) { fs.renameSync(original, staged); moved.push({ original, staged }); }
      }
    }
    for (const item of media) db.prepare('DELETE FROM media WHERE id=?').run(item.id);
    let deletedJobs = 0;
    for (const id of ids) deletedJobs += Number(db.prepare('DELETE FROM jobs WHERE id=?').run(id).changes);
    db.exec(`DELETE FROM prompt_sections WHERE
      NOT EXISTS(SELECT 1 FROM media WHERE json_extract(data,'$.sectionId')=prompt_sections.id)
      AND NOT EXISTS(SELECT 1 FROM jobs WHERE json_extract(data,'$.request.sectionId')=prompt_sections.id)`);
    if (media.length) setValue('mediaRevision', getValue('mediaRevision', 0) + 1);
    db.exec('COMMIT'); committed = true;
    let cleanupPending = false;
    if (stage) try { fs.rmSync(stage, { recursive: true, force: true }); } catch { cleanupPending = true; }
    return { deletedIds: media.map(item => item.id), deletedJobs, cleanupPending };
  } catch (error) {
    if (!committed) {
      let restoreFailed = false;
      try { for (const item of moved.reverse()) if (fs.existsSync(item.staged)) fs.renameSync(item.staged, item.original); }
      catch { restoreFailed = true; }
      finally { db.exec('ROLLBACK'); }
      if (restoreFailed) throw Error('Deletion was not completed. Files are held for recovery; retry after checking disk access.');
      if (stage) try { fs.rmSync(stage, { recursive: true, force: true }); } catch { /* Recovery retries the cleanup. */ }
    }
    throw error;
  }
}
