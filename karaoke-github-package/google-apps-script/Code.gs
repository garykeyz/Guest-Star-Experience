const SHEET_ID = "1Tgc_sHY4kevbMRlHyjSnVWFpAPJXwJYJeVZfu9yqyZU";
const REQUESTS = "Solicitudes";
const CONFIG = "Configuración";
const HISTORY = "Historial";
const HEADERS = [
  "Fecha y hora", "Nombre", "Canción", "Artista", "Comentario", "Idioma",
  "Duración", "Transición", "Tiempo acumulado", "Tiempo restante",
  "Fuente", "Estado", "ID", "Archivo local", "Actualizado",
  "Hotel ID", "Venue ID", "Activity ID", "Cycle ID", "Source type",
  "VirtualDJ item ID", "Language code", "Queue position", "Sync state",
  "Last seen in VirtualDJ", "Status revision"
];
const MAX_ACTIVITY_SECONDS = 7 * 24 * 60 * 60;
const BRIDGE_API_VERSION = "4.1.1";
const GUEST_STAR_CODE_BUILD = "4.2.0-cloudflare-d1-migration";
const V4_SCHEMA_VERSION = "4.2.0";
const V4_PUBLIC_BASE_URL = "https://request.gstarxp.com";
const V4_REQUIRED_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/script.external_request",
  "https://www.googleapis.com/auth/script.scriptapp",
  "https://www.googleapis.com/auth/userinfo.email"
];
let REQUEST_DATA_SHEET_ID_ = "";
let V4_REQUEST_MASTER_SPREADSHEET_ = null;
let V4_REQUEST_TABLE_ROWS_ = {};
let V4_REQUEST_TABLE_SHEETS_ = {};
const V4_MASTER_TABLES = {
  Users: [
    "userId", "username", "displayName", "email", "passwordHash",
    "passwordSalt", "role", "status", "staticHostSlug", "mustChangePassword",
    "createdAt", "updatedAt", "lastLoginAt", "passwordUpdatedAt"
  ],
  Hotels: [
    "hotelId", "name", "slug", "publicCode", "publicUrl", "qrFileId",
    "qrVersion", "activePublicActivityId", "timezone", "dataSheetId", "status",
    "createdAt", "updatedAt"
  ],
  Venues: [
    "venueId", "hotelId", "name", "slug", "status", "createdAt", "updatedAt"
  ],
  Activities: [
    "activityId", "hotelId", "venueId", "name", "internalCode", "status",
    "defaultDurationSeconds", "defaultTransitionSeconds", "showPublicStatus",
    "showCountdown", "scheduledStartAt", "autoStartEnabled", "acceptEarlyRequests",
    "currentCycleId", "createdAt", "updatedAt", "allowedLanguagesJson"
  ],
  UserAssignments: [
    "assignmentId", "userId", "hotelId", "venueId", "activityId",
    "permissionsJson", "status", "createdAt", "updatedAt"
  ],
  Devices: [
    "deviceId", "deviceName", "userId", "hotelId", "venueId", "activityId",
    "deviceTokenHash", "status", "lastHeartbeatAt", "bridgeVersion",
    "virtualDJConnected", "createdAt", "updatedAt"
  ],
  BridgeCommands: [
    "commandId", "deviceId", "activityId", "requestedByUserId", "commandType",
    "payloadJson", "status", "createdAt", "startedAt", "completedAt",
    "resultJson", "errorMessage"
  ],
  AuthSessions: [
    "authSessionId", "userId", "sessionTokenHash", "deviceId", "createdAt",
    "expiresAt", "lastUsedAt", "revokedAt"
  ],
  OneTimeLoginCodes: [
    "codeId", "userId", "deviceId", "codeHash", "createdAt", "expiresAt", "usedAt"
  ],
  AuditLog: [
    "logId", "userId", "deviceId", "action", "hotelId", "venueId",
    "activityId", "targetId", "detailsJson", "createdAt"
  ],
  HotelBranding: [
    "hotelBrandingId", "hotelId", "teamDisplayName", "teamType", "tagline",
    "welcomeMessage", "activityEndingMessage", "upcomingActivityMessage",
    "reviewInvitationMessage", "generalReviewMessage", "brandTone", "hotelLogoUrl",
    "teamLogoUrl", "externalReviewProvider", "externalReviewUrl", "showHotelName",
    "showHotelLogo", "showTeamIdentity", "showActivityDetails", "showScheduledStart",
    "showCountdown", "showQueueInformation", "showNextActivity", "showInternalRating",
    "showExternalReview", "requestGuestName", "requestGuestEmail", "offerFollowUp",
    "showAddToCalendar", "showRemindMe", "publicMessageTone",
    "beforeStartClosedTitle", "beforeStartClosedMessage", "beforeStartOpenTitle",
    "beforeStartOpenMessage", "inProgressTitle", "inProgressMessage",
    "requestsClosedTitle", "requestsClosedMessage", "activityFinishedTitle",
    "activityFinishedMessage", "noActivityTitle", "noActivityMessage",
    "reviewPlacement", "nextActivityPlacement", "contactInvitationPlacement",
    "externalReviewDestination", "guestCanChooseReviewDestination", "updatedAt",
    "primaryColor", "secondaryColor", "accentColor"
  ],
  ActivitySchedules: [
    "scheduleId", "hotelId", "venueId", "activityId", "scheduledStartAt",
    "durationSeconds", "requestOpeningAt", "autoOpenRequests", "autoStartActivity",
    "showCountdown", "recurrenceType", "recurrenceInterval", "recurrenceDaysJson",
    "recurrenceEndAt", "status", "createdByUserId", "createdAt", "updatedAt"
  ],
  UpcomingActivities: [
    "upcomingActivityId", "hotelId", "venueId", "activityId", "scheduleId",
    "publicTitle", "publicDescription", "imageUrl", "featured", "status",
    "createdAt", "updatedAt"
  ],
  GlobalSettings: ["settingKey", "settingValue", "updatedAt"]
};
const V4_HOTEL_TABLES = {
  ActivityCycles: [
    "cycleId", "activityId", "hotelId", "venueId", "startedByUserId",
    "scheduledStartAt", "startedAt", "finishedAt", "status", "archivedAt"
  ],
  Reviews: [
    "reviewId", "hotelId", "venueId", "activityId", "cycleId", "hostUserId",
    "rating", "comment", "musicRating", "hostRating", "organizationRating",
    "wouldJoinAgain", "guestName", "guestEmail", "guestContactConsent",
    "reviewStatus", "internalNote", "assignedToUserId", "createdAt", "updatedAt",
    "archivedAt", "deletedAt", "deletedByUserId"
  ],
  ReviewInvitations: [
    "invitationId", "reviewId", "hotelId", "guestName", "guestEmail",
    "consentGrantedAt", "checkoutDate", "scheduledSendAt", "sentAt", "openedAt",
    "completedAt", "status", "unsubscribeTokenHash", "createdAt", "updatedAt"
  ],
  GuestReminders: [
    "reminderId", "hotelId", "activityId", "guestEmail", "reminderType",
    "scheduledAt", "sentAt", "status", "consentReferenceId", "createdAt", "updatedAt"
  ]
};
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
const YOUTUBE_LANGUAGE_CONFIG = {
  english: {
    aliases: ["english", "ingles", "en us", "en gb", "eng"],
    youtubeLanguage: "en",
    regionCode: "US",
    karaokeTerms: "karaoke lyrics on screen instrumental",
    lyricsTerms: "lyrics on screen",
    markers: ["english lyrics", "english karaoke"]
  },
  spanish: {
    aliases: [
      "spanish", "espanol", "castellano", "latinoamerica", "latin america",
      "latino", "latina", "es 419", "spa"
    ],
    youtubeLanguage: "es",
    regionCode: "MX",
    karaokeTerms: "karaoke letra en pantalla instrumental",
    lyricsTerms: "letra en pantalla",
    markers: ["karaoke espanol", "karaoke latino", "letra en pantalla", "con letra"]
  },
  french: {
    aliases: ["french", "francais", "france", "fra"],
    youtubeLanguage: "fr",
    regionCode: "FR",
    karaokeTerms: "karaoke paroles a l ecran instrumental",
    lyricsTerms: "paroles a l ecran",
    markers: ["karaoke francais", "paroles", "version francaise"]
  },
  portuguese: {
    aliases: ["portuguese", "portugues", "brasil", "brazil", "pt br", "por"],
    youtubeLanguage: "pt",
    regionCode: "BR",
    karaokeTerms: "karaoke letra na tela instrumental",
    lyricsTerms: "letra na tela",
    markers: ["karaoke portugues", "karaoke brasil", "letra na tela"]
  },
  german: {
    aliases: ["german", "deutsch", "aleman", "deutschland", "deu"],
    youtubeLanguage: "de",
    regionCode: "DE",
    karaokeTerms: "karaoke songtext instrumental",
    lyricsTerms: "songtext",
    markers: ["karaoke deutsch", "songtext", "deutsche version"]
  },
  italian: {
    aliases: ["italian", "italiano", "italia", "ita"],
    youtubeLanguage: "it",
    regionCode: "IT",
    karaokeTerms: "karaoke testo sullo schermo base musicale",
    lyricsTerms: "testo sullo schermo",
    markers: ["karaoke italiano", "testo", "base musicale"]
  },
  russian: {
    aliases: ["russian", "ruso", "русскии", "русский", "russia", "rus"],
    youtubeLanguage: "ru",
    regionCode: "RU",
    karaokeTerms: "караоке текст песни минус",
    lyricsTerms: "текст песни",
    markers: ["караоке", "текст песни", "минус"]
  }
};

function doGet(e) {
  resetV4RuntimeCache_();
  const params = (e && e.parameter) || {};
  const v4Response = publicGetV4_(params);
  if (v4Response !== null) return jsonp_(v4Response, params.callback);
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
  resetV4RuntimeCache_();
  let body;
  try {
    body = JSON.parse((e && e.postData && e.postData.contents) || "{}");
  } catch (error) {
    return json_({ ok: false, code: "INVALID_REQUEST" });
  }

  // Multi-hotel reads, device heartbeats and command polling must not queue
  // behind an unrelated hotel. Each v4 handler validates its own tenant and
  // uses append/update operations scoped to the master or the hotel Sheet.
  const v4Response = dispatchV4Action_(body);
  if (v4Response !== null) return json_(v4Response);

  // Keep the legacy/public submission path atomic so duplicate detection,
  // append and accumulated-time calculation remain one transaction.
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    if (body.action) return hostAction_(body);

    const publicContext = configurePublicRequestContextV4_(body);
    if (publicContext && publicContext.error) {
      return json_({ ok: false, code: publicContext.error });
    }

    const cfg = config_();
    if (!cfg.accepting) return json_({ ok: false, code: "CLOSED" });
    if (!body.name || !body.song || !body.artist || !body.language) {
      return json_({ ok: false, code: "MISSING_FIELDS" });
    }

    const duplicateWarning = requestDuplicateWarning_(body);
    if (
      !body.confirmDuplicate &&
      (duplicateWarning.repeatedSinger || duplicateWarning.duplicateSong)
    ) {
      return json_({
        ok: false,
        code: "DUPLICATE_CONFIRMATION_REQUIRED",
        duplicates: duplicateWarning,
        state: publicState_()
      });
    }

    const requestedLanguage = body.languageCode || body.language;
    if (publicContext && publicContext.activity) {
      const requestedLanguageCode = activityLanguageCodeV4_(requestedLanguage);
      const allowedLanguages = normalizeActivityLanguagesV4_(
        publicContext.activity.allowedLanguagesJson
      );
      if (!requestedLanguageCode || allowedLanguages.indexOf(requestedLanguageCode) < 0) {
        return json_({
          ok: false,
          code: "LANGUAGE_NOT_ALLOWED",
          state: publicExperienceStateV4_(publicContext.hotel)
        });
      }
    }
    const song = findSong_(body.song, body.artist, requestedLanguage);
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
      remainingSeconds / 86400, song.url, "Pendiente", requestId, "", new Date(),
      publicContext ? publicContext.hotel.hotelId : "",
      publicContext && publicContext.venue ? publicContext.venue.venueId : "",
      publicContext && publicContext.activity ? publicContext.activity.activityId : "",
      publicContext && publicContext.activity ? publicContext.activity.currentCycleId : "",
      "public_request", "", youtubeLanguageKey_(requestedLanguage), "", "pending", "", 1
    ]);

    const row = sheet.getLastRow();
    sheet.getRange(row, 7, 1, 4).setNumberFormat("[h]:mm:ss");
    writeActivityTimes_(accumulatedSeconds, remainingSeconds);
    return json_({
      ok: true,
      id: requestId,
      state: publicContext
        ? publicExperienceStateV4_(publicContext.hotel)
        : publicState_()
    });
  } catch (error) {
    return json_({ ok: false, error: String(error) });
  } finally {
    REQUEST_DATA_SHEET_ID_ = "";
    lock.releaseLock();
  }
}

