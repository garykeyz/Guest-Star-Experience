const SHEET_ID = "1Tgc_sHY4kevbMRlHyjSnVWFpAPJXwJYJeVZfu9yqyZU";
const REQUESTS = "Solicitudes";
const CONFIG = "Configuración";
const HISTORY = "Historial";
const HEADERS = [
  "Fecha y hora", "Nombre", "Canción", "Artista", "Comentario", "Idioma",
  "Duración", "Transición", "Tiempo acumulado", "Tiempo restante",
  "Fuente", "Estado", "ID", "Archivo local", "Actualizado"
];
const MAX_ACTIVITY_SECONDS = 7 * 24 * 60 * 60;
const BRIDGE_API_VERSION = "3.0.0";
const YOUTUBE_CHANNEL_PRIORITIES = {
  english: [
    "Sing King",
    "Stingray Karaoke",
    "KaraFun Karaoke",
    "Sing2Piano",
    "Party Tyme Karaoke",
    "The Karaoke Channel",
    "EasyKaraoke",
    "Vocal-Star Karaoke",
    "CC Karaoke",
    "Sunfly Karaoke",
    "Zoom Karaoke",
    "Atomic Karaoke",
    "Karaoke Sesh",
    "Leo Ponce",
    "Musisi Karaoke"
  ],
  spanish: [
    "Sing King",
    "KaraokeMedia",
    "Karaoke Instrumental",
    "Party Tyme Karaoke en Español",
    "Puro Mariachi Karaoke",
    "Ameritz Spanish Karaoke",
    "KaraFun España",
    "CantaOkey",
    "Agrupación LatinHits",
    "Karaoke – Ameritz",
    "M.M.P.",
    "Reyes de Canción",
    "Brava HitMakers",
    "Stingray Karaoke",
    "The Karaoke Channel",
    "Vocal-Star Karaoke",
    "EasyKaraoke",
    "Party Tyme Karaoke",
    "KaraFun Karaoke",
    "Sunfly Karaoke"
  ],
  french: [
    "Sing King",
    "KaraFun France",
    "KaraStar Karaoke",
    "SING NOW",
    "Valentin Trastet",
    "Karaoké Playback Français",
    "The Karaoke Channel",
    "Vocal-Star Karaoke",
    "EasyKaraoke",
    "Party Tyme Karaoke"
  ],
  portuguese: [
    "Sing King",
    "Muramatsu Karaoke",
    "Clubinho do Karaokê",
    "Ponto do Karaokê 2",
    "Karaokê Acústico Brasil",
    "Party Tyme Karaoke em Português",
    "Ponto do Karaokê 3",
    "KaraFun Karaoke",
    "Lelê Lyrics & Karaoke",
    "Ponto do Karaokê"
  ],
  german: [
    "Sing King",
    "KaraFun Deutschland",
    "Lugn Karaoke",
    "SingingGreenLight Karaoke",
    "MY Pianista",
    "The Karaoke Channel",
    "Vocal-Star Karaoke",
    "EasyKaraoke",
    "Party Tyme Karaoke",
    "Sunfly Karaoke"
  ],
  italian: [
    "Sing King",
    "Italian Karaoke – Backing Tracks",
    "Karaoke Gaetano",
    "Basi Musicali",
    "KaraFun Karaoke",
    "JAM Karaoke Italia",
    "The Karaoke Channel",
    "Vocal-Star Karaoke",
    "EasyKaraoke",
    "Party Tyme Karaoke"
  ],
  russian: [
    "Sing King",
    "Калинка Караоке — Kalinka Karaoke",
    "MnogoNotka",
    "KaraRuTV",
    "КАРАОКЕ Базы и Диски",
    "KaraFun Karaoke",
    "The Karaoke Channel",
    "Party Tyme Karaoke",
    "Vocal-Star Karaoke",
    "EasyKaraoke"
  ]
};

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.action === "verifyHost") {
    return jsonp_({
      ok: validPin_(params.pin),
      codeVersion: BRIDGE_API_VERSION
    }, params.callback);
  }
  return jsonp_(Object.assign({
    ok: true,
    codeVersion: BRIDGE_API_VERSION
  }, publicState_()), params.callback);
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    if (body.action) return hostAction_(body);

    const cfg = config_();
    if (!cfg.accepting) return json_({ ok: false, code: "CLOSED" });
    if (!body.name || !body.song || !body.artist) {
      return json_({ ok: false, code: "MISSING_FIELDS" });
    }

    const song = findSong_(body.song, body.artist);
    const accumulatedSeconds =
      cfg.accumulatedSeconds + song.seconds + cfg.transition;
    const remainingSeconds = Math.max(
      0,
      Math.round(cfg.hours * 3600) - accumulatedSeconds
    );
    const requestId = Utilities.getUuid();
    const sheet = spreadsheet_().getSheetByName(REQUESTS);
    ensureSheetWidth_(sheet, HEADERS.length);
    sheet.appendRow([
      new Date(), clean_(body.name), clean_(body.song), clean_(body.artist),
      clean_(body.comment), clean_(body.language), song.seconds / 86400,
      cfg.transition / 86400, accumulatedSeconds / 86400,
      remainingSeconds / 86400, song.url, "Pendiente", requestId, "", new Date()
    ]);

    const row = sheet.getLastRow();
    sheet.getRange(row, 7, 1, 4).setNumberFormat("[h]:mm:ss");
    writeActivityTimes_(accumulatedSeconds, remainingSeconds);
    return json_({
      ok: true,
      id: requestId,
      state: publicState_()
    });
  } catch (error) {
    return json_({ ok: false, error: String(error) });
  } finally {
    lock.releaseLock();
  }
}

