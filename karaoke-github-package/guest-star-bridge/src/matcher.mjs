import { readdir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { languagePathEvidence, normalizeLanguage } from "./language.mjs";

export const MEDIA_EXTENSIONS = new Set([
  ".mp3", ".mp4", ".m4a", ".m4v", ".mov", ".avi", ".mkv", ".wav", ".flac",
  ".aac", ".ogg", ".webm", ".cdg", ".zip"
]);

export const MATCH_THRESHOLDS = Object.freeze({
  candidate: 0.3,
  medium: 0.62,
  high: 0.8,
  veryHigh: 0.92,
  exact: 0.86,
  autoLink: 0.94,
  autoLinkMargin: 0.08
});

const NOISE_WORDS = new Set([
  "karaoke", "lyrics", "lyric", "instrumental", "official", "video", "audio",
  "version", "versión", "hd", "hq", "4k", "sing", "along", "track", "pista",
  "remaster", "remastered", "original"
]);
const VERSION_WORDS = new Set([
  "karaoke", "lyrics", "lyric", "instrumental", "acoustic", "live", "remix",
  "cover", "duet", "solo", "clean", "explicit", "vocal", "vocals"
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

function rounded(value) {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
}

function rawFileLabel(path) {
  return basename(path, extname(path))
    .replace(/\[[^\]]*]/g, " ")
    .replace(/\([^)]*(karaoke|lyrics?|instrumental|official|video|audio|hd|4k)[^)]*\)/gi, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function labelParts(path) {
  return rawFileLabel(path)
    .split(/\s+(?:-|–|—)\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function confidenceTier(score) {
  if (score >= MATCH_THRESHOLDS.veryHigh) return "very-high";
  if (score >= MATCH_THRESHOLDS.high) return "high";
  if (score >= MATCH_THRESHOLDS.medium) return "medium";
  return "low";
}

function durationEvidence(localSeconds, referenceSeconds) {
  const local = Number(localSeconds);
  const reference = Number(referenceSeconds);
  if (!(local > 0) || !(reference > 0)) return { available: false, score: 0, difference: null };
  const difference = Math.abs(local - reference);
  const tolerance = Math.max(8, reference * 0.04);
  if (difference <= tolerance) return { available: true, score: 1, difference };
  if (difference <= tolerance * 2.5) return { available: true, score: 0.5, difference };
  return { available: true, score: -1, difference };
}

function youtubeEvidence(filePath, song, artist, youtubeResults = []) {
  const labelTokens = tokens(rawFileLabel(filePath));
  let best = 0;
  let title = "";
  for (const result of Array.isArray(youtubeResults) ? youtubeResults : []) {
    const resultTitle = String(result?.title || "");
    const requestCoverage = coverage(
      [...new Set([...tokens(song), ...tokens(artist)])],
      tokens(resultTitle)
    );
    if (requestCoverage < 0.7) continue;
    const related = coverage(labelTokens, tokens(resultTitle));
    const score = Math.min(requestCoverage, related);
    if (score > best) {
      best = score;
      title = resultTitle;
    }
  }
  return { score: best, title };
}

export function scoreFile(file, song, artist, language = "", context = {}) {
  const filePath = typeof file === "string" ? file : String(file?.filePath || file?.path || "");
  const metadata = typeof file === "object" && file ? file : {};
  const label = rawFileLabel(filePath);
  const parts = labelParts(filePath);
  const labelTokens = tokens(label);
  const titleTokens = tokens(song);
  const artistTokens = tokens(artist);
  const combinedTokens = [...new Set([...titleTokens, ...artistTokens])];
  const titleCoverage = coverage(titleTokens, labelTokens);
  const artistCoverage = artistTokens.length ? coverage(artistTokens, labelTokens) : 1;
  const combinedCoverage = coverage(combinedTokens, labelTokens);
  const normalizedSong = normalizeText(song);
  const titlePhrase = normalizedSong && normalizeText(label).includes(normalizedSong) ? 1 : 0;
  const segmentTokens = parts.map((part) => tokens(part));
  const titleSegment = segmentTokens.length
    ? Math.max(...segmentTokens.map((part) => coverage(titleTokens, part)))
    : titleCoverage;
  const artistSegment = artistTokens.length && segmentTokens.length
    ? Math.max(...segmentTokens.map((part) => coverage(artistTokens, part)))
    : artistCoverage;
  const direct = parts.length >= 2
    ? coverage(artistTokens, segmentTokens[0]) * 0.38 + coverage(titleTokens, segmentTokens.slice(1).flat()) * 0.62
    : 0;
  const reversed = parts.length >= 2
    ? coverage(titleTokens, segmentTokens[0]) * 0.62 + coverage(artistTokens, segmentTokens.slice(1).flat()) * 0.38
    : 0;
  const structureScore = artistTokens.length ? Math.max(direct, reversed) : titleSegment;
  const artistConflict = artistTokens.length > 0 && artistCoverage < 0.34 &&
    parts.length >= 2 && tokens(parts[0]).length > 0;
  const titleConflict = titleCoverage < 0.5;
  const labelVersionTokens = tokens(label, { removeNoise: false }).filter((token) => VERSION_WORDS.has(token));
  const requestedVersionTokens = tokens(`${song} ${artist}`, { removeNoise: false }).filter((token) => VERSION_WORDS.has(token));
  const alternateVersion = labelVersionTokens.some((token) =>
    ["acoustic", "live", "remix", "cover", "duet", "solo", "vocal", "vocals"].includes(token)
  );
  const versionConflict = requestedVersionTokens.length > 0
    ? coverage(requestedVersionTokens, labelVersionTokens) < 0.5
    : alternateVersion;
  const versionScore = requestedVersionTokens.length
    ? coverage(requestedVersionTokens, labelVersionTokens)
    : labelVersionTokens.includes("karaoke") || labelVersionTokens.includes("instrumental") ? 1 : 0.5;

  let baseScore;
  if (artistTokens.length) {
    baseScore =
      Math.max(titleCoverage, titleSegment, titlePhrase) * 0.5 +
      Math.max(artistCoverage, artistSegment) * 0.29 +
      combinedCoverage * 0.08 +
      structureScore * 0.09 +
      versionScore * 0.04;
  } else {
    baseScore =
      Math.max(titleCoverage, titleSegment, titlePhrase) * 0.78 +
      combinedCoverage * 0.14 +
      versionScore * 0.08;
  }

  const languageEvidence = languagePathEvidence(filePath, language);
  const languageAdjustment = languageEvidence.match ? 0.04 : languageEvidence.conflict ? -0.06 : 0;
  const youtube = youtubeEvidence(filePath, song, artist, context.youtubeResults);
  const youtubeAdjustment = youtube.score >= 0.8 ? 0.06 * youtube.score : 0;
  const duration = durationEvidence(
    metadata.durationSeconds,
    context.durationSeconds || context.youtubeResults?.find((item) => Number(item?.durationSeconds) > 0)?.durationSeconds
  );
  const durationAdjustment = duration.score > 0 ? 0.04 * duration.score : duration.score < 0 ? -0.08 : 0;
  const conflictPenalty = (artistConflict ? 0.3 : 0) + (titleConflict ? 0.16 : 0) + (versionConflict ? 0.08 : 0);
  let score = baseScore + languageAdjustment + youtubeAdjustment + durationAdjustment - conflictPenalty;
  if (artistConflict) score = Math.min(score, 0.58);
  if (titleConflict) score = Math.min(score, 0.6);
  score = rounded(score);

  const reasons = [];
  if (titleCoverage >= 0.8) reasons.push("title");
  if (artistTokens.length && artistCoverage >= 0.65) reasons.push("artist");
  if (languageEvidence.match) reasons.push("language");
  if (youtubeAdjustment) reasons.push("youtube");
  if (duration.score > 0) reasons.push("duration");
  if (artistConflict) reasons.push("artist-conflict");
  if (versionConflict) reasons.push("version-conflict");

  const exact = score >= MATCH_THRESHOLDS.exact &&
    titleCoverage >= 0.7 && artistCoverage >= 0.6 &&
    !artistConflict && !titleConflict && !versionConflict;
  return {
    filePath,
    fileName: basename(filePath),
    score,
    confidence: score,
    confidencePercent: Math.round(score * 100),
    confidenceTier: confidenceTier(score),
    reasons,
    titleCoverage: rounded(titleCoverage),
    artistCoverage: rounded(artistCoverage),
    baseScore: rounded(baseScore),
    artistConflict,
    titleConflict,
    versionConflict,
    languageCode: normalizeLanguage(language),
    languageMatch: languageEvidence.match,
    languageConflict: languageEvidence.conflict,
    languageDetected: languageEvidence.detected,
    youtubeCorroborated: youtubeAdjustment > 0,
    youtubeTitle: youtube.title,
    durationCompared: duration.available,
    durationDifferenceSeconds: duration.difference === null ? null : Math.round(duration.difference),
    exact,
    autoLinkEligible: false,
    ambiguous: false,
    margin: 0
  };
}

export function findMatches(files, song, artist, languageOrLimit = "", requestedLimit = 3, requestedContext = {}) {
  const legacyLimit = typeof languageOrLimit === "number";
  const language = legacyLimit ? "" : languageOrLimit;
  const limit = legacyLimit ? languageOrLimit : requestedLimit;
  const context = typeof requestedLimit === "object" ? requestedLimit : requestedContext;
  const resolvedLimit = typeof requestedLimit === "object" ? 3 : limit;
  const matches = files
    .map((file) => scoreFile(file, song, artist, language, context))
    .filter((item) => item.score >= MATCH_THRESHOLDS.candidate)
    .sort((a, b) =>
      Number(b.exact) - Number(a.exact) ||
      Number(b.languageMatch) - Number(a.languageMatch) ||
      Number(a.languageConflict) - Number(b.languageConflict) ||
      b.score - a.score ||
      a.fileName.localeCompare(b.fileName)
    );
  if (matches.length) {
    const margin = rounded(matches[0].score - (matches[1]?.score || 0));
    matches[0].margin = margin;
    matches[0].ambiguous = Boolean(matches[1]) && margin < MATCH_THRESHOLDS.autoLinkMargin;
    matches[0].autoLinkEligible = matches[0].score >= MATCH_THRESHOLDS.autoLink &&
      margin >= MATCH_THRESHOLDS.autoLinkMargin && matches[0].exact && !matches[0].ambiguous;
  }
  return matches.slice(0, resolvedLimit);
}

async function walk(folder, output, seen) {
  let info;
  try { info = await stat(folder); }
  catch { throw new Error(`The karaoke folder could not be checked: ${folder}`); }
  if (!info.isDirectory()) return;
  const realKey = `${info.dev}:${info.ino}`;
  if (seen.has(realKey)) return;
  seen.add(realKey);
  let entries;
  try { entries = await readdir(folder, { withFileTypes: true }); }
  catch { throw new Error(`The karaoke folder could not be read: ${folder}`); }
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const fullPath = join(folder, entry.name);
    if (entry.isDirectory()) await walk(fullPath, output, seen);
    else if (entry.isFile() && MEDIA_EXTENSIONS.has(extname(entry.name).toLowerCase())) output.push(fullPath);
  }
}

export async function scanLibrary(folders) {
  const files = [];
  const seen = new Set();
  for (const folder of folders) {
    let info;
    try { info = await stat(folder); }
    catch { throw new Error(`The karaoke folder is not available: ${folder}`); }
    if (!info.isDirectory()) throw new Error(`The karaoke path is no longer a folder: ${folder}`);
    await walk(folder, files, seen);
  }
  return [...new Set(files)].sort((a, b) => a.localeCompare(b));
}
