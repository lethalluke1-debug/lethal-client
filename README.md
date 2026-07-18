# Lethal Client

A real Fabric-based Minecraft launcher: Microsoft sign-in, real mod downloads
from Modrinth, real Fabric install, and a real Java launch. No offline/cracked
login — you need a Microsoft account that actually owns Minecraft: Java Edition.

## Just want to play?

1. Download the latest installer from the [Releases page](../../releases/latest)
2. Run it — installs like any other Windows program
3. Open Lethal Client, click the account icon, sign in with your Microsoft account
4. Pick a Minecraft version, choose mods if you want any, hit Play

That's it — no Node, no npm, no Azure account, nothing to set up. All of that
was already done once by the developer and is baked into the installer.

**Requirements:**
- Windows 10/11
- [Java](https://adoptium.net) installed (Java 21+ recommended)
- A Microsoft account that owns Minecraft: Java Edition

---

## Building it from source (for developers)

Everything below is only relevant if you want to modify the code yourself,
not if you just want to use the app.

### Requirements

- **Node.js 18+** (for the built-in `fetch` used throughout) — https://nodejs.org
- **Java** installed and on your PATH (Java 21+ recommended for recent versions)
- A **Microsoft account that owns Minecraft: Java Edition**
- Your own **Microsoft Azure app registration** (free, takes ~5 minutes — see below)

### 1. Install dependencies

```
npm install
```

### 2. Microsoft Azure app registration

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
9. Also add **`http://localhost`** (exactly that, no port number) as another Redirect URI under the same "Mobile and desktop applications" platform. This is what lets sign-in open your real browser and jump straight back into the app afterward instead of showing a code to type in.

### 3. Get your app approved for Xbox/Minecraft login

Since a Microsoft policy change, every *newly created* Azure app needs manual
approval before it's allowed to use Xbox/Minecraft login — separate from
everything above, and there's no way around it. Apps like Lunar Client or
Prism Launcher already went through this exact process when they were first
built; you just never see it as a user of those apps.

1. Go to https://aka.ms/mce-reviewappid
2. Fill in your app's **Client ID** and **Tenant ID** (both on the app's Overview page in Azure)
3. Describe what the app is (e.g. "personal Fabric mod launcher for my own Minecraft account")
4. Submit and wait — no published timeline, no way to speed it up
5. You'll get an email when it's approved. Until then, sign-in fails with "Invalid app registration, see https://aka.ms/AppRegInfo" — expected, not a bug.

### 4. Paste the client ID into `config.json`:

```json
{
  "msClientId": "your-application-client-id-here",
  "ramGB": 4
}
```

### 5. Run it

```
npm start
```

Click the account chip in the top right to sign in with Microsoft — opens your
real browser, signs in, jumps back into the app automatically. Once signed in,
pick a version, choose No Mods / With Mods, install whatever you want from the
Mods page, and hit Play.

## What's real here vs. what's still simplified

**Real:**
- Microsoft → Xbox Live → XSTS → Minecraft Services login (`src/msauth.js`)
- Game-ownership check against Mojang's servers (login fails without a valid purchase)
- Vanilla client jar, libraries, and asset downloads from Mojang's manifest (`src/mojang.js`)
- Fabric loader install via Fabric's official Meta API (`src/fabric.js`)
- Mod downloads from Modrinth's public API (`src/modrinth.js`)
- Spawning a real `java` process with the right classpath and launch args (`src/launcher-core.js`)
- Real skin upload to Mojang's Minecraft Services API (currently disabled in the UI, code intact)
- Live server status checks via a public status API

**Simplified / left for later:**
- No progress *percentage* for downloads — the bar just pulses forward on each status line.
- No auto-detection of Java — if `java` isn't on your PATH, the launch will fail with an error from Node's `child_process.spawn`.
- The version list in the UI assumes Mojang's internal manifest `id` matches the marketing version name.
- Cosmetics tab is disabled/grayed out — the underlying code exists but isn't wired to the nav.
- No crash reporting, no multi-account support yet.

## Packaging it into a real installer

`electron-builder` turns this into a normal installer anyone can double-click.

**One-time setup:**
```
npm install
```

**Build the installer:**
```
npm run dist
```

This creates a `dist/` folder with a real installer for your OS:
- **Windows:** `Lethal Client Setup 0.1.0.exe`
- **Mac:** `Lethal Client-0.1.0.dmg`
- **Linux:** `Lethal Client-0.1.0.AppImage`

**Important:** the `config.json` with your Azure client ID gets bundled
*inside* the installer. That means:
- You only ever do the Azure setup once, on your own machine, before building
- Anyone who installs the packaged app automatically gets that same client ID baked in — they never see Azure, they just click "Sign in with Microsoft" and it works
- If you ever need to change the client ID later, edit `config.json` and run `npm run dist` again to rebuild

## Auto-updates — so everyone's installed copy updates itself

`electron-updater` (already wired into `main.js`) checks GitHub Releases
automatically every time someone opens the app.

**One-time setup:**

1. In `package.json`, under `"build" → "publish"`, confirm `owner` and `repo` match your actual GitHub username and repo name.
2. Create a GitHub Personal Access Token: GitHub → Settings → Developer settings → Personal access tokens → generate one with `repo` scope.
3. Set it as an environment variable before publishing:
   ```
   set GH_TOKEN=your_token_here
   ```
   (On Mac/Linux: `export GH_TOKEN=your_token_here`)

**Every time you want to push an update to everyone:**

1. Bump the version number in `package.json` (e.g. `"version": "0.2.0"`)
2. Run:
   ```
   npm run publish
   ```
3. Every installed copy checks GitHub automatically, downloads the new version quietly, and shows "Update ready — restart to apply" the next time it's opened.

**Important:** auto-update only works in a *packaged* app, never when running from source with `npm start`.

## Project structure

```
main.js              Electron main process — creates the window, wires up IPC
preload.js            contextBridge API exposed to the renderer
config.json           Your Azure client ID + RAM allocation
renderer/index.html   The UI
renderer/splash.html  Loading screen
src/msauth.js         Microsoft/Xbox/Minecraft login
src/mojang.js         Version manifest, client jar, libraries, assets
src/fabric.js         Fabric loader install
src/modrinth.js       Mod search/download/remove
src/launcher-core.js  Orchestrates a full launch
src/download.js       Shared download-to-disk helper with concurrency limiting
```
