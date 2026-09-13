import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sources = JSON.parse(await fs.readFile(path.join(here, 'media-sources.json'), 'utf8'));
const digest = data => createHash('sha256').update(data).digest('hex');
const recipe = await fs.readFile(path.join(here, 'build-media-tools.sh'));
const recipeId = digest(Buffer.concat([Buffer.from(JSON.stringify(sources)), recipe]));
export const bundledMediaPath = (root = path.resolve('.desktop/backend')) => path.join(root, '.media-tools', `${process.platform}-${process.arch}`);

// Runs only our checksum-verified build, never arbitrary dependency executables.
export async function checkMediaTools(directory = bundledMediaPath(), execute = promisify(execFile)) {
  const manifest = JSON.parse(await fs.readFile(path.join(directory, 'manifest.json'), 'utf8'));
  if (manifest.recipeId !== recipeId || manifest.target !== `${process.platform}-${process.arch}` || JSON.stringify(manifest.sources) !== JSON.stringify(sources)) throw Error('Bundled media tools need rebuilding for this source revision and platform.');
  for (const source of sources) {
    if (digest(await fs.readFile(path.join(directory, 'sources', source.archive))) !== source.sha256) throw Error(`Bundled ${source.name} source checksum mismatch.`);
  }
  if (digest(await fs.readFile(path.join(directory, 'sources/build-media-tools.sh'))) !== digest(recipe)) throw Error('Bundled media build recipe mismatch.');
  await fs.access(path.join(directory, 'SOURCE.txt'));
  for (const notice of ['ffmpeg-COPYING.GPLv3','ffmpeg-LICENSE.md','x264-COPYING','zlib-LICENSE','pkgconf-COPYING']) await fs.access(path.join(directory, 'licenses', notice));
  const options = {encoding: 'utf8', timeout: 15_000, maxBuffer: 4 * 1024 * 1024};
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const name = `${tool}${process.platform === 'win32' ? '.exe' : ''}`;
    const binary = path.join(directory, name);
    if (digest(await fs.readFile(binary)) !== manifest.binaries[name]) throw Error(`Bundled ${tool} checksum mismatch.`);
    const {stdout, stderr} = await execute(binary, ['-version'], options);
    const output = stdout + stderr;
    if (!output.includes(`${tool} version ${sources[0].version}`) || /--enable-nonfree|nonfree and unredistributable/i.test(output) || !output.includes('--enable-gpl')) throw Error(`Bundled ${tool} has an unexpected version or license configuration.`);
    if (process.platform === 'darwin') {
      const links = await execute('/usr/bin/otool', ['-L', binary], options);
      if (links.stdout.split('\n').slice(1).some(line => line.trim() && !/^\s*\/(?:usr\/lib|System\/Library)\//.test(line))) throw Error(`Bundled ${tool} depends on a non-system library.`);
    }
  }
  const encoders = await execute(path.join(directory, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'), ['-hide_banner', '-encoders'], options);
  if (!/\blibx264\b/.test(encoders.stdout) || !/\baac\s/.test(encoders.stdout)) throw Error('Bundled FFmpeg is missing H.264/AAC encoders.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await checkMediaTools(process.argv[2]); console.log('Bundled FFmpeg/FFprobe, source checksums, licenses, and codecs verified.'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
