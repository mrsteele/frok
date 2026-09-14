import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

function stat(file) {
  try { return fs.lstatSync(file); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
function directory(folder) {
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const info = stat(folder);
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error(`Expected a regular application-data folder: ${folder}`);
}
function digest(file) {
  const hash = createHash('sha256'), buffer = Buffer.alloc(64 * 1024), fd = fs.openSync(file, 'r');
  try { let count; while ((count = fs.readSync(fd, buffer))) hash.update(buffer.subarray(0, count)); return hash.digest('hex'); }
  finally { fs.closeSync(fd); }
}

// Only known machine files move. Job logs and unrecognized user files stay put.
// Call before launching the backend, with any previous Frok instance stopped.
export function migrateApplicationData({ home, state, logs }) {
  const oldLogs = path.join(home, 'logs'), oldLogStat = stat(oldLogs);
  if (oldLogStat && (!oldLogStat.isDirectory() || oldLogStat.isSymbolicLink())) throw Error('Expected a regular legacy logs directory.');
  const entries = [
    ...['credentials.json', 'window.json'].map(name => ({ from: path.join(home, name), to: path.join(state, name), log: false })),
    ...['backend.log', 'backend.log.previous', 'updates.log', 'updates.log.previous'].map(name => ({ from: path.join(oldLogs, name), to: path.join(logs, name), log: true })),
  ];
  const moves = [];
  for (const entry of entries) {
    if (entry.from === entry.to) continue;
    const source = stat(entry.from);
    if (!source) continue;
    if (!source.isFile() || source.isSymbolicLink()) throw Error(`Expected a regular saved file: ${entry.from}`);
    const checksum = digest(entry.from), target = stat(entry.to);
    if (target) {
      if (!target.isFile() || target.isSymbolicLink()) throw Error(`Expected a regular saved file: ${entry.to}`);
      if (digest(entry.to) === checksum) { moves.push({ ...entry, checksum, duplicate: true }); continue; }
      if (!entry.log) throw Error(`Saved settings exist in both ${entry.from} and ${entry.to}. Both copies were preserved; resolve the conflict before reopening Frok.`);
      // Preserve both diagnostic histories if the new location already has a log.
      entry.to += `.migrated-${randomUUID()}`;
    }
    moves.push({ ...entry, checksum, duplicate: false });
  }
  directory(state); directory(logs);
  for (const move of moves) {
    if (!move.duplicate) {
      // An exclusive copy also supports workspaces on a different volume.
      fs.copyFileSync(move.from, move.to, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(move.to, 0o600);
      if (digest(move.to) !== move.checksum) throw Error(`Could not verify migrated file: ${move.from}. The original was preserved.`);
    }
    if (digest(move.from) !== move.checksum) throw Error(`A saved file changed during migration: ${move.from}. Close other Frok instances before retrying.`);
    fs.unlinkSync(move.from);
  }
  // Remove only an empty former log folder (plus Finder's own metadata).
  if (oldLogStat && path.resolve(oldLogs) !== path.resolve(logs)) {
    const remaining = fs.readdirSync(oldLogs);
    if (remaining.every(name => name === '.DS_Store')) {
      if (remaining.length) fs.unlinkSync(path.join(oldLogs, '.DS_Store'));
      fs.rmdirSync(oldLogs);
    }
  }
}