function hostAction_(body) {
  if (!validPin_(body.pin)) return json_({ ok: false, code: "INVALID_PIN" });
  const source = stateSource_(body.source);

  if (body.action === "bridgeControl") {
    const control = String(body.control || "").toLowerCase();
    if (["open", "close", "reset"].indexOf(control) < 0) {
      return json_({ ok: false, code: "INVALID_CONTROL" });
    }
    if (control === "open") {
      setAccepting_(true, source);
    } else if (control === "close") {
      setAccepting_(false, source);
    } else {
      resetActivity_(source);
    }
    return json_({
      ok: true,
      codeVersion: BRIDGE_API_VERSION,
      control: control,
      state: publicState_(),
      requests: bridgeQueue_()
    });
  } else if (body.action === "open") {
    setAccepting_(true, source);
  } else if (body.action === "close") {
    setAccepting_(false, source);
  } else if (body.action === "reset") {
    resetActivity_(source);
  } else if (body.action === "changePin") {
    const next = String(body.newPin || "").trim();
    if (!/^\d{6,12}$/.test(next)) {
      return json_({ ok: false, code: "INVALID_NEW_PIN" });
    }
    PropertiesService.getScriptProperties().setProperty("HOST_PIN", next);
  } else if (body.action === "bridgeQueue") {
    return json_({
      ok: true,
      codeVersion: BRIDGE_API_VERSION,
      state: publicState_(),
      config: bridgeConfig_(),
      requests: bridgeQueue_()
    });
  } else if (body.action === "bridgeConfig") {
    return json_({
      ok: true,
      codeVersion: BRIDGE_API_VERSION,
      state: publicState_(),
      config: bridgeConfig_(),
      requests: bridgeQueue_()
    });
  } else if (body.action === "bridgeConfigUpdate") {
    updateBridgeConfig_(body, source);
    return json_({
      ok: true,
      codeVersion: BRIDGE_API_VERSION,
      state: publicState_(),
      config: bridgeConfig_(),
      requests: bridgeQueue_()
    });
  } else if (body.action === "bridgeUpdate") {
    return json_({
      ok: bridgeUpdate_(body),
      state: publicState_(),
      config: bridgeConfig_()
    });
  } else if (body.action === "youtubeSearch") {
    return json_({
      ok: true,
      state: publicState_(),
      items: findKaraokeCandidates_(body.song, body.artist, body.language)
    });
  } else {
    return json_({ ok: false, code: "INVALID_ACTION" });
  }

  return json_({ ok: true, state: publicState_() });
}

function bridgeQueue_() {
  ensureRequestIds_();
  const sheet = spreadsheet_().getSheetByName(REQUESTS);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  return sheet.getRange(2, 1, last - 1, HEADERS.length).getValues()
    .map(function(row) {
      const stamp = row[0] instanceof Date ? row[0].toISOString() : String(row[0] || "");
      return {
        timestamp: stamp,
        singer: String(row[1] || ""),
        song: String(row[2] || ""),
        artist: String(row[3] || ""),
        comment: String(row[4] || ""),
        language: String(row[5] || ""),
        sourceUrl: String(row[10] || ""),
        status: String(row[11] || "Pendiente"),
        id: String(row[12] || ""),
        fileName: String(row[13] || ""),
        durationSeconds: durationCellSeconds_(row[6]),
        transitionSeconds: durationCellSeconds_(row[7]),
        updatedAt:
          row[14] instanceof Date ? row[14].toISOString() : String(row[14] || "")
      };
    })
    .filter(function(item) {
      return item.id && item.singer && item.song;
    });
}

