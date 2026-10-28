import { applyBrandingTheme, renderBrandLogos } from './shared/branding-theme.js';
import { setLocalQrImage } from './qr-ui.js';
import { initLobbyWaveform } from './lobby-waveform.js';
import { starScreenPreferences, starScreenPresentation, starScreenPresentationSignature } from './star-screen-presentation.js';
import { installStarScreenCanvas } from './star-screen-canvas.js';
import { normalizeGuestLanguage, STAR_SCREEN_COPY } from './shared/guest-locales.js';
import { lyricsForSnapshot, lyricsPlaybackTime, renderTimedWords, timedLyricsLines } from './shared/timed-lyrics.js';

const $ = (selector) => document.querySelector(selector);
const channel = new BroadcastChannel('guest-star-player');
const video = $('#starScreenMedia');
const canvasController = installStarScreenCanvas($('#starScreenCanvas'), window);
const lobbyWaveform = initLobbyWaveform($('#starScreenLobbyWaveform'));
const preview = new URLSearchParams(location.search).get('preview') === '1';
const instanceId = globalThis.crypto?.randomUUID?.() || `star-screen-${Date.now()}-${Math.random().toString(36).slice(2)}`;
let lastState = null;
let lastSequence = -1;
let lastPublishedAt = 0;
let videoCleanupTimer = 0;
let heartbeatSequence = 0;
let lastHeartbeatAckAt = 0;
let lastHardVideoSyncAt = -Infinity;
let lastVideoTransportKey = '';
let pendingVideoTransportKey = '';
let lastPresentationSignature = '';
let lastPreferencesAt = 0;
const videoSyncMetrics = { hardResyncs: 0, rateWrites: 0, maxDriftSeconds: 0, lastSeekFrameLatencyMs: null };
let lastVideoQuality = { sampledAt: 0, totalFrames: 0 };
let videoSeekIssuedAt = 0;
let displayPeerId = "";
let displayPeerSeenAt = 0;
let dedicationHideTimer = 0;
let dedicationRevision = 0;

function renderDedication(next, copy, finale, upcoming) {
  const panel = $('#starScreenDedication');
  const id = String(next.dedication?.requestId || '');
  const target = id && (String(next.now?.id || '') === id ? next.now : String(upcoming[0]?.id || '') === id ? upcoming[0] : null);
  const text = target && !finale && next.displayMode !== 'karaoke'
    ? String(next.dedication?.text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 500) : '';
  const revision = ++dedicationRevision;
  window.clearTimeout(dedicationHideTimer);
  if (text) {
    $('#starScreenDedicationLabel').textContent = copy.dedication;
    $('#starScreenDedicationSinger').textContent = guest(target, copy.next);
    $('#starScreenDedicationText').textContent = text;
    panel.hidden = false;
    window.requestAnimationFrame(() => { if (revision === dedicationRevision && !panel.hidden) panel.classList.add('is-visible'); });
  } else {
    panel.classList.remove('is-visible');
    const hide = () => {
      panel.hidden = true;
      $('#starScreenDedicationText').textContent = '';
      $('#starScreenDedicationSinger').textContent = '';
    };
    if (target && !finale && next.dedication?.text && next.displayMode === 'karaoke') {
      dedicationHideTimer = window.setTimeout(hide, 260);
    } else hide();
  }
}

function renderStarScreenTheme(next) {
  const colors = next.starScreenColors || {};
  applyBrandingTheme(document.documentElement, {primaryColor:colors.primary, secondaryColor:colors.secondary, accentColor:colors.accent});
  applyBrandingTheme($('#starScreenCanvas'), {primaryColor:colors.primary, secondaryColor:colors.secondary, accentColor:colors.accent});
}

// Star Screen is a video-only follower.  Its audio must remain muted even if
// the element is reconstructed by WebKit; AVAudioEngine is the only audible
// source for a karaoke video.
video.muted = true;
video.defaultMuted = true;
// This follower has no audible pitch to preserve. Retuning WebKit's audio
// time-stretcher for every visual clock correction can discard video frames.
video.preservesPitch = false;
video.webkitPreservesPitch = false;

function nativeTempoRate(next) {
  return Math.max(0.5, Math.min(1.5, Number(next?.tempoPercent) / 100 || 1));
}

