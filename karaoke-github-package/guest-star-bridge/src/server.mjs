import { createReadStream, watch } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  appsScriptAction,
  controlActivity,
  fetchBridgeQueue,
  searchKaraokeYouTube,
  updateBridgeConfig,
  updateBridgeRequest
} from "./apps-script.mjs";
import {
  buildActivitySummary,
  requestOutcome,
  safeTransitionSeconds
} from "./activity-summary.mjs";
import { loadConfig, publicConfig, ROOT, sanitizeConfig, saveConfig } from "./config.mjs";
import { selectHitSuggestions } from "./hit-suggestions.mjs";
import { reconcileLocalAvailability } from "./local-availability.mjs";
import { findMatches, normalizeText, scanLibrary } from "./matcher.mjs";
import {
  queueMetadataMatches,
  reconcileTrackedQueue
} from "./queue-reconcile.mjs";
import { loadQueueState, saveQueueState } from "./queue-state.mjs";
import { orderRequestViews } from "./request-order.mjs";
import {
  buildKaraokeScript,
  executeVdj,
  insertKaraokeEntry,
  listKaraokeEntries,
  normalizeVdjPath,
  normalizeVdjSinger,
  queryVdj,
  removeKaraokeEntry
} from "./virtualdj.mjs";
import {
  copyMacClipboard,
  openMacUrl,
  selectYoutubeOptions
} from "./youtube.mjs";

const execFileAsync = promisify(execFile);
const PUBLIC_DIR = resolve(ROOT, "public");
const BRIDGE_VERSION = "3.0.7";
const JSON_LIMIT = 256 * 1024;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8"
};

let config = await loadConfig();
const storedQueueState = await loadQueueState();
let libraryFiles = [];
let requests = [];
let scanning = false;
let syncing = false;
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
const youtubeCache = new Map();
const youtubeSearchAt = new Map();
const youtubeSearches = new Map();
const hitYoutubeCache = new Map();
const clipboardHandledIds = new Set();
const reportedStatuses = new Map();
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

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > JSON_LIMIT) throw new Error("La solicitud es demasiado grande.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("El contenido recibido no es JSON válido.");
  }
}

function requestView(item) {
  const matches = findMatches(libraryFiles, item.song, item.artist);
  const top = matches[0];
  const queuedEntry = queuedEntries.get(item.id);
  const verifiedQueuePath =
    vdjRequestFilePaths.get(item.id) || queuedEntry?.filePath || "";
  const localAvailable = Boolean(
    top?.exact ||
    (verifiedQueuePath &&
      vdjAvailablePaths.has(normalizeVdjPath(verifiedQueuePath)))
  );
  const isQueued =
    !suppressedQueueIds.has(item.id) && queuedIds.has(item.id);
  const removedExternally =
    !suppressedQueueIds.has(item.id) && removedExternallyIds.has(item.id);
  const queueUnverified =
    !suppressedQueueIds.has(item.id) &&
    !removedExternally &&
    !vdjQueueHasSnapshot &&
    (queuedEntries.has(item.id) || sheetMarksVirtualDj(item));
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
    localState: queueUnverified
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
    activityRunning:
      source.activityRunning === undefined
        ? Boolean(activityStartedAt)
        : source.activityRunning !== false && Boolean(activityStartedAt),
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
  queuedIds.clear();
  youtubeCache.clear();
  youtubeSearchAt.clear();
  clipboardHandledIds.clear();
  reportedStatuses.clear();
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
}

function bridgeRequests(data = {}) {
  return (Array.isArray(data.requests) ? data.requests : [])
    .map((item) => ({
      id: String(item.id || ""),
      sheetRow: Math.max(0, Math.floor(numberOr(item.sheetRow, 0))),
      timestamp: item.timestamp || "",
      singer: String(item.singer || item.name || "").trim(),
      song: String(item.song || "").trim(),
      artist: String(item.artist || "").trim(),
      comment: String(item.comment || "").trim(),
      language: String(item.language || "").trim(),
      sourceUrl: String(item.sourceUrl || "").trim(),
      status: String(item.status || "Pendiente"),
      fileName: String(item.fileName || "").trim(),
      durationSeconds: Math.max(0, numberOr(item.durationSeconds, 240)),
      transitionSeconds: safeTransitionSeconds(
        item.transitionSeconds,
        activityState.transitionSeconds
      ),
      updatedAt: String(item.updatedAt || "")
    }))
    .filter((item) => item.id && item.singer && item.song);
}

