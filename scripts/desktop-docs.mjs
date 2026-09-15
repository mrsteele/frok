import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { brandAssets } from './brand-assets.mjs';

async function buildDocs(web = false) {
  await brandAssets();
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const docs = path.join(root, 'docs'), cli = path.join(docs, 'node_modules/vitepress/bin/vitepress.js');
  try { await fs.access(cli); } catch { throw Error('Install the documentation build dependencies first: npm --prefix docs ci'); }
  const output = path.join(root, web ? 'public/docs' : '.desktop/docs');
  await fs.rm(output, { recursive:true, force:true });
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'build', '--outDir', output], { cwd:docs, stdio:'inherit', env:{ ...process.env, DOCS_BASE:web ? '/docs/' : '/', DOCS_SITE_URL:'' } });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(Error(`Documentation build exited with ${code}`)));
  });
}
export const buildDesktopDocs = async () => {
  await buildDocs();
  // The welcome screen embeds the same demo through the app's local web server.
  await buildDocs(true);
};
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--web')) await buildDocs(true);
  else await buildDesktopDocs();
}
