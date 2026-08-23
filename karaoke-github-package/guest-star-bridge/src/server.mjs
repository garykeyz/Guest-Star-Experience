import { createReadStream, watch } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import {
  appsScriptAction,
  completeBridgeCommand,
  controlActivity,
  fetchBridgeQueue,
  fetchBridgeIdentity,
  fetchGoogleLoginConfig,
  hasV4Session,
  pollBridgeCommands,
  searchKaraokeYouTube,
  selectBridgeActivity,
  sendBridgeHeartbeat,
  signInBridge,
  signInBridgeWithGoogle,
  signOutBridge,
  syncExternalVirtualDjEntries,
  updateBridgeConfig,
  updateBridgeRequest,
  v4AppsScriptAction
} from "./apps-script.mjs";
import {
  buildActivitySummary,
  requestOutcome,
  safeTransitionSeconds
} from "./activity-summary.mjs";
import { assignGuestAliases } from "./guest-alias.mjs";
import { loadConfig, publicConfig, ROOT, sanitizeConfig, saveConfig } from "./config.mjs";
import { clearBridgeSecrets } from "./keychain.mjs";
import { selectHitSuggestions } from "./hit-suggestions.mjs";
import {
  drawInfiniteRotation,
  isKnownRotationSong,
  normalizeFavoriteSongs,
  ROTATION_CATALOGS,
  rotationSongKey
} from "./random-rotation.mjs";
import { reconcileLocalAvailability } from "./local-availability.mjs";
import { findMatches, normalizeText, scanLibrary } from "./matcher.mjs";
import {
  queueMetadataMatches,
  reconcileTrackedQueue,
  stabilizeVirtualDjEntries
} from "./queue-reconcile.mjs";
import { reconcileQueuePresence } from "./queue-presence.mjs";
import { loadQueueState, saveQueueState } from "./queue-state.mjs";
import { orderRequestViews } from "./request-order.mjs";
import { isOnlineGuestRequest } from "./request-source.mjs";
import {
  buildKaraokeScript,
  executeVdj,
  insertKaraokeEntry,
  listKaraokeEntries,
  normalizeVdjPath,
  normalizeVdjSinger,
  queryVdj,
  removeDuplicateKaraokeEntries,
  removeKaraokeEntry
} from "./virtualdj.mjs";
import {
  copyMacClipboard,
  openMacUrl,
  selectYoutubeOptions
} from "./youtube.mjs";

const execFileAsync = promisify(execFile);
const PUBLIC_DIR = resolve(ROOT, "public");
const BRIDGE_VERSION = "4.3.0";
const BRIDGE_PROTOCOL_VERSION = "4.2.0";
const JSON_LIMIT = 256 * 1024;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8"
};

let config = await loadConfig();
let identityState = {
  user: null,
  selection: { hotels: [], venues: [], activities: [] },
  authenticated: false
};
let tenantState = {
  hotel: null,
  venue: null,
  activity: null,
  permissions: {},
  share: null,
  upcomingActivities: []
};
const storedQueueState = await loadQueueState();
let libraryFiles = [];
let requests = [];
let scanning = false;
let syncing = false;
let syncAgain = false;
let lastScanAt = null;
let lastSyncAt = null;
let libraryError = "";
let sheetError = "";
let vdjError = "";
let activityState = {
  accepting: true,
  activityHours: 2,
  transitionSeconds: 30,
  accumulatedSeconds: 0,
  remainingSeconds: 7200,
  activityStartedAt: storedQueueState.activityStartedAt || "",
  activityFinishedAt: "",
  activityRunning: Boolean(storedQueueState.activityStartedAt),
  stateRevision: 0,
  activityId: storedQueueState.activityId || "",
  updatedAt: "",
  lastAction: "",
  lastSource: ""
};
let queueActivityId = storedQueueState.activityId;
const queuedEntries = new Map(
  storedQueueState.entries.map((entry) => [entry.id, entry])
);
const queuedIds = new Set();
const suppressedQueueIds = new Set(storedQueueState.suppressedIds);
const outcomeRecoveries = new Map(
  storedQueueState.recoveries.map((recovery) => [recovery.id, recovery])
);
const removedExternallyIds = new Set();
const queueLocks = new Set();
const pendingInsertions = new Map();
let queuePresenceMisses = new Map();
let transientQueueMissingIds = new Set();
let externalQueueEntries = [];
const knownExternalEntries = new Map();
const externalQueueMisses = new Map();
const reconciliationDiagnostics = [];
const youtubeCache = new Map();
const youtubeSearchAt = new Map();
const youtubeSearches = new Map();
const hitYoutubeCache = new Map();
const clipboardHandledIds = new Set();
const rotationStates = new Map();
const reportedStatuses = new Map();
const reportedDuplicateIds = new Set();
const eventClients = new Set();
let localAvailability = new Map();
let libraryWatchers = [];
let libraryWatchTimer = null;
let scanAgain = false;
let vdjQueuePositions = new Map();
let vdjQueueCheckPromise = null;
let vdjQueueHasSnapshot = false;
let vdjQueueCount = 0;
let lastVdjQueueAt = null;
let vdjQueueEntries = [];
let vdjAvailablePaths = new Set();
let vdjRequestFilePaths = new Map();
let clipboardState = {
  requestId: "",
  url: "",
  resultType: "",
  notice: "",
  copiedAt: "",
  error: ""
};

function requireSignedInBridge() {
  if (!identityState.authenticated || !hasV4Session(config)) {
    throw new Error("Sign in to Guest Star first.");
  }
}

function requireLocalSuperhost() {
  requireSignedInBridge();
  if (identityState.user?.role !== "superhost") {
    throw new Error("Only the Superhost can use this option.");
  }
}

function currentHotelId() {
  const hotelId = String(config.lastHotelId || "");
  if (!hotelId) throw new Error("Select a hotel first.");
  return hotelId;
}

function favoritesForHotel(hotelId = currentHotelId()) {
  return normalizeFavoriteSongs(config.favoriteSongsByHotel?.[hotelId] || []);
}

function rotationCatalog(list) {
  if (list === "spanish") return ROTATION_CATALOGS.spanish;
  if (list === "english") return ROTATION_CATALOGS.english;
  if (list === "favorites") return favoritesForHotel();
  throw new Error("Choose Spanish, English, Favorites, or Both.");
}

function rotationItemView(item, list) {
  const match = findMatches(
    libraryFiles,
    item.song,
    item.artist,
    item.language,
    1
  )[0];
  const key = hitSuggestionKey(item);
  return {
    ...item,
    list,
    localAvailable: Boolean(match?.exact),
    filePath: match?.exact ? match.filePath : "",
    fileName: match?.exact ? match.fileName : "",
    youtube: hitYoutubeCache.get(key) || [],
    youtubeSearched: hitYoutubeCache.has(key)
  };
}

function drawRotationList(list, count) {
  const catalog = rotationCatalog(list);
  if (!catalog.length || Number(count) <= 0) return [];
  const stateKey = `${currentHotelId()}:${list}`;
  const result = drawInfiniteRotation(
    catalog,
    rotationStates.get(stateKey) || {},
    Math.min(Math.floor(Number(count) || 1), catalog.length)
  );
  rotationStates.set(stateKey, result.state);
  return result.items.map((item) => rotationItemView(item, list));
}

function drawRotation(list, count) {
  const target = Math.max(1, Math.min(12, Math.floor(Number(count) || 6)));
  if (list !== "both") return drawRotationList(list, target);
  const spanishCount = Math.ceil(target / 2);
  const englishCount = target - spanishCount;
  const spanish = drawRotationList("spanish", spanishCount);
  const english = drawRotationList("english", englishCount);
  const result = [];
  for (let index = 0; result.length < target; index++) {
    if (spanish[index]) result.push(spanish[index]);
    if (english[index]) result.push(english[index]);
  }
  return result;
}

async function updateFavorite(body = {}) {
  requireLocalSuperhost();
  const hotelId = String(body.hotelId || currentHotelId()).trim();
  if (!hotelId) throw new Error("Select a hotel first.");
  const favorites = favoritesForHotel(hotelId);
  const operation = String(body.operation || "add");
  const favoriteId = String(body.favoriteId || "");
  let next = favorites;
  if (operation === "delete") {
    next = favorites.filter((item) => item.favoriteId !== favoriteId);
  } else {
    const candidate = normalizeFavoriteSongs([{
      favoriteId: favoriteId || randomUUID(),
      song: body.song,
      artist: body.artist,
      language: body.language
    }])[0];
    if (!candidate) throw new Error("Enter the song and artist.");
    if (operation === "update") {
      if (!favoriteId || !favorites.some((item) => item.favoriteId === favoriteId)) {
        throw new Error("That favorite is no longer available.");
      }
      next = favorites.map((item) =>
        item.favoriteId === favoriteId ? candidate : item
      );
    } else if (!favorites.some((item) => rotationSongKey(item) === rotationSongKey(candidate))) {
      next = [...favorites, candidate];
    }
  }
  config = await saveConfig(sanitizeConfig({
    ...config,
    favoriteSongsByHotel: {
      ...config.favoriteSongsByHotel,
      [hotelId]: next
    }
  }, config));
  rotationStates.delete(`${hotelId}:favorites`);
  return { ok: true, favorites: favoritesForHotel(hotelId) };
}

function guestStarConfigured() {
  return Boolean(config.appsScriptUrl && (hasV4Session(config) || config.hostPin));
}

function json(response, status, data) {
  const body = JSON.stringify(data);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function recordReconciliation(details = {}) {
  const entry = {
    at: new Date().toISOString(),
    requestId: String(details.requestId || ""),
    virtualDJItemId: String(details.virtualDJItemId || ""),
    confidence: Math.max(0, Number(details.confidence) || 0),
    matchFields: Array.isArray(details.matchFields)
      ? details.matchFields.map(String).slice(0, 8)
      : [],
    previousStatus: String(details.previousStatus || ""),
    newStatus: String(details.newStatus || ""),
    reason: String(details.reason || "").slice(0, 240)
  };
  reconciliationDiagnostics.push(entry);
  if (reconciliationDiagnostics.length > 100) reconciliationDiagnostics.shift();
  console.info(JSON.stringify({ event: "queue_reconciliation", ...entry }));
  return entry;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > JSON_LIMIT) throw new Error("The request is too large.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("The received content is not valid JSON.");
  }
}