function queuedEntryFromRequest(item, preferredPath = "") {
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
    const exact = findMatches(libraryFiles, item.song, item.artist, 1)[0];
    if (exact?.exact) filePath = exact.filePath;
  }
  if (!filePath) return null;
  return {
    id: item.id,
    filePath,
    singer: item.singer,
    song: item.song,
    artist: item.artist
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
  vdjQueuePositions.clear();
  clearTransientCaches();
  await persistQueuedEntries(activityId);
}

async function reconcileDeletedRequests(nextRequests, nextActivity) {
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
    try {
      const result = await removeKaraokeEntry(config.virtualDJ, entry);
      if (result.reason === "ambiguous") {
        throw new Error(
          `VirtualDJ tiene más de una copia de “${entry.song}” para ${entry.singer}; no se borró ninguna.`
        );
      }
      queuedIds.delete(id);
      queuedEntries.delete(id);
      youtubeCache.delete(id);
      youtubeSearchAt.delete(id);
      clipboardHandledIds.delete(id);
      reportedStatuses.delete(id);
      removedExternallyIds.delete(id);
      vdjQueuePositions.delete(id);
      vdjError = "";
      changed = true;
    } catch (error) {
      vdjError =
        `La solicitud se borró del Bridge, pero no pudo retirarse de VirtualDJ: ${errorMessage(error)}`;
    }
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
            `VirtualDJ tiene copias ambiguas de “${item.song}”; retírala manualmente de la cola.`;
        }
      } catch (error) {
        vdjError =
          `El estado se guardó, pero no se pudo retirar “${item.song}” de VirtualDJ: ${errorMessage(error)}`;
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
  const targetSinger = normalizeText(normalizeVdjSinger(item.singer));
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
      const actualEntries = await listKaraokeEntries(config.virtualDJ);
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
      const tracked = [...queuedEntries.values()].filter(
        (entry) => {
          const item = requests.find((request) => request.id === entry.id);
          return (
            activeIds.has(entry.id) &&
            !suppressedQueueIds.has(entry.id) &&
            !requestOutcome(item?.status)
          );
        }
      );
      const reconciliation = reconcileTrackedQueue(tracked, actualEntries);
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
          queuedIds.add(entry.id);
          nextPositions.set(entry.id, actual.index);
          if (actual.filePath) nextRequestFilePaths.set(entry.id, actual.filePath);
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
        queuedIds.delete(entry.id);
        if (
          !removedExternallyIds.has(entry.id) ||
          item?.status !== "Fuera de VirtualDJ"
        ) {
          newlyMissing.push(entry.id);
        }
        removedExternallyIds.add(entry.id);
      }

      for (const item of requests) {
        if (
          requestOutcome(item.status) ||
          !sheetMarksVirtualDj(item) ||
          queuedEntries.has(item.id) ||
          suppressedQueueIds.has(item.id)
        ) {
          continue;
        }
        const actual = actualQueueEntryFromRequest(
          item,
          actualEntries,
          reconciliation.claimedIndices
        );
        if (!actual) {
          queuedIds.delete(item.id);
          if (
            !removedExternallyIds.has(item.id) ||
            item.status !== "Fuera de VirtualDJ"
          ) {
            newlyMissing.push(item.id);
          }
          removedExternallyIds.add(item.id);
          continue;
        }
        reconciliation.claimedIndices.add(actual.index);
        const adoptedEntry = queuedEntryFromRequest(item, actual.filePath);
        if (adoptedEntry) {
          queuedEntries.set(item.id, adoptedEntry);
          adopted = true;
        }
        queuedIds.add(item.id);
        removedExternallyIds.delete(item.id);
        nextPositions.set(item.id, actual.index);
        if (actual.filePath) nextRequestFilePaths.set(item.id, actual.filePath);
        if (
          Number(actual.durationSeconds) > 0 &&
          Math.abs(
            Number(item.durationSeconds || 0) -
            Number(actual.durationSeconds)
          ) >= 1
        ) {
          item.durationSeconds = Number(actual.durationSeconds);
          durationUpdates.add(item.id);
        }
      }

      vdjQueuePositions = nextPositions;
      vdjRequestFilePaths = nextRequestFilePaths;
      vdjQueueHasSnapshot = true;
      vdjQueueCount = actualEntries.length;
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
            { durationSeconds: item.durationSeconds }
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
            { durationSeconds: item.durationSeconds }
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
            { durationSeconds: item.durationSeconds }
          );
        } catch {
          // La duración exacta local permanece visible y se reintentará.
        }
      }
    } catch (error) {
      vdjError = `No se pudo comprobar la cola Karaoke: ${errorMessage(error)}`;
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
        position: entry.index + 1,
        singer: entry.singer || "Sin cantante",
        song:
          entry.song || basename(entry.filePath || "") || "Pista sin título",
        artist: entry.artist || "",
        durationSeconds: Math.max(0, Number(entry.durationSeconds) || 0),
        localAvailable: entry.localAvailable === true
      }))
    },
    clipboard: clipboardState,
    hitSuggestions,
    singerCandidates: [
      ...new Set(
        requests
          .filter((item) => requestOutcome(item.status) !== "skipped")
          .map((item) => item.singer)
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
      findMatches(libraryFiles, item.song, item.artist, 1)[0]?.exact ||
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
  if (syncing || !config.appsScriptUrl || !config.hostPin) return;
  syncing = true;
  sheetError = "";
  broadcastState();
  try {
    const data = await fetchBridgeQueue(config);
    const nextActivity = normalizedActivity(data);
    const nextRequests = bridgeRequests(data);
    const activityChanged =
      queueActivityId &&
      nextActivity.activityId &&
      queueActivityId !== nextActivity.activityId;
    if (activityChanged) suppressedQueueIds.clear();
    await reconcileDeletedRequests(nextRequests, nextActivity);
    if (activityChanged) clearTransientCaches();
    requests = nextRequests;
    refreshLocalAvailability();
    applyActivityState(nextActivity);
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
  } catch (error) {
    sheetError = errorMessage(error);
  } finally {
    syncing = false;
  }
  await reconcileVirtualDjQueue();
  await reportLocalStates();
  await prepareMissingYoutube();
  await prepareHitSuggestionYoutube();
  await autoQueueExactMatches();
  broadcastState();
}

async function reportLocalStates() {
  if (!config.appsScriptUrl || !config.hostPin) return;
  for (const item of requests) {
    if (requestOutcome(item.status)) continue;
    if (queuedIds.has(item.id) || removedExternallyIds.has(item.id)) continue;
    if (
      !vdjQueueHasSnapshot &&
      (queuedEntries.has(item.id) || sheetMarksVirtualDj(item))
    ) {
      continue;
    }
    const top = findMatches(libraryFiles, item.song, item.artist, 1)[0];
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
  if (!info.isFile()) throw new Error("La pista seleccionada no es un archivo.");
  for (const folder of config.libraryFolders) {
    try {
      const root = await realpath(folder);
      if (target === root || target.startsWith(`${root}${sep}`)) return target;
    } catch {
      // Ignore folders that disappeared after the last scan.
    }
  }
  throw new Error("La pista no pertenece a una carpeta de karaoke configurada.");
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
  throw new Error("La canción todavía no aparece en la biblioteca local.");
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
  if (!item) throw new Error("La solicitud ya no está disponible.");
  if (requestOutcome(item.status)) {
    throw new Error("Esta solicitud ya fue marcada como cantada o saltada.");
  }
  if (vdjQueueCheckPromise) await vdjQueueCheckPromise;
  const wasQueued = !suppressedQueueIds.has(id) && queuedIds.has(id);
  const wasRemovedExternally = removedExternallyIds.has(id);
  const requeue = Boolean(options.requeue) && wasQueued;
  if (wasQueued && !requeue) return { ok: true, alreadyQueued: true };
  if (queueLocks.has(id)) throw new Error("Esta solicitud ya se está procesando.");
  queueLocks.add(id);
  try {
    const exact = findMatches(libraryFiles, item.song, item.artist, 1)[0];
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
            "VirtualDJ tiene más de una copia idéntica. Retira la que deseas directamente en VirtualDJ antes de reenviarla."
          );
        }
        previousRemoved = removal.removed === true;
        if (previousRemoved) removeQueuePosition(id);
      }
    }
    const script = buildKaraokeScript(filePath, item.singer);
    const result = await executeVdj(config.virtualDJ, script);
    suppressedQueueIds.delete(id);
    removedExternallyIds.delete(id);
    queuedIds.add(id);
    appendQueuePosition(id);
    const queuedEntry = queuedEntryFromRequest(item, filePath);
    if (queuedEntry) {
      queuedEntries.set(id, queuedEntry);
      await persistQueuedEntries();
    }
    vdjError = "";
    item.status = wasRemovedExternally
      ? "Reagregada a VirtualDJ"
      : requeue
        ? "Reenviada a VirtualDJ"
        : "Agregada a VirtualDJ";
    let warning = "";
    try {
      await updateBridgeRequest(config, id, item.status, basename(filePath));
    } catch (error) {
      warning = `La canción entró a VirtualDJ, pero la hoja no se actualizó: ${errorMessage(error)}`;
    }
    return {
      ok: true,
      result,
      script,
      requeued: requeue,
      restored: wasRemovedExternally,
      previousRemoved,
      warning
    };
  } catch (error) {
    vdjError = errorMessage(error);
    throw error;
  } finally {
    queueLocks.delete(id);
  }
}

