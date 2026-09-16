import { app, BrowserWindow, Menu, Tray, nativeImage, dialog, ipcMain, shell, session, protocol, powerSaveBlocker, safeStorage, systemPreferences } from 'electron';
import { fork } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { ensureWorkspace } from './workspace.mjs';
import { migrateDesktopProfile } from './profile.mjs';
import { storagePaths, applicationPaths } from './storage-paths.mjs';
import { migrateApplicationData } from './application-data.mjs';
import { isAppUrl, externalUrl } from './policy.mjs';
import { createDocumentation } from './docs-window.mjs';
import { createCredentialStore } from './credentials.mjs';
import { product } from './product.mjs';
import { createTrayAnimator, trayVariants } from './tray-status.mjs';
import { createUpdates, updateAvailability } from './updates.mjs';
import loadUpdater from './update-provider.cjs';
import { prepareUpdateRestart } from './update-restart.mjs';

protocol.registerSchemesAsPrivileged([{ scheme:'frok-docs', privileges:{ standard:true, secure:true, supportFetchAPI:true, corsEnabled:true, stream:true } }]);

const here = path.dirname(fileURLToPath(import.meta.url));
const desktopIcon = path.join(here, process.platform === 'darwin' ? 'icon-mac.png' : 'icon.png');
const development = !app.isPackaged;
const project = path.resolve(here, '..');
const { home, pipelineHome } = storagePaths(process.env, { root: project });
app.setName('Frok');
const machine = applicationPaths(process.env, { root: project, appData: app.getPath('appData') });
const { profile } = machine;
const pipelineStateDirectory = applicationPaths({ ...process.env, FROK_HOME: pipelineHome }, { root: project, appData: app.getPath('appData') }).state;
migrateDesktopProfile(home, profile);
app.setPath('userData', profile);
app.setPath('sessionData', profile);
if (!app.requestSingleInstanceLock()) { app.quit(); }
else { void boot(); }

