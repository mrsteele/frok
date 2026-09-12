import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import { brandAssets } from './brand-assets.mjs';
export async function desktopIcons() {
  const { icon, monochrome } = await brandAssets();
  await sharp(Buffer.from(icon)).resize(1024, 1024).png().toFile(fileURLToPath(new URL('../desktop/icon.png', import.meta.url)));
  await sharp(Buffer.from(monochrome)).resize(32, 32).png().toFile(fileURLToPath(new URL('../desktop/tray.png', import.meta.url)));
  // macOS uses point dimensions: @2x adds Retina detail without enlarging the icon.
  for (const scale of [1, 2]) {
    await sharp(Buffer.from(monochrome)).resize(16 * scale, 16 * scale).withMetadata({ density: 72 * scale }).png()
      .toFile(fileURLToPath(new URL(`../desktop/trayTemplate${scale === 2 ? '@2x' : ''}.png`, import.meta.url)));
  }
}