function hostAction_(body) {
  if (!validPin_(body.pin)) return json_({ ok: false, code: "INVALID_PIN" });
  const source = stateSource_(body.source);

  if (body.action === "bridgeControl") {
    const control = String(body.control || "").toLowerCase();
    if (["start", "open", "close", "reset"].indexOf(control) < 0) {
      return json_({ ok: false, code: "INVALID_CONTROL" });
    }
    if (control === "start") {
      startActivity_(source);
    } else if (control === "open") {
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
  } else if (body.action === "start") {
    startActivity_(source);
  } else if (body.action === "open") {
    setAccepting_(true, source);
  } else if (body.action === "close") {
    setAccepting_(false, source);
  } else if (body.action === "reset") {
    resetActivity_(source);
  } else if (body.action === "publicStatusVisibility") {
    setPublicStatusVisibility_(body.show === true, source);
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
    const requestedLanguage = body.languageCode || body.language;
    return json_({
      ok: true,
      state: publicState_(),
      languageCode: youtubeLanguageKey_(requestedLanguage),
      items: findKaraokeCandidates_(body.song, body.artist, requestedLanguage)
    });
  } else {
    return json_({ ok: false, code: "INVALID_ACTION" });
  }

  return json_({ ok: true, state: publicState_() });
}

function requestDuplicateWarning_(body) {
  const sheet = spreadsheet_().getSheetByName(REQUESTS);
  const last = sheet.getLastRow();
  const targetSinger = normalizeYoutubeText_(body.name);
  const targetSong = normalizeYoutubeText_(body.song);
  const targetArtist = normalizeYoutubeText_(body.artist);
  const warning = {
    repeatedSinger: false,
    duplicateSong: false,
    duplicateSongState: ""
  };
  if (last < 2 || !targetSinger || !targetSong) return warning;

  const rows = sheet.getRange(2, 2, last - 1, 11).getDisplayValues();
  rows.forEach(function(row) {
    const singer = normalizeYoutubeText_(row[0]);
    const song = normalizeYoutubeText_(row[1]);
    const artist = normalizeYoutubeText_(row[2]);
    const status = normalizeYoutubeText_(row[10]);
    if (singer && singer === targetSinger) warning.repeatedSinger = true;

    const artistMatches =
      !targetArtist ||
      !artist ||
      artist === targetArtist ||
      artist.indexOf(targetArtist) >= 0 ||
      targetArtist.indexOf(artist) >= 0;
    if (song && song === targetSong && artistMatches) {
      warning.duplicateSong = true;
      if (status === "ya canto") {
        warning.duplicateSongState = "completed";
      } else if (warning.duplicateSongState !== "completed") {
        warning.duplicateSongState = "active";
      }
    }
  });
  return warning;
}

function bridgeQueue_() {
  ensureRequestIds_();
  const sheet = spreadsheet_().getSheetByName(REQUESTS);
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const range = sheet.getRange(2, 1, last - 1, HEADERS.length);
  const displayRows = range.getDisplayValues();
  return range.getValues()
    .map(function(row, index) {
      const displayRow = displayRows[index] || [];
      const stamp = row[0] instanceof Date ? row[0].toISOString() : String(row[0] || "");
      return {
        sheetRow: index + 2,
        timestamp: stamp,
        singer: String(row[1] || ""),
        song: String(row[2] || ""),
        artist: String(row[3] || ""),
        comment: String(row[4] || ""),
        language: String(row[5] || ""),
        languageCode: youtubeLanguageKey_(row[5]),
        sourceUrl: String(row[10] || ""),
        status: String(row[11] || "Pendiente"),
        id: String(row[12] || ""),
        fileName: String(row[13] || ""),
        durationSeconds: durationCellSeconds_(row[6], displayRow[6]),
        transitionSeconds: durationCellSeconds_(row[7], displayRow[7]),
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
    const durationSeconds = Math.round(Number(body.durationSeconds));
    let durationChanged = false;
    statusRange.setValue(nextStatus);
    sheet.getRange(row, 14).setValue(clean_(body.fileName));
    sheet.getRange(row, 15).setValue(new Date());
    const sourceUrl = clean_(body.sourceUrl);
    if (
      sourceUrl &&
      /^https:\/\/(?:www\.)?(?:youtube\.com\/watch\?|youtu\.be\/)/i.test(sourceUrl)
    ) {
      sheet.getRange(row, 11).setValue(sourceUrl);
    }
    if (
      isFinite(durationSeconds) &&
      durationSeconds >= 30 &&
      durationSeconds <= 12 * 60 * 60
    ) {
      const durationRange = sheet.getRange(row, 7);
      const previousDuration = durationCellSeconds_(
        durationRange.getValue(),
        durationRange.getDisplayValue()
      );
      if (Math.abs(previousDuration - durationSeconds) >= 1) {
        durationRange
          .setValue(durationSeconds / 86400)
          .setNumberFormat("[h]:mm:ss");
        durationChanged = true;
      }
    }
    if (
      durationChanged ||
      skippedStatus_(previousStatus) !== skippedStatus_(nextStatus)
    ) {
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
  cfg.getRange("B7").clearContent();
  touchState_("reset", source, true);
}

function startActivity_(source) {
  const cfg = spreadsheet_().getSheetByName(CONFIG);
  ensureBaseConfig_(cfg);
  ensureConfigState_(cfg);
  const current = cfg.getRange("B7").getValue();
  if (current instanceof Date && isFinite(current.getTime())) return;
  cfg.getRange("B4").setValue(true);
  cfg.getRange("B7").setValue(new Date());
  recalculateActivity_();
  touchState_("start", source, false);
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

function setPublicStatusVisibility_(show, source) {
  const cfg = spreadsheet_().getSheetByName(CONFIG);
  ensureConfigState_(cfg);
  const current = cfg.getRange("B13").getValue() === true;
  const next = Boolean(show);
  cfg.getRange("B13").setValue(next);
  if (current !== next) {
    touchState_(next ? "showPublicStatus" : "hidePublicStatus", source, false);
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
    activityRunning: cfg.activityRunning,
    showPublicStatus: cfg.showPublicStatus,
    queuePeopleCount: activeQueuePeopleCount_(),
    stateRevision: cfg.stateRevision,
    activityId: cfg.activityId,
    updatedAt: cfg.updatedAt,
    lastAction: cfg.lastAction,
    lastSource: cfg.lastSource
  };
}

function activityAwareStateV4_(activity) {
  const state = publicState_();
  let finishedAt = "";
  if (activity && activity.currentCycleId) {
    const cycle = findRecordV4_(
      spreadsheet_(),
      "ActivityCycles",
      V4_HOTEL_TABLES.ActivityCycles,
      "cycleId",
      activity.currentCycleId
    );
    finishedAt = cycle ? String(cycle.finishedAt || "") : "";
  }
  state.activityFinishedAt = finishedAt;
  if (activity && String(activity.status || "") === "finished") {
    state.activityRunning = false;
    state.accepting = false;
  }
  return state;
}

function config_() {
  const sheet = spreadsheet_().getSheetByName(CONFIG);
  ensureBaseConfig_(sheet);
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
    activityRunning:
      started instanceof Date && isFinite(started.getTime()),
    showPublicStatus: sheet.getRange("B13").getValue() === true,
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
    activityRunning: cfg.activityRunning,
    showPublicStatus: cfg.showPublicStatus,
    stateRevision: cfg.stateRevision,
    activityId: cfg.activityId,
    updatedAt: cfg.updatedAt,
    lastAction: cfg.lastAction,
    lastSource: cfg.lastSource
  };
}

function activeQueuePeopleCount_() {
  const sheet = spreadsheet_().getSheetByName(REQUESTS);
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const rows = sheet.getRange(2, 2, last - 1, 11).getDisplayValues();
  const people = {};
  rows.forEach(function(row) {
    const singer = normalizeYoutubeText_(row[0]);
    const status = normalizeYoutubeText_(row[10]);
    if (!singer) return;
    if (
      status === "ya canto" ||
      status === "completada" ||
      status === "saltado" ||
      status === "omitida"
    ) return;
    people[singer] = true;
  });
  return Object.keys(people).length;
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

function durationCellSeconds_(value, displayValue) {
  const displayed = parseDurationText_(displayValue);
  if (displayed !== null) return displayed;
  if (
    typeof value === "number" &&
    isFinite(value) &&
    value >= 0 &&
    value <= MAX_ACTIVITY_SECONDS / 86400
  ) {
    return Math.round(value * 86400);
  }
  if (value instanceof Date) {
    try {
      const timeZone = spreadsheet_().getSpreadsheetTimeZone();
      const formatted = Utilities.formatDate(value, timeZone, "HH:mm:ss");
      const parsed = parseDurationText_(formatted);
      if (parsed !== null) return parsed;
    } catch (error) {
      // Las llamadas principales entregan displayValue; este respaldo evita
      // convertir una fecha de 1899 usando el desfase histórico de la zona.
    }
    return 0;
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
    const requestRange = requests.getRange(2, 7, rowCount, 6);
    const rows = requestRange.getValues();
    const displayRows = requestRange.getDisplayValues();
    const totals = [];
    const totalSeconds = Math.round(
      boundedNumber_(cfg.getRange("B2").getValue(), 2, 0.25, 168) * 3600
    );
    rows.forEach(function(row, index) {
      const displayRow = displayRows[index] || [];
      if (!skippedStatus_(row[5])) {
        accumulatedSeconds += durationCellSeconds_(row[0], displayRow[0]);
        accumulatedSeconds += durationCellSeconds_(row[1], displayRow[1]);
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

function findSong_(title, artist, language) {
  const preferred = findKaraokeCandidates_(title, artist, language)[0];
  if (!preferred) return { seconds: 240, url: "", found: false };
  return {
    seconds: Math.max(30, Number(preferred.durationSeconds) || 240),
    url: String(preferred.url || ""),
    found: Boolean(preferred.url),
    resultType: String(preferred.resultType || ""),
    channel: String(preferred.channel || "")
  };
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
  if (!value) return "";
  const keys = Object.keys(YOUTUBE_LANGUAGE_CONFIG);
  for (let index = 0; index < keys.length; index++) {
    const code = keys[index];
    if (value === code) return code;
    const aliases = YOUTUBE_LANGUAGE_CONFIG[code].aliases || [];
    for (let aliasIndex = 0; aliasIndex < aliases.length; aliasIndex++) {
      if (value === normalizeYoutubeText_(aliases[aliasIndex])) return code;
    }
  }
  return "";
}

function youtubeSearchTerms_(languageKey, lyricsOnly) {
  const profile = YOUTUBE_LANGUAGE_CONFIG[languageKey];
  if (!profile) return "";
  return lyricsOnly ? profile.lyricsTerms : profile.karaokeTerms;
}

function youtubeLanguageEvidence_(label, channel, languageKey) {
  const selected = YOUTUBE_LANGUAGE_CONFIG[languageKey];
  if (!selected) {
    return { match: false, conflict: false, detected: [] };
  }
  const text = normalizeYoutubeText_(label);
  const detected = [];
  Object.keys(YOUTUBE_LANGUAGE_CONFIG).forEach(function(code) {
    const profile = YOUTUBE_LANGUAGE_CONFIG[code];
    const markers = (profile.markers || []).concat(profile.aliases || []);
    if (markers.some(function(marker) {
      const normalizedMarker = normalizeYoutubeText_(marker);
      return normalizedMarker &&
        (" " + text + " ").indexOf(" " + normalizedMarker + " ") >= 0;
    })) {
      detected.push(code);
    }
  });
  const priority = youtubeChannelPriority_(channel, languageKey);
  const channelMatch = Boolean(priority.label);
  return {
    match: channelMatch || detected.indexOf(languageKey) >= 0,
    conflict:
      !channelMatch && detected.some(function(code) { return code !== languageKey; }),
    detected: detected
  };
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
  const languageKey = youtubeLanguageKey_(language);
  if (!languageKey) return [];
  const key = youtubeKey_();
  if (!key || !title) return [];
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
  const profile = YOUTUBE_LANGUAGE_CONFIG[languageKey] || null;
  const searchUrl =
    "https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=25&q=" +
    query +
    (profile ? "&relevanceLanguage=" + encodeURIComponent(profile.youtubeLanguage) : "") +
    (profile ? "&regionCode=" + encodeURIComponent(profile.regionCode) : "") +
    "&key=" + encodeURIComponent(key);
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
      languageKey
    );
    const languageEvidence = youtubeLanguageEvidence_(
      label + " " + description,
      channel,
      languageKey
    );
    const seconds = isoSeconds_(item.contentDetails.duration);
    const views = Math.max(
      0,
      Number(item.statistics && item.statistics.viewCount) || 0
    );
    let score = 0;
    const hasKaraoke = /karaok[eé]|караоке/.test(lower);
    const hasLyrics =
      /lyrics?|letra|paroles|songtext|testo|текст|subtitul|on.?screen|sing.?along|na tela|sullo schermo/.test(searchable);
    const hasInstrumental = /instrumental|base musicale|минус/.test(lower);
    const hasKaraokeVersion = /karaok[eé]\s*(version|track)/.test(lower);
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
    if (languageEvidence.match) score += 36;
    if (languageEvidence.conflict) score -= 90;
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
      languagePriority: languageKey,
      languageMatch: languageEvidence.match,
      languageConflict: languageEvidence.conflict,
      detectedLanguages: languageEvidence.detected,
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
      !item.languageConflict &&
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
  const defaults = [
    ["Configuración", "Valor"],
    ["Duración total (horas)", 2],
    ["Transición por participante (segundos)", 30],
    ["Aceptar solicitudes", true],
    ["Tiempo acumulado", 0],
    ["Tiempo restante", 2 / 24],
    ["Inicio de la actividad", ""]
  ];
  const range = sheet.getRange("A1:B7");
  const values = range.getValues();
  const legacyStartLabel = String(values[6][0] || "");
  let changed = false;
  for (let index = 0; index < defaults.length; index++) {
    if (String(values[index][0] || "") !== defaults[index][0]) {
      values[index][0] = defaults[index][0];
      changed = true;
    }
    if (
      index !== 6 &&
      (values[index][1] === "" || values[index][1] === null)
    ) {
      values[index][1] = defaults[index][1];
      changed = true;
    }
  }
  if (
    legacyStartLabel &&
    legacyStartLabel !== defaults[6][0]
  ) {
    values[6][1] = "";
    changed = true;
  }
  if (changed) range.setValues(values);
  sheet.getRange("B5:B6").setNumberFormat("[h]:mm:ss");
}

function ensureConfigState_(sheet) {
  const labels = [
    ["Versión del estado"],
    ["ID de actividad"],
    ["Último cambio de estado"],
    ["Última acción"],
    ["Origen del cambio"],
    ["Mostrar estado público"]
  ];
  const labelRange = sheet.getRange("A8:A13");
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
  const publicStatus = sheet.getRange("B13").getValue();
  if (publicStatus === "" || publicStatus === null) {
    sheet.getRange("B13").setValue(false);
  }
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

function iniciarActividad() {
  startActivity_("sheet");
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
    .addItem("Authorize Required Google Access", "authorizeGuestStarV4")
    .addItem("Set Up or Recover Superhost Access", "setupOrRecoverSuperhostV4")
    .addItem("Reset Superhost Temporary Password", "resetSuperhostPasswordV4")
    .addSeparator()
    .addItem("Configurar PIN y YouTube", "configurarCredenciales")
    .addItem("Preparar / reparar Guest Star Bridge", "setup")
    .addItem("Recalcular tiempos", "recalcularTiempos")
    .addSeparator()
    .addItem("Iniciar actividad", "iniciarActividad")
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
  const properties = PropertiesService.getScriptProperties();
  const dataSheetId =
    REQUEST_DATA_SHEET_ID_ ||
    properties.getProperty("LEGACY_DATA_SHEET_ID") ||
    properties.getProperty("MASTER_SHEET_ID") ||
    SHEET_ID;
  return SpreadsheetApp.openById(dataSheetId);
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

// -----------------------------------------------------------------------------
// Guest Star Experience 4.0: central Superhost registry and hotel provisioning.
// The web app is deployed once from the Superhost account and executes as owner.
// Each hotel receives an independent spreadsheet created in the Superhost Drive.
// -----------------------------------------------------------------------------

function masterSpreadsheetV4_() {
  if (V4_REQUEST_MASTER_SPREADSHEET_) return V4_REQUEST_MASTER_SPREADSHEET_;
  const properties = PropertiesService.getScriptProperties();
  const masterId = properties.getProperty("MASTER_SHEET_ID");
  if (masterId) {
    V4_REQUEST_MASTER_SPREADSHEET_ = SpreadsheetApp.openById(masterId);
    return V4_REQUEST_MASTER_SPREADSHEET_;
  }
  const active = SpreadsheetApp.getActiveSpreadsheet();
  V4_REQUEST_MASTER_SPREADSHEET_ = active || SpreadsheetApp.openById(SHEET_ID);
  return V4_REQUEST_MASTER_SPREADSHEET_;
}

function resetV4RuntimeCache_() {
  V4_REQUEST_MASTER_SPREADSHEET_ = null;
  V4_REQUEST_TABLE_ROWS_ = {};
  V4_REQUEST_TABLE_SHEETS_ = {};
}

function tableCacheKeyV4_(spreadsheet, tableName) {
  let spreadsheetId = "spreadsheet";
  try {
    spreadsheetId = spreadsheet.getId();
  } catch (error) {
    // Unit-test doubles may not implement getId().
  }
  return String(spreadsheetId || "spreadsheet") + ":" + String(tableName || "");
}

function isoNowV4_() {
  return new Date().toISOString();
}

function normalizeIdentifierV4_(value) {
  let text = String(value || "").toLowerCase();
  if (text.normalize) text = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return text.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
}

function activityLanguageCodeV4_(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "es" || raw === "spanish" || raw === "español") return "es";
  if (raw === "en" || raw === "english" || raw === "inglés") return "en";
  return "";
}

function normalizeActivityLanguagesV4_(value) {
  let requested = value;
  if (typeof requested === "string") {
    try {
      requested = JSON.parse(requested || "[]");
    } catch (error) {
      requested = requested.split(",");
    }
  }
  if (!Array.isArray(requested)) requested = [];
  const normalized = [];
  requested.forEach(function(language) {
    const code = activityLanguageCodeV4_(language);
    if (code && normalized.indexOf(code) < 0) normalized.push(code);
  });
  return normalized.length ? normalized : ["es", "en"];
}

function activityWithLanguagesV4_(activity) {
  if (!activity) return null;
  return Object.assign({}, activity, {
    allowedLanguages: normalizeActivityLanguagesV4_(activity.allowedLanguagesJson)
  });
}

function randomTokenV4_(length) {
  const size = Math.max(12, Math.min(128, Number(length) || 32));
  let value = "";
  while (value.length < size) {
    value += Utilities.getUuid().replace(/-/g, "") +
      Utilities.base64EncodeWebSafe(Utilities.getUuid()).replace(/=+$/g, "");
  }
  return value.slice(0, size);
}

function bytesToHexV4_(bytes) {
  return bytes.map(function(byte) {
    const unsigned = byte < 0 ? byte + 256 : byte;
    return ("0" + unsigned.toString(16)).slice(-2);
  }).join("");
}

function hashSecretV4_(secret, salt) {
  return bytesToHexV4_(Utilities.computeHmacSha256Signature(
    String(secret || ""),
    String(salt || "")
  ));
}

function safeEqualV4_(left, right) {
  const a = String(left || "");
  const b = String(right || "");
  if (a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index++) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}

function ensureTableV4_(spreadsheet, name, headers) {
  const cacheKey = tableCacheKeyV4_(spreadsheet, name);
  if (V4_REQUEST_TABLE_SHEETS_[cacheKey]) {
    return V4_REQUEST_TABLE_SHEETS_[cacheKey];
  }
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  ensureSheetWidth_(sheet, headers.length);
  const current = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  let changed = false;
  const next = headers.map(function(header, index) {
    if (current[index] !== header) changed = true;
    return header;
  });
  if (changed) sheet.getRange(1, 1, 1, headers.length).setValues([next]);
  sheet.setFrozenRows(1);
  V4_REQUEST_TABLE_SHEETS_[cacheKey] = sheet;
  return sheet;
}

function tableRowsV4_(spreadsheet, tableName, headers) {
  const cacheKey = tableCacheKeyV4_(spreadsheet, tableName);
  if (Object.prototype.hasOwnProperty.call(V4_REQUEST_TABLE_ROWS_, cacheKey)) {
    return V4_REQUEST_TABLE_ROWS_[cacheKey];
  }
  const sheet = ensureTableV4_(spreadsheet, tableName, headers);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    V4_REQUEST_TABLE_ROWS_[cacheKey] = [];
    return V4_REQUEST_TABLE_ROWS_[cacheKey];
  }
  V4_REQUEST_TABLE_ROWS_[cacheKey] = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues()
    .map(function(values, index) {
      const record = { _row: index + 2 };
      headers.forEach(function(header, column) {
        const value = values[column];
        record[header] = value instanceof Date ? value.toISOString() : value;
      });
      return record;
    });
  return V4_REQUEST_TABLE_ROWS_[cacheKey];
}

function appendRecordV4_(spreadsheet, tableName, headers, record) {
  const sheet = ensureTableV4_(spreadsheet, tableName, headers);
  sheet.appendRow(headers.map(function(header) {
    return record[header] === undefined ? "" : record[header];
  }));
  delete V4_REQUEST_TABLE_ROWS_[tableCacheKeyV4_(spreadsheet, tableName)];
  return Object.assign({}, record, { _row: sheet.getLastRow() });
}

function updateRecordV4_(spreadsheet, tableName, headers, row, changes) {
  const sheet = ensureTableV4_(spreadsheet, tableName, headers);
  const range = sheet.getRange(row, 1, 1, headers.length);
  const values = range.getValues()[0];
  headers.forEach(function(header, index) {
    if (Object.prototype.hasOwnProperty.call(changes, header)) {
      values[index] = changes[header];
    }
  });
  range.setValues([values]);
  delete V4_REQUEST_TABLE_ROWS_[tableCacheKeyV4_(spreadsheet, tableName)];
}

function findRecordV4_(spreadsheet, tableName, headers, field, value) {
  const target = String(value || "");
  return tableRowsV4_(spreadsheet, tableName, headers).filter(function(record) {
    return String(record[field] || "") === target;
  })[0] || null;
}

function ensureMasterTablesV4_(spreadsheet) {
  Object.keys(V4_MASTER_TABLES).forEach(function(name) {
    ensureTableV4_(spreadsheet, name, V4_MASTER_TABLES[name]);
  });
  const settings = findRecordV4_(
    spreadsheet,
    "GlobalSettings",
    V4_MASTER_TABLES.GlobalSettings,
    "settingKey",
    "schemaVersion"
  );
  if (!settings) {
    appendRecordV4_(spreadsheet, "GlobalSettings", V4_MASTER_TABLES.GlobalSettings, {
      settingKey: "schemaVersion",
      settingValue: V4_SCHEMA_VERSION,
      updatedAt: isoNowV4_()
    });
  } else if (String(settings.settingValue) !== V4_SCHEMA_VERSION) {
    updateRecordV4_(spreadsheet, "GlobalSettings", V4_MASTER_TABLES.GlobalSettings, settings._row, {
      settingValue: V4_SCHEMA_VERSION,
      updatedAt: isoNowV4_()
    });
  }
}

function hotelDataFolderV4_() {
  const properties = PropertiesService.getScriptProperties();
  const existingId = properties.getProperty("HOTEL_DATA_FOLDER_ID");
  if (existingId) {
    try {
      return DriveApp.getFolderById(existingId);
    } catch (error) {
      // The folder may have been moved or removed; create a recoverable replacement.
    }
  }
  const folder = DriveApp.createFolder("Guest Star Experience - Hotel Data");
  properties.setProperty("HOTEL_DATA_FOLDER_ID", folder.getId());
  return folder;
}

function initializeHotelDataV4_(spreadsheet, hotel) {
  const requests = ensureTableV4_(spreadsheet, REQUESTS, HEADERS);
  const history = ensureTableV4_(spreadsheet, HISTORY, HEADERS);
  const config = spreadsheet.getSheetByName(CONFIG) || spreadsheet.insertSheet(CONFIG);
  requests.setFrozenRows(1);
  history.setFrozenRows(1);
  ensureBaseConfig_(config);
  ensureConfigState_(config);
  Object.keys(V4_HOTEL_TABLES).forEach(function(name) {
    ensureTableV4_(spreadsheet, name, V4_HOTEL_TABLES[name]);
  });
  const hotelConfig = [
    ["Hotel ID", hotel.hotelId],
    ["Hotel", hotel.name],
    ["Permanent public URL", hotel.publicUrl],
    ["Timezone", hotel.timezone],
    ["Schema version", V4_SCHEMA_VERSION]
  ];
  config.getRange(15, 1, hotelConfig.length, 2).setValues(hotelConfig);
  try {
    spreadsheet.setSpreadsheetTimeZone(hotel.timezone || "America/Santo_Domingo");
  } catch (error) {
    spreadsheet.setSpreadsheetTimeZone("America/Santo_Domingo");
  }
}

function copyLegacyHotelDataV4_(source, target) {
  [REQUESTS, HISTORY, CONFIG].forEach(function(name) {
    const sourceSheet = source.getSheetByName(name);
    if (!sourceSheet) return;
    const existing = target.getSheetByName(name);
    if (existing) target.deleteSheet(existing);
    const copied = sourceSheet.copyTo(target);
    copied.setName(name);
  });
}

function createHotelSpreadsheetV4_(hotel, legacySource, destinationFolder) {
  let spreadsheet = null;
  try {
    spreadsheet = SpreadsheetApp.create("Guest Star - " + hotel.name);
    const first = spreadsheet.getSheets()[0];
    if (legacySource) copyLegacyHotelDataV4_(legacySource, spreadsheet);
    initializeHotelDataV4_(spreadsheet, hotel);
    if (
      first &&
      spreadsheet.getSheets().length > 1 &&
      !first.getLastRow() &&
      first.getName() !== REQUESTS &&
      first.getName() !== HISTORY &&
      first.getName() !== CONFIG
    ) {
      spreadsheet.deleteSheet(first);
    }
    if (!legacySource) {
      spreadsheet.getSheetByName(CONFIG).getRange("B4").setValue(false);
    }
  } catch (error) {
    if (spreadsheet && destinationFolder) {
      try {
        DriveApp.getFileById(spreadsheet.getId()).setTrashed(true);
      } catch (cleanupError) {
        console.error(JSON.stringify({
          event: "hotel.sheet.cleanup.failed",
          detail: String(cleanupError && cleanupError.message ? cleanupError.message : cleanupError).slice(0, 500)
        }));
      }
    }
    throw error;
  }
  if (destinationFolder) {
    try {
      DriveApp.getFileById(spreadsheet.getId()).moveTo(destinationFolder);
    } catch (error) {
      console.error(JSON.stringify({
        event: "hotel.sheet.folderMove.skipped",
        spreadsheetId: spreadsheet.getId(),
        detail: String(error && error.message ? error.message : error).slice(0, 500)
      }));
    }
  }
  return spreadsheet.getId();
}

function publicBaseUrlV4_() {
  const configured = PropertiesService.getScriptProperties().getProperty("PUBLIC_BASE_URL");
  return String(configured || V4_PUBLIC_BASE_URL).replace(/\/+$/, "");
}

function uniqueSlugV4_(master, requested, ignoredHotelId) {
  const base = normalizeIdentifierV4_(requested) || "hotel";
  const hotels = tableRowsV4_(master, "Hotels", V4_MASTER_TABLES.Hotels);
  let candidate = base;
  let suffix = 2;
  while (hotels.some(function(hotel) {
    return hotel.hotelId !== ignoredHotelId && hotel.slug === candidate;
  })) {
    candidate = base + "-" + suffix;
    suffix += 1;
  }
  return candidate;
}

function uniqueUserSlugV4_(master, requested, ignoredUserId) {
  const base = normalizeIdentifierV4_(requested) || "host";
  const users = tableRowsV4_(master, "Users", V4_MASTER_TABLES.Users);
  let candidate = base;
  let suffix = 2;
  while (users.some(function(user) {
    return user.userId !== ignoredUserId && user.staticHostSlug === candidate;
  })) {
    candidate = base + "-" + suffix;
    suffix += 1;
  }
  return candidate;
}

function createHotelQrV4_(hotel, folder) {
  try {
    const response = UrlFetchApp.fetch(
      "https://quickchart.io/qr?size=900&margin=2&format=png&text=" +
        encodeURIComponent(hotel.publicUrl),
      { muteHttpExceptions: true }
    );
    if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) return "";
    const file = folder.createFile(
      response.getBlob().setName("Guest-Star-QR-" + hotel.slug + ".png")
    );
    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (sharingError) {
      // Workspace policies may forbid public Drive files; authenticated download still works.
    }
    return file.getId();
  } catch (error) {
    return "";
  }
}

function createSuperhostV4_(master) {
  const users = tableRowsV4_(master, "Users", V4_MASTER_TABLES.Users);
  const existing = users.filter(function(user) { return user.role === "superhost"; })[0];
  if (existing) return { user: existing, temporaryPassword: "", created: false };
  const properties = PropertiesService.getScriptProperties();
  const ownerEmail = String(
    properties.getProperty("SUPERHOST_EMAIL") || Session.getEffectiveUser().getEmail() || ""
  ).trim().toLowerCase();
  const requestedUsername = properties.getProperty("SUPERHOST_USERNAME") ||
    (ownerEmail ? ownerEmail.split("@")[0] : "superhost");
  const username = normalizeIdentifierV4_(requestedUsername).replace(/-/g, ".") || "superhost";
  const temporaryPassword = randomTokenV4_(18);
  const salt = randomTokenV4_(32);
  const now = isoNowV4_();
  const user = appendRecordV4_(master, "Users", V4_MASTER_TABLES.Users, {
    userId: Utilities.getUuid(),
    username: username,
    displayName: properties.getProperty("SUPERHOST_DISPLAY_NAME") || "Superhost",
    email: ownerEmail,
    passwordHash: hashSecretV4_(temporaryPassword, salt),
    passwordSalt: salt,
    role: "superhost",
    status: "active",
    staticHostSlug: uniqueUserSlugV4_(master, username, ""),
    mustChangePassword: true,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: "",
    passwordUpdatedAt: now
  });
  return { user: user, temporaryPassword: temporaryPassword, created: true };
}

function createInitialHotelV4_(master, superhost, legacySource) {
  const hotels = tableRowsV4_(master, "Hotels", V4_MASTER_TABLES.Hotels);
  if (hotels.length) return { hotel: hotels[0], created: false };
  const properties = PropertiesService.getScriptProperties();
  const name = clean_(properties.getProperty("INITIAL_HOTEL_NAME") || "Initial Hotel");
  const requestedTimezone = clean_(properties.getProperty("INITIAL_HOTEL_TIMEZONE") ||
    legacySource.getSpreadsheetTimeZone() || "America/Santo_Domingo");
  const timezone = validTimezoneV4_(requestedTimezone)
    ? requestedTimezone
    : "America/Santo_Domingo";
  const now = isoNowV4_();
  const hotelId = Utilities.getUuid();
  const slug = uniqueSlugV4_(master, name, "");
  const publicCode = randomTokenV4_(20);
  const publicUrl = publicBaseUrlV4_() + "/h/" + slug + "-" + publicCode;
  const provisionalHotel = {
    hotelId: hotelId,
    name: name,
    slug: slug,
    publicCode: publicCode,
    publicUrl: publicUrl,
    qrFileId: "",
    qrVersion: 1,
    activePublicActivityId: "",
    timezone: timezone,
    dataSheetId: "",
    status: "active",
    createdAt: now,
    updatedAt: now
  };
  const driveReadiness = guestStarDriveReadinessV4_(master);
  const destinationFolder = driveReadiness.ok ? driveReadiness.folder : null;
  const dataSheetId = createHotelSpreadsheetV4_(
    provisionalHotel,
    legacySource,
    destinationFolder
  );
  const venueId = Utilities.getUuid();
  const activityId = Utilities.getUuid();
  provisionalHotel.dataSheetId = dataSheetId;
  provisionalHotel.activePublicActivityId = activityId;
  provisionalHotel.qrFileId = destinationFolder
    ? createHotelQrV4_(provisionalHotel, destinationFolder)
    : "";
  const hotel = appendRecordV4_(master, "Hotels", V4_MASTER_TABLES.Hotels, provisionalHotel);
  appendRecordV4_(master, "Venues", V4_MASTER_TABLES.Venues, {
    venueId: venueId,
    hotelId: hotelId,
    name: "Main Venue",
    slug: "main-venue",
    status: "active",
    createdAt: now,
    updatedAt: now
  });
  appendRecordV4_(master, "Activities", V4_MASTER_TABLES.Activities, {
    activityId: activityId,
    hotelId: hotelId,
    venueId: venueId,
    name: "Guest Star Karaoke",
    internalCode: "karaoke",
    status: "ready",
    defaultDurationSeconds: 7200,
    defaultTransitionSeconds: 30,
    showPublicStatus: false,
    showCountdown: true,
    scheduledStartAt: "",
    autoStartEnabled: false,
    acceptEarlyRequests: false,
    currentCycleId: "",
    createdAt: now,
    updatedAt: now,
    allowedLanguagesJson: JSON.stringify(["es", "en"])
  });
  appendRecordV4_(master, "UserAssignments", V4_MASTER_TABLES.UserAssignments, {
    assignmentId: Utilities.getUuid(),
    userId: superhost.userId,
    hotelId: hotelId,
    venueId: "",
    activityId: "",
    permissionsJson: JSON.stringify({ all: true }),
    status: "active",
    createdAt: now,
    updatedAt: now
  });
  appendRecordV4_(master, "HotelBranding", V4_MASTER_TABLES.HotelBranding, {
    hotelBrandingId: Utilities.getUuid(),
    hotelId: hotelId,
    teamDisplayName: "Guest Star Team",
    teamType: "Entertainment Team",
    tagline: "Your moment. Your song. Your stage.",
    welcomeMessage: "Choose your song and get ready to be the Guest Star.",
    activityEndingMessage: "Thank you for singing with us.",
    upcomingActivityMessage: "Join us again for the next Guest Star experience.",
    reviewInvitationMessage: "How was your Guest Star experience?",
    generalReviewMessage: "Your feedback helps our team improve.",
    brandTone: "friendly",
    showHotelName: true,
    showHotelLogo: true,
    showTeamIdentity: true,
    showActivityDetails: true,
    showScheduledStart: true,
    showCountdown: true,
    showQueueInformation: false,
    showNextActivity: true,
    showInternalRating: false,
    showExternalReview: false,
    requestGuestName: false,
    requestGuestEmail: false,
    offerFollowUp: false,
    showAddToCalendar: true,
    showRemindMe: false,
    publicMessageTone: "friendly",
    beforeStartClosedTitle: "The stage is getting ready",
    beforeStartClosedMessage: "Requests are not open yet. Please check back soon.",
    beforeStartOpenTitle: "Requests are open",
    beforeStartOpenMessage: "Send your song now and keep this page open for updates.",
    inProgressTitle: "Guest Star is live",
    inProgressMessage: "Enjoy the show and get ready for your turn.",
    requestsClosedTitle: "Requests are now closed",
    requestsClosedMessage: "The current queue will continue until the activity ends.",
    activityFinishedTitle: "Thank you, Guest Stars",
    activityFinishedMessage: "We hope to sing with you again soon.",
    noActivityTitle: "No activity is scheduled",
    noActivityMessage: "Please check back for the next Guest Star experience.",
    reviewPlacement: "after_activity",
    nextActivityPlacement: "after_status",
    contactInvitationPlacement: "after_review",
    externalReviewDestination: "direct",
    guestCanChooseReviewDestination: false,
    updatedAt: now,
    primaryColor: "#ff2d95",
    secondaryColor: "#8b3dff",
    accentColor: "#00c8ff"
  });
  return { hotel: hotel, created: true };
}

function backupLegacySpreadsheetV4_(master) {
  const properties = PropertiesService.getScriptProperties();
  const existing = properties.getProperty("V4_BACKUP_FILE_ID");
  if (existing) return existing;
  const file = DriveApp.getFileById(master.getId());
  const backup = file.makeCopy(
    file.getName() + " - Backup before Guest Star 4.0 - " +
      Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HHmm")
  );
  properties.setProperty("V4_BACKUP_FILE_ID", backup.getId());
  return backup.getId();
}

function escapeHtmlV4_(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function revealTemporaryPasswordV4_(title, username, temporaryPassword) {
  if (!temporaryPassword) return false;
  try {
    const ui = SpreadsheetApp.getUi();
    const safeUsername = escapeHtmlV4_(username);
    const safePassword = escapeHtmlV4_(temporaryPassword);
    const html = HtmlService.createHtmlOutput(
      '<!doctype html><html><head><base target="_top"><style>' +
      'body{margin:0;padding:24px;color:#f7f4ff;background:#090615;font:14px Arial,sans-serif}' +
      'h2{margin:0 0 8px;font-size:22px}p{color:#c9c1d8;line-height:1.5}' +
      'label{display:block;margin-top:16px;color:#ddd5ed;font-size:12px;font-weight:700}' +
      '.row{display:grid;grid-template-columns:1fr auto;gap:8px;margin-top:6px}' +
      'input{min-width:0;border:1px solid #ffffff2c;border-radius:10px;padding:11px;color:#fff;background:#020108;font:14px monospace}' +
      'button{border:1px solid #ffffff2c;border-radius:10px;padding:0 14px;color:#fff;background:#6c3ee8;cursor:pointer}' +
      '.close{width:100%;min-height:42px;margin-top:20px;background:linear-gradient(110deg,#ff2d95,#8b3dff)}' +
      '.warning{color:#ffd493;font-size:12px}' +
      '</style></head><body><h2>Superhost access is ready</h2>' +
      '<p>Copy both values now. This temporary password is shown only once.</p>' +
      '<label>Username or email</label><div class="row"><input id="username" readonly value="' + safeUsername + '">' +
      '<button type="button" onclick="copyField(\'username\')">Copy</button></div>' +
      '<label>Temporary password</label><div class="row"><input id="password" readonly value="' + safePassword + '">' +
      '<button type="button" onclick="copyField(\'password\')">Copy</button></div>' +
      '<p class="warning">Only a secure hash is stored. You will set a permanent password after signing in.</p>' +
      '<button class="close" type="button" onclick="google.script.host.close()">I copied both values</button>' +
      '<script>function copyField(id){var field=document.getElementById(id);field.focus();field.select();' +
      'if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(field.value);}' +
      'else{document.execCommand("copy");}}</script></body></html>'
    ).setWidth(520).setHeight(455);
    ui.showModalDialog(html, title);
    return true;
  } catch (error) {
    try {
      const fallbackUi = SpreadsheetApp.getUi();
      fallbackUi.alert(
        title,
        "Username: " + username + "\n\n" +
          "Temporary password: " + temporaryPassword + "\n\n" +
          "Copy it now. Only its secure hash is stored and this password will not be shown again.",
        fallbackUi.ButtonSet.OK
      );
      return true;
    } catch (fallbackError) {
      // Editor/headless callers still receive the one-time password in the return value.
      return false;
    }
  }
}

function revokeUserAccessV4_(master, userId) {
  const revokedAt = isoNowV4_();
  tableRowsV4_(master, "AuthSessions", V4_MASTER_TABLES.AuthSessions)
    .filter(function(session) { return session.userId === userId && !session.revokedAt; })
    .forEach(function(session) {
      updateRecordV4_(master, "AuthSessions", V4_MASTER_TABLES.AuthSessions, session._row, {
        revokedAt: revokedAt
      });
    });
  tableRowsV4_(master, "Devices", V4_MASTER_TABLES.Devices)
    .filter(function(device) { return device.userId === userId && device.status === "active"; })
    .forEach(function(device) {
      updateRecordV4_(master, "Devices", V4_MASTER_TABLES.Devices, device._row, {
        status: "revoked",
        updatedAt: revokedAt
      });
    });
}

function resetSuperhostPasswordV4() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const master = masterSpreadsheetV4_();
    ensureMasterTablesV4_(master);
    const configuredUsername = String(
      PropertiesService.getScriptProperties().getProperty("SUPERHOST_USERNAME") || "superhost"
    ).trim().toLowerCase();
    const superhosts = tableRowsV4_(master, "Users", V4_MASTER_TABLES.Users)
      .filter(function(user) { return user.role === "superhost" && user.status === "active"; });
    const user = superhosts.find(function(candidate) {
      return String(candidate.username || "").toLowerCase() === configuredUsername;
    }) || superhosts[0];
    if (!user) throw new Error("ACTIVE_SUPERHOST_NOT_FOUND");

    const temporaryPassword = randomTokenV4_(18);
    const salt = randomTokenV4_(32);
    updateRecordV4_(master, "Users", V4_MASTER_TABLES.Users, user._row, {
      passwordHash: hashSecretV4_(temporaryPassword, salt),
      passwordSalt: salt,
      mustChangePassword: true,
      updatedAt: isoNowV4_()
    });
    revokeUserAccessV4_(master, user.userId);
    auditV4_({
      userId: user.userId,
      action: "superhost.password.reset",
      targetId: user.userId
    });
    revealTemporaryPasswordV4_(
      "Guest Star 4.0 — Superhost Password Reset",
      user.username,
      temporaryPassword
    );
    return {
      ok: true,
      username: user.username,
      temporaryPassword: temporaryPassword,
      note: "Copy the temporary password now. It is returned only once and all previous sessions were revoked."
    };
  } finally {
    lock.releaseLock();
  }
}

function setupOrRecoverSuperhostV4() {
  const setupResult = setupMultiUserV4();
  if (
    setupResult && setupResult.superhost && setupResult.superhost.created &&
    setupResult.superhost.temporaryPassword
  ) {
    return setupResult;
  }
  return {
    ok: true,
    setup: setupResult,
    recovery: resetSuperhostPasswordV4()
  };
}

function requireGuestStarScopesV4_() {
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, V4_REQUIRED_OAUTH_SCOPES);
}

function guestStarDriveReadinessV4_(master) {
  try {
    const spreadsheet = master || masterSpreadsheetV4_();
    DriveApp.getFileById(spreadsheet.getId()).getName();
    const folder = hotelDataFolderV4_();
    folder.getName();
    return { ok: true, folder: folder };
  } catch (error) {
    const detail = String(error && error.message ? error.message : error).slice(0, 500);
    console.error(JSON.stringify({
      event: "hotel.drive.readiness.failed",
      detail: detail
    }));
    return { ok: false, detail: detail };
  }
}

function authorizeGuestStarV4() {
  requireGuestStarScopesV4_();
  const master = masterSpreadsheetV4_();
  const file = DriveApp.getFileById(master.getId());
  const driveReadiness = guestStarDriveReadinessV4_(master);
  const result = {
    ok: true,
    codeBuild: GUEST_STAR_CODE_BUILD,
    masterSheetId: master.getId(),
    masterFileName: file.getName(),
    driveFolderReady: driveReadiness.ok,
    note: driveReadiness.ok
      ? "Google Sheets and Drive folder access are authorized. Update the existing web app deployment before returning to the Host Panel."
      : "Google Sheets is authorized. Hotel creation will still work in My Drive even if Drive folder organization is unavailable."
  };
  console.log(JSON.stringify(result));
  try {
    master.toast(
      "Google Sheets and Drive access are authorized. Update the existing web app deployment, then return to the Host Panel.",
      "Guest Star 4.0",
      10
    );
  } catch (error) {
    // A toast is optional; the returned result and run log still confirm success.
  }
  return result;
}

function setupMultiUserV4() {
  requireGuestStarScopesV4_();
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const properties = PropertiesService.getScriptProperties();
    const master = masterSpreadsheetV4_();
    properties.setProperty("MASTER_SHEET_ID", master.getId());
    properties.setProperty("LEGACY_DATA_SHEET_ID", master.getId());
    const backupFileId = backupLegacySpreadsheetV4_(master);
    ensureMasterTablesV4_(master);
    const superhostResult = createSuperhostV4_(master);
    const initialHotelResult = createInitialHotelV4_(master, superhostResult.user, master);
    if (initialHotelResult.hotel.dataSheetId) {
      properties.setProperty("LEGACY_DATA_SHEET_ID", initialHotelResult.hotel.dataSheetId);
    }
    properties.setProperty("DEFAULT_PUBLIC_HOTEL_ID", initialHotelResult.hotel.hotelId);
    properties.setProperty("V4_SETUP_COMPLETE", isoNowV4_());
    ensureAutomationTriggersV4_();
    auditV4_({
      userId: superhostResult.user.userId,
      action: "setupMultiUserV4",
      hotelId: initialHotelResult.hotel.hotelId,
      targetId: initialHotelResult.hotel.dataSheetId,
      details: {
        schemaVersion: V4_SCHEMA_VERSION,
        hotelCreated: initialHotelResult.created,
        superhostCreated: superhostResult.created
      }
    });
    const result = {
      ok: true,
      schemaVersion: V4_SCHEMA_VERSION,
      masterSheetId: master.getId(),
      backupFileId: backupFileId,
      hotel: {
        hotelId: initialHotelResult.hotel.hotelId,
        name: initialHotelResult.hotel.name,
        dataSheetId: initialHotelResult.hotel.dataSheetId,
        publicUrl: initialHotelResult.hotel.publicUrl,
        qrFileId: initialHotelResult.hotel.qrFileId
      },
      superhost: {
        userId: superhostResult.user.userId,
        username: superhostResult.user.username,
        email: superhostResult.user.email,
        created: superhostResult.created,
        temporaryPassword: superhostResult.temporaryPassword || undefined
      },
      note: superhostResult.created
        ? "Copy the temporary password now. It is returned only once and is not stored in plain text."
        : "Migration already exists; no records were duplicated."
    };
    if (superhostResult.created) {
      revealTemporaryPasswordV4_(
        "Guest Star 4.0 — Setup Complete",
        superhostResult.user.username,
        superhostResult.temporaryPassword
      );
    }
    return result;
  } finally {
    lock.releaseLock();
  }
}

function auditV4_(entry) {
  const master = masterSpreadsheetV4_();
  appendRecordV4_(master, "AuditLog", V4_MASTER_TABLES.AuditLog, {
    logId: Utilities.getUuid(),
    userId: entry.userId || "",
    deviceId: entry.deviceId || "",
    action: clean_(entry.action),
    hotelId: entry.hotelId || "",
    venueId: entry.venueId || "",
    activityId: entry.activityId || "",
    targetId: entry.targetId || "",
    detailsJson: JSON.stringify(entry.details || {}),
    createdAt: isoNowV4_()
  });
}

const V4_PERMISSIONS = [
  "canStartActivity", "canFinishActivity", "canStartNewActivity",
  "canArchiveQueue", "canOpenCloseRequests", "canChangeSchedule",
  "canChangeDuration", "canChangeTransition", "canShowHidePublicStatus",
  "canCustomizeGuestMessages", "canControlVirtualDJ", "canCreateActivities",
  "canViewHistory", "canViewReviews", "canDeleteReviews", "canViewGuestContact",
  "canManageHosts", "canManageDevices", "canViewQR", "canDownloadQR",
  "canCopyPublicLink", "canScheduleNextActivity", "canManageRecurrence",
  "canManageHotelBranding", "canManageReviewDestinations"
];

function publicUserV4_(user) {
  if (!user) return null;
  return {
    userId: user.userId,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    status: user.status,
    staticHostSlug: user.staticHostSlug,
    mustChangePassword: user.mustChangePassword === true ||
      String(user.mustChangePassword).toLowerCase() === "true",
    lastLoginAt: user.lastLoginAt || "",
    passwordUpdatedAt: user.passwordUpdatedAt || user.updatedAt || ""
  };
}

function visibleHotelV4_(user, hotel) {
  if (!hotel || (user && user.role === "superhost")) return hotel;
  const safe = {};
  Object.keys(hotel).forEach(function(key) {
    if (key !== "dataSheetId" && key !== "qrFileId" && key !== "_row") {
      safe[key] = hotel[key];
    }
  });
  return safe;
}

function loginRateLimitV4_(identifier, succeeded) {
  const cache = CacheService.getScriptCache();
  const key = "login:" + bytesToHexV4_(Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(identifier || "unknown")
  )).slice(0, 32);
  if (succeeded) {
    cache.remove(key);
    return;
  }
  const attempts = Math.max(0, Number(cache.get(key)) || 0) + 1;
  cache.put(key, String(attempts), 600);
  if (attempts > 5) throw new Error("RATE_LIMITED");
}

function secretSaltV4_() {
  const properties = PropertiesService.getScriptProperties();
  let salt = properties.getProperty("SESSION_HASH_SECRET");
  if (!salt) {
    salt = randomTokenV4_(64);
    properties.setProperty("SESSION_HASH_SECRET", salt);
  }
  return salt;
}

function tokenHashV4_(token) {
  return hashSecretV4_(token, secretSaltV4_());
}

function createSessionV4_(master, user, deviceId, rememberLogin) {
  const token = randomTokenV4_(64);
  const now = new Date();
  const expiresAt = new Date(
    now.getTime() + (rememberLogin === false ? 12 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000)
  );
  const session = appendRecordV4_(master, "AuthSessions", V4_MASTER_TABLES.AuthSessions, {
    authSessionId: Utilities.getUuid(),
    userId: user.userId,
    sessionTokenHash: tokenHashV4_(token),
    deviceId: deviceId || "",
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    lastUsedAt: now.toISOString(),
    revokedAt: ""
  });
  return { token: token, session: session, expiresAt: expiresAt.toISOString() };
}

function registerDeviceV4_(master, user, body) {
  const requestedDeviceId = clean_(body.deviceId);
  let device = requestedDeviceId
    ? findRecordV4_(master, "Devices", V4_MASTER_TABLES.Devices, "deviceId", requestedDeviceId)
    : null;
  if (device && device.userId !== user.userId) {
    throw new Error("DEVICE_NOT_AUTHORIZED");
  }
  const now = isoNowV4_();
  const rawToken = randomTokenV4_(64);
  if (!device) {
    device = appendRecordV4_(master, "Devices", V4_MASTER_TABLES.Devices, {
      deviceId: requestedDeviceId || Utilities.getUuid(),
      deviceName: clean_(body.deviceName || "Guest Star Bridge"),
      userId: user.userId,
      hotelId: "",
      venueId: "",
      activityId: "",
      deviceTokenHash: tokenHashV4_(rawToken),
      status: "active",
      lastHeartbeatAt: now,
      bridgeVersion: clean_(body.bridgeVersion || BRIDGE_API_VERSION),
      virtualDJConnected: false,
      createdAt: now,
      updatedAt: now
    });
  } else {
    updateRecordV4_(master, "Devices", V4_MASTER_TABLES.Devices, device._row, {
      deviceName: clean_(body.deviceName || device.deviceName),
      deviceTokenHash: tokenHashV4_(rawToken),
      status: "active",
      lastHeartbeatAt: now,
      bridgeVersion: clean_(body.bridgeVersion || device.bridgeVersion || BRIDGE_API_VERSION),
      updatedAt: now
    });
  }
  return {
    deviceId: device.deviceId,
    deviceToken: rawToken
  };
}

function loginV4_(body) {
  const master = masterSpreadsheetV4_();
  const identifier = String(body.username || body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!identifier || !password) return { ok: false, code: "MISSING_CREDENTIALS" };
  try {
    loginRateLimitV4_(identifier, false);
  } catch (error) {
    return { ok: false, code: "RATE_LIMITED" };
  }
  const user = tableRowsV4_(master, "Users", V4_MASTER_TABLES.Users).filter(function(candidate) {
    return String(candidate.username || "").toLowerCase() === identifier ||
      String(candidate.email || "").toLowerCase() === identifier;
  })[0];
  const valid = user && user.status === "active" && safeEqualV4_(
    hashSecretV4_(password, user.passwordSalt),
    user.passwordHash
  );
  if (!valid) {
    Utilities.sleep(250);
    auditV4_({ action: "login.failed", details: { identifierHash: tokenHashV4_(identifier) } });
    return { ok: false, code: "INVALID_CREDENTIALS" };
  }
  loginRateLimitV4_(identifier, true);
  let deviceResult = null;
  if (String(body.clientType || "").toLowerCase() === "bridge") {
    try {
      deviceResult = registerDeviceV4_(master, user, body);
    } catch (error) {
      return { ok: false, code: String(error.message || error) };
    }
  }
  const sessionResult = createSessionV4_(
    master,
    user,
    deviceResult ? deviceResult.deviceId : "",
    body.rememberLogin !== false
  );
  updateRecordV4_(master, "Users", V4_MASTER_TABLES.Users, user._row, {
    lastLoginAt: isoNowV4_(),
    updatedAt: isoNowV4_()
  });
  auditV4_({
    userId: user.userId,
    deviceId: deviceResult ? deviceResult.deviceId : "",
    action: "login.succeeded"
  });
  return {
    ok: true,
    codeVersion: BRIDGE_API_VERSION,
    codeBuild: GUEST_STAR_CODE_BUILD,
    authToken: sessionResult.token,
    expiresAt: sessionResult.expiresAt,
    deviceId: deviceResult ? deviceResult.deviceId : "",
    deviceToken: deviceResult ? deviceResult.deviceToken : "",
    user: publicUserV4_(user),
    selection: accessibleSelectionV4_(user)
  };
}

function authenticateV4_(body) {
  const rawToken = String(body.authToken || "");
  if (!rawToken) return null;
  const master = masterSpreadsheetV4_();
  const tokenHash = tokenHashV4_(rawToken);
  const session = tableRowsV4_(master, "AuthSessions", V4_MASTER_TABLES.AuthSessions)
    .filter(function(candidate) {
      return safeEqualV4_(candidate.sessionTokenHash, tokenHash);
    })[0];
  if (!session || session.revokedAt || new Date(session.expiresAt).getTime() <= Date.now()) {
    return null;
  }
  const user = findRecordV4_(master, "Users", V4_MASTER_TABLES.Users, "userId", session.userId);
  if (!user || user.status !== "active") return null;
  let device = null;
  if (session.deviceId) {
    device = findRecordV4_(master, "Devices", V4_MASTER_TABLES.Devices, "deviceId", session.deviceId);
    if (!device || device.status !== "active" || device.userId !== user.userId) return null;
    const providedDeviceToken = String(body.deviceToken || "");
    if (!providedDeviceToken || !safeEqualV4_(
      tokenHashV4_(providedDeviceToken),
      device.deviceTokenHash
    )) return null;
  }
  const lastUsedAt = new Date(session.lastUsedAt).getTime();
  if (!isFinite(lastUsedAt) || Date.now() - lastUsedAt >= 5 * 60 * 1000) {
    updateRecordV4_(master, "AuthSessions", V4_MASTER_TABLES.AuthSessions, session._row, {
      lastUsedAt: isoNowV4_()
    });
  }
  return { master: master, user: user, session: session, device: device };
}

function requireAuthV4_(body) {
  const auth = authenticateV4_(body);
  if (!auth) throw new Error("UNAUTHORIZED");
  return auth;
}

function parsePermissionsV4_(value) {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value || "{}") : value || {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    return {};
  }
}

function assignmentSpecificityV4_(assignment) {
  if (assignment.activityId) return 3;
  if (assignment.venueId) return 2;
  if (assignment.hotelId) return 1;
  return 0;
}

function assignmentMatchesV4_(assignment, context) {
  if (assignment.status !== "active") return false;
  if (assignment.hotelId && assignment.hotelId !== context.hotelId) return false;
  if (assignment.venueId && assignment.venueId !== context.venueId) return false;
  if (assignment.activityId && assignment.activityId !== context.activityId) return false;
  return true;
}

function effectivePermissionsV4_(user, context) {
  const result = {};
  V4_PERMISSIONS.forEach(function(permission) { result[permission] = false; });
  if (user.role === "superhost") {
    V4_PERMISSIONS.forEach(function(permission) { result[permission] = true; });
    result.all = true;
    return result;
  }
  const assignments = tableRowsV4_(
    masterSpreadsheetV4_(),
    "UserAssignments",
    V4_MASTER_TABLES.UserAssignments
  ).filter(function(assignment) {
    return assignment.userId === user.userId && assignmentMatchesV4_(assignment, context);
  }).sort(function(left, right) {
    return assignmentSpecificityV4_(left) - assignmentSpecificityV4_(right);
  });
  assignments.forEach(function(assignment) {
    const permissions = parsePermissionsV4_(assignment.permissionsJson);
    if (permissions.all === true) {
      V4_PERMISSIONS.forEach(function(permission) { result[permission] = true; });
    }
    V4_PERMISSIONS.forEach(function(permission) {
      if (typeof permissions[permission] === "boolean") {
        result[permission] = permissions[permission];
      }
    });
  });
  return result;
}

function resolveTenantContextV4_(auth, requested) {
  const master = auth.master;
  const hotel = findRecordV4_(master, "Hotels", V4_MASTER_TABLES.Hotels, "hotelId", requested.hotelId);
  if (!hotel || hotel.status !== "active") throw new Error("HOTEL_NOT_FOUND");
  const venue = requested.venueId
    ? findRecordV4_(master, "Venues", V4_MASTER_TABLES.Venues, "venueId", requested.venueId)
    : null;
  if (venue && (venue.hotelId !== hotel.hotelId || venue.status !== "active")) {
    throw new Error("VENUE_NOT_FOUND");
  }
  const activity = requested.activityId
    ? findRecordV4_(master, "Activities", V4_MASTER_TABLES.Activities, "activityId", requested.activityId)
    : null;
  if (activity && (
    activity.hotelId !== hotel.hotelId ||
    (venue && activity.venueId !== venue.venueId) ||
    activity.status === "inactive"
  )) throw new Error("ACTIVITY_NOT_FOUND");
  const context = {
    hotelId: hotel.hotelId,
    venueId: venue ? venue.venueId : "",
    activityId: activity ? activity.activityId : ""
  };
  const permissions = effectivePermissionsV4_(auth.user, context);
  if (auth.user.role !== "superhost") {
    const assignments = tableRowsV4_(master, "UserAssignments", V4_MASTER_TABLES.UserAssignments)
      .filter(function(assignment) {
        return assignment.userId === auth.user.userId && assignmentMatchesV4_(assignment, context);
      });
    if (!assignments.length) throw new Error("FORBIDDEN");
  }
  REQUEST_DATA_SHEET_ID_ = hotel.dataSheetId;
  return {
    hotel: hotel,
    venue: venue,
    activity: activity,
    permissions: permissions,
    dataSheetId: hotel.dataSheetId
  };
}

function requirePermissionV4_(context, permission) {
  if (!context.permissions[permission] && !context.permissions.all) {
    throw new Error("FORBIDDEN");
  }
}

function accessibleSelectionV4_(user) {
  const master = masterSpreadsheetV4_();
  const hotels = tableRowsV4_(master, "Hotels", V4_MASTER_TABLES.Hotels)
    .filter(function(hotel) { return hotel.status === "active"; });
  const venues = tableRowsV4_(master, "Venues", V4_MASTER_TABLES.Venues)
    .filter(function(venue) { return venue.status === "active"; });
  const activities = tableRowsV4_(master, "Activities", V4_MASTER_TABLES.Activities)
    .filter(function(activity) { return activity.status !== "inactive"; });
  if (user.role === "superhost") {
    return { hotels: hotels, venues: venues, activities: activities };
  }
  const assignments = tableRowsV4_(master, "UserAssignments", V4_MASTER_TABLES.UserAssignments)
    .filter(function(assignment) {
      return assignment.userId === user.userId && assignment.status === "active";
    });
  const allowedHotels = {};
  const allowedVenues = {};
  const allowedActivities = {};
  assignments.forEach(function(assignment) {
    const hotelId = String(assignment.hotelId || "");
    if (!hotelId) return;
    allowedHotels[hotelId] = true;
    if (assignment.activityId) {
      activities.forEach(function(activity) {
        if (
          activity.activityId === assignment.activityId &&
          activity.hotelId === hotelId &&
          (!assignment.venueId || activity.venueId === assignment.venueId)
        ) {
          allowedActivities[activity.activityId] = true;
          allowedVenues[activity.venueId] = true;
        }
      });
      return;
    }
    if (assignment.venueId) {
      venues.forEach(function(venue) {
        if (venue.venueId === assignment.venueId && venue.hotelId === hotelId) {
          allowedVenues[venue.venueId] = true;
          activities.forEach(function(activity) {
            if (activity.hotelId === hotelId && activity.venueId === venue.venueId) {
              allowedActivities[activity.activityId] = true;
            }
          });
        }
      });
      return;
    }
    venues.forEach(function(venue) {
      if (venue.hotelId === hotelId) allowedVenues[venue.venueId] = true;
    });
    activities.forEach(function(activity) {
      if (activity.hotelId === hotelId) allowedActivities[activity.activityId] = true;
    });
  });
  return {
    hotels: hotels.filter(function(hotel) { return allowedHotels[hotel.hotelId]; })
      .map(function(hotel) { return visibleHotelV4_(user, hotel); }),
    venues: venues.filter(function(venue) { return allowedVenues[venue.venueId]; }),
    activities: activities.filter(function(activity) { return allowedActivities[activity.activityId]; })
  };
}

function logoutV4_(body) {
  const auth = requireAuthV4_(body);
  updateRecordV4_(auth.master, "AuthSessions", V4_MASTER_TABLES.AuthSessions, auth.session._row, {
    revokedAt: isoNowV4_()
  });
  auditV4_({ userId: auth.user.userId, deviceId: auth.session.deviceId, action: "logout" });
  return { ok: true };
}

function changePasswordV4_(body) {
  const auth = requireAuthV4_(body);
  const currentPassword = String(body.currentPassword || "");
  const nextPassword = String(body.newPassword || "");
  if (!safeEqualV4_(
    hashSecretV4_(currentPassword, auth.user.passwordSalt),
    auth.user.passwordHash
  )) return { ok: false, code: "INVALID_CURRENT_PASSWORD" };
  if (nextPassword.length < 12 || nextPassword.length > 128) {
    return { ok: false, code: "WEAK_PASSWORD" };
  }
  const nextSalt = randomTokenV4_(32);
  updateRecordV4_(auth.master, "Users", V4_MASTER_TABLES.Users, auth.user._row, {
    passwordHash: hashSecretV4_(nextPassword, nextSalt),
    passwordSalt: nextSalt,
    mustChangePassword: false,
    passwordUpdatedAt: isoNowV4_(),
    updatedAt: isoNowV4_()
  });
  auditV4_({ userId: auth.user.userId, action: "password.changed" });
  return { ok: true };
}

function createOneTimeLoginCodeV4_(body) {
  const auth = requireAuthV4_(body);
  if (!auth.device) return { ok: false, code: "BRIDGE_DEVICE_REQUIRED" };
  const rawCode = randomTokenV4_(40);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 90 * 1000);
  appendRecordV4_(auth.master, "OneTimeLoginCodes", V4_MASTER_TABLES.OneTimeLoginCodes, {
    codeId: Utilities.getUuid(),
    userId: auth.user.userId,
    deviceId: auth.device.deviceId,
    codeHash: tokenHashV4_(rawCode),
    createdAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    usedAt: ""
  });
  const hostBase = String(
    PropertiesService.getScriptProperties().getProperty("HOST_BASE_URL") ||
      "https://host.gstarxp.com"
  ).replace(/\/+$/, "");
  return {
    ok: true,
    url: hostBase + "/bridge-login?code=" + encodeURIComponent(rawCode),
    expiresAt: expiresAt.toISOString()
  };
}

function consumeOneTimeLoginCodeV4_(body) {
  const master = masterSpreadsheetV4_();
  const codeHash = tokenHashV4_(body.code);
  const record = tableRowsV4_(master, "OneTimeLoginCodes", V4_MASTER_TABLES.OneTimeLoginCodes)
    .filter(function(candidate) { return safeEqualV4_(candidate.codeHash, codeHash); })[0];
  if (!record || record.usedAt || new Date(record.expiresAt).getTime() <= Date.now()) {
    return { ok: false, code: "INVALID_OR_EXPIRED_CODE" };
  }
  const user = findRecordV4_(master, "Users", V4_MASTER_TABLES.Users, "userId", record.userId);
  const device = findRecordV4_(master, "Devices", V4_MASTER_TABLES.Devices, "deviceId", record.deviceId);
  if (!user || user.status !== "active" || !device || device.status !== "active") {
    return { ok: false, code: "UNAUTHORIZED" };
  }
  updateRecordV4_(master, "OneTimeLoginCodes", V4_MASTER_TABLES.OneTimeLoginCodes, record._row, {
    usedAt: isoNowV4_()
  });
  const session = createSessionV4_(master, user, "", true);
  auditV4_({ userId: user.userId, deviceId: device.deviceId, action: "web.oneTimeLogin" });
  return {
    ok: true,
    authToken: session.token,
    expiresAt: session.expiresAt,
    user: publicUserV4_(user),
    selection: accessibleSelectionV4_(user)
  };
}

function validatePermissionsPayloadV4_(permissions) {
  const requested = parsePermissionsV4_(permissions);
  const cleanPermissions = {};
  if (requested.all === true) cleanPermissions.all = true;
  V4_PERMISSIONS.forEach(function(permission) {
    if (typeof requested[permission] === "boolean") {
      cleanPermissions[permission] = requested[permission];
    }
  });
  return cleanPermissions;
}

function createHostUserV4_(auth, body) {
  if (auth.user.role !== "superhost") throw new Error("FORBIDDEN");
  const username = normalizeIdentifierV4_(body.username).replace(/-/g, ".");
  const email = emailAddressV4_(body.email);
  if (!username || username.length < 3) return { ok: false, code: "INVALID_USERNAME" };
  if (String(body.email || "").trim() && !email) {
    return { ok: false, code: "INVALID_EMAIL" };
  }
  const users = tableRowsV4_(auth.master, "Users", V4_MASTER_TABLES.Users);
  if (users.some(function(user) {
    return user.username === username || (email && String(user.email).toLowerCase() === email);
  })) return { ok: false, code: "USER_EXISTS" };
  const password = String(body.password || "");
  if (password.length < 12 || password.length > 128) {
    return { ok: false, code: "WEAK_PASSWORD" };
  }
  const salt = randomTokenV4_(32);
  const now = isoNowV4_();
  const user = appendRecordV4_(auth.master, "Users", V4_MASTER_TABLES.Users, {
    userId: Utilities.getUuid(),
    username: username,
    displayName: clean_(body.displayName || username),
    email: email,
    passwordHash: hashSecretV4_(password, salt),
    passwordSalt: salt,
    role: "host",
    status: "active",
    staticHostSlug: uniqueUserSlugV4_(auth.master, username, ""),
    mustChangePassword: false,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: "",
    passwordUpdatedAt: now
  });
  auditV4_({ userId: auth.user.userId, action: "user.created", targetId: user.userId });
  return { ok: true, user: publicUserV4_(user) };
}

function createHotelForSuperhostV4_(auth, body) {
  if (auth.user.role !== "superhost") throw new Error("FORBIDDEN");
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    return {
      ok: false,
      code: "HOTEL_CREATION_IN_PROGRESS",
      error: "Another hotel is already being created. Wait a moment and refresh the Host Panel before trying again."
    };
  }
  try {
    return createHotelForSuperhostUnlockedV4_(auth, body);
  } finally {
    lock.releaseLock();
  }
}

function createHotelForSuperhostUnlockedV4_(auth, body) {
  const name = clean_(body.name);
  if (!name) return { ok: false, code: "HOTEL_NAME_REQUIRED" };
  const timezone = clean_(body.timezone || "America/Santo_Domingo");
  if (!validTimezoneV4_(timezone)) return { ok: false, code: "INVALID_TIMEZONE" };
  const nameKey = normalizeIdentifierV4_(name);
  const existingHotel = tableRowsV4_(auth.master, "Hotels", V4_MASTER_TABLES.Hotels)
    .filter(function(hotel) {
      return normalizeIdentifierV4_(hotel.name) === nameKey || hotel.slug === nameKey;
    })[0];
  if (existingHotel) {
    return {
      ok: false,
      code: "HOTEL_ALREADY_EXISTS",
      error: "A hotel named " + existingHotel.name + " already exists. Refresh the Host Panel instead of creating it again.",
      hotel: existingHotel
    };
  }
  const now = isoNowV4_();
  const hotelId = Utilities.getUuid();
  const slug = uniqueSlugV4_(auth.master, body.slug || name, "");
  const publicCode = randomTokenV4_(20);
  const publicUrl = publicBaseUrlV4_() + "/h/" + slug + "-" + publicCode;
  const hotel = {
    hotelId: hotelId,
    name: name,
    slug: slug,
    publicCode: publicCode,
    publicUrl: publicUrl,
    qrFileId: "",
    qrVersion: 1,
    activePublicActivityId: "",
    timezone: timezone,
    dataSheetId: "",
    status: "active",
    createdAt: now,
    updatedAt: now
  };
  try {
    hotel.dataSheetId = createHotelSpreadsheetV4_(hotel, null, null);
    hotel.qrFileId = "";
  } catch (error) {
    const detail = String(error && error.message ? error.message : error).slice(0, 500);
    console.error(JSON.stringify({
      event: "hotel.sheet.provisioning.failed",
      detail: detail
    }));
    return {
      ok: false,
      code: "HOTEL_SHEET_PROVISIONING_FAILED",
      error: "Google Sheets could not finish the independent hotel spreadsheet. Google reported: " + detail
    };
  }
  const saved = appendRecordV4_(auth.master, "Hotels", V4_MASTER_TABLES.Hotels, hotel);
  const venue = appendRecordV4_(auth.master, "Venues", V4_MASTER_TABLES.Venues, {
    venueId: Utilities.getUuid(),
    hotelId: saved.hotelId,
    name: clean_(body.defaultVenueName || "Main Venue"),
    slug: "main-venue",
    status: "active",
    createdAt: now,
    updatedAt: now
  });
  const activity = appendRecordV4_(auth.master, "Activities", V4_MASTER_TABLES.Activities, {
    activityId: Utilities.getUuid(),
    hotelId: saved.hotelId,
    venueId: venue.venueId,
    name: clean_(body.defaultActivityName || "Guest Star Karaoke"),
    internalCode: "karaoke",
    status: "ready",
    defaultDurationSeconds: 7200,
    defaultTransitionSeconds: 30,
    showPublicStatus: false,
    showCountdown: true,
    scheduledStartAt: "",
    autoStartEnabled: false,
    acceptEarlyRequests: false,
    currentCycleId: "",
    createdAt: now,
    updatedAt: now,
    allowedLanguagesJson: JSON.stringify(["es", "en"])
  });
  updateRecordV4_(auth.master, "Hotels", V4_MASTER_TABLES.Hotels, saved._row, {
    activePublicActivityId: activity.activityId,
    updatedAt: now
  });
  saved.activePublicActivityId = activity.activityId;
  appendRecordV4_(auth.master, "UserAssignments", V4_MASTER_TABLES.UserAssignments, {
    assignmentId: Utilities.getUuid(),
    userId: auth.user.userId,
    hotelId: saved.hotelId,
    venueId: "",
    activityId: "",
    permissionsJson: JSON.stringify({ all: true }),
    status: "active",
    createdAt: now,
    updatedAt: now
  });
  appendRecordV4_(auth.master, "HotelBranding", V4_MASTER_TABLES.HotelBranding, {
    hotelBrandingId: Utilities.getUuid(),
    hotelId: saved.hotelId,
    teamDisplayName: "Guest Star Team",
    teamType: "Entertainment Team",
    tagline: "Your moment. Your song. Your stage.",
    welcomeMessage: "Choose your song and get ready to be the Guest Star.",
    activityEndingMessage: "Thank you for singing with us.",
    upcomingActivityMessage: "Join us again for the next Guest Star experience.",
    brandTone: "friendly",
    showHotelName: true,
    showHotelLogo: true,
    showTeamIdentity: true,
    showActivityDetails: true,
    showScheduledStart: true,
    showCountdown: true,
    showQueueInformation: false,
    showNextActivity: true,
    showInternalRating: false,
    showExternalReview: false,
    showAddToCalendar: true,
    showRemindMe: false,
    updatedAt: now,
    primaryColor: "#ff2d95",
    secondaryColor: "#8b3dff",
    accentColor: "#00c8ff"
  });
  auditV4_({
    userId: auth.user.userId,
    action: "hotel.created",
    hotelId: saved.hotelId,
    targetId: saved.dataSheetId,
    details: {
      publicUrl: saved.publicUrl,
      venueId: venue.venueId,
      activityId: activity.activityId
    }
  });
  return {
    ok: true,
    hotel: saved,
    venue: venue,
    activity: activity,
    warning: "The hotel Sheet was created in My Drive. Folder organization and Drive-stored QR were skipped, but the direct QR remains available."
  };
}

function updateHotelForSuperhostV4_(auth, body) {
  if (auth.user.role !== "superhost") throw new Error("FORBIDDEN");
  const hotel = findRecordV4_(
    auth.master, "Hotels", V4_MASTER_TABLES.Hotels, "hotelId", body.hotelId
  );
  if (!hotel) return { ok: false, code: "HOTEL_NOT_FOUND" };
  const changes = { updatedAt: isoNowV4_() };
  if (body.name !== undefined) {
    const name = clean_(body.name);
    if (!name) return { ok: false, code: "HOTEL_NAME_REQUIRED" };
    changes.name = name;
  }
  if (body.timezone !== undefined) {
    const timezone = clean_(body.timezone);
    if (!validTimezoneV4_(timezone)) return { ok: false, code: "INVALID_TIMEZONE" };
    changes.timezone = timezone;
  }
  if (body.status !== undefined) {
    const deleting = body.status === "inactive";
    if (deleting && clean_(body.confirmHotelName) !== String(hotel.name)) {
      return {
        ok: false,
        code: "HOTEL_NAME_CONFIRMATION_REQUIRED",
        error: "Type the hotel name exactly to confirm deletion."
      };
    }
    changes.status = deleting ? "inactive" : "active";
  }
  updateRecordV4_(auth.master, "Hotels", V4_MASTER_TABLES.Hotels, hotel._row, changes);
  const suspended = { assignments: 0, schedules: 0, devices: 0 };
  if (changes.status) {
    const dependentStatus = changes.status === "inactive" ? "suspended_hotel" : "active";
    tableRowsV4_(auth.master, "UserAssignments", V4_MASTER_TABLES.UserAssignments)
      .filter(function(record) {
        return record.hotelId === hotel.hotelId && (
          changes.status === "inactive"
            ? record.status === "active"
            : record.status === "suspended_hotel"
        );
      }).forEach(function(record) {
        updateRecordV4_(auth.master, "UserAssignments", V4_MASTER_TABLES.UserAssignments, record._row, {
          status: dependentStatus,
          updatedAt: isoNowV4_()
        });
        suspended.assignments += 1;
      });
    tableRowsV4_(auth.master, "ActivitySchedules", V4_MASTER_TABLES.ActivitySchedules)
      .filter(function(record) {
        return record.hotelId === hotel.hotelId && (
          changes.status === "inactive"
            ? record.status === "active"
            : record.status === "suspended_hotel"
        );
      }).forEach(function(record) {
        updateRecordV4_(auth.master, "ActivitySchedules", V4_MASTER_TABLES.ActivitySchedules, record._row, {
          status: dependentStatus,
          updatedAt: isoNowV4_()
        });
        suspended.schedules += 1;
      });
    if (changes.status === "inactive") {
      tableRowsV4_(auth.master, "Devices", V4_MASTER_TABLES.Devices)
        .filter(function(record) {
          return record.hotelId === hotel.hotelId && record.status === "active";
        }).forEach(function(record) {
          updateRecordV4_(auth.master, "Devices", V4_MASTER_TABLES.Devices, record._row, {
            hotelId: "",
            venueId: "",
            activityId: "",
            updatedAt: isoNowV4_()
          });
          suspended.devices += 1;
        });
    }
  }
  const auditAction = changes.status === "inactive"
    ? "hotel.deleted"
    : changes.status === "active"
      ? "hotel.restored"
      : "hotel.updated";
  auditV4_({
    userId: auth.user.userId,
    action: auditAction,
    hotelId: hotel.hotelId,
    details: Object.assign({}, changes, { dependents: suspended })
  });
  return {
    ok: true,
    hotel: Object.assign({}, hotel, changes),
    suspended: suspended,
    recoverable: true
  };
}

function updateHostUserV4_(auth, body) {
  if (auth.user.role !== "superhost") throw new Error("FORBIDDEN");
  const user = findRecordV4_(auth.master, "Users", V4_MASTER_TABLES.Users, "userId", body.userId);
  if (!user || user.role !== "host") return { ok: false, code: "USER_NOT_FOUND" };
  const changes = { updatedAt: isoNowV4_() };
  if (body.username !== undefined) {
    const username = normalizeIdentifierV4_(body.username).replace(/-/g, ".");
    if (!username || username.length < 3) {
      return { ok: false, code: "INVALID_USERNAME" };
    }
    const duplicateUsername = tableRowsV4_(auth.master, "Users", V4_MASTER_TABLES.Users)
      .some(function(candidate) {
        return candidate.userId !== user.userId &&
          String(candidate.username || "").toLowerCase() === username.toLowerCase();
      });
    if (duplicateUsername) return { ok: false, code: "USER_EXISTS" };
    changes.username = username;
  }
  if (body.displayName !== undefined) changes.displayName = clean_(body.displayName);
  if (body.email !== undefined) {
    const email = emailAddressV4_(body.email);
    if (String(body.email || "").trim() && !email) {
      return { ok: false, code: "INVALID_EMAIL" };
    }
    const duplicate = email && tableRowsV4_(auth.master, "Users", V4_MASTER_TABLES.Users)
      .some(function(candidate) {
        return candidate.userId !== user.userId && String(candidate.email || "").toLowerCase() === email;
      });
    if (duplicate) return { ok: false, code: "USER_EXISTS" };
    changes.email = email;
  }
  if (body.status !== undefined) {
    const nextStatus = body.status === "inactive" ? "inactive" : "active";
    if (user.role === "superhost" && nextStatus === "inactive") {
      const activeSuperhosts = tableRowsV4_(auth.master, "Users", V4_MASTER_TABLES.Users)
        .filter(function(candidate) {
          return candidate.role === "superhost" && candidate.status === "active";
        });
      if (activeSuperhosts.length <= 1) return { ok: false, code: "LAST_SUPERHOST" };
    }
    changes.status = nextStatus;
  }
  updateRecordV4_(auth.master, "Users", V4_MASTER_TABLES.Users, user._row, changes);
  if (changes.status === "inactive") {
    tableRowsV4_(auth.master, "AuthSessions", V4_MASTER_TABLES.AuthSessions)
      .filter(function(session) { return session.userId === user.userId && !session.revokedAt; })
      .forEach(function(session) {
        updateRecordV4_(auth.master, "AuthSessions", V4_MASTER_TABLES.AuthSessions, session._row, {
          revokedAt: isoNowV4_()
        });
      });
    tableRowsV4_(auth.master, "Devices", V4_MASTER_TABLES.Devices)
      .filter(function(device) { return device.userId === user.userId && device.status === "active"; })
      .forEach(function(device) {
        updateRecordV4_(auth.master, "Devices", V4_MASTER_TABLES.Devices, device._row, {
          status: "revoked",
          updatedAt: isoNowV4_()
        });
      });
  }
  auditV4_({ userId: auth.user.userId, action: "user.updated", targetId: user.userId, details: changes });
  return { ok: true, user: publicUserV4_(Object.assign({}, user, changes)) };
}

function setHostPasswordV4_(auth, body) {
  if (auth.user.role !== "superhost") throw new Error("FORBIDDEN");
  const user = findRecordV4_(auth.master, "Users", V4_MASTER_TABLES.Users, "userId", body.userId);
  if (!user || user.role !== "host") return { ok: false, code: "USER_NOT_FOUND" };
  const password = String(body.password || "");
  if (password.length < 12 || password.length > 128) {
    return { ok: false, code: "WEAK_PASSWORD" };
  }
  const now = isoNowV4_();
  const salt = randomTokenV4_(32);
  updateRecordV4_(auth.master, "Users", V4_MASTER_TABLES.Users, user._row, {
    passwordHash: hashSecretV4_(password, salt),
    passwordSalt: salt,
    mustChangePassword: false,
    passwordUpdatedAt: now,
    updatedAt: now
  });
  revokeUserAccessV4_(auth.master, user.userId);
  auditV4_({
    userId: auth.user.userId,
    action: "host.password.set",
    targetId: user.userId,
    details: { sessionsRevoked: true }
  });
  return {
    ok: true,
    user: publicUserV4_(Object.assign({}, user, {
      mustChangePassword: false,
      passwordUpdatedAt: now,
      updatedAt: now
    }))
  };
}

function revokeAssignmentV4_(auth, body) {
  if (auth.user.role !== "superhost") throw new Error("FORBIDDEN");
  const assignment = findRecordV4_(
    auth.master, "UserAssignments", V4_MASTER_TABLES.UserAssignments,
    "assignmentId", body.assignmentId
  );
  if (!assignment) return { ok: false, code: "ASSIGNMENT_NOT_FOUND" };
  updateRecordV4_(
    auth.master, "UserAssignments", V4_MASTER_TABLES.UserAssignments,
    assignment._row, { status: "revoked", updatedAt: isoNowV4_() }
  );
  auditV4_({ userId: auth.user.userId, action: "assignment.revoked", hotelId: assignment.hotelId, targetId: assignment.assignmentId });
  return { ok: true };
}

function createVenueV4_(auth, body) {
  const context = resolveTenantContextV4_(auth, { hotelId: body.hotelId });
  if (auth.user.role !== "superhost") requirePermissionV4_(context, "canCreateActivities");
  const name = clean_(body.name);
  if (!name) return { ok: false, code: "VENUE_NAME_REQUIRED" };
  const now = isoNowV4_();
  const venue = appendRecordV4_(auth.master, "Venues", V4_MASTER_TABLES.Venues, {
    venueId: Utilities.getUuid(),
    hotelId: context.hotel.hotelId,
    name: name,
    slug: uniqueChildSlugV4_(auth.master, "Venues", "hotelId", context.hotel.hotelId, name),
    status: "active",
    createdAt: now,
    updatedAt: now
  });
  auditV4_({ userId: auth.user.userId, action: "venue.created", hotelId: context.hotel.hotelId, venueId: venue.venueId });
  return { ok: true, venue: venue };
}

function uniqueChildSlugV4_(master, tableName, parentField, parentId, value) {
  const base = normalizeIdentifierV4_(value) || "item";
  const headers = V4_MASTER_TABLES[tableName];
  const records = tableRowsV4_(master, tableName, headers).filter(function(record) {
    return record[parentField] === parentId;
  });
  let candidate = base;
  let suffix = 2;
  while (records.some(function(record) { return record.slug === candidate; })) {
    candidate = base + "-" + suffix;
    suffix += 1;
  }
  return candidate;
}

function createActivityV4_(auth, body) {
  const context = resolveTenantContextV4_(auth, {
    hotelId: body.hotelId,
    venueId: body.venueId
  });
  if (auth.user.role !== "superhost") requirePermissionV4_(context, "canCreateActivities");
  if (!context.venue) return { ok: false, code: "VENUE_REQUIRED" };
  const name = clean_(body.name);
  if (!name) return { ok: false, code: "ACTIVITY_NAME_REQUIRED" };
  const now = isoNowV4_();
  const activity = appendRecordV4_(auth.master, "Activities", V4_MASTER_TABLES.Activities, {
    activityId: Utilities.getUuid(),
    hotelId: context.hotel.hotelId,
    venueId: context.venue.venueId,
    name: name,
    internalCode: normalizeIdentifierV4_(body.internalCode || name),
    status: "ready",
    defaultDurationSeconds: Math.round(boundedNumber_(body.defaultDurationSeconds, 7200, 900, 604800)),
    defaultTransitionSeconds: Math.round(boundedNumber_(body.defaultTransitionSeconds, 30, 0, 900)),
    showPublicStatus: body.showPublicStatus === true,
    showCountdown: body.showCountdown !== false,
    scheduledStartAt: clean_(body.scheduledStartAt),
    autoStartEnabled: body.autoStartEnabled === true,
    acceptEarlyRequests: body.acceptEarlyRequests === true,
    currentCycleId: "",
    createdAt: now,
    updatedAt: now,
    allowedLanguagesJson: JSON.stringify(
      normalizeActivityLanguagesV4_(body.allowedLanguages)
    )
  });
  auditV4_({ userId: auth.user.userId, action: "activity.created", hotelId: context.hotel.hotelId, venueId: context.venue.venueId, activityId: activity.activityId });
  return { ok: true, activity: activity };
}

function updateActivityLanguagesV4_(auth, body) {
  const context = resolveTenantContextV4_(auth, body);
  if (!context.activity || !context.venue) throw new Error("ACTIVITY_REQUIRED");
  if (auth.user.role !== "superhost") requirePermissionV4_(context, "canChangeSchedule");
  const allowedLanguages = normalizeActivityLanguagesV4_(body.allowedLanguages);
  const changes = {
    allowedLanguagesJson: JSON.stringify(allowedLanguages),
    updatedAt: isoNowV4_()
  };
  updateRecordV4_(
    auth.master,
    "Activities",
    V4_MASTER_TABLES.Activities,
    context.activity._row,
    changes
  );
  const activity = activityWithLanguagesV4_(Object.assign({}, context.activity, changes));
  auditV4_({
    userId: auth.user.userId,
    action: "activity.languages.updated",
    hotelId: context.hotel.hotelId,
    venueId: context.venue.venueId,
    activityId: context.activity.activityId,
    details: { allowedLanguages: allowedLanguages }
  });
  return { ok: true, activity: activity };
}

function assignUserV4_(auth, body) {
  if (auth.user.role !== "superhost") throw new Error("FORBIDDEN");
  const user = findRecordV4_(auth.master, "Users", V4_MASTER_TABLES.Users, "userId", body.userId);
  if (!user || user.status !== "active") return { ok: false, code: "USER_NOT_FOUND" };
  const context = resolveTenantContextV4_(auth, {
    hotelId: body.hotelId,
    venueId: body.venueId,
    activityId: body.activityId
  });
  const now = isoNowV4_();
  const venueId = context.venue ? context.venue.venueId : "";
  const activityId = context.activity ? context.activity.activityId : "";
  const existing = tableRowsV4_(
    auth.master,
    "UserAssignments",
    V4_MASTER_TABLES.UserAssignments
  ).filter(function(assignment) {
    return assignment.userId === user.userId &&
      assignment.hotelId === context.hotel.hotelId &&
      String(assignment.venueId || "") === venueId &&
      String(assignment.activityId || "") === activityId &&
      assignment.status === "active";
  })[0];
  if (existing) {
    const changes = {
      permissionsJson: JSON.stringify(validatePermissionsPayloadV4_(body.permissions)),
      updatedAt: now
    };
    updateRecordV4_(
      auth.master,
      "UserAssignments",
      V4_MASTER_TABLES.UserAssignments,
      existing._row,
      changes
    );
    auditV4_({ userId: auth.user.userId, action: "assignment.updated", hotelId: context.hotel.hotelId, venueId: venueId, activityId: activityId, targetId: user.userId });
    return { ok: true, assignment: Object.assign({}, existing, changes), idempotent: true };
  }
  const assignment = appendRecordV4_(auth.master, "UserAssignments", V4_MASTER_TABLES.UserAssignments, {
    assignmentId: Utilities.getUuid(),
    userId: user.userId,
    hotelId: context.hotel.hotelId,
    venueId: venueId,
    activityId: activityId,
    permissionsJson: JSON.stringify(validatePermissionsPayloadV4_(body.permissions)),
    status: "active",
    createdAt: now,
    updatedAt: now
  });
  auditV4_({ userId: auth.user.userId, action: "assignment.created", hotelId: context.hotel.hotelId, venueId: assignment.venueId, activityId: assignment.activityId, targetId: user.userId });
  return { ok: true, assignment: assignment, idempotent: false };
}

function revokeDeviceV4_(auth, body) {
  if (auth.user.role !== "superhost") throw new Error("FORBIDDEN");
  const device = findRecordV4_(auth.master, "Devices", V4_MASTER_TABLES.Devices, "deviceId", body.deviceId);
  if (!device) return { ok: false, code: "DEVICE_NOT_FOUND" };
  updateRecordV4_(auth.master, "Devices", V4_MASTER_TABLES.Devices, device._row, {
    status: "revoked",
    updatedAt: isoNowV4_()
  });
  tableRowsV4_(auth.master, "AuthSessions", V4_MASTER_TABLES.AuthSessions)
    .filter(function(session) { return session.deviceId === device.deviceId && !session.revokedAt; })
    .forEach(function(session) {
      updateRecordV4_(auth.master, "AuthSessions", V4_MASTER_TABLES.AuthSessions, session._row, {
        revokedAt: isoNowV4_()
      });
    });
  auditV4_({ userId: auth.user.userId, action: "device.revoked", targetId: device.deviceId });
  return { ok: true };
}

function adminStateV4_(auth) {
  if (auth.user.role !== "superhost") throw new Error("FORBIDDEN");
  return {
    ok: true,
    codeVersion: BRIDGE_API_VERSION,
    codeBuild: GUEST_STAR_CODE_BUILD,
    users: tableRowsV4_(auth.master, "Users", V4_MASTER_TABLES.Users).map(publicUserV4_),
    hotels: tableRowsV4_(auth.master, "Hotels", V4_MASTER_TABLES.Hotels),
    venues: tableRowsV4_(auth.master, "Venues", V4_MASTER_TABLES.Venues),
    activities: tableRowsV4_(auth.master, "Activities", V4_MASTER_TABLES.Activities)
      .map(activityWithLanguagesV4_),
    assignments: tableRowsV4_(auth.master, "UserAssignments", V4_MASTER_TABLES.UserAssignments),
    devices: tableRowsV4_(auth.master, "Devices", V4_MASTER_TABLES.Devices).map(function(device) {
      return {
        deviceId: device.deviceId,
        deviceName: device.deviceName,
        userId: device.userId,
        hotelId: device.hotelId,
        venueId: device.venueId,
        activityId: device.activityId,
        status: device.status,
        lastHeartbeatAt: device.lastHeartbeatAt,
        bridgeVersion: device.bridgeVersion,
        virtualDJConnected: device.virtualDJConnected,
        createdAt: device.createdAt,
        updatedAt: device.updatedAt
      };
    }),
    schedules: tableRowsV4_(auth.master, "ActivitySchedules", V4_MASTER_TABLES.ActivitySchedules),
    upcomingActivities: tableRowsV4_(auth.master, "UpcomingActivities", V4_MASTER_TABLES.UpcomingActivities),
    branding: tableRowsV4_(auth.master, "HotelBranding", V4_MASTER_TABLES.HotelBranding),
    auditLog: tableRowsV4_(auth.master, "AuditLog", V4_MASTER_TABLES.AuditLog).slice(-500)
  };
}

function snapshotRowsV4_(spreadsheet, tableName, headers) {
  return tableRowsV4_(spreadsheet, tableName, headers).map(function(record) {
    const clean = {};
    Object.keys(record).forEach(function(key) {
      if (key !== "_row") clean[key] = record[key];
    });
    return clean;
  });
}

function legacySheetRowsV4_(spreadsheet, sheetName) {
  const sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  ensureSheetWidth_(sheet, HEADERS.length);
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, HEADERS.length).getDisplayValues();
  return rows.map(function(values) {
    const record = {};
    HEADERS.forEach(function(header, index) { record[header] = values[index]; });
    return record;
  });
}

function legacyConfigSnapshotV4_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName(CONFIG);
  if (!sheet) return {};
  ensureBaseConfig_(sheet);
  ensureConfigState_(sheet);
  const startedAt = sheet.getRange("B7").getValue();
  const updatedAt = sheet.getRange("B10").getValue();
  return {
    activityHours: Number(sheet.getRange("B2").getValue()) || 2,
    transitionSeconds: Number(sheet.getRange("B3").getValue()) || 0,
    accepting: sheet.getRange("B4").getValue() !== false,
    accumulatedSeconds: readDurationSeconds_(sheet.getRange("B5")),
    remainingSeconds: readDurationSeconds_(sheet.getRange("B6")),
    activityStartedAt: startedAt instanceof Date ? startedAt.toISOString() : String(startedAt || ""),
    activityRunning: startedAt instanceof Date && isFinite(startedAt.getTime()),
    stateRevision: Number(sheet.getRange("B8").getValue()) || 0,
    activityId: String(sheet.getRange("B9").getDisplayValue() || ""),
    updatedAt: updatedAt instanceof Date ? updatedAt.toISOString() : String(updatedAt || ""),
    lastAction: String(sheet.getRange("B11").getDisplayValue() || ""),
    lastSource: String(sheet.getRange("B12").getDisplayValue() || ""),
    showPublicStatus: sheet.getRange("B13").getValue() === true
  };
}

