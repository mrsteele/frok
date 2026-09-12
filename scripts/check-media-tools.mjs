import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Guard against stale output or dependencies bundling standalone media tools.
export async function checkMediaTools(directory = path.resolve('.desktop/backend')) {
  async function visit(folder) {
    for (const entry of await fs.readdir(folder, {withFileTypes: true})) {
      if (/^(?:@ffmpeg-installer|@ffprobe-installer|ffmpeg-static|ffprobe-static|ffmpeg(?:\.exe)?|ffprobe(?:\.exe)?)$/i.test(entry.name))
        throw Error(`External media tool found in desktop payload: ${path.relative(directory, path.join(folder, entry.name))}. Rebuild Frok without bundled FFmpeg/FFprobe commands.`);
      if (entry.isDirectory()) await visit(path.join(folder, entry.name));
    }
  }
  await visit(directory);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { await checkMediaTools(process.argv[2]); console.log('Desktop backend contains no bundled FFmpeg/FFprobe commands.'); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