function setVideoPlaybackRate(rate) {
  const normalized = Math.max(0.5, Math.min(1.5, Number(rate) || 1));
  if (Math.abs((Number(video.playbackRate) || 1) - normalized) <= 0.003) return;
  video.playbackRate = normalized;
  videoSyncMetrics.rateWrites += 1;
}

function escapeHtml(value) {
  return String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
}

function guest(item, fallback = 'Next singer') {
  return [item?.singer, item?.guestAlias].filter(Boolean).join(' ') || fallback;
}

function normalizeBrandImageUrl(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  try {
    const url = new URL(source);
    if (!['drive.google.com', 'drive.usercontent.google.com', 'docs.google.com'].includes(url.hostname.toLowerCase())) return source;
    const match = url.pathname.match(/\/(?:file\/)?d\/([a-zA-Z0-9_-]{10,})(?:\/|$)/);
    const id = match?.[1] || url.searchParams.get('id') || '';
    if (!/^[a-zA-Z0-9_-]{10,}$/.test(id)) return source;
    const thumbnail = new URL('https://drive.google.com/thumbnail');
    thumbnail.searchParams.set('id', id); thumbnail.searchParams.set('sz', 'w1000');
    const resourceKey = url.searchParams.get('resourcekey');
    if (resourceKey) thumbnail.searchParams.set('resourcekey', resourceKey);
    return thumbnail.toString();
  } catch { return source; }
}

function expectedPlaybackTime(next) {
  return lyricsPlaybackTime(next);
}

function renderLyrics(next) {
  const panel = $('#starScreenLyrics');
  const segments = lyricsForSnapshot(next);
  const lines = timedLyricsLines(segments, expectedPlaybackTime(next));
  if (panel.hidden !== !lines.displayCurrent) panel.hidden = !lines.displayCurrent;
  const current = $('#starScreenLyricsCurrent');
  const upcoming = $('#starScreenLyricsNext');
  renderTimedWords(current,lines);
  const previous=$('#starScreenLyricsPrevious');if(previous && previous.textContent!==lines.previous)previous.textContent=lines.previous;
  if (upcoming.textContent !== lines.next) upcoming.textContent = lines.next;
  const note = $('#starScreenLyricsEstimated');
  note.hidden = next?.lyrics?.estimated !== true;
  note.textContent = next?.starScreenLanguage === 'en' ? 'Estimated lyrics' : 'Letras estimadas';
}

function syncVideo(next) {
  const karaokeMode = next?.displayMode === 'karaoke';
  const hasVideo = Boolean(next?.now?.isVideo && next?.mediaUrl);
  const shouldShowVideo = Boolean(karaokeMode && hasVideo);
  document.body.classList.toggle('star-screen-karaoke-active', karaokeMode);
  document.body.classList.toggle('star-screen-video-active', shouldShowVideo);
  // The real Star Screen owns video decoding while it is open. The embedded
  // Preview keeps the last frame and resumes from the audio clock when the
  // display closes, avoiding two competing video decoders on one host.
  if (preview && Date.now() - displayPeerSeenAt < 5000) {
    if (!video.paused) video.pause();
    return;
  }
  const fadeMs = Math.max(250, Number(next?.scene?.fadeMs) || 760);
  window.clearTimeout(videoCleanupTimer);
  if (!hasVideo) {
    if (!video.paused) video.pause();
    videoCleanupTimer = window.setTimeout(() => {
      if (lastState?.displayMode === 'karaoke' || lastState?.now?.isVideo) return;
      video.removeAttribute('src'); video.load();
    }, fadeMs + 120);
    return;
  }
  const expected = new URL(next.mediaUrl, location.origin).href;
  const transportKey = `${expected}|${Math.max(0, Number(next.visualTransportRevision) || 0)}`;
  if (video.src !== expected) {
    video.src = expected;
    video.load();
    pendingVideoTransportKey = transportKey;
  }
  if (transportKey !== lastVideoTransportKey) {
    lastVideoTransportKey = transportKey;
    pendingVideoTransportKey = transportKey;
  }
  const align = () => {
    if (!lastState || new URL(lastState.mediaUrl || '/', location.origin).href !== expected) return;
    const target = expectedPlaybackTime(lastState);
    const drift = target - (video.currentTime || 0);
    const rate = nativeTempoRate(lastState);
    videoSyncMetrics.maxDriftSeconds = Math.max(videoSyncMetrics.maxDriftSeconds, Math.abs(drift));
    const requestedTransportSync = pendingVideoTransportKey === transportKey;
    const canRecoverFromLargeDrift = Math.abs(drift) > 1.0 && Date.now() - lastHardVideoSyncAt >= 4000 && !video.seeking;
    if ((requestedTransportSync || canRecoverFromLargeDrift) && !video.seeking) {
      lastHardVideoSyncAt = Date.now();
      videoSeekIssuedAt = performance.now();
      // Loading the first frame at zero is already aligned. Avoid asking
      // WebKit to flush its warm decoder for an identical media position.
      if (Math.abs(drift) > 0.02) {
        // A playing decoder completes the seek after the clock has advanced.
        // Use its measured completion latency instead of repeatedly landing
        // behind the audible timeline. Paused scrubs remain exact.
        const lead = lastState.playing ? Math.min(0.3, Math.max(0, videoSyncMetrics.lastSeekFrameLatencyMs / 1000 || 0.06)) * rate : 0;
        video.currentTime = Math.min(Number(lastState.duration) || Infinity, target + lead);
      }
      pendingVideoTransportKey = '';
      videoSyncMetrics.hardResyncs += 1;
      setVideoPlaybackRate(rate);
    } else if (Math.abs(drift) > 0.04) {
      // Continuous sync must never seek: setting currentTime repeatedly makes
      // WebKit discard decoded frames.  A bounded correction keeps the visual
      // follower aligned without visible judder at any supported tempo.
      setVideoPlaybackRate(rate * (1 + Math.sign(drift) * (Math.abs(drift) > 0.1 ? 0.08 : 0.02)));
    } else if (Math.abs(drift) < 0.02) {
      setVideoPlaybackRate(rate);
    }
    if (shouldShowVideo && lastState.playing) {
      if (video.paused) video.play().catch(() => {});
    } else {
      setVideoPlaybackRate(1);
      if (!video.paused) video.pause();
    }
  };
  if (video.readyState >= 1) align();
}