function exportD1SnapshotV4_(auth) {
  if (auth.user.role !== "superhost") throw new Error("FORBIDDEN");
  const properties = PropertiesService.getScriptProperties();
  let backupSecret = properties.getProperty("D1_BACKUP_SECRET");
  if (!backupSecret) {
    backupSecret = randomTokenV4_(96);
    properties.setProperty("D1_BACKUP_SECRET", backupSecret);
  }
  const master = {};
  Object.keys(V4_MASTER_TABLES).forEach(function(tableName) {
    if (tableName === "AuthSessions" || tableName === "OneTimeLoginCodes") {
      master[tableName] = [];
      return;
    }
    master[tableName] = snapshotRowsV4_(auth.master, tableName, V4_MASTER_TABLES[tableName]);
    if (tableName === "Devices") {
      master[tableName] = master[tableName].map(function(device) {
        device.deviceTokenHash = "";
        device.status = "revoked";
        return device;
      });
    }
  });
  const hotels = (master.Hotels || []).map(function(hotel) {
    const result = { hotelId: hotel.hotelId, legacyConfig: {}, tables: {} };
    if (!hotel.dataSheetId) return result;
    try {
      const spreadsheet = SpreadsheetApp.openById(hotel.dataSheetId);
      result.legacyConfig = legacyConfigSnapshotV4_(spreadsheet);
      result.tables.Solicitudes = legacySheetRowsV4_(spreadsheet, REQUESTS);
      result.tables.Historial = legacySheetRowsV4_(spreadsheet, HISTORY);
      Object.keys(V4_HOTEL_TABLES).forEach(function(tableName) {
        result.tables[tableName] = snapshotRowsV4_(spreadsheet, tableName, V4_HOTEL_TABLES[tableName]);
      });
    } catch (error) {
      result.error = "HOTEL_SNAPSHOT_UNAVAILABLE";
    }
    return result;
  });
  auditV4_({
    userId: auth.user.userId,
    action: "d1.snapshot.exported",
    details: { hotelCount: hotels.length, schemaVersion: V4_SCHEMA_VERSION }
  });
  return {
    ok: true,
    schemaVersion: V4_SCHEMA_VERSION,
    exportedAt: isoNowV4_(),
    backupSecret: backupSecret,
    youtubeApiKey: properties.getProperty("YOUTUBE_API_KEY") || "",
    master: master,
    hotels: hotels
  };
}

