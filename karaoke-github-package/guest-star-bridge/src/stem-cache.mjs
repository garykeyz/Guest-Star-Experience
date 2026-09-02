import { createHash } from "node:crypto";
import { open, readFile, realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import {
  STEM_CACHE_FORMAT_VERSION,
  STEM_MODEL_VERSIONS,
  normalizeStemEngine,
  stemCacheKey,
  validateStemManifest
} from "./stem-auto.mjs";

const SAMPLE_BYTES = 64 * 1024;

export async function fingerprintStemTrack(filePath) {
  const info = await stat(filePath);
  if (!info.isFile()) throw new Error("The stem source is not a file.");
  const handle = await open(filePath, "r");
  const hash = createHash("sha256");
  hash.update(`guest-star-track-v1|${info.size}|`);
  try {
    const positions = [...new Set([
      0,
      Math.max(0, Math.floor(info.size / 2) - Math.floor(SAMPLE_BYTES / 2)),
      Math.max(0, info.size - SAMPLE_BYTES)
    ])];
    for (const position of positions) {
      const length = Math.min(SAMPLE_BYTES, Math.max(0, info.size - position));
      if (!length) continue;
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(buffer, 0, length, position);
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    await handle.close();
  }
  return {
    fingerprint: hash.digest("hex"),
    size: info.size,
    mtimeMs: info.mtimeMs
  };
}

export function stemCachePaths(cacheRoot, fingerprint, engine, modelVersion) {
  const normalizedEngine = normalizeStemEngine(engine, "spleeter");
  if (normalizedEngine === "auto") throw new Error("Auto has no direct cache entry.");
  const version = String(modelVersion || STEM_MODEL_VERSIONS[normalizedEngine]);
  const cacheKey = stemCacheKey(fingerprint, normalizedEngine, version);
  const directory = resolve(cacheRoot, `v${STEM_CACHE_FORMAT_VERSION}`, cacheKey);
  return {
    cacheKey,
    directory,
    manifestPath: resolve(directory, "manifest.json"),
    instrumentalPath: resolve(directory, "instrumental.m4a"),
    vocalsPath: resolve(directory, "vocals.m4a")
  };
}

export function completeStemManifest({
  fingerprint,
  engine,
  modelVersion,
  source,
  instrumental,
  vocals,
  createdAt = new Date().toISOString()
} = {}) {
  const normalizedEngine = normalizeStemEngine(engine, "spleeter");
  return {
    formatVersion: STEM_CACHE_FORMAT_VERSION,
    complete: true,
    fingerprint: String(fingerprint || ""),
    engine: normalizedEngine,
    modelVersion: String(modelVersion || STEM_MODEL_VERSIONS[normalizedEngine] || ""),
    createdAt,
    source: {
      size: Math.max(0, Number(source?.size) || 0),
      durationSeconds: Math.max(0, Number(source?.durationSeconds) || 0)
    },
    outputs: {
      instrumental: {
        file: "instrumental.m4a",
        size: Math.max(0, Number(instrumental?.size) || 0),
        durationSeconds: Math.max(0, Number(instrumental?.durationSeconds) || 0)
      },
      vocals: {
        file: "vocals.m4a",
        size: Math.max(0, Number(vocals?.size) || 0),
        durationSeconds: Math.max(0, Number(vocals?.durationSeconds) || 0)
      }
    }
  };
}

export async function inspectStemCache({
  cacheRoot,
  fingerprint,
  engine,
  modelVersion,
  probeDuration = null
} = {}) {
  const paths = stemCachePaths(cacheRoot, fingerprint, engine, modelVersion);
  try {
    const [safeRoot, safeDirectory] = await Promise.all([
      realpath(cacheRoot),
      realpath(paths.directory)
    ]);
    if (!safeDirectory.startsWith(`${safeRoot}${sep}`)) {
      return { valid: false, reason: "cache_path_outside_root", ...paths };
    }
    const [manifestText, instrumentalInfo, vocalsInfo] = await Promise.all([
      readFile(paths.manifestPath, "utf8"),
      stat(paths.instrumentalPath),
      stat(paths.vocalsPath)
    ]);
    const manifest = JSON.parse(manifestText);
    let measuredDurations;
    if (typeof probeDuration === "function") {
      const [instrumental, vocals] = await Promise.all([
        probeDuration(paths.instrumentalPath),
        probeDuration(paths.vocalsPath)
      ]);
      measuredDurations = { instrumental, vocals };
    }
    const validation = validateStemManifest({
      manifest,
      fingerprint,
      engine,
      modelVersion,
      instrumental: { isFile: instrumentalInfo.isFile(), size: instrumentalInfo.size },
      vocals: { isFile: vocalsInfo.isFile(), size: vocalsInfo.size },
      measuredDurations
    });
    return { ...validation, ...paths, manifest };
  } catch (error) {
    return {
      valid: false,
      reason: error instanceof SyntaxError ? "manifest_invalid_json" : "cache_entry_missing",
      ...paths
    };
  }
}
