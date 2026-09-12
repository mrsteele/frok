import { runtimeOptions } from './preferences';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

export const imagePreviewDir = (directory: string) => path.join(directory, 'live-preview');
export const imagePreviewPath = (directory: string) => path.join(imagePreviewDir(directory), 'frame.jpg');
export const liveImagePreviewsEnabled = () => runtimeOptions().liveImagePreviews;

// Only keep one small decoded frame in memory. Vpipe names subsequent images
// frame-000001.jpg, frame-000002.jpg, etc.; these are not necessarily step numbers
// because the intermediate stream may drop frames when a consumer falls behind.
let cached: { key: string; etag: string; data: Buffer } | undefined;
export async function readImagePreview(directory: string) {
  const folder = imagePreviewDir(directory);
  const files = await fs.readdir(folder, { withFileTypes: true }).catch(() => []);
  const candidates = files.filter(file => file.isFile() && /^frame(?:-\d{6})?\.jpg$/.test(file.name))
    .map(file => ({ name: file.name, index: file.name === 'frame.jpg' ? 0 : Number(file.name.slice(6, 12)) }))
    .sort((a, b) => b.index - a.index).slice(0, 8);
  for (const file of candidates) {
    try {
      const filename = path.join(folder, file.name), stat = await fs.stat(filename);
      if (!stat.size || stat.size > 12 * 1024 * 1024) continue;
      const key = `${filename}:${stat.size}:${stat.mtimeMs}`;
      if (cached?.key === key) return cached;
      const input = await fs.readFile(filename);
      // Vpipe writes JPEGs directly. Do not display a file until its final marker
      // and a full decode succeed; retain the previous complete preview instead.
      if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8 || input.at(-2) !== 0xff || input.at(-1) !== 0xd9) continue;
      const data = await sharp(input, { limitInputPixels: 16_000_000, failOn: 'warning' })
        .resize(640, 640, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 75 }).toBuffer();
      const etag = `"${createHash('sha256').update(data).digest('hex')}"`;
      cached = { key, etag, data }; return cached;
    } catch { /* A frame may still be writing, or the job just cleaned it up. */ }
  }
  return undefined;
}
export async function clearImagePreviews(directory: string) {
  const folder = imagePreviewDir(directory);
  if (cached?.key.startsWith(folder + path.sep)) cached = undefined;
  await fs.rm(folder, { recursive: true, force: true });
}