function d1BackupDateValueV4_(value, fallback) {
  const parsed = new Date(String(value || ""));
  return isFinite(parsed.getTime()) ? parsed : (fallback || "");
}

function ensureD1BackupHotelSpreadsheetV4_(hotelId) {
  const master = masterSpreadsheetV4_();
  const hotel = findRecordV4_(
    master, "Hotels", V4_MASTER_TABLES.Hotels, "hotelId", hotelId
  );
  if (!hotel) throw new Error("BACKUP_HOTEL_NOT_FOUND");
  if (!hotel.dataSheetId) {
    const dataSheetId = createHotelSpreadsheetV4_(hotel, null, null);
    updateRecordV4_(master, "Hotels", V4_MASTER_TABLES.Hotels, hotel._row, {
      dataSheetId: dataSheetId,
      updatedAt: hotel.updatedAt || isoNowV4_()
    });
    hotel.dataSheetId = dataSheetId;
  }
  return SpreadsheetApp.openById(hotel.dataSheetId);
}

function upsertD1BackupRecordV4_(payload) {
  const tableName = clean_(payload && payload.table);
  const scope = clean_(payload && payload.scope) || "master";
  const sourceRecord = payload && payload.record && typeof payload.record === "object"
    ? payload.record
    : null;
  if (!tableName || !sourceRecord) throw new Error("BACKUP_RECORD_INVALID");
  const headers = scope === "master"
    ? V4_MASTER_TABLES[tableName]
    : V4_HOTEL_TABLES[tableName];
  if (!headers) throw new Error("BACKUP_TABLE_NOT_ALLOWED");
  const spreadsheet = scope === "master"
    ? masterSpreadsheetV4_()
    : ensureD1BackupHotelSpreadsheetV4_(scope);
  const idField = headers[0];
  const recordId = clean_(sourceRecord[idField]);
  if (!recordId) throw new Error("BACKUP_RECORD_ID_MISSING");
  const existing = findRecordV4_(spreadsheet, tableName, headers, idField, recordId);
  const record = Object.assign({}, sourceRecord);
  if (tableName === "Hotels" && existing) {
    if (existing.dataSheetId && !record.dataSheetId) delete record.dataSheetId;
    if (existing.qrFileId && !record.qrFileId) delete record.qrFileId;
  }
  if (existing) {
    updateRecordV4_(spreadsheet, tableName, headers, existing._row, record);
  } else {
    appendRecordV4_(spreadsheet, tableName, headers, record);
  }
  if (tableName === "Hotels" && String(record.status || "active") === "active") {
    ensureD1BackupHotelSpreadsheetV4_(recordId);
  }
}

