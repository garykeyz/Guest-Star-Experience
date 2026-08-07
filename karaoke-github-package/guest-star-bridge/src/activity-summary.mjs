import { normalizeText } from "./matcher.mjs";

export const MAX_TRANSITION_SECONDS = 900;

export function safeTransitionSeconds(value, fallback = 30) {
  const transition = Number(value);
  if (
    Number.isFinite(transition) &&
    transition >= 0 &&
    transition <= MAX_TRANSITION_SECONDS
  ) {
    return transition;
  }
  const safeFallback = Number(fallback);
  return Number.isFinite(safeFallback) && safeFallback >= 0
    ? Math.min(MAX_TRANSITION_SECONDS, safeFallback)
    : 0;
}

export function requestOutcome(status) {
  const normalized = normalizeText(status);
  if (normalized === "ya canto" || normalized === "completada") return "completed";
  if (normalized === "saltado" || normalized === "omitida") return "skipped";
  return "";
}

export function requestPlannedSeconds(item, fallbackTransition = 30) {
  const duration = Number(item?.durationSeconds);
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 240;
  const safeTransition = safeTransitionSeconds(
    item?.transitionSeconds,
    fallbackTransition
  );
  return Math.round(safeDuration + safeTransition);
}

export function buildActivitySummary(
  activity = {},
  requests = [],
  now = Date.now(),
  verifiedQueue = null
) {
  const targetSeconds = Math.max(
    0,
    Math.round((Number(activity.activityHours) || 0) * 3600)
  );
  const fallbackTransition = safeTransitionSeconds(
    activity.transitionSeconds,
    30
  );
  let plannedSeconds = 0;
  let completedSeconds = 0;
  let skippedSeconds = 0;
  let queuedSeconds = 0;
  let queueSongCount = 0;
  let requestQueuedSeconds = 0;
  let requestQueueSongCount = 0;

  for (const item of requests) {
    const seconds = requestPlannedSeconds(item, fallbackTransition);
    const outcome = requestOutcome(item?.status);
    if (outcome === "skipped") {
      skippedSeconds += seconds;
      continue;
    }
    plannedSeconds += seconds;
    if (outcome === "completed") {
      completedSeconds += seconds;
      continue;
    }
    if (item?.queued === true) {
      requestQueuedSeconds += seconds;
      requestQueueSongCount += 1;
    }
  }

  if (Array.isArray(verifiedQueue)) {
    for (const entry of verifiedQueue) {
      queuedSeconds += requestPlannedSeconds(entry, fallbackTransition);
      queueSongCount += 1;
    }
  } else {
    queuedSeconds = requestQueuedSeconds;
    queueSongCount = requestQueueSongCount;
  }

  const confirmedSeconds = completedSeconds + queuedSeconds;
  const pendingSeconds = Math.max(
    0,
    plannedSeconds - completedSeconds - requestQueuedSeconds
  );
  const gapSeconds = Math.max(0, targetSeconds - confirmedSeconds);
  const overrunSeconds = Math.max(0, confirmedSeconds - targetSeconds);
  const startedAtMs = Date.parse(String(activity.activityStartedAt || ""));
  const finishedAtMs = Date.parse(String(activity.activityFinishedAt || ""));
  const hasStarted = Number.isFinite(startedAtMs);
  const activityRunning = hasStarted &&
    activity.activityRunning !== false &&
    !Number.isFinite(finishedAtMs);
  const elapsedSeconds = hasStarted
    ? Math.max(0, Math.floor(((Number.isFinite(finishedAtMs) ? finishedAtMs : Number(now)) - startedAtMs) / 1000))
    : 0;

  return {
    targetSeconds,
    activityRunning,
    eventEndsAt:
      hasStarted && targetSeconds > 0
        ? new Date(startedAtMs + targetSeconds * 1000).toISOString()
        : "",
    elapsedSeconds,
    clockRemainingSeconds: Math.max(0, targetSeconds - elapsedSeconds),
    clockOverrunSeconds: Math.max(0, elapsedSeconds - targetSeconds),
    plannedSeconds,
    completedSeconds,
    skippedSeconds,
    queuedSeconds,
    pendingSeconds,
    confirmedSeconds,
    queueSongCount,
    gapSeconds,
    overrunSeconds,
    coveragePercent: targetSeconds
      ? Math.round((confirmedSeconds / targetSeconds) * 100)
      : 0,
    suggestClose:
      activity.accepting !== false &&
      targetSeconds > 0 &&
      confirmedSeconds >= targetSeconds,
    suggestHits: queueSongCount === 0 && gapSeconds > 0
  };
}