function presentationSignature(next) {
  return starScreenPresentationSignature(next);
}

function renderAccessCountdown() {
  const target = Date.parse(lastState?.activityAccess?.nextOccurrenceAt || '');
  const label = $('#starScreenAccessCountdown');
  const timer = $('#starScreenAccessTimer');
  if (!Number.isFinite(target) || target <= Date.now()) { label.textContent = ''; timer.hidden = true; return; }
  timer.hidden = false;
  const seconds = Math.floor((target - Date.now()) / 1000);
  label.textContent = `${String(Math.floor(seconds / 86400)).padStart(2, '0')}d : ${String(Math.floor(seconds % 86400 / 3600)).padStart(2, '0')}h : ${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}m : ${String(seconds % 60).padStart(2, '0')}s`;
}

function renderActivityAccess(next, preferences) {
  const access = next.activityAccess || null;
  const enabled = preferences.showActivityAccess === true && /^\d{6}$/.test(String(access?.pin || '')) && Boolean(access?.joinUrl);
  const card = $('#starScreenActivityAccess');
  card.hidden = !enabled;
  document.body.classList.toggle('star-screen-access-on', enabled);
  if (!enabled) return;
  $('#starScreenActivityPin').textContent = String(access.pin);
  const qr = $('#starScreenActivityQr');
  try { if (qr.dataset.qrText !== access.joinUrl) setLocalQrImage(qr, access.joinUrl, 420); }
  catch { qr.removeAttribute('src'); }
  renderAccessCountdown();
}