function d1BackupRequestValuesV4_(request) {
  const seconds = function(value) {
    return Math.max(0, Number(value) || 0) / 86400;
  };
  return [
    d1BackupDateValueV4_(request.createdAt, new Date()),
    clean_(request.singer), clean_(request.song), clean_(request.artist),
    clean_(request.comment), clean_(request.language),
    seconds(request.durationSeconds), seconds(request.transitionSeconds),
    seconds(request.accumulatedSeconds), seconds(request.remainingSeconds),
    clean_(request.sourceUrl), clean_(request.status || "Pendiente"),
    clean_(request.requestId), clean_(request.fileName),
    d1BackupDateValueV4_(request.updatedAt, new Date()),
    clean_(request.hotelId), clean_(request.venueId), clean_(request.activityId),
    clean_(request.cycleId), clean_(request.sourceType),
    clean_(request.virtualDJItemId), clean_(request.languageCode),
    Math.max(0, Number(request.queuePosition) || 0), clean_(request.syncState),
    clean_(request.lastSeenAt), Math.max(0, Number(request.stateRevision) || 0)
  ];
}

function findD1BackupRequestRowV4_(sheet, requestId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const ids = sheet.getRange(2, 13, lastRow - 1, 1).getDisplayValues();
  for (let index = 0; index < ids.length; index += 1) {
    if (String(ids[index][0] || "") === requestId) return index + 2;
  }
  return 0;
}

function upsertD1BackupRequestV4_(payload) {
  const request = payload && payload.request;
  if (!request || !request.hotelId || !request.requestId) {
    throw new Error("BACKUP_REQUEST_INVALID");
  }
  const spreadsheet = ensureD1BackupHotelSpreadsheetV4_(String(request.hotelId));
  const active = ensureTableV4_(spreadsheet, REQUESTS, HEADERS);
  const history = ensureTableV4_(spreadsheet, HISTORY, HEADERS);
  const archived = Boolean(String(request.archivedAt || ""));
  const target = archived ? history : active;
  const opposite = archived ? active : history;
  const requestId = String(request.requestId);
  const oppositeRow = findD1BackupRequestRowV4_(opposite, requestId);
  if (oppositeRow) opposite.deleteRow(oppositeRow);
  const values = d1BackupRequestValuesV4_(request);
  const row = findD1BackupRequestRowV4_(target, requestId);
  if (row) target.getRange(row, 1, 1, HEADERS.length).setValues([values]);
  else target.appendRow(values);
  const writtenRow = row || target.getLastRow();
  target.getRange(writtenRow, 7, 1, 4).setNumberFormat("[h]:mm:ss");
  const previousDataSheetId = REQUEST_DATA_SHEET_ID_;
  try {
    REQUEST_DATA_SHEET_ID_ = spreadsheet.getId();
    recalculateActivity_();
  } finally {
    REQUEST_DATA_SHEET_ID_ = previousDataSheetId;
  }
}

function archiveD1BackupRequestsV4_(payload) {
  const hotelId = clean_(payload && payload.hotelId);
  const activityId = clean_(payload && payload.activityId);
  if (!hotelId) throw new Error("BACKUP_HOTEL_REQUIRED");
  const spreadsheet = ensureD1BackupHotelSpreadsheetV4_(hotelId);
  const active = ensureTableV4_(spreadsheet, REQUESTS, HEADERS);
  const history = ensureTableV4_(spreadsheet, HISTORY, HEADERS);
  const lastRow = active.getLastRow();
  if (lastRow < 2) return;
  const rows = active.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  const archivedRows = [];
  const deleteRows = [];
  rows.forEach(function(row, index) {
    if (String(row[15] || "") !== hotelId) return;
    if (activityId && String(row[17] || "") !== activityId) return;
    row[14] = d1BackupDateValueV4_(payload.archivedAt, new Date());
    archivedRows.push(row);
    deleteRows.push(index + 2);
  });
  if (archivedRows.length) {
    const start = history.getLastRow() + 1;
    history.getRange(start, 1, archivedRows.length, HEADERS.length).setValues(archivedRows);
    history.getRange(start, 7, archivedRows.length, 4).setNumberFormat("[h]:mm:ss");
    deleteRows.reverse().forEach(function(row) { active.deleteRow(row); });
  }
}

function applyD1BackupRuntimeV4_(payload) {
  const runtime = payload && payload.runtime;
  if (!runtime || !runtime.hotelId || !runtime.activityId) {
    throw new Error("BACKUP_RUNTIME_INVALID");
  }
  const spreadsheet = ensureD1BackupHotelSpreadsheetV4_(String(runtime.hotelId));
  const activity = findRecordV4_(
    masterSpreadsheetV4_(), "Activities", V4_MASTER_TABLES.Activities,
    "activityId", runtime.activityId
  );
  const config = spreadsheet.getSheetByName(CONFIG) || spreadsheet.insertSheet(CONFIG);
  ensureBaseConfig_(config);
  ensureConfigState_(config);
  if (activity) {
    config.getRange("B2").setValue(Math.max(0.25, Number(activity.defaultDurationSeconds || 7200) / 3600));
    config.getRange("B3").setValue(Math.max(0, Number(activity.defaultTransitionSeconds) || 0));
    config.getRange("B13").setValue(parseBooleanV4_(activity.showPublicStatus));
  }
  config.getRange("B4").setValue(runtime.accepting === true);
  if (runtime.startedAt) config.getRange("B7").setValue(d1BackupDateValueV4_(runtime.startedAt, ""));
  else config.getRange("B7").clearContent();
  config.getRange("B8").setValue(Math.max(0, Number(runtime.stateRevision) || 0));
  config.getRange("B9").setValue(clean_(runtime.activityId));
  config.getRange("B10").setValue(d1BackupDateValueV4_(runtime.updatedAt, new Date()));
  config.getRange("B11").setValue(clean_(runtime.lastAction));
  config.getRange("B12").setValue(clean_(runtime.lastSource));
}

function materializeD1BackupEventV4_(event) {
  const action = clean_(event && event.action);
  const payload = event && event.payload && typeof event.payload === "object"
    ? event.payload
    : {};
  if (action === "record.upsert") return upsertD1BackupRecordV4_(payload);
  if (action === "request.upsert") return upsertD1BackupRequestV4_(payload);
  if (action === "requests.archive") return archiveD1BackupRequestsV4_(payload);
  if (action === "activity.runtime") return applyD1BackupRuntimeV4_(payload);
  throw new Error("BACKUP_ACTION_NOT_ALLOWED");
}

