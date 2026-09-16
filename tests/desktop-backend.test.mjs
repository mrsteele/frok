import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { copyDir } from 'builder-util';
import { copyDesktopBackend } from '../scripts/desktop-backend.mjs';

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'frok-backend-copy-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const checkout = path.join(root, 'checkout'), standalone = path.join(checkout, '.next-desktop/standalone');
  const backend = path.join(root, '.desktop/backend'), packaged = path.join(root, 'release/resources/backend');
  await fs.mkdir(path.join(standalone, '.next-desktop/node_modules'), { recursive: true });
  return { checkout, standalone, backend, packaged };
}

test('Windows dependency junctions remain usable after packaging and removal of the build checkout', async t => {
  const { checkout, standalone, backend, packaged } = await fixture(t);
  const sharp = path.join(checkout, 'node_modules/sharp');
  const native = path.join(checkout, 'node_modules/native-fixture');
  await fs.mkdir(sharp, { recursive: true });
  await fs.mkdir(native, { recursive: true });
  await fs.writeFile(path.join(sharp, 'index.js'), "module.exports = require('./native');\n");
  await fs.writeFile(path.join(native, 'index.js'), "module.exports = 'synthetic native dependency';\n");
  // Junctions use absolute targets on Windows. Other hosts exercise the same
  // copy policy with absolute directory symlinks, without requiring Windows.
  await fs.symlink(native, path.join(sharp, 'native'), 'junction');
  const alias = path.join('.next-desktop', 'node_modules', 'sharp-trace');
  await fs.symlink(sharp, path.join(standalone, alias), 'junction');
  await copyDesktopBackend(standalone, backend, { platform: 'win32' });
  // Use electron-builder's actual extraResources copier for the second move.
  await copyDir(backend, packaged);
  assert.equal((await fs.lstat(path.join(packaged, alias))).isSymbolicLink(), false);
  assert.equal((await fs.lstat(path.join(packaged, alias, 'native'))).isSymbolicLink(), false);
  await fs.rm(checkout, { recursive: true, force: true });
  await fs.rm(backend, { recursive: true, force: true });
  const require = createRequire(path.join(packaged, 'probe.cjs'));
  assert.equal(require('./' + alias.split(path.sep).join('/')), 'synthetic native dependency');
});

test('Unix relative dependency links remain relative through both packaging copies', { skip: process.platform === 'win32' }, async t => {
  const { checkout, standalone, backend, packaged } = await fixture(t);
  const sharp = path.join(standalone, 'node_modules/sharp');
  await fs.mkdir(sharp, { recursive: true });
  await fs.writeFile(path.join(sharp, 'index.js'), "module.exports = 'portable dependency';\n");
  const alias = path.join('.next-desktop', 'node_modules', 'sharp-trace');
  await fs.symlink('../../node_modules/sharp', path.join(standalone, alias));
  await copyDesktopBackend(standalone, backend);
  await copyDir(backend, packaged);
  await fs.rm(checkout, { recursive: true, force: true });
  await fs.rm(backend, { recursive: true, force: true });
  assert.equal(await fs.readlink(path.join(packaged, alias)), '../../node_modules/sharp');
  const require = createRequire(path.join(packaged, 'probe.cjs'));
  assert.equal(require('./' + alias.split(path.sep).join('/')), 'portable dependency');
});

for (const platform of ['win32', 'linux']) {
  test(`standalone copying excludes private and development files for ${platform}`, async t => {
    const { standalone, backend } = await fixture(t);
    const excluded = ['src/route.ts', 'tests/test.mjs', 'dev/fixture.json', 'scripts/build.mjs', '.env.local', '.data/private.json', '.desktop/private.json', 'pipelines/private.json', 'db.sqlite-wal', 'weights.gguf', 'weights.safetensors', '.DS_Store'];
    for (const file of [...excluded, '.next-desktop/server/route.js']) {
      await fs.mkdir(path.dirname(path.join(standalone, file)), { recursive: true });
      await fs.writeFile(path.join(standalone, file), 'synthetic fixture');
    }
    await copyDesktopBackend(standalone, backend, { platform });
    for (const file of excluded) await assert.rejects(fs.access(path.join(backend, file)), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(backend, '.next-desktop/server/route.js'), 'utf8'), 'synthetic fixture');
  });
}
