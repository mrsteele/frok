import { app, BrowserWindow, Menu, Tray, nativeImage, dialog, ipcMain, shell, session, protocol, powerSaveBlocker, safeStorage } from 'electron';
import { fork } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { ensureWorkspace, workspacePaths } from './workspace.mjs';
import { isAppUrl, externalUrl, updatesConfigured } from './policy.mjs';
import { createDocumentation } from './docs-window.mjs';
import { createCredentialStore } from './credentials.mjs';
import { product } from './product.mjs';

protocol.registerSchemesAsPrivileged([{ scheme:'frok-docs', privileges:{ standard:true, secure:true, supportFetchAPI:true, corsEnabled:true, stream:true } }]);

const here = path.dirname(fileURLToPath(import.meta.url));
const development = !app.isPackaged;
const project = path.resolve(here, '..');
const home = process.env.FROK_HOME || (development ? path.join(project, '.data/desktop-dev') : path.join(os.homedir(), 'frok'));
const pipelineHome=process.env.FROK_HOME||path.join(os.homedir(),'frok');
const locations = workspacePaths(home);
app.setName('Frok');
app.setPath('userData', locations.profile);
if (!app.requestSingleInstanceLock()) { app.quit(); }
else { void boot(); }

let window, tray, supervisor, workspace, origin, activeSession, blocker, documentation;
let quitting = false, quitPrompt = false, quitWhenFinished = false, loaded = false;
let queue = { running: false, queued: 0, draining: false }, savedWindow = {};
const drainWaiters = new Set();
const token = randomBytes(32).toString('hex');
function open(route = '/') { if (!window || window.isDestroyed()) createWindow(); if (loaded && route !== '/') void window.loadURL(origin + route); window.show(); window.focus(); }
function send(type) { if (supervisor?.connected) supervisor.send({ type }); }
function updateQueue(message) {
  queue = message;
  if (queue.running && blocker === undefined) blocker = powerSaveBlocker.start('prevent-app-suspension');
  if (!queue.running && blocker !== undefined) { powerSaveBlocker.stop(blocker); blocker = undefined; }
  tray?.setToolTip(queue.running ? `Frok · Rendering · ${queue.queued} queued` : `Frok · ${queue.queued ? `${queue.queued} queued` : 'Ready'}`);
  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Frok', click: () => open() },
    { label: queue.running ? 'Rendering…' : 'Ready', enabled: false },
    { label: `${queue.queued} queued`, enabled: false },
    { label: 'View Queue', click: () => open('/queue') },
    { type: 'separator' },
    { label: quitWhenFinished ? 'Keep Running After This Job' : 'Quit Frok', click: () => { if (quitWhenFinished) { quitWhenFinished = false; send('resume'); updateQueue(queue); } else void requestQuit(); } },
  ]));
  if (message.draining) for (const resolve of drainWaiters) resolve(message);
  if (quitWhenFinished && !message.running) void shutdown();
}
async function drain() {
  return new Promise((resolve, reject) => {
    const done = value => { clearTimeout(timeout); drainWaiters.delete(done); resolve(value); };
    const timeout = setTimeout(() => { drainWaiters.delete(done); reject(Error('The queue worker is not responding. Check the logs before quitting.')); }, 5000);
    drainWaiters.add(done); send('drain');
  });
}
async function requestQuit() {
  if (quitPrompt || quitting) return;
  if (!loaded) return shutdown();
  quitPrompt = true;
  try {
    const state = await drain();
    if (!state.running) return shutdown();
    const { response } = await dialog.showMessageBox(window, { type: 'question', title: 'A render is in progress', message: 'How would you like to quit Frok?', detail: 'Queued jobs stay saved for your next launch. Closing the window keeps rendering in the menu bar.', buttons: ['Keep Running', 'Finish This Job, Then Quit', 'Stop Rendering and Quit'], defaultId: 0, cancelId: 0 });
    if (response === 0) send('resume');
    else if (response === 1) { quitWhenFinished = true; updateQueue(queue); }
    else void shutdown();
  } catch (error) { send('resume'); dialog.showErrorBox('Could not stop Frok safely', error.message); }
  finally { quitPrompt = false; }
}
async function shutdown() {
  if (quitting) return;
  quitting = true;
  if (supervisor && supervisor.exitCode === null && !supervisor.signalCode) {
    send('stop');
    await Promise.race([new Promise(resolve => supervisor.once('exit', resolve)), new Promise(resolve => setTimeout(resolve, 15_000))]);
    if (supervisor.exitCode === null && !supervisor.signalCode) supervisor.kill('SIGTERM');
  }
  if (blocker !== undefined) powerSaveBlocker.stop(blocker);
  tray?.destroy(); app.quit();
}
function createWindow() {
  window = new BrowserWindow({ width: savedWindow.width || 1280, height: savedWindow.height || 900, minWidth: 420, minHeight: 480, show: false, backgroundColor: '#080808', title: 'Frok', icon: path.join(here, 'icon.png'), webPreferences: { session: activeSession, preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false } });
  window.once('ready-to-show', () => window.show());
  window.on('close', event => {
    if (!quitting) { event.preventDefault(); window.hide(); }
    const { width, height } = window.getNormalBounds();
    void fs.writeFile(path.join(workspace.home, 'window.json'), JSON.stringify({ width, height }), { mode: 0o600 }).catch(() => {});
  });
  window.webContents.on('will-navigate', (event, url) => { if (!isAppUrl(url, origin)) { event.preventDefault(); const external = externalUrl(url); if (external) void shell.openExternal(external); } });
  window.webContents.setWindowOpenHandler(({ url }) => { const external = externalUrl(url); if (external) void shell.openExternal(external); return { action: 'deny' }; });
  if (loaded) void window.loadURL(origin); else void window.loadFile(path.join(here, 'starting.html'));
}
async function activePipelineFolder() {
  if(!loaded)return workspace.pipelines;
  const response=await fetch(`${origin}/api/pipelines/library`,{headers:{'x-frok-desktop-token':token},redirect:'error',signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw Error('The pipeline location could not be read.');
  const folder=(await response.json()).path;
  if(typeof folder!=='string'||!path.isAbsolute(folder)||!(await fs.stat(folder)).isDirectory())throw Error('The selected pipeline folder is unavailable.');
  return folder;
}
async function openPipelineFolder(){const error=await shell.openPath(await activePipelineFolder());if(error)throw Error(error);}
function menus() {
  const help = page => void documentation.open(page).catch(error => dialog.showErrorBox('Documentation unavailable', error.message));
  const application = [
    { label: 'About Frok', click: () => app.showAboutPanel() },
    { label: 'Check for Updates… (Not Configured)', enabled: updatesConfigured },
    { type: 'separator' },
    { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: () => open('/settings') },
    { label: 'Open Pipelines Folder', click: () => void openPipelineFolder().catch(error=>dialog.showErrorBox('Pipeline folder unavailable',error.message)) },
    { type: 'separator' },
    ...(process.platform === 'darwin' ? [{ role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }] : []),
    { label: 'Quit Frok', accelerator: 'CmdOrCtrl+Q', click: () => void requestQuit() },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Frok', submenu: application },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'togglefullscreen' }, ...(development ? [{ role: 'toggleDevTools' }] : []), { type: 'separator' }, { label: 'Queue', click: () => open('/queue') }] },
    { role: 'windowMenu' },
    { label: 'Help', submenu: [{ label:'Documentation', accelerator:'F1', click:() => help('/documentation') }, { label:'Quick Setup', click:() => help('/guide/getting-started') }, { label:'Pipeline Guide', click:() => help('/pipelines') }, { type:'separator' }, { label: 'About This Studio', click: () => open('/about') }, { label: 'Open Logs Folder', click: () => void shell.openPath(workspace.logs) }, { label: 'Open Pipeline Updates Folder', click: () => void shell.openPath(workspace.updates) }] },
  ]));
}
async function boot() {
  try {
    // Runtime initialization is idempotent; installers never write into another user's home.
    const templates = development ? path.join(project, 'resources/pipelines') : path.join(process.resourcesPath, 'pipeline-templates');
    const groups = JSON.parse(await fs.readFile(path.join(here, 'pipelines.json'), 'utf8'));
    workspace = await ensureWorkspace({ home, pipelineHome, templates, groups, version: app.getVersion() });
    await app.whenReady();
    app.setAboutPanelOptions({ applicationName: 'Frok', applicationVersion: app.getVersion(), copyright: 'Local image and video generation', iconPath: path.join(here, 'icon.png') });
    try { const size = JSON.parse(await fs.readFile(path.join(workspace.home, 'window.json'), 'utf8')); if (Number.isFinite(size.width) && Number.isFinite(size.height)) savedWindow = { width: Math.max(420, Math.min(size.width, 2560)), height: Math.max(480, Math.min(size.height, 1600)) }; } catch {}
    const config = await fs.readFile(workspace.envFile, 'utf8').then(parseEnv).catch(error => { if (error.code === 'ENOENT') return {}; throw error; });
    const credentials = createCredentialStore({ directory: workspace.home, safeStorage, environment: { ...process.env, ...config } });
    documentation = createDocumentation({ root:development ? path.join(project, '.desktop/docs') : path.join(process.resourcesPath, 'docs'), preload:path.join(here, 'docs-preload.cjs'), onlineBase:product.websiteUrl });
    const port = Number(process.env.FROK_DESKTOP_PORT || config.FROK_DESKTOP_PORT || (development ? 3441 : 3440));
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('FROK_DESKTOP_PORT must be between 1024 and 65535.');
    origin = `http://127.0.0.1:${port}`;
    activeSession = session.fromPartition('persist:frok');
    activeSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    activeSession.setPermissionCheckHandler(() => false);
    activeSession.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders };
      for (const name of Object.keys(headers)) if (name.toLowerCase() === 'x-frok-desktop-token') delete headers[name];
      if (isAppUrl(details.url, origin)) headers['x-frok-desktop-token'] = token;
      callback({ requestHeaders: headers });
    });
    activeSession.on('will-download', (_event, item) => item.setSaveDialogOptions({ title: item.getFilename().endsWith('.tar.gz') ? 'Save Frok backup' : 'Save Frok media', defaultPath: path.join(app.getPath('downloads'), path.basename(item.getFilename())) }));
    const trusted = event => { if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || !isAppUrl(event.senderFrame.url, origin)) throw Error('Untrusted desktop request.'); };
    ipcMain.handle('frok:credentials-status', event => { trusted(event); return credentials.status(); });
    ipcMain.handle('frok:credentials-save', (event, key, value) => { trusted(event); return credentials.save(key, value); });
    ipcMain.handle('frok:open-pipelines',async event=>{trusted(event);await openPipelineFolder();});
    ipcMain.handle('frok:open-docs', async (event, page) => { trusted(event); await documentation.open(page); });
    ipcMain.handle('frok:info', async event => { trusted(event); return { version: app.getVersion(), workspace: workspace.home, pipelines: await activePipelineFolder().catch(()=>workspace.pipelines), development, updatesConfigured }; });
    for (const [channel, folder] of [['frok:open-logs', workspace.logs], ['frok:open-pipeline-updates', workspace.updates]]) ipcMain.handle(channel, async event => { trusted(event); const error = await shell.openPath(folder); if (error) throw Error(error); });
    const trayIcon = nativeImage.createFromPath(path.join(here, process.platform === 'darwin' ? 'trayTemplate.png' : 'tray.png'));
    if (process.platform === 'darwin') trayIcon.setTemplateImage(true);
    tray = new Tray(trayIcon); tray.on('double-click', () => open());
    menus(); updateQueue(queue); createWindow();
    const backend = development ? project : path.join(process.resourcesPath, 'backend');
    const node = development ? process.env.FROK_NODE_BINARY : path.join(process.resourcesPath, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
    if (!node) throw Error('Start desktop development with npm run dev:desktop.');
    const env = { ...process.env, ...config, ...credentials.environment(), FROK_DESKTOP_DEV: development ? '1' : '0', FROK_APP_ROOT: backend, FROK_ENV_FILE: workspace.envFile, FROK_DATA_DIR: workspace.data, FROK_PIPELINE_HOME: pipelineHome, FROK_LOG_DIR: workspace.logs, FROK_DESKTOP_TOKEN: token, FROK_DOCUMENTS_DIR: app.getPath('documents'), FROK_ORIGIN: origin, PORT: String(port), HOSTNAME: '127.0.0.1', NODE_ENV: development ? 'development' : 'production', FROK_BUILD_DIR: development ? '.data/desktop-next' : '.next' };
    delete env.ELECTRON_RUN_AS_NODE;
    supervisor = fork(development ? path.join(here, 'supervisor.mjs') : path.join(backend, 'supervisor.mjs'), [], { execPath: node, execArgv: [], cwd: backend, env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    supervisor.on('error', error => { dialog.showErrorBox('Frok could not start', error.message); void shutdown(); });
    supervisor.on('message', message => {
      if (message?.type === 'queue-state') updateQueue(message);
      if (message?.type === 'ready') { loaded = true; void window.loadURL(origin); }
      if (message?.type === 'fatal') { dialog.showErrorBox('Frok needs attention', message.message); void shutdown(); }
    });
    supervisor.on('exit', () => { if (!quitting) { dialog.showErrorBox('Frok stopped', `The local service stopped unexpectedly. Logs are in ${workspace.logs}.`); void shutdown(); } });
    if (workspace.conflicts.length) void dialog.showMessageBox(window, { type: 'info', message: 'Your edited pipelines were kept', detail: 'New bundled versions are available in the pipeline-updates folder. You can review them from Help → Open Pipeline Updates Folder.' });
  } catch (error) { await app.whenReady(); dialog.showErrorBox('Could not open Frok', error.message); void shutdown(); }
}
app.on('second-instance', () => { if (workspace && activeSession) open(); });
app.on('activate', () => { if (workspace && activeSession) open(); });
app.on('before-quit', event => { if (!quitting) { event.preventDefault(); void requestQuit(); } });
app.on('window-all-closed', () => {});
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
