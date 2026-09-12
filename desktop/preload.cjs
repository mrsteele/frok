const { contextBridge, ipcRenderer } = require('electron');

// Expose specific actions only; never expose ipcRenderer or arbitrary paths.
contextBridge.exposeInMainWorld('frokDesktop', Object.freeze({
  credentialsStatus: () => ipcRenderer.invoke('frok:credentials-status'),
  saveCredential: (key, value) => ipcRenderer.invoke('frok:credentials-save', key, value),
  info: () => ipcRenderer.invoke('frok:info'),
  openDocs: page => ipcRenderer.invoke('frok:open-docs', page),
  openPipelines: () => ipcRenderer.invoke('frok:open-pipelines'),
  openLogs: () => ipcRenderer.invoke('frok:open-logs'),
  openPipelineUpdates: () => ipcRenderer.invoke('frok:open-pipeline-updates'),
}));
