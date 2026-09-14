import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { brandAssets } from './brand-assets.mjs';
import fs from 'node:fs/promises';
import { traySvg, trayVariants } from '../desktop/tray-status.mjs';
export async function desktopIcons() {
  const { icon, monochrome } = await brandAssets();
  await sharp(Buffer.from(icon)).resize(1024, 1024).png().toFile(fileURLToPath(new URL('../desktop/icon.png', import.meta.url)));
  // Dock icons need breathing room inside their canvas. Keep the tile at 824px
  // within 1024px so it matches the visible size of neighboring macOS icons.
  await sharp(Buffer.from(icon)).resize(824, 824)
    .extend({ top: 100, bottom: 100, left: 100, right: 100, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png().toFile(fileURLToPath(new URL('../desktop/icon-mac.png', import.meta.url)));
  const directory = new URL('../desktop/tray/', import.meta.url);
  await fs.mkdir(directory, { recursive: true });
  // 16-point template images, with Retina detail at the same displayed size.
  for (const variant of trayVariants) for (const scale of [1, 2]) {
    const svg = traySvg(monochrome, variant);
    await sharp(Buffer.from(svg), { density: 72 * scale }).png().withMetadata({ density: 72 * scale })
      .toFile(fileURLToPath(new URL(`${variant}Template${scale === 2 ? '@2x' : ''}.png`, directory)));
  }
}