function requestView(item) {
  const matches = findMatches(
    libraryFiles,
    item.song,
    item.artist,
    item.languageCode || item.language
  );
  const top = matches[0];
  const queuedEntry = queuedEntries.get(item.id);
  const verifiedQueuePath =
    vdjRequestFilePaths.get(item.id) || queuedEntry?.filePath || "";
  const localAvailable = Boolean(
    top?.exact ||
    (verifiedQueuePath &&
      vdjAvailablePaths.has(normalizeVdjPath(verifiedQueuePath)))
  );
  const pendingInsertion = pendingInsertions.get(item.id) || null;
  const transientMissing = transientQueueMissingIds.has(item.id);
  const isQueued =
    !suppressedQueueIds.has(item.id) && queuedIds.has(item.id);
  const removedExternally =
    !suppressedQueueIds.has(item.id) && removedExternallyIds.has(item.id);
  const queueUnverified =
    !suppressedQueueIds.has(item.id) &&
    !removedExternally &&
    (Boolean(pendingInsertion) ||
      transientMissing ||
      (!vdjQueueHasSnapshot &&
        (queuedEntries.has(item.id) || sheetMarksVirtualDj(item))));
  const queueIndex = vdjQueuePositions.get(item.id);
  const outcome = requestOutcome(item.status);
  if (outcome) {
    const recovery = outcomeRecoveries.get(item.id);
    const recoveryEntry = recovery?.entry || queuedEntry;
    return {
      ...item,
      outcome,
      queued: false,
      removedExternally: false,
      queueUnverified: false,
      localAvailable,
      localState: outcome,
      matches,
      queuedFilePath:
        recoveryEntry?.filePath || verifiedQueuePath || queuedEntry?.filePath || "",
      queuePosition: null,
      canUndo: true,
      canRestoreToQueue: Boolean(recoveryEntry || localAvailable),
      undoOriginalPosition: Number.isInteger(recovery?.originalPosition)
        ? recovery.originalPosition + 1
        : null,
      youtube: youtubeCache.get(item.id) || [],
      youtubeSearched: youtubeCache.has(item.id),
      youtubeSearching: youtubeSearches.has(item.id),
      queueSyncState: "",
      clipboardCopied: false
    };
  }
  return {
    ...item,
    outcome: "",
    queued: isQueued,
    removedExternally,
    queueUnverified,
    localAvailable,
    queueSyncState: pendingInsertion?.phase || (transientMissing ? "confirming" : ""),
    localState: pendingInsertion
      ? pendingInsertion.phase === "adding"
        ? "adding"
        : "confirming"
      : queueUnverified
      ? localAvailable
        ? "unverified"
        : "unverified-missing"
      : removedExternally
      ? localAvailable
        ? "removed"
        : "removed-missing"
      : isQueued
        ? localAvailable
          ? "queued"
          : "queued-missing"
        : localAvailable
          ? "exact"
          : top
            ? "possible"
            : "missing",
    matches,
    queuedFilePath:
      verifiedQueuePath || (isQueued && top?.exact ? top.filePath : ""),
    queuePosition: Number.isInteger(queueIndex) ? queueIndex + 1 : null,
    youtube: youtubeCache.get(item.id) || [],
    youtubeSearched: youtubeCache.has(item.id),
    youtubeSearching: youtubeSearches.has(item.id),
    clipboardCopied:
      clipboardState.requestId === item.id &&
      Boolean(clipboardState.copiedAt) &&
      !clipboardState.error
  };
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizedActivity(data = {}) {
  const source = data?.state && typeof data.state === "object" ? data.state : data;
  const activityId = String(source.activityId ?? activityState.activityId ?? "");
  const hasSuppliedStart = Object.prototype.hasOwnProperty.call(
    source,
    "activityStartedAt"
  );
  const suppliedStartedAt = String(source.activityStartedAt || "");
  const suppliedStartedAtMs = Date.parse(suppliedStartedAt);
  const sameActivity = activityId
    ? activityId === String(activityState.activityId || "")
    : !activityState.activityId;
  const savedStartedAt = sameActivity
    ? String(activityState.activityStartedAt || "")
    : "";
  const savedStartedAtMs = Date.parse(savedStartedAt);
  const activityStartedAt = hasSuppliedStart
    ? Number.isFinite(suppliedStartedAtMs)
      ? new Date(suppliedStartedAtMs).toISOString()
      : ""
    : Number.isFinite(savedStartedAtMs)
      ? new Date(savedStartedAtMs).toISOString()
      : "";
  const hasSuppliedFinish = Object.prototype.hasOwnProperty.call(
    source,
    "activityFinishedAt"
  );
  const suppliedFinishedAtMs = Date.parse(String(source.activityFinishedAt || ""));
  const savedFinishedAtMs = sameActivity
    ? Date.parse(String(activityState.activityFinishedAt || ""))
    : NaN;
  const activityFinishedAt = hasSuppliedFinish
    ? Number.isFinite(suppliedFinishedAtMs)
      ? new Date(suppliedFinishedAtMs).toISOString()
      : ""
    : Number.isFinite(savedFinishedAtMs)
      ? new Date(savedFinishedAtMs).toISOString()
      : "";
  return {
    accepting:
      source.accepting === undefined
        ? activityState.accepting
        : source.accepting !== false,
    activityHours: numberOr(source.activityHours, activityState.activityHours),
    transitionSeconds: safeTransitionSeconds(
      source.transitionSeconds,
      activityState.transitionSeconds
    ),
    accumulatedSeconds: Math.max(
      0,
      numberOr(source.accumulatedSeconds, activityState.accumulatedSeconds)
    ),
    remainingSeconds: Math.max(
      0,
      numberOr(source.remainingSeconds, activityState.remainingSeconds)
    ),
    activityStartedAt,
    activityFinishedAt,
    activityRunning:
      source.activityRunning === undefined
        ? Boolean(activityStartedAt) && !activityFinishedAt
        : source.activityRunning !== false && Boolean(activityStartedAt) && !activityFinishedAt,
    stateRevision: Math.max(
      0,
      numberOr(source.stateRevision, activityState.stateRevision)
    ),
    activityId,
    updatedAt: String(source.updatedAt ?? activityState.updatedAt ?? ""),
    lastAction: String(source.lastAction ?? activityState.lastAction ?? ""),
    lastSource: String(source.lastSource ?? activityState.lastSource ?? "")
  };
}

function clearTransientCaches() {
  queueLocks.clear();
  pendingInsertions.clear();
  queuePresenceMisses = new Map();
  transientQueueMissingIds = new Set();
  externalQueueEntries = [];
  knownExternalEntries.clear();
  externalQueueMisses.clear();
  queuedIds.clear();
  youtubeCache.clear();
  youtubeSearchAt.clear();
  clipboardHandledIds.clear();
  reportedStatuses.clear();
  reportedDuplicateIds.clear();
  localAvailability.clear();
  removedExternallyIds.clear();
  vdjQueuePositions.clear();
  vdjQueueHasSnapshot = false;
  vdjQueueCount = 0;
  lastVdjQueueAt = null;
  vdjQueueEntries = [];
  vdjAvailablePaths = new Set();
  vdjRequestFilePaths = new Map();
  clipboardState = {
    requestId: "",
    url: "",
    resultType: "",
    notice: "",
    copiedAt: "",
    error: ""
  };
}

function applyActivityState(data) {
  const next = normalizedActivity(data);
  activityState = next;
  if (data && typeof data === "object") {
    tenantState = {
      hotel: data.hotel || tenantState.hotel,
      venue: data.venue || tenantState.venue,
      activity: data.activity || tenantState.activity,
      permissions: data.permissions || tenantState.permissions || {},
      share: data.share || tenantState.share,
      upcomingActivities: Array.isArray(data.upcomingActivities)
        ? data.upcomingActivities
        : tenantState.upcomingActivities
    };
  }
}

function bridgeRequests(data = {}) {
  const mapped = (Array.isArray(data.requests) ? data.requests : [])
    .map((item) => ({
      id: String(item.id || ""),
      sheetRow: Math.max(0, Math.floor(numberOr(item.sheetRow, 0))),
      timestamp: item.timestamp || "",
      singer: String(item.singer || item.name || "").trim(),
      song: String(item.song || "").trim(),
      artist: String(item.artist || "").trim(),
      comment: String(item.comment || "").trim(),
      language: String(item.language || "").trim(),
      languageCode: String(item.languageCode || "").trim(),
      sourceUrl: String(item.sourceUrl || "").trim(),
      sourceType: String(item.sourceType || "").trim(),
      guestIdentity: String(item.guestIdentity || "").trim(),
      guestCode: String(item.guestCode || "").trim(),
      status: String(item.status || "Pendiente"),
      fileName: String(item.fileName || "").trim(),
      durationSeconds: Math.max(0, numberOr(item.durationSeconds, 240)),
      transitionSeconds: safeTransitionSeconds(
        item.transitionSeconds,
        activityState.transitionSeconds
      ),
      updatedAt: String(item.updatedAt || "")
    }))
    .filter((item) =>
      item.id && item.singer && item.song &&
      isOnlineGuestRequest(item) &&
      !["eliminada", "cancelada"].includes(normalizeText(item.status))
    );
  const canonicalByIdentity = new Map();
  return assignGuestAliases(mapped).map((item) => {
    const metadata = [normalizeText(item.song), normalizeText(item.artist)]
      .filter(Boolean)
      .sort()
      .join("|");
    const guest = item.guestIdentity
      ? `device:${item.guestIdentity}`
      : `legacy:${normalizeText(item.singer)}`;
    const key = `${guest}|${metadata}`;
    const duplicateOf = canonicalByIdentity.get(key) || "";
    if (!duplicateOf) canonicalByIdentity.set(key, item.id);
    return { ...item, duplicateOf };
  });
}

function vdjSingerForRequest(item) {
  const singer = String(item?.singer || "").trim();
  const guestCode = String(item?.guestCode || "").trim();
  return guestCode ? `${singer} · ${guestCode}` : singer;
}

function queuedEntryFromRequest(item, preferredPath = "", actualEntry = null) {
  if (!item?.id || !item?.singer) return null;
  let filePath = String(preferredPath || "").trim();
  if (!filePath && item.fileName) {
    const expected = String(item.fileName).trim().toLowerCase();
    const named = libraryFiles.filter(
      (candidate) => basename(candidate).trim().toLowerCase() === expected
    );
    if (named.length === 1) filePath = named[0];
  }
  if (!filePath) {
    const exact = findMatches(
      libraryFiles,
      item.song,
      item.artist,
      item.languageCode || item.language,
      1
    )[0];
    if (exact?.exact) filePath = exact.filePath;
  }
  if (!filePath) return null;
  return {
    id: item.id,
    filePath,
    singer: vdjSingerForRequest(item),
    song: item.song,
    artist: item.artist,
    durationSeconds:
      Math.max(0, Number(actualEntry?.durationSeconds) || 0) ||
      Math.max(0, Number(item.durationSeconds) || 0),
    virtualDJItemId: String(actualEntry?.virtualDJItemId || ""),
    fingerprint: String(actualEntry?.fingerprint || ""),
    insertedAt:
      String(queuedEntries.get(item.id)?.insertedAt || "") ||
      new Date().toISOString(),
    lastSeenAt: actualEntry ? new Date().toISOString() : ""
  };
}

function trackingEntryFromRequest(item) {
  return queuedEntries.get(item.id) || queuedEntryFromRequest(item) || {
    id: item.id,
    filePath: "",
    singer: vdjSingerForRequest(item),
    song: item.song,
    artist: item.artist,
    durationSeconds: Math.max(0, Number(item.durationSeconds) || 0),
    virtualDJItemId: "",
    fingerprint: "",
    insertedAt: "",
    lastSeenAt: ""
  };
}

async function persistQueuedEntries(activityId = activityState.activityId) {
  queueActivityId = String(activityId || queueActivityId || "");
  await saveQueueState(
    queueActivityId,
    queuedEntries.values(),
    suppressedQueueIds.values(),
    outcomeRecoveries.values(),
    activityState.activityStartedAt
  );
}

async function resetLocalActivity(activityId) {
  requests = [];
  queuedIds.clear();
  suppressedQueueIds.clear();
  removedExternallyIds.clear();
  outcomeRecoveries.clear();
  pendingInsertions.clear();
  queuePresenceMisses = new Map();
  transientQueueMissingIds = new Set();
  vdjQueuePositions.clear();
  clearTransientCaches();
  await persistQueuedEntries(activityId);
}

async function reconcileDeletedRequests(
  nextRequests,
  nextActivity,
  { removeFromVirtualDJ = false } = {}
) {
  const activeIds = new Set(nextRequests.map((item) => item.id));
  const previousById = new Map(requests.map((item) => [item.id, item]));
  const trackedIds = new Set([...queuedIds, ...queuedEntries.keys()]);
  let changed = false;

  for (const id of [...suppressedQueueIds]) {
    if (activeIds.has(id)) continue;
    suppressedQueueIds.delete(id);
    changed = true;
  }
  for (const id of [...removedExternallyIds]) {
    if (activeIds.has(id)) continue;
    removedExternallyIds.delete(id);
    vdjQueuePositions.delete(id);
  }
  for (const id of [...outcomeRecoveries.keys()]) {
    if (activeIds.has(id)) continue;
    outcomeRecoveries.delete(id);
    changed = true;
  }
  for (const id of [...youtubeCache.keys()]) {
    if (activeIds.has(id)) continue;
    youtubeCache.delete(id);
    youtubeSearchAt.delete(id);
    clipboardHandledIds.delete(id);
    reportedStatuses.delete(id);
  }
  for (const id of [...youtubeSearchAt.keys()]) {
    if (!activeIds.has(id)) youtubeSearchAt.delete(id);
  }

  for (const id of trackedIds) {
    if (activeIds.has(id)) continue;
    const entry =
      queuedEntries.get(id) || queuedEntryFromRequest(previousById.get(id));
    if (!entry) {
      queuedIds.delete(id);
      queuedEntries.delete(id);
      removedExternallyIds.delete(id);
      vdjQueuePositions.delete(id);
      changed = true;
      continue;
    }
    if (removeFromVirtualDJ) {
      try {
        const result = await removeKaraokeEntry(config.virtualDJ, entry);
        if (result.reason === "ambiguous") {
          throw new Error(
            `VirtualDJ has more than one copy of “${entry.song}” for ${entry.singer}; none were removed.`
          );
        }
        vdjError = "";
      } catch (error) {
        vdjError =
          `The queue was archived, but one track could not be removed from VirtualDJ: ${errorMessage(error)}`;
      }
    } else {
      recordReconciliation({
        requestId: id,
        virtualDJItemId: entry.virtualDJItemId,
        previousStatus: previousById.get(id)?.status,
        newStatus: "virtualdj_external",
        reason: "request_missing_from_sheet_kept_in_virtualdj"
      });
    }
    queuedIds.delete(id);
    queuedEntries.delete(id);
    youtubeCache.delete(id);
    youtubeSearchAt.delete(id);
    clipboardHandledIds.delete(id);
    reportedStatuses.delete(id);
    removedExternallyIds.delete(id);
    vdjQueuePositions.delete(id);
    queuePresenceMisses.delete(id);
    pendingInsertions.delete(id);
    changed = true;
  }

  if (
    changed ||
    (nextActivity.activityId && nextActivity.activityId !== queueActivityId)
  ) {
    await persistQueuedEntries(nextActivity.activityId);
  }
}

async function reconcileTerminalRequests(nextRequests) {
  let changed = false;
  for (const item of nextRequests) {
    const outcome = requestOutcome(item.status);
    if (!outcome) continue;
    const id = item.id;
    const entry = queuedEntries.get(id) || queuedEntryFromRequest(item);
    let originalPosition = vdjQueuePositions.get(id);
    if (entry && (queuedIds.has(id) || queuedEntries.has(id))) {
      try {
        const result = await removeKaraokeEntry(config.virtualDJ, entry);
        if (Number.isInteger(result.index)) originalPosition = result.index;
        if (result.reason === "ambiguous") {
          vdjError =
            `VirtualDJ has ambiguous copies of “${item.song}”; remove the correct one manually.`;
        }
      } catch (error) {
        vdjError =
          `The status was saved, but “${item.song}” could not be removed from VirtualDJ: ${errorMessage(error)}`;
      }
    }
    if (!outcomeRecoveries.has(id)) {
      outcomeRecoveries.set(id, {
        id,
        outcome,
        previousStatus: entry ? "Agregada a VirtualDJ" : "Pendiente",
        originalPosition: Number.isInteger(originalPosition)
          ? originalPosition
          : null,
        markedAt: new Date().toISOString(),
        entry: entry || null
      });
      changed = true;
    }
    const hadPosition = vdjQueuePositions.has(id);
    const removedQueued = queuedIds.delete(id);
    const removedEntry = queuedEntries.delete(id);
    const removedExternally = removedExternallyIds.delete(id);
    const localChanged =
      removedQueued ||
      removedEntry ||
      removedExternally ||
      hadPosition ||
      !suppressedQueueIds.has(id);
    if (hadPosition) removeQueuePosition(id);
    if (localChanged) changed = true;
    suppressedQueueIds.add(id);
  }
  if (changed) await persistQueuedEntries();
}

function sheetMarksVirtualDj(item) {
  const status = normalizeText(item?.status);
  if (!status || status.includes("fuera") || status.includes("retirada")) {
    return false;
  }
  return (
    status.includes("agregada a virtualdj") ||
    status.includes("reagregada a virtualdj") ||
    status.includes("reenviada a virtualdj") ||
    status === "en virtualdj"
  );
}

function actualQueueEntryFromRequest(item, actualEntries, claimedIndices) {
  const targetSinger = normalizeText(normalizeVdjSinger(vdjSingerForRequest(item)));
  const candidates = actualEntries.filter(
    (entry) =>
      !claimedIndices.has(entry.index) &&
      normalizeText(normalizeVdjSinger(entry.singer)) === targetSinger
  );
  if (!candidates.length) return null;

  const expectedName = String(item.fileName || "").trim().toLowerCase();
  if (expectedName) {
    const named = candidates.filter(
      (entry) =>
        entry.filePath &&
        basename(entry.filePath).trim().toLowerCase() === expectedName
    );
    if (named.length === 1) return named[0];
  }

  const metadataMatches = candidates.filter((entry) =>
    queueMetadataMatches(item, entry)
  );
  if (metadataMatches.length === 1) return metadataMatches[0];

  const searchablePaths = candidates.map((entry) =>
    entry.filePath || [entry.artist, entry.song].filter(Boolean).join(" - ")
  );
  const top = findMatches(
    searchablePaths,
    item.song,
    item.artist,
    item.languageCode || item.language,
    1
  )[0];
  if (!top?.exact) return null;
  const matchIndex = searchablePaths.indexOf(top.filePath);
  return matchIndex >= 0 ? candidates[matchIndex] : null;
}

async function reconcileVirtualDjQueue(force = false) {
  if (vdjQueueCheckPromise) return vdjQueueCheckPromise;
  if (queueLocks.size) return;

  vdjQueueCheckPromise = (async () => {
    broadcastState();
    try {
      const initialActualEntries = await listKaraokeEntries(config.virtualDJ);
      const duplicateCleanup = await removeDuplicateKaraokeEntries(
        config.virtualDJ,
        initialActualEntries
      );
      const rawActualEntries = duplicateCleanup.entries;
      if (duplicateCleanup.removedCount > 0) {
        recordReconciliation({
          newStatus: "VirtualDJ duplicates removed",
          reason: `removed_${duplicateCleanup.removedCount}_duplicate_queue_entries`
        });
      }
      const actualEntries = stabilizeVirtualDjEntries(
        rawActualEntries,
        vdjQueueEntries
      );
      const inspectedEntries = await Promise.all(
        actualEntries.map(async (entry) => {
          let localAvailable = false;
          if (entry.filePath) {
            try {
              localAvailable = (await stat(entry.filePath)).isFile();
            } catch {
              localAvailable = false;
            }
          }
          return { ...entry, localAvailable };
        })
      );
      vdjQueueEntries = inspectedEntries;
      vdjAvailablePaths = new Set(
        inspectedEntries
          .filter((entry) => entry.localAvailable && entry.filePath)
          .map((entry) => normalizeVdjPath(entry.filePath))
      );
      const activeIds = new Set(requests.map((item) => item.id));
      const trackedById = new Map();
      for (const entry of queuedEntries.values()) {
        const item = requests.find((request) => request.id === entry.id);
        if (
          activeIds.has(entry.id) &&
          !suppressedQueueIds.has(entry.id) &&
          !requestOutcome(item?.status)
        ) {
          trackedById.set(entry.id, {
            ...entry,
            queuePosition: vdjQueuePositions.get(entry.id)
          });
        }
      }
      for (const item of requests) {
        if (
          requestOutcome(item.status) ||
          !sheetMarksVirtualDj(item) ||
          suppressedQueueIds.has(item.id) ||
          trackedById.has(item.id)
        ) {
          continue;
        }
        trackedById.set(item.id, {
          ...trackingEntryFromRequest(item),
          queuePosition: vdjQueuePositions.get(item.id)
        });
      }
      const tracked = [...trackedById.values()];
      const reconciliation = reconcileTrackedQueue(tracked, inspectedEntries);
      const presence = reconcileQueuePresence({
        previous: queuePresenceMisses,
        trackedIds: tracked.map((entry) => entry.id),
        matchedIds: new Set(reconciliation.matched.keys()),
        pendingInsertions,
        now: Date.now()
      });
      queuePresenceMisses = presence.next;
      transientQueueMissingIds = new Set(presence.transientMissing);
      const confirmedMissing = new Set(presence.confirmedMissing);
      const nextPositions = new Map();
      const nextRequestFilePaths = new Map();
      const newlyMissing = [];
      const restored = [];
      const durationUpdates = new Set();
      let adopted = false;

      for (const entry of tracked) {
        const item = requests.find((request) => request.id === entry.id);
        const actual = reconciliation.matched.get(entry.id);
        if (actual) {
          const previousStatus = item?.status || "";
          const linkedEntry = {
            ...entry,
            filePath: actual.filePath || entry.filePath,
            singer: actual.singer || entry.singer,
            song: item?.song || actual.song || entry.song,
            artist: item?.artist || actual.artist || entry.artist,
            durationSeconds:
              Math.max(0, Number(actual.durationSeconds) || 0) ||
              Math.max(0, Number(item?.durationSeconds) || 0),
            virtualDJItemId: actual.virtualDJItemId,
            fingerprint: actual.fingerprint,
            insertedAt: entry.insertedAt || new Date().toISOString(),
            lastSeenAt: new Date().toISOString()
          };
          queuedEntries.set(entry.id, linkedEntry);
          adopted = true;
          queuedIds.add(entry.id);
          pendingInsertions.delete(entry.id);
          nextPositions.set(entry.id, actual.index);
          if (actual.filePath) nextRequestFilePaths.set(entry.id, actual.filePath);
          const matchDetail = reconciliation.matchDetails.get(entry.id) || {};
          recordReconciliation({
            requestId: entry.id,
            virtualDJItemId: actual.virtualDJItemId,
            confidence: matchDetail.confidence,
            matchFields: matchDetail.fields,
            previousStatus,
            newStatus: "In VirtualDJ",
            reason: "matched_real_virtualdj_queue"
          });
          if (
            Number(actual.durationSeconds) > 0 &&
            Math.abs(
              Number(item?.durationSeconds || 0) -
              Number(actual.durationSeconds)
            ) >= 1
          ) {
            item.durationSeconds = Number(actual.durationSeconds);
            durationUpdates.add(entry.id);
          }
          if (
            removedExternallyIds.delete(entry.id) ||
            (item && !sheetMarksVirtualDj(item))
          ) {
            restored.push(entry.id);
          }
          continue;
        }
        if (!confirmedMissing.has(entry.id)) {
          if (queuedIds.has(entry.id) || sheetMarksVirtualDj(item)) {
            queuedIds.add(entry.id);
          }
          const previousPosition = vdjQueuePositions.get(entry.id);
          if (Number.isInteger(previousPosition)) {
            nextPositions.set(entry.id, previousPosition);
          }
          const previousPath =
            vdjRequestFilePaths.get(entry.id) || entry.filePath || "";
          if (previousPath) nextRequestFilePaths.set(entry.id, previousPath);
          recordReconciliation({
            requestId: entry.id,
            virtualDJItemId: entry.virtualDJItemId,
            previousStatus: item?.status,
            newStatus: "Confirming in VirtualDJ",
            reason: pendingInsertions.has(entry.id)
              ? "insertion_grace_window"
              : "temporary_missing_scan"
          });
          continue;
        }
        queuedIds.delete(entry.id);
        pendingInsertions.delete(entry.id);
        if (!removedExternallyIds.has(entry.id) || item?.status !== "Fuera de VirtualDJ") {
          newlyMissing.push(entry.id);
        }
        removedExternallyIds.add(entry.id);
        recordReconciliation({
          requestId: entry.id,
          virtualDJItemId: entry.virtualDJItemId,
          previousStatus: item?.status,
          newStatus: "Removed from VirtualDJ",
          reason: "missing_in_multiple_consecutive_scans"
        });
      }

      vdjQueuePositions = nextPositions;
      vdjRequestFilePaths = nextRequestFilePaths;
      vdjQueueHasSnapshot = true;
      vdjQueueCount = inspectedEntries.length;
      const linkedByIndex = new Map();
      for (const [requestId, actual] of reconciliation.matched) {
        linkedByIndex.set(actual.index, requestId);
      }
      vdjQueueEntries = inspectedEntries.map((entry) => ({
        ...entry,
        linkedRequestId: linkedByIndex.get(entry.index) || "",
        sourceType: linkedByIndex.has(entry.index)
          ? "public_request"
          : "virtualdj_external"
      }));
      externalQueueEntries = vdjQueueEntries.filter(
        (entry) => entry.sourceType === "virtualdj_external"
      );
      const currentExternalIds = new Set(
        externalQueueEntries.map((entry) => entry.virtualDJItemId)
      );
      externalQueueEntries.forEach((entry) => {
        knownExternalEntries.set(entry.virtualDJItemId, entry);
        externalQueueMisses.set(entry.virtualDJItemId, 0);
      });
      const confirmedMissingExternalIds = [];
      for (const [virtualDJItemId] of knownExternalEntries) {
        if (currentExternalIds.has(virtualDJItemId)) continue;
        const misses = (externalQueueMisses.get(virtualDJItemId) || 0) + 1;
        externalQueueMisses.set(virtualDJItemId, misses);
        if (misses >= 3) {
          confirmedMissingExternalIds.push(virtualDJItemId);
          knownExternalEntries.delete(virtualDJItemId);
          externalQueueMisses.delete(virtualDJItemId);
        }
      }
      lastVdjQueueAt = new Date().toISOString();
      vdjError = "";
      if (adopted) await persistQueuedEntries();
      broadcastState();

      for (const id of newlyMissing) {
        const item = requests.find((entry) => entry.id === id);
        if (!item) continue;
        item.status = "Fuera de VirtualDJ";
        try {
          await updateBridgeRequest(
            config,
            id,
            item.status,
            basename(queuedEntries.get(id)?.filePath || item.fileName || ""),
            {
              durationSeconds: item.durationSeconds,
              virtualDJItemId: queuedEntries.get(id)?.virtualDJItemId || "",
              syncState: "confirmed_missing"
            }
          );
        } catch {
          // La tarjeta local conserva la pregunta y la hoja se reintentará después.
        }
      }
      for (const id of restored) {
        const item = requests.find((entry) => entry.id === id);
        if (!item) continue;
        item.status = "Agregada a VirtualDJ";
        try {
          await updateBridgeRequest(
            config,
            id,
            item.status,
            basename(queuedEntries.get(id)?.filePath || item.fileName || ""),
            {
              durationSeconds: item.durationSeconds,
              virtualDJItemId: queuedEntries.get(id)?.virtualDJItemId || "",
              queuePosition: vdjQueuePositions.get(id),
              syncState: "confirmed",
              lastSeenAt: new Date().toISOString()
            }
          );
        } catch {
          // La cola real de VirtualDJ sigue siendo la fuente de verdad.
        }
      }
      for (const id of durationUpdates) {
        if (newlyMissing.includes(id) || restored.includes(id)) continue;
        const item = requests.find((entry) => entry.id === id);
        if (!item) continue;
        try {
          await updateBridgeRequest(
            config,
            id,
            item.status,
            basename(queuedEntries.get(id)?.filePath || item.fileName || ""),
            {
              durationSeconds: item.durationSeconds,
              virtualDJItemId: queuedEntries.get(id)?.virtualDJItemId || "",
              queuePosition: vdjQueuePositions.get(id),
              syncState: "confirmed",
              lastSeenAt: new Date().toISOString()
            }
          );
        } catch {
          // La duración exacta local permanece visible y se reintentará.
        }
      }
      if (hasV4Session(config)) {
        try {
          await syncExternalVirtualDjEntries(
            config,
            externalQueueEntries.map((entry) => ({
              virtualDJItemId: entry.virtualDJItemId,
              index: entry.index,
              filePath: entry.filePath,
              singer: entry.singer,
              song: entry.song,
              artist: entry.artist,
              durationSeconds: entry.durationSeconds,
              sourceType: "virtualdj_external"
            })),
            confirmedMissingExternalIds
          );
        } catch {
          // The real VirtualDJ queue remains authoritative; retry on the next scan.
        }
      }
    } catch (error) {
      vdjError = `The Karaoke queue could not be checked: ${errorMessage(error)}`;
    }
  })();

  try {
    await vdjQueueCheckPromise;
  } finally {
    vdjQueueCheckPromise = null;
    broadcastState();
  }
}

function stateView() {
  const requestViews = orderRequestViews(requests.map(requestView));
  const requestsByQueuePosition = new Map(
    requestViews
      .filter((item) => Number.isInteger(item.queuePosition))
      .map((item) => [item.queuePosition, item])
  );
  const verifiedQueue = vdjQueueHasSnapshot
    ? vdjQueueEntries.map((entry) => {
        const request = requestsByQueuePosition.get(entry.index + 1);
        return {
          durationSeconds:
            Number(entry.durationSeconds) > 0
              ? Number(entry.durationSeconds)
              : Number(request?.durationSeconds) || 240,
          transitionSeconds: safeTransitionSeconds(
            request?.transitionSeconds,
            activityState.transitionSeconds
          )
        };
      })
    : null;
  const activitySummary = buildActivitySummary(
    activityState,
    requestViews,
    Date.now(),
    verifiedQueue
  );
  if (vdjQueueCount > 0) activitySummary.suggestHits = false;
  const hitSuggestions = activitySummary.suggestHits
    ? selectHitSuggestions(requests, libraryFiles, activityState.activityId, 6)
        .map((item) => {
          const key = hitSuggestionKey(item);
          return {
            ...item,
            youtube: hitYoutubeCache.get(key) || [],
            youtubeSearched: hitYoutubeCache.has(key)
          };
        })
    : [];
  return {
    ok: true,
    version: BRIDGE_VERSION,
    config: publicConfig(config),
    account: {
      authenticated: identityState.authenticated && hasV4Session(config),
      user: identityState.user,
      selection: identityState.selection,
      current: {
        hotelId: config.lastHotelId,
        venueId: config.lastVenueId,
        activityId: config.lastActivityId
      }
    },
    tenant: tenantState,
    activity: activityState,
    activitySummary,
    library: {
      count: libraryFiles.length,
      lastScanAt,
      scanning,
      realtime: libraryWatchers.length > 0,
      error: libraryError
    },
    sheet: {
      lastSyncAt,
      syncing,
      error: sheetError
    },
    virtualDJ: {
      error: vdjError,
      queueCount: vdjQueueCount,
      lastQueueCheckAt: lastVdjQueueAt,
      queueVerified: vdjQueueHasSnapshot,
      checkingQueue: Boolean(vdjQueueCheckPromise),
      entries: vdjQueueEntries.map((entry) => ({
        virtualDJItemId: entry.virtualDJItemId,
        position: entry.index + 1,
        singer: entry.singer || "No singer",
        song:
          entry.song || basename(entry.filePath || "") || "Untitled track",
        artist: entry.artist || "",
        durationSeconds: Math.max(0, Number(entry.durationSeconds) || 0),
        localAvailable: entry.localAvailable === true,
        linkedRequestId: entry.linkedRequestId || "",
        sourceType: entry.sourceType || "virtualdj_external"
      })),
      externalCount: externalQueueEntries.length
    },
    clipboard: clipboardState,
    hitSuggestions,
    rotation: {
      favorites: config.lastHotelId ? favoritesForHotel(config.lastHotelId) : [],
      counts: {
        spanish: ROTATION_CATALOGS.spanish.length,
        english: ROTATION_CATALOGS.english.length,
        favorites: config.lastHotelId ? favoritesForHotel(config.lastHotelId).length : 0
      }
    },
    singerCandidates: [
      ...new Set(
        requests
          .filter((item) => requestOutcome(item.status) !== "skipped")
          .map(vdjSingerForRequest)
          .filter(Boolean)
      )
    ],
    requests: requestViews
  };
}

function broadcastState() {
  if (!eventClients.size) return;
  const message = `event: state\ndata: ${JSON.stringify(stateView())}\n\n`;
  for (const response of [...eventClients]) {
    try {
      response.write(message);
    } catch {
      eventClients.delete(response);
    }
  }
}

function openEventStream(request, response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  response.write(`event: state\ndata: ${JSON.stringify(stateView())}\n\n`);
  eventClients.add(response);
  request.on("close", () => eventClients.delete(response));
}

function refreshLocalAvailability() {
  const snapshot = requests.map((item) => ({
    id: item.id,
    available: Boolean(
      findMatches(
        libraryFiles,
        item.song,
        item.artist,
        item.languageCode || item.language,
        1
      )[0]?.exact ||
      vdjAvailablePaths.has(
        normalizeVdjPath(
          vdjRequestFilePaths.get(item.id) ||
          queuedEntries.get(item.id)?.filePath ||
          ""
        )
      )
    )
  }));
  const result = reconcileLocalAvailability(localAvailability, snapshot);
  localAvailability = result.next;

  for (const id of result.becameMissing) {
    youtubeCache.delete(id);
    youtubeSearchAt.delete(id);
    clipboardHandledIds.delete(id);
    if (clipboardState.requestId === id) {
      clipboardState = {
        requestId: "",
        url: "",
        resultType: "",
        notice: "",
        copiedAt: "",
        error: ""
      };
    }
  }
  return result.becameMissing;
}

function closeLibraryWatchers() {
  if (libraryWatchTimer) {
    clearTimeout(libraryWatchTimer);
    libraryWatchTimer = null;
  }
  for (const watcher of libraryWatchers) {
    try {
      watcher.close();
    } catch {
      // The polling fallback remains active if a watcher already closed.
    }
  }
  libraryWatchers = [];
}

function scheduleRealtimeScan() {
  if (libraryWatchTimer) clearTimeout(libraryWatchTimer);
  libraryWatchTimer = setTimeout(() => {
    libraryWatchTimer = null;
    void scanNow();
  }, 350);
  libraryWatchTimer.unref?.();
}

function startLibraryWatchers() {
  closeLibraryWatchers();
  for (const folder of config.libraryFolders) {
    try {
      const watcher = watch(
        folder,
        { recursive: true, persistent: false },
        scheduleRealtimeScan
      );
      watcher.on("error", () => {
        try {
          watcher.close();
        } catch {
          // The 10-second scan loop continues as a fallback.
        }
        libraryWatchers = libraryWatchers.filter((item) => item !== watcher);
        broadcastState();
      });
      libraryWatchers.push(watcher);
    } catch {
      // Missing or unsupported folders continue to use the scan loop.
    }
  }
  broadcastState();
}

async function scanNow() {
  if (scanning) {
    scanAgain = true;
    return;
  }
  scanning = true;
  libraryError = "";
  broadcastState();
  try {
    libraryFiles = await scanLibrary(config.libraryFolders);
    lastScanAt = new Date().toISOString();
  } catch (error) {
    libraryError = errorMessage(error);
  } finally {
    scanning = false;
  }
  refreshLocalAvailability();
  broadcastState();
  await reportLocalStates();
  await prepareMissingYoutube();
  await autoQueueExactMatches();
  broadcastState();
  if (scanAgain) {
    scanAgain = false;
    scheduleRealtimeScan();
  }
}

async function syncNow() {
  if (!guestStarConfigured()) return;
  if (syncing) {
    syncAgain = true;
    return;
  }
  syncing = true;
  sheetError = "";
  broadcastState();
  try {
    const data = await fetchBridgeQueue(config);
    const nextActivity = normalizedActivity(data);
    const receivedRequests = bridgeRequests(data);
    const duplicateRequests = receivedRequests.filter((item) => item.duplicateOf);
    const nextRequests = receivedRequests.filter((item) => !item.duplicateOf);
    const activityChanged =
      queueActivityId &&
      nextActivity.activityId &&
      queueActivityId !== nextActivity.activityId;
    if (activityChanged) suppressedQueueIds.clear();
    await reconcileDeletedRequests(nextRequests, nextActivity);
    if (activityChanged) clearTransientCaches();
    requests = nextRequests;
    refreshLocalAvailability();
    applyActivityState(data);
    await reconcileTerminalRequests(nextRequests);
    lastSyncAt = new Date().toISOString();
    broadcastState();
    for (const item of requests) {
      if (requestOutcome(item.status)) continue;
      if (!sheetMarksVirtualDj(item)) continue;
      if (suppressedQueueIds.has(item.id)) continue;
      if (!queuedEntries.has(item.id)) {
        const entry = queuedEntryFromRequest(item);
        if (entry) queuedEntries.set(item.id, entry);
      }
    }
    await persistQueuedEntries(nextActivity.activityId);
    for (const duplicate of duplicateRequests) {
      if (reportedDuplicateIds.has(duplicate.id)) continue;
      try {
        await updateBridgeRequest(config, duplicate.id, "Cancelada", "", {
          syncState: `duplicate_of:${duplicate.duplicateOf}`
        });
        reportedDuplicateIds.add(duplicate.id);
        recordReconciliation({
          requestId: duplicate.id,
          previousStatus: duplicate.status,
          newStatus: "Canceled duplicate",
          reason: `duplicate_request_of:${duplicate.duplicateOf}`
        });
      } catch {
        // The local Bridge still suppresses the duplicate for this cycle.
        reportedDuplicateIds.add(duplicate.id);
      }
    }
  } catch (error) {
    sheetError = errorMessage(error);
  }
  try {
    await reconcileVirtualDjQueue();
    await reportLocalStates();
    await prepareMissingYoutube();
    await prepareHitSuggestionYoutube();
    await autoQueueExactMatches();
  } catch (error) {
    if (!sheetError) sheetError = errorMessage(error);
  } finally {
    syncing = false;
    broadcastState();
    if (syncAgain) {
      syncAgain = false;
      void syncNow();
    }
  }
}

async function reportLocalStates() {
  if (!guestStarConfigured()) return;
  for (const item of requests) {
    if (requestOutcome(item.status)) continue;
    if (queuedIds.has(item.id) || removedExternallyIds.has(item.id)) continue;
    if (
      !vdjQueueHasSnapshot &&
      (queuedEntries.has(item.id) || sheetMarksVirtualDj(item))
    ) {
      continue;
    }
    const top = findMatches(
      libraryFiles,
      item.song,
      item.artist,
      item.languageCode || item.language,
      1
    )[0];
    const verifiedQueuePath =
      vdjRequestFilePaths.get(item.id) ||
      queuedEntries.get(item.id)?.filePath ||
      "";
    const verifiedInVirtualDJ = Boolean(
      verifiedQueuePath &&
      vdjAvailablePaths.has(normalizeVdjPath(verifiedQueuePath))
    );
    const status = top?.exact || verifiedInVirtualDJ
      ? "Local encontrado"
      : top
        ? "Coincidencia para revisar"
        : "No está local";
    if (reportedStatuses.get(item.id) === status || item.status === status) continue;
    try {
      await updateBridgeRequest(
        config,
        item.id,
        status,
        top?.exact ? top.fileName : basename(verifiedQueuePath || "")
      );
      reportedStatuses.set(item.id, status);
      item.status = status;
    } catch {
      // La próxima sincronización volverá a intentarlo.
    }
  }
}

async function assertAllowedFile(filePath) {
  const target = await realpath(String(filePath || ""));
  const info = await stat(target);
  if (!info.isFile()) throw new Error("The selected track is not a file.");
  for (const folder of config.libraryFolders) {
    try {
      const root = await realpath(folder);
      if (target === root || target.startsWith(`${root}${sep}`)) return target;
    } catch {
      // Ignore folders that disappeared after the last scan.
    }
  }
  throw new Error("The track is not inside a configured karaoke folder.");
}

async function firstAllowedFile(candidates) {
  let lastError = null;
  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    try {
      return await assertAllowedFile(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  throw new Error("The song is not yet available in the local library.");
}

function removeQueuePosition(id) {
  const removedPosition = vdjQueuePositions.get(id);
  vdjQueuePositions.delete(id);
  if (!Number.isInteger(removedPosition)) return;
  for (const [requestId, position] of vdjQueuePositions) {
    if (position > removedPosition) {
      vdjQueuePositions.set(requestId, position - 1);
    }
  }
  vdjQueueCount = Math.max(0, vdjQueueCount - 1);
}

function appendQueuePosition(id) {
  const knownEnd = Math.max(
    vdjQueueCount,
    ...[...vdjQueuePositions.values()].map((position) => position + 1)
  );
  vdjQueuePositions.set(id, knownEnd);
  vdjQueueCount = knownEnd + 1;
}

async function queueRequest(id, requestedPath, options = {}) {
  const item = requests.find((entry) => entry.id === id);
  if (!item) throw new Error("The request is no longer available.");
  if (requestOutcome(item.status)) {
    throw new Error("This request was already marked completed or skipped.");
  }
  if (vdjQueueCheckPromise) await vdjQueueCheckPromise;
  const wasQueued = !suppressedQueueIds.has(id) && queuedIds.has(id);
  const wasRemovedExternally = removedExternallyIds.has(id);
  const requeue = Boolean(options.requeue) && wasQueued;
  if (wasQueued && !requeue && vdjQueueHasSnapshot) {
    return { ok: true, alreadyQueued: true, linked: true };
  }
  if (queueLocks.has(id)) throw new Error("This request is already being processed.");
  queueLocks.add(id);
  pendingInsertions.set(id, {
    phase: "adding",
    startedAt: Date.now()
  });
  broadcastState();
  try {
    const exact = findMatches(
      libraryFiles,
      item.song,
      item.artist,
      item.languageCode || item.language,
      1
    )[0];
    const filePath = await firstAllowedFile([
      requestedPath,
      exact?.exact ? exact.filePath : "",
      queuedEntries.get(id)?.filePath
    ]);
    let previousRemoved = false;
    if (requeue) {
      const tracked = queuedEntries.get(id) || queuedEntryFromRequest(item, filePath);
      if (tracked) {
        const removal = await removeKaraokeEntry(config.virtualDJ, tracked);
        if (removal.reason === "ambiguous") {
          throw new Error(
            "VirtualDJ has more than one identical copy. Remove the correct one directly in VirtualDJ before sending it again."
          );
        }
        previousRemoved = removal.removed === true;
        if (previousRemoved) removeQueuePosition(id);
      }
    }
    pendingInsertions.set(id, {
      phase: "confirming",
      startedAt: pendingInsertions.get(id)?.startedAt || Date.now()
    });
    broadcastState();
    const insertionEntry = {
      ...trackingEntryFromRequest(item),
      filePath
    };
    const result = await insertKaraokeEntry(
      config.virtualDJ,
      insertionEntry,
      Number.MAX_SAFE_INTEGER
    );
    if (!result.verified || !result.entry) {
      throw new Error(
        "VirtualDJ received the command but did not confirm the song in the queue."
      );
    }
    const actualEntry = stabilizeVirtualDjEntries(
      [{ ...result.entry, index: result.index }],
      vdjQueueEntries
    )[0];
    suppressedQueueIds.delete(id);
    removedExternallyIds.delete(id);
    transientQueueMissingIds.delete(id);
    queuePresenceMisses.delete(id);
    queuedIds.add(id);
    vdjQueuePositions.set(id, result.index);
    vdjQueueCount = Math.max(vdjQueueCount, result.index + 1);
    const queuedEntry = queuedEntryFromRequest(item, filePath, actualEntry);
    if (queuedEntry) {
      queuedEntries.set(id, queuedEntry);
      await persistQueuedEntries();
    }
    pendingInsertions.delete(id);
    vdjError = "";
    item.status = wasRemovedExternally
      ? "Reagregada a VirtualDJ"
      : requeue
        ? "Reenviada a VirtualDJ"
        : "Agregada a VirtualDJ";
    let warning = "";
    try {
      await updateBridgeRequest(config, id, item.status, basename(filePath), {
        durationSeconds: item.durationSeconds,
        virtualDJItemId: queuedEntry?.virtualDJItemId || "",
        queuePosition: result.index,
        syncState: "confirmed",
        lastSeenAt: new Date().toISOString()
      });
    } catch (error) {
      warning = `The song entered VirtualDJ, but Guest Star did not confirm the update: ${errorMessage(error)}`;
    }
    return {
      ok: true,
      result,
      alreadyQueued: result.alreadyQueued === true,
      linked: result.alreadyQueued === true,
      requeued: requeue,
      restored: wasRemovedExternally,
      previousRemoved,
      warning
    };
  } catch (error) {
    pendingInsertions.delete(id);
    vdjError = errorMessage(error);
    throw error;
  } finally {
    queueLocks.delete(id);
    broadcastState();
  }
}

async function removeQueuedRequest(id) {
  const item = requests.find((entry) => entry.id === id);
  if (!item) throw new Error("The request is no longer available.");
  if (vdjQueueCheckPromise) await vdjQueueCheckPromise;
  if (queueLocks.has(id)) throw new Error("This request is already being processed.");
  queueLocks.add(id);
  try {
    const entry = queuedEntries.get(id) || queuedEntryFromRequest(item);
    if (!entry) {
      throw new Error("The file associated with this request was not found.");
    }
    const result = await removeKaraokeEntry(config.virtualDJ, entry);
    if (result.reason === "ambiguous") {
      throw new Error(
        "VirtualDJ has more than one identical copy; none were removed for safety."
      );
    }

    queuedIds.delete(id);
    removedExternallyIds.delete(id);
    removeQueuePosition(id);
    queuedEntries.delete(id);
    suppressedQueueIds.add(id);
    pendingInsertions.delete(id);
    queuePresenceMisses.delete(id);
    transientQueueMissingIds.delete(id);
    await persistQueuedEntries();
    vdjError = "";
    item.status = "Retirada de rotación";
    let warning =
      result.reason === "not-found"
        ? "The song was no longer in VirtualDJ; the local status was updated."
        : "";
    try {
      await updateBridgeRequest(config, id, item.status, "");
    } catch (error) {
      warning =
        warning ||
        `The song was removed from VirtualDJ, but Guest Star did not confirm the update: ${errorMessage(error)}`;
    }
    return {
      ok: true,
      removed: result.removed === true,
      verified: result.verified === true || result.reason === "not-found",
      singer: item.singer,
      song: item.song,
      status: item.status,
      warning
    };
  } catch (error) {
    vdjError = errorMessage(error);
    throw error;
  } finally {
    queueLocks.delete(id);
    await reconcileVirtualDjQueue(true);
  }
}

async function dismissRequeue(id) {
  const item = requests.find((entry) => entry.id === id);
  if (!item) throw new Error("The request is no longer available.");
  queuedIds.delete(id);
  removedExternallyIds.delete(id);
  removeQueuePosition(id);
  queuedEntries.delete(id);
  suppressedQueueIds.add(id);
  pendingInsertions.delete(id);
  queuePresenceMisses.delete(id);
  transientQueueMissingIds.delete(id);
  await persistQueuedEntries();
  item.status = "Fuera de VirtualDJ";
  let warning = "";
  try {
    await updateBridgeRequest(config, id, item.status, "");
  } catch (error) {
    warning = `The decision was saved locally, but Guest Star did not confirm the update: ${errorMessage(error)}`;
  }
  return { ok: true, warning };
}

async function setRequestOutcome(id, outcome) {
  const item = requests.find((entry) => entry.id === id);
  if (!item) throw new Error("The request is no longer available.");
  if (!["completed", "skipped"].includes(outcome)) {
    throw new Error("Song outcome is not allowed.");
  }
  if (queueLocks.has(id)) throw new Error("This request is already being processed.");
  queueLocks.add(id);
  const status = outcome === "completed" ? "Ya cantó" : "Saltado";
  try {
    const previousStatus = item.status || "Pendiente";
    const entry = queuedEntries.get(id) || queuedEntryFromRequest(item);
    let originalPosition = vdjQueuePositions.get(id);
    let warning = "";
    let removedFromVirtualDJ = false;

    if (entry) {
      try {
        const result = await removeKaraokeEntry(config.virtualDJ, entry);
        if (result.reason === "ambiguous") {
          throw new Error(
            "VirtualDJ has more than one identical copy. Remove the correct one manually before marking the outcome."
          );
        }
        if (Number.isInteger(result.index)) originalPosition = result.index;
        removedFromVirtualDJ =
          result.removed === true || result.reason === "not-found";
      } catch (error) {
        throw new Error(
          `The live VirtualDJ queue could not be updated: ${errorMessage(error)}`
        );
      }
    }

    outcomeRecoveries.set(id, {
      id,
      outcome,
      previousStatus,
      originalPosition: Number.isInteger(originalPosition)
        ? originalPosition
        : null,
      markedAt: new Date().toISOString(),
      entry: entry || null
    });
    queuedIds.delete(id);
    removedExternallyIds.delete(id);
    if (vdjQueuePositions.has(id)) removeQueuePosition(id);
    queuedEntries.delete(id);
    suppressedQueueIds.add(id);
    pendingInsertions.delete(id);
    queuePresenceMisses.delete(id);
    transientQueueMissingIds.delete(id);
    await persistQueuedEntries();
    item.status = status;

    try {
      const data = await updateBridgeRequest(
        config,
        id,
        status,
        basename(entry?.filePath || item.fileName || ""),
        { durationSeconds: item.durationSeconds }
      );
      if (data?.state) applyActivityState(data);
    } catch (error) {
      warning =
        `The outcome is visible in Bridge, but Guest Star did not confirm the update: ${errorMessage(error)}`;
    }
    return {
      ok: true,
      status,
      outcome,
      singer: item.singer,
      song: item.song,
      removedFromVirtualDJ,
      undoOriginalPosition: Number.isInteger(originalPosition)
        ? originalPosition + 1
        : null,
      warning
    };
  } finally {
    queueLocks.delete(id);
    await reconcileVirtualDjQueue(true);
  }
}

async function undoRequestOutcome(id, placement) {
  const item = requests.find((entry) => entry.id === id);
  if (!item) throw new Error("The request is no longer available.");
  if (!requestOutcome(item.status)) {
    throw new Error("This request is no longer marked completed or skipped.");
  }
  if (!["original", "end", "pending"].includes(placement)) {
    throw new Error("Choose how you want to restore the song.");
  }
  if (queueLocks.has(id)) throw new Error("This request is already being processed.");
  queueLocks.add(id);

  try {
    const recovery = outcomeRecoveries.get(id);
    const entry =
      recovery?.entry ||
      queuedEntryFromRequest(item) ||
      queuedEntryFromRequest(
        item,
        findMatches(
          libraryFiles,
          item.song,
          item.artist,
          item.languageCode || item.language,
          1
        )[0]?.filePath || ""
      );
    if (placement === "original" && !Number.isInteger(recovery?.originalPosition)) {
      throw new Error(
        "No se pudo recuperar el turno anterior. Puedes agregarla al final."
      );
    }
    if (placement !== "pending" && !entry) {
      throw new Error(
        "The file is no longer available locally. Undo without adding it, or restore the track to the library."
      );
    }

    const pendingStatus = "Fuera de VirtualDJ";
    const pendingUpdate = await updateBridgeRequest(
      config,
      id,
      pendingStatus,
      basename(entry?.filePath || item.fileName || ""),
      { durationSeconds: item.durationSeconds }
    );
    if (pendingUpdate?.state) applyActivityState(pendingUpdate);
    item.status = pendingStatus;
    queuedIds.delete(id);
    removedExternallyIds.delete(id);
    vdjQueuePositions.delete(id);
    queuedEntries.delete(id);
    suppressedQueueIds.add(id);
    pendingInsertions.delete(id);
    queuePresenceMisses.delete(id);
    transientQueueMissingIds.delete(id);

    let restoredPosition = null;
    if (placement !== "pending") {
      const desiredPosition =
        placement === "original"
          ? recovery.originalPosition
          : Number.MAX_SAFE_INTEGER;
      const restored = await insertKaraokeEntry(
        config.virtualDJ,
        entry,
        desiredPosition
      );
      restoredPosition = restored.index;
      queuedEntries.set(id, entry);
      queuedIds.add(id);
      suppressedQueueIds.delete(id);
      vdjQueuePositions.set(id, restored.index);
      item.status = "Reagregada a VirtualDJ";
      const queuedUpdate = await updateBridgeRequest(
        config,
        id,
        item.status,
        basename(entry.filePath),
        { durationSeconds: item.durationSeconds }
      );
      if (queuedUpdate?.state) applyActivityState(queuedUpdate);
    }

    outcomeRecoveries.delete(id);
    await persistQueuedEntries();
    return {
      ok: true,
      placement,
      restoredToVirtualDJ: placement !== "pending",
      queuePosition: Number.isInteger(restoredPosition)
        ? restoredPosition + 1
        : null,
      singer: item.singer,
      song: item.song,
      status: item.status
    };
  } finally {
    queueLocks.delete(id);
    await reconcileVirtualDjQueue(true);
  }
}

function hitSuggestionKey(item = {}) {
  return [item.song, item.artist, item.language]
    .map((value) => normalizeText(value))
    .join("|");
}

async function findHitSuggestionYoutube(body = {}) {
  const suggestions = selectHitSuggestions(
    requests,
    libraryFiles,
    activityState.activityId,
    6
  );
  const suggestion = suggestions.find(
    (item) =>
      normalizeText(item.song) === normalizeText(body.song) &&
      normalizeText(item.artist) === normalizeText(body.artist)
  );
  if (!suggestion) throw new Error("The suggestion is no longer available.");
  const key = hitSuggestionKey(suggestion);
  if (body.force === true) hitYoutubeCache.delete(key);
  if (hitYoutubeCache.has(key)) return hitYoutubeCache.get(key);
  const data = await searchKaraokeYouTube(
    config,
    suggestion.song,
    suggestion.artist,
    suggestion.language,
    suggestion.languageCode || ""
  );
  const items = selectYoutubeOptions(
    Array.isArray(data.items) ? data.items : [],
    1
  );
  hitYoutubeCache.set(key, items);
  return items;
}

async function prepareHitSuggestionYoutube() {
  if (!guestStarConfigured() || vdjQueueCount > 0) return;
  const target = selectHitSuggestions(
    requests,
    libraryFiles,
    activityState.activityId,
    6
  ).find(
    (item) => !item.localAvailable && !hitYoutubeCache.has(hitSuggestionKey(item))
  );
  if (!target) return;
  try {
    await findHitSuggestionYoutube(target);
  } catch {
    hitYoutubeCache.set(hitSuggestionKey(target), []);
  }
  broadcastState();
}

async function queueHitSuggestion(body = {}) {
  const automaticSuggestions = selectHitSuggestions(
    requests,
    libraryFiles,
    activityState.activityId,
    6
  );
  const song = String(body.song || "").trim();
  const artist = String(body.artist || "").trim();
  const requested = {
    song,
    artist,
    language: String(body.language || "Español")
  };
  const favorites = config.lastHotelId ? favoritesForHotel(config.lastHotelId) : [];
  const known = isKnownRotationSong(requested, favorites);
  const suggestion = automaticSuggestions.find(
    (item) =>
      normalizeText(item.song) === normalizeText(song) &&
      normalizeText(item.artist) === normalizeText(artist)
  ) || (known ? rotationItemView(requested, String(body.list || "favorites")) : null);
  if (!suggestion) throw new Error("The suggestion is no longer available.");
  if (!suggestion.localAvailable || !suggestion.filePath) {
    throw new Error("That suggested song is not yet in the local library.");
  }

  let singer = "EMCEE";
  if (body.singerMode === "random") {
    const candidates = [
      ...new Set(
        requests
          .filter((item) => requestOutcome(item.status) !== "skipped")
          .map((item) => item.singer)
          .filter(Boolean)
      )
    ];
    if (!candidates.length) {
      throw new Error("There are no registered participants to choose from yet.");
    }
    singer = candidates[Math.floor(Math.random() * candidates.length)];
  }
  const filePath = await assertAllowedFile(suggestion.filePath);
  const result = await executeVdj(
    config.virtualDJ,
    buildKaraokeScript(filePath, singer)
  );
  vdjQueueHasSnapshot = false;
  await reconcileVirtualDjQueue(true);
  return {
    ok: true,
    result,
    singer,
    song: suggestion.song,
    artist: suggestion.artist
  };
}

async function autoQueueExactMatches() {
  if (!config.autoQueueExact) return;
  for (const item of requests) {
    if (requestOutcome(item.status)) continue;
    if (
      queuedIds.has(item.id) ||
      removedExternallyIds.has(item.id) ||
      suppressedQueueIds.has(item.id) ||
      queueLocks.has(item.id)
    ) {
      continue;
    }
    const top = findMatches(
      libraryFiles,
      item.song,
      item.artist,
      item.languageCode || item.language,
      1
    )[0];
    if (!top?.exact) continue;
    try {
      await queueRequest(item.id, top.filePath);
    } catch {
      // The error is exposed in the local panel and the host can retry manually.
    }
  }
}

async function findYoutube(id) {
  if (youtubeSearches.has(id)) return youtubeSearches.get(id);
  const item = requests.find((entry) => entry.id === id);
  if (!item) throw new Error("The request is no longer available.");

  const operation = (async () => {
    let results = [];
    try {
      const data = await searchKaraokeYouTube(
        config,
        item.song,
        item.artist,
        item.language,
        item.languageCode
      );
      results = Array.isArray(data.items) ? data.items : [];
    } catch {
      results = [];
    }
    results = selectYoutubeOptions(results, 6);
    youtubeCache.set(id, results);
    youtubeSearchAt.set(id, Date.now());
    return results;
  })();
  youtubeSearches.set(id, operation);
  broadcastState();
  try {
    return await operation;
  } finally {
    youtubeSearches.delete(id);
    broadcastState();
  }
}

async function prepareMissingYoutube() {
  if (!guestStarConfigured()) return;
  const missing = requests.filter(
    (item) =>
      !requestOutcome(item.status) &&
      !findMatches(
        libraryFiles,
        item.song,
        item.artist,
        item.languageCode || item.language,
        1
      )[0]?.exact &&
      !vdjAvailablePaths.has(
        normalizeVdjPath(
          vdjRequestFilePaths.get(item.id) ||
          queuedEntries.get(item.id)?.filePath ||
          ""
        )
      )
  );
  const unhandled = missing.filter((item) => !clipboardHandledIds.has(item.id));
  const now = Date.now();
  const retryAfterMs = 5 * 60 * 1000;
  const needsSearch = missing.filter((item) => {
    if (!youtubeCache.has(item.id)) return true;
    const cached = youtubeCache.get(item.id) || [];
    const lastAttempt = youtubeSearchAt.get(item.id) || 0;
    return cached.length === 0 && now - lastAttempt >= retryAfterMs;
  });
  if (!unhandled.length && !needsSearch.length) return;

  for (const item of needsSearch) {
    try {
      await findYoutube(item.id);
    } catch {
      youtubeCache.set(item.id, []);
      youtubeSearchAt.set(item.id, Date.now());
    }
  }

  if (!unhandled.length) return;
  unhandled.forEach((item) => clipboardHandledIds.add(item.id));
  const target = unhandled[unhandled.length - 1];
  const best = youtubeCache.get(target.id)?.[0];
  if (!best) {
    clipboardState = {
      requestId: target.id,
      url: "",
      resultType: "",
      notice: "No sufficiently reliable video with visible lyrics was found yet.",
      copiedAt: "",
      error: "No recommended link was found."
    };
    broadcastState();
    return;
  }

  clipboardState = {
    requestId: target.id,
    url: best.url,
    resultType: best.resultType || "",
    notice: best.notice || "",
    copiedAt: "",
    error: ""
  };
  broadcastState();
}

async function chooseFolder() {
  if (process.platform !== "darwin") {
    throw new Error("The automatic folder picker is available when Bridge runs on Mac.");
  }
  const script =
    'POSIX path of (choose folder with prompt "Choose your karaoke song folder")';
  const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 120000 });
  return stdout.trim().replace(/\/$/, "");
}

async function serveStatic(pathname, response) {
  const relative = pathname === "/"
    ? "index.html"
    : pathname === "/google-sign-in"
      ? "google-sign-in.html"
      : pathname.replace(/^\/+/, "");
  const filePath = resolve(PUBLIC_DIR, relative);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${sep}`)) {
    json(response, 403, { ok: false, error: "Ruta no permitida." });
    return;
  }
  try {
    await access(filePath);
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("not-file");
    response.writeHead(200, {
      "Content-Type": MIME[extname(filePath)] || "application/octet-stream",
      "Content-Length": info.size,
      "Cache-Control": "no-store"
    });
    createReadStream(filePath).pipe(response);
  } catch {
    json(response, 404, { ok: false, error: "No encontrado." });
  }
}

async function api(request, response, url) {
  const { pathname } = url;
  if (request.method === "GET" && pathname === "/api/events") {
    openEventStream(request, response);
    return;
  }
  if (request.method === "GET" && pathname === "/api/state") {
    json(response, 200, stateView());
    return;
  }
  if (request.method === "POST" && pathname === "/api/rotation/draw") {
    requireSignedInBridge();
    const body = await readJson(request);
    const list = String(body.list || "both").toLowerCase();
    const items = drawRotation(list, body.count);
    json(response, 200, { ok: true, list, items });
    return;
  }
  if (request.method === "POST" && pathname === "/api/favorites") {
    const body = await readJson(request);
    json(response, 200, await updateFavorite(body));
    broadcastState();
    return;
  }
  if (request.method === "POST" && pathname === "/api/superhost/preferences") {
    requireLocalSuperhost();
    const body = await readJson(request);
    config = await saveConfig(sanitizeConfig({
      ...config,
      superhostLanguage: body.language,
      uiLanguage: body.language
    }, config));
    json(response, 200, {
      ok: true,
      language: config.superhostLanguage
    });
    broadcastState();
    return;
  }
  if (request.method === "GET" && pathname === "/api/superhost/state") {
    requireLocalSuperhost();
    const data = await v4AppsScriptAction(config, "adminState");
    json(response, 200, {
      ...data,
      localFavoritesByHotel: config.favoriteSongsByHotel || {}
    });
    return;
  }
  if (request.method === "POST" && pathname === "/api/superhost/action") {
    requireLocalSuperhost();
    const body = await readJson(request);
    const action = String(body.action || "");
    const allowed = new Set([
      "adminState", "createHotel", "updateHotel", "createVenue", "updateVenue",
      "createActivity", "updateActivity", "setDefaultPublicExperience", "setDefaultGoogleFallback", "createHost", "updateHost", "assignUser",
      "setHostPassword", "updateActivityLanguages",
      "revokeAssignment", "revokeDevice", "updateHotelBranding",
      "scheduleActivity", "cancelSchedule", "listReviews", "updateReview",
      "regenerateHotelQr", "hotelShare"
    ]);
    if (!allowed.has(action)) throw new Error("Superhost action not allowed.");
    const data = await v4AppsScriptAction(config, action, body);
    if ([
      "createHotel", "updateHotel", "createVenue", "updateVenue", "createActivity", "updateActivity",
      "assignUser", "revokeAssignment"
    ].includes(action)) {
      const identity = await fetchBridgeIdentity(config);
      identityState = {
        authenticated: true,
        user: identity.user || identityState.user,
        selection: identity.selection || { hotels: [], venues: [], activities: [] }
      };
    }
    if (
      action === "updateHotel" &&
      body.status === "inactive" &&
      String(body.hotelId || "") === String(config.lastHotelId || "")
    ) {
      config = await saveConfig(sanitizeConfig({
        ...config,
        lastHotelId: "",
        lastVenueId: "",
        lastActivityId: ""
      }, config));
      tenantState = {
        hotel: null,
        venue: null,
        activity: null,
        permissions: {},
        share: null,
        upcomingActivities: []
      };
      requests = [];
    }
    json(response, 200, data);
    broadcastState();
    return;
  }
  if (request.method === "POST" && pathname === "/api/auth/login") {
    const body = await readJson(request);
    const data = await signInBridge(config, {
      username: String(body.username || "").trim(),
      password: String(body.password || ""),
      rememberLogin: body.rememberLogin !== false,
      deviceName: body.deviceName || `Guest Star Bridge on ${process.env.HOSTNAME || "Mac"}`
    });
    config = await saveConfig(sanitizeConfig({
      ...config,
      authToken: data.authToken,
      deviceToken: data.deviceToken,
      deviceId: data.deviceId,
      lastUsername: String(body.username || "").trim(),
      rememberLogin: body.rememberLogin !== false
    }, config), { storeSecrets: true });
    identityState = {
      authenticated: true,
      user: data.user || null,
      selection: data.selection || { hotels: [], venues: [], activities: [] }
    };
    sheetError = "";
    broadcastState();
    json(response, 200, {
      ok: true,
      user: identityState.user,
      selection: identityState.selection,
      mustChangePassword: data.user?.mustChangePassword === true
    });
    return;
  }
  if (request.method === "GET" && pathname === "/api/auth/google-config") {
    const data = await fetchGoogleLoginConfig(config);
    json(response, 200, {
      ok: true,
      googleClientId: String(data.googleClientId || "")
    });
    return;
  }
  if (request.method === "POST" && pathname === "/api/auth/google") {
    const expectedOrigin = `http://${String(request.headers.host || "")}`;
    const requestOrigin = String(request.headers.origin || "");
    if (requestOrigin && requestOrigin !== expectedOrigin) {
      json(response, 403, { ok: false, code: "INVALID_ORIGIN" });
      return;
    }
    const body = await readJson(request);
    const data = await signInBridgeWithGoogle(config, String(body.credential || ""), {
      rememberLogin: body.rememberLogin !== false,
      deviceName: body.deviceName || `Guest Star Bridge on ${process.env.HOSTNAME || "Mac"}`
    });
    config = await saveConfig(sanitizeConfig({
      ...config,
      authToken: data.authToken,
      deviceToken: data.deviceToken,
      deviceId: data.deviceId,
      lastUsername: String(data.user?.email || data.user?.username || ""),
      rememberLogin: body.rememberLogin !== false
    }, config), { storeSecrets: true });
    identityState = {
      authenticated: true,
      user: data.user || null,
      selection: data.selection || { hotels: [], venues: [], activities: [] }
    };
    sheetError = "";
    broadcastState();
    json(response, 200, {
      ok: true,
      user: identityState.user,
      selection: identityState.selection,
      mustChangePassword: false
    });
    return;
  }
  if (request.method === "POST" && pathname === "/api/auth/logout") {
    const previousDeviceId = config.deviceId;
    try {
      if (hasV4Session(config)) await signOutBridge(config);
    } finally {
      await clearBridgeSecrets(previousDeviceId);
      config = await saveConfig(sanitizeConfig({
        ...config,
        authToken: "",
        deviceToken: "",
        lastHotelId: "",
        lastVenueId: "",
        lastActivityId: ""
      }, config));
      identityState = {
        authenticated: false,
        user: null,
        selection: { hotels: [], venues: [], activities: [] }
      };
      tenantState = {
        hotel: null,
        venue: null,
        activity: null,
        permissions: {},
        share: null,
        upcomingActivities: []
      };
      requests = [];
      clearTransientCaches();
      broadcastState();
    }
    json(response, 200, { ok: true });
    return;
  }
  if (request.method === "POST" && pathname === "/api/auth/change-password") {
    const body = await readJson(request);
    const data = await v4AppsScriptAction(config, "changePassword", {
      currentPassword: String(body.currentPassword || ""),
      newPassword: String(body.newPassword || "")
    });
    if (identityState.user) identityState.user.mustChangePassword = false;
    json(response, 200, data);
    return;
  }
  if (request.method === "GET" && pathname === "/api/auth/me") {
    if (!hasV4Session(config)) {
      json(response, 200, { ok: true, authenticated: false });
      return;
    }
    const data = await fetchBridgeIdentity(config);
    identityState = {
      authenticated: true,
      user: data.user || null,
      selection: data.selection || { hotels: [], venues: [], activities: [] }
    };
    json(response, 200, { ok: true, authenticated: true, ...identityState });
    return;
  }
  if (request.method === "POST" && pathname === "/api/auth/selection") {
    const body = await readJson(request);
    const selection = {
      hotelId: String(body.hotelId || ""),
      venueId: String(body.venueId || ""),
      activityId: String(body.activityId || "")
    };
    const data = await selectBridgeActivity(config, selection);
    config = await saveConfig(sanitizeConfig({
      ...config,
      lastHotelId: selection.hotelId,
      lastVenueId: selection.venueId,
      lastActivityId: selection.activityId,
      rememberSelection: body.rememberSelection !== false
    }, config));
    applyActivityState(data);
    requests = bridgeRequests(data);
    clearTransientCaches();
    sheetError = "";
    json(response, 200, stateView());
    broadcastState();
    void syncNow().catch((error) => {
      sheetError = errorMessage(error);
      broadcastState();
    });
    return;
  }
  if (request.method === "POST" && pathname === "/api/config/language") {
    const body = await readJson(request);
    config = await saveConfig(sanitizeConfig({
      ...config,
      uiLanguage: body.uiLanguage,
      superhostLanguage: body.uiLanguage
    }, config));
    json(response, 200, { ok: true, uiLanguage: config.uiLanguage });
    broadcastState();
    return;
  }
  if (request.method === "POST" && pathname === "/api/config") {
    const body = await readJson(request);
    let baseConfig = config;
    if (body.clearHostPin) baseConfig = { ...baseConfig, hostPin: "" };
    if (body.clearVdjPassword) {
      baseConfig = {
        ...baseConfig,
        virtualDJ: { ...baseConfig.virtualDJ, password: "" }
      };
    }
    const nextConfig = sanitizeConfig(body, baseConfig);
    if (body.sheetConfig && typeof body.sheetConfig === "object") {
      const data = await updateBridgeConfig(nextConfig, body.sheetConfig);
      if (data?.state) applyActivityState(data);
    }
    config = await saveConfig(nextConfig);
    startLibraryWatchers();
    await scanNow();
    await syncNow();
    json(response, 200, { ok: true, config: publicConfig(config) });
    return;
  }
  if (request.method === "POST" && pathname === "/api/activity/settings") {
    const body = await readJson(request);
    const data = await v4AppsScriptAction(config, "updateActivitySettings", {
      hotelId: config.lastHotelId,
      venueId: config.lastVenueId,
      activityId: config.lastActivityId,
      source: "bridge",
      scheduledStartAt: body.scheduledStartAt,
      defaultDurationSeconds: body.defaultDurationSeconds,
      defaultTransitionSeconds: body.defaultTransitionSeconds,
      acceptEarlyRequests: body.acceptEarlyRequests,
      showCountdown: body.showCountdown,
      autoStartEnabled: body.autoStartEnabled,
      showPublicStatus: body.showPublicStatus,
      allowedLanguages: body.allowedLanguages
    });
    applyActivityState(data);
    requests = bridgeRequests(data);
    json(response, 200, stateView());
    return;
  }
  if (request.method === "POST" && pathname === "/api/library/choose-folder") {
    json(response, 200, { ok: true, folder: await chooseFolder() });
    return;
  }
  if (request.method === "POST" && pathname === "/api/library/scan") {
    await scanNow();
    json(response, 200, stateView());
    return;
  }
  if (request.method === "POST" && pathname === "/api/requests/sync") {
    await syncNow();
    await reconcileVirtualDjQueue(true);
    json(response, 200, stateView());
    return;
  }
  const activityMatch = pathname.match(
    /^\/api\/activity\/(start|open|close|reset|finish|start-new|archive)$/
  );
  if (request.method === "POST" && activityMatch) {
    const action = activityMatch[1];
    const context = {
      hotelId: config.lastHotelId,
      venueId: config.lastVenueId,
      activityId: config.lastActivityId,
      source: "bridge"
    };
    const data = action === "finish"
      ? await v4AppsScriptAction(config, "finishActivityV4", context)
      : action === "start-new"
        ? await v4AppsScriptAction(config, "startNewActivityV4", context)
        : action === "archive"
          ? await v4AppsScriptAction(config, "archiveClearQueue", context)
          : await controlActivity(config, action);
    applyActivityState(data);
    if (["reset", "archive", "start-new"].includes(action)) {
      await reconcileDeletedRequests([], activityState, {
        removeFromVirtualDJ: true
      });
      await resetLocalActivity(activityState.activityId);
    } else if (Array.isArray(data.requests)) {
      requests = bridgeRequests(data);
      refreshLocalAvailability();
    }
    await syncNow();
    await reconcileVirtualDjQueue(true);
    json(response, 200, stateView());
    return;
  }
  if (request.method === "POST" && pathname === "/api/virtualdj/test") {
    const body = await readJson(request);
    const testConfig = sanitizeConfig(body, config);
    const clock = await queryVdj(testConfig.virtualDJ, "get_clock");
    const queueEntries = await listKaraokeEntries(testConfig.virtualDJ);
    vdjError = "";
    broadcastState();
    json(response, 200, {
      ok: true,
      clock,
      queueCount: queueEntries.length
    });
    return;
  }
  if (request.method === "POST" && pathname === "/api/external/open") {
    const body = await readJson(request);
    const openedUrl = await openMacUrl(body.url);
    json(response, 200, { ok: true, url: openedUrl });
    return;
  }
  const queueMatch = pathname.match(/^\/api\/requests\/([^/]+)\/queue$/);
  if (request.method === "POST" && queueMatch) {
    const body = await readJson(request);
    const data = await queueRequest(
      decodeURIComponent(queueMatch[1]),
      body.filePath,
      { requeue: body.requeue === true }
    );
    broadcastState();
    json(response, 200, data);
    return;
  }
  const removeMatch = pathname.match(/^\/api\/requests\/([^/]+)\/remove$/);
  if (request.method === "POST" && removeMatch) {
    const data = await removeQueuedRequest(decodeURIComponent(removeMatch[1]));
    broadcastState();
    json(response, 200, data);
    return;
  }
  const dismissRequeueMatch =
    pathname.match(/^\/api\/requests\/([^/]+)\/dismiss-requeue$/);
  if (request.method === "POST" && dismissRequeueMatch) {
    const data = await dismissRequeue(
      decodeURIComponent(dismissRequeueMatch[1])
    );
    broadcastState();
    json(response, 200, data);
    return;
  }
  const outcomeMatch =
    pathname.match(/^\/api\/requests\/([^/]+)\/outcome$/);
  if (request.method === "POST" && outcomeMatch) {
    const body = await readJson(request);
    const data = await setRequestOutcome(
      decodeURIComponent(outcomeMatch[1]),
      String(body.outcome || "")
    );
    broadcastState();
    json(response, 200, data);
    return;
  }
  const undoOutcomeMatch =
    pathname.match(/^\/api\/requests\/([^/]+)\/undo-outcome$/);
  if (request.method === "POST" && undoOutcomeMatch) {
    const body = await readJson(request);
    const data = await undoRequestOutcome(
      decodeURIComponent(undoOutcomeMatch[1]),
      String(body.placement || "")
    );
    broadcastState();
    json(response, 200, data);
    return;
  }
  if (request.method === "POST" && pathname === "/api/suggestions/queue") {
    const body = await readJson(request);
    const data = await queueHitSuggestion(body);
    broadcastState();
    json(response, 200, data);
    return;
  }
  if (request.method === "POST" && pathname === "/api/suggestions/youtube") {
    const body = await readJson(request);
    const items = await findHitSuggestionYoutube(body);
    broadcastState();
    json(response, 200, { ok: true, items });
    return;
  }
  const youtubeCopyMatch =
    pathname.match(/^\/api\/requests\/([^/]+)\/youtube\/copy$/);
  if (request.method === "POST" && youtubeCopyMatch) {
    const id = decodeURIComponent(youtubeCopyMatch[1]);
    const body = await readJson(request);
    const items = youtubeCache.get(id) || await findYoutube(id);
    const selected = items.find((item) => item.url === String(body.url || ""));
    if (!selected) throw new Error("Elige uno de los enlaces mostrados por el Bridge.");
    try {
      await copyMacClipboard(selected.url);
      const item = requests.find((entry) => entry.id === id);
      if (item) {
        const updated = await updateBridgeRequest(
          config,
          id,
          item.status,
          basename(queuedEntries.get(id)?.filePath || item.fileName || ""),
          {
            durationSeconds:
              Number(selected.durationSeconds) || item.durationSeconds,
            sourceUrl: selected.url
          }
        );
        if (updated?.state) applyActivityState(updated);
        item.sourceUrl = selected.url;
        if (Number(selected.durationSeconds) > 0) {
          item.durationSeconds = Number(selected.durationSeconds);
        }
      }
      clipboardHandledIds.add(id);
      clipboardState = {
        requestId: id,
        url: selected.url,
        resultType: selected.resultType || "",
        notice: selected.notice || "",
        copiedAt: new Date().toISOString(),
        error: ""
      };
    } catch (error) {
      clipboardState = {
        requestId: id,
        url: selected.url,
        resultType: selected.resultType || "",
        notice: selected.notice || "",
        copiedAt: "",
        error: errorMessage(error)
      };
      throw error;
    }
    broadcastState();
    json(response, 200, {
      ok: true,
      url: selected.url,
      sheetUpdated: true
    });
    return;
  }
  const youtubeMatch = pathname.match(/^\/api\/requests\/([^/]+)\/youtube$/);
  if (request.method === "POST" && youtubeMatch) {
    const id = decodeURIComponent(youtubeMatch[1]);
    const items = await findYoutube(id);
    const best = items[0];
    clipboardHandledIds.add(id);
    if (best) {
      clipboardState = {
        requestId: id,
        url: best.url,
        resultType: best.resultType || "",
        notice: best.notice || "",
        copiedAt: "",
        error: ""
      };
    }
    broadcastState();
    json(response, 200, {
      ok: true,
      items,
      clipboardCopied: false
    });
    return;
  }
  if (request.method === "POST" && pathname === "/api/apps-script/test") {
    const body = await readJson(request);
    const testConfig = sanitizeConfig(body, config);
    const data = await fetchBridgeQueue(testConfig);
    if (data.codeVersion !== BRIDGE_PROTOCOL_VERSION) {
      throw new Error(
        `Guest Star is connected, but its service version is ${data.codeVersion || "older"}. Contact the Superhost to install version ${BRIDGE_PROTOCOL_VERSION}.`
      );
    }
    json(response, 200, {
      ok: true,
      requestCount: data.requests.length,
      codeVersion: data.codeVersion
    });
    return;
  }
  json(response, 404, { ok: false, error: "Action not found." });
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname.startsWith("/api/")) await api(request, response, url);
    else await serveStatic(url.pathname, response);
  } catch (error) {
    json(response, 400, { ok: false, error: errorMessage(error) });
  }
});