function renderPresentation(next) {
  renderStarScreenTheme(next);
  const language = normalizeGuestLanguage(next.starScreenLanguage, 'es') === 'en' ? 'en' : 'es';
  const copy = STAR_SCREEN_COPY[language] || STAR_SCREEN_COPY.es;
  document.documentElement.lang = language;
  const finalState = next.finalExperience;
  const finale = next.activityLifecycle?.mode === 'post-activity' && finalState?.finished === true &&
    ['hotelId','activityId','venueId'].every(key => next[key] && next[key] === finalState[key]);
  document.body.classList.toggle('star-screen-finale-active', finale);
  $('#starScreenWelcome').hidden = finale;
  $('#starScreenFinale').hidden = !finale;
  const finalLanguage = normalizeGuestLanguage(next.starScreenLanguage, 'es');
  const finalCopy = finalLanguage === 'fr' ? { finalTitle: 'MERCI D’AVOIR ÉTÉ AVEC NOUS', finalMessage: 'À la prochaine.', returns: 'NOUS REVIENDRONS' } : copy;
  $('#starScreenFinaleTitle').textContent = finalCopy.finalTitle;
  $('#starScreenFinaleMessage').textContent = finalState?.message || finalCopy.finalMessage;
  $('#starScreenNextActivityLabel').textContent = finalCopy.returns;
  const nextActivity = finale ? next.finalExperience?.nextActivity : null;
  const nextDate = Date.parse(nextActivity?.scheduledStartAt || '');
  const showNext = Boolean(nextActivity && ['hotelId','activityId','venueId'].every(key => nextActivity[key] === next[key]) && Number.isFinite(nextDate) && nextDate > Date.now());
  $('#starScreenNextActivity').hidden = !showNext;
  // The installed canvas stylesheet gives this article display:grid.
  // An explicit display value prevents that rule from overriding hidden.
  $('#starScreenNextActivity').style.display = showNext ? '' : 'none';
  if (showNext) {
    let formatted;
    try {
      formatted = new Intl.DateTimeFormat(finalLanguage === 'fr' ? 'fr-FR' : language === 'en' ? 'en-US' : 'es-DO', {
        timeZone: next.hotelTimeZone || 'UTC', weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit'
      }).format(nextDate);
    } catch {
      formatted = new Intl.DateTimeFormat(finalLanguage === 'fr' ? 'fr-FR' : language === 'en' ? 'en-US' : 'es-DO', {
        weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit'
      }).format(nextDate);
    }
    $('#starScreenNextActivityWhen').textContent = formatted;
    for (const [id, value] of [['Hotel', nextActivity.hotelName], ['Venue', nextActivity.venueName], ['Name', nextActivity.activityName]]) {
      const field = $(`#starScreenNextActivity${id}`);
      field.textContent = String(value || '');
      field.hidden = !value;
    }
  }
  $('#starScreenHotel').textContent = next.hotelName || 'Guest Star';
  const activityName = String(next.activityName || '');
  $('#starScreenActivity').textContent = activityName;
  const titleBreak = activityName.lastIndexOf(' ');
  $('#starScreenTitleMain').textContent = titleBreak > 0 ? activityName.slice(0, titleBreak + 1) : activityName;
  $('#starScreenTitleEnding').textContent = titleBreak > 0 ? activityName.slice(titleBreak + 1) : '';
  renderBrandLogos($('#starScreenBrandLogos'), [next.hotelLogoUrl || next.logoUrl || '', next.teamLogoUrl || ''], normalizeBrandImageUrl);

  const preferences = starScreenPreferences(next.starScreenPreferences);
  $('#starScreenActivityPinLabel').textContent = copy.activityPin;
  $('#starScreenLiveLabel').textContent = copy.liveAtHotel;
  $('#starScreenInviteNote').textContent = copy.inviteNote;
  $('#starScreenQr').alt = copy.requestQrAlt;
  $('#starScreenActivityQr').alt = copy.activityQrAlt;
  $('#starScreenStartsInLabel').textContent = copy.startsIn;
  $('#starScreenWantLabel').textContent = copy.want;
  $('#starScreenScanQrLabel').textContent = copy.scanQr;
  $('#starScreenNowLabel').textContent = copy.now;
  $('#starScreenNextLabel').textContent = copy.next;
  $('#starScreenFunnyMessage').textContent = String(next.funnyMessage || copy.waiting);
  renderActivityAccess(next, { ...preferences, showActivityAccess: !finale && preferences.showActivityAccess });
  const joinUrl = preferences.showActivityAccess && next.activityAccess?.joinUrl
    ? next.activityAccess.joinUrl : next.publicUrl;
  const qr = $('#starScreenQr');
  try {
    if (joinUrl && qr.dataset.qrText !== joinUrl) setLocalQrImage(qr, joinUrl, 600);
    else if (!joinUrl) { qr.removeAttribute('src'); qr.dataset.qrText = ''; }
  } catch { qr.removeAttribute('src'); qr.dataset.qrText = ''; }
  document.body.classList.toggle('star-screen-no-qr', !joinUrl || !qr.src);

  const view = starScreenPresentation(next);
  const upcoming = view.upcoming;
  const showWaveform = view.preferences.showWaveform !== false;
  const showNowPlaying = view.preferences.showStarScreenNowPlaying !== false;
  $('#starScreenWaveformRegion').hidden = !showWaveform;
  $('#starScreenNow').hidden = finale || !showNowPlaying;
  document.body.classList.toggle('star-screen-hide-waveform', !showWaveform);
  document.body.classList.toggle('star-screen-hide-now-playing', !showNowPlaying);
  const queueCount = $('#starScreenQueueCount');
  queueCount.textContent = String(upcoming.length);
  queueCount.hidden = next.showQueueCount === false;
  $('#starScreenQueue').style.setProperty('--visible-lineup-count', Math.max(1, view.visible.length));
  $('#starScreenLineupLabel').textContent = copy.lineup;
  const singleNext = view.visible.length === 1;
  $('#starScreenQueue').innerHTML = upcoming.length
    ? view.visible.map((item, index) => `<li class="${singleNext ? 'star-screen-next-row' : ''} ${index === 0 ? 'star-screen-lead-row' : ''}">${singleNext ? '' : `<b>${String(index + 1).padStart(2, '0')}</b>`}<div><strong>${escapeHtml(guest(item,copy.next))}</strong><small><span class="star-screen-song-title">${escapeHtml(item.information.title === 'Canción solicitada' ? copy.requestedSong : item.information.title)}</span><span class="star-screen-song-artist">${escapeHtml(item.information.artist)}</span></small></div><span>${singleNext ? escapeHtml(copy.next) : escapeHtml(copy.queued)}</span></li>`).join('')
    : `<li class="empty"><div><strong>${escapeHtml(copy.first)}</strong><small>${escapeHtml(copy.scan)}</small></div></li>`;
  const background = next.background?.track || null;
  $('#starScreenNowSong').textContent = view.nowInformation?.title === 'Canción solicitada' ? copy.requestedSong : view.nowInformation?.title || background?.song || copy.background;
  $('#starScreenNowSinger').textContent = view.nowInformation ? guest(next.now,copy.next) : background?.artist || copy.background;
  $('#starScreenNowArtist').textContent = view.nowInformation?.artist || '';
  $('#starScreenNowArtist').hidden = !view.nowInformation?.artist;
  $('#starScreenNextSinger').textContent = upcoming[0] ? guest(upcoming[0],copy.next) : copy.waiting;
  renderDedication(next, copy, finale, upcoming);
  document.body.classList.toggle('star-screen-playing', Boolean(next.background?.playing));
}

