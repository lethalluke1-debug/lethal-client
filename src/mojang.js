const fs = require('fs');
const path = require('path');
const { downloadFile, withConcurrency } = require('./download');

const MANIFEST_URL = 'https://launchermeta.mojang.com/mc/game/version_manifest_v2.json';

async function getVersionManifest(signal) {
  const res = await fetch(MANIFEST_URL, { signal });
  if (!res.ok) throw new Error(`Could not reach Mojang's version manifest (HTTP ${res.status}).`);
  return res.json();
}

async function getVersionMeta(versionId, signal) {
  const manifest = await getVersionManifest(signal);
  const entry = manifest.versions.find((v) => v.id === versionId);
  if (!entry) {
    throw new Error(
      `Mojang's manifest has no version called "${versionId}". ` +
      `Marketing names (like "26.2") and the manifest's internal id usually match, ` +
      `but double check against the manifest if this keeps failing.`
    );
  }
  const res = await fetch(entry.url, { signal });
  return res.json();
}

function currentOsName() {
  if (process.platform === 'darwin') return 'osx';
  if (process.platform === 'win32') return 'windows';
  return 'linux';
}

function librariesForCurrentOS(libraries) {
  const os = currentOsName();
  return libraries.filter((lib) => {
    if (!lib.rules) return true;
    let allowed = false;
    for (const rule of lib.rules) {
      const osMatches = !rule.os || rule.os.name === os;
      if (rule.action === 'allow' && osMatches) allowed = true;
      if (rule.action === 'disallow' && osMatches) allowed = false;
    }
    return allowed;
  });
}

/**
 * Ensures the vanilla client jar, its libraries, and its assets are on
 * disk for the given version. Returns everything launcher-core.js needs
 * to build a classpath and launch args.
 */
async function ensureClientInstalled(versionId, instanceDir, onStatus, signal) {
  onStatus?.(`Reading version info for ${versionId}…`);
  const meta = await getVersionMeta(versionId, signal);

  const versionDir = path.join(instanceDir, 'versions', versionId);
  fs.mkdirSync(versionDir, { recursive: true });
  const jarPath = path.join(versionDir, `${versionId}.jar`);

  onStatus?.('Downloading client jar…');
  await downloadFile(meta.downloads.client.url, jarPath, signal);

  onStatus?.('Downloading libraries…');
  const libsDir = path.join(instanceDir, 'libraries');
  const classpath = [];
  const applicableLibs = librariesForCurrentOS(meta.libraries).filter((l) => l.downloads?.artifact);

  await withConcurrency(applicableLibs, 8, async (lib) => {
    const artifact = lib.downloads.artifact;
    const dest = path.join(libsDir, artifact.path);
    await downloadFile(artifact.url, dest, signal);
    classpath.push(dest);
  });

  onStatus?.('Downloading assets (first launch only, can take a while)…');
  const assetsDir = path.join(instanceDir, 'assets');
  const indexPath = path.join(assetsDir, 'indexes', `${meta.assetIndex.id}.json`);
  await downloadFile(meta.assetIndex.url, indexPath, signal);
  const assetIndexJson = JSON.parse(fs.readFileSync(indexPath, 'utf-8'));

  const objectEntries = Object.values(assetIndexJson.objects);
  const objectsDir = path.join(assetsDir, 'objects');
  await withConcurrency(objectEntries, 16, async (obj) => {
    const sub = obj.hash.slice(0, 2);
    const dest = path.join(objectsDir, sub, obj.hash);
    await downloadFile(`https://resources.download.minecraft.net/${sub}/${obj.hash}`, dest, signal);
  });

  return {
    meta,
    jarPath,
    classpath,
    assetsDir,
    assetIndexId: meta.assetIndex.id,
    mainClass: meta.mainClass,
  };
}

module.exports = { getVersionManifest, getVersionMeta, ensureClientInstalled };
