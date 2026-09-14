import fs from 'node:fs';
import path from 'node:path';

// Chromium owns this directory. Only Frok's portable data belongs in the workspace.
export function migrateDesktopProfile(home, profile) {
  const previous = path.join(home, 'desktop-profile');
  if (!fs.existsSync(previous)) return;
  if (path.resolve(previous) === path.resolve(profile)) throw Error('The Electron profile must be outside the workspace.');
  const stat = fs.lstatSync(previous);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('Expected a regular desktop-profile directory.');
  fs.mkdirSync(profile, { recursive: true, mode: 0o700 });
  if (fs.lstatSync(profile).isSymbolicLink()) throw Error('Expected a regular Electron profile directory.');
  const names = fs.readdirSync(previous);
  // Inspect every destination before moving anything; never overwrite a profile.
  for (const name of names) if (fs.existsSync(path.join(profile, name))) throw Error(`An Electron profile already exists at ${profile}. The previous profile is preserved at ${previous}.`);
  const moved = [];
  try {
    for (const name of names) { fs.renameSync(path.join(previous, name), path.join(profile, name)); moved.push(name); }
    fs.rmdirSync(previous);
  } catch (error) {
    for (const name of moved.reverse()) fs.renameSync(path.join(profile, name), path.join(previous, name));
    throw error;
  }
}
