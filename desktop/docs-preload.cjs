const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('frokDocs', Object.freeze({
  info: () => ipcRenderer.invoke('frok-docs:info'),
  openOnline: () => ipcRenderer.invoke('frok-docs:online'),
}));
