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
    artist: String(value.artist || "").trim()
  };
  return entry.id && entry.filePath && entry.singer ? entry : null;
}

export function normalizeQueueState(value = {}) {
  const entries = Array.isArray(value.entries)
    ? value.entries.map(cleanEntry).filter(Boolean)
    : [];
  const suppressedIds = Array.isArray(value.suppressedIds)
    ? [...new Set(value.suppressedIds.map((id) => String(id || "").trim()).filter(Boolean))]
    : [];
  return {
    activityId: String(value.activityId || "").trim(),
    entries,
    suppressedIds
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

export async function saveQueueState(activityId, entries, suppressedIds = []) {
  const clean = normalizeQueueState({
    activityId,
    entries: Array.from(entries || []),
    suppressedIds: Array.from(suppressedIds || [])
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
