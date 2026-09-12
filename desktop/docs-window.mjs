import { app, BrowserWindow, ipcMain, session, shell } from 'electron';
import path from 'node:path';
import { docsOrigin, docsPage, docsResponse, isDocsUrl, onlineDocsUrl } from './docs-content.mjs';
import { externalUrl } from './policy.mjs';

export function createDocumentation({ root, preload, onlineBase }) {
  let window;
  const isolated = session.fromPartition('frok-documentation');
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !isDocsUrl(details.url) && !details.url.startsWith('data:') }));
  isolated.protocol.handle('frok-docs', docsResponse(root));
  isolated.on('will-download', (_event, item) => item.setSaveDialogOptions({ title:'Save pipeline example', defaultPath:path.join(app.getPath('downloads'), path.basename(item.getFilename())) }));
  const trusted = event => {
    if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !isDocsUrl(event.senderFrame.url)) throw Error('Untrusted documentation request.');
  };
  ipcMain.handle('frok-docs:info', event => { trusted(event); return { version:app.getVersion(), onlineAvailable:!!onlineDocsUrl(onlineBase, '/') }; });
  ipcMain.handle('frok-docs:online', async event => {
    trusted(event);
    const current = new URL(window.webContents.getURL());
    const url = onlineDocsUrl(onlineBase, current.pathname + current.hash);
    if (url) await shell.openExternal(url);
  });
  function external(url) { const safe = externalUrl(url); if (safe) void shell.openExternal(safe); }
  return {
    async open(page = '/documentation') {
      const url = docsOrigin + docsPage(page);
      if (!window || window.isDestroyed()) {
        window = new BrowserWindow({ width:1100, height:820, minWidth:420, minHeight:480, show:false, title:'Frok Documentation', backgroundColor:'#080808', webPreferences:{ session:isolated, preload, sandbox:true, contextIsolation:true, nodeIntegration:false, webviewTag:false } });
        window.webContents.on('will-navigate', (event, target) => { if (!isDocsUrl(target)) { event.preventDefault(); external(target); } });
        window.webContents.setWindowOpenHandler(({ url:target }) => { if (isDocsUrl(target)) void window.loadURL(target); else external(target); return { action:'deny' }; });
        window.on('closed', () => { window = undefined; });
      }
      await window.loadURL(url);
      window.show(); window.focus();
    },
  };
}
