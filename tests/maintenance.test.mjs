import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { examples, syncExamples } from '../docs/scripts/sync-examples.mjs';

test('changing the Node pin and supported range updates the shared runtime values and checks', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frok-node-version-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'scripts'));
  await fs.copyFile(new URL('../scripts/node-version.mjs', import.meta.url), path.join(root, 'scripts/node-version.mjs'));
  await fs.writeFile(path.join(root, '.node-version'), '26.2.3\n');
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ engines: { node: '>=26.1.0' } }));
  const runtime = await import(pathToFileURL(path.join(root, 'scripts/node-version.mjs')).href);
  assert.equal(runtime.nodeVersion, '26.2.3');
  assert.equal(runtime.nodeTarget, 'node26.1.0');
  for (const version of ['26.1.0', '26.2.3', '27.0.0']) assert.doesNotThrow(() => runtime.requireSupportedNode(version));
  for (const version of ['25.99.99', '26.0.9']) assert.throws(() => runtime.requireSupportedNode(version), /requires Node/);
});

test('example downloads refresh changed factories and attribution without rewriting unchanged files', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frok-docs-examples-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const factory = path.join(root, 'factory'), output = path.join(root, 'public');
  for (const [folder, files] of Object.values(examples)) {
    await fs.mkdir(path.join(factory, folder), { recursive: true });
    for (const filename of files) await fs.writeFile(path.join(factory, folder, filename), `original ${filename}`);
  }
  for (const name of ['VPIPE-LICENSE', 'VPIPE-NOTICE']) await fs.writeFile(path.join(factory, name), `original ${name}`);
  await syncExamples(factory, output);
  const target = path.join(output, 'krea/run.vpipeline');
  const before = (await fs.stat(target)).mtimeMs;
  await syncExamples(factory, output);
  assert.equal((await fs.stat(target)).mtimeMs, before);
  await fs.writeFile(path.join(factory, examples.krea[0], 'run.vpipeline'), 'updated workflow');
  await fs.writeFile(path.join(factory, 'VPIPE-NOTICE'), 'updated attribution');
  await fs.writeFile(path.join(output, 'krea/run.json'), 'old generated format');
  await fs.writeFile(path.join(output, 'krea/notes.md'), 'keep documentation');
  await syncExamples(factory, output);
  assert.equal(await fs.readFile(target, 'utf8'), 'updated workflow');
  for (const name of ['krea', 'minimax', 'reference']) assert.equal(await fs.readFile(path.join(output, name, 'NOTICE.txt'), 'utf8'), 'updated attribution');
  await assert.rejects(fs.stat(path.join(output, 'krea/run.json')), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(output, 'krea/notes.md'), 'utf8'), 'keep documentation');
});
