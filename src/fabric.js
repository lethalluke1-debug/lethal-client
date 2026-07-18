const fs = require('fs');
const path = require('path');
const { downloadFile } = require('./download');

const FABRIC_META = 'https://meta.fabricmc.net/v2/versions/loader';

async function getLatestFabricLoaderVersion(gameVersion, signal) {
  const res = await fetch(`${FABRIC_META}/${gameVersion}`, { signal });
  if (!res.ok) throw new Error(`Could not reach Fabric's meta API (HTTP ${res.status}).`);
  const list = await res.json();
  if (!list.length) {
    throw new Error(`Fabric doesn't have a loader build for Minecraft ${gameVersion} yet.`);
  }
  return list[0].loader.version; // Fabric Meta returns newest first
}

async function getFabricProfile(gameVersion, loaderVersion, signal) {
  const res = await fetch(`${FABRIC_META}/${gameVersion}/${loaderVersion}/profile/json`, { signal });
  if (!res.ok) throw new Error(`Could not fetch the Fabric profile (HTTP ${res.status}).`);
  return res.json();
}

/**
 * Downloads the Fabric loader + its libraries for the given Minecraft
 * version, and returns the mainClass + classpath entries needed to
 * actually launch Fabric instead of vanilla.
 */
async function ensureFabricInstalled(gameVersion, instanceDir, onStatus, signal) {
  onStatus?.('Checking Fabric loader version…');
  const loaderVersion = await getLatestFabricLoaderVersion(gameVersion, signal);

  onStatus?.(`Installing Fabric ${loaderVersion}…`);
  const profile = await getFabricProfile(gameVersion, loaderVersion, signal);

  const libsDir = path.join(instanceDir, 'libraries');
  const classpath = [];

  for (const lib of profile.libraries) {
    const [group, artifact, version] = lib.name.split(':');
    const relPath = `${group.replace(/\./g, '/')}/${artifact}/${version}/${artifact}-${version}.jar`;
    const baseUrl = lib.url || 'https://maven.fabricmc.net/';
    const url = `${baseUrl}${relPath}`;
    const dest = path.join(libsDir, relPath);
    await downloadFile(url, dest, signal);
    classpath.push(dest);
  }

  return { mainClass: profile.mainClass, classpath, loaderVersion };
}

module.exports = { getLatestFabricLoaderVersion, getFabricProfile, ensureFabricInstalled };
