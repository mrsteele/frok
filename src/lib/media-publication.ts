import fs from 'node:fs';
import path from 'node:path';
import { db, getMedia, saveMedia } from './db';
import { libraryDirectory, libraryMediaDir } from './library';
import type { Media } from './types';

const journalDirectory = () => path.join(libraryDirectory(), 'publications');
const validFilename = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\.(jpg|mp4)$/i;

// Caller holds the library write lock, including during file operations.
function recoverPublications() {
  if (!fs.existsSync(journalDirectory())) return;
  for (const name of fs.readdirSync(journalDirectory())) {
    if (!name.endsWith('.json') && !name.endsWith('.tmp')) continue;
    const journal = path.join(journalDirectory(), name);
    if (name.endsWith('.json')) {
      const { filename } = JSON.parse(fs.readFileSync(journal, 'utf8')) as { filename: string };
      if (!validFilename.test(filename)) throw Error('Invalid media publication path.');
      // Legacy aliases can share a filename, so check all records.
      if (!db.prepare("SELECT 1 FROM media WHERE json_extract(data,'$.filename')=?").get(filename)) fs.rmSync(path.join(libraryMediaDir(), filename), { force: true });
    }
    fs.rmSync(journal, { force: true });
  }
}

export function recoverMediaPublications() {
  db.exec('BEGIN IMMEDIATE');
  try { recoverPublications(); db.exec('COMMIT'); }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}

// Only validated media enters the library. Interrupted encodes stay in their
// job folder; the journal recovers a crash between publishing and DB commit.
export function publishMedia(media: Media, content: Uint8Array | string) {
  if (!validFilename.test(media.filename) || media.filename !== `${media.id}.${media.kind === 'image' ? 'jpg' : 'mp4'}`) throw Error('Invalid media publication filename.');
  const journal = path.join(journalDirectory(), `${media.id}.json`);
  let saved: Media;
  try {
    saved = saveMedia(media, () => {
      recoverPublications();
      const destination = path.join(libraryMediaDir(), media.filename);
      if (getMedia(media.id) || fs.existsSync(destination)) throw Error('This media already exists.');
      fs.mkdirSync(journalDirectory(), { recursive: true });
      fs.writeFileSync(`${journal}.tmp`, JSON.stringify({ filename: media.filename }), { flag: 'wx' });
      fs.renameSync(`${journal}.tmp`, journal);
      // Hard linking is atomic, avoids copying a large video and never
      // overwrites an existing file. Both locations are in this library.
      if (typeof content === 'string') fs.linkSync(content, destination);
      else fs.writeFileSync(destination, content, { flag: 'wx' });
    });
  } catch (error) {
    try { recoverMediaPublications(); } catch { /* The journal retains cleanup ownership for the next pass. */ }
    throw error;
  }
  try { fs.rmSync(journal, { force: true }); } catch { /* Recovery keeps the registered media. */ }
  if (typeof content === 'string') try { fs.rmSync(content, { force: true }); } catch { /* The job owns this working copy. */ }
  return saved;
}
