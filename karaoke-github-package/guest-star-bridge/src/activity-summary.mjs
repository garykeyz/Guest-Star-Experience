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
  if (normalized === "retirada del player") return "removed";
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

function knownSongSeconds(item, fallbackTransition = 30) {
  const duration = Number(item?.durationSeconds);
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.round(duration + safeTransitionSeconds(
    item?.transitionSeconds,
    fallbackTransition
  ));
}

function average(values = []) {
  const usable = values.filter((value) => Number.isFinite(value) && value > 0);
  return usable.length
    ? Math.round(usable.reduce((total, value) => total + value, 0) / usable.length)
    : 0;
}

export function estimateRemainingSongs({
  remainingSeconds = 0,
  requests = [],
  queue = null,
  currentPlayback = null,
  fallbackTransition = 30,
  preciseThresholdSeconds = 3600
} = {}) {
  const availableSeconds = Math.max(0, Math.floor(Number(remainingSeconds) || 0));
  if (!availableSeconds) {
    return { count: 0, averageSongSeconds: 0, method: "clock-ended" };
  }

  const active = requests.filter((item) => {
    const outcome = item?.outcome || requestOutcome(item?.status);
    return !["completed", "skipped", "removed"].includes(outcome);
  });
  const completed = requests.filter((item) =>
    (item?.outcome || requestOutcome(item?.status)) === "completed"
  );
  const queueItems = Array.isArray(queue)
    ? queue
    : active.filter((item) => item?.queued === true || item?.localAvailable === true);
  const knownAll = requests.map((item) => knownSongSeconds(item, fallbackTransition)).filter(Boolean);
  const knownQueue = queueItems.map((item) => knownSongSeconds(item, fallbackTransition)).filter(Boolean);
  const knownCompleted = completed.map((item) => knownSongSeconds(item, fallbackTransition)).filter(Boolean);
  const fallbackSeconds = Math.max(60, 240 + safeTransitionSeconds(fallbackTransition, 30));
  const averageSongSeconds = average(knownAll) || average(knownQueue) || average(knownCompleted) || fallbackSeconds;

  if (availableSeconds > preciseThresholdSeconds) {
    return {
      count: Math.max(0, Math.floor(availableSeconds / averageSongSeconds)),
      averageSongSeconds,
      method: knownAll.length ? "known-duration-average" : knownCompleted.length ? "completed-average" : "fallback-average"
    };
  }

  let secondsLeft = availableSeconds;
  let count = 0;
  const currentId = String(currentPlayback?.currentRequestId || "");
  const queuedWithoutCurrent = queueItems.filter((item) =>
    !currentId || String(item?.id || item?.requestId || "") !== currentId
  );
  if (currentId) {
    const currentItem = requests.find((item) => String(item?.id || "") === currentId);
    const fullCurrentSeconds = knownSongSeconds(currentItem, fallbackTransition) || averageSongSeconds;
    const currentTimeSeconds = Math.max(0, Number(currentPlayback?.currentTimeSeconds) || 0);
    const currentRemainingSeconds = Math.max(0, fullCurrentSeconds - currentTimeSeconds);
    if (currentRemainingSeconds > 0 && currentRemainingSeconds <= secondsLeft) {
      count += 1;
      secondsLeft -= currentRemainingSeconds;
    } else if (currentRemainingSeconds > secondsLeft) {
      return { count: 0, averageSongSeconds, method: "last-hour-current-track" };
    }
  }

  for (const item of queuedWithoutCurrent) {
    const songSeconds = knownSongSeconds(item, fallbackTransition) || averageSongSeconds;
    if (songSeconds > secondsLeft) break;
    count += 1;
    secondsLeft -= songSeconds;
  }
  if (secondsLeft >= averageSongSeconds && queuedWithoutCurrent.length === 0) {
    count += Math.floor(secondsLeft / averageSongSeconds);
  } else if (secondsLeft >= averageSongSeconds && count === queuedWithoutCurrent.length + (currentId ? 1 : 0)) {
    count += Math.floor(secondsLeft / averageSongSeconds);
  }
  return { count, averageSongSeconds, method: "last-hour-queue-projection" };
}

export function buildActivitySummary(
  activity = {},
  requests = [],
  now = Date.now(),
  verifiedQueue = null,
  options = {}
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
    const outcome = item?.outcome || requestOutcome(item?.status);
    if (outcome === "skipped" || outcome === "removed") {
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
  const elapsedSeconds = activityRunning
    ? Math.max(0, Math.floor((Number(now) - startedAtMs) / 1000))
    : 0;
  const clockRemainingSeconds = activityRunning
    ? Math.max(0, targetSeconds - elapsedSeconds)
    : 0;
  const songEstimate = activityRunning
    ? estimateRemainingSongs({
        remainingSeconds: clockRemainingSeconds,
        requests,
        queue: Array.isArray(verifiedQueue)
          ? verifiedQueue
          : requests.filter((item) => item?.queued === true || item?.localAvailable === true),
        currentPlayback: options.currentPlayback,
        fallbackTransition
      })
    : { count: 0, averageSongSeconds: 0, method: "inactive" };

  return {
    targetSeconds,
    activityRunning,
    eventEndsAt:
      activityRunning && targetSeconds > 0
        ? new Date(startedAtMs + targetSeconds * 1000).toISOString()
        : "",
    elapsedSeconds,
    clockRemainingSeconds,
    clockOverrunSeconds: Math.max(0, elapsedSeconds - targetSeconds),
    remainingActivitySeconds: clockRemainingSeconds,
    estimatedRemainingSongs: songEstimate.count,
    estimateAverageSongSeconds: songEstimate.averageSongSeconds,
    estimateMethod: songEstimate.method,
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
