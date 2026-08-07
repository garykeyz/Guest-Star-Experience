export const DEFAULT_QUEUE_MISS_THRESHOLD = 3;
export const DEFAULT_INSERTION_GRACE_MS = 8000;

function pendingStart(value) {
  if (value && typeof value === "object") return Number(value.startedAt) || 0;
  return Number(value) || 0;
}

export function reconcileQueuePresence({
  previous = new Map(),
  trackedIds = [],
  matchedIds = new Set(),
  pendingInsertions = new Map(),
  now = Date.now(),
  missThreshold = DEFAULT_QUEUE_MISS_THRESHOLD,
  insertionGraceMs = DEFAULT_INSERTION_GRACE_MS
} = {}) {
  const next = new Map();
  const confirmedMissing = [];
  const transientMissing = [];
  const matched = [];

  for (const rawId of trackedIds) {
    const id = String(rawId || "");
    if (!id) continue;
    if (matchedIds.has(id)) {
      next.set(id, 0);
      matched.push(id);
      continue;
    }
    const startedAt = pendingStart(pendingInsertions.get(id));
    if (startedAt && now - startedAt < insertionGraceMs) {
      next.set(id, 0);
      transientMissing.push(id);
      continue;
    }
    const misses = Math.max(0, Number(previous.get(id)) || 0) + 1;
    next.set(id, misses);
    if (misses >= missThreshold) confirmedMissing.push(id);
    else transientMissing.push(id);
  }

  return { next, confirmedMissing, transientMissing, matched };
}
