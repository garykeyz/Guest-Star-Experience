// One calculation for the local server and both operator views.
export const MAX_TRANSITION_SECONDS = 900;
export function safeTransitionSeconds(value, fallback = 30) {
  const n = Number(value);
  return value != null && Number.isFinite(n) && n >= 0 && n <= 900 ? n : Math.max(0, Math.min(900, Number(fallback) || 0));
}
export function requestOutcome(status) {
  const s = String(status || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  if (['ya canto', 'completada'].includes(s)) return 'completed';
  if (['saltado', 'omitida'].includes(s)) return 'skipped';
  if (['retirada del player', 'eliminada'].includes(s)) return 'removed';
  return '';
}
export function requestPlannedSeconds(item, fallbackTransition = 30, average = 240) {
  return Math.round((Number(item?.durationSeconds) > 0 ? Number(item.durationSeconds) : average) + safeTransitionSeconds(item?.transitionSeconds, fallbackTransition));
}
export function robustDuration(values) {
  const a = values.filter(n => Number.isFinite(n) && n > 0 && n <= 43200).sort((a,b) => a-b);
  if (!a.length) return 0;
  const middle = Math.floor(a.length / 2);
  return a.length % 2 ? a[middle] : (a[middle - 1] + a[middle]) / 2;
}
export function buildActivitySummary(activity = {}, requests = [], now = Date.now(), verifiedQueue = null, options = {}) {
  const outcome = item => item?.outcome || requestOutcome(item?.status);
  const targetSeconds = Math.max(0, Math.round((Number(activity.activityHours) || 0) * 3600));
  const transition = safeTransitionSeconds(activity.transitionSeconds, 30);
  const completed = requests.filter(i => outcome(i) === 'completed');
  const skipped = requests.filter(i => ['skipped', 'removed'].includes(outcome(i)));
  const active = requests.filter(i => !outcome(i));
  const reserveIds = new Set(options.reserveIds || []);
  const standby = i => reserveIds.has(String(i.id || i.requestId)) || i.standby === true;
  const queue = (Array.isArray(verifiedQueue) ? verifiedQueue : active.filter(i => i.queued === true)).filter(i => !outcome(i) && !standby(i));
  const usefulQueue = queue.filter(item => item.coverageEligible !== false);
  const queueIds = new Set(queue.map(i => String(i.id || i.requestId || i.linkedRequestId || '')).filter(Boolean));
  const pending = active.filter(i => !standby(i) && !i.queued && !queueIds.has(String(i.id)));
  const eligible = pending.filter(i => i.localAvailable === true || i.coverageEligible === true);
  const durations = items => items.map(i => Number(i.durationSeconds)).filter(n => Number.isFinite(n) && n > 0);
  const average = robustDuration(durations(completed).slice(-30)) || robustDuration(durations(usefulQueue)) || robustDuration(durations(active)) || 240;
  const averageEffectiveSong = average + transition;
  const seconds = item => requestPlannedSeconds(item, transition, average);
  const playback = options.currentPlayback || {};
  const currentId = String(playback.currentRequestId || '');
  const currentPath = String(playback.filePath || '');
  const observed=Date.parse(String(playback.observedAt || playback.updatedAt || ''));
  const advance=playback.playing === true && Number.isFinite(observed) ? Math.min(15,Math.max(0,(now-observed)/1000)) : 0;
  const currentSeconds = Math.max(0, Number(playback.currentTimeSeconds) || 0) + advance;
  let queuedSeconds = 0;
  let currentCounted = false;
  for (const item of usefulQueue) {
    const current = currentId ? String(item.id || item.requestId || item.linkedRequestId) === currentId : currentPath && item.filePath === currentPath;
    queuedSeconds += current ? Math.max(0, seconds(item) - currentSeconds) : seconds(item);
    if (current) currentCounted = true;
  }
  // A playing deck may leave the physical queue before its audio finishes.
  if (!currentCounted && playback.playing === true && Number(playback.durationSeconds) > currentSeconds) {
    queuedSeconds += Number(playback.durationSeconds) - currentSeconds + transition;
  }
  const pendingSeconds = eligible.reduce((n,i) => n + seconds(i), 0);
  const futureContentSeconds = queuedSeconds + pendingSeconds;
  const started = Date.parse(String(activity.activityStartedAt || ''));
  const finished = Date.parse(String(activity.activityFinishedAt || ''));
  const hasStarted = Number.isFinite(started);
  const activityRunning = hasStarted && activity.activityRunning !== false && !Number.isFinite(finished);
  const elapsedSeconds = hasStarted ? Math.max(0, Math.floor(((Number.isFinite(finished) ? finished : now) - started) / 1000)) : 0;
  const remaining = Math.max(0, targetSeconds - elapsedSeconds);
  const uncovered = Math.max(0, remaining - futureContentSeconds);
  const completedSeconds = completed.reduce((n,i) => n+seconds(i),0);
  return {
    targetSeconds, activityRunning, startedAt: hasStarted ? new Date(started).toISOString() : '',
    eventEndsAt: hasStarted && targetSeconds ? new Date(started + targetSeconds * 1000).toISOString() : '',
    elapsedSeconds, clockRemainingSeconds: remaining, remainingActivitySeconds: remaining,
    clockOverrunSeconds: Math.max(0, elapsedSeconds - targetSeconds),
    completedCount: completed.length, skippedCount: skipped.filter(i => outcome(i) === 'skipped').length,
    completedSeconds, skippedSeconds: skipped.reduce((n,i) => n+seconds(i),0),
    queuedSeconds, pendingSeconds, pendingCount: pending.length, eligiblePendingCount: eligible.length,
    reserveCount: active.filter(standby).length, queueSongCount: queue.length + (!currentCounted && playback.playing === true ? 1 : 0),
    plannedSeconds: requests.filter(i => !['skipped','removed'].includes(outcome(i))).reduce((n,i) => n+seconds(i),0),
    confirmedSeconds: completedSeconds + queuedSeconds,
    futureContentSeconds, gapSeconds: uncovered, uncoveredSeconds: uncovered,
    overrunSeconds: Math.max(0, futureContentSeconds - remaining),
    coveredUntil: activityRunning ? new Date(now + futureContentSeconds * 1000).toISOString() : '',
    coveragePercent: targetSeconds ? Math.min(100, Math.max(0, Math.round((elapsedSeconds + futureContentSeconds) / targetSeconds * 100))) : 0,
    estimatedSongsNeeded: Math.ceil(uncovered / averageEffectiveSong),
    estimatedRemainingSongs: Math.floor(remaining / averageEffectiveSong),
    estimateAverageSongSeconds: averageEffectiveSong, estimateMethod: 'robust-duration',
    coverageAlert: !activityRunning || !targetSeconds ? 'inactive' : uncovered <= 0 ? 'covered' : uncovered <= 300 ? 'critical' : uncovered <= 900 ? 'warning' : uncovered <= 1800 ? 'notice' : 'normal',
    suggestClose: activityRunning && activity.accepting !== false && targetSeconds > 0 && uncovered === 0 && remaining > 0,
    suggestHits: queue.length === 0 && uncovered > 0
  };
}
export function estimateRemainingSongs({remainingSeconds = 0, requests = [], queue = [], fallbackTransition = 30} = {}) {
  const known = items => items.map(i => Number(i.durationSeconds)).filter(n => n>0);
  const averageSongSeconds = (robustDuration(known(requests.filter(i => requestOutcome(i.status) === 'completed'))) || robustDuration(known(queue || [])) || robustDuration(known(requests)) || 240) + safeTransitionSeconds(fallbackTransition);
  return {count: Math.floor(Math.max(0, remainingSeconds) / averageSongSeconds), averageSongSeconds, method:'robust-duration'};
}