let window, tray, trayAnimator, supervisor, workspace, origin, activeSession, blocker, documentation, updates;
let stoppingForUpdate = false;
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
  refreshTray();
  if (message.draining) for (const resolve of drainWaiters) resolve(message);
  if (updates?.state.status === 'waiting' && !message.running) void updates.install();
  else if (quitWhenFinished && !message.running) void shutdown();
}
function updateMenuItem() {
  const state = updates?.state;
  const label = !state || state.status === 'disabled' ? 'Updates unavailable in this build' : state.status === 'checking' ? 'Checking for Updates…' : state.status === 'downloading' ? `Downloading Update… ${state.percent || 0}%` : state.status === 'ready' ? 'Restart to Update…' : state.status === 'waiting' ? 'Cancel Update After This Job' : state.status === 'installing' ? 'Installing Update…' : state.status === 'error' ? 'Retry Update' : 'Check for Updates…';
  return { label, enabled: !!state && !['disabled', 'checking', 'downloading', 'installing'].includes(state.status), click: () => {
    if (state.status === 'ready') void requestUpdate();
    else if (state.status === 'waiting') { updates.cancelDeferred(); send('resume'); }
    else void updates.check();
  } };
}
function refreshTray() {
  if (!tray || tray.isDestroyed()) return;
  const state = updates?.state;
  trayAnimator.set({ running: !!queue.running, updateAvailable: !!state?.version, reducedMotion: systemPreferences.getAnimationSettings().prefersReducedMotion });
  tray.setToolTip(`Frok · ${queue.running ? 'Working' : 'Ready'} · ${queue.queued} queued${state?.version ? ` · Update ${state.version} ${state.status === 'ready' ? 'ready' : 'available'}` : ''}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Frok', click: () => open() },
    { label: queue.running ? 'Working…' : 'Ready', enabled: false },
    { label: `${queue.queued} queued`, enabled: false },
    { label: 'View Queue', click: () => open('/queue') },
    { type: 'separator' },
    updateMenuItem(),
    { type: 'separator' },
    { label: quitWhenFinished ? 'Keep Running After This Job' : 'Quit Frok', click: () => { if (quitWhenFinished) { quitWhenFinished = false; send('resume'); updateQueue(queue); } else void requestQuit(); } },
  ]));
}
async function requestUpdate() {
  if (quitPrompt || quitting || !loaded || updates?.state.status !== 'ready') return;
  quitPrompt = true;
  try {
    const state = await drain();
    if (state.running) {
      const { response } = await dialog.showMessageBox(window, { type: 'question', title: 'Update Frok', message: 'Finish the current job before updating?', detail: 'Frok will restart automatically after this job. The remaining queue and your library stay saved.', buttons: ['Finish This Job and Update', 'Later'], defaultId: 0, cancelId: 1 });
      if (response === 1) { send('resume'); return; }
      quitWhenFinished = false;
      updates.defer();
      if (queue.running) return;
    }
    await updates.install();
  } catch (error) { send('resume'); dialog.showErrorBox('Could not prepare the update', error.message); }
  finally { quitPrompt = false; }
}
async function stopForUpdate() {
  await prepareUpdateRestart({ drain, supervisor, send, stopping: value => { stoppingForUpdate = value; } });
  quitting = true;
  trayAnimator?.dispose(); tray?.destroy();
  if (blocker !== undefined) { powerSaveBlocker.stop(blocker); blocker = undefined; }
}
async function drain() {
  return new Promise((resolve, reject) => {
    const done = value => { clearTimeout(timeout); drainWaiters.delete(done); resolve(value); };
    const timeout = setTimeout(() => { drainWaiters.delete(done); reject(Error('The queue worker is not responding. Check the logs before quitting.')); }, 5000);
    drainWaiters.add(done); send('drain');
  });
}
async function requestQuit() {
  if (quitPrompt || quitting || updates?.state.status === 'installing') return;
  if (updates?.state.status === 'waiting') updates.cancelDeferred();
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
  trayAnimator?.dispose(); updates?.dispose(); tray?.destroy(); app.quit();
}
function createWindow() {
  window = new BrowserWindow({ width: savedWindow.width || 1280, height: savedWindow.height || 900, minWidth: 420, minHeight: 480, show: false, backgroundColor: '#080808', title: 'Frok', icon: desktopIcon, webPreferences: { session: activeSession, preload: path.join(here, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false } });
  window.once('ready-to-show', () => window.show());
  window.on('close', event => {
    if (!quitting) { event.preventDefault(); window.hide(); }
    const { width, height } = window.getNormalBounds();
    void fs.writeFile(path.join(machine.state, 'window.json'), JSON.stringify({ width, height }), { mode: 0o600 }).catch(() => {});
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
async function openPipelineUpdatesFolder() {
  const stat = await fs.stat(workspace.updates).catch(error => { if (error.code !== 'ENOENT') throw error; });
  if (!stat) {
    await dialog.showMessageBox(window, { type: 'info', message: 'No pipeline updates to review', detail: 'This folder appears when a changed bundled pipeline needs your review.' });
    return;
  }
  if (!stat.isDirectory()) throw Error('The pipeline updates path is not a folder.');
  const error = await shell.openPath(workspace.updates);
  if (error) throw Error(error);
}
function menus() {
  const help = page => void documentation.open(page).catch(error => dialog.showErrorBox('Documentation unavailable', error.message));
  const application = [
    { label: 'About Frok', click: () => app.showAboutPanel() },
    updateMenuItem(),
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
    { label: 'Help', submenu: [{ label:'Documentation', accelerator:'F1', click:() => help('/documentation') }, { label:'Quick Setup', click:() => help('/guide/getting-started') }, { label:'Pipeline Guide', click:() => help('/pipelines') }, { type:'separator' }, { label: 'About This Studio', click: () => open('/about') }, { label: 'Open App Logs Folder', click: () => void shell.openPath(machine.logs) }, { label: 'Open Pipeline Updates Folder', click: () => void openPipelineUpdatesFolder().catch(error => dialog.showErrorBox('Pipeline updates unavailable', error.message)) }] },
  ]));
}
async function boot() {
  try {
    // Runtime initialization is idempotent; installers never write into another user's home.
    const templates = development ? path.join(project, 'resources/pipelines') : path.join(process.resourcesPath, 'pipeline-templates');
    const groups = JSON.parse(await fs.readFile(path.join(here, 'pipelines.json'), 'utf8'));
    workspace = await ensureWorkspace({ home, pipelineHome, stateDirectory: pipelineStateDirectory, templates, groups, version: app.getVersion() });
    migrateApplicationData({ home, ...machine });
    await app.whenReady();
    if (development && process.platform === 'darwin') app.dock.setIcon(desktopIcon);
    app.setAboutPanelOptions({ applicationName: 'Frok', applicationVersion: app.getVersion(), copyright: 'Local image and video generation', iconPath: desktopIcon });
    try { const size = JSON.parse(await fs.readFile(path.join(machine.state, 'window.json'), 'utf8')); if (Number.isFinite(size.width) && Number.isFinite(size.height)) savedWindow = { width: Math.max(420, Math.min(size.width, 2560)), height: Math.max(480, Math.min(size.height, 1600)) }; } catch {}
    const config = await fs.readFile(workspace.envFile, 'utf8').then(parseEnv).catch(error => { if (error.code === 'ENOENT') return {}; throw error; });
    const credentials = createCredentialStore({ directory: machine.state, safeStorage, environment: { ...process.env, ...config } });
    documentation = createDocumentation({ root:development ? path.join(project, '.desktop/docs') : path.join(process.resourcesPath, 'docs'), preload:path.join(here, 'docs-preload.cjs'), onlineBase:product.websiteUrl });
    const metadata = development ? {} : JSON.parse(await fs.readFile(path.join(here, 'package.json'), 'utf8'));
    let unavailable = updateAvailability({ packaged: !development, releaseEnabled: metadata.frokUpdates });
    const updateLog = path.join(machine.logs, 'updates.log');
    if ((await fs.stat(updateLog).catch(() => undefined))?.size > 2 * 1024 * 1024) await fs.rename(updateLog, updateLog + '.previous');
    const log = Object.fromEntries(['info', 'warn', 'error', 'debug'].map(level => [level, value => { void fs.appendFile(updateLog, `${new Date().toISOString()} ${level}: ${String(value)}\n`, { mode: 0o600 }).catch(() => {}); }]));
    let updater;
    if (!unavailable) try { updater = loadUpdater({ metadata }); }
    catch (error) { log.error(error); unavailable = 'The updater could not start. Reinstall Frok from its GitHub release. Your library stays in place.'; }
    updates = createUpdates({ updater, unavailable, log, beforeInstall: stopForUpdate, changed: state => {
      refreshTray();
      if (!quitting) menus();
      if (window && !window.isDestroyed()) window.webContents.send('frok:update-state', state);
      if (state.status === 'error' && quitting) {
        dialog.showErrorBox('Update could not be installed', 'Frok will reopen. You can retry the update from Settings. Details are in updates.log.');
        app.relaunch(); app.quit();
      }
    } });
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
    ipcMain.handle('frok:info', async event => { trusted(event); return { version: app.getVersion(), workspace: workspace.home, pipelines: await activePipelineFolder().catch(()=>workspace.pipelines), development, update: updates.state }; });
    ipcMain.handle('frok:check-updates', event => { trusted(event); void updates.check(); return updates.state; });
    ipcMain.handle('frok:install-update', event => { trusted(event); void requestUpdate(); });
    ipcMain.handle('frok:cancel-update-restart', event => { trusted(event); if (updates.state.status === 'waiting') { updates.cancelDeferred(); send('resume'); } });
    ipcMain.handle('frok:open-pipeline-updates', async event => { trusted(event); await openPipelineUpdatesFolder(); });
    ipcMain.handle('frok:open-logs', async event => { trusted(event); const error = await shell.openPath(machine.logs); if (error) throw Error(error); });
    const images = Object.fromEntries(trayVariants.map(variant => {
      const image = nativeImage.createFromPath(path.join(here, 'tray', `${variant}Template${process.platform === 'darwin' ? '' : '@2x'}.png`));
      if (process.platform === 'darwin') image.setTemplateImage(true);
      return [variant, image];
    }));
    tray = new Tray(images.idle); tray.on('double-click', () => open());
    trayAnimator = createTrayAnimator({ tray, images });
    menus(); updateQueue(queue); createWindow();
    const backend = development ? project : path.join(process.resourcesPath, 'backend');
    const node = development ? process.env.FROK_NODE_BINARY : path.join(process.resourcesPath, 'runtime', process.platform === 'win32' ? 'node.exe' : 'node');
    if (!node) throw Error('Start desktop development with npm run dev:desktop.');
    const env = { ...process.env, ...config, ...credentials.environment(), FROK_DESKTOP_DEV: development ? '1' : '0', FROK_APP_ROOT: backend, FROK_ENV_FILE: workspace.envFile, FROK_HOME: home, FROK_DATA_DIR: workspace.data, FROK_PIPELINE_STATE_DIR: pipelineStateDirectory, FROK_PIPELINE_HOME: pipelineHome, FROK_LOG_DIR: machine.logs, FROK_DESKTOP_TOKEN: token, FROK_DOCUMENTS_DIR: app.getPath('documents'), FROK_ORIGIN: origin, PORT: String(port), HOSTNAME: '127.0.0.1', NODE_ENV: development ? 'development' : 'production', FROK_BUILD_DIR: development ? '.data/desktop-next' : '.next' };
    delete env.ELECTRON_RUN_AS_NODE;
    supervisor = fork(development ? path.join(here, 'supervisor.mjs') : path.join(backend, 'supervisor.mjs'), [], { execPath: node, execArgv: [], cwd: backend, env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    supervisor.on('error', error => { dialog.showErrorBox('Frok could not start', error.message); void shutdown(); });
    supervisor.on('message', message => {
      if (message?.type === 'queue-state') updateQueue(message);
      if (message?.type === 'ready') { loaded = true; void window.loadURL(origin); updates.start(); }
      if (message?.type === 'fatal') { dialog.showErrorBox('Frok needs attention', message.message); void shutdown(); }
    });
    supervisor.on('exit', () => { if (!quitting && !stoppingForUpdate) { dialog.showErrorBox('Frok stopped', `The local service stopped unexpectedly. Logs are in ${machine.logs}.`); void shutdown(); } });
    if (workspace.conflicts.length) void dialog.showMessageBox(window, { type: 'info', message: 'Your edited pipelines were kept', detail: 'New bundled versions are available in the pipeline-updates folder. You can review them from Help → Open Pipeline Updates Folder.' });
  } catch (error) { await app.whenReady(); dialog.showErrorBox('Could not open Frok', error.message); void shutdown(); }
}
app.on('second-instance', () => { if (workspace && activeSession) open(); });
app.on('activate', () => { if (workspace && activeSession) open(); });
app.on('before-quit', event => { if (!quitting) { event.preventDefault(); void requestQuit(); } });
app.on('window-all-closed', () => {});
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
