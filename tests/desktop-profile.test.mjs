import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { migrateDesktopProfile } from '../desktop/profile.mjs';

test('profile migration preserves partitions while leaving portable data in place', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frok-profile-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'workspace'), profile = path.join(root, 'app-data/Frok');
  fs.mkdirSync(path.join(home, 'desktop-profile/Partitions/frok'), { recursive: true });
  fs.mkdirSync(path.join(home, 'data'), { recursive: true });
  fs.writeFileSync(path.join(home, 'data/user.txt'), 'portable');
  fs.writeFileSync(path.join(home, 'desktop-profile/Partitions/frok/Preferences'), 'preserve');
  migrateDesktopProfile(home, profile);
  assert.equal(fs.existsSync(path.join(home, 'desktop-profile')), false);
  assert.equal(fs.readFileSync(path.join(profile, 'Partitions/frok/Preferences'), 'utf8'), 'preserve');
  assert.equal(fs.readFileSync(path.join(home, 'data/user.txt'), 'utf8'), 'portable');
  assert.doesNotThrow(() => migrateDesktopProfile(home, profile));
});

test('a conflicting profile is never overwritten or partially migrated', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'frok-profile-conflict-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, 'workspace'), previous = path.join(home, 'desktop-profile'), profile = path.join(root, 'app-data');
  for (const folder of [previous, profile]) fs.mkdirSync(folder, { recursive: true });
  fs.writeFileSync(path.join(previous, 'Cache'), 'old');
  fs.writeFileSync(path.join(previous, 'Preferences'), 'old preferences');
  fs.writeFileSync(path.join(profile, 'Preferences'), 'existing preferences');
  assert.throws(() => migrateDesktopProfile(home, profile), /already exists/);
  assert.equal(fs.existsSync(path.join(profile, 'Cache')), false);
  assert.equal(fs.readFileSync(path.join(profile, 'Preferences'), 'utf8'), 'existing preferences');
  assert.equal(fs.readFileSync(path.join(previous, 'Preferences'), 'utf8'), 'old preferences');
});