function bridgeUpdate_(body) {
  const id = String(body.id || "").trim();
  if (!id) return false;
  const sheet = spreadsheet_().getSheetByName(REQUESTS);
  const last = sheet.getLastRow();
  if (last < 2) return false;
  const ids = sheet.getRange(2, 13, last - 1, 1).getDisplayValues();
  for (let index = 0; index < ids.length; index++) {
    if (ids[index][0] !== id) continue;
    const row = index + 2;
    const statusRange = sheet.getRange(row, 12);
    const previousStatus = statusRange.getDisplayValue();
    const nextStatus = clean_(body.status || "Pendiente");
    statusRange.setValue(nextStatus);
    sheet.getRange(row, 14).setValue(clean_(body.fileName));
    sheet.getRange(row, 15).setValue(new Date());
    if (skippedStatus_(previousStatus) !== skippedStatus_(nextStatus)) {
      recalculateActivity_();
    }
    return true;
  }
  return false;
}

function ensureRequestIds_() {
  const sheet = spreadsheet_().getSheetByName(REQUESTS);
  ensureSheetWidth_(sheet, HEADERS.length);
  const last = sheet.getLastRow();
  if (last < 2) return;
  const range = sheet.getRange(2, 13, last - 1, 1);
  const ids = range.getValues();
  let changed = false;
  for (let index = 0; index < ids.length; index++) {
    if (ids[index][0]) continue;
    ids[index][0] = Utilities.getUuid();
    changed = true;
  }
  if (changed) range.setValues(ids);
}

function resetActivity_(source) {
  const ss = spreadsheet_();
  const requests = ss.getSheetByName(REQUESTS);
  const history = ss.getSheetByName(HISTORY);
  ensureSheetWidth_(requests, HEADERS.length);
  ensureSheetWidth_(history, HEADERS.length);
  const last = requests.getLastRow();
  if (last > 1) {
    ensureRequestIds_();
    const rows = requests.getRange(2, 1, last - 1, HEADERS.length).getValues();
    const historyStart = history.getLastRow() + 1;
    history.getRange(historyStart, 1, rows.length, HEADERS.length).setValues(rows);
    history.getRange(historyStart, 7, rows.length, 4).setNumberFormat("[h]:mm:ss");
    requests.getRange(2, 1, last - 1, HEADERS.length).clearContent();
  }

  const cfg = ss.getSheetByName(CONFIG);
  const hours = boundedNumber_(cfg.getRange("B2").getValue(), 2, 0.25, 168);
  writeActivityTimes_(0, Math.round(hours * 3600));
  cfg.getRange("B7").setValue(new Date());
  touchState_("reset", source, true);
}

function setAccepting_(accepting, source) {
  const cfg = spreadsheet_().getSheetByName(CONFIG);
  const current = cfg.getRange("B4").getValue() !== false;
  const next = Boolean(accepting);
  cfg.getRange("B4").setValue(next);
  if (current !== next) {
    touchState_(next ? "open" : "close", source, false);
  }
}

function touchState_(action, source, newActivity) {
  const cfg = spreadsheet_().getSheetByName(CONFIG);
  ensureConfigState_(cfg);
  const revision = Math.max(0, Number(cfg.getRange("B8").getValue()) || 0) + 1;
  cfg.getRange("B8").setValue(revision);
  if (newActivity || !cfg.getRange("B9").getDisplayValue()) {
    cfg.getRange("B9").setValue(Utilities.getUuid());
  }
  cfg.getRange("B10").setValue(new Date());
  cfg.getRange("B11").setValue(clean_(action));
  cfg.getRange("B12").setValue(stateSource_(source));
}

function publicState_() {
  const cfg = config_();
  return {
    accepting: cfg.accepting,
    activityHours: cfg.hours,
    transitionSeconds: cfg.transition,
    accumulatedSeconds: cfg.accumulatedSeconds,
    remainingSeconds: cfg.remainingSeconds,
    activityStartedAt: cfg.activityStartedAt,
    stateRevision: cfg.stateRevision,
    activityId: cfg.activityId,
    updatedAt: cfg.updatedAt,
    lastAction: cfg.lastAction,
    lastSource: cfg.lastSource
  };
}