async function restoreBridgeIdentity() {
  if (!hasV4Session(config)) return;
  try {
    const data = await fetchBridgeIdentity(config);
    identityState = {
      authenticated: true,
      user: data.user || null,
      selection: data.selection || { hotels: [], venues: [], activities: [] }
    };
  } catch (error) {
    identityState.authenticated = false;
    sheetError = errorMessage(error);
  }
}

let cloudLoopRunning = false;
let lastHeartbeatSentAt = 0;

async function executeCloudCommand(command) {
  const payload = command?.payload || {};
  if (command.commandType === "synchronize") {
    await syncNow();
    await reconcileVirtualDjQueue(true);
    return { synchronized: true };
  }
  if (command.commandType === "addRequest") {
    return queueRequest(String(payload.requestId || ""), payload.filePath || "", {
      requeue: payload.requeue === true
    });
  }
  if (command.commandType === "removeRequest") {
    return removeQueuedRequest(String(payload.requestId || ""));
  }
  if (command.commandType === "markSang") {
    return setRequestOutcome(String(payload.requestId || ""), "completed");
  }
  if (command.commandType === "markSkipped") {
    return setRequestOutcome(String(payload.requestId || ""), "skipped");
  }
  if (command.commandType === "undo") {
    return undoRequestOutcome(
      String(payload.requestId || ""),
      String(payload.placement || "pending")
    );
  }
  if (command.commandType === "moveRequest") {
    return queueRequest(String(payload.requestId || ""), payload.filePath || "", {
      requeue: true
    });
  }
  throw new Error("Unsupported Bridge command.");
}

