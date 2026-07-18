const { app, BrowserWindow, ipcMain, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

const msauth = require('./src/msauth');
const launcherCore = require('./src/launcher-core');
const modrinth = require('./src/modrinth');

const CONFIG_PATH = path.join(__dirname, 'config.json');
// Shared cache: vanilla client jars, libraries, assets — same files work for
// any instance, no need to re-download per version.
const CACHE_DIR = path.join(app.getPath('userData'), 'cache');
// Each Minecraft version gets its own folder for mods/saves/options, so
// switching versions never mixes incompatible mod jars together.
const INSTANCES_ROOT = path.join(app.getPath('userData'), 'instances');

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

function gameDirFor(version) {
  const dir = path.join(INSTANCES_ROOT, version);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function manifestPathFor(version) {
  return path.join(gameDirFor(version), 'mod-manifest.json');
}

function loadManifest(version) {
  const p = manifestPathFor(version);
  if (!fs.existsSync(p)) return {};
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

function saveManifest(version, manifest) {
  fs.writeFileSync(manifestPathFor(version), JSON.stringify(manifest, null, 2));
}

let mainWindow;
let splashWindow;
let account = null; // set after a successful Microsoft login

function createSplash() {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 260,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    backgroundColor: '#0d1013',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  splashWindow.loadFile(path.join(__dirname, 'renderer', 'splash.html'));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    show: false, // stays hidden until the splash's minimum time has passed
    frame: false, // no native title bar/menu — replaced with our own in the renderer
    backgroundColor: '#0d1013',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  const minSplashTime = new Promise((resolve) => setTimeout(resolve, 2200));

  mainWindow.once('ready-to-show', async () => {
    await minSplashTime;
    if (splashWindow && !splashWindow.isDestroyed()) splashWindow.close();
    mainWindow.show();
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.mkdirSync(INSTANCES_ROOT, { recursive: true });
  createSplash();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// ---------- Auto-updates ----------
// Checks the GitHub repo configured in package.json's "build.publish" section.
// Only works in a packaged build (npm start from source always says
// "update-not-available", since dev builds have no version to compare against).
autoUpdater.on('checking-for-update', () => {
  mainWindow?.webContents.send('status-update', `Checking for updates… (currently on v${app.getVersion()})`);
});
autoUpdater.on('update-available', (info) => {
  mainWindow?.webContents.send('status-update', `Update found (v${info.version}) — downloading…`);
});
autoUpdater.on('update-not-available', () => {
  mainWindow?.webContents.send('status-update', `You're on the latest version (v${app.getVersion()}).`);
});
autoUpdater.on('download-progress', (progress) => {
  mainWindow?.webContents.send('status-update', `Downloading update — ${Math.round(progress.percent)}%…`);
});
autoUpdater.on('update-downloaded', () => {
  mainWindow?.webContents.send('status-update', 'Update ready — restart Lethal Client to apply it.');
  mainWindow?.webContents.send('update-ready');
});
autoUpdater.on('error', (err) => {
  mainWindow?.webContents.send('status-update', `Update check failed: ${err.message}`);
  console.error('Auto-update error:', err);
});

// The user clicks "Restart Now" in the renderer to actually apply it — this
// closes the launcher (never Minecraft, which runs as its own detached
// process) and reopens it already updated.
ipcMain.on('restart-to-update', () => {
  // isSilent=true, isForceRunAfter=true: no installer wizard, just swaps
  // itself out and relaunches automatically.
  autoUpdater.quitAndInstall(true, true);
});

// Lets the user (or us, for debugging) trigger a check on demand instead of
// only ever checking once automatically at startup.
ipcMain.handle('check-for-updates', async () => {
  return autoUpdater.checkForUpdates();
});

app.whenReady().then(() => {
  autoUpdater.checkForUpdatesAndNotify().catch((err) => {
    console.error('Update check failed:', err);
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function sendStatus(msg) {
  mainWindow?.webContents.send('status-update', msg);
}

// ---------- Custom window controls (since frame:false removes the native ones) ----------
ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window-close', () => mainWindow?.close());

// ---------- Microsoft login ----------
ipcMain.handle('ms-login', async () => {
  const config = loadConfig();
  if (!config.msClientId || config.msClientId.startsWith('PUT-YOUR')) {
    throw new Error(
      'No Azure client ID set in config.json yet. See README.md → "Microsoft Azure app registration".'
    );
  }

  mainWindow?.webContents.send('ms-login-waiting');

  const result = await msauth.browserLogin(config.msClientId, (url) => {
    shell.openExternal(url);
  });

  account = result;
  return { username: result.username, uuid: result.uuid };
});

ipcMain.handle('get-account', () => {
  return account ? { username: account.username, uuid: account.uuid } : null;
});

// ---------- Mods (Modrinth) ----------
ipcMain.handle('install-mod', async (event, { modId, version }) => {
  const modsDir = path.join(gameDirFor(version), 'mods');
  const result = await modrinth.downloadMod(modId, version, modsDir, sendStatus);
  const manifest = loadManifest(version);
  manifest[modId] = result.filename;
  // Any required dependencies (e.g. Fabric API) got auto-installed too —
  // record those in the manifest so the UI shows them as installed as well.
  for (const dep of result.dependencies || []) {
    manifest[dep.modId] = dep.filename;
  }
  saveManifest(version, manifest);
  return result;
});

ipcMain.handle('remove-mod', async (event, { modId, version }) => {
  const modsDir = path.join(gameDirFor(version), 'mods');
  const manifest = loadManifest(version);
  const filename = manifest[modId];
  if (filename) {
    modrinth.removeMod(modsDir, filename);
    delete manifest[modId];
    saveManifest(version, manifest);
  }
  return true;
});

ipcMain.handle('get-mod-manifest', async (event, { version }) => {
  return loadManifest(version);
});

// Scans every version's instance folder and returns the union of mod IDs
// installed in ANY of them — powers the "Your Mods" tab, which shows your
// full collection across versions, not just the currently selected one.
ipcMain.handle('get-all-installed-mod-ids', async () => {
  const ids = new Set();
  if (!fs.existsSync(INSTANCES_ROOT)) return [];

  for (const versionFolder of fs.readdirSync(INSTANCES_ROOT)) {
    const manifestPath = path.join(INSTANCES_ROOT, versionFolder, 'mod-manifest.json');
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      Object.keys(manifest).forEach((id) => ids.add(id));
    }
  }
  return [...ids];
});

// ---------- Skins (real Mojang skin upload) ----------
ipcMain.handle('upload-skin', async (event, { base64Data, variant }) => {
  if (!account?.minecraftAccessToken) {
    throw new Error('Sign in with Microsoft first.');
  }

  const fileBuffer = Buffer.from(base64Data, 'base64');
  const formData = new FormData();
  formData.append('variant', variant === 'slim' ? 'slim' : 'classic');
  formData.append('file', new Blob([fileBuffer], { type: 'image/png' }), 'skin.png');

  const res = await fetch('https://api.minecraftservices.com/minecraft/profile/skins', {
    method: 'POST',
    headers: { Authorization: `Bearer ${account.minecraftAccessToken}` },
    body: formData,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Mojang rejected the upload (HTTP ${res.status}): ${errText || 'no details given'}`);
  }

  return res.json();
});

// ---------- Launch ----------
let currentLaunchController = null;

ipcMain.handle('launch-game', async (event, { version, withMods, modIds }) => {
  const config = loadConfig();
  if (!account) throw new Error('Sign in with Microsoft first.');

  currentLaunchController = new AbortController();

  try {
    await launcherCore.launch({
      version,
      withMods,
      modIds,
      ramGB: config.ramGB || 4,
      account,
      cacheDir: CACHE_DIR,
      gameDir: gameDirFor(version),
      onStatus: sendStatus,
      signal: currentLaunchController.signal,
    });
    return true;
  } catch (err) {
    if (err.name === 'AbortError') {
      return { cancelled: true };
    }
    throw err;
  } finally {
    currentLaunchController = null;
  }
});

ipcMain.on('cancel-launch', () => {
  currentLaunchController?.abort();
});
