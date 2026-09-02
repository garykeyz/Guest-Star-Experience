import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  STEM_CACHE_FORMAT_VERSION,
  STEM_MODEL_VERSIONS,
  stemCacheKey,
  validateStemManifest
} from "../src/stem-auto.mjs";
import {
  completeStemManifest,
  fingerprintStemTrack,
  inspectStemCache,
  stemCachePaths
} from "../src/stem-cache.mjs";

async function temporaryDirectory(t, prefix) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

function cacheManifest({
  fingerprint,
  engine = "spleeter",
  modelVersion = STEM_MODEL_VERSIONS[engine],
  instrumentalSize = 4096,
  vocalsSize = 4096,
  instrumentalDuration = 180,
  vocalsDuration = 180.2
} = {}) {
  return completeStemManifest({
    fingerprint,
    engine,
    modelVersion,
    source: { size: 16_384, durationSeconds: 180.1 },
    instrumental: { size: instrumentalSize, durationSeconds: instrumentalDuration },
    vocals: { size: vocalsSize, durationSeconds: vocalsDuration },
    createdAt: "2026-08-01T20:00:00.000Z"
  });
}

async function writeCacheEntry({ cacheRoot, fingerprint, manifest, instrumentalSize = 4096, vocalsSize = 4096 }) {
  const paths = stemCachePaths(
    cacheRoot,
    fingerprint,
    manifest.engine,
    manifest.modelVersion
  );
  await mkdir(paths.directory, { recursive: true });
  await Promise.all([
    writeFile(paths.instrumentalPath, Buffer.alloc(instrumentalSize, 0x41)),
    writeFile(paths.vocalsPath, Buffer.alloc(vocalsSize, 0x56)),
    writeFile(paths.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8")
  ]);
  return paths;
}

test("la huella identifica el contenido y no depende del nombre ni de la ruta", async (t) => {
  const root = await temporaryDirectory(t, "guest-star-fingerprint-");
  const firstPath = join(root, "Canción uno.mp4");
  const secondPath = join(root, "renamed-copy.mov");
  const changedPath = join(root, "changed.mp4");
  const content = Buffer.alloc(220_000, 0x2a);
  const changed = Buffer.from(content);
  changed[0] = 0x2b;
  await Promise.all([
    writeFile(firstPath, content),
    writeFile(secondPath, content),
    writeFile(changedPath, changed)
  ]);

  const [first, second, different] = await Promise.all([
    fingerprintStemTrack(firstPath),
    fingerprintStemTrack(secondPath),
    fingerprintStemTrack(changedPath)
  ]);

  assert.equal(first.fingerprint, second.fingerprint);
  assert.notEqual(first.fingerprint, different.fingerprint);
  assert.equal(first.size, content.length);
  assert.ok(Number.isFinite(first.mtimeMs));
});

test("la clave de caché separa huella, motor, versión de modelo y formato", () => {
  const fingerprint = "track-fingerprint";
  const spleeterV1 = stemCacheKey(fingerprint, "spleeter", "model-v1");
  const spleeterV2 = stemCacheKey(fingerprint, "spleeter", "model-v2");
  const demucsV1 = stemCacheKey(fingerprint, "demucs", "model-v1");
  const anotherTrack = stemCacheKey("other-fingerprint", "spleeter", "model-v1");

  assert.equal(spleeterV1, stemCacheKey(fingerprint, "spleeter", "model-v1"));
  assert.notEqual(spleeterV1, spleeterV2);
  assert.notEqual(spleeterV1, demucsV1);
  assert.notEqual(spleeterV1, anotherTrack);
  assert.match(spleeterV1, /^[a-f0-9]{40}$/);
  assert.equal(STEM_CACHE_FORMAT_VERSION, 3);
  assert.throws(() => stemCacheKey(fingerprint, "auto", "model-v1"), /Auto is not a cache engine/);
});

test("acepta únicamente un manifiesto completo con ambos stems y duraciones coherentes", () => {
  const fingerprint = "fingerprint-valid";
  const manifest = cacheManifest({ fingerprint });
  const valid = validateStemManifest({
    manifest,
    fingerprint,
    engine: "spleeter",
    modelVersion: STEM_MODEL_VERSIONS.spleeter,
    instrumental: { isFile: true, size: 4096 },
    vocals: { isFile: true, size: 4096 },
    measuredDurations: { instrumental: 180, vocals: 180.2 }
  });

  assert.deepEqual(valid, {
    valid: true,
    reason: "valid",
    durations: { instrumental: 180, vocals: 180.2 }
  });
  assert.equal(validateStemManifest({
    manifest: { ...manifest, complete: false },
    fingerprint,
    engine: "spleeter",
    instrumental: { isFile: true, size: 4096 },
    vocals: { isFile: true, size: 4096 }
  }).reason, "manifest_incomplete");
  assert.equal(validateStemManifest({
    manifest,
    fingerprint,
    engine: "spleeter",
    instrumental: { isFile: true, size: 4096 },
    vocals: { isFile: true, size: 4096 },
    measuredDurations: { instrumental: 180, vocals: 184 }
  }).reason, "duration_invalid");
});

test("inspecciona una entrada íntegra y devuelve rutas del motor bloqueado", async (t) => {
  const cacheRoot = await temporaryDirectory(t, "guest-star-cache-valid-");
  const fingerprint = "valid-track-fingerprint";
  const manifest = cacheManifest({ fingerprint });
  const paths = await writeCacheEntry({ cacheRoot, fingerprint, manifest });

  const inspected = await inspectStemCache({
    cacheRoot,
    fingerprint,
    engine: "spleeter",
    modelVersion: STEM_MODEL_VERSIONS.spleeter,
    probeDuration: async (filePath) => filePath.endsWith("vocals.m4a") ? 180.2 : 180
  });

  assert.equal(inspected.valid, true);
  assert.equal(inspected.reason, "valid");
  assert.equal(inspected.directory, paths.directory);
  assert.equal(inspected.manifest.engine, "spleeter");
  assert.deepEqual(inspected.durations, { instrumental: 180, vocals: 180.2 });
});

test("rechaza cachés parciales, corruptos, demasiado pequeños o de otro modelo", async (t) => {
  const cacheRoot = await temporaryDirectory(t, "guest-star-cache-invalid-");
  const fingerprint = "invalid-track-fingerprint";
  const manifest = cacheManifest({ fingerprint });
  const paths = await writeCacheEntry({ cacheRoot, fingerprint, manifest });
  const inspect = () => inspectStemCache({
    cacheRoot,
    fingerprint,
    engine: "spleeter",
    modelVersion: STEM_MODEL_VERSIONS.spleeter
  });

  await unlink(paths.vocalsPath);
  assert.equal((await inspect()).reason, "cache_entry_missing");

  await writeFile(paths.vocalsPath, Buffer.alloc(4096, 0x56));
  await writeFile(paths.manifestPath, "{not-valid-json", "utf8");
  assert.equal((await inspect()).reason, "manifest_invalid_json");

  const smallManifest = cacheManifest({ fingerprint, vocalsSize: 64 });
  await writeFile(paths.vocalsPath, Buffer.alloc(64, 0x56));
  await writeFile(paths.manifestPath, JSON.stringify(smallManifest), "utf8");
  assert.equal((await inspect()).reason, "vocals_missing_or_small");

  const wrongModelManifest = cacheManifest({ fingerprint, modelVersion: "obsolete-model" });
  await writeFile(paths.vocalsPath, Buffer.alloc(4096, 0x56));
  await writeFile(paths.manifestPath, JSON.stringify(wrongModelManifest), "utf8");
  assert.equal((await inspect()).reason, "model_version_mismatch");
});

test("las rutas de Spleeter y Demucs nunca comparten la misma entrada", async (t) => {
  const cacheRoot = await temporaryDirectory(t, "guest-star-cache-paths-");
  const fingerprint = "same-track";
  const spleeter = stemCachePaths(cacheRoot, fingerprint, "spleeter");
  const demucs = stemCachePaths(cacheRoot, fingerprint, "demucs");

  assert.notEqual(spleeter.cacheKey, demucs.cacheKey);
  assert.notEqual(spleeter.directory, demucs.directory);
  assert.throws(() => stemCachePaths(cacheRoot, fingerprint, "auto"), /Auto has no direct cache entry/);
});
