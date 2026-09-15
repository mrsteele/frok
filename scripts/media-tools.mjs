import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { checkMediaTools } from './check-media-tools.mjs';
import { downloadMediaSource } from './download-media-source.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const sources = JSON.parse(await fs.readFile(path.join(here, 'media-sources.json'), 'utf8'));
export const sha256 = data => createHash('sha256').update(data).digest('hex');
export const target = `${process.platform}-${process.arch}`;
export const mediaDirectory = root => path.join(root, '.media-tools', target);
const recipe = await fs.readFile(path.join(here, 'build-media-tools.sh'));
export const recipeId = sha256(Buffer.concat([Buffer.from(JSON.stringify(sources)), recipe]));

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {stdio: 'inherit', ...options});
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(Error(`${command} exited with ${code}. See the media build log above.`)));
  });
}

export async function checkMediaCompiler(directory, execute = promisify(execFile), platform = process.platform) {
  const probe = await fs.mkdtemp(path.join(directory, 'compiler-check-'));
  const compiler = platform === 'darwin' ? 'clang' : platform === 'win32' ? 'gcc' : 'cc';
  try {
    await fs.writeFile(path.join(probe, 'check.c'), 'int main(void) { return 0; }\n');
    await execute(compiler, ['check.c', '-o', 'check'], {cwd: probe, timeout: 30_000, encoding: 'utf8'});
  } catch (error) {
    const detail = (error.stderr || error.message).trim();
    const guidance = platform === 'darwin' && /xcode[\s\S]*license|license[\s\S]*xcode/i.test(detail)
      ? "Review Apple's license in your terminal with sudo xcodebuild -license, then retry."
      : 'Check the C toolchain prerequisites in docs/development.md, then retry.';
    throw Error(`Cannot build bundled FFmpeg: ${compiler} could not compile and link a test program.\n${detail}\n${guidance}`);
  } finally { await fs.rm(probe, {recursive: true, force: true}); }
}

// Build once per source/recipe/target revision. Installers contain the result;
// end users never download tools, compile sources, or need a system installation.
export async function ensureMediaTools(root = path.resolve(here, '..')) {
  if (!['darwin-arm64','darwin-x64','linux-x64','linux-arm64','win32-x64'].includes(target)) throw Error(`Bundled media tools do not support ${target}.`);
  const destination = mediaDirectory(root);
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(destination, 'manifest.json'), 'utf8'));
    if (manifest.recipeId === recipeId && manifest.target === target) {
      // This exact build passed linkage checks before installation. Verify its
      // bytes and runtime again without requiring developer tools at startup.
      await checkMediaTools(destination, undefined, {checkLinkage: false});
      return destination;
    }
  } catch { /* An incomplete, outdated, or altered build is rebuilt. */ }
  const cache = path.join(root, '.data/desktop-build-cache/media-sources');
  await fs.mkdir(cache, {recursive: true});
  const work = await fs.mkdtemp(path.join(root, '.data/desktop-build-cache/media-build-'));
  const stage = path.join(work, 'payload');
  try {
    // Fail before downloading/extracting sources if the compiler cannot run.
    await checkMediaCompiler(work);
    console.log('Preparing bundled FFmpeg/FFprobe from pinned sources. This build takes a few minutes.');
    await fs.mkdir(path.join(stage, 'sources'), {recursive: true});
    await fs.mkdir(path.join(stage, 'licenses'), {recursive: true});
    for (const source of sources) {
      const file = path.join(cache, source.archive);
      let data = await fs.readFile(file).catch(() => undefined);
      if (!data || sha256(data) !== source.sha256) {
        data = await downloadMediaSource(source);
        await fs.writeFile(file, data);
      }
      await fs.copyFile(file, path.join(stage, 'sources', source.archive));
      const sourceDirectory = path.join(work, source.name);
      await fs.mkdir(sourceDirectory);
      const tar = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
      await run(tar, ['-xf', file, '-C', sourceDirectory, '--strip-components=1']);
      const notices = (await fs.readdir(sourceDirectory)).filter(name => /^(?:COPYING|LICENSE|LICENCE|COPYRIGHT)(?:[._-].*)?$/i.test(name));
      for (const name of notices) await fs.copyFile(path.join(sourceDirectory, name), path.join(stage, 'licenses', `${source.name}-${name}`));
    }
    await fs.writeFile(path.join(work, 'build.sh'), recipe);
    await fs.writeFile(path.join(stage, 'sources/build-media-tools.sh'), recipe);
    await fs.copyFile(path.join(here, 'media-sources.json'), path.join(stage, 'sources/media-sources.json'));
    // On Windows run from an MSYS2 MinGW64 shell; CI configures it for maintainers.
    try {
      await run('bash', ['build.sh'], {cwd: work});
    } catch (error) {
      // Configure's diagnostic files would otherwise disappear with the workdir.
      const logs = [];
      for (const file of ['pkgconf/config.log', 'zlib/configure.log', 'x264/config.log', 'ffmpeg/ffbuild/config.log']) {
        const content = await fs.readFile(path.join(work, file), 'utf8').catch(() => '');
        if (content) logs.push(`${file}\n${content}`);
      }
      if (!logs.length) throw error;
      const log = path.join(root, '.data/desktop-build-cache/media-build-error.log');
      await fs.writeFile(log, logs.join('\n\n'));
      throw Error(`${error.message}\nCompiler diagnostics saved to ${log}`);
    }
    const binaries = {};
    for (const tool of ['ffmpeg','ffprobe']) {
      const name = `${tool}${process.platform === 'win32' ? '.exe' : ''}`;
      await fs.copyFile(path.join(work, 'install/bin', name), path.join(stage, name));
      if (process.platform !== 'win32') await fs.chmod(path.join(stage, name), 0o755);
      binaries[name] = sha256(await fs.readFile(path.join(stage, name)));
    }
    await fs.writeFile(path.join(stage, 'manifest.json'), JSON.stringify({recipeId, target, sources, binaries}, null, 2));
    await fs.writeFile(path.join(stage, 'SOURCE.txt'), `Frok bundles FFmpeg ${sources[0].version} with x264 and zlib. GPL-3.0-or-later; see licenses/.\nComplete unmodified component source archives, their pinned SHA-256 checksums, and the build recipe are in sources/. pkgconf is a build tool only.\nTo rebuild: unpack each archive into a sibling folder named ffmpeg, x264, zlib, or pkgconf; run bash build-media-tools.sh from their parent. Use a C toolchain, make, tar and bash (MSYS2 MinGW64 on Windows; nasm recommended on x64). Binaries are written to install/bin.\nThis software is based in part on the work of the Independent JPEG Group. FFmpeg's IJG-derived files are unmodified.\n`);
    await checkMediaTools(stage);
    await fs.mkdir(path.dirname(destination), {recursive: true});
    await fs.rm(destination, {recursive: true, force: true});
    await fs.rename(stage, destination);
    console.log(`Bundled video tools ready: ${target}`);
    return destination;
  } finally { await fs.rm(work, {recursive: true, force: true}); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await ensureMediaTools();
}