async function bridgeCloudLoop() {
  if (cloudLoopRunning || !hasV4Session(config) || !config.lastActivityId) return;
  cloudLoopRunning = true;
  try {
    if (Date.now() - lastHeartbeatSentAt >= 5000) {
      await sendBridgeHeartbeat(config, {
        virtualDJConnected: !vdjError && Boolean(lastVdjQueueAt)
      });
      lastHeartbeatSentAt = Date.now();
    }
    const data = await pollBridgeCommands(config);
    for (const command of data.commands || []) {
      try {
        const result = await executeCloudCommand(command);
        await completeBridgeCommand(config, command.commandId, {
          ok: true,
          result
        });
      } catch (error) {
        await completeBridgeCommand(config, command.commandId, {
          ok: false,
          errorMessage: errorMessage(error)
        });
      }
    }
  } catch (error) {
    sheetError = errorMessage(error);
  } finally {
    cloudLoopRunning = false;
    broadcastState();
  }
}

server.listen(config.bridgePort, "127.0.0.1", () => {
  console.log(`Guest Star Bridge listo: http://127.0.0.1:${config.bridgePort}`);
});

await restoreBridgeIdentity();
startLibraryWatchers();
await scanNow();
await syncNow();

async function requestLoop() {
  await syncNow();
  setTimeout(requestLoop, config.requestIntervalSeconds * 1000).unref();
}

async function scanLoop() {
  await scanNow();
  setTimeout(scanLoop, config.scanIntervalSeconds * 1000).unref();
}

setTimeout(requestLoop, config.requestIntervalSeconds * 1000).unref();
setTimeout(scanLoop, config.scanIntervalSeconds * 1000).unref();
setInterval(() => {
  void bridgeCloudLoop();
}, 2000).unref();
setInterval(() => {
  for (const response of [...eventClients]) {
    try {
      response.write(": keepalive\n\n");
    } catch {
      eventClients.delete(response);
    }
  }
}, 20000).unref();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    closeLibraryWatchers();
    for (const response of eventClients) response.end();
    eventClients.clear();
    server.close(() => process.exit(0));
  });
}
