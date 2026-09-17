import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { uploadRelease } from '../scripts/release-upload.mjs';

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'frok-upload-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.writeFile(path.join(directory, 'Frok.zip'), 'synthetic installer');
  let draft = true, exists = true;
  const assets = [], uploads = [], waits = [], creates = [];
  let failUpload, failView, failCreate, failBefore;
  const run = async args => {
    if (args[0] === 'api') return JSON.stringify([assets]);
    if (args[1] === 'view') {
      if (failView) throw Error(failView);
      if (!exists) throw Error('release not found\n');
      return JSON.stringify({ isDraft: draft, apiUrl: 'https://api.github.com/repos/test/frok/releases/1' });
    }
    if (args[1] === 'create') { exists = true; creates.push(args); if (failCreate) throw Error(failCreate); return ''; }
    assert.equal(args[1], 'upload');
    uploads.push(path.basename(args[3]));
    if (failBefore) { const message = failBefore; failBefore = undefined; throw Error(message); }
    const data = await fs.readFile(args[3]), name = path.basename(args[3]);
    const asset = { name, size: data.length, state: 'uploaded', digest: `sha256:${createHash('sha256').update(data).digest('hex')}` };
    const index = assets.findIndex(item => item.name === name);
    if (index < 0) assets.push(asset); else assets[index] = asset;
    if (failUpload) { const message = failUpload; failUpload = undefined; throw Error(message); }
    return '';
  };
  const upload = () => uploadRelease({ directory, repo: 'test/frok', tag: 'v0.1.1', version: '0.1.1', run, sleep: async ms => waits.push(ms), log: () => {} });
  return { directory, assets, uploads, waits, creates, upload, set draft(value) { draft = value; }, set exists(value) { exists = value; }, set failBefore(value) { failBefore = value; }, set failUpload(value) { failUpload = value; }, set failView(value) { failView = value; }, set failCreate(value) { failCreate = value; } };
}

test('resumes after an ambiguous HTTP 500 without reuploading a confirmed asset', async t => {
  const f = await fixture(t); f.failUpload = 'HTTP 500: Error saving asset';
  await f.upload();
  assert.deepEqual(f.uploads, ['Frok.zip', 'SHA256SUMS.txt']);
  assert.deepEqual(f.waits, [2000]);
  assert.equal(f.assets.length, 2);
  await f.upload();
  assert.equal(f.uploads.length, 2);
  assert.match(await fs.readFile(path.join(f.directory, 'SHA256SUMS.txt'), 'utf8'), /^[a-f0-9]{64}  Frok.zip\n$/);
});
test('replaces incomplete and same-size incorrect draft assets', async t => {
  const f = await fixture(t);
  f.assets.push({ name: 'Frok.zip', size: 19, state: 'uploaded', digest: `sha256:${'0'.repeat(64)}` });
  await f.upload(); assert.ok(f.uploads.includes('Frok.zip'));
  f.assets[0].state = 'starter'; f.uploads.length = 0;
  await f.upload(); assert.deepEqual(f.uploads, ['Frok.zip']);
});
test('does not recreate a draft after ambiguous creation failure', async t => {
  const f = await fixture(t); f.exists = false; f.failCreate = 'HTTP 502';
  await f.upload(); assert.equal(f.creates.length, 1);
  assert.ok(!f.creates[0].some(value => value.endsWith('.zip')));
});
test('published releases and permanent authorization errors cannot cause uploads or creation', async t => {
  const f = await fixture(t); f.draft = false;
  await assert.rejects(f.upload(), /immutable/);
  f.draft = true; f.failView = 'HTTP 403: Forbidden';
  await assert.rejects(f.upload(), /403/);
  assert.equal(f.uploads.length, 0); assert.equal(f.creates.length, 0); assert.equal(f.waits.length, 0);
});
test('persistent GitHub failures stop after bounded retries', async t => {
  const f = await fixture(t); f.failView = 'HTTP 503: Service Unavailable';
  await assert.rejects(f.upload(), /503/);
  assert.deepEqual(f.waits, [2000, 4000, 8000, 16000]);
  assert.equal(f.uploads.length, 0); assert.equal(f.creates.length, 0);
});

test('retries a failed transfer that never saved an asset', async t => {
  const f = await fixture(t); f.failBefore = 'HTTP 500: Error saving asset';
  await f.upload();
  assert.deepEqual(f.uploads, ['Frok.zip', 'Frok.zip', 'SHA256SUMS.txt']);
  assert.deepEqual(f.waits, [2000]);
  assert.equal(f.assets.length, 2);
});
