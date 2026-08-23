function safeVdjValue(value) {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/"/g, "'")
    .trim();
}

export function buildKaraokeScript(filePath, singer) {
  const safePath = safeVdjValue(filePath);
  const safeSinger = safeVdjValue(singer);
  if (!safePath || !safeSinger) throw new Error("Faltan el archivo o el nombre del cantante.");
  return [
    `karaoke_add "${safePath}"`,
    'browser_window "karaoke"',
    'browser_scroll "bottom"',
    `browsed_song "singer" "${safeSinger}"`
  ].join(" & ");
}

export function buildKaraokeInsertScript(
  filePath,
  singer,
  targetIndex,
  currentCount
) {
  const count = Math.max(0, Math.floor(Number(currentCount) || 0));
  const desired = Math.min(
    count,
    Math.max(0, Math.floor(Number(targetIndex) || 0))
  );
  const steps = [buildKaraokeScript(filePath, singer)];
  for (let position = count; position > desired; position--) {
    steps.push("browser_move -1");
  }
  return steps.join(" & ");
}

function normalizedQueryValue(value) {
  const text = String(value || "").trim();
  const unquoted =
    text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text;
  return /^(?:false|null|undefined)$/i.test(unquoted) ? "" : unquoted;
}

export function isVirtualDjTechnicalError(value) {
  return /^error\s*:\s*-?\d+$/i.test(normalizedQueryValue(value));
}

function assertReadableQueueValue(value, property, index = -1) {
  if (!isVirtualDjTechnicalError(value)) return;
  const position = index >= 0 ? ` at queue position ${index + 1}` : "";
  throw new Error(
    `VirtualDJ returned a technical Network Control error while reading ${property}${position}. ` +
    "The previous valid queue was preserved; restart Network Control or VirtualDJ and synchronize again."
  );
}

export function normalizeVdjPath(value) {
  return normalizedQueryValue(value).replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
}

export function normalizeVdjSinger(value) {
  return normalizedQueryValue(value).replace(/\s+/g, " ").trim().toLowerCase();
}

export function parseVdjDuration(value) {
  const text = normalizedQueryValue(value)
    .replace(/\s*(?:ms|milliseconds?)$/i, "")
    .trim();
  if (!text) return 0;

  const clock = text.match(
    /^(?:(\d+):)?([0-5]?\d):([0-5]\d)(?:[.,]\d+)?$/
  );
  if (clock) {
    return (
      Number(clock[1] || 0) * 3600 +
      Number(clock[2] || 0) * 60 +
      Number(clock[3] || 0)
    );
  }

  const numeric = Number(text.replace(",", "."));
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  const seconds = numeric > 43200 ? numeric / 1000 : numeric;
  return seconds > 0 && seconds <= 43200 ? Math.round(seconds) : 0;
}