function config_() {
  const sheet = spreadsheet_().getSheetByName(CONFIG);
  ensureConfigState_(sheet);
  const hours = boundedNumber_(sheet.getRange("B2").getValue(), 2, 0.25, 168);
  const totalSeconds = Math.round(hours * 3600);
  const accumulatedSeconds = readDurationSeconds_(sheet.getRange("B5"));
  const updated = sheet.getRange("B10").getValue();
  const started = sheet.getRange("B7").getValue();
  return {
    hours: hours,
    transition: boundedNumber_(
      sheet.getRange("B3").getValue(),
      30,
      0,
      900
    ),
    accepting: sheet.getRange("B4").getValue() !== false,
    accumulatedSeconds: accumulatedSeconds,
    remainingSeconds: Math.max(0, totalSeconds - accumulatedSeconds),
    activityStartedAt:
      started instanceof Date ? started.toISOString() : String(started || ""),
    stateRevision: Math.max(0, Number(sheet.getRange("B8").getValue()) || 0),
    activityId: String(sheet.getRange("B9").getDisplayValue() || ""),
    updatedAt: updated instanceof Date ? updated.toISOString() : String(updated || ""),
    lastAction: String(sheet.getRange("B11").getDisplayValue() || ""),
    lastSource: String(sheet.getRange("B12").getDisplayValue() || "")
  };
}

function bridgeConfig_() {
  const cfg = config_();
  return {
    activityHours: cfg.hours,
    transitionSeconds: cfg.transition,
    accepting: cfg.accepting,
    accumulatedSeconds: cfg.accumulatedSeconds,
    remainingSeconds: cfg.remainingSeconds,
    activityStartedAt: cfg.activityStartedAt,
    stateRevision: cfg.stateRevision,
    activityId: cfg.activityId,
    updatedAt: cfg.updatedAt,
    lastAction: cfg.lastAction,
    lastSource: cfg.lastSource
  };
}

function updateBridgeConfig_(body, source) {
  const sheet = spreadsheet_().getSheetByName(CONFIG);
  ensureBaseConfig_(sheet);
  ensureConfigState_(sheet);
  const current = config_();
  const hours = boundedNumber_(
    body.activityHours,
    current.hours,
    0.25,
    168
  );
  const transition = boundedNumber_(
    body.transitionSeconds,
    current.transition,
    0,
    900
  );
  const accepting =
    body.accepting === undefined ? current.accepting : body.accepting !== false;
  sheet.getRange("B2").setValue(hours);
  sheet.getRange("B3").setValue(transition);
  sheet.getRange("B4").setValue(accepting);
  recalculateActivity_();
  touchState_("config", source, false);
}

function writeActivityTimes_(accumulatedSeconds, remainingSeconds) {
  const cfg = spreadsheet_().getSheetByName(CONFIG);
  writeDurationSeconds_(cfg.getRange("B5"), accumulatedSeconds);
  writeDurationSeconds_(cfg.getRange("B6"), remainingSeconds);
}

function writeDurationSeconds_(range, seconds) {
  const safe = Math.max(0, Math.min(MAX_ACTIVITY_SECONDS, Math.round(Number(seconds) || 0)));
  range.setValue(safe / 86400).setNumberFormat("[h]:mm:ss");
}

function readDurationSeconds_(range) {
  const displayed = parseDurationText_(range.getDisplayValue());
  if (displayed !== null && displayed <= MAX_ACTIVITY_SECONDS) return displayed;

  const value = range.getValue();
  if (
    typeof value === "number" &&
    isFinite(value) &&
    value >= 0 &&
    value <= MAX_ACTIVITY_SECONDS / 86400
  ) {
    return Math.round(value * 86400);
  }
  return 0;
}

function parseDurationText_(value) {
  const text = String(value || "").trim();
  let match = text.match(/^(\d+):([0-5]\d):([0-5]\d)$/);
  if (match) {
    return Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  }
  match = text.match(/^(\d+):([0-5]\d)$/);
  if (match) return Number(match[1]) * 60 + Number(match[2]);
  return null;
}

function durationCellSeconds_(value) {
  if (
    typeof value === "number" &&
    isFinite(value) &&
    value >= 0 &&
    value <= MAX_ACTIVITY_SECONDS / 86400
  ) {
    return Math.round(value * 86400);
  }
  if (value instanceof Date) {
    return (
      value.getUTCHours() * 3600 +
      value.getUTCMinutes() * 60 +
      value.getUTCSeconds()
    );
  }
  return parseDurationText_(value) || 0;
}

