import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

// Verification belongs to the engine, not to unrelated UI releases. Inspect
// the complete dependency tree once at startup, without loading model buffers.
export async function stemVerificationFingerprint({ engineRoot, smokeScript, toolPaths = [], identity }) {
  const hash = createHash('sha256');
  hash.update(`stem-verification-v2|${identity}|${engineRoot}|`);
  const describe = async (path, name) => {
    try {
      const info = await stat(path);
      hash.update(`${name}|${info.size}|${info.mtimeMs}|${info.mode}|`);
    } catch { hash.update(`${name}|missing|`); }
  };
  const walk = async (directory, prefix = '') => {
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); }
    catch { hash.update(`${prefix}|missing-directory|`); return; }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const name = `${prefix}${entry.name}`;
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) await walk(path, `${name}/`);
      else await describe(path, name);
    }
  };
  await walk(engineRoot);
  for (const path of [...new Set(toolPaths)].sort()) await describe(path, path);
  try { hash.update(await readFile(smokeScript)); }
  catch { hash.update('missing-smoke-script'); }
  return hash.digest('hex');
}
