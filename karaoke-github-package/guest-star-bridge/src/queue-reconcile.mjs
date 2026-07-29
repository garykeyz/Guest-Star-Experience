import { normalizeVdjPath, normalizeVdjSinger } from "./virtualdj.mjs";
import { normalizeText } from "./matcher.mjs";

function editDistance(left, right) {
  const a = [...left];
  const b = [...right];
  const previous = Array.from({ length: b.length + 1 }, (_value, index) => index);
  for (let row = 1; row <= a.length; row++) {
    const current = [row];
    for (let column = 1; column <= b.length; column++) {
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + (a[row - 1] === b[column - 1] ? 0 : 1)
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length];
}

function textSimilarity(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  return longest ? 1 - editDistance(a, b) / longest : 0;
}

function singerKey(value) {
  return normalizeText(normalizeVdjSinger(value));
}

export function queueMetadataMatches(tracked, actual) {
  const songSimilarity = textSimilarity(tracked?.song, actual?.song);
  if (songSimilarity < 0.82) return false;

  const trackedArtist = normalizeText(tracked?.artist);
  const actualArtist = normalizeText(actual?.artist);
  if (!trackedArtist || !actualArtist) return true;
  return textSimilarity(trackedArtist, actualArtist) >= 0.72;
}

export function reconcileTrackedQueue(trackedEntries = [], actualEntries = []) {
  const claimedIndices = new Set();
  const matched = new Map();
  const missing = [];

  for (const tracked of trackedEntries) {
    const id = String(tracked?.id || "");
    const targetPath = normalizeVdjPath(tracked?.filePath);
    const targetSinger = singerKey(tracked?.singer);
    if (!id || !targetSinger) continue;

    const available = actualEntries.filter(
      (entry) => !claimedIndices.has(entry.index)
    );
    const sameSinger = available.filter(
      (entry) => singerKey(entry.singer) === targetSinger
    );
    const samePath = sameSinger.filter(
      (entry) =>
        targetPath &&
        normalizeVdjPath(entry.filePath) === targetPath
    );
    const sameMetadata = sameSinger.filter((entry) =>
      queueMetadataMatches(tracked, entry)
    );
    const selected =
      samePath[0] ||
      sameMetadata[0] ||
      (sameSinger.length === 1 && actualEntries.length === 1
        ? sameSinger[0]
        : null);

    if (!selected) {
      missing.push(id);
      continue;
    }
    claimedIndices.add(selected.index);
    matched.set(id, selected);
  }

  return { matched, missing, claimedIndices };
}
