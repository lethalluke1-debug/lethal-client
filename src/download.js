const fs = require('fs');
const path = require('path');
const { pipeline } = require('stream/promises');

/**
 * Download a URL straight to disk using Node's built-in fetch (Node 18+).
 * Creates parent directories as needed. Skips re-downloading if the file
 * already exists, since Minecraft/Fabric/mod files are content-addressed
 * or versioned and don't need to be re-fetched once you have them.
 */
async function downloadFile(url, destPath) {
  if (fs.existsSync(destPath)) return destPath;

  fs.mkdirSync(path.dirname(destPath), { recursive: true });

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download ${url} — HTTP ${res.status}`);
  }

  const tmpPath = destPath + '.part';
  await pipeline(res.body, fs.createWriteStream(tmpPath));
  fs.renameSync(tmpPath, destPath);
  return destPath;
}

/**
 * Run a list of async download tasks with a concurrency cap, so we don't
 * open thousands of simultaneous connections when pulling Minecraft's
 * asset objects (there can be 10,000+ of them).
 */
async function withConcurrency(items, limit, worker) {
  let index = 0;
  let active = 0;
  let rejected = null;

  return new Promise((resolve, reject) => {
    function next() {
      if (rejected) return;
      if (index >= items.length && active === 0) return resolve();
      while (active < limit && index < items.length) {
        const item = items[index++];
        active++;
        worker(item)
          .catch((err) => {
            rejected = err;
            reject(err);
          })
          .finally(() => {
            active--;
            next();
          });
      }
    }
    next();
  });
}

module.exports = { downloadFile, withConcurrency };
