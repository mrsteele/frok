import fs from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = new URL('../', import.meta.url);

// Keep the favicon, documentation and desktop icons tied to the same editable mark.
export async function brandAssets() {
  const mark = await fs.readFile(new URL('public/brand/mark.svg', root), 'utf8');
  const contents = mark.match(/<svg\b[^>]*>([\s\S]*)<\/svg>/)?.[1].trim();
  const green = mark.match(/<svg\b[^>]*fill="(#[a-fA-F0-9]{6})"/)?.[1];
  if (!contents || !green || !mark.includes('viewBox="0 0 64 64"')) throw Error('The Frok mark must use a 64 × 64 viewBox and a root fill color.');
  const light = mark.replace(`fill="${green}"`, 'fill="#92d6a9"');
  const monochrome = mark.replace(`fill="${green}"`, 'fill="#000000"');
  const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">\n  <rect width="64" height="64" rx="16" fill="${green}"/>\n  <g transform="translate(8 7.5) scale(.75)" fill="#ffffff">${contents}</g>\n</svg>\n`;
  const outputs = [['src/app/icon.svg', icon], ['docs/public/icon.svg', icon], ['docs/public/mark.svg', mark], ['docs/public/mark-light.svg', light]];
  for (const [filename, content] of outputs) {
    const file = new URL(filename, root);
    // Avoid unnecessary dev-server reloads when a docs build hasn't changed the mark.
    if (await fs.readFile(file, 'utf8').catch(() => '') !== content) await fs.writeFile(file, content);
  }
  return { icon, monochrome };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await brandAssets();
  console.log(`Frok brand assets refreshed from ${path.relative(process.cwd(), fileURLToPath(new URL('public/brand/mark.svg', root)))}.`);
}
