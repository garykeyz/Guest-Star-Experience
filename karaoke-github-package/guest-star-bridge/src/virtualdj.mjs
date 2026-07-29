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

function normalizedQueryValue(value) {
  const text = String(value || "").trim();
  const unquoted =
    text.startsWith('"') && text.endsWith('"') ? text.slice(1, -1) : text;
  return /^(?:false|null|undefined)$/i.test(unquoted) ? "" : unquoted;
}

export function normalizeVdjPath(value) {
  return normalizedQueryValue(value).replace(/\\/g, "/").replace(/\/+/g, "/").toLowerCase();
}

export function normalizeVdjSinger(value) {
  return normalizedQueryValue(value).replace(/\s+/g, " ").trim().toLowerCase();
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
      throw new Error(`VirtualDJ respondió ${response.status}: ${text || "sin detalle"}`);
    }
    return text;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("VirtualDJ no respondió a tiempo. Revisa Network Control y el puerto.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function executeVdj(config, script) {
  const result = await request(config, "execute", script);
  if (result.toLowerCase() === "false") {
    throw new Error("VirtualDJ rechazó el comando.");
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
  const rawCount = normalizedQueryValue(
    await queryVdj(config, "file_count karaoke")
  );
  if (!/^\d+$/.test(rawCount)) {
    throw new Error(
      "VirtualDJ no devolvió el tamaño de la cola Karaoke. Comprueba que Network Control esté actualizado."
    );
  }
  const count = Math.min(500, Number.parseInt(rawCount, 10));
  const entries = [];

  for (let index = 0; index < count; index++) {
    const [filePath, singer, song, artist] = await Promise.all([
      queryVdj(config, karaokeSongQuery("filepath", index)),
      queryVdj(config, karaokeSongQuery("singer", index)),
      queryVdj(config, karaokeSongQuery("title", index)),
      queryVdj(config, karaokeSongQuery("artist", index))
    ]);
    const entry = {
      index,
      filePath: normalizedQueryValue(filePath),
      singer: normalizedQueryValue(singer),
      song: normalizedQueryValue(song),
      artist: normalizedQueryValue(artist)
    };
    if (!entry.filePath && !entry.singer && !entry.song && !entry.artist) {
      throw new Error(
        `VirtualDJ informó ${count} canciones, pero no permitió leer la posición ${index + 1}.`
      );
    }
    entries.push(entry);
  }

  return entries;
}

export async function removeKaraokeEntry(config, entry) {
  const targetPath = normalizeVdjPath(entry?.filePath);
  const targetSinger = normalizeVdjSinger(entry?.singer);
  const targetSong = normalizeVdjMetadata(entry?.song);
  const targetArtist = normalizeVdjMetadata(entry?.artist);
  if (!targetSinger || (!targetPath && !targetSong)) {
    throw new Error("Faltan los datos para retirar esta solicitud de VirtualDJ.");
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
    if (
      sameSinger &&
      targetSong &&
      normalizeVdjMetadata(candidate.song) === targetSong
    ) {
      songSingerMatches.push(candidate.index);
      const candidateArtist = normalizeVdjMetadata(candidate.artist);
      if (
        !targetArtist ||
        !candidateArtist ||
        targetArtist === candidateArtist ||
        targetArtist.includes(candidateArtist) ||
        candidateArtist.includes(targetArtist)
      ) {
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

  await executeVdj(config, buildKaraokeRemoveScript(selected));
  return { removed: true, index: selected };
}
