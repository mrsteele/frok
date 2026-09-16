import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { copyDir } from 'builder-util';
import { copyDesktopBackend } from '../scripts/desktop-backend.mjs';
import { copySharpWindowsRuntime, checkDesktopSharp } from '../scripts/desktop-native.mjs';

async function fixture(t) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'frok-native-test-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const checkout = path.join(root, 'checkout'), standalone = path.join(checkout, 'standalone');
  const backend = path.join(root, 'backend'), packaged = path.join(root, 'packaged');
  await fs.mkdir(standalone, { recursive: true });
  return { checkout, standalone, backend, packaged };
}

test('Windows Sharp includes untraced DLLs after both packaging copies and removal of the checkout', async t => {
  const { checkout, standalone, backend, packaged } = await fixture(t);
  const sharp = path.join(checkout, 'node_modules/sharp');
  const name = '@img/sharp-win32-x64', native = path.join(checkout, 'node_modules', name);
  await fs.mkdir(sharp, { recursive: true });
  await fs.writeFile(path.join(sharp, 'index.js'), 'module.exports = {};');
  await fs.mkdir(path.join(native, 'lib'), { recursive: true });
  await fs.writeFile(path.join(native, 'package.json'), JSON.stringify({ name, exports: { './package': './package.json' } }));
  const files = ['lib/sharp-win32-x64.node', 'lib/libvips-42.dll', 'lib/libvips-cpp-8.18.6.dll', 'LICENSE', 'versions.json'];
  for (const file of files) await fs.writeFile(path.join(native, file), `synthetic native fixture: ${file}`);
  // The trace contains the addon but misses libraries loaded by Windows.
  const traced = path.join(standalone, 'node_modules', name, 'lib');
  await fs.mkdir(traced, { recursive: true });
  await fs.copyFile(path.join(native, files[0]), path.join(traced, 'sharp-win32-x64.node'));
  await copyDesktopBackend(standalone, backend, { platform: 'win32' });
  await assert.rejects(fs.access(path.join(backend, 'node_modules', name, files[1])), { code: 'ENOENT' });
  await copySharpWindowsRuntime(checkout, backend, { platform: 'win32', arch: 'x64' });
  await copyDir(backend, packaged);
  await fs.rm(checkout, { recursive: true, force: true });
  await fs.rm(backend, { recursive: true, force: true });
  for (const file of files) assert.equal(await fs.readFile(path.join(packaged, 'node_modules', name, file), 'utf8'), `synthetic native fixture: ${file}`);
});

test('Windows packaging rejects a missing native package; other platforms do not need Windows binaries', async t => {
  const { checkout, backend } = await fixture(t);
  const sharp = path.join(checkout, 'node_modules/sharp');
  await fs.mkdir(sharp, { recursive: true });
  await fs.writeFile(path.join(sharp, 'index.js'), 'module.exports = {};');
  await copySharpWindowsRuntime(checkout, backend, { platform: 'darwin', arch: 'arm64' });
  await assert.rejects(copySharpWindowsRuntime(checkout, backend, { platform: 'win32', arch: 'x64' }), /@img\/sharp-win32-x64\/package/);
});

test('a relocated Sharp runtime processes a PNG and the preflight rejects a missing native binary', async t => {
  const { checkout, standalone, backend, packaged } = await fixture(t);
  const source = path.resolve('node_modules');
  const sharp = JSON.parse(await fs.readFile(path.join(source, 'sharp/package.json'), 'utf8'));
  const required = ['sharp', ...Object.keys(sharp.dependencies)];
  for (const name of [...required, ...Object.keys(sharp.optionalDependencies)]) {
    const directory = path.join(source, name);
    if (!required.includes(name) && !(await fs.stat(directory).catch(() => undefined))) continue;
    await fs.cp(directory, path.join(standalone, 'node_modules', name), { recursive: true, dereference: true });
  }
  await copyDesktopBackend(standalone, backend);
  await copyDir(backend, packaged);
  await fs.rm(checkout, { recursive: true, force: true });
  await fs.rm(backend, { recursive: true, force: true });
  assert.match(await checkDesktopSharp(packaged, process.execPath), /native PNG encode, decode and resize/);

  const img = path.join(packaged, 'node_modules/@img');
  for (const name of await fs.readdir(img)) {
    if (!name.startsWith('sharp-')) continue;
    const lib = path.join(img, name, 'lib');
    for (const file of await fs.readdir(lib).catch(() => [])) {
      // On Windows leave the addon intact: reproducing ERR_DLOPEN_FAILED
      // specifically requires removing the sibling DLLs it loads.
      if (process.platform === 'win32' ? file.endsWith('.dll') : file.endsWith('.node')) await fs.unlink(path.join(lib, file));
    }
  }
  await assert.rejects(checkDesktopSharp(packaged, process.execPath), /Could not load the "sharp" module/);
});