async function removeQueuedRequest(id) {
  const item = requests.find((entry) => entry.id === id);
  if (!item) throw new Error("La solicitud ya no está disponible.");
  if (vdjQueueCheckPromise) await vdjQueueCheckPromise;
  if (queueLocks.has(id)) throw new Error("Esta solicitud ya se está procesando.");
  queueLocks.add(id);
  try {
    const entry = queuedEntries.get(id) || queuedEntryFromRequest(item);
    if (!entry) {
      throw new Error("No se encontró el archivo asociado a esta solicitud.");
    }
    const result = await removeKaraokeEntry(config.virtualDJ, entry);
    if (result.reason === "ambiguous") {
      throw new Error(
        "VirtualDJ tiene más de una copia idéntica y no se retiró ninguna por seguridad."
      );
    }

    queuedIds.delete(id);
    removedExternallyIds.delete(id);
    removeQueuePosition(id);
    queuedEntries.delete(id);
    suppressedQueueIds.add(id);
    await persistQueuedEntries();
    vdjError = "";
    item.status = "Retirada de rotación";
    let warning =
      result.reason === "not-found"
        ? "La canción ya no estaba en VirtualDJ; el estado local fue actualizado."
        : "";
    try {
      await updateBridgeRequest(config, id, item.status, "");
    } catch (error) {
      warning =
        warning ||
        `La canción se retiró de VirtualDJ, pero la hoja no se actualizó: ${errorMessage(error)}`;
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
  if (!item) throw new Error("La solicitud ya no está disponible.");
  queuedIds.delete(id);
  removedExternallyIds.delete(id);
  removeQueuePosition(id);
  queuedEntries.delete(id);
  suppressedQueueIds.add(id);
  await persistQueuedEntries();
  item.status = "Fuera de VirtualDJ";
  let warning = "";
  try {
    await updateBridgeRequest(config, id, item.status, "");
  } catch (error) {
    warning = `La decisión quedó guardada localmente, pero la hoja no se actualizó: ${errorMessage(error)}`;
  }
  return { ok: true, warning };
}

async function setRequestOutcome(id, outcome) {
  const item = requests.find((entry) => entry.id === id);
  if (!item) throw new Error("La solicitud ya no está disponible.");
  if (!["completed", "skipped"].includes(outcome)) {
    throw new Error("Resultado de canción no permitido.");
  }
  if (queueLocks.has(id)) throw new Error("Esta solicitud ya se está procesando.");
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
            "VirtualDJ tiene más de una copia idéntica. Retira la correcta manualmente antes de marcar el resultado."
          );
        }
        if (Number.isInteger(result.index)) originalPosition = result.index;
        removedFromVirtualDJ =
          result.removed === true || result.reason === "not-found";
      } catch (error) {
        throw new Error(
          `No se pudo actualizar la cola real de VirtualDJ: ${errorMessage(error)}`
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
        `El resultado quedó visible en el Bridge, pero la hoja no se actualizó: ${errorMessage(error)}`;
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
  if (!item) throw new Error("La solicitud ya no está disponible.");
  if (!requestOutcome(item.status)) {
    throw new Error("Esta solicitud ya no está marcada como cantada o saltada.");
  }
  if (!["original", "end", "pending"].includes(placement)) {
    throw new Error("Elige cómo deseas restaurar la canción.");
  }
  if (queueLocks.has(id)) throw new Error("Esta solicitud ya se está procesando.");
  queueLocks.add(id);

  try {
    const recovery = outcomeRecoveries.get(id);
    const entry =
      recovery?.entry ||
      queuedEntryFromRequest(item) ||
      queuedEntryFromRequest(
        item,
        findMatches(libraryFiles, item.song, item.artist, 1)[0]?.filePath || ""
      );
    if (placement === "original" && !Number.isInteger(recovery?.originalPosition)) {
      throw new Error(
        "No se pudo recuperar el turno anterior. Puedes agregarla al final."
      );
    }
    if (placement !== "pending" && !entry) {
      throw new Error(
        "El archivo ya no está disponible localmente. Deshaz el estado sin agregarla o vuelve a descargar la pista."
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
  if (!suggestion) throw new Error("La sugerencia ya no está disponible.");
  const key = hitSuggestionKey(suggestion);
  if (body.force === true) hitYoutubeCache.delete(key);
  if (hitYoutubeCache.has(key)) return hitYoutubeCache.get(key);
  const data = await searchKaraokeYouTube(
    config,
    suggestion.song,
    suggestion.artist,
    suggestion.language
  );
  const items = selectYoutubeOptions(
    Array.isArray(data.items) ? data.items : [],
    1
  );
  hitYoutubeCache.set(key, items);
  return items;
}

async function prepareHitSuggestionYoutube() {
  if (!config.appsScriptUrl || !config.hostPin || vdjQueueCount > 0) return;
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
  const suggestions = selectHitSuggestions(
    requests,
    libraryFiles,
    activityState.activityId,
    6
  );
  const song = String(body.song || "").trim();
  const artist = String(body.artist || "").trim();
  const suggestion = suggestions.find(
    (item) =>
      normalizeText(item.song) === normalizeText(song) &&
      normalizeText(item.artist) === normalizeText(artist)
  );
  if (!suggestion) throw new Error("La sugerencia ya no está disponible.");
  if (!suggestion.localAvailable || !suggestion.filePath) {
    throw new Error("Ese tema sugerido todavía no está en la biblioteca local.");
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
      throw new Error("Todavía no hay participantes registrados para elegir al azar.");
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
    const top = findMatches(libraryFiles, item.song, item.artist, 1)[0];
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
  if (!item) throw new Error("La solicitud ya no está disponible.");

  const operation = (async () => {
    let results = [];
    try {
      const data = await searchKaraokeYouTube(
        config,
        item.song,
        item.artist,
        item.language
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
  if (!config.appsScriptUrl || !config.hostPin) return;
  const missing = requests.filter(
    (item) =>
      !requestOutcome(item.status) &&
      !findMatches(libraryFiles, item.song, item.artist, 1)[0]?.exact &&
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
      notice: "No se encontró todavía un video con letra suficientemente confiable.",
      copiedAt: "",
      error: "No se encontró un enlace recomendado."
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
    throw new Error("El selector automático de carpetas está disponible al ejecutar el puente en Mac.");
  }
  const script =
    'POSIX path of (choose folder with prompt "Elige tu carpeta de canciones de karaoke")';
  const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 120000 });
  return stdout.trim().replace(/\/$/, "");
}

async function serveStatic(pathname, response) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
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
  const activityMatch = pathname.match(/^\/api\/activity\/(start|open|close|reset)$/);
  if (request.method === "POST" && activityMatch) {
    const action = activityMatch[1];
    const data = await controlActivity(config, action);
    applyActivityState(data);
    if (action === "reset") {
      await reconcileDeletedRequests([], activityState);
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
    if (data.codeVersion !== BRIDGE_VERSION) {
      throw new Error(
        `La hoja responde, pero usa Code.gs ${data.codeVersion || "anterior"}. Publica Code.gs ${BRIDGE_VERSION} como una versión nueva.`
      );
    }
    json(response, 200, {
      ok: true,
      requestCount: data.requests.length,
      codeVersion: data.codeVersion
    });
    return;
  }
  json(response, 404, { ok: false, error: "Acción no encontrada." });
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

server.listen(config.bridgePort, "127.0.0.1", () => {
  console.log(`Guest Star Bridge listo: http://127.0.0.1:${config.bridgePort}`);
});

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