function skippedStatus_(value) {
  return normalizeYoutubeText_(value) === "saltado";
}

function recalculateActivity_() {
  const ss = spreadsheet_();
  const requests = ss.getSheetByName(REQUESTS);
  const cfg = ss.getSheetByName(CONFIG);
  const last = requests.getLastRow();
  let accumulatedSeconds = 0;
  if (last > 1) {
    const rowCount = last - 1;
    const rows = requests.getRange(2, 7, rowCount, 6).getValues();
    const totals = [];
    const totalSeconds = Math.round(
      boundedNumber_(cfg.getRange("B2").getValue(), 2, 0.25, 168) * 3600
    );
    rows.forEach(function(row) {
      if (!skippedStatus_(row[5])) {
        accumulatedSeconds += durationCellSeconds_(row[0]);
        accumulatedSeconds += durationCellSeconds_(row[1]);
      }
      totals.push([
        accumulatedSeconds / 86400,
        Math.max(0, totalSeconds - accumulatedSeconds) / 86400
      ]);
    });
    requests.getRange(2, 9, rowCount, 2)
      .setValues(totals)
      .setNumberFormat("[h]:mm:ss");
  }
  const totalSeconds = Math.round(
    boundedNumber_(cfg.getRange("B2").getValue(), 2, 0.25, 168) * 3600
  );
  writeActivityTimes_(
    accumulatedSeconds,
    Math.max(0, totalSeconds - accumulatedSeconds)
  );
  return accumulatedSeconds;
}

function findSong_(title, artist) {
  const key = youtubeKey_();
  if (!key) return { seconds: 240, url: "", found: false };
  const query = encodeURIComponent(artist + " " + title + " official audio");
  const searchUrl =
    "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=5&q=" +
    query + "&key=" + encodeURIComponent(key);
  const search = fetchJson_(searchUrl);
  const ids = (search.items || []).map(function(item) {
    return item.id && item.id.videoId;
  }).filter(Boolean);
  if (!ids.length) return { seconds: 240, url: "", found: false };
  const detailsUrl =
    "https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet&id=" +
    ids.join(",") + "&key=" + encodeURIComponent(key);
  const details = fetchJson_(detailsUrl);
  const candidates = (details.items || []).map(function(item) {
    return {
      id: item.id,
      seconds: isoSeconds_(item.contentDetails.duration),
      title: String(item.snippet.title || "").toLowerCase()
    };
  }).filter(function(item) {
    return item.seconds >= 90 && item.seconds <= 900;
  });
  const preferred = candidates.find(function(item) {
    return !/(live|remix|sped up|slowed|karaoke)/i.test(item.title);
  }) || candidates[0];
  return preferred
    ? { seconds: preferred.seconds, url: "https://youtu.be/" + preferred.id, found: true }
    : { seconds: 240, url: "", found: false };
}

