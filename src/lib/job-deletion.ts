import fs from 'node:fs/promises';
import path from 'node:path';
import { db, getJob } from './db';
import { libraryJobsDir } from './library';
import { beginOperation, endOperation } from './registry';
import { cleanupComfyJob } from './comfyui';
import { assertJobDeletable, commitDeletion, recoverDeletionFiles, storedMedia, storedJobs } from './deletion-files';
import { abandonedReferences } from './reference-cleanup';
import { recoverMediaPublications } from './media-publication';
import { runtimeOptions } from './preferences';
import type { Job } from './types';
import { HttpError } from './request-security';

export const terminalJobs = () => (db.prepare("SELECT data FROM jobs WHERE status IN ('completed','failed','cancelled')").all() as { data: string }[]).map(row => JSON.parse(row.data) as Job);

export async function withJobCleanup<T>(action: () => Promise<T>) {
  const operation = beginOperation('cleanup');
  try { return await action(); } finally { endOperation(operation); }
}

export async function prepareJobDeletion(ids: string[]) {
  ids.forEach(assertJobDeletable);
  const root = await fs.lstat(libraryJobsDir());
  if (!root.isDirectory() || root.isSymbolicLink()) throw Error('Job cleanup requires a regular jobs folder.');
  for (const id of ids) {
    const directory = path.join(libraryJobsDir(), id);
    const stat = await fs.lstat(directory).catch(error => { if (error.code !== 'ENOENT') throw error; });
    if (!stat) continue;
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Job cleanup requires a regular job directory.');
    const children = await fs.readdir(directory, { withFileTypes: true });
    for (const folder of [directory, ...children.filter(item => item.isDirectory() && /^\d+$/.test(item.name)).map(item => path.join(directory, item.name))]) {
      if ((await cleanupComfyJob(folder)).pending) throw new HttpError(409, 'Runner cleanup is still pending. Job details and files have been kept; reconnect the original runner and retry.');
    }
  }
  ids.forEach(assertJobDeletable);
}

export async function deleteJobs(id?: string) {
  return withJobCleanup(async () => {
    recoverDeletionFiles();
    if (id) assertJobDeletable(id);
    const ids = id ? [id] : terminalJobs().map(job => job.id);
    await prepareJobDeletion(ids);
    return commitDeletion(() => ({ media: [], jobIds: ids }));
  });
}

export async function cleanupExpiredJobs(now = Date.now()) {
  return withJobCleanup(async () => {
    recoverDeletionFiles();
    recoverMediaPublications();
    let deletedJobs = 0, pending = 0;
    const references = commitDeletion(() => ({ media: abandonedReferences(storedMedia(), storedJobs(), now), jobIds: [] }));
    if (references.cleanupPending) pending++;
    const hours = runtimeOptions().jobRetentionHours;
    if (hours === null) return { deletedJobs, pending };
    const cutoff = now - hours * 3_600_000;
    const expired = (job: Job) => Date.parse(job.finishedAt || job.updatedAt || job.createdAt) <= cutoff;
    for (const job of terminalJobs().filter(expired)) {
      try {
        await prepareJobDeletion([job.id]);
        const result = commitDeletion(() => ({ media: [], jobIds: getJob(job.id) && expired(getJob(job.id)!) ? [job.id] : [] }));
        deletedJobs += result.deletedJobs;
        if (result.cleanupPending) pending++;
      } catch { pending++; }
    }
    return { deletedJobs, pending };
  });
}