function render(next) {
  if (!next || next.type) return;
  const publishedAt = Math.max(0, Number(next.publishedAt) || 0);
  const sequence = Math.max(0, Number(next.sequence) || 0);
  if (publishedAt && publishedAt < lastPublishedAt) return;
  if (publishedAt && publishedAt === lastPublishedAt && sequence <= lastSequence) return;
  if (!publishedAt && lastPublishedAt && sequence <= lastSequence) return;
  if (publishedAt) lastPublishedAt = publishedAt;
  lastSequence = sequence;
  if (publishedAt < lastPreferencesAt && lastState) next = { ...next, starScreenPreferences: lastState.starScreenPreferences };
  lastState = next;
  lobbyWaveform.setScene(next);
  const signature = presentationSignature(next);
  if (signature !== lastPresentationSignature) {
    lastPresentationSignature = signature;
    renderPresentation(next);
  }
  syncVideo(next);
  renderLyrics(next);
}

function sendVideoHealth() {
  if (!lastState?.now?.isVideo) return;
  const now = Date.now();
  const quality = video.getVideoPlaybackQuality?.();
  const totalFrames = Math.max(0, Number(quality?.totalVideoFrames) || 0);
  const elapsedSeconds = Math.max(0.001, (now - lastVideoQuality.sampledAt) / 1000);
  const frameRate = lastVideoQuality.sampledAt > 0 ? Math.max(0, (totalFrames - lastVideoQuality.totalFrames) / elapsedSeconds) : 0;
  lastVideoQuality = { sampledAt: now, totalFrames };
  channel.postMessage({
    type: 'star-screen-video-health', instanceId, preview, sentAt: now,
    totalFrames,
    droppedFrames: Math.max(0, Number(quality?.droppedVideoFrames) || 0),
    corruptedFrames: Math.max(0, Number(quality?.corruptedVideoFrames) || 0),
    frameRate: Number(frameRate.toFixed(2)),
    hardResyncs: videoSyncMetrics.hardResyncs,
    rateWrites: videoSyncMetrics.rateWrites,
    maxDriftSeconds: Number(videoSyncMetrics.maxDriftSeconds.toFixed(3)),
    lastSeekFrameLatencyMs: videoSyncMetrics.lastSeekFrameLatencyMs,
    readyState: video.readyState,
    paused: video.paused
  });
}