function normalizeYoutubeText_(value) {
  let text = String(value || "").toLowerCase();
  if (text.normalize) {
    text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }
  return text
    .replace(/[—–_-]+/g, " ")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function youtubeLanguageKey_(language) {
  const value = normalizeYoutubeText_(language);
  if (
    /(^| )(latinoamerica|latino|latina|latin america|es 419)( |$)/.test(value)
  ) return "spanish";
  if (/(^| )(espanol|spanish|castellano|es)( |$)/.test(value)) return "spanish";
  if (/(^| )(francais|french|fr)( |$)/.test(value)) return "french";
  if (/(^| )(portugues|portuguese|pt)( |$)/.test(value)) return "portuguese";
  if (/(^| )(deutsch|german|aleman|de)( |$)/.test(value)) return "german";
  if (/(^| )(italiano|italian|it)( |$)/.test(value)) return "italian";
  if (/(^| )(русскии|русский|russian|ruso|ru)( |$)/.test(value)) return "russian";
  return "english";
}

function youtubeSearchTerms_(languageKey, lyricsOnly) {
  const terms = {
    english: lyricsOnly
      ? "official lyric video lyrics on screen"
      : "karaoke version lyrics on screen",
    spanish: lyricsOnly
      ? "video oficial con letra letra en pantalla"
      : "karaoke letra en pantalla instrumental",
    french: lyricsOnly
      ? "clip officiel paroles à l'écran"
      : "karaoké paroles à l'écran instrumental",
    portuguese: lyricsOnly
      ? "vídeo oficial com letra letra na tela"
      : "karaokê letra na tela instrumental",
    german: lyricsOnly
      ? "offizielles lyric video songtext"
      : "karaoke songtext instrumental",
    italian: lyricsOnly
      ? "video ufficiale con testo testo sullo schermo"
      : "karaoke testo sullo schermo base musicale",
    russian: lyricsOnly
      ? "официальное видео текст песни"
      : "караоке текст песни минус"
  };
  return terms[languageKey] || terms.english;
}

function youtubeChannelMatches_(channel, priorityLabel) {
  const normalizedChannel = normalizeYoutubeText_(channel);
  const compactChannel = normalizedChannel.replace(/\s+/g, "");
  const rawLabel = String(priorityLabel || "");
  let variants = [rawLabel];
  const separated = rawLabel.split(/\s+[—–]\s+/).filter(Boolean);
  if (separated.length > 1) variants = variants.concat(separated);
  return variants.some(function(variant) {
    const normalizedPriority = normalizeYoutubeText_(variant);
    if (!normalizedPriority || normalizedPriority === "karaoke") return false;
    const compactPriority = normalizedPriority.replace(/\s+/g, "");
    if (
      normalizedChannel === normalizedPriority ||
      normalizedChannel.indexOf(normalizedPriority) >= 0 ||
      compactChannel.indexOf(compactPriority) >= 0
    ) return true;
    const tokens = normalizedPriority.split(" ").filter(Boolean);
    return (
      tokens.length >= 2 &&
      tokens.every(function(token) {
        return normalizedChannel.split(" ").indexOf(token) >= 0;
      })
    );
  });
}

function youtubeChannelPriority_(channel, languageKey) {
  const priorities =
    YOUTUBE_CHANNEL_PRIORITIES[languageKey] ||
    YOUTUBE_CHANNEL_PRIORITIES.english;
  for (let index = 0; index < priorities.length; index++) {
    if (youtubeChannelMatches_(channel, priorities[index])) {
      return {
        rank: index + 1,
        label: priorities[index]
      };
    }
  }
  return {
    rank: priorities.length + 100,
    label: ""
  };
}

function compareKaraokeCandidates_(a, b) {
  const leftPriority = Number(a.channelPriority || 999);
  const rightPriority = Number(b.channelPriority || 999);
  if (leftPriority !== rightPriority) return leftPriority - rightPriority;
  if (a.resultType !== b.resultType) {
    return a.resultType === "karaoke" ? -1 : 1;
  }
  return Number(b.qualityScore || 0) - Number(a.qualityScore || 0);
}

function findKaraokeCandidates_(title, artist, language) {
  const key = youtubeKey_();
  if (!key || !title) return [];
  const languageKey = youtubeLanguageKey_(language);
  const base = String(artist || "") + " " + String(title || "");
  let candidates = youtubeCandidates_(
    base + " " + youtubeSearchTerms_(languageKey, false),
    key,
    languageKey
  );
  if (candidates.length < 6) {
    candidates = candidates.concat(
      youtubeCandidates_(
        base + " " + youtubeSearchTerms_(languageKey, true),
        key,
        languageKey
      )
    );
  }
  candidates.sort(compareKaraokeCandidates_);
  const seen = {};
  return candidates.filter(function(item) {
    if (!item.id || seen[item.id]) return false;
    seen[item.id] = true;
    return true;
  }).slice(0, 6);
}

function youtubeCandidates_(queryText, key, languageKey) {
  const query = encodeURIComponent(queryText);
  const searchUrl =
    "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=25&q=" +
    query + "&key=" + encodeURIComponent(key);
  const search = fetchJson_(searchUrl);
  const snippets = {};
  const ranks = {};
  const ids = (search.items || []).map(function(item, index) {
    const id = item.id && item.id.videoId;
    if (id) {
      snippets[id] = item.snippet || {};
      ranks[id] = index;
    }
    return id;
  }).filter(Boolean);
  if (!ids.length) return [];
  const detailsUrl =
    "https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet,statistics&id=" +
    ids.join(",") + "&key=" + encodeURIComponent(key);
  const details = fetchJson_(detailsUrl);
  return (details.items || []).map(function(item) {
    const snippet = item.snippet || snippets[item.id] || {};
    const label = String(snippet.title || "");
    const lower = label.toLowerCase();
    const description = String(snippet.description || "").toLowerCase();
    const searchable = lower + " " + description;
    const channel = String(snippet.channelTitle || "");
    const channelLower = channel.toLowerCase();
    const priority = youtubeChannelPriority_(
      channel,
      languageKey || "english"
    );
    const seconds = isoSeconds_(item.contentDetails.duration);
    const views = Math.max(
      0,
      Number(item.statistics && item.statistics.viewCount) || 0
    );
    let score = 0;
    const hasKaraoke = /karaoke/.test(lower);
    const hasLyrics =
      /lyrics?|letra|subtitul|on.?screen|sing.?along/.test(searchable);
    const hasInstrumental = /instrumental/.test(lower);
    const hasKaraokeVersion = /karaoke\s*(version|track)/.test(lower);
    const trustedKaraokeChannel =
      priority.label !== "" ||
      /zoom karaoke|tracks planet|karaoke ph/.test(channelLower);
    const confirmedKaraoke =
      (hasKaraoke && (hasLyrics || trustedKaraokeChannel)) ||
      (hasInstrumental && hasLyrics) ||
      (hasKaraokeVersion && hasLyrics);
    if (hasKaraoke && hasLyrics) score += 120;
    else if (hasInstrumental && hasLyrics) score += 110;
    else if (hasKaraoke && trustedKaraokeChannel) score += 100;
    else if (hasLyrics) score += 70;
    if (trustedKaraokeChannel) score += 12;
    if (/official/.test(lower) && hasLyrics) score += 5;
    score += Math.min(18, Math.floor(Math.log(views + 1) / Math.log(10) * 3));
    score += Math.max(0, 8 - Number(ranks[item.id] || 0));
    if (/live|reaction|tutorial|shorts?|sped up|slowed|nightcore/.test(lower)) {
      score -= 45;
    }
    const resultType = confirmedKaraoke ? "karaoke" : "lyrics-vocals";
    const recommended = confirmedKaraoke
      ? score >= 80
      : hasLyrics && score >= 50;
    return {
      id: item.id,
      title: label,
      channel: channel,
      durationSeconds: seconds,
      url: "https://www.youtube.com/watch?v=" + item.id,
      qualityScore: score,
      channelPriority: priority.rank,
      channelPriorityLabel: priority.label,
      languagePriority: languageKey || "english",
      resultType: resultType,
      recommended: recommended,
      lyricsVisible: true,
      notice:
        resultType === "karaoke"
          ? "Versión karaoke con letra en pantalla."
          : "No encontramos una versión 100% karaoke; se eligió una versión con voces y letra en pantalla."
    };
  }).filter(function(item) {
    return (
      item.recommended &&
      item.durationSeconds >= 90 &&
      item.durationSeconds <= 900
    );
  }).sort(compareKaraokeCandidates_);
}

function fetchJson_(url) {
  try {
    const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) return {};
    return JSON.parse(response.getContentText());
  } catch (error) {
    return {};
  }
}

