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
  return {
    activityId: String(value.activityId || "").trim(),
    activityStartedAt: String(value.activityStartedAt || "").trim(),
    entries,
    suppressedIds,
    recoveries,
    removedIds
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
  removedIds = []
) {
  const clean = normalizeQueueState({
    activityId,
    activityStartedAt,
    entries: Array.from(entries || []),
    suppressedIds: Array.from(suppressedIds || []),
    recoveries: Array.from(recoveries || []),
    removedIds: Array.from(removedIds || [])
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