function sendHeartbeat() {
  channel.postMessage({
    type: 'star-screen-heartbeat',
    instanceId,
    sequence: ++heartbeatSequence,
    preview,
    visible: document.visibilityState !== 'hidden',
    sentAt: Date.now(),
    lastAckAt: lastHeartbeatAckAt
  });
}

channel.addEventListener('message', (event) => {
  if (event.data?.type === 'star-screen-closed' && preview) {
    displayPeerSeenAt = 0;
    if (lastState) syncVideo(lastState);
    return;
  }
  if (event.data?.type === 'star-screen-heartbeat' && preview && event.data.preview === false) {
    if (event.data.visible === false && event.data.instanceId === displayPeerId) displayPeerSeenAt = 0;
    else if (event.data.visible !== false) { displayPeerId = event.data.instanceId; displayPeerSeenAt = Date.now(); }
    return;
  }
  if (event.data?.type === 'player-clock') {
    const clock = event.data;
    if (!lastState || String(clock.currentId) !== String(lastState.currentId) || Number(clock.publishedAt) < lastPublishedAt) return;
    // Transport-only snapshots do not rebuild logos, QR, theme or canvas.
    lastState = { ...lastState, currentTime: clock.currentTime, playing: clock.playing, tempoPercent: clock.tempoPercent, publishedAt: clock.publishedAt };
    renderLyrics(lastState);
    if (!document.hidden) syncVideo(lastState);
    return;
  }
  if (event.data?.type === 'star-screen-preferences') {
    if (!lastState || Number(event.data.publishedAt) < lastPreferencesAt) return;
    lastPreferencesAt = Number(event.data.publishedAt) || Date.now();
    lastState = { ...lastState, starScreenPreferences: starScreenPreferences(event.data.preferences) };
    lastPresentationSignature = presentationSignature(lastState);
    renderPresentation(lastState);
    return; // Presentation only: never syncVideo for a preference change.
  }
  if (event.data?.type === 'lobby-waveform-frame') {
    lobbyWaveform.receive(event.data);
    return;
  }
  if (event.data?.type === 'star-screen-ack') {
    if (String(event.data.instanceId || '') === instanceId) lastHeartbeatAckAt = Date.now();
    return;
  }
  render(event.data);
});
try {
  const cached = JSON.parse(localStorage.getItem('guest-star:player-state') || 'null');
  // This cache is shared across activity changes. A finale must wait for the
  // live payload carrying backend-validated hotel/activity/venue identifiers.
  if (cached) render({ ...cached, finalExperience: null });
} catch { /* Waiting for Player. */ }
window.setInterval(renderAccessCountdown, 1000);
channel.postMessage({ type: 'request-state' });
sendHeartbeat();
document.addEventListener('visibilitychange', sendHeartbeat);
window.addEventListener('pagehide', sendHeartbeat);
window.addEventListener('pagehide', () => canvasController.destroy(), { once: true });
video.addEventListener('loadedmetadata', () => { if (lastState) syncVideo(lastState); });
// A second paused scrub can arrive while the first decoder seek is active.
// The normal interval runs only during playback, so finish the latest pending
// transport seek as soon as the previous frame becomes available.
video.addEventListener('seeked', () => {
  if (videoSeekIssuedAt > 0) {
    videoSyncMetrics.lastSeekFrameLatencyMs = Math.round(performance.now() - videoSeekIssuedAt);
    videoSeekIssuedAt = 0;
  }
  if (lastState && pendingVideoTransportKey) syncVideo(lastState);
});
window.setInterval(() => { if (lastState?.playing && !document.hidden) syncVideo(lastState); }, 100);
window.setInterval(() => { if (lastState && !document.hidden) renderLyrics(lastState); }, 100);
window.setInterval(sendHeartbeat, 2000);
window.setInterval(sendVideoHealth, 2000);
