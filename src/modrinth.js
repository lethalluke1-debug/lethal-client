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
  ferritecore: 'ferrite-core',
  immediatelyfast: 'immediatelyfast',
  'dynamic-fps': 'dynamic-fps',
  entityculling: 'entityculling',
  'low-fire': 'low-fire-reborn',
  'marlows-crystal-optimizer': 'marlow-crystal-optimizer',
  'heros-anchor-optimizer': 'anchor',
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
  'map-tooltip': 'map-tooltip',
  shulkerboxtooltip: 'shulkerboxtooltip',
  svc: 'simple-voice-chat',
  flashback: 'flashback',
  worldedit: 'worldedit',
  whoami: 'whoami',
  'map-in-slot': 'map-in-slot',
  modmenu: 'modmenu',
  fullbright: 'fullbright',
  freelook: 'freelook',
  'ukus-armor-hud': 'ukus-armor-hud',
  zoomify: 'zoomify',
  essential: 'essential',
};

async function getBestVersion(slug, gameVersion, loader = 'fabric', signal) {
  const url = `${API}/project/${slug}/version?loaders=["${loader}"]&game_versions=["${gameVersion}"]`;
  const res = await fetch(url, { headers: HEADERS, signal });
  if (!res.ok) throw new Error(`Modrinth lookup failed for "${slug}" (HTTP ${res.status}).`);
  const versions = await res.json();
  if (!versions.length) {
    throw new Error(`No Fabric build of "${slug}" is published for Minecraft ${gameVersion} yet.`);
  }
  return versions[0]; // Modrinth returns newest-compatible first
}

async function resolveProjectSlug(projectId, signal) {
  const res = await fetch(`${API}/project/${projectId}`, { headers: HEADERS, signal });
  if (!res.ok) throw new Error(`Could not resolve dependency project ${projectId} (HTTP ${res.status}).`);
  const project = await res.json();
  return project.slug;
}

/**
 * Downloads a mod, and recursively downloads any *required* dependencies
 * Modrinth says it needs (e.g. most mods require Fabric API to even load).
 * `visited` prevents re-downloading the same dependency twice in one pass,
 * or looping forever if two mods depend on each other.
 */
async function downloadMod(modId, gameVersion, modsDir, onStatus, visited = new Set(), dependencyResults = [], signal, knownFiles = {}) {
  const slug = CURATED_MODS[modId] || modId;
  if (visited.has(slug)) return null; // already handled earlier in this same install pass
  visited.add(slug);

  // Fast path: if we already know (from a previous install, recorded in the
  // manifest) exactly which file this mod is, and it's genuinely still
  // sitting on disk, skip the Modrinth lookup entirely — no network call,
  // no waiting. This is what makes launching with the same mods repeatedly
  // fast instead of re-checking Modrinth every single time.
  const knownFilename = knownFiles[modId];
  if (knownFilename) {
    const knownPath = path.join(modsDir, knownFilename);
    if (fs.existsSync(knownPath)) {
      return { filename: knownFilename, versionNumber: null };
    }
  }

  onStatus?.(`Looking up ${slug} on Modrinth…`);
  const version = await getBestVersion(slug, gameVersion, 'fabric', signal);
  const file = version.files.find((f) => f.primary) || version.files[0];

  onStatus?.(`Downloading ${file.filename}…`);
  fs.mkdirSync(modsDir, { recursive: true });
  const dest = path.join(modsDir, file.filename);
  await downloadFile(file.url, dest, signal);

  const isTopLevelCall = dependencyResults.length === 0 && visited.size === 1;
  const result = { filename: file.filename, versionNumber: version.version_number };

  // Auto-install required dependencies so a mod doesn't silently fail to
  // load in-game because something it needs (often Fabric API) is missing.
  const requiredDeps = (version.dependencies || []).filter(
    (d) => d.dependency_type === 'required' && d.project_id
  );
  for (const dep of requiredDeps) {
    try {
      const depSlug = await resolveProjectSlug(dep.project_id, signal);
      onStatus?.(`${slug} needs ${depSlug} — installing that too…`);
      const depResult = await downloadMod(depSlug, gameVersion, modsDir, onStatus, visited, dependencyResults, signal, knownFiles);
      if (depResult) dependencyResults.push({ modId: depSlug, ...depResult });
    } catch (err) {
      onStatus?.(`Couldn't auto-install a dependency for ${slug}: ${err.message}`);
    }
  }

  return isTopLevelCall ? { ...result, dependencies: dependencyResults } : result;
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
