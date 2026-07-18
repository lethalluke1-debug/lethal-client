# Lethal Client

A real Fabric-based Minecraft launcher: Microsoft sign-in, real mod downloads
from Modrinth, real Fabric install, and a real Java launch. No offline/cracked
login — you need a Microsoft account that actually owns Minecraft: Java Edition.

## Requirements

- **Node.js 18+** (for the built-in `fetch` used throughout) — https://nodejs.org
- **Java** installed and on your PATH (Java 21+ recommended for recent versions)
- A **Microsoft account that owns Minecraft: Java Edition**
- Your own **Microsoft Azure app registration** (free, takes ~5 minutes — see below)

## 1. Install dependencies

```
npm install
```

## 2. Microsoft Azure app registration

Every third-party Minecraft launcher needs its own Azure application — this
is Microsoft's requirement, not something Anthropic or anyone else can hand
you a shared one for. It's free and takes a few minutes:

1. Go to https://portal.azure.com and sign in (any Microsoft account works for this part).
2. Search for **"App registrations"** → **New registration**.
3. Name it anything (e.g. "Lethal Client").
4. Under **Supported account types**, choose **"Personal Microsoft accounts only"**.
5. Leave Redirect URI blank for now → **Register**.
6. On the app's Overview page, copy the **Application (client) ID**.
7. Go to **Authentication** → **Add a platform** → **Mobile and desktop applications** →
   check the `https://login.microsoftonline.com/common/oauth2/nativeclient` box → **Configure**.
8. Still on **Authentication**, scroll down and turn on **"Allow public client flows"** → **Yes** → **Save**.

Paste the client ID into `config.json`:

```json
{
  "msClientId": "your-application-client-id-here",
  "ramGB": 4
}
```

## 3. Run it

```
npm start
```

Click the account chip in the top right to sign in with Microsoft (device
code flow — you'll get a code and a link, exactly like signing into a smart
TV app). Once you're signed in, pick a version, choose No Mods / With Mods,
install whatever you want from the Mods page, and hit Play.

## What's real here vs. what's still simplified

**Real:**
- Microsoft → Xbox Live → XSTS → Minecraft Services login (`src/msauth.js`)
- Game-ownership check against Mojang's servers (login fails without a valid purchase)
- Vanilla client jar, libraries, and asset downloads from Mojang's manifest (`src/mojang.js`)
- Fabric loader install via Fabric's official Meta API (`src/fabric.js`)
- Mod downloads from Modrinth's public API (`src/modrinth.js`)
- Spawning a real `java` process with the right classpath and launch args (`src/launcher-core.js`)

**Simplified / left for later:**
- No progress *percentage* for downloads — the bar just pulses forward on each status line, since real byte-level progress needs extra streaming plumbing.
- No auto-detection of Java — if `java` isn't on your PATH, the launch will fail with an error from Node's `child_process.spawn`.
- The version list in the UI (`26.2`, `26.1.2`, etc.) assumes Mojang's internal manifest `id` matches the marketing version name. If a launch fails with "version not found," open `https://launchermeta.mojang.com/mc/game/version_manifest_v2.json` and check the exact `id` string for that release.
- Cosmetics and the dashboard stats on the Home page are still just UI — they're not backed by real data.
- No auto-updater, no crash reporting, no multi-account support yet.

## Packaging it into a real installer

Right now, running this requires Node, npm, and a terminal — fine for you,
not something to hand a friend. `electron-builder` turns this into a normal
installer they just double-click.

**One-time setup:**
```
npm install
```
(This also pulls in `electron-builder` now that it's in `package.json`.)

**Build the installer:**
```
npm run dist
```

This creates a `dist/` folder with a real installer for your OS:
- **Windows:** `Lethal Client Setup 0.1.0.exe`
- **Mac:** `Lethal Client-0.1.0.dmg`
- **Linux:** `Lethal Client-0.1.0.AppImage`

Whoever runs that installer gets a normal "installing..." progress bar, a
Start Menu / Applications shortcut, and an app that opens like any other
program — no Node, no npm, no terminal, no visible source code.

**Important:** the `config.json` with your Azure client ID gets bundled
*inside* the installer (see the `files` list in `package.json`'s `build`
config). That means:
- You only ever do the Azure setup once, on your own machine, before building
- Anyone who installs the packaged app automatically gets that same client ID baked in — they never see Azure, they just click "Sign in with Microsoft" and it works
- If you ever need to change the client ID later, edit `config.json` and run `npm run dist` again to rebuild

**Optional — add a real icon:**
Drop an icon file at `build/icon.ico` (Windows), `build/icon.icns` (Mac), or
`build/icon.png` (Linux), then add `"icon": "build/icon.ico"` (etc.) back
into the matching section of `package.json`'s `build` config. Without one,
it just uses Electron's default icon — fine for testing, worth doing before
sharing it with anyone.



```
main.js              Electron main process — creates the window, wires up IPC
preload.js            contextBridge API exposed to the renderer
config.json           Your Azure client ID + RAM allocation
renderer/index.html   The UI (unchanged design, real backend calls)
src/msauth.js         Microsoft/Xbox/Minecraft login
src/mojang.js         Version manifest, client jar, libraries, assets
src/fabric.js         Fabric loader install
src/modrinth.js       Mod search/download/remove
src/launcher-core.js  Orchestrates a full launch
src/download.js       Shared download-to-disk helper with concurrency limiting
```