function ingestD1BackupV4_(body) {
  const expected = PropertiesService.getScriptProperties().getProperty("D1_BACKUP_SECRET");
  if (!expected || !safeEqualV4_(body.backupSecret, expected)) {
    return { ok: false, code: "INVALID_BACKUP_SECRET" };
  }
  const events = Array.isArray(body.events) ? body.events.slice(0, 100) : [];
  if (!events.length) return { ok: true, accepted: 0 };
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = authBackupSheetV4_();
    const lastRow = sheet.getLastRow();
    const existing = {};
    if (lastRow >= 2) {
      sheet.getRange(2, 1, lastRow - 1, 7).getDisplayValues().forEach(function(row, index) {
        if (row[0]) existing[row[0]] = { row: index + 2, status: row[5] };
      });
    }
    let accepted = 0;
    let applied = 0;
    const failures = [];
    events.forEach(function(event) {
      const eventId = clean_(event && event.eventId);
      if (!eventId) return;
      let stored = existing[eventId];
      if (!stored) {
        sheet.appendRow([
          eventId,
          clean_(event.action),
          JSON.stringify((event && event.payload) || {}).slice(0, 50000),
          clean_(event.createdAt) || isoNowV4_(),
          isoNowV4_(),
          "pending",
          ""
        ]);
        stored = { row: sheet.getLastRow(), status: "pending" };
        existing[eventId] = stored;
        accepted += 1;
      }
      if (stored.status === "applied") return;
      try {
        materializeD1BackupEventV4_(event);
        sheet.getRange(stored.row, 5, 1, 3).setValues([[
          isoNowV4_(), "applied", ""
        ]]);
        stored.status = "applied";
        applied += 1;
      } catch (error) {
        const message = String(error && error.message ? error.message : error).slice(0, 500);
        sheet.getRange(stored.row, 5, 1, 3).setValues([[
          isoNowV4_(), "failed", message
        ]]);
        stored.status = "failed";
        failures.push({ eventId: eventId, error: message });
      }
    });
    return {
      ok: failures.length === 0,
      accepted: accepted,
      applied: applied,
      failures: failures
    };
  } finally {
    lock.releaseLock();
  }
}

function authBackupSheetV4_() {
  const spreadsheet = masterSpreadsheetV4_();
  const name = "D1BackupEvents";
  const sheet = spreadsheet.getSheetByName(name) || spreadsheet.insertSheet(name);
  ensureSheetWidth_(sheet, 7);
  const headers = [
    "eventId", "action", "payloadJson", "sourceCreatedAt", "backedUpAt",
    "applyStatus", "applyError"
  ];
  const current = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0];
  if (current.join("|") !== headers.join("|")) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  return sheet;
}

function dispatchV4Action_(body) {
  const action = String(body.action || "");
  if (action === "ingestD1Backup") {
    try {
      return ingestD1BackupV4_(body);
    } catch (error) {
      return { ok: false, code: String(error && error.message ? error.message : error) };
    }
  }
  const actions = {
    login: function() { return loginV4_(body); },
    logout: function() { return logoutV4_(body); },
    me: function() {
      const auth = requireAuthV4_(body);
      return {
        ok: true,
        codeVersion: BRIDGE_API_VERSION,
        codeBuild: GUEST_STAR_CODE_BUILD,
        user: publicUserV4_(auth.user),
        selection: accessibleSelectionV4_(auth.user)
      };
    },
    changePassword: function() { return changePasswordV4_(body); },
    createOneTimeLoginCode: function() { return createOneTimeLoginCodeV4_(body); },
    consumeOneTimeLoginCode: function() { return consumeOneTimeLoginCodeV4_(body); },
    submitReview: function() { return submitReviewV4_(body); },
    createGuestReminder: function() { return createGuestReminderV4_(body); },
    unsubscribeGuest: function() { return unsubscribeGuestV4_(body); },
    exportD1Snapshot: function() { return exportD1SnapshotV4_(requireAuthV4_(body)); },
    adminState: function() { return adminStateV4_(requireAuthV4_(body)); },
    createHost: function() { return createHostUserV4_(requireAuthV4_(body), body); },
    updateHost: function() { return updateHostUserV4_(requireAuthV4_(body), body); },
    setHostPassword: function() { return setHostPasswordV4_(requireAuthV4_(body), body); },
    createHotel: function() { return createHotelForSuperhostV4_(requireAuthV4_(body), body); },
    updateHotel: function() { return updateHotelForSuperhostV4_(requireAuthV4_(body), body); },
    createVenue: function() { return createVenueV4_(requireAuthV4_(body), body); },
    createActivity: function() { return createActivityV4_(requireAuthV4_(body), body); },
    updateActivityLanguages: function() {
      return updateActivityLanguagesV4_(requireAuthV4_(body), body);
    },
    assignUser: function() { return assignUserV4_(requireAuthV4_(body), body); },
    revokeAssignment: function() { return revokeAssignmentV4_(requireAuthV4_(body), body); },
    revokeDevice: function() { return revokeDeviceV4_(requireAuthV4_(body), body); }
  };
  if (!actions[action]) return dispatchAuthenticatedExperienceV4_(action, body);
  try {
    return actions[action]();
  } catch (error) {
    const code = String(error && error.message ? error.message : error);
    return { ok: false, code: code };
  } finally {
    REQUEST_DATA_SHEET_ID_ = "";
  }
}

function publicHotelIdentifierV4_(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/^https?:\/\/[^/]+\/h\//i, "").replace(/^\/+|\/+$/g, "");
}

function resolvePublicHotelV4_(identifier) {
  const key = publicHotelIdentifierV4_(identifier);
  if (!key) return null;
  const hotels = tableRowsV4_(masterSpreadsheetV4_(), "Hotels", V4_MASTER_TABLES.Hotels);
  if (key === "default") {
    const defaultHotelId = PropertiesService.getScriptProperties()
      .getProperty("DEFAULT_PUBLIC_HOTEL_ID");
    return hotels.filter(function(hotel) {
      return hotel.status === "active" && hotel.hotelId === defaultHotelId;
    })[0] || null;
  }
  return hotels.filter(function(hotel) {
    return hotel.status === "active" && (
      hotel.publicCode === key ||
      hotel.slug + "-" + hotel.publicCode === key ||
      publicHotelIdentifierV4_(hotel.publicUrl) === key
    );
  })[0] || null;
}

function publicTenantV4_(hotel) {
  const master = masterSpreadsheetV4_();
  const activity = hotel.activePublicActivityId
    ? findRecordV4_(
      master,
      "Activities",
      V4_MASTER_TABLES.Activities,
      "activityId",
      hotel.activePublicActivityId
    )
    : null;
  const venue = activity
    ? findRecordV4_(master, "Venues", V4_MASTER_TABLES.Venues, "venueId", activity.venueId)
    : null;
  return { hotel: hotel, venue: venue, activity: activity };
}

function publicBrandingV4_(hotelId) {
  const branding = tableRowsV4_(
    masterSpreadsheetV4_(),
    "HotelBranding",
    V4_MASTER_TABLES.HotelBranding
  ).filter(function(record) { return record.hotelId === hotelId; })[0] || {};
  const safe = {};
  V4_MASTER_TABLES.HotelBranding.forEach(function(field) {
    if (
      field !== "hotelBrandingId" &&
      field !== "hotelId" &&
      field !== "updatedAt"
    ) safe[field] = branding[field] === undefined ? "" : branding[field];
  });
  return safe;
}

function upcomingForHotelV4_(hotelId) {
  const master = masterSpreadsheetV4_();
  const now = Date.now();
  return tableRowsV4_(master, "ActivitySchedules", V4_MASTER_TABLES.ActivitySchedules)
    .filter(function(schedule) {
      return schedule.hotelId === hotelId &&
        schedule.status === "active" &&
        new Date(schedule.scheduledStartAt).getTime() > now;
    })
    .sort(function(left, right) {
      return new Date(left.scheduledStartAt).getTime() - new Date(right.scheduledStartAt).getTime();
    })
    .slice(0, 3)
    .map(function(schedule) {
      const activity = findRecordV4_(
        master,
        "Activities",
        V4_MASTER_TABLES.Activities,
        "activityId",
        schedule.activityId
      );
      const venue = findRecordV4_(master, "Venues", V4_MASTER_TABLES.Venues, "venueId", schedule.venueId);
      return {
        scheduleId: schedule.scheduleId,
        activityId: schedule.activityId,
        activityName: activity ? activity.name : "Guest Star Activity",
        venueName: venue ? venue.name : "",
        scheduledStartAt: schedule.scheduledStartAt,
        durationSeconds: Number(schedule.durationSeconds) || 0,
        showCountdown: schedule.showCountdown === true || String(schedule.showCountdown) === "true"
      };
    });
}

function publicExperienceStateV4_(hotel) {
  REQUEST_DATA_SHEET_ID_ = hotel.dataSheetId;
  const tenant = publicTenantV4_(hotel);
  const activity = tenant.activity;
  const state = activityAwareStateV4_(activity);
  const scheduledStartAt = activity ? String(activity.scheduledStartAt || "") : "";
  const activityStatus = activity ? String(activity.status || "") : "";
  const acceptsBeforeStart = activity && (
    activity.acceptEarlyRequests === true || String(activity.acceptEarlyRequests) === "true"
  );
  state.accepting = state.accepting === true && (
    activityStatus === "in_progress" ||
    (activityStatus === "scheduled" && acceptsBeforeStart)
  );
  return Object.assign({}, state, {
    ok: true,
    codeVersion: BRIDGE_API_VERSION,
    serverNow: isoNowV4_(),
    hotel: {
      name: hotel.name,
      slug: hotel.slug,
      publicUrl: hotel.publicUrl,
      timezone: hotel.timezone
    },
    venue: tenant.venue ? { name: tenant.venue.name } : null,
    activity: activity ? {
      activityId: activity.activityId,
      name: activity.name,
      status: activity.status,
      scheduledStartAt: scheduledStartAt,
      showCountdown: activity.showCountdown === true || String(activity.showCountdown) === "true",
      acceptEarlyRequests: activity.acceptEarlyRequests === true ||
        String(activity.acceptEarlyRequests) === "true",
      allowedLanguages: normalizeActivityLanguagesV4_(activity.allowedLanguagesJson)
    } : null,
    branding: publicBrandingV4_(hotel.hotelId),
    upcomingActivities: upcomingForHotelV4_(hotel.hotelId)
  });
}

function publicGetV4_(params) {
  const identifier = params.hotel || params.publicCode || params.code;
  const wantsPublic = params.action === "publicBootstrap" || Boolean(identifier);
  if (!wantsPublic) return null;
  const hotel = resolvePublicHotelV4_(identifier);
  if (!hotel) return { ok: false, code: "PUBLIC_LINK_NOT_FOUND" };
  try {
    return publicExperienceStateV4_(hotel);
  } finally {
    REQUEST_DATA_SHEET_ID_ = "";
  }
}

function publicRequestRateLimitV4_(hotelId, singer) {
  const cache = CacheService.getScriptCache();
  const fingerprint = tokenHashV4_(hotelId + ":" + normalizeYoutubeText_(singer)).slice(0, 32);
  const key = "request:" + fingerprint;
  const count = Math.max(0, Number(cache.get(key)) || 0) + 1;
  cache.put(key, String(count), 60);
  return count <= 8;
}

function configurePublicRequestContextV4_(body) {
  const identifier = body.publicCode || body.hotel || body.hotelCode;
  const setupComplete = PropertiesService.getScriptProperties().getProperty("V4_SETUP_COMPLETE");
  if (!identifier) return setupComplete ? { error: "HOTEL_REQUIRED" } : null;
  const hotel = resolvePublicHotelV4_(identifier);
  if (!hotel) return { error: "PUBLIC_LINK_NOT_FOUND" };
  const tenant = publicTenantV4_(hotel);
  if (!tenant.activity || tenant.activity.status === "inactive") {
    return { error: "NO_PUBLIC_ACTIVITY" };
  }
  const status = String(tenant.activity.status || "");
  const acceptsBeforeStart = tenant.activity.acceptEarlyRequests === true ||
    String(tenant.activity.acceptEarlyRequests) === "true";
  if (
    status !== "in_progress" &&
    !(status === "scheduled" && acceptsBeforeStart)
  ) {
    return { error: "CLOSED" };
  }
  if (!publicRequestRateLimitV4_(hotel.hotelId, body.name)) {
    return { error: "RATE_LIMITED" };
  }
  REQUEST_DATA_SHEET_ID_ = hotel.dataSheetId;
  return tenant;
}

function updateCentralRecordV4_(tableName, idField, id, changes) {
  const master = masterSpreadsheetV4_();
  const headers = V4_MASTER_TABLES[tableName];
  const record = findRecordV4_(master, tableName, headers, idField, id);
  if (!record) throw new Error(tableName.toUpperCase() + "_NOT_FOUND");
  updateRecordV4_(master, tableName, headers, record._row, changes);
  return Object.assign({}, record, changes);
}

function setActivePublicActivityV4_(hotel, activityId) {
  return updateCentralRecordV4_("Hotels", "hotelId", hotel.hotelId, {
    activePublicActivityId: activityId,
    updatedAt: isoNowV4_()
  });
}

function activityCycleV4_(context) {
  if (!context.activity || !context.activity.currentCycleId) return null;
  return findRecordV4_(
    spreadsheet_(),
    "ActivityCycles",
    V4_HOTEL_TABLES.ActivityCycles,
    "cycleId",
    context.activity.currentCycleId
  );
}

function createActivityCycleV4_(auth, context, status) {
  const now = isoNowV4_();
  const cycle = appendRecordV4_(spreadsheet_(), "ActivityCycles", V4_HOTEL_TABLES.ActivityCycles, {
    cycleId: Utilities.getUuid(),
    activityId: context.activity.activityId,
    hotelId: context.hotel.hotelId,
    venueId: context.venue ? context.venue.venueId : context.activity.venueId,
    startedByUserId: auth.user.userId,
    scheduledStartAt: context.activity.scheduledStartAt || "",
    startedAt: status === "in_progress" ? now : "",
    finishedAt: "",
    status: status,
    archivedAt: ""
  });
  context.activity = updateCentralRecordV4_("Activities", "activityId", context.activity.activityId, {
    currentCycleId: cycle.cycleId,
    status: status === "in_progress" ? "in_progress" : "scheduled",
    updatedAt: now
  });
  return cycle;
}

function configureActivitySheetV4_(context) {
  const cfg = spreadsheet_().getSheetByName(CONFIG);
  ensureBaseConfig_(cfg);
  ensureConfigState_(cfg);
  cfg.getRange("B2").setValue(
    Math.max(0.25, Number(context.activity.defaultDurationSeconds || 7200) / 3600)
  );
  cfg.getRange("B3").setValue(
    Math.max(0, Number(context.activity.defaultTransitionSeconds) || 0)
  );
}

function startSelectedActivityV4_(auth, body, startNew) {
  const context = resolveTenantContextV4_(auth, body);
  if (!context.activity || !context.venue) throw new Error("ACTIVITY_REQUIRED");
  requirePermissionV4_(context, startNew ? "canStartNewActivity" : "canStartActivity");
  if (startNew) resetActivity_("web");
  configureActivitySheetV4_(context);
  let cycle = activityCycleV4_(context);
  if (!cycle || cycle.status === "finished" || cycle.status === "archived") {
    cycle = createActivityCycleV4_(auth, context, "in_progress");
  } else {
    updateRecordV4_(spreadsheet_(), "ActivityCycles", V4_HOTEL_TABLES.ActivityCycles, cycle._row, {
      startedAt: cycle.startedAt || isoNowV4_(),
      status: "in_progress"
    });
    context.activity = updateCentralRecordV4_("Activities", "activityId", context.activity.activityId, {
      status: "in_progress",
      updatedAt: isoNowV4_()
    });
  }
  setActivePublicActivityV4_(context.hotel, context.activity.activityId);
  startActivity_(body.source === "bridge" ? "bridge" : "web");
  setAccepting_(true, body.source === "bridge" ? "bridge" : "web");
  auditV4_({
    userId: auth.user.userId,
    deviceId: auth.device ? auth.device.deviceId : "",
    action: startNew ? "activity.startNew" : "activity.start",
    hotelId: context.hotel.hotelId,
    venueId: context.venue.venueId,
    activityId: context.activity.activityId,
    targetId: cycle.cycleId
  });
  return selectedActivityStateV4_(auth, context);
}

function finishSelectedActivityV4_(auth, body) {
  const context = resolveTenantContextV4_(auth, body);
  if (!context.activity) throw new Error("ACTIVITY_REQUIRED");
  requirePermissionV4_(context, "canFinishActivity");
  setAccepting_(false, body.source === "bridge" ? "bridge" : "web");
  const cycle = activityCycleV4_(context);
  if (cycle) {
    updateRecordV4_(spreadsheet_(), "ActivityCycles", V4_HOTEL_TABLES.ActivityCycles, cycle._row, {
      finishedAt: isoNowV4_(),
      status: "finished"
    });
  }
  context.activity = updateCentralRecordV4_("Activities", "activityId", context.activity.activityId, {
    status: "finished",
    updatedAt: isoNowV4_()
  });
  auditV4_({
    userId: auth.user.userId,
    action: "activity.finish",
    hotelId: context.hotel.hotelId,
    venueId: context.venue ? context.venue.venueId : "",
    activityId: context.activity.activityId,
    targetId: cycle ? cycle.cycleId : ""
  });
  return selectedActivityStateV4_(auth, context);
}

function archiveQueueV4_(auth, body) {
  const context = resolveTenantContextV4_(auth, body);
  if (!context.activity) throw new Error("ACTIVITY_REQUIRED");
  requirePermissionV4_(context, "canArchiveQueue");
  const cycle = activityCycleV4_(context);
  resetActivity_(body.source === "bridge" ? "bridge" : "web");
  if (cycle) {
    updateRecordV4_(spreadsheet_(), "ActivityCycles", V4_HOTEL_TABLES.ActivityCycles, cycle._row, {
      status: "archived",
      archivedAt: isoNowV4_()
    });
  }
  context.activity = updateCentralRecordV4_("Activities", "activityId", context.activity.activityId, {
    status: "ready",
    currentCycleId: "",
    updatedAt: isoNowV4_()
  });
  auditV4_({ userId: auth.user.userId, action: "queue.archiveClear", hotelId: context.hotel.hotelId, activityId: context.activity.activityId });
  return selectedActivityStateV4_(auth, context);
}

function toggleRequestsV4_(auth, body) {
  const context = resolveTenantContextV4_(auth, body);
  if (!context.activity) throw new Error("ACTIVITY_REQUIRED");
  requirePermissionV4_(context, "canOpenCloseRequests");
  const open = body.open === true;
  if (open && context.activity.status !== "in_progress") {
    if (!context.activity.scheduledStartAt || !context.activity.defaultDurationSeconds) {
      return { ok: false, code: "QUICK_SETUP_REQUIRED" };
    }
    let cycle = activityCycleV4_(context);
    if (!cycle || cycle.status === "finished" || cycle.status === "archived") {
      cycle = createActivityCycleV4_(auth, context, "scheduled");
    }
    context.activity = updateCentralRecordV4_("Activities", "activityId", context.activity.activityId, {
      status: "scheduled",
      acceptEarlyRequests: true,
      updatedAt: isoNowV4_()
    });
    setActivePublicActivityV4_(context.hotel, context.activity.activityId);
  }
  setAccepting_(open, body.source === "bridge" ? "bridge" : "web");
  auditV4_({ userId: auth.user.userId, action: open ? "requests.open" : "requests.close", hotelId: context.hotel.hotelId, activityId: context.activity.activityId });
  return selectedActivityStateV4_(auth, context);
}

function updateActivitySettingsV4_(auth, body) {
  const context = resolveTenantContextV4_(auth, body);
  if (!context.activity) throw new Error("ACTIVITY_REQUIRED");
  const changes = { updatedAt: isoNowV4_() };
  if (body.defaultDurationSeconds !== undefined) {
    requirePermissionV4_(context, "canChangeDuration");
    changes.defaultDurationSeconds = Math.round(
      boundedNumber_(body.defaultDurationSeconds, context.activity.defaultDurationSeconds || 7200, 900, 604800)
    );
  }
  if (body.defaultTransitionSeconds !== undefined) {
    requirePermissionV4_(context, "canChangeTransition");
    changes.defaultTransitionSeconds = Math.round(
      boundedNumber_(body.defaultTransitionSeconds, context.activity.defaultTransitionSeconds || 30, 0, 900)
    );
  }
  if (
    body.scheduledStartAt !== undefined ||
    body.showCountdown !== undefined ||
    body.autoStartEnabled !== undefined ||
    body.acceptEarlyRequests !== undefined
  ) {
    requirePermissionV4_(context, "canChangeSchedule");
    if (body.scheduledStartAt !== undefined) {
      const stamp = String(body.scheduledStartAt || "");
      if (stamp && !isFinite(new Date(stamp).getTime())) return { ok: false, code: "INVALID_SCHEDULE" };
      changes.scheduledStartAt = stamp;
    }
    if (body.showCountdown !== undefined) changes.showCountdown = body.showCountdown === true;
    if (body.autoStartEnabled !== undefined) changes.autoStartEnabled = body.autoStartEnabled === true;
    if (body.acceptEarlyRequests !== undefined) changes.acceptEarlyRequests = body.acceptEarlyRequests === true;
  }
  if (body.showPublicStatus !== undefined) {
    requirePermissionV4_(context, "canShowHidePublicStatus");
    changes.showPublicStatus = body.showPublicStatus === true;
    setPublicStatusVisibility_(body.showPublicStatus === true, body.source === "bridge" ? "bridge" : "web");
  }
  if (body.allowedLanguages !== undefined) {
    if (auth.user.role !== "superhost") requirePermissionV4_(context, "canChangeSchedule");
    changes.allowedLanguagesJson = JSON.stringify(
      normalizeActivityLanguagesV4_(body.allowedLanguages)
    );
  }
  context.activity = updateCentralRecordV4_("Activities", "activityId", context.activity.activityId, changes);
  configureActivitySheetV4_(context);
  setActivePublicActivityV4_(context.hotel, context.activity.activityId);
  auditV4_({ userId: auth.user.userId, action: "activity.settings", hotelId: context.hotel.hotelId, activityId: context.activity.activityId, details: changes });
  return selectedActivityStateV4_(auth, context);
}

function selectActivityV4_(auth, body) {
  const context = resolveTenantContextV4_(auth, body);
  if (!context.activity || !context.venue) throw new Error("ACTIVITY_REQUIRED");
  if (auth.device) {
    updateRecordV4_(auth.master, "Devices", V4_MASTER_TABLES.Devices, auth.device._row, {
      hotelId: context.hotel.hotelId,
      venueId: context.venue.venueId,
      activityId: context.activity.activityId,
      lastHeartbeatAt: isoNowV4_(),
      updatedAt: isoNowV4_()
    });
  }
  return selectedActivitySummaryV4_(auth, context);
}

function selectedActivitySummaryV4_(auth, context) {
  const activity = activityWithLanguagesV4_(context.activity);
  const status = String(activity.status || "");
  const accepting = status === "in_progress" || (
    status === "scheduled" && (
      activity.acceptEarlyRequests === true || String(activity.acceptEarlyRequests) === "true"
    )
  );
  return {
    ok: true,
    codeVersion: BRIDGE_API_VERSION,
    serverNow: isoNowV4_(),
    user: publicUserV4_(auth.user),
    hotel: visibleHotelV4_(auth.user, context.hotel),
    venue: context.venue,
    activity: activity,
    permissions: context.permissions,
    state: {
      activityId: activity.activityId,
      activityHours: Math.max(0.25, Number(activity.defaultDurationSeconds || 7200) / 3600),
      transitionSeconds: Math.max(0, Number(activity.defaultTransitionSeconds || 30)),
      accepting: accepting,
      activityRunning: status === "in_progress",
      showPublicStatus: activity.showPublicStatus === true ||
        String(activity.showPublicStatus) === "true",
      updatedAt: activity.updatedAt || "",
      lastAction: "select",
      lastSource: "bridge"
    },
    share: shareInfoV4_(context.hotel)
  };
}