function isoSeconds_(iso) {
  const match = String(iso).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  return match
    ? Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0)
    : 0;
}

function setup() {
  const ss = spreadsheet_();
  const requests = ss.getSheetByName(REQUESTS) || ss.insertSheet(REQUESTS);
  const config = ss.getSheetByName(CONFIG) || ss.insertSheet(CONFIG);
  const history = ss.getSheetByName(HISTORY) || ss.insertSheet(HISTORY);
  ensureSheetWidth_(requests, HEADERS.length);
  ensureSheetWidth_(history, HEADERS.length);
  requests.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  history.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
  requests.setFrozenRows(1);
  history.setFrozenRows(1);
  ensureBaseConfig_(config);
  ensureConfigState_(config);
  ensureRequestIds_();
  recalculateActivity_();
  const state = publicState_();
  console.log(
    "Configuración reparada y lista para Guest Star Bridge. Estado: %s",
    JSON.stringify(state)
  );
  return state;
}

function ensureBaseConfig_(sheet) {
  if (!sheet.getRange("A1").getValue()) {
    sheet.getRange("A1:B7").setValues([
      ["Configuración", "Valor"],
      ["Duración total (horas)", 2],
      ["Transición por participante (segundos)", 30],
      ["Aceptar solicitudes", true],
      ["Tiempo acumulado", 0],
      ["Tiempo restante", 2 / 24],
      ["Último reinicio", new Date()]
    ]);
  }
}

