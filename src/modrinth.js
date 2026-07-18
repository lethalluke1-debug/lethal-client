const fs = require('fs');
const path = require('path');
const { downloadFile } = require('./download');

const API = 'https://api.modrinth.com/v2';

// Modrinth asks API consumers to send a real User-Agent identifying the
// app — this is good practice and keeps requests from being throttled.
const HEADERS = { 'User-Agent': 'lethal-client/0.1.0 (github.com/your-username/lethal-client)' };

/** The mods this launcher's Mods page ships with, by their real Modrinth slugs. */
const CURATED_MODS = {
  sodium: 'sodium',
  'sodium-extra': 'sodium-extra',
  'reeses-sodium-options': 'reeses-sodium-options',
  lithium: 'lithium',
  ferritecore: 'ferritecore',
  immediatelyfast: 'immediatelyfast',
  'dynamic-fps': 'dynamic-fps',
  entityculling: 'entityculling',
  'low-fire': 'low-fire',
  'marlows-crystal-optimizer': 'marlow-crystal-optimizer',
  'heros-anchor-optimizer': 'heros-anchor-optimizer',
  'fabric-api': 'fabric-api',
  'fabric-language-kotlin': 'fabric-language-kotlin',
  'cloth-config': 'cloth-config',
  malilib: 'malilib',
  geckolib: 'geckolib',
  ukulib: 'ukulib',
  'placeholder-api': 'placeholder-api',
  yacl: 'yacl',
  jade: 'jade',
  litematica: 'litematica',
  'map-tooltip': 'maptooltip',
  'mouse-tweaks': 'mouse-tweaks',
  shulkerboxtooltip: 'shulkerboxtooltip',
  svc: 'simple-voice-chat',
  flashback: 'flashback',
  worldedit: 'worldedit',
  whoami: 'whoami',
  'map-in-slot': 'map-in-slot',
  modmenu: 'modmenu',
  'small-shield-totem': 'small-shield-and-totem',
  fullbright: 'fullbright',
  freelook: 'freelook',
  'ukus-armor-hud': 'ukus-armor-hud',
  zoomify: 'zoomify',
  essential: 'essential',
};

async function getBestVersion(slug, gameVersion, loader = 'fabric') {
  const url = `${API}/project/${slug}/version?loaders=["${loader}"]&game_versions=["${gameVersion}"]`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`Modrinth lookup failed for "${slug}" (HTTP ${res.status}).`);
  const versions = await res.json();
  if (!versions.length) {
    throw new Error(`No Fabric build of "${slug}" is published for Minecraft ${gameVersion} yet.`);
  }
  return versions[0]; // Modrinth returns newest-compatible first
}

async function downloadMod(modId, gameVersion, modsDir, onStatus) {
  const slug = CURATED_MODS[modId] || modId;
  onStatus?.(`Looking up ${slug} on Modrinth…`);
  const version = await getBestVersion(slug, gameVersion);
  const file = version.files.find((f) => f.primary) || version.files[0];

  onStatus?.(`Downloading ${file.filename}…`);
  fs.mkdirSync(modsDir, { recursive: true });
  const dest = path.join(modsDir, file.filename);
  await downloadFile(file.url, dest);
  return { filename: file.filename, versionNumber: version.version_number };
}

function removeMod(modsDir, filename) {
  const target = path.join(modsDir, filename);
  if (fs.existsSync(target)) fs.unlinkSync(target);
}

function listInstalledMods(modsDir) {
  if (!fs.existsSync(modsDir)) return [];
  return fs.readdirSync(modsDir).filter((f) => f.endsWith('.jar'));
}

module.exports = { CURATED_MODS, getBestVersion, downloadMod, removeMod, listInstalledMods };