function selectedActivityStateV4_(auth, context) {
  REQUEST_DATA_SHEET_ID_ = context.hotel.dataSheetId;
  const freshActivity = findRecordV4_(
    auth.master,
    "Activities",
    V4_MASTER_TABLES.Activities,
    "activityId",
    context.activity.activityId
  );
  const freshHotel = findRecordV4_(
    auth.master,
    "Hotels",
    V4_MASTER_TABLES.Hotels,
    "hotelId",
    context.hotel.hotelId
  );
  const state = activityAwareStateV4_(freshActivity);
  return {
    ok: true,
    codeVersion: BRIDGE_API_VERSION,
    serverNow: isoNowV4_(),
    user: publicUserV4_(auth.user),
    hotel: visibleHotelV4_(auth.user, freshHotel),
    venue: context.venue,
    activity: activityWithLanguagesV4_(freshActivity),
    permissions: effectivePermissionsV4_(auth.user, {
      hotelId: context.hotel.hotelId,
      venueId: context.venue ? context.venue.venueId : "",
      activityId: context.activity.activityId
    }),
    state: state,
    config: bridgeConfig_(),
    requests: bridgeQueue_(),
    share: shareInfoV4_(freshHotel),
    upcomingActivities: upcomingForHotelV4_(freshHotel.hotelId)
  };
}

function shareInfoV4_(hotel) {
  const directQrUrl = "https://quickchart.io/qr?size=900&margin=2&format=png&text=" +
    encodeURIComponent(hotel.publicUrl);
  return {
    publicUrl: hotel.publicUrl,
    qrVersion: Number(hotel.qrVersion) || 1,
    qrViewUrl: directQrUrl,
    qrDownloadUrl: directQrUrl
  };
}

function hotelShareV4_(auth, body) {
  const context = resolveTenantContextV4_(auth, { hotelId: body.hotelId });
  requirePermissionV4_(context, "canViewQR");
  return { ok: true, share: shareInfoV4_(context.hotel) };
}

function regenerateHotelQrV4_(auth, body) {
  if (auth.user.role !== "superhost") throw new Error("FORBIDDEN");
  const context = resolveTenantContextV4_(auth, { hotelId: body.hotelId });
  const driveReadiness = guestStarDriveReadinessV4_(auth.master);
  const qrFileId = driveReadiness.ok
    ? createHotelQrV4_(context.hotel, driveReadiness.folder)
    : "";
  const hotel = updateCentralRecordV4_("Hotels", "hotelId", context.hotel.hotelId, {
    qrFileId: qrFileId,
    qrVersion: Math.max(1, Number(context.hotel.qrVersion) || 1) + 1,
    updatedAt: isoNowV4_()
  });
  auditV4_({ userId: auth.user.userId, action: "hotel.qrRegenerated", hotelId: hotel.hotelId, targetId: qrFileId });
  return { ok: true, share: shareInfoV4_(hotel) };
}

function dispatchAuthenticatedExperienceV4_(action, body) {
  const handlers = {
    selectActivity: function(auth) { return selectActivityV4_(auth, body); },
    activityState: function(auth) {
      const context = resolveTenantContextV4_(auth, body);
      if (!context.activity) throw new Error("ACTIVITY_REQUIRED");
      return selectedActivityStateV4_(auth, context);
    },
    startActivityV4: function(auth) { return startSelectedActivityV4_(auth, body, false); },
    finishActivityV4: function(auth) { return finishSelectedActivityV4_(auth, body); },
    startNewActivityV4: function(auth) { return startSelectedActivityV4_(auth, body, true); },
    archiveClearQueue: function(auth) { return archiveQueueV4_(auth, body); },
    toggleRequests: function(auth) { return toggleRequestsV4_(auth, body); },
    updateActivitySettings: function(auth) { return updateActivitySettingsV4_(auth, body); },
    hotelShare: function(auth) { return hotelShareV4_(auth, body); },
    regenerateHotelQr: function(auth) { return regenerateHotelQrV4_(auth, body); },
    scheduleActivity: function(auth) { return scheduleActivityV4_(auth, body); },
    cancelSchedule: function(auth) { return cancelScheduleV4_(auth, body); },
    updateHotelBranding: function(auth) { return updateHotelBrandingV4_(auth, body); },
    listReviews: function(auth) { return listReviewsV4_(auth, body); },
    updateReview: function(auth) { return updateReviewV4_(auth, body); },
    queueBridgeCommand: function(auth) { return queueBridgeCommandV4_(auth, body); },
    bridgeHeartbeat: function(auth) { return bridgeHeartbeatV4_(auth, body); },
    pollBridgeCommands: function(auth) { return pollBridgeCommandsV4_(auth, body); },
    completeBridgeCommand: function(auth) { return completeBridgeCommandV4_(auth, body); },
    bridgeExternalSync: function(auth) { return bridgeExternalSyncV4_(auth, body); },
    bridgeRequestUpdate: function(auth) { return bridgeRequestUpdateV4_(auth, body); },
    youtubeSearchV4: function(auth) {
      const context = resolveTenantContextV4_(auth, body);
      requirePermissionV4_(context, "canControlVirtualDJ");
      const requestedLanguage = body.languageCode || body.language;
      return {
        ok: true,
        languageCode: youtubeLanguageKey_(requestedLanguage),
        items: findKaraokeCandidates_(body.song, body.artist, requestedLanguage)
      };
    }
  };
  if (!handlers[action]) return null;
  try {
    return handlers[action](requireAuthV4_(body));
  } catch (error) {
    return { ok: false, code: String(error && error.message ? error.message : error) };
  } finally {
    REQUEST_DATA_SHEET_ID_ = "";
  }
}

function parseBooleanV4_(value) {
  return value === true || String(value).toLowerCase() === "true";
}

function scheduleActivityV4_(auth, body) {
  const context = resolveTenantContextV4_(auth, body);
  if (!context.activity || !context.venue) throw new Error("ACTIVITY_REQUIRED");
  requirePermissionV4_(context, "canChangeSchedule");
  let scheduledStart;
  try {
    scheduledStart = body.scheduledLocal
      ? Utilities.parseDate(
        String(body.scheduledLocal),
        context.hotel.timezone || "America/Santo_Domingo",
        "yyyy-MM-dd'T'HH:mm"
      )
      : new Date(String(body.scheduledStartAt || ""));
  } catch (error) {
    scheduledStart = new Date("");
  }
  if (!isFinite(scheduledStart.getTime())) return { ok: false, code: "INVALID_SCHEDULE" };
  const durationSeconds = Math.round(
    boundedNumber_(body.durationSeconds, context.activity.defaultDurationSeconds || 7200, 900, 604800)
  );
  const openingLeadSeconds = Math.round(
    boundedNumber_(body.requestOpeningLeadSeconds, 3600, 0, 604800)
  );
  const requestOpeningAt = body.autoOpenRequests === true
    ? new Date(scheduledStart.getTime() - openingLeadSeconds * 1000).toISOString()
    : "";
  const recurrenceType = ["none", "daily", "weekly", "monthly"].indexOf(body.recurrenceType) >= 0
    ? body.recurrenceType
    : "none";
  const now = isoNowV4_();
  const schedule = appendRecordV4_(auth.master, "ActivitySchedules", V4_MASTER_TABLES.ActivitySchedules, {
    scheduleId: Utilities.getUuid(),
    hotelId: context.hotel.hotelId,
    venueId: context.venue.venueId,
    activityId: context.activity.activityId,
    scheduledStartAt: scheduledStart.toISOString(),
    durationSeconds: durationSeconds,
    requestOpeningAt: requestOpeningAt,
    autoOpenRequests: body.autoOpenRequests === true,
    autoStartActivity: body.autoStartActivity === true,
    showCountdown: body.showCountdown !== false,
    recurrenceType: recurrenceType,
    recurrenceInterval: Math.round(boundedNumber_(body.recurrenceInterval, 1, 1, 52)),
    recurrenceDaysJson: JSON.stringify(Array.isArray(body.recurrenceDays) ? body.recurrenceDays : []),
    recurrenceEndAt: clean_(body.recurrenceEndAt),
    status: "active",
    createdByUserId: auth.user.userId,
    createdAt: now,
    updatedAt: now
  });
  context.activity = updateCentralRecordV4_("Activities", "activityId", context.activity.activityId, {
    status: context.activity.status === "in_progress" ? "in_progress" : "scheduled",
    defaultDurationSeconds: durationSeconds,
    scheduledStartAt: scheduledStart.toISOString(),
    showCountdown: body.showCountdown !== false,
    autoStartEnabled: body.autoStartActivity === true,
    acceptEarlyRequests: body.autoOpenRequests === true,
    updatedAt: now
  });
  setActivePublicActivityV4_(context.hotel, context.activity.activityId);
  configureActivitySheetV4_(context);
  auditV4_({
    userId: auth.user.userId,
    action: "schedule.created",
    hotelId: context.hotel.hotelId,
    venueId: context.venue.venueId,
    activityId: context.activity.activityId,
    targetId: schedule.scheduleId
  });
  return Object.assign(selectedActivityStateV4_(auth, context), { schedule: schedule });
}

function cancelScheduleV4_(auth, body) {
  const schedule = findRecordV4_(
    auth.master,
    "ActivitySchedules",
    V4_MASTER_TABLES.ActivitySchedules,
    "scheduleId",
    body.scheduleId
  );
  if (!schedule) return { ok: false, code: "SCHEDULE_NOT_FOUND" };
  const context = resolveTenantContextV4_(auth, schedule);
  requirePermissionV4_(context, "canChangeSchedule");
  updateRecordV4_(auth.master, "ActivitySchedules", V4_MASTER_TABLES.ActivitySchedules, schedule._row, {
    status: "cancelled",
    updatedAt: isoNowV4_()
  });
  context.activity = updateCentralRecordV4_("Activities", "activityId", context.activity.activityId, {
    scheduledStartAt: "",
    status: context.activity.status === "in_progress" ? "in_progress" : "ready",
    updatedAt: isoNowV4_()
  });
  auditV4_({ userId: auth.user.userId, action: "schedule.cancelled", hotelId: context.hotel.hotelId, activityId: context.activity.activityId, targetId: schedule.scheduleId });
  return selectedActivityStateV4_(auth, context);
}

function recurrenceDaysV4_(value) {
  try {
    const values = JSON.parse(String(value || "[]"));
    return Array.isArray(values)
      ? values.map(Number).filter(function(day) { return day >= 0 && day <= 6; })
      : [];
  } catch (error) {
    return [];
  }
}

function nextOccurrenceV4_(schedule, hotelTimezone) {
  const start = new Date(schedule.scheduledStartAt);
  if (!isFinite(start.getTime())) return "";
  const interval = Math.max(1, Math.round(Number(schedule.recurrenceInterval) || 1));
  const type = String(schedule.recurrenceType || "none");
  const timezone = hotelTimezone || Session.getScriptTimeZone() || "UTC";
  const pattern = "yyyy-MM-dd'T'HH:mm:ss";
  const localStartText = Utilities.formatDate(start, timezone, pattern);
  const localCalendar = new Date(localStartText + "Z");
  let nextLocalText = "";
  if (type === "daily") {
    localCalendar.setUTCDate(localCalendar.getUTCDate() + interval);
    nextLocalText = Utilities.formatDate(localCalendar, "UTC", pattern);
  } else if (type === "monthly") {
    localCalendar.setUTCMonth(localCalendar.getUTCMonth() + interval);
    nextLocalText = Utilities.formatDate(localCalendar, "UTC", pattern);
  } else if (type === "weekly") {
    const allowed = recurrenceDaysV4_(schedule.recurrenceDaysJson);
    const days = (allowed.length ? allowed : [localCalendar.getUTCDay()])
      .filter(function(day, index, values) { return values.indexOf(day) === index; })
      .sort(function(left, right) { return left - right; });
    const currentDay = localCalendar.getUTCDay();
    const laterDay = days.filter(function(day) { return day > currentDay; })[0];
    const offset = laterDay !== undefined
      ? laterDay - currentDay
      : 7 * interval - (currentDay - days[0]);
    localCalendar.setUTCDate(localCalendar.getUTCDate() + offset);
    nextLocalText = Utilities.formatDate(localCalendar, "UTC", pattern);
  } else {
    return "";
  }
  const next = Utilities.parseDate(nextLocalText, timezone, pattern);
  if (schedule.recurrenceEndAt) {
    const end = new Date(schedule.recurrenceEndAt).getTime();
    if (isFinite(end) && next.getTime() > end) return "";
  }
  return next.toISOString();
}

function processActivitySchedulesV4_() {
  const master = masterSpreadsheetV4_();
  const now = new Date();
  const processed = [];
  tableRowsV4_(master, "ActivitySchedules", V4_MASTER_TABLES.ActivitySchedules)
    .filter(function(schedule) { return schedule.status === "active"; })
    .forEach(function(schedule) {
      const hotel = findRecordV4_(master, "Hotels", V4_MASTER_TABLES.Hotels, "hotelId", schedule.hotelId);
      const activity = findRecordV4_(master, "Activities", V4_MASTER_TABLES.Activities, "activityId", schedule.activityId);
      const venue = findRecordV4_(master, "Venues", V4_MASTER_TABLES.Venues, "venueId", schedule.venueId);
      const owner = findRecordV4_(master, "Users", V4_MASTER_TABLES.Users, "userId", schedule.createdByUserId);
      if (!hotel || !activity || !venue || !owner || hotel.status !== "active" || owner.status !== "active") return;
      REQUEST_DATA_SHEET_ID_ = hotel.dataSheetId;
      const auth = { master: master, user: owner, session: {}, device: null };
      const context = { hotel: hotel, venue: venue, activity: activity };
      const requestOpenAt = new Date(schedule.requestOpeningAt).getTime();
      if (
        parseBooleanV4_(schedule.autoOpenRequests) &&
        isFinite(requestOpenAt) &&
        requestOpenAt <= now.getTime() &&
        activity.status !== "in_progress"
      ) {
        setActivePublicActivityV4_(hotel, activity.activityId);
        setAccepting_(true, "web");
        updateCentralRecordV4_("Activities", "activityId", activity.activityId, {
          status: "scheduled",
          acceptEarlyRequests: true,
          updatedAt: isoNowV4_()
        });
        processed.push({ scheduleId: schedule.scheduleId, action: "opened" });
      }
      const startAt = new Date(schedule.scheduledStartAt).getTime();
      if (
        parseBooleanV4_(schedule.autoStartActivity) &&
        isFinite(startAt) &&
        startAt <= now.getTime() &&
        activity.status !== "in_progress" &&
        activity.status !== "finished"
      ) {
        const permissions = effectivePermissionsV4_(owner, {
          hotelId: hotel.hotelId,
          venueId: venue.venueId,
          activityId: activity.activityId
        });
        if (owner.role === "superhost" || permissions.canStartActivity) {
          startSelectedActivityV4_(auth, {
            hotelId: hotel.hotelId,
            venueId: venue.venueId,
            activityId: activity.activityId,
            source: "web"
          }, false);
          processed.push({ scheduleId: schedule.scheduleId, action: "started" });
        }
      }
      const recurrenceNext = startAt <= now.getTime()
        ? nextOccurrenceV4_(schedule, hotel.timezone)
        : "";
      if (recurrenceNext) {
        updateRecordV4_(master, "ActivitySchedules", V4_MASTER_TABLES.ActivitySchedules, schedule._row, {
          scheduledStartAt: recurrenceNext,
          requestOpeningAt: schedule.requestOpeningAt
            ? new Date(
              new Date(recurrenceNext).getTime() -
              Math.max(0, startAt - new Date(schedule.requestOpeningAt).getTime())
            ).toISOString()
            : "",
          updatedAt: isoNowV4_()
        });
      } else if (startAt <= now.getTime() && schedule.recurrenceType === "none") {
        updateRecordV4_(master, "ActivitySchedules", V4_MASTER_TABLES.ActivitySchedules, schedule._row, {
          status: "completed",
          updatedAt: isoNowV4_()
        });
      }
    });
  REQUEST_DATA_SHEET_ID_ = "";
  return processed;
}

function ensureAutomationTriggersV4_() {
  const exists = ScriptApp.getProjectTriggers().some(function(trigger) {
    return trigger.getHandlerFunction() === "processGuestStarAutomationsV4";
  });
  if (!exists) {
    ScriptApp.newTrigger("processGuestStarAutomationsV4")
      .timeBased()
      .everyMinutes(1)
      .create();
  }
}

function processGuestStarAutomationsV4() {
  return {
    schedules: processActivitySchedulesV4_(),
    messages: processGuestMessagesV4_()
  };
}

function updateHotelBrandingV4_(auth, body) {
  const context = resolveTenantContextV4_(auth, { hotelId: body.hotelId });
  requirePermissionV4_(context, "canManageHotelBranding");
  const branding = findRecordV4_(
    auth.master,
    "HotelBranding",
    V4_MASTER_TABLES.HotelBranding,
    "hotelId",
    context.hotel.hotelId
  );
  if (!branding) return { ok: false, code: "BRANDING_NOT_FOUND" };
  const changes = { updatedAt: isoNowV4_() };
  const protectedFields = ["hotelBrandingId", "hotelId"];
  V4_MASTER_TABLES.HotelBranding.forEach(function(field) {
    if (protectedFields.indexOf(field) >= 0 || field === "updatedAt") return;
    if (Object.prototype.hasOwnProperty.call(body.branding || {}, field)) {
      const value = body.branding[field];
      changes[field] = typeof value === "boolean" ? value : clean_(value);
    }
  });
  updateRecordV4_(auth.master, "HotelBranding", V4_MASTER_TABLES.HotelBranding, branding._row, changes);
  auditV4_({ userId: auth.user.userId, action: "branding.updated", hotelId: context.hotel.hotelId, details: Object.keys(changes) });
  return { ok: true, branding: Object.assign({}, branding, changes) };
}

