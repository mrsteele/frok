const { contextBridge, ipcRenderer } = require('electron');

// Expose specific actions only; never expose ipcRenderer or arbitrary paths.
contextBridge.exposeInMainWorld('frokDesktop', Object.freeze({
  credentialsStatus: () => ipcRenderer.invoke('frok:credentials-status'),
  saveCredential: (key, value) => ipcRenderer.invoke('frok:credentials-save', key, value),
  info: () => ipcRenderer.invoke('frok:info'),
  checkUpdates: () => ipcRenderer.invoke('frok:check-updates'),
  installUpdate: () => ipcRenderer.invoke('frok:install-update'),
  cancelUpdateRestart: () => ipcRenderer.invoke('frok:cancel-update-restart'),
  onUpdate: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('frok:update-state', listener);
    return () => ipcRenderer.removeListener('frok:update-state', listener);
  },
  openDocs: page => ipcRenderer.invoke('frok:open-docs', page),
  openPipelines: () => ipcRenderer.invoke('frok:open-pipelines'),
  openLogs: () => ipcRenderer.invoke('frok:open-logs'),
  openPipelineUpdates: () => ipcRenderer.invoke('frok:open-pipeline-updates'),
}));
