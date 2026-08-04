import { readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";

export const MEDIA_EXTENSIONS = new Set([
  ".mp3", ".mp4", ".m4a", ".m4v", ".mov", ".avi", ".mkv", ".wav", ".flac",
  ".aac", ".ogg", ".webm", ".cdg", ".zip"
]);

const NOISE_WORDS = new Set([
  "karaoke", "lyrics", "lyric", "instrumental", "official", "video", "audio",
  "version", "versión", "hd", "hq", "4k", "sing", "along", "track", "pista"
]);

export function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function tokens(value, { removeNoise = true } = {}) {
  const list = normalizeText(value).split(/\s+/).filter((item) => item.length > 1);
  return [...new Set(removeNoise ? list.filter((item) => !NOISE_WORDS.has(item)) : list)];
}

function coverage(needles, haystack) {
  if (!needles.length) return 0;
  const source = new Set(haystack);
  return needles.filter((item) => source.has(item)).length / needles.length;
}

function fileLabel(path) {
  const extension = extname(path);
  return basename(path, extension)
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\([^)]*(karaoke|lyrics?|instrumental|official|video|audio|hd|4k)[^)]*\)/gi, " ")
    .replace(/[_–—]+/g, " ");
}

export function scoreFile(filePath, song, artist) {
  const label = fileLabel(filePath);
  const labelTokens = tokens(label);
  const titleTokens = tokens(song);
  const artistTokens = tokens(artist);
  const combinedTokens = [...new Set([...titleTokens, ...artistTokens])];
  const titleCoverage = coverage(titleTokens, labelTokens);
  const artistCoverage = artistTokens.length ? coverage(artistTokens, labelTokens) : 1;
  const combinedCoverage = coverage(combinedTokens, labelTokens);
  const titlePhrase = normalizeText(label).includes(normalizeText(song)) ? 1 : 0;
  const score =
    titleCoverage * 0.5 +
    artistCoverage * 0.25 +
    combinedCoverage * 0.15 +
    titlePhrase * 0.1;
  return {
    filePath,
    fileName: basename(filePath),
    score: Math.round(Math.min(1, score) * 1000) / 1000,
    titleCoverage: Math.round(titleCoverage * 1000) / 1000,
    artistCoverage: Math.round(artistCoverage * 1000) / 1000,
    exact: score >= 0.78 && titleCoverage >= 0.7 && artistCoverage >= 0.5
  };
}

export function findMatches(files, song, artist, limit = 3) {
  return files
    .map((path) => scoreFile(path, song, artist))
    .filter((item) => item.score >= 0.28)
    .sort((a, b) => b.score - a.score || a.fileName.localeCompare(b.fileName))
    .slice(0, limit);
}

async function walk(folder, output, seen) {
  let info;
  try {
    info = await stat(folder);
  } catch {
    throw new Error(`No se pudo revisar la carpeta de karaoke: ${folder}`);
  }
  if (!info.isDirectory()) return;
  let realKey = `${info.dev}:${info.ino}`;
  if (seen.has(realKey)) return;
  seen.add(realKey);
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch {
    throw new Error(`No se pudo leer la carpeta de karaoke: ${folder}`);
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = join(folder, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, output, seen);
    } else if (entry.isFile() && MEDIA_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
      output.push(fullPath);
    }
  }
}

export async function scanLibrary(folders) {
  const files = [];
  const seen = new Set();
  for (const folder of folders) {
    let info;
    try {
      info = await stat(folder);
    } catch {
      throw new Error(`La carpeta de karaoke no está disponible: ${folder}`);
    }
    if (!info.isDirectory()) {
      throw new Error(`La ruta de karaoke ya no es una carpeta: ${folder}`);
    }
    await walk(folder, files, seen);
  }
  return [...new Set(files)].sort((a, b) => a.localeCompare(b));
}
