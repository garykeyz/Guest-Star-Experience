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

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36);
}

export function queueEntryFingerprint(entry = {}) {
  const path = normalizeVdjPath(entry.filePath);
  const singer = singerKey(entry.singer);
  const song = normalizeText(entry.song);
  const artist = normalizeText(entry.artist);
  const duration = Math.max(0, Math.round(Number(entry.durationSeconds) || 0));
  const metadata = [artist, song].filter(Boolean).sort().join("|");
  return [path || metadata, singer, duration].join("|");
}

export function stabilizeVirtualDjEntries(actualEntries = [], previousEntries = []) {
  const previousPools = new Map();
  for (const previous of previousEntries) {
    const fingerprint = queueEntryFingerprint(previous);
    if (!previousPools.has(fingerprint)) previousPools.set(fingerprint, []);
    previousPools.get(fingerprint).push(previous);
  }
  const occurrence = new Map();
  return actualEntries.map((entry, sourceIndex) => {
    const fingerprint = queueEntryFingerprint(entry);
    const pool = previousPools.get(fingerprint) || [];
    let previous = null;
    if (pool.length) {
      pool.sort(
        (left, right) =>
          Math.abs(Number(left.index) - Number(entry.index)) -
          Math.abs(Number(right.index) - Number(entry.index))
      );
      previous = pool.shift();
    }
    const sequence = (occurrence.get(fingerprint) || 0) + 1;
    occurrence.set(fingerprint, sequence);
    return {
      ...entry,
      index: Number.isInteger(entry.index) ? entry.index : sourceIndex,
      fingerprint,
      virtualDJItemId:
        String(entry.virtualDJItemId || previous?.virtualDJItemId || "") ||
        `vdj-${hashText(fingerprint)}-${sequence}`
    };
  });
}

export function queueMetadataMatchDetails(tracked, actual) {
  const trackedSong = normalizeText(tracked?.song);
  const actualSong = normalizeText(actual?.song);
  const trackedArtist = normalizeText(tracked?.artist);
  const actualArtist = normalizeText(actual?.artist);
  const directSong = textSimilarity(trackedSong, actualSong);
  const directArtist = !trackedArtist || !actualArtist
    ? 1
    : textSimilarity(trackedArtist, actualArtist);
  if (directSong >= 0.82 && directArtist >= 0.72) {
    return { matches: true, reversed: false };
  }
  if (!trackedSong || !actualSong || !trackedArtist || !actualArtist) {
    return { matches: false, reversed: false };
  }
  const reversedSong = textSimilarity(trackedSong, actualArtist);
  const reversedArtist = textSimilarity(trackedArtist, actualSong);
  return {
    matches: reversedSong >= 0.82 && reversedArtist >= 0.72,
    reversed: reversedSong >= 0.82 && reversedArtist >= 0.72
  };
}

export function queueMetadataMatches(tracked, actual) {
  return queueMetadataMatchDetails(tracked, actual).matches;
}

function candidateMatch(
  tracked,
  actual,
  actualSingerPopulation,
  trackedSingerPopulation
) {
  const fields = [];
  const manualLink = tracked?.manualLink === true;
  const linkedId = String(tracked?.virtualDJItemId || "");
  const actualId = String(actual?.virtualDJItemId || "");
  const targetSinger = singerKey(tracked?.expectedSinger || tracked?.singer);
  const actualSinger = singerKey(actual?.singer);
  const sameSinger = Boolean(targetSinger && actualSinger && targetSinger === actualSinger);
  if (sameSinger) fields.push("singer");

  // An explicit Bridge insertion/replacement owns its stable physical row.
  // Inferred links never get this exception: a different singer means a
  // different performance, even when the song, path or duration is identical.
  if (manualLink && linkedId && actualId && linkedId === actualId) {
    return { confidence: 1, fields: ["manualVirtualDJItemId"] };
  }
  if (actual?.knownExternal === true) {
    return { confidence: 0, fields: ["knownExternal"] };
  }
  if (linkedId && actualId && linkedId === actualId && sameSinger) {
    return { confidence: 0.995, fields: ["virtualDJItemId", "singer"] };
  }

  const targetPath = normalizeVdjPath(tracked?.filePath);
  const actualPath = normalizeVdjPath(actual?.filePath);
  const samePath = Boolean(targetPath && actualPath && targetPath === actualPath);
  if (samePath) fields.push("filePath");

  const metadata = queueMetadataMatchDetails(tracked, actual);
  const sameMetadata = metadata.matches;
  if (sameMetadata) fields.push(metadata.reversed ? "metadataReversed" : "metadata");

  const trackedDuration = Math.max(0, Number(tracked?.durationSeconds) || 0);
  const actualDuration = Math.max(0, Number(actual?.durationSeconds) || 0);
  const sameDuration =
    trackedDuration > 0 && actualDuration > 0 &&
    Math.abs(trackedDuration - actualDuration) <= 3;
  if (sameDuration) fields.push("duration");

  if (!sameSinger) return { confidence: 0, fields };

  if (samePath && sameSinger) return { confidence: 0.99, fields };
  if (sameSinger && sameMetadata && sameDuration) {
    return { confidence: 0.96, fields };
  }
  if (sameSinger && sameMetadata) return { confidence: 0.91, fields };
  if (
    manualLink && sameDuration &&
    actualSingerPopulation === 1 && trackedSingerPopulation === 1
  ) {
    return { confidence: 0.88, fields: [...fields, "uniqueSingerDuration"] };
  }
  if (
    manualLink && linkedId &&
    actualSingerPopulation === 1 && trackedSingerPopulation === 1
  ) {
    return { confidence: 0.83, fields: [...fields, "preservedSingerLink"] };
  }
  return { confidence: 0, fields };
}

export function reconcileTrackedQueue(trackedEntries = [], actualEntries = []) {
  const stableActual = actualEntries.every((entry) => entry.virtualDJItemId)
    ? actualEntries
    : stabilizeVirtualDjEntries(actualEntries);
  const claimedIndices = new Set();
  const matched = new Map();
  const matchDetails = new Map();
  const missing = [];

  for (const tracked of trackedEntries) {
    const id = String(tracked?.id || "");
    if (!id) continue;
    const targetSinger = singerKey(tracked?.expectedSinger || tracked?.singer);
    const actualSingerPopulation = stableActual.filter(
      (entry) => targetSinger && singerKey(entry?.singer) === targetSinger
    ).length;
    const trackedSingerPopulation = trackedEntries.filter(
      (entry) => targetSinger && singerKey(entry?.singer) === targetSinger
    ).length;
    const candidates = stableActual
      .filter((entry) => !claimedIndices.has(entry.index))
      .map((entry) => ({
        entry,
        ...candidateMatch(
          tracked,
          entry,
          actualSingerPopulation,
          trackedSingerPopulation
        )
      }))
      .filter((candidate) => candidate.confidence >= 0.82)
      .sort((left, right) =>
        right.confidence - left.confidence ||
        Math.abs(Number(left.entry.index) - Number(tracked.queuePosition)) -
          Math.abs(Number(right.entry.index) - Number(tracked.queuePosition))
      );

    const selected = candidates[0] || null;
    if (!selected) {
      missing.push(id);
      continue;
    }
    claimedIndices.add(selected.entry.index);
    matched.set(id, selected.entry);
    matchDetails.set(id, {
      confidence: selected.confidence,
      fields: selected.fields
    });
  }

  const unmatched = stableActual.filter(
    (entry) => !claimedIndices.has(entry.index)
  );
  return { matched, matchDetails, missing, unmatched, claimedIndices };
}