function emailAddressV4_(value) {
  const email = String(value || "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email.slice(0, 254) : "";
}

function validTimezoneV4_(value) {
  const timezone = String(value || "").trim();
  if (!timezone) return false;
  try {
    Utilities.formatDate(new Date(), timezone, "yyyy-MM-dd");
    return true;
  } catch (error) {
    return false;
  }
}

function publicWriteRateLimitV4_(kind, hotelId, value) {
  const cache = CacheService.getScriptCache();
  const key = kind + ":" + tokenHashV4_(hotelId + ":" + String(value || "")).slice(0, 32);
  const count = Math.max(0, Number(cache.get(key)) || 0) + 1;
  cache.put(key, String(count), 600);
  return count <= 4;
}

function submitReviewV4_(body) {
  const hotel = resolvePublicHotelV4_(body.publicCode || body.hotel || body.hotelCode);
  if (!hotel) return { ok: false, code: "PUBLIC_LINK_NOT_FOUND" };
  const tenant = publicTenantV4_(hotel);
  if (!tenant.activity) return { ok: false, code: "NO_PUBLIC_ACTIVITY" };
  const rating = Math.round(Number(body.rating));
  if (rating < 1 || rating > 5) return { ok: false, code: "RATING_REQUIRED" };
  if (!publicWriteRateLimitV4_("review", hotel.hotelId, body.guestEmail || body.comment)) {
    return { ok: false, code: "RATE_LIMITED" };
  }
  REQUEST_DATA_SHEET_ID_ = hotel.dataSheetId;
  try {
    const branding = publicBrandingV4_(hotel.hotelId);
    if (!parseBooleanV4_(branding.showInternalRating)) {
      return { ok: false, code: "REVIEWS_DISABLED" };
    }
    const now = isoNowV4_();
    const consent = body.guestContactConsent === true;
    const email = emailAddressV4_(body.guestEmail);
    const cycle = activityCycleV4_({ activity: tenant.activity });
    const review = appendRecordV4_(spreadsheet_(), "Reviews", V4_HOTEL_TABLES.Reviews, {
      reviewId: Utilities.getUuid(),
      hotelId: hotel.hotelId,
      venueId: tenant.venue ? tenant.venue.venueId : "",
      activityId: tenant.activity.activityId,
      cycleId: cycle ? cycle.cycleId : tenant.activity.currentCycleId || "",
      hostUserId: cycle ? cycle.startedByUserId : "",
      rating: rating,
      comment: clean_(body.comment),
      musicRating: boundedNumber_(body.musicRating, "", 1, 5),
      hostRating: boundedNumber_(body.hostRating, "", 1, 5),
      organizationRating: boundedNumber_(body.organizationRating, "", 1, 5),
      wouldJoinAgain: body.wouldJoinAgain === true,
      guestName: clean_(body.guestName),
      guestEmail: email,
      guestContactConsent: consent && Boolean(email),
      reviewStatus: "active",
      internalNote: "",
      assignedToUserId: "",
      createdAt: now,
      updatedAt: now,
      archivedAt: "",
      deletedAt: "",
      deletedByUserId: ""
    });
    if (consent && email && parseBooleanV4_(branding.offerFollowUp)) {
      const checkout = new Date(String(body.checkoutDate || ""));
      const scheduled = isFinite(checkout.getTime())
        ? new Date(checkout.getTime() + 24 * 60 * 60 * 1000)
        : new Date(Date.now() + 24 * 60 * 60 * 1000);
      const invitationId = Utilities.getUuid();
      appendRecordV4_(spreadsheet_(), "ReviewInvitations", V4_HOTEL_TABLES.ReviewInvitations, {
        invitationId: invitationId,
        reviewId: review.reviewId,
        hotelId: hotel.hotelId,
        guestName: clean_(body.guestName),
        guestEmail: email,
        consentGrantedAt: now,
        checkoutDate: isFinite(checkout.getTime()) ? checkout.toISOString() : "",
        scheduledSendAt: scheduled.toISOString(),
        sentAt: "",
        openedAt: "",
        completedAt: "",
        status: "pending",
        unsubscribeTokenHash: tokenHashV4_(guestUnsubscribeTokenV4_(invitationId)),
        createdAt: now,
        updatedAt: now
      });
    }
    return {
      ok: true,
      reviewId: review.reviewId,
      externalReview: parseBooleanV4_(branding.showExternalReview) ? {
        provider: branding.externalReviewProvider || "",
        url: branding.externalReviewUrl || "",
        guestCanChoose: parseBooleanV4_(branding.guestCanChooseReviewDestination)
      } : null
    };
  } finally {
    REQUEST_DATA_SHEET_ID_ = "";
  }
}

function createGuestReminderV4_(body) {
  const hotel = resolvePublicHotelV4_(body.publicCode || body.hotel || body.hotelCode);
  if (!hotel) return { ok: false, code: "PUBLIC_LINK_NOT_FOUND" };
  const tenant = publicTenantV4_(hotel);
  if (!tenant.activity || !tenant.activity.scheduledStartAt) {
    return { ok: false, code: "NO_SCHEDULED_ACTIVITY" };
  }
  const branding = publicBrandingV4_(hotel.hotelId);
  if (!parseBooleanV4_(branding.showRemindMe)) return { ok: false, code: "REMINDERS_DISABLED" };
  const email = emailAddressV4_(body.guestEmail);
  if (!email || body.consent !== true) return { ok: false, code: "CONSENT_REQUIRED" };
  if (!publicWriteRateLimitV4_("reminder", hotel.hotelId, email)) {
    return { ok: false, code: "RATE_LIMITED" };
  }
  REQUEST_DATA_SHEET_ID_ = hotel.dataSheetId;
  try {
    const existing = tableRowsV4_(spreadsheet_(), "GuestReminders", V4_HOTEL_TABLES.GuestReminders)
      .filter(function(reminder) {
        return reminder.activityId === tenant.activity.activityId &&
          String(reminder.guestEmail).toLowerCase() === email &&
          ["pending", "sent"].indexOf(reminder.status) >= 0;
      })[0];
    if (existing) return { ok: true, reminderId: existing.reminderId, alreadyRegistered: true };
    const start = new Date(tenant.activity.scheduledStartAt);
    const scheduledAt = new Date(Math.max(Date.now(), start.getTime() - 60 * 60 * 1000));
    const reminderId = Utilities.getUuid();
    appendRecordV4_(spreadsheet_(), "GuestReminders", V4_HOTEL_TABLES.GuestReminders, {
      reminderId: reminderId,
      hotelId: hotel.hotelId,
      activityId: tenant.activity.activityId,
      guestEmail: email,
      reminderType: "activity_start",
      scheduledAt: scheduledAt.toISOString(),
      sentAt: "",
      status: "pending",
      consentReferenceId: tokenHashV4_(guestUnsubscribeTokenV4_(reminderId)),
      createdAt: isoNowV4_(),
      updatedAt: isoNowV4_()
    });
    return { ok: true, reminderId: reminderId, alreadyRegistered: false };
  } finally {
    REQUEST_DATA_SHEET_ID_ = "";
  }
}

function guestUnsubscribeTokenV4_(recordId) {
  return hashSecretV4_(String(recordId || ""), secretSaltV4_()).slice(0, 48);
}

function unsubscribeGuestV4_(body) {
  const hotel = resolvePublicHotelV4_(body.publicCode || body.hotel || body.hotelCode);
  if (!hotel) return { ok: false, code: "PUBLIC_LINK_NOT_FOUND" };
  const recordId = String(body.recordId || "");
  const provided = String(body.token || "");
  if (!recordId || !provided || !safeEqualV4_(provided, guestUnsubscribeTokenV4_(recordId))) {
    return { ok: false, code: "INVALID_UNSUBSCRIBE_LINK" };
  }
  REQUEST_DATA_SHEET_ID_ = hotel.dataSheetId;
  try {
    const invitation = findRecordV4_(
      spreadsheet_(),
      "ReviewInvitations",
      V4_HOTEL_TABLES.ReviewInvitations,
      "invitationId",
      recordId
    );
    if (invitation) {
      updateRecordV4_(spreadsheet_(), "ReviewInvitations", V4_HOTEL_TABLES.ReviewInvitations, invitation._row, {
        status: "unsubscribed",
        updatedAt: isoNowV4_()
      });
      cancelFutureGuestMessagesV4_(invitation.guestEmail);
      return { ok: true };
    }
    const reminder = findRecordV4_(
      spreadsheet_(),
      "GuestReminders",
      V4_HOTEL_TABLES.GuestReminders,
      "reminderId",
      recordId
    );
    if (reminder) {
      updateRecordV4_(spreadsheet_(), "GuestReminders", V4_HOTEL_TABLES.GuestReminders, reminder._row, {
        status: "unsubscribed",
        updatedAt: isoNowV4_()
      });
      cancelFutureGuestMessagesV4_(reminder.guestEmail);
      return { ok: true };
    }
    return { ok: false, code: "RECORD_NOT_FOUND" };
  } finally {
    REQUEST_DATA_SHEET_ID_ = "";
  }
}

function cancelFutureGuestMessagesV4_(email) {
  const normalizedEmail = String(email || "").toLowerCase();
  tableRowsV4_(spreadsheet_(), "GuestReminders", V4_HOTEL_TABLES.GuestReminders)
    .filter(function(record) {
      return String(record.guestEmail).toLowerCase() === normalizedEmail && record.status === "pending";
    }).forEach(function(record) {
      updateRecordV4_(spreadsheet_(), "GuestReminders", V4_HOTEL_TABLES.GuestReminders, record._row, {
        status: "unsubscribed",
        updatedAt: isoNowV4_()
      });
    });
  tableRowsV4_(spreadsheet_(), "ReviewInvitations", V4_HOTEL_TABLES.ReviewInvitations)
    .filter(function(record) {
      return String(record.guestEmail).toLowerCase() === normalizedEmail && record.status === "pending";
    }).forEach(function(record) {
      updateRecordV4_(spreadsheet_(), "ReviewInvitations", V4_HOTEL_TABLES.ReviewInvitations, record._row, {
        status: "unsubscribed",
        updatedAt: isoNowV4_()
      });
    });
}

function processGuestMessagesV4_() {
  const master = masterSpreadsheetV4_();
  const now = Date.now();
  const results = [];
  tableRowsV4_(master, "Hotels", V4_MASTER_TABLES.Hotels)
    .filter(function(hotel) { return hotel.status === "active" && hotel.dataSheetId; })
    .forEach(function(hotel) {
      REQUEST_DATA_SHEET_ID_ = hotel.dataSheetId;
      const tenant = publicTenantV4_(hotel);
      const branding = publicBrandingV4_(hotel.hotelId);
      tableRowsV4_(spreadsheet_(), "GuestReminders", V4_HOTEL_TABLES.GuestReminders)
        .filter(function(reminder) {
          return reminder.status === "pending" &&
            reminder.consentReferenceId &&
            new Date(reminder.scheduledAt).getTime() <= now;
        }).forEach(function(reminder) {
          const activity = findRecordV4_(master, "Activities", V4_MASTER_TABLES.Activities, "activityId", reminder.activityId);
          if (!activity) return;
          const unsubscribeUrl = hotel.publicUrl + "?unsubscribe=" + encodeURIComponent(reminder.reminderId) +
            "&token=" + encodeURIComponent(guestUnsubscribeTokenV4_(reminder.reminderId));
          try {
            MailApp.sendEmail({
              to: reminder.guestEmail,
              subject: "Guest Star reminder — " + activity.name,
              body: (branding.upcomingActivityMessage || "Your Guest Star activity is coming up.") +
                "\n\n" + hotel.name + "\n" + activity.name + "\n" +
                activity.scheduledStartAt + "\n\n" + hotel.publicUrl +
                "\n\nStop reminders: " + unsubscribeUrl,
              name: branding.teamDisplayName || "Guest Star Experience"
            });
            updateRecordV4_(spreadsheet_(), "GuestReminders", V4_HOTEL_TABLES.GuestReminders, reminder._row, {
              status: "sent",
              sentAt: isoNowV4_(),
              updatedAt: isoNowV4_()
            });
            results.push({ type: "reminder", id: reminder.reminderId, status: "sent" });
          } catch (error) {
            results.push({ type: "reminder", id: reminder.reminderId, status: "failed" });
          }
        });
      tableRowsV4_(spreadsheet_(), "ReviewInvitations", V4_HOTEL_TABLES.ReviewInvitations)
        .filter(function(invitation) {
          return invitation.status === "pending" &&
            invitation.consentGrantedAt &&
            new Date(invitation.scheduledSendAt).getTime() <= now;
        }).forEach(function(invitation) {
          const unsubscribeUrl = hotel.publicUrl + "?unsubscribe=" + encodeURIComponent(invitation.invitationId) +
            "&token=" + encodeURIComponent(guestUnsubscribeTokenV4_(invitation.invitationId));
          try {
            MailApp.sendEmail({
              to: invitation.guestEmail,
              subject: "How was your Guest Star experience?",
              body: (branding.reviewInvitationMessage || "We would love your feedback.") +
                "\n\n" + hotel.publicUrl + "?review=1" +
                "\n\nStop messages: " + unsubscribeUrl,
              name: branding.teamDisplayName || "Guest Star Experience"
            });
            updateRecordV4_(spreadsheet_(), "ReviewInvitations", V4_HOTEL_TABLES.ReviewInvitations, invitation._row, {
              status: "sent",
              sentAt: isoNowV4_(),
              updatedAt: isoNowV4_()
            });
            results.push({ type: "review", id: invitation.invitationId, status: "sent" });
          } catch (error) {
            results.push({ type: "review", id: invitation.invitationId, status: "failed" });
          }
        });
    });
  REQUEST_DATA_SHEET_ID_ = "";
  return results;
}

function listReviewsV4_(auth, body) {
  const context = resolveTenantContextV4_(auth, body);
  requirePermissionV4_(context, "canViewReviews");
  const canViewContact = context.permissions.all || context.permissions.canViewGuestContact;
  const reviews = tableRowsV4_(spreadsheet_(), "Reviews", V4_HOTEL_TABLES.Reviews)
    .filter(function(review) {
      return review.hotelId === context.hotel.hotelId &&
        (!context.activity || review.activityId === context.activity.activityId) &&
        !review.deletedAt;
    }).map(function(review) {
      const copy = Object.assign({}, review);
      if (!canViewContact) {
        copy.guestEmail = copy.guestEmail ? "hidden" : "";
        copy.guestName = copy.guestName ? "Guest" : "";
      }
      return copy;
    });
  return { ok: true, reviews: reviews };
}

function updateReviewV4_(auth, body) {
  const context = resolveTenantContextV4_(auth, body);
  requirePermissionV4_(context, "canViewReviews");
  const review = findRecordV4_(spreadsheet_(), "Reviews", V4_HOTEL_TABLES.Reviews, "reviewId", body.reviewId);
  if (!review || review.hotelId !== context.hotel.hotelId) return { ok: false, code: "REVIEW_NOT_FOUND" };
  const changes = { updatedAt: isoNowV4_() };
  if (body.operation === "delete") {
    requirePermissionV4_(context, "canDeleteReviews");
    changes.deletedAt = isoNowV4_();
    changes.deletedByUserId = auth.user.userId;
    changes.reviewStatus = "deleted";
  } else if (body.operation === "archive") {
    changes.archivedAt = isoNowV4_();
    changes.reviewStatus = "archived";
  } else if (body.operation === "note") {
    changes.internalNote = clean_(body.internalNote);
  } else if (body.operation === "assign") {
    changes.assignedToUserId = clean_(body.assignedToUserId);
  } else {
    return { ok: false, code: "INVALID_REVIEW_OPERATION" };
  }
  updateRecordV4_(spreadsheet_(), "Reviews", V4_HOTEL_TABLES.Reviews, review._row, changes);
  auditV4_({ userId: auth.user.userId, action: "review." + body.operation, hotelId: context.hotel.hotelId, activityId: review.activityId, targetId: review.reviewId });
  return { ok: true };
}

function selectedDeviceContextV4_(auth) {
  if (!auth.device) throw new Error("BRIDGE_DEVICE_REQUIRED");
  if (!auth.device.hotelId || !auth.device.venueId || !auth.device.activityId) {
    throw new Error("DEVICE_SELECTION_REQUIRED");
  }
  return resolveTenantContextV4_(auth, {
    hotelId: auth.device.hotelId,
    venueId: auth.device.venueId,
    activityId: auth.device.activityId
  });
}

function bridgeHeartbeatV4_(auth, body) {
  const context = selectedDeviceContextV4_(auth);
  updateRecordV4_(auth.master, "Devices", V4_MASTER_TABLES.Devices, auth.device._row, {
    lastHeartbeatAt: isoNowV4_(),
    bridgeVersion: clean_(body.bridgeVersion || BRIDGE_API_VERSION),
    virtualDJConnected: body.virtualDJConnected === true,
    updatedAt: isoNowV4_()
  });
  return {
    ok: true,
    serverNow: isoNowV4_(),
    deviceId: auth.device.deviceId,
    activityId: context.activity.activityId,
    stateRevision: config_().stateRevision
  };
}

function queueBridgeCommandV4_(auth, body) {
  const context = resolveTenantContextV4_(auth, body);
  if (!context.activity) throw new Error("ACTIVITY_REQUIRED");
  requirePermissionV4_(context, "canControlVirtualDJ");
  const allowed = [
    "addRequest", "removeRequest", "markSang", "markSkipped", "undo",
    "synchronize", "moveRequest"
  ];
  const commandType = String(body.commandType || "");
  if (allowed.indexOf(commandType) < 0) return { ok: false, code: "INVALID_COMMAND" };
  const device = findRecordV4_(auth.master, "Devices", V4_MASTER_TABLES.Devices, "deviceId", body.deviceId);
  if (
    !device ||
    device.status !== "active" ||
    device.hotelId !== context.hotel.hotelId ||
    device.activityId !== context.activity.activityId
  ) return { ok: false, code: "BRIDGE_OFFLINE" };
  const heartbeatAge = Date.now() - new Date(device.lastHeartbeatAt).getTime();
  if (!isFinite(heartbeatAge) || heartbeatAge > 15000) {
    return { ok: false, code: "BRIDGE_OFFLINE" };
  }
  const requestedId = String(body.commandId || "");
  const commandId = /^[A-Za-z0-9_-]{8,80}$/.test(requestedId)
    ? requestedId
    : Utilities.getUuid();
  const existing = findRecordV4_(
    auth.master,
    "BridgeCommands",
    V4_MASTER_TABLES.BridgeCommands,
    "commandId",
    commandId
  );
  if (existing) {
    if (existing.requestedByUserId !== auth.user.userId) throw new Error("FORBIDDEN");
    return { ok: true, command: existing, idempotent: true };
  }
  const command = appendRecordV4_(auth.master, "BridgeCommands", V4_MASTER_TABLES.BridgeCommands, {
    commandId: commandId,
    deviceId: device.deviceId,
    activityId: context.activity.activityId,
    requestedByUserId: auth.user.userId,
    commandType: commandType,
    payloadJson: JSON.stringify(body.payload || {}),
    status: "pending",
    createdAt: isoNowV4_(),
    startedAt: "",
    completedAt: "",
    resultJson: "",
    errorMessage: ""
  });
  auditV4_({ userId: auth.user.userId, deviceId: device.deviceId, action: "bridgeCommand.queued", hotelId: context.hotel.hotelId, activityId: context.activity.activityId, targetId: command.commandId, details: { commandType: commandType } });
  return { ok: true, command: command, idempotent: false };
}

function pollBridgeCommandsV4_(auth) {
  const context = selectedDeviceContextV4_(auth);
  const now = Date.now();
  const commands = [];
  tableRowsV4_(auth.master, "BridgeCommands", V4_MASTER_TABLES.BridgeCommands)
    .filter(function(command) {
      return command.deviceId === auth.device.deviceId &&
        command.activityId === context.activity.activityId &&
        command.status === "pending";
    }).forEach(function(command) {
      const age = now - new Date(command.createdAt).getTime();
      if (!isFinite(age) || age > 120000) {
        updateRecordV4_(auth.master, "BridgeCommands", V4_MASTER_TABLES.BridgeCommands, command._row, {
          status: "expired",
          completedAt: isoNowV4_(),
          errorMessage: "Bridge did not collect the command before it expired."
        });
        return;
      }
      updateRecordV4_(auth.master, "BridgeCommands", V4_MASTER_TABLES.BridgeCommands, command._row, {
        status: "processing",
        startedAt: isoNowV4_()
      });
      commands.push({
        commandId: command.commandId,
        commandType: command.commandType,
        payload: parsePermissionsV4_(command.payloadJson),
        createdAt: command.createdAt
      });
    });
  return { ok: true, commands: commands, serverNow: isoNowV4_() };
}

function completeBridgeCommandV4_(auth, body) {
  selectedDeviceContextV4_(auth);
  const command = findRecordV4_(
    auth.master,
    "BridgeCommands",
    V4_MASTER_TABLES.BridgeCommands,
    "commandId",
    body.commandId
  );
  if (!command || command.deviceId !== auth.device.deviceId) {
    return { ok: false, code: "COMMAND_NOT_FOUND" };
  }
  if (["completed", "failed", "expired"].indexOf(command.status) >= 0) {
    return { ok: true, commandId: command.commandId, status: command.status, idempotent: true };
  }
  const succeeded = body.ok === true;
  updateRecordV4_(auth.master, "BridgeCommands", V4_MASTER_TABLES.BridgeCommands, command._row, {
    status: succeeded ? "completed" : "failed",
    completedAt: isoNowV4_(),
    resultJson: succeeded ? JSON.stringify(body.result || {}) : "",
    errorMessage: succeeded ? "" : clean_(body.errorMessage || "Command failed")
  });
  auditV4_({ userId: auth.user.userId, deviceId: auth.device.deviceId, action: succeeded ? "bridgeCommand.completed" : "bridgeCommand.failed", activityId: command.activityId, targetId: command.commandId });
  return { ok: true, commandId: command.commandId, status: succeeded ? "completed" : "failed" };
}

function bridgeRequestUpdateV4_(auth, body) {
  const context = selectedDeviceContextV4_(auth);
  requirePermissionV4_(context, "canControlVirtualDJ");
  const id = String(body.id || "");
  if (!id) return { ok: false, code: "REQUEST_ID_REQUIRED" };
  const sheet = spreadsheet_().getSheetByName(REQUESTS);
  const last = sheet.getLastRow();
  if (last < 2) return { ok: false, code: "REQUEST_NOT_FOUND" };
  const rows = sheet.getRange(2, 1, last - 1, HEADERS.length).getValues();
  const index = rows.findIndex(function(row) {
    return String(row[12] || "") === id &&
      (!row[15] || String(row[15]) === context.hotel.hotelId) &&
      (!row[17] || String(row[17]) === context.activity.activityId);
  });
  if (index < 0) return { ok: false, code: "REQUEST_NOT_FOUND" };
  const rowNumber = index + 2;
  const revision = Math.max(0, Number(rows[index][25]) || 0) + 1;
  const previousStatus = String(rows[index][11] || "Pendiente");
  const allowedStatuses = [
    "Pendiente", "Agregada a VirtualDJ", "Ya cantó", "Saltado",
    "Fuera de VirtualDJ", "No está local"
  ];
  const status = allowedStatuses.indexOf(body.status) >= 0 ? body.status : previousStatus;
  sheet.getRange(rowNumber, 12).setValue(status);
  if (body.fileName !== undefined) sheet.getRange(rowNumber, 14).setValue(clean_(body.fileName));
  const sourceUrl = clean_(body.sourceUrl);
  if (
    sourceUrl &&
    /^https:\/\/(?:www\.)?(?:youtube\.com\/watch\?|youtu\.be\/)/i.test(sourceUrl)
  ) {
    sheet.getRange(rowNumber, 11).setValue(sourceUrl);
  }
  const durationSeconds = Math.round(Number(body.durationSeconds));
  let durationChanged = false;
  if (
    isFinite(durationSeconds) &&
    durationSeconds >= 30 &&
    durationSeconds <= 12 * 60 * 60
  ) {
    const durationRange = sheet.getRange(rowNumber, 7);
    const previousDuration = durationCellSeconds_(
      durationRange.getValue(),
      durationRange.getDisplayValue()
    );
    if (Math.abs(previousDuration - durationSeconds) >= 1) {
      durationRange.setValue(durationSeconds / 86400).setNumberFormat("[h]:mm:ss");
      durationChanged = true;
    }
  }
  sheet.getRange(rowNumber, 15).setValue(new Date());
  if (body.virtualDJItemId !== undefined) sheet.getRange(rowNumber, 21).setValue(clean_(body.virtualDJItemId));
  if (body.queuePosition !== undefined) sheet.getRange(rowNumber, 23).setValue(Math.max(0, Number(body.queuePosition) || 0));
  if (body.syncState !== undefined) sheet.getRange(rowNumber, 24).setValue(clean_(body.syncState));
  if (body.lastSeenAt !== undefined) sheet.getRange(rowNumber, 25).setValue(clean_(body.lastSeenAt));
  sheet.getRange(rowNumber, 26).setValue(revision);
  if (durationChanged || skippedStatus_(previousStatus) !== skippedStatus_(status)) {
    recalculateActivity_();
  }
  return { ok: true, id: id, status: status, revision: revision };
}

function bridgeExternalSyncV4_(auth, body) {
  const context = selectedDeviceContextV4_(auth);
  requirePermissionV4_(context, "canControlVirtualDJ");
  const entries = Array.isArray(body.entries) ? body.entries.slice(0, 100) : [];
  const confirmedMissingIds = Array.isArray(body.confirmedMissingIds)
    ? body.confirmedMissingIds.map(String)
    : [];
  const sheet = spreadsheet_().getSheetByName(REQUESTS);
  ensureSheetWidth_(sheet, HEADERS.length);
  const last = sheet.getLastRow();
  const rows = last > 1
    ? sheet.getRange(2, 1, last - 1, HEADERS.length).getValues()
    : [];
  const byVdjId = {};
  rows.forEach(function(row, index) {
    if (String(row[19] || "") === "virtualdj_external" && row[20]) {
      byVdjId[String(row[20])] = { row: index + 2, values: row };
    }
  });
  const seen = {};
  entries.forEach(function(entry, index) {
    const virtualDJItemId = clean_(entry.virtualDJItemId || entry.id);
    if (!virtualDJItemId) return;
    seen[virtualDJItemId] = true;
    const existing = byVdjId[virtualDJItemId];
    const durationSeconds = Math.max(0, Math.round(Number(entry.durationSeconds) || 0));
    if (existing) {
      sheet.getRange(existing.row, 12).setValue("Agregada a VirtualDJ");
      sheet.getRange(existing.row, 14).setValue(clean_(entry.filePath));
      sheet.getRange(existing.row, 15).setValue(new Date());
      sheet.getRange(existing.row, 23).setValue(Math.max(0, Number(entry.index) || index));
      sheet.getRange(existing.row, 24).setValue("confirmed");
      sheet.getRange(existing.row, 25).setValue(isoNowV4_());
      sheet.getRange(existing.row, 26).setValue(Math.max(0, Number(existing.values[25]) || 0) + 1);
      return;
    }
    const requestId = "vdj-" + virtualDJItemId;
    sheet.appendRow([
      new Date(), clean_(entry.singer || "VirtualDJ"), clean_(entry.song || "Unknown title"),
      clean_(entry.artist), clean_(entry.comment), clean_(entry.language || ""),
      durationSeconds / 86400, config_().transition / 86400, "", "", "",
      "Agregada a VirtualDJ", requestId, clean_(entry.filePath), new Date(),
      context.hotel.hotelId, context.venue.venueId, context.activity.activityId,
      context.activity.currentCycleId || "", "virtualdj_external", virtualDJItemId,
      clean_(entry.languageCode), Math.max(0, Number(entry.index) || index),
      "confirmed", isoNowV4_(), 1
    ]);
    const addedRow = sheet.getLastRow();
    sheet.getRange(addedRow, 7, 1, 4).setNumberFormat("[h]:mm:ss");
  });
  confirmedMissingIds.forEach(function(virtualDJItemId) {
    const existing = byVdjId[virtualDJItemId];
    if (!existing || seen[virtualDJItemId]) return;
    sheet.getRange(existing.row, 12).setValue("Fuera de VirtualDJ");
    sheet.getRange(existing.row, 15).setValue(new Date());
    sheet.getRange(existing.row, 24).setValue("confirmed_missing");
    sheet.getRange(existing.row, 26).setValue(Math.max(0, Number(existing.values[25]) || 0) + 1);
  });
  if (entries.length) recalculateActivity_();
  return { ok: true, externalCount: Object.keys(seen).length };
}
