const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const mojang = require('./mojang');
const fabric = require('./fabric');
const modrinth = require('./modrinth');

/**
 * @param {object} opts
 * @param {string} opts.version - e.g. "26.2"
 * @param {boolean} opts.withMods
 * @param {string[]} opts.modIds - keys from modrinth.CURATED_MODS the user has "installed"
 * @param {number} opts.ramGB
 * @param {object} opts.account - { username, uuid, minecraftAccessToken } from msauth
 * @param {string} opts.cacheDir - shared cache for vanilla client/libraries/assets (same across versions)
 * @param {string} opts.gameDir - THIS version's own folder for mods/saves/options — never shared
 *   with other versions, so switching versions can't mix incompatible mod jars together
 * @param {(msg:string)=>void} opts.onStatus - called with human-readable progress lines
 */
async function launch(opts) {
  const { version, withMods, modIds, ramGB, account, cacheDir, gameDir, onStatus } = opts;

  if (!account?.minecraftAccessToken) {
    throw new Error('You need to sign in with Microsoft before you can launch.');
  }

  fs.mkdirSync(cacheDir, { recursive: true });
  fs.mkdirSync(gameDir, { recursive: true });

  const vanilla = await mojang.ensureClientInstalled(version, cacheDir, onStatus);
  const fab = await fabric.ensureFabricInstalled(version, cacheDir, onStatus);

  const modsDir = path.join(gameDir, 'mods');
  fs.mkdirSync(modsDir, { recursive: true });

  if (withMods && modIds.length) {
    for (const modId of modIds) {
      await modrinth.downloadMod(modId, version, modsDir, onStatus);
    }
  }

  onStatus(`Starting Fabric ${version} + JVM…`);

  const classpathSep = process.platform === 'win32' ? ';' : ':';
  const classpath = [...vanilla.classpath, vanilla.jarPath, ...fab.classpath].join(classpathSep);

  const args = [
    `-Xmx${ramGB}G`,
    `-Xms${Math.min(ramGB, 2)}G`,
    '-Djava.library.path=' + path.join(cacheDir, 'natives'),
    '-cp',
    classpath,
    fab.mainClass,
    '--username', account.username,
    '--uuid', account.uuid,
    '--accessToken', account.minecraftAccessToken,
    '--version', version,
    '--gameDir', gameDir,
    '--assetsDir', vanilla.assetsDir,
    '--assetIndex', vanilla.assetIndexId,
    '--userType', 'msa',
    '--versionType', 'release',
  ];

  const proc = spawn('java', args, { cwd: gameDir });

  proc.stdout.on('data', (d) => onStatus(d.toString()));
  proc.stderr.on('data', (d) => onStatus(d.toString()));

  return proc;
}

module.exports = { launch };
