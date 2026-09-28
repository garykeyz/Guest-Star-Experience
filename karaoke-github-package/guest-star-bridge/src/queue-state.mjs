import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ROOT } from "./config.mjs";

const DATA_DIR = resolve(ROOT, "data");
const QUEUE_STATE_PATH = resolve(DATA_DIR, "queue-state.json");

function cleanEntry(value = {}) {
  const entry = {
    id: String(value.id || "").trim(),
    filePath: String(value.filePath || "").trim(),
    singer: String(value.singer || "").trim(),
    song: String(value.song || "").trim(),
    artist: String(value.artist || "").trim(),
    durationSeconds: Math.max(0, Number(value.durationSeconds) || 0),
    virtualDJItemId: String(value.virtualDJItemId || "").trim(),
    fingerprint: String(value.fingerprint || "").trim(),
    manualLink: value.manualLink === true,
    insertedAt: String(value.insertedAt || "").trim(),
    lastSeenAt: String(value.lastSeenAt || "").trim()
  };
  return entry.id && entry.singer &&
    (entry.filePath || entry.virtualDJItemId || entry.song)
    ? entry
    : null;
}

function cleanRecovery(value = {}) {
  const id = String(value.id || "").trim();
  if (!id) return null;
  const position = Number(value.originalPosition);
  return {
    id,
    outcome: String(value.outcome || "").trim(),
    previousStatus: String(value.previousStatus || "Pendiente").trim(),
    originalPosition:
      Number.isInteger(position) && position >= 0 ? position : null,
    markedAt: String(value.markedAt || "").trim(),
    entry: cleanEntry(value.entry || {})
  };
}

function cleanRequestFileLink(value = {}) {
  const id = String(value.id || "").trim();
  const filePath = String(value.filePath || "").trim();
  if (!id || !filePath) return null;
  return {
    id,
    filePath,
    source: value.source === "automatic" ? "automatic" : "manual",
    updatedAt: String(value.updatedAt || "").trim()
  };
}

function cleanPlayerRequest(value = {}) {
  const id = String(value.id || "").trim();
  const filePath = String(value.filePath || "").trim();
  const singer = String(value.singer || "").trim();
  if (!id || !filePath || !singer) return null;
  const outcome = ["completed", "skipped", "removed"].includes(String(value.outcome || ""))
    ? String(value.outcome)
    : "";
  return {
    id,
    filePath,
    singer,
    song: String(value.song || "").trim() || "Pista local",
    artist: String(value.artist || "").trim(),
    durationSeconds: Math.max(0, Number(value.durationSeconds) || 0),
    status: outcome === "completed"
      ? "Ya cantó"
      : outcome === "skipped"
        ? "Saltado"
        : outcome === "removed"
          ? "Retirada del Player"
        : String(value.status || "En fila del Player").trim(),
    outcome,
    insertedAt: String(value.insertedAt || "").trim(),
    markedAt: String(value.markedAt || "").trim()
  };
}

function cleanPlayerOrder(value = []) {
  return Array.isArray(value)
    ? [...new Set(value.map((id) => String(id || "").trim()).filter(Boolean))]
    : [];
}

function cleanPlayerQueueVisibility(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [rawId, visible] of Object.entries(value).slice(0, 1000)) {
    const id = String(rawId || "").trim().slice(0, 160);
    if (id) result[id] = visible !== false;
  }
  return result;
}

function cleanPlayerPlayback(value = {}) {
  const currentTimeSeconds = Number(value.currentTimeSeconds);
  return {
    currentRequestId: String(value.currentRequestId || "").trim(),
    currentTimeSeconds: Number.isFinite(currentTimeSeconds)
      ? Math.max(0, Math.min(12 * 60 * 60, currentTimeSeconds))
      : 0,
    scene: value.scene === "karaoke" ? "karaoke" : "lobby",
    wasPlaying: value.wasPlaying === true,
    updatedAt: String(value.updatedAt || "").trim()
  };
}

function cleanPlayerStemJob(value = {}) {
  const legacyId = String(value.id || "").trim();
  const requestId = String(value.requestId || legacyId.split(":")[0] || "").trim();
  const filePath = String(value.filePath || "").trim();
  const engine = ["spleeter", "demucs"].includes(String(value.engine || "").toLowerCase())
    ? String(value.engine).toLowerCase()
    : "demucs";
  const id = legacyId.includes(":") ? legacyId : `${requestId}:${engine}`;
  if (!requestId || !id || !filePath) return null;
  const status = ["queued", "processing", "ready", "failed", "deferred"].includes(String(value.status || ""))
    ? String(value.status)
    : "queued";
  const intent = ["auto", "spleeter", "demucs"].includes(String(value.intent || "").toLowerCase())
    ? String(value.intent).toLowerCase()
    : engine;
  return {
    id,
    requestId,
    jobId: String(value.jobId || id).trim().slice(0, 160),
    filePath,
    engine,
    intent,
    intentUpdatedAt: String(value.intentUpdatedAt || value.requestedAt || "").trim(),
    required: value.required !== false,
    opportunistic: value.opportunistic === true,
    status: status === "processing" ? "queued" : status,
    progress: Math.max(0, Math.min(100, Number(value.progress) || 0)),
    phase: String(value.phase || "").trim(),
    fingerprint: String(value.fingerprint || "").trim().slice(0, 128),
    cacheKey: String(value.cacheKey || "").trim().slice(0, 128),
    modelVersion: String(value.modelVersion || "").trim().slice(0, 160),
    manifestPath: String(value.manifestPath || "").trim(),
    instrumentalPath: String(value.instrumentalPath || "").trim(),
    vocalsPath: String(value.vocalsPath || "").trim(),
    gsxPath: String(value.gsxPath || "").trim(),
    cacheFormat: value.cacheFormat === "gsx" ? "gsx" : value.cacheFormat === "legacy" ? "legacy" : "",
    error: String(value.error || "").trim(),
    cacheHit: value.cacheHit === true,
    estimatedTurnSeconds: Math.max(0, Number(value.estimatedTurnSeconds) || 0),
    etaSeconds: Math.max(0, Number(value.etaSeconds) || 0),
    resourceState: ["IDLE", "LIVE", "PRESSURE"].includes(String(value.resourceState || "").toUpperCase())
      ? String(value.resourceState).toUpperCase()
      : "IDLE",
    actualThreads: Number.isInteger(Number(value.actualThreads))
      ? Math.max(1, Number(value.actualThreads))
      : null,
    osPriorityApplied: Number.isInteger(Number(value.osPriorityApplied))
      ? Number(value.osPriorityApplied)
      : null,
    requestedAt: String(value.requestedAt || "").trim(),
    startedAt: String(value.startedAt || "").trim(),
    completedAt: String(value.completedAt || "").trim(),
    lastOutputAt: String(value.lastOutputAt || "").trim(),
    updatedAt: String(value.updatedAt || "").trim()
  };
}

function cleanMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  return ["player", "bridge"].includes(mode) ? mode : "";
}

function cleanActiveActivityState(value = {}, legacy = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const activityId = String(source.activityId || legacy.activityId || "").trim();
  const activityStartedAt = String(source.activityStartedAt || legacy.activityStartedAt || "").trim();
  const playbackMode = cleanMode(source.playbackMode || legacy.operatingMode);
  if (!activityId || !Number.isFinite(Date.parse(activityStartedAt)) || !playbackMode) {
    return { activityId: "", activityStartedAt: "", playbackMode: "" };
  }
  return { activityId, activityStartedAt, playbackMode };
}

export function normalizeQueueState(value = {}) {
  const entries = Array.isArray(value.entries)
    ? value.entries.map(cleanEntry).filter(Boolean)
    : [];
  const suppressedIds = Array.isArray(value.suppressedIds)
    ? [...new Set(value.suppressedIds.map((id) => String(id || "").trim()).filter(Boolean))]
    : [];
  const recoveries = Array.isArray(value.recoveries)
    ? value.recoveries.map(cleanRecovery).filter(Boolean)
    : [];
  const removedIds = Array.isArray(value.removedIds)
    ? [...new Set(value.removedIds.map((id) => String(id || "").trim()).filter(Boolean))]
    : [];
  const playerRequests = Array.isArray(value.playerRequests)
    ? value.playerRequests.map(cleanPlayerRequest).filter(Boolean)
    : [];
  const requestFileLinks = Array.isArray(value.requestFileLinks)
    ? value.requestFileLinks.map(cleanRequestFileLink).filter(Boolean)
    : [];
  const legacyMode = cleanMode(value.operatingMode);
  const hasExplicitActiveState = Object.prototype.hasOwnProperty.call(value, "activeActivityState");
  return {
    activityId: String(value.activityId || "").trim(),
    activityStartedAt: String(value.activityStartedAt || "").trim(),
    // lastSelectedMode is only a preference. activeActivityState is the
    // persisted session candidate and must still be confirmed remotely.
    lastSelectedMode: cleanMode(value.lastSelectedMode) || legacyMode,
    activeActivityState: cleanActiveActivityState(
      value.activeActivityState,
      hasExplicitActiveState ? {} : value
    ),
    operatingMode: legacyMode,
    entries,
    suppressedIds,
    recoveries,
    removedIds,
    playerRequests,
    playerOrder: cleanPlayerOrder(value.playerOrder),
    playerQueueVisibility: cleanPlayerQueueVisibility(value.playerQueueVisibility),
    playerPlayback: cleanPlayerPlayback(value.playerPlayback),
    playerStemJobs: Array.isArray(value.playerStemJobs)
      ? value.playerStemJobs.map(cleanPlayerStemJob).filter(Boolean)
      : [],
    requestFileLinks
  };
}

export async function loadQueueState() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    return normalizeQueueState(JSON.parse(await readFile(QUEUE_STATE_PATH, "utf8")));
  } catch {
    return normalizeQueueState();
  }
}

export async function saveQueueState(
  activityId,
  entries,
  suppressedIds = [],
  recoveries = [],
  activityStartedAt = "",
  removedIds = [],
  operatingMode = "",
  playerRequests = [],
  playerOrder = [],
  playerPlayback = {},
  playerStemJobs = [],
  playerQueueVisibility = {},
  requestFileLinks = [],
  lastSelectedMode = operatingMode,
  activeActivityState = {}
) {
  const clean = normalizeQueueState({
    activityId,
    activityStartedAt,
    entries: Array.from(entries || []),
    suppressedIds: Array.from(suppressedIds || []),
    recoveries: Array.from(recoveries || []),
    removedIds: Array.from(removedIds || []),
    operatingMode,
    lastSelectedMode,
    activeActivityState,
    playerRequests: Array.from(playerRequests || []),
    playerOrder: Array.from(playerOrder || []),
    playerQueueVisibility,
    playerPlayback,
    playerStemJobs: Array.from(playerStemJobs || []),
    requestFileLinks: Array.from(requestFileLinks || [])
  });
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(QUEUE_STATE_PATH, `${JSON.stringify(clean, null, 2)}\n`, "utf8");
  try {
    await chmod(QUEUE_STATE_PATH, 0o600);
  } catch {
    // Windows y algunos discos montados no implementan permisos POSIX.
  }
  return clean;
}

export { QUEUE_STATE_PATH };
