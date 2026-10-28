const MEDIA_EXTENSION = /\.(?:mp4|mov|mkv|mp3|m4a|m4v|avi|wav|flac|aac|ogg|webm|cdg|zip)$/i;
const INTERNAL_ID = /^(?:[0-9a-f]{8}-[0-9a-f-]{27,}|player-local-[0-9a-f-]+|(?:request|req)[-_][0-9a-f-]{16,})$/i;

export function starScreenPreferences(value = {}) {
  const count = Number(value.starScreenLineupCount);
  return {
    starScreenSongSource: value.starScreenSongSource === 'local' ? 'local' : 'request',
    starScreenLineupCount: Number.isInteger(count) && count >= 1 && count <= 5 ? count : 5,
    showWaveform: value.showWaveform !== false,
    showStarScreenNowPlaying: value.showStarScreenNowPlaying !== false,
    showActivityAccess: value.showActivityAccess === true
  };
}

// The activity lifecycle owns the canvas mode. Request intake is only a
// secondary gate for the post-activity screen, never a substitute for finish.
export function starScreenLifecycle({ status = '', activityRunning = false, finishedAt = '', requestsOpen = false } = {}) {
  const lifecycleStatus = String(status).toLowerCase();
  const hasActiveActivity = activityRunning === true ||
    ['active', 'in_progress', 'started', 'running'].includes(lifecycleStatus);
  const completed = ['finished', 'completed'].includes(lifecycleStatus) ||
    (!lifecycleStatus && Boolean(finishedAt));
  return {
    mode: hasActiveActivity ? 'active' : completed ? 'post-activity' : 'pre-activity',
    hasActiveActivity,
    requestsOpen: requestsOpen === true
  };
}

function text(value, clean = false) {
  if (typeof value !== 'string') return '';
  let result = value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  if (/^(?:\/|~\/|[a-z]:[\\/]|file:|https?:|\.\.?[\\/])/i.test(result) || INTERNAL_ID.test(result)) return '';
  if ((/[\\/]/.test(result) && MEDIA_EXTENSION.test(result)) || /^[A-Za-z0-9_-]{60,}$/.test(result)) return '';
  result = result.replace(MEDIA_EXTENSION, '');
  if (clean) {
    result = result.replace(/_/g, ' ')
      .replace(/[[(][^\])]*(?:karaoke|instrumental|lyrics?|official|1080p|720p)[^\])]*[\])]/gi, ' ')
      .replace(/\b(?:karafun|karaoke(?:\s+version)?|version\s+karaoke|1080p|720p|2160p|4k|hd|hq)\b/gi, ' ')
      .replace(/(?:\s|^)(?:(?:final|v\d+)\s*)+$/gi, ' ');
  }
  return result.replace(/\s+/g, ' ').replace(/^[\s|·-]+|[\s|·-]+$/g, '').trim().slice(0, 200);
}

function pair(value = {}, clean = true) {
  return { title: text(value.title || value.song, clean), artist: text(value.artist, clean) };
}

function filenameInformation(item) {
  const match = item.matches?.find(candidate => candidate.exact);
  const filename = String(item.fileName || match?.fileName || item.filePath || item.queuedFilePath || '').split(/[\\/]/).pop();
  return { title: text(filename, true), artist: '' };
}

function inferredLocalPair(item) {
  if (item.sourceType !== 'player_local') return null;
  const filename = String(item.fileName || item.filePath || item.queuedFilePath || '').split(/[\\/]/).pop().replace(MEDIA_EXTENSION, '');
  const separator = filename.indexOf(' - ');
  if (separator < 1) return null;
  const first = text(filename.slice(0, separator), true);
  const second = text(filename.slice(separator + 3), true);
  const importedTitle = text(item.artist, true);
  const importedArtist = text(item.song, true);
  const comparable = value => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
  const rawSecond = filename.slice(separator + 3);
  const providerTaggedArtist = /\bkarafun\b/i.test(rawSecond) && /(?:&|\bfeat\.?\b|\bft\.?\b)/i.test(importedArtist);
  if (!providerTaggedArtist || !first || !second || comparable(first) !== comparable(importedTitle) || comparable(second) !== comparable(importedArtist)) return null;
  return { title: importedTitle, artist: importedArtist };
}

// Projection only: the original request, path and filename are never mutated.
export function starScreenRequestData(item = {}) {
  const match = item.matches?.find(candidate => candidate.exact);
  const original = pair(item.originalRequest || {
    song: item.requestedSong || item.requestedTitle || (item.sourceType !== 'player_local' ? item.song : ''),
    artist: item.requestedArtist || (item.sourceType !== 'player_local' ? item.artist : '')
  }, false);
  const inferred = inferredLocalPair(item);
  const associated = pair(item.requestMetadata || item.metadata || inferred || (item.sourceType === 'player_local' ? item : {}));
  const detected = pair(item.mediaMetadata || match?.metadata || {});
  const local = pair(item.localMetadata || inferred || {});
  const fallback = filenameInformation(item);
  function resolve(sources) {
    return {
      title: sources.map(source => source.title).find(value => value && value !== item.id) || 'Canción solicitada',
      artist: sources.map(source => source.artist).find(value => value && value !== item.id) || ''
    };
  }
  return { starScreenSongInformation: {
    request: resolve([original, associated, detected, local, fallback]),
    local: resolve([local, detected, associated, fallback, original])
  } };
}

export function starScreenSongInformation(item = {}, source = 'request') {
  const information = item.starScreenSongInformation?.[source] || starScreenRequestData(item).starScreenSongInformation[source];
  return { title: text(information?.title) || 'Canción solicitada', artist: text(information?.artist) };
}

export function starScreenPresentation(next = {}) {
  const preferences = starScreenPreferences(next.starScreenPreferences);
  const currentId = next.displayMode === 'karaoke' ? String(next.now?.id || next.currentId || '') : '';
  const upcoming = (Array.isArray(next.queue) ? next.queue : []).filter(item =>
    (!currentId || String(item.id || '') !== currentId) && item.visibleOnStarScreen !== false && !item.outcome &&
    !['Ya cantó', 'Saltado', 'Retirada del Player'].includes(item.status)
  );
  return {
    preferences, upcoming,
    visible: upcoming.slice(0, preferences.starScreenLineupCount).map(item => ({ ...item, information: starScreenSongInformation(item, preferences.starScreenSongSource) })),
    nowInformation: next.displayMode === 'karaoke' && next.now
      ? starScreenSongInformation(next.now, preferences.starScreenSongSource)
      : null
  };
}

export function starScreenPresentationSignature(next) {
  const view = starScreenPresentation(next);
  return JSON.stringify({
    hotel: [next.hotelName, next.hotelTimeZone, next.activityName, next.logoUrl, next.hotelLogoUrl, next.teamLogoUrl, next.publicUrl, next.activityAccess?.pin, next.activityAccess?.joinUrl, next.activityAccess?.nextOccurrenceAt, next.starScreenColors, next.starScreenLanguages],
    starScreenLanguage: next.starScreenLanguage, dedication: next.dedication,
    displayMode: next.displayMode, preferences: view.preferences, showQueueCount: next.showQueueCount,
    activityLifecycle: next.activityLifecycle,
    finalExperience: next.finalExperience,
    total: view.upcoming.length,
    now: [next.now?.id, next.now?.singer, next.now?.guestAlias, view.nowInformation],
    background: [next.background?.track?.id, next.background?.track?.song, next.background?.track?.artist, next.background?.playing],
    visible: view.visible.map(item => [item.id, item.singer, item.guestAlias, item.information])
  });
}
