import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { build } from 'esbuild';
import { desktopIcons } from './desktop-icons.mjs';
import { desktopNode } from './desktop-node.mjs';
import { buildDesktopDocs } from './desktop-docs.mjs';
import { desktopNotices } from './desktop-notices.mjs';
await buildDesktopDocs();

const root = process.cwd(), output = path.join(root, '.desktop');
const pkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
const generated = ['next-env.d.ts', 'tsconfig.json'];
const previous = await Promise.all(generated.map(file => fs.readFile(file)));
function command(args, env) { return new Promise((resolve, reject) => { const child = spawn(process.execPath, args, { stdio: 'inherit', env }); child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error(`Build exited with ${code}`))); }); }
await fs.mkdir(output, { recursive: true });
const buildData=await fs.mkdtemp(path.join(output,'build-data-'));
try {
  await command(['node_modules/next/dist/bin/next', 'build'], { ...process.env, FROK_DATA_DIR:buildData,FROK_ENV_FILE:path.join(buildData,'absent.env'), FROK_DESKTOP_BUILD: '1', FROK_BUILD_DIR: '.next-desktop', NEXT_TELEMETRY_DISABLED: '1' });
} finally { for (let i = 0; i < generated.length; i++) await fs.writeFile(generated[i], previous[i]);await fs.rm(buildData,{recursive:true,force:true}); }
for (const dir of ['app', 'backend', 'pipeline-templates']) await fs.rm(path.join(output, dir), { recursive: true, force: true });
await fs.mkdir(path.join(output, 'app'), { recursive: true });
await desktopIcons();
const desktopFiles = ['main.mjs', 'credentials.mjs', 'product.mjs', 'workspace.mjs', 'policy.mjs', 'preload.cjs', 'docs-content.mjs', 'docs-window.mjs', 'docs-preload.cjs', 'starting.html', 'pipelines.json', 'icon.png', 'tray.png', 'trayTemplate.png', 'trayTemplate@2x.png'];
for (const name of desktopFiles) await fs.copyFile(path.join('desktop', name), path.join(output, 'app', name));
await fs.writeFile(path.join(output, 'app/package.json'), JSON.stringify({ name: 'frok', productName: 'Frok', version: pkg.version, description: pkg.description, author: pkg.author, license: pkg.license, type: 'module', main: 'main.mjs' }, null, 2));
const backend = path.join(output, 'backend');
await fs.cp('.next-desktop/standalone', backend, { recursive: true, filter: file => {
  const relative = path.relative(path.resolve('.next-desktop/standalone'), path.resolve(file));
  return !relative.split(path.sep).some(part => part.startsWith('.env') || ['.data', '.desktop', 'pipelines'].includes(part)) && !/\.(sqlite(?:-.*)?|safetensors|gguf)$/.test(file);
} });
await fs.cp('.next-desktop/static', path.join(backend, '.next-desktop/static'), { recursive: true });
await fs.cp('public', path.join(backend, 'public'), { recursive: true });
for (const file of ['supervisor.mjs', 'launch-settings.mjs', 'preferences.mjs']) await fs.copyFile(path.join('desktop', file), path.join(backend, file));
await build({ entryPoints: ['src/worker/index.ts'], outfile: path.join(backend, 'worker.mjs'), bundle: true, platform: 'node', target: 'node24', format: 'esm', external: ['sharp'], banner: { js: "import { createRequire as frokCreateRequire } from 'node:module'; const require = frokCreateRequire(import.meta.url);" } });
const groups = JSON.parse(await fs.readFile('desktop/pipelines.json', 'utf8'));
for (const file of groups.flat()) {
  const target = path.join(output, 'pipeline-templates', file); await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.copyFile(path.join(root, 'resources/pipelines', file), target);
}
await fs.copyFile('resources/pipelines/VPIPE-LICENSE', path.join(output, 'pipeline-templates/VPIPE-LICENSE'));
await fs.cp(path.join(output,'pipeline-templates'),path.join(backend,'resources/pipelines'),{recursive:true});
await fs.mkdir(path.join(backend,'desktop'),{recursive:true});
for(const file of ['workspace.mjs','pipelines.json'])await fs.copyFile(path.join('desktop',file),path.join(backend,'desktop',file));
await fs.copyFile('package.json',path.join(backend,'frok-package.json'));
await desktopNotices(root, path.join(output, 'licenses'));
await desktopNode(path.join(output, 'runtime'));
console.log('Desktop payload ready. Run npm run package:dir for an unpacked app, or npm run package for an installer.');
