import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export async function copySharpWindowsRuntime(root, backend, { platform = process.platform, arch = process.arch } = {}) {
  if (platform !== 'win32') return;
  const require = createRequire(path.join(root, 'package.json'));
  const sharpRequire = createRequire(require.resolve('sharp'));
  const name = `@img/sharp-win32-${arch}`;
  const source = path.dirname(sharpRequire.resolve(`${name}/package`));
  // Sharp's Windows addon loads sibling DLLs through the OS loader. They are
  // not JS imports, so a standalone trace can contain the addon without them.
  await fs.cp(source, path.join(backend, 'node_modules', name), { recursive: true, dereference: true });
}

export async function checkDesktopSharp(backend, node) {
  const { stdout } = await promisify(execFile)(node, ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    import path from 'node:path';
    import { fileURLToPath } from 'node:url';
    import { createRequire } from 'node:module';
    const entry = import.meta.resolve('sharp');
    function inside(file) {
      const relative = path.relative(process.cwd(), file);
      assert.ok(relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), 'Sharp must resolve inside the desktop backend: ' + file);
    }
    inside(fileURLToPath(entry));
    if (process.platform === 'win32') inside(createRequire(entry).resolve('@img/sharp-win32-' + process.arch + '/sharp.node'));
    const { default: sharp } = await import(entry);
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#123456' } }).png().toBuffer();
    const { info } = await sharp(png).resize(4, 4).raw().toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 4); assert.equal(info.height, 4); assert.equal(info.channels, 3);
    console.log('Desktop Sharp runtime passed: native PNG encode, decode and resize.');
  `], { cwd: backend, encoding: 'utf8', timeout: 30_000 });
  return stdout.trim();
}
