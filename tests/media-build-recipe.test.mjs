import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execute = promisify(execFile);
const recipe = fileURLToPath(new URL('../scripts/build-media-tools.sh', import.meta.url));

// Execute the recipe's compiler setup without downloading or compiling sources.
for (const system of ['MINGW64_NT-10.0', 'Darwin', 'Linux']) {
  test(`media recipe configures static pkgconf linkage under ${system}`, { skip: process.platform === 'win32' }, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'frok-media-recipe-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const bin = path.join(root, 'bin');
    await fs.mkdir(bin);
    for (const [name, contents] of [
      ['uname', `if [ "$1" = '-m' ]; then echo x86_64; else echo '${system}'; fi`],
      ['nasm', 'exit 0'],
      ['make', 'exit 0'],
    ]) await fs.writeFile(path.join(bin, name), `#!/bin/sh\n${contents}\n`, { mode: 0o755 });
    for (const component of ['pkgconf', 'zlib', 'x264', 'ffmpeg']) {
      const directory = path.join(root, component);
      await fs.mkdir(directory);
      await fs.writeFile(path.join(directory, 'configure'), `#!/bin/sh
printf '%s\\n' "$CPPFLAGS" > cppflags.txt
printf '%s\\n' "$CC" > compiler.txt
printf '%s\\n' "$@" > arguments.txt
`, { mode: 0o755 });
    }
    await execute('bash', [recipe], {
      cwd: root,
      env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, CPPFLAGS: '-DFROK_BUILD_PROBE=1' },
      timeout: 15_000,
    });
    const read = (component, file) => fs.readFile(path.join(root, component, file), 'utf8');
    assert.equal(await read('pkgconf', 'cppflags.txt'), '-DFROK_BUILD_PROBE=1 -DPKGCONFIG_IS_STATIC\n');
    assert.match(await read('pkgconf', 'arguments.txt'), /--disable-shared\n--enable-static\n/);
    for (const component of ['zlib', 'x264', 'ffmpeg']) {
      assert.equal(await read(component, 'cppflags.txt'), '-DFROK_BUILD_PROBE=1\n', 'pkgconf-specific flags must not leak to other libraries');
    }
    assert.equal(await read('pkgconf', 'compiler.txt'), `${system.startsWith('MINGW') ? 'gcc' : system === 'Darwin' ? 'clang' : 'cc'}\n`);
  });
}
