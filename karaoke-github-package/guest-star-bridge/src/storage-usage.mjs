import { opendir, lstat, realpath, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir, tmpdir } from "node:os";
import { basename, resolve } from "node:path";

const STEM_CACHE_DIRECTORY = ".guest-star-stems";
const NATIVE_AUDIO_DIRECTORY = "GuestStarNativeAudio";
const execFileAsync = promisify(execFile);

function displayPath(filePath, home = homedir()) {
  const normalizedHome = resolve(home);
  const normalizedPath = resolve(filePath);
  return normalizedPath === normalizedHome
    ? "~"
    : normalizedPath.startsWith(`${normalizedHome}/`)
      ? `~${normalizedPath.slice(normalizedHome.length)}`
      : normalizedPath;
}

export async function songStorageLocations({ libraryFolders = [], temporaryRoot = tmpdir(), home = homedir() } = {}) {
  const folders = [...new Set(await Promise.all(
    (Array.isArray(libraryFolders) ? libraryFolders : [])
      .map((folder) => String(folder || "").trim())
      .filter(Boolean)
      .map(async (folder) => realpath(resolve(folder)).catch(() => resolve(folder)))
  ))];
  const locations = folders.map((folder) => {
    const path = resolve(folder, STEM_CACHE_DIRECTORY);
    return {
      id: `stems:${createHash("sha256").update(path).digest("hex").slice(0, 24)}`,
      kind: "stems",
      path,
      displayPath: displayPath(path, home),
      fallbackPath: folder,
      libraryName: basename(folder) || folder,
      persistence: "persistent",
      regenerable: true
    };
  });
  const temporaryParent = resolve(temporaryRoot);
  const temporaryPath = resolve(temporaryParent, NATIVE_AUDIO_DIRECTORY);
  locations.push({
    id: "native-audio",
    kind: "native-audio",
    path: temporaryPath,
    displayPath: displayPath(temporaryPath, home),
    fallbackPath: temporaryParent,
    libraryName: "",
    persistence: "temporary",
    regenerable: true
  });
  return locations;
}

export async function directoryUsage(rootPath, { kind = "" } = {}) {
  const root = resolve(rootPath);
  let bytes = 0;
  let files = 0;
  let directories = 0;
  const breakdown = {
    gsx: { bytes: 0, files: 0 },
    legacy: { bytes: 0, files: 0 },
    temporary: { bytes: 0, files: 0 },
    other: { bytes: 0, files: 0 }
  };
  const pending = [root];
  try {
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
      return { exists: false, bytes: 0, files: 0, directories: 0 };
    }
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return { exists: false, bytes: 0, files: 0, directories: 0 };
    }
    throw error;
  }

  while (pending.length) {
    const directory = pending.pop();
    let handle;
    try {
      const directoryInfo = await lstat(directory);
      if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink()) continue;
      directories += 1;
      handle = await opendir(directory);
      for await (const entry of handle) {
        const entryPath = resolve(directory, entry.name);
        let info;
        try {
          info = await lstat(entryPath);
        } catch (error) {
          if (error?.code === "ENOENT") continue;
          throw error;
        }
        if (info.isSymbolicLink()) continue;
        if (info.isDirectory()) pending.push(entryPath);
        else if (info.isFile()) {
          if (kind === "native-audio" && !entry.name.startsWith("karaoke-")) continue;
          bytes += Math.max(0, Number(info.size) || 0);
          files += 1;
          if (kind === "stems") {
            const relative = entryPath.slice(root.length + 1);
            const category = entry.name.endsWith(".tmp.gsxstems") || entry.name.endsWith(".lock") ||
              relative.split("/").some((part) => part.startsWith(".work-"))
              ? "temporary"
              : entry.name.endsWith(".gsxstems")
                ? "gsx"
                : entry.name.endsWith(".m4a") || entry.name === "manifest.json"
                  ? "legacy"
                  : "other";
            breakdown[category].bytes += Math.max(0, Number(info.size) || 0);
            breakdown[category].files += 1;
          }
        }
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    } finally {
      if (handle && !handle.closed) await handle.close().catch(() => {});
    }
  }
  return { exists: true, bytes, files, directories, ...(kind === "stems" ? { breakdown } : {}) };
}

export async function inspectSongStorage(options = {}) {
  const locations = await songStorageLocations(options);
  const inspected = [];
  for (const location of locations) {
    try {
      inspected.push({ ...location, ...await directoryUsage(location.path, { kind: location.kind }) });
    } catch (error) {
      inspected.push({ ...location, bytes: null, files: null, error: error.code || "STORAGE_UNAVAILABLE" });
    }
  }
  return {
    scannedAt: new Date().toISOString(),
    totalBytes: inspected.reduce((total, location) => total + location.bytes, 0),
    complete: inspected.every((location) => !location.error),
    locations: inspected
  };
}

export async function songStorageLocationById(id, options = {}) {
  return (await songStorageLocations(options)).find((location) => location.id === String(id || "")) || null;
}

export async function revealSongStorageLocation(id, options = {}) {
  if ((options.platform || process.platform) !== "darwin") {
    throw new Error("Mostrar en Finder solo está disponible en macOS.");
  }
  const location = await songStorageLocationById(id, options);
  if (!location) throw new Error("La ubicación de almacenamiento ya no está disponible.");
  let target = location.path;
  let exact = true;
  try {
    const info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink()) throw Object.assign(new Error("Not a safe directory."), { code: "ENOENT" });
  } catch (error) {
    if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR") throw error;
    target = location.fallbackPath;
    exact = false;
    const fallbackInfo = await stat(target);
    if (!fallbackInfo.isDirectory()) throw new Error("La carpeta contenedora ya no está disponible.");
  }
  await (options.openDirectory || execFileAsync)("/usr/bin/open", ["-a", "Finder", target]);
  return { ok: true, exact, path: target, requestedPath: location.path };
}