function normalizeVdjMetadata(value) {
  return normalizedQueryValue(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function metadataContains(left, right) {
  return Boolean(
    left &&
    right &&
    (left === right || left.includes(right) || right.includes(left))
  );
}

function sameMetadataPair(candidate, target) {
  const candidateSong = normalizeVdjMetadata(candidate?.song);
  const targetSong = normalizeVdjMetadata(target?.song);
  const candidateArtist = normalizeVdjMetadata(candidate?.artist);
  const targetArtist = normalizeVdjMetadata(target?.artist);
  if (!candidateSong || !targetSong) return false;
  const direct = candidateSong === targetSong && (
    !candidateArtist || !targetArtist || metadataContains(candidateArtist, targetArtist)
  );
  const reversed = Boolean(
    candidateArtist &&
    targetArtist &&
    metadataContains(candidateSong, targetArtist) &&
    metadataContains(candidateArtist, targetSong)
  );
  return direct || reversed;
}

export function karaokeIdentityKey(entry) {
  const singer = normalizeVdjSinger(entry?.singer);
  const path = normalizeVdjPath(entry?.filePath);
  const metadata = [
    normalizeVdjMetadata(entry?.song),
    normalizeVdjMetadata(entry?.artist)
  ].filter(Boolean).sort().join("|");
  return singer && (path || metadata) ? `${singer}|${path || metadata}` : "";
}

export function duplicateKaraokeIndices(entries = []) {
  const firstByIdentity = new Map();
  const duplicates = [];
  entries.forEach((entry, sourceIndex) => {
    const key = karaokeIdentityKey(entry);
    if (!key) return;
    const index = Number.isInteger(entry?.index) ? entry.index : sourceIndex;
    if (firstByIdentity.has(key)) duplicates.push(index);
    else firstByIdentity.set(key, index);
  });
  return duplicates.sort((left, right) => right - left);
}

export function sameKaraokeIdentity(candidate, target) {
  const sameSinger =
    normalizeVdjSinger(candidate?.singer) === normalizeVdjSinger(target?.singer);
  if (!sameSinger) return false;
  const candidatePath = normalizeVdjPath(candidate?.filePath);
  const targetPath = normalizeVdjPath(target?.filePath);
  if (candidatePath && targetPath) return candidatePath === targetPath;

  return sameMetadataPair(candidate, target);
}

export function buildKaraokeRemoveScript(index) {
  const safeIndex = Math.max(0, Math.floor(Number(index) || 0));
  const steps = ['browser_window "karaoke"', 'browser_scroll "top"'];
  for (let position = 0; position < safeIndex; position++) {
    steps.push("browser_scroll +1");
  }
  steps.push("browser_remove");
  return steps.join(" & ");
}

function networkUrl(config, endpoint) {
  const host = config.host || "127.0.0.1";
  const port = Number(config.port) || 80;
  return `http://${host}:${port}/${endpoint}`;
}

async function request(config, endpoint, script) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(config.timeoutMs) || 3500);
  try {
    const headers = { "Content-Type": "text/plain; charset=utf-8" };
    if (config.password) headers.Authorization = `Bearer ${config.password}`;
    const response = await fetch(networkUrl(config, endpoint), {
      method: "POST",
      headers,
      body: script,
      signal: controller.signal
    });
    const text = (await response.text()).trim();
    if (!response.ok) {
      throw new Error(`VirtualDJ returned ${response.status}: ${text || "no details"}`);
    }
    return text;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("VirtualDJ did not respond in time. Check Network Control and the port.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function executeVdj(config, script) {
  const result = await request(config, "execute", script);
  if (result.toLowerCase() === "false") {
    throw new Error("VirtualDJ rejected the command.");
  }
  return result;
}

export async function queryVdj(config, script) {
  return request(config, "query", script);
}

function karaokeSongQuery(property, index) {
  const position = index > 0 ? ` ${index}` : "";
  return `get_next_karaoke_song "${property}"${position}`;
}

export async function listKaraokeEntries(config) {
  const countResponse = await queryVdj(config, "file_count karaoke");
  assertReadableQueueValue(countResponse, "the Karaoke queue size");
  const rawCount = normalizedQueryValue(countResponse);
  if (!/^\d+$/.test(rawCount)) {
    throw new Error(
      "VirtualDJ did not return the Karaoke queue size. Check that Network Control is up to date."
    );
  }
  const count = Math.min(500, Number.parseInt(rawCount, 10));
  const entries = [];

  for (let index = 0; index < count; index++) {
    const [filePath, singer, song, artist, length] = await Promise.all([
      queryVdj(config, karaokeSongQuery("filepath", index)),
      queryVdj(config, karaokeSongQuery("singer", index)),
      queryVdj(config, karaokeSongQuery("title", index)),
      queryVdj(config, karaokeSongQuery("artist", index)),
      queryVdj(config, karaokeSongQuery("length", index))
    ]);
    [
      [filePath, "file path"],
      [singer, "singer"],
      [song, "title"],
      [artist, "artist"],
      [length, "duration"]
    ].forEach(([value, property]) =>
      assertReadableQueueValue(value, property, index)
    );
    const entry = {
      index,
      filePath: normalizedQueryValue(filePath),
      singer: normalizedQueryValue(singer),
      song: normalizedQueryValue(song),
      artist: normalizedQueryValue(artist),
      durationSeconds: parseVdjDuration(length)
    };
    if (!entry.filePath && !entry.singer && !entry.song && !entry.artist) {
      throw new Error(
        `VirtualDJ reported ${count} songs but did not allow queue position ${index + 1} to be read.`
      );
    }
    entries.push(entry);
  }

  return entries;
}

export async function removeDuplicateKaraokeEntries(config, suppliedEntries = null) {
  const before = Array.isArray(suppliedEntries)
    ? suppliedEntries
    : await listKaraokeEntries(config);
  const duplicateIndices = duplicateKaraokeIndices(before);
  if (!duplicateIndices.length) {
    return { entries: before, removedCount: 0, verified: true };
  }
  for (const index of duplicateIndices) {
    await executeVdj(config, buildKaraokeRemoveScript(index));
  }
  const after = await listKaraokeEntries(config);
  if (duplicateKaraokeIndices(after).length) {
    throw new Error("VirtualDJ still contains repeated copies after duplicate cleanup.");
  }
  return {
    entries: after,
    removedCount: before.length - after.length,
    verified: true
  };
}

export async function insertKaraokeEntry(
  config,
  entry,
  targetIndex,
  options = {}
) {
  const filePath = normalizedQueryValue(entry?.filePath);
  const singer = normalizedQueryValue(entry?.singer);
  if (!filePath || !singer) {
    throw new Error("The file or singer is missing, so the song cannot be restored.");
  }

  const before = await listKaraokeEntries(config);
  const existing = before.find((candidate) =>
    sameKaraokeIdentity(candidate, entry)
  );
  if (existing) {
    return {
      inserted: false,
      alreadyQueued: true,
      index: existing.index,
      verified: true,
      entry: existing
    };
  }

  const desired = Math.min(
    before.length,
    Math.max(0, Math.floor(Number(targetIndex) || 0))
  );
  await executeVdj(
    config,
    buildKaraokeInsertScript(filePath, singer, desired, before.length)
  );
  const attempts = Math.max(1, Math.min(6, Number(options.attempts) || 3));
  const retryDelayMs = Math.max(
    0,
    Math.min(2000, Number(options.retryDelayMs) || 150)
  );
  let after = [];
  let restored = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    after = await listKaraokeEntries(config);
    restored = after.find((candidate) =>
      sameKaraokeIdentity(candidate, entry)
    );
    if (restored) break;
    if (attempt + 1 < attempts && retryDelayMs > 0) {
      await new Promise((resolveDelay) => setTimeout(resolveDelay, retryDelayMs));
    }
  }
  if (!restored) {
    throw new Error(
      "VirtualDJ received the command but did not confirm the restored song."
    );
  }
  if (restored.index !== desired) {
    throw new Error(
      `VirtualDJ added the song at position ${restored.index + 1} instead of ${desired + 1}.`
    );
  }
  return {
    inserted: true,
    alreadyQueued: false,
    index: restored.index,
    verified: true,
    entry: restored
  };
}

export async function removeKaraokeEntry(config, entry) {
  const targetPath = normalizeVdjPath(entry?.filePath);
  const targetSinger = normalizeVdjSinger(entry?.singer);
  const targetSong = normalizeVdjMetadata(entry?.song);
  if (!targetSinger || (!targetPath && !targetSong)) {
    throw new Error("The request data required to remove it from VirtualDJ is missing.");
  }

  const entries = await listKaraokeEntries(config);
  const pathMatches = [];
  const exactMatches = [];
  const metadataMatches = [];
  const songSingerMatches = [];

  for (const candidate of entries) {
    const sameSinger = normalizeVdjSinger(candidate.singer) === targetSinger;
    if (
      targetPath &&
      normalizeVdjPath(candidate.filePath) === targetPath
    ) {
      pathMatches.push(candidate.index);
      if (sameSinger) exactMatches.push(candidate.index);
    }
    if (sameSinger && targetSong && (
      normalizeVdjMetadata(candidate.song) === targetSong ||
      sameMetadataPair(candidate, entry)
    )) {
      songSingerMatches.push(candidate.index);
      if (sameMetadataPair(candidate, entry)) {
        metadataMatches.push(candidate.index);
      }
    }
  }

  const selected =
    exactMatches.length === 1
      ? exactMatches[0]
      : exactMatches.length === 0 && pathMatches.length === 1
        ? pathMatches[0]
        : metadataMatches.length === 1
          ? metadataMatches[0]
          : metadataMatches.length === 0 && songSingerMatches.length === 1
            ? songSingerMatches[0]
            : null;
  if (selected === null) {
    return {
      removed: false,
      reason:
        pathMatches.length > 1 ||
        metadataMatches.length > 1 ||
        songSingerMatches.length > 1
          ? "ambiguous"
          : "not-found"
    };
  }

  const selectedEntry = entries[selected];
  await executeVdj(config, buildKaraokeRemoveScript(selected));
  const updatedEntries = await listKaraokeEntries(config);
  if (updatedEntries.some((candidate) => sameKaraokeIdentity(candidate, selectedEntry))) {
    throw new Error(
      "VirtualDJ received the command, but the song is still in the Karaoke queue."
    );
  }
  return { removed: true, verified: true, index: selected };
}
