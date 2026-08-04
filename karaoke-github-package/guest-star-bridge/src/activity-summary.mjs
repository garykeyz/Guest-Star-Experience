import { normalizeText } from "./matcher.mjs";

export function requestOutcome(status) {
  const normalized = normalizeText(status);
  if (normalized === "ya canto" || normalized === "completada") return "completed";
  if (normalized === "saltado" || normalized === "omitida") return "skipped";
  return "";
}

export function requestPlannedSeconds(item, fallbackTransition = 30) {
  const duration = Number(item?.durationSeconds);
  const transition = Number(item?.transitionSeconds);
  const safeDuration = Number.isFinite(duration) && duration > 0 ? duration : 240;
  const safeTransition =
    Number.isFinite(transition) && transition >= 0
      ? transition
      : Math.max(0, Number(fallbackTransition) || 0);
  return Math.round(safeDuration + safeTransition);
}

export function buildActivitySummary(activity = {}, requests = [], now = Date.now()) {
  const targetSeconds = Math.max(
    0,
    Math.round((Number(activity.activityHours) || 0) * 3600)
  );
  const fallbackTransition = Math.max(
    0,
    Number(activity.transitionSeconds) || 0
  );
  let plannedSeconds = 0;
  let completedSeconds = 0;
  let skippedSeconds = 0;
  let queuedSeconds = 0;
  let queueSongCount = 0;

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
      queuedSeconds += seconds;
      queueSongCount += 1;
    }
  }

  const confirmedSeconds = completedSeconds + queuedSeconds;
  const pendingSeconds = Math.max(
    0,
    plannedSeconds - completedSeconds - queuedSeconds
  );
  const gapSeconds = Math.max(0, targetSeconds - confirmedSeconds);
  const overrunSeconds = Math.max(0, confirmedSeconds - targetSeconds);
  const startedAtMs = Date.parse(String(activity.activityStartedAt || ""));
  const activityRunning = Number.isFinite(startedAtMs);
  const elapsedSeconds = activityRunning
    ? Math.max(0, Math.floor((Number(now) - startedAtMs) / 1000))
    : 0;

  return {
    targetSeconds,
    activityRunning,
    eventEndsAt:
      activityRunning && targetSeconds > 0
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
