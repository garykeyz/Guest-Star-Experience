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
  const id = String(value.id || "").trim();
  const filePath = String(value.filePath || "").trim();
  if (!id || !filePath) return null;
  const status = ["queued", "processing", "ready", "failed"].includes(String(value.status || ""))
    ? String(value.status)
    : "queued";
  return {
    id,
    filePath,
    status: status === "processing" ? "queued" : status,
    progress: Math.max(0, Math.min(100, Number(value.progress) || 0)),
    phase: String(value.phase || "").trim(),
    instrumentalPath: String(value.instrumentalPath || "").trim(),
    vocalsPath: String(value.vocalsPath || "").trim(),
    error: String(value.error || "").trim(),
    requestedAt: String(value.requestedAt || "").trim(),
    updatedAt: String(value.updatedAt || "").trim()
  };
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
  return {
    activityId: String(value.activityId || "").trim(),
    activityStartedAt: String(value.activityStartedAt || "").trim(),
    operatingMode: ["player", "bridge"].includes(String(value.operatingMode || "").trim())
      ? String(value.operatingMode).trim()
      : "",
    entries,
    suppressedIds,
    recoveries,
    removedIds,
    playerRequests,
    playerOrder: cleanPlayerOrder(value.playerOrder),
    playerPlayback: cleanPlayerPlayback(value.playerPlayback),
    playerStemJobs: Array.isArray(value.playerStemJobs)
      ? value.playerStemJobs.map(cleanPlayerStemJob).filter(Boolean)
      : []
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
  playerStemJobs = []
) {
  const clean = normalizeQueueState({
    activityId,
    activityStartedAt,
    entries: Array.from(entries || []),
    suppressedIds: Array.from(suppressedIds || []),
    recoveries: Array.from(recoveries || []),
    removedIds: Array.from(removedIds || []),
    operatingMode,
    playerRequests: Array.from(playerRequests || []),
    playerOrder: Array.from(playerOrder || []),
    playerPlayback,
    playerStemJobs: Array.from(playerStemJobs || [])
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