function ensureConfigState_(sheet) {
  const labels = [
    ["Versión del estado"],
    ["ID de actividad"],
    ["Último cambio de estado"],
    ["Última acción"],
    ["Origen del cambio"]
  ];
  const labelRange = sheet.getRange("A8:A12");
  const currentLabels = labelRange.getDisplayValues();
  let labelsChanged = false;
  for (let index = 0; index < labels.length; index++) {
    if (currentLabels[index][0] === labels[index][0]) continue;
    currentLabels[index][0] = labels[index][0];
    labelsChanged = true;
  }
  if (labelsChanged) labelRange.setValues(currentLabels);
  if (!Number(sheet.getRange("B8").getValue())) sheet.getRange("B8").setValue(1);
  if (!sheet.getRange("B9").getDisplayValue()) {
    sheet.getRange("B9").setValue(Utilities.getUuid());
  }
  if (!sheet.getRange("B10").getValue()) sheet.getRange("B10").setValue(new Date());
  if (!sheet.getRange("B11").getDisplayValue()) sheet.getRange("B11").setValue("setup");
  if (!sheet.getRange("B12").getDisplayValue()) sheet.getRange("B12").setValue("sheet");
}

function ensureSheetWidth_(sheet, requiredColumns) {
  const missing = requiredColumns - sheet.getMaxColumns();
  if (missing > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), missing);
}

function configurarCredenciales() {
  const ui = SpreadsheetApp.getUi();
  const pin = ui.prompt(
    "PIN privado del host",
    "Escribe un PIN de 6 a 12 números:",
    ui.ButtonSet.OK_CANCEL
  );
  if (
    pin.getSelectedButton() !== ui.Button.OK ||
    !/^\d{6,12}$/.test(pin.getResponseText())
  ) {
    return;
  }
  PropertiesService.getScriptProperties().setProperty(
    "HOST_PIN",
    pin.getResponseText().trim()
  );
  const key = ui.prompt(
    "YouTube API Key",
    "Pega tu clave de YouTube Data API v3 para obtener enlaces directos:",
    ui.ButtonSet.OK_CANCEL
  );
  if (key.getSelectedButton() === ui.Button.OK && key.getResponseText()) {
    PropertiesService.getScriptProperties().setProperty(
      "YOUTUBE_API_KEY",
      key.getResponseText().trim()
    );
  }
  ui.alert("Credenciales guardadas de forma privada.");
}

function abrirSolicitudes() {
  setAccepting_(true, "sheet");
}

function cerrarSolicitudes() {
  setAccepting_(false, "sheet");
}

function reiniciarActividad() {
  const ui = SpreadsheetApp.getUi();
  if (
    ui.alert(
      "Reiniciar actividad",
      "Se archivarán las solicitudes actuales.",
      ui.ButtonSet.YES_NO
    ) === ui.Button.YES
  ) {
    resetActivity_("sheet");
  }
}

function recalcularTiempos() {
  const seconds = recalculateActivity_();
  console.log("Tiempo recalculado: %s", formatDuration_(seconds));
  return seconds;
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu("🎤 Karaoke")
    .addItem("Configurar PIN y YouTube", "configurarCredenciales")
    .addItem("Preparar / reparar Guest Star Bridge", "setup")
    .addItem("Recalcular tiempos", "recalcularTiempos")
    .addSeparator()
    .addItem("Abrir solicitudes", "abrirSolicitudes")
    .addItem("Cerrar solicitudes", "cerrarSolicitudes")
    .addItem("Reiniciar actividad", "reiniciarActividad")
    .addToUi();
}

function validPin_(pin) {
  const saved = PropertiesService.getScriptProperties().getProperty("HOST_PIN");
  return Boolean(saved) && String(pin || "") === saved;
}

function youtubeKey_() {
  return PropertiesService.getScriptProperties().getProperty("YOUTUBE_API_KEY") || "";
}

function stateSource_(value) {
  const source = String(value || "host").toLowerCase();
  return ["web", "bridge", "sheet"].indexOf(source) >= 0 ? source : "host";
}

function positiveNumber_(value, fallback) {
  const number = Number(value);
  return isFinite(number) && number > 0 ? number : fallback;
}

function boundedNumber_(value, fallback, minimum, maximum) {
  const number = Number(value);
  if (!isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function formatDuration_(seconds) {
  const safe = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remaining = safe % 60;
  return hours + ":" + String(minutes).padStart(2, "0") + ":" +
    String(remaining).padStart(2, "0");
}

function spreadsheet_() {
  return SpreadsheetApp.openById(SHEET_ID);
}

function clean_(value) {
  return String(value || "").trim().slice(0, 500);
}

function json_(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function jsonp_(data, callback) {
  const safe = String(callback || "").replace(/[^\w$]/g, "");
  return ContentService.createTextOutput(
    safe ? safe + "(" + JSON.stringify(data) + ")" : JSON.stringify(data)
  ).setMimeType(
    safe ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON
  );
}
