const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ktalk', {
  snapshot: () => ipcRenderer.invoke('ktalk:snapshot'),
  start: (settings) => ipcRenderer.invoke('ktalk:start', settings),
  monitor: (settings) => ipcRenderer.invoke('ktalk:monitor', settings),
  stop: () => ipcRenderer.invoke('ktalk:stop'),
  devices: () => ipcRenderer.invoke('ktalk:devices'),
  preferences: (settings) => ipcRenderer.invoke('ktalk:preferences', settings),
  export: (format, sessionId) => ipcRenderer.invoke('ktalk:export', { format, sessionId }),
  copy: (sessionId) => ipcRenderer.invoke('ktalk:copy', sessionId),
  clear: () => ipcRenderer.invoke('ktalk:clear'),
  preview: () => ipcRenderer.invoke('ktalk:preview'),
  onEvent: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('ktalk:event', listener);
    return () => ipcRenderer.removeListener('ktalk:event', listener);
  },
});
