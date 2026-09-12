import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { abandonedReferenceAge, jobInputs, mediaInputs, unusedReferences } from './reference-cleanup';
import type { Job, Media } from './types';

function entries(directory: string) {
  try { return fs.readdirSync(directory, { withFileTypes: true }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
}

// Intentionally bypass libraryDatabase(): an audit must not initialize, migrate,
// recover or delete anything in the library it is inspecting.
export function auditLibrary(directory: string, now = Date.now()) {
  const database = new DatabaseSync(path.join(directory, 'frok.sqlite'), { readOnly: true });
  try {
    database.exec('BEGIN');
    const media = (database.prepare('SELECT data FROM media').all() as { data: string }[]).map(row => JSON.parse(row.data) as Media);
    const jobs = (database.prepare('SELECT data FROM jobs').all() as { data: string }[]).map(row => JSON.parse(row.data) as Job);
    const mediaIds = new Set(media.map(item => item.id)), jobIds = new Set(jobs.map(job => job.id));
    const filenames = new Set(media.map(item => item.filename));
    const mediaFiles = entries(path.join(directory, 'media')).filter(item => item.isFile());
    const existing = new Set(mediaFiles.map(item => item.name));
    const missingInputs = [
      ...media.flatMap(item => mediaInputs(item).filter(id => !mediaIds.has(id)).map(inputId => ({ owner: 'media', id: item.id, inputId }))),
      ...jobs.flatMap(job => jobInputs(job).filter(id => !mediaIds.has(id)).map(inputId => ({ owner: 'job', id: job.id, inputId }))),
    ];
    return {
      directory, readOnly: true, counts: { media: media.length, jobs: jobs.length },
      unusedReferenceUploads: unusedReferences(media, jobs).map(item => ({ id: item.id, filename: item.filename, eligibleForCleanup: Date.parse(item.createdAt) <= now - abandonedReferenceAge })),
      untrackedMedia: mediaFiles.filter(file => !filenames.has(file.name)).map(file => ({ filename: file.name, bytes: fs.statSync(path.join(directory, 'media', file.name)).size })),
      missingMedia: media.filter(item => !existing.has(item.filename)).map(item => ({ id: item.id, filename: item.filename })),
      missingInputs,
      untrackedJobDirectories: entries(path.join(directory, 'jobs')).filter(item => item.isDirectory() && !jobIds.has(item.name)).map(item => item.name),
      pendingRecovery: {
        deletions: entries(path.join(directory, 'deletions')).map(item => item.name),
        publications: entries(path.join(directory, 'publications')).map(item => item.name),
      },
    };
  } finally { database.close(); }
}
