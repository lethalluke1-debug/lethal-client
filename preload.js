const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  login: () => ipcRenderer.invoke('ms-login'),
  getAccount: () => ipcRenderer.invoke('get-account'),

  installMod: (modId, version) => ipcRenderer.invoke('install-mod', { modId, version }),
  removeMod: (modId, version) => ipcRenderer.invoke('remove-mod', { modId, version }),
  getModManifest: (version) => ipcRenderer.invoke('get-mod-manifest', { version }),
  getAllInstalledModIds: () => ipcRenderer.invoke('get-all-installed-mod-ids'),

  launchGame: (version, withMods, modIds) =>
    ipcRenderer.invoke('launch-game', { version, withMods, modIds }),
  cancelLaunch: () => ipcRenderer.send('cancel-launch'),

  onStatus: (callback) => ipcRenderer.on('status-update', (event, msg) => callback(msg)),
  onLoginWaiting: (callback) => ipcRenderer.on('ms-login-waiting', () => callback()),
  onAccountRestored: (callback) => ipcRenderer.on('account-restored', (event, account) => callback(account)),
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  onUpdateReady: (callback) => ipcRenderer.on('update-ready', () => callback()),
  restartToUpdate: () => ipcRenderer.send('restart-to-update'),
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),

  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow: () => ipcRenderer.send('window-close'),

  uploadSkin: (base64Data, variant) => ipcRenderer.invoke('upload-skin', { base64Data, variant }),
});
