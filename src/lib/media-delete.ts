import { createHash } from 'node:crypto';
import { db, getJob } from './db';
import { assertJobDeletable, commitDeletion, recoverDeletionFiles, storedJobs } from './deletion-files';
import { referencesReleasedByDeletion } from './reference-cleanup';
import { prepareJobDeletion, withJobCleanup } from './job-deletion';
import { assetId } from './asset-groups';
import type { DeletePlan, DeleteTarget, Generation, Media } from './types';

const rows = () => (db.prepare('SELECT data FROM media').all() as { data: string }[]).map(row => JSON.parse(row.data) as Media);

function selection(target: DeleteTarget) {
  const all = rows(), byId = new Map(all.map(item => [item.id, item]));
  const jobs = storedJobs(), active = jobs.filter(job => ['queued', 'running'].includes(job.status));
  const inUse = new Set<string>();
  for (const job of active.filter(job => job.kind === 'generate')) {
    const request = job.request as Generation;
    for (const id of [request.sourceId, request.rootId, ...request.referenceIds]) if (id) inUse.add(id);
    for (const item of all) if (item.jobId === job.id) inUse.add(item.id);
  }
  function ancestors(ids: Set<string>) {
    const pending = [...ids];
    for (const id of pending) {
      const item = byId.get(id);
      for (const parent of [item?.sourceId, item?.rootId,...(item?.generation?.referenceIds||[])]) if (parent && !ids.has(parent)) { ids.add(parent); pending.push(parent); }
    }
  }
  ancestors(inUse);
  let selected: Media[], protectedCount = 0;
  if (target.scope === 'history') {
    const keep = new Set([...inUse, ...all.filter(item => item.favorite).map(item => item.id)]);
    ancestors(keep);
    // Saved groups already share a heart; also retain HD versions of active inputs.
    let added = true;
    while(added){added=false;for(const item of all)if(item.origin==='upscale'&&keep.has(item.sourceId||'')&&!keep.has(item.id)){keep.add(item.id);added=true;}}
    protectedCount = all.filter(item => item.origin !== 'upload' && keep.has(item.id)).length;
    selected = all.filter(item => item.origin !== 'upload' && !keep.has(item.id));
  } else if (target.scope === 'section') {
    const jobIds = new Set(target.jobIds);
    if (target.sectionId) for (const row of db.prepare("SELECT id FROM jobs WHERE json_extract(data,'$.request.sectionId')=?").all(target.sectionId)) jobIds.add(String(row.id));
    const roots = new Set(all.filter(item => (target.sectionId && item.sectionId === target.sectionId) || (item.jobId && jobIds.has(item.jobId))).map(assetId));
    for (const id of jobIds) {
      const job = getJob(id);
      if (job?.kind !== 'generate') continue;
      const source = byId.get((job.request as Generation).sourceId || (job.request as Generation).rootId || '');
      if (source) roots.add(assetId(source));
    }
    const protectedRoots = new Set(all.filter(item => item.favorite).map(assetId));
    protectedCount = all.filter(item => roots.has(assetId(item)) && protectedRoots.has(assetId(item))).length;
    selected = all.filter(item => roots.has(assetId(item)) && !protectedRoots.has(assetId(item)));
  } else {
    let item = byId.get(target.id);
    if (!item) throw new Error('This item has already been deleted.');
    // Deleting either version deletes the render's SD and HD copies together.
    const seen = new Set<string>();
    while (item.origin === 'upscale' && item.sourceId && !seen.has(item.id)) { seen.add(item.id); const parent = byId.get(item.sourceId); if (!parent) break; item = parent; }
    const selectedIds = new Set([item.id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const candidate of all) {
        const belongs = item.kind === 'image' || item.id === assetId(item)
          ? selectedIds.has(candidate.sourceId || '') || selectedIds.has(candidate.rootId || '')
          : candidate.origin === 'upscale' && selectedIds.has(candidate.sourceId || '');
        if (belongs && !selectedIds.has(candidate.id)) { selectedIds.add(candidate.id); changed = true; }
      }
    }
    selected = all.filter(candidate => selectedIds.has(candidate.id));
  }
  const ids = new Set(selected.map(item => item.id));
  const sectionActive = target.scope === 'section' && active.some(job => target.jobIds.includes(job.id) || (!!target.sectionId && (job.request as Generation).sectionId === target.sectionId));
  const referenced=all.some(item=>!ids.has(item.id)&&item.generation?.referenceIds.some(id=>ids.has(id)));
  const blocked = sectionActive ? 'This section has active jobs. Finish or stop them in the queue before deleting it.' : selected.some(item => inUse.has(item.id)) ? 'This media is used by an active job. Finish or stop that job before deleting it.' : referenced ? 'This image is a saved reference for a video. Delete that video creation before deleting its reference images.' : undefined;
  const associated = new Set(selected.flatMap(item => item.jobId ? [item.jobId] : []));
  if (target.scope === 'section') {
    target.jobIds.forEach(id => associated.add(id));
    if (target.sectionId) for (const row of db.prepare("SELECT id FROM jobs WHERE json_extract(data,'$.request.sectionId')=?").all(target.sectionId)) associated.add(String(row.id));
  }
  for (const job of jobs) {
    if (job.kind === 'generate') {
      const request = job.request as Generation;
      if ([request.sourceId, request.rootId, ...request.referenceIds].some(id => id && ids.has(id))) associated.add(job.id);
    }
  }
  const jobIds = [...associated].sort();
  selected.push(...referencesReleasedByDeletion(all, jobs, selected, jobIds));
  let jobBlocked: string | undefined;
  try {jobIds.forEach(assertJobDeletable);}catch(error){jobBlocked=(error as Error).message;}
  const token = createHash('sha256').update(JSON.stringify([target, selected.sort((a,b) => a.id.localeCompare(b.id)).map(item => [item.id, item.filename, item.favorite, item.sourceId, item.rootId]), protectedCount, blocked||jobBlocked, jobIds])).digest('hex');
  const plan: DeletePlan = { token, total: selected.length, images: selected.filter(item => item.kind === 'image').length, referenceImages: selected.filter(item => item.referenceOnly).length, videos: selected.filter(item => item.kind === 'video' && item.origin !== 'upscale').length, hdVersions: selected.filter(item => item.origin === 'upscale').length, favorites: new Set(selected.filter(item => item.favorite && !item.referenceOnly).map(assetId)).size, protectedCount, blocked:blocked||jobBlocked, jobs:jobIds.length };
  return { plan, selected, jobIds };
}

export function deletionPlan(target: DeleteTarget): DeletePlan {
  db.exec('BEGIN IMMEDIATE');
  try { recoverDeletionFiles(); const { plan } = selection(target); db.exec('COMMIT'); return plan; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export async function deleteMedia(target: DeleteTarget, token: string) {
  return withJobCleanup(async () => {
    recoverDeletionFiles();
    const validate = () => {
      const selected = selection(target);
      if (selected.plan.blocked) throw Error(selected.plan.blocked);
      if (selected.plan.token !== token) throw Error('The library changed. Review the updated deletion details and confirm again.');
      return selected;
    };
    await prepareJobDeletion(validate().jobIds);
    return commitDeletion(() => {
      const { selected, jobIds } = validate();
      return { media: selected, jobIds };
    });
  });
}
