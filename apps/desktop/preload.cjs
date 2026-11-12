// The only bridge between the web app and the desktop shell. Exposes a few narrow, typed calls; no Node access.
const { contextBridge, ipcRenderer } = require('electron');

// The native model runtime ships binaries for macOS on Apple Silicon, Windows and Linux, but not Intel Macs. There the
// bridge is left out and the app runs the same model in its built-in browser engine instead.
const nativeModel = !(process.platform === 'darwin' && process.arch === 'x64');

contextBridge.exposeInMainWorld('lemmaDesktop', {
  isOverlay: new URLSearchParams(location.search).has('overlay'),
  platform: process.platform,
  hideOverlay: () => ipcRenderer.send('overlay:hide'),
  resizeOverlay: (height) => ipcRenderer.send('overlay:resize', Number(height)),
  openMain: () => ipcRenderer.send('app:open-main'),
  info: () => ipcRenderer.invoke('app:info'),
  firstRun: () => ipcRenderer.invoke('app:first-run'),
  // Data saved before the rename, handed over once (apps/desktop/legacy.mjs, apps/web/src/legacy.ts).
  legacyDump: () => ipcRenderer.invoke('legacy:dump'),
  legacyDone: () => ipcRenderer.send('legacy:done'),
  openAtLogin: () => ipcRenderer.invoke('app:open-at-login'),
  // Encrypted sync file in a user-chosen folder (iCloud Drive, Dropbox…). Bytes are already encrypted here.
  sync: {
    status: () => ipcRenderer.invoke('sync:status'),
    chooseFolder: () => ipcRenderer.invoke('sync:choose'),
    read: () => ipcRenderer.invoke('sync:read'),
    write: (bytes) => ipcRenderer.invoke('sync:write', bytes),
    savePassphrase: (p) => ipcRenderer.invoke('sync:save-passphrase', p),
    passphrase: () => ipcRenderer.invoke('sync:passphrase'),
  },
  // Native on-device model (main process). Tokens and download progress arrive as events.
  llm: nativeModel ? {
    load: (model) => ipcRenderer.invoke('llm:load', model),
    generate: (id, model, req) => ipcRenderer.invoke('llm:generate', { id, model, req }),
    abort: (id) => ipcRenderer.send('llm:abort', id),
    onToken: (cb) => {
      const h = (_e, d) => cb(d);
      ipcRenderer.on('llm:token', h);
      return () => ipcRenderer.off('llm:token', h);
    },
    onProgress: (cb) => {
      const h = (_e, p) => cb(p);
      ipcRenderer.on('llm:progress', h);
      return () => ipcRenderer.off('llm:progress', h);
    },
  } : undefined,
  onOverlayShown: (cb) => {
    const handler = (_e, detail) => cb(detail);
    ipcRenderer.on('overlay:shown', handler);
    return () => ipcRenderer.off('overlay:shown', handler);
  },
});
