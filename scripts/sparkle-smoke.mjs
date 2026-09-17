// A real, disposable macOS app upgrade. No Frok server, library or AI runner starts.
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { trackSmokeChild, waitForSmokeProcess, removeSmokeDirectory } from './smoke-cleanup.mjs';
import { publicUpdateKey } from './update-key.mjs';

if (process.platform !== 'darwin') throw Error('The Sparkle smoke test requires macOS.');
// Electron downloads its development runtime lazily. Packaging uses a separate
// cache and does not guarantee that node_modules/electron/dist exists on CI.
process.env.electron_config_cache ||= path.resolve('.data/electron-cache');
const electron = createRequire(import.meta.url)('electron');
const electronApp = path.resolve(electron, '../../..');
await fs.mkdir('.data', { recursive: true });
const root = await fs.mkdtemp(path.resolve('.data/sparkle-smoke-'));
const { privateKey } = generateKeyPairSync('ed25519');
const seed = Buffer.from(privateKey.export({ format: 'jwk' }).d, 'base64url').toString('base64');
const publicEdKey = publicUpdateKey(seed);
const server = http.createServer(async (request, response) => {
  const name = request.url === '/appcast.xml' ? 'appcast.xml' : request.url === '/update.zip' ? 'update.zip' : undefined;
  if (!name) { response.writeHead(404).end(); return; }
  try { const data = await fs.readFile(path.join(root, 'archives', name)); response.writeHead(200, { 'Content-Length': data.length }); response.end(data); }
  catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const appcastUrl = `http://127.0.0.1:${server.address().port}/appcast.xml`;
let child, stopChild, passed;
try {
  const app = path.join(root, 'Frok Update Test.app'), resources = path.join(app, 'Contents/Resources');
  await fs.cp(electronApp, app, { recursive: true, verbatimSymlinks: true });
  await fs.cp('node_modules/electron-sparkle-updater/native/vendor/Sparkle.framework', path.join(app, 'Contents/Frameworks/Sparkle.framework'), { recursive: true, verbatimSymlinks: true });
  const addon = path.join(resources, 'app.asar.unpacked/node_modules/electron-sparkle-updater/native/build/Release/sparkle_bridge.node');
  await fs.mkdir(path.dirname(addon), { recursive: true });
  await fs.copyFile('node_modules/electron-sparkle-updater/native/build/Release/sparkle_bridge.node', addon);
  const code = path.join(resources, 'app'); await fs.mkdir(code);
  await build({ entryPoints: ['desktop/update-provider.cjs'], outfile: path.join(code, 'provider.cjs'), bundle: true, platform: 'node', format: 'cjs', external: ['electron'] });
  await fs.copyFile('desktop/updates.mjs', path.join(code, 'updates.mjs'));
  await fs.writeFile(path.join(code, 'main.cjs'), `
const {app,BrowserWindow}=require('electron'),fs=require('node:fs'),path=require('node:path');
const root=${JSON.stringify(root)};
fs.writeFileSync(path.join(root,'app-pid'),String(process.pid));
app.setPath('userData',path.join(root,'profile'));app.setPath('logs',path.join(root,'logs'));
app.whenReady().then(async()=>{
  if(app.getVersion()==='0.0.2'){
    if(!fs.existsSync(path.join(root,'drained')))throw Error('Installed without draining');
    fs.writeFileSync(path.join(root,'success'),'Real Sparkle upgrade completed');app.quit();return;
  }
  new BrowserWindow({show:false});
  const updater=require('./provider.cjs')({metadata:require('./package.json')});
  const {createUpdates}=await import('./updates.mjs');let installing=false;
  const updates=createUpdates({updater,beforeInstall:async()=>{await new Promise(r=>setTimeout(r,250));fs.writeFileSync(path.join(root,'drained'),'yes');},changed:state=>{
    if(state.status==='error'){fs.writeFileSync(path.join(root,'failure'),state.message);app.quit();}
    if(state.status==='ready'&&!installing){installing=true;void updates.install();}
  },log:{error:error=>fs.writeFileSync(path.join(root,'failure'),String(error))}});
  updates.start();
}).catch(error=>{fs.writeFileSync(path.join(root,'failure'),String(error));app.quit();});
`);
  const plist = path.join(app, 'Contents/Info.plist');
  function set(key, type, value) {
    try { execFileSync('/usr/libexec/PlistBuddy', ['-c', `Delete :${key}`, plist], { stdio: 'ignore' }); } catch {}
    execFileSync('/usr/libexec/PlistBuddy', ['-c', `Add :${key} ${type} ${value}`, plist]);
  }
  set('CFBundleIdentifier', 'string', `dev.frok.update-test.${path.basename(root)}`);
  set('CFBundleName', 'string', 'Frok Update Test');
  for (const [key, value] of Object.entries({ SUFeedURL: appcastUrl, SUPublicEDKey: publicEdKey })) set(key, 'string', value);
  for (const key of ['SUEnableAutomaticChecks', 'SUAutomaticallyUpdate', 'SUEnableInstallerLauncherService']) set(key, 'bool', 'false');
  set('SUVerifyUpdateBeforeExtraction', 'bool', 'true');
  set('NSAppTransportSecurity', 'dict', ''); set('NSAppTransportSecurity:NSAllowsLocalNetworking', 'bool', 'true');
  const version = async value => {
    set('CFBundleVersion', 'string', value); set('CFBundleShortVersionString', 'string', value);
    await fs.writeFile(path.join(code, 'package.json'), JSON.stringify({ name: 'frok-update-test', version: value, main: 'main.cjs', frokSparkle: { appcastUrl, publicEdKey } }));
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', app], { stdio: 'pipe' });
    execFileSync('codesign', ['--verify', '--deep', '--strict', app]);
  };
  await version('0.0.2');
  const archives = path.join(root, 'archives'); await fs.mkdir(archives);
  execFileSync('ditto', ['-c', '-k', '--keepParent', app, path.join(archives, 'update.zip')]);
  execFileSync('node_modules/electron-sparkle-updater/native/vendor/bin/generate_appcast', ['--ed-key-file', '-', '--download-url-prefix', appcastUrl.replace('appcast.xml', ''), archives], { input: seed + '\n', stdio: ['pipe', 'pipe', 'pipe'] });
  if(process.argv.includes('--tamper'))await fs.appendFile(path.join(archives,'update.zip'),'tampered');
  await version('0.0.1');
  child = spawn(path.join(app, 'Contents/MacOS/Electron'), [], { stdio: ['ignore', 'pipe', 'pipe'] });
  stopChild = trackSmokeChild(child);
  let logs = ''; child.stdout.on('data', data => logs = (logs + data).slice(-12000)); child.stderr.on('data', data => logs = (logs + data).slice(-12000));
  for (let tick = 0; tick < 180; tick++) {
    if (await fs.stat(path.join(root, 'success')).catch(() => undefined)) { if(process.argv.includes('--tamper'))throw Error('Tampered update was accepted'); passed = 'Sparkle smoke passed: signed download, queue-safe install, replacement and relaunch.'; break; }
    const failure = await fs.readFile(path.join(root, 'failure'), 'utf8').catch(() => '');
    if(failure&&process.argv.includes('--tamper')){
      if(await fs.stat(path.join(root,'drained')).catch(()=>undefined))throw Error('Tampered update reached installation');
      passed = 'Sparkle smoke passed: tampered archive rejected before installation.';break;
    }
    if (failure || tick === 179) throw Error(`${failure || 'Sparkle upgrade timed out'}\n${logs}`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
} finally {
  try {
    await stopChild?.();
    const pid = await fs.readFile(path.join(root, 'app-pid'), 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
    if (pid && Number(pid) !== child?.pid) await waitForSmokeProcess(Number(pid));
    await removeSmokeDirectory(root);
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
}

console.log(passed);
