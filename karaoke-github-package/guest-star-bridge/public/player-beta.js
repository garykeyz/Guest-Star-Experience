import { setLocalQrImage } from './qr-ui.js';

const $ = (selector, root = document) => root.querySelector(selector);
const activeRequest = (item) => !item?.outcome &&
  !['Ya cantó', 'Saltado', 'Retirada del Player'].includes(String(item?.status || '')) &&
  (!item?.stem || item.stem.status === 'ready');
const terminalRequest = (item) => Boolean(item?.outcome) || ['Ya cantó', 'Saltado', 'Retirada del Player'].includes(String(item?.status || ''));
const escapeHtml = (value) => String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const isVideoName = (value) => /\.(mp4|m4v|mov|webm)$/i.test(String(value || ''));
const normalizeSearch = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const FADE_MS = 760;

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

function formatDuration(value, compact = false) {
  const seconds = Math.max(0, Math.floor(Number(value) || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remaining = String(seconds % 60).padStart(2, '0');
  if (compact && !hours) return `${minutes}:${remaining}`;
  return `${hours}:${String(minutes).padStart(2, '0')}:${remaining}`;
}

function clockTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleTimeString('es-DO', { hour: 'numeric', minute: '2-digit' });
}

function shuffled(values) {
  const list = [...values];
  for (let index = list.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(Math.random() * (index + 1));
    [list[index], list[swap]] = [list[swap], list[index]];
  }
  return list;
}

export function initPlayerBeta({ api, showNotice, confirmAction, operations = {} }) {
  const media = $('#playerMedia');
  const instrumentalAudio = $('#playerInstrumentalAudio');
  const vocalsAudio = $('#playerVocalsAudio');
  const backgroundAudio = $('#playerBackgroundAudio');
  const assignDialog = $('#playerAssignSingerDialog');
  const channel = new BroadcastChannel('guest-star-player');
  let state = null;
  let currentId = '';
  let order = [];
  const openYoutubeIds = new Set();
  const expandedRequestIds = new Set();
  let opened = false;
  let libraryLoaded = false;
  let libraryTracks = [];
  let libraryOffset = 0;
  let libraryHasMore = false;
  let libraryBrowseAll = false;
  let planBItems = [];
  let planBLoading = false;
  let pendingTrack = null;
  let stageMode = 'lobby';
  let scenePhase = 'lobby';
  let sceneRevision = 0;
  let publishSequence = 0;
  let transitionToken = 0;
  let transitionBusy = false;
  let intentionalMediaReset = false;
  let intentionalBackgroundReset = false;
  let backgroundCurrentId = '';
  let backgroundPendingId = '';
  let backgroundShuffle = [];
  let lastBackgroundId = '';
  let backgroundTransition = null;
  let backgroundGeneration = 0;
  let backgroundStatusOverride = '';
  let backgroundFailedIds = new Set();
  let backgroundSelectedId = '';
  let backgroundPickerSignature = '';
  let lastLibraryScanAt = '';
  let backgroundTargetVolume = Math.max(0, Math.min(1, Number($('#playerBackgroundVolume')?.value || 0.55)));
  let mediaTargetVolume = Math.max(0, Math.min(1, Number($('#playerVolume')?.value || 1)));
  let karaokeMuted = false;
  let audioContext = null;
  let analyser = null;
  let mediaAudioGraph = null;
  let runtimeSaveTimer = 0;
  let runtimeRestoreActivityId = '';
  let pendingResumeTime = null;
  let lastRuntimeCheckpoint = 0;
  let lastStemSyncAt = 0;
  const audioSettingsKey = 'guest-star:player-audio-processing';
  let audioSettings = (() => {
    try {
      const saved = JSON.parse(localStorage.getItem(audioSettingsKey) || '{}');
      return {
        low: Math.max(-12, Math.min(12, Number(saved.low) || 0)),
        mid: Math.max(-12, Math.min(12, Number(saved.mid) || 0)),
        high: Math.max(-12, Math.min(12, Number(saved.high) || 0)),
        vocalLevel: Math.max(0, Math.min(1, Number(saved.vocalLevel) || 0)),
        stemMode: saved.stemMode === 'original' ? 'original' : 'separated'
      };
    } catch { return { low: 0, mid: 0, high: 0, vocalLevel: 0, stemMode: 'separated' }; }
  })();

  const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));

  function persistAudioSettings() {
    localStorage.setItem(audioSettingsKey, JSON.stringify(audioSettings));
  }

  function setAudioParam(parameter, value, smoothing = 0.035) {
    if (!parameter || !audioContext) return;
    const now = audioContext.currentTime;
    parameter.cancelScheduledValues(now);
    parameter.setTargetAtTime(Number(value) || 0, now, smoothing);
  }

  function applyAudioSettings() {
    if (!mediaAudioGraph) return;
    setAudioParam(mediaAudioGraph.low.gain, audioSettings.low);
    setAudioParam(mediaAudioGraph.mid.gain, audioSettings.mid);
    setAudioParam(mediaAudioGraph.high.gain, audioSettings.high);
    const stemsReady = current()?.stem?.ready === true;
    const separated = stemsReady && audioSettings.stemMode === 'separated';
    setAudioParam(mediaAudioGraph.normalGain.gain, separated ? 0 : 1, 0.025);
    setAudioParam(mediaAudioGraph.instrumentalGain.gain, separated ? 1 : 0, 0.025);
    setAudioParam(mediaAudioGraph.vocalsGain.gain, separated ? audioSettings.vocalLevel : 0, 0.025);
  }

  function renderAudioSettings() {
    for (const band of ['low', 'mid', 'high']) {
      const title = band[0].toUpperCase() + band.slice(1);
      const input = $(`#playerEq${title}`);
      const output = $(`#playerEq${title}Value`);
      if (input) input.value = String(audioSettings[band]);
      if (input) input.closest('.player-knob-shell')?.style.setProperty('--knob-angle', `${-135 + ((audioSettings[band] + 12) / 24) * 270}deg`);
      if (output) output.textContent = `${audioSettings[band] > 0 ? '+' : ''}${audioSettings[band]} dB`;
    }
    const vocal = $('#playerVocalLevel');
    if (vocal) vocal.value = String(audioSettings.vocalLevel);
    const vocalOutput = $('#playerVocalLevelValue');
    if (vocalOutput) vocalOutput.textContent = `${Math.round(audioSettings.vocalLevel * 100)}%`;
    const vocalControl = $('#playerVocalControl');
    const stemsReady = current()?.stem?.ready === true;
    if (vocalControl) vocalControl.classList.remove('hidden');
    if (vocal) vocal.disabled = !stemsReady || audioSettings.stemMode !== 'separated';
    $('#playerStemOriginal')?.classList.toggle('active', audioSettings.stemMode === 'original');
    $('#playerStemSeparated')?.classList.toggle('active', audioSettings.stemMode === 'separated');
    if ($('#playerStemSeparated')) $('#playerStemSeparated').disabled = !stemsReady;
  }

  function setScene(modeName, phase = modeName) {
    if (stageMode === modeName && scenePhase === phase) return;
    stageMode = modeName;
    scenePhase = phase;
    sceneRevision += 1;
  }

  function fadeVolume(element, target, duration = FADE_MS, valid = () => true) {
    const destination = Math.max(0, Math.min(1, Number(target) || 0));
    const origin = Math.max(0, Math.min(1, Number(element.volume) || 0));
    if (duration <= 0 || Math.abs(origin - destination) < 0.002) {
      if (valid()) element.volume = destination;
      return Promise.resolve(valid());
    }
    const startedAt = performance.now();
    return new Promise((resolve) => {
      const frame = (now) => {
        if (!valid()) { resolve(false); return; }
        const progress = Math.min(1, Math.max(0, (now - startedAt) / duration));
        const eased = 0.5 - Math.cos(Math.PI * progress) / 2;
        element.volume = origin + (destination - origin) * eased;
        if (progress < 1) requestAnimationFrame(frame);
        else resolve(true);
      };
      requestAnimationFrame(frame);
    });
  }

  function waitUntilPlayable(element, generation, timeoutMs = 3500) {
    if (element.readyState >= 3) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => finish(new Error('El archivo tardó demasiado en cargar.')), timeoutMs);
      const finish = (error) => {
        window.clearTimeout(timeout);
        element.removeEventListener('canplay', onReady);
        element.removeEventListener('error', onError);
        if (generation !== backgroundGeneration && element === backgroundAudio) reject(new Error('Carga reemplazada.'));
        else if (error) reject(error);
        else resolve();
      };
      const onReady = () => finish();
      const onError = () => finish(new Error('Formato o códec no compatible.'));
      element.addEventListener('canplay', onReady, { once: true });
      element.addEventListener('error', onError, { once: true });
    });
  }

  const activityId = () => String(state?.account?.current?.activityId || '');
  const storageKey = () => `guest-star:player-order:${activityId() || 'none'}`;
  const requestsById = () => new Map((state?.requests || []).map((item) => [String(item.id), item]));
  const mode = () => String(state?.operatingMode?.selected || '');
  const activityRunning = () => Boolean(state?.activity?.activityRunning && state?.activity?.activityStartedAt);
  const activityConfigured = () => Boolean(activityId() && state?.tenant?.activity);
  const playerPreparationReady = () => activityConfigured() && mode() === 'player';
  const playerReady = () => mode() === 'player' && activityRunning();
  const backgroundTracks = () => Array.isArray(state?.backgroundMusic?.tracks) ? state.backgroundMusic.tracks : [];

  function loadOrder() {
    const remoteOrder = state?.playerRuntime?.queueOrder;
    if (Array.isArray(remoteOrder)) {
      order = [...new Set(remoteOrder.map(String).filter(Boolean))];
      localStorage.setItem(storageKey(), JSON.stringify(order));
      return;
    }
    try { order = JSON.parse(localStorage.getItem(storageKey()) || '[]'); }
    catch { order = []; }
  }

  function saveOrder({ remote = false } = {}) {
    localStorage.setItem(storageKey(), JSON.stringify(order));
    if (remote) scheduleRuntimeSave(120);
  }

  function runtimePayload() {
    return {
      queueOrder: [...order],
      playback: {
        currentRequestId: currentId,
        currentTimeSeconds: Math.max(0, Number(media.currentTime) || 0),
        scene: stageMode === 'karaoke' ? 'karaoke' : 'lobby',
        wasPlaying: stageMode === 'karaoke' && Boolean(media.src && !media.paused && !media.ended)
      }
    };
  }

  async function persistRuntime() {
    window.clearTimeout(runtimeSaveTimer);
    runtimeSaveTimer = 0;
    if (!playerReady()) return;
    try {
      await api('/api/player/runtime', {
        method: 'POST',
        body: JSON.stringify(runtimePayload()),
        keepalive: true
      });
    } catch {
      // The local server keeps the last state and retries cloud persistence.
    }
  }

  function scheduleRuntimeSave(delay = 1200) {
    window.clearTimeout(runtimeSaveTimer);
    runtimeSaveTimer = window.setTimeout(() => void persistRuntime(), delay);
  }

  function queue() {
    const byId = requestsById();
    const active = (state?.requests || []).filter(activeRequest);
    const ids = active.map((item) => String(item.id));
    order = [...order.filter((id) => ids.includes(id)), ...ids.filter((id) => !order.includes(id))];
    saveOrder();
    return order.map((id) => byId.get(id)).filter(Boolean);
  }

  function identity() {
    const hotel = state?.tenant?.hotel || {};
    const branding = state?.tenant?.branding || {};
    const venue = state?.tenant?.venue || {};
    const activity = state?.tenant?.activity || {};
    const share = state?.tenant?.share || {};
    return {
      hotelName: hotel.name || 'Guest Star',
      venueName: venue.name || 'Venue',
      activityName: activity.name || 'Actividad actual',
      logoUrl: branding.showHotelLogo === false
        ? ''
        : normalizeBrandImageUrl(branding.hotelLogoUrl || branding.teamLogoUrl || hotel.logoUrl || hotel.logo || hotel.branding?.logoUrl || ''),
      publicUrl: share.publicUrl || ''
    };
  }

  function current() { return requestsById().get(currentId) || null; }
  function guest(item) { return [item?.singer, item?.guestAlias].filter(Boolean).join(' ') || 'Próximo cantante'; }
  function sourceForCurrent() { return currentId ? `/api/player/media/${encodeURIComponent(currentId)}` : ''; }
  function backgroundCurrent() { return backgroundTracks().find((track) => track.id === backgroundCurrentId) || null; }
  function backgroundPending() { return backgroundTracks().find((track) => track.id === backgroundPendingId) || null; }

  function playerState() {
    const info = identity();
    const request = current();
    const exactFile = request?.matches?.find((match) => match.exact)?.filePath || request?.queuedFilePath || '';
    const background = backgroundCurrent();
    return {
      ...info,
      displayMode: stageMode === 'karaoke' && request ? 'karaoke' : 'lobby',
      scene: { mode: stageMode, phase: scenePhase, revision: sceneRevision, fadeMs: FADE_MS },
      currentId,
      now: request ? {
        id: request.id,
        singer: request.singer,
        guestAlias: request.guestAlias,
        song: request.song,
        artist: request.artist,
        localAvailable: request.localAvailable,
        source: request.sourceType === 'player_local' ? 'player_local' : 'request',
        isVideo: isVideoName(exactFile)
      } : null,
      mediaUrl: sourceForCurrent(),
      playing: stageMode === 'karaoke' && Boolean(media.src && !media.paused && !media.ended),
      currentTime: media.currentTime || 0,
      duration: Number.isFinite(media.duration) ? media.duration : 0,
      volume: mediaTargetVolume,
      background: {
        track: background,
        playing: Boolean(backgroundAudio.src && !backgroundAudio.paused && !backgroundAudio.ended),
        currentTime: backgroundAudio.currentTime || 0,
        duration: Number.isFinite(backgroundAudio.duration) ? backgroundAudio.duration : 0,
        volume: backgroundTargetVolume
      },
      queue: queue().map((item) => ({
        id: item.id,
        singer: item.singer,
        guestAlias: item.guestAlias,
        song: item.song,
        artist: item.artist,
        localAvailable: item.localAvailable,
        sourceType: item.sourceType || 'guest_request'
      }))
    };
  }

  function publish() {
    if (!state) return;
    const payload = { ...playerState(), sequence: ++publishSequence, publishedAt: Date.now() };
    channel.postMessage(payload);
    localStorage.setItem('guest-star:player-state', JSON.stringify(payload));
  }

  function playerSummary() {
    const items = state?.requests || [];
    const active = items.filter(activeRequest);
    const completed = items.filter((item) => item.outcome === 'completed' || String(item.status) === 'Ya cantó');
    const skipped = items.filter((item) => ['skipped', 'removed'].includes(item.outcome) || ['Saltado', 'Retirada del Player'].includes(String(item.status)));
    const transition = (item) => Number(item.transitionSeconds) || Number(state?.activity?.transitionSeconds) || 0;
    const track = (item) => (Number(item.durationSeconds) || 240) + transition(item);
    const plannedSeconds = items.filter((item) => !skipped.includes(item)).reduce((total, item) => total + track(item), 0);
    const completedSeconds = completed.reduce((total, item) => total + track(item), 0);
    const queuedSeconds = active.filter((item) => item.localAvailable).reduce((total, item) => total + track(item), 0);
    const targetSeconds = Math.max(0, Number(state?.activitySummary?.targetSeconds) || Number(state?.activity?.activityHours) * 3600 || 0);
    const started = Date.parse(String(state?.activity?.activityStartedAt || ''));
    const finished = Date.parse(String(state?.activity?.activityFinishedAt || ''));
    const elapsedSeconds = Number.isFinite(started) ? Math.max(0, Math.floor(((Number.isFinite(finished) ? finished : Date.now()) - started) / 1000)) : 0;
    const confirmedSeconds = completedSeconds + queuedSeconds;
    const gapSeconds = Math.max(0, targetSeconds - confirmedSeconds);
    const overrunSeconds = Math.max(0, confirmedSeconds - targetSeconds);
    const coveragePercent = targetSeconds ? Math.round((confirmedSeconds / targetSeconds) * 100) : 0;
    return { active, completed, skipped, plannedSeconds, confirmedSeconds, targetSeconds, elapsedSeconds, gapSeconds, overrunSeconds, coveragePercent, eventEndsAt: Number.isFinite(started) && targetSeconds ? new Date(started + targetSeconds * 1000) : null };
  }

  function renderBranding() {
    const info = identity();
    $('#playerActivityName').textContent = info.activityName;
    $('#playerHotelName').textContent = info.hotelName;
    $('#playerShareHotel').textContent = info.hotelName;
    $('#playerShareUrl').textContent = info.publicUrl || 'La actividad todavía no tiene enlace público.';
    const logo = $('#playerHotelLogo'), fallback = $('#playerHotelFallback');
    fallback.textContent = info.hotelName.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
    if (!logo.dataset.brandEvents) {
      logo.dataset.brandEvents = '1';
      logo.addEventListener('load', () => { logo.classList.remove('hidden'); fallback.classList.add('hidden'); });
      logo.addEventListener('error', () => { logo.classList.add('hidden'); fallback.classList.remove('hidden'); });
    }
    if (!info.logoUrl) {
      logo.classList.add('hidden'); fallback.classList.remove('hidden'); logo.removeAttribute('src'); logo.dataset.brandUrl = '';
    } else if (logo.dataset.brandUrl !== info.logoUrl) {
      logo.dataset.brandUrl = info.logoUrl; logo.classList.add('hidden'); fallback.classList.remove('hidden'); logo.src = info.logoUrl;
    }
    const qr = $('#playerQr');
    try {
      if (info.publicUrl && qr.dataset.qrText !== info.publicUrl) setLocalQrImage(qr, info.publicUrl, 360);
      else if (!info.publicUrl) { qr.removeAttribute('src'); qr.dataset.qrText = ''; }
    } catch { qr.removeAttribute('src'); qr.dataset.qrText = ''; }
  }

  function renderOperations() {
    const info = identity();
    const summary = playerSummary();
    const selectedMode = mode();
    const locked = Boolean(state?.operatingMode?.locked);
    const configured = activityConfigured();
    const preparationReady = playerPreparationReady();
    const ready = playerReady();
    const accepting = state?.activity?.accepting !== false;
    const status = state?.tenant?.activity?.status || (activityRunning() ? 'in_progress' : 'ready');
    const permissions = state?.tenant?.permissions || {};
    const can = (permission) => permissions.all === true || permissions[permission] === true;

    $('#playerModeBadge').textContent = selectedMode === 'player' ? 'PLAYER INTERNO' : selectedMode === 'bridge' ? 'BRIDGE · VIRTUALDJ' : 'MODO SIN ELEGIR';
    $('#playerModeLock').textContent = !configured ? 'Selecciona una actividad para continuar' : locked ? 'Bloqueado durante esta actividad' : 'Se puede cambiar antes de iniciar';
    $('.player-mode-lock').classList.toggle('locked', locked);
    $('#playerWorkspace').classList.toggle('player-activity-unconfigured', !configured);
    $('#playerLibraryMetric').textContent = `${Number(state?.library?.count) || 0} pistas`;
    $('#playerLibraryDetail').textContent = state?.library?.error || (state?.library?.realtime ? 'Monitoreo local en vivo' : 'Biblioteca local preparada');
    $('#playerLibraryAutoState').textContent = state?.library?.scanning
      ? 'Detectando archivos nuevos…'
      : state?.library?.lastScanAt
        ? `${state?.library?.realtime ? 'Detección en vivo' : 'Detección automática'} · ${clockTime(state.library.lastScanAt)}`
        : 'Detección automática activa';
    $('#playerRequestsMetric').textContent = `${summary.active.length} ${summary.active.length === 1 ? 'solicitud' : 'solicitudes'}`;
    $('#playerRequestsDetail').textContent = state?.sheet?.error || (state?.sheet?.syncing ? 'Actualizando solicitudes…' : 'Cola del Player sincronizada');
    $('#playerEngineMetric').textContent = stageMode === 'karaoke' && media.src && !media.paused ? 'Reproduciendo' : preparationReady ? 'Preparado' : 'En espera';
    $('#playerEngineDetail').textContent = selectedMode === 'bridge' ? 'Esta actividad está configurada para VirtualDJ' : 'Video karaoke limpio en Star Screen';
    $('#playerActivityMetric').textContent = activityRunning() ? `En curso · solicitudes ${accepting ? 'abiertas' : 'cerradas'}` : configured ? 'Lista para iniciar' : 'Sin configurar';
    $('#playerActivityDetail').textContent = activityRunning() ? `Transcurrido ${formatDuration(summary.elapsedSeconds)}` : !configured ? 'Selecciona hotel, venue y actividad' : selectedMode ? 'Modo preparado para iniciar' : 'Elige Player o Bridge';
    $('#playerElapsedTime').textContent = formatDuration(summary.elapsedSeconds);
    $('#playerElapsedDetail').textContent = activityRunning() ? `${formatDuration(Math.max(0, summary.targetSeconds - summary.elapsedSeconds))} restantes según horario` : 'El reloj inicia con la actividad';
    $('#playerConfirmedTime').textContent = formatDuration(summary.confirmedSeconds);
    $('#playerConfirmedDetail').textContent = `${summary.active.filter((item) => item.localAvailable).length} en fila · ${summary.completed.length} cantadas`;
    $('#playerPlannedTime').textContent = formatDuration(summary.plannedSeconds);
    $('#playerPlannedDetail').textContent = summary.skipped.length ? `${summary.skipped.length} omitidas excluidas` : 'Las omitidas no se incluyen';
    const coverageCard = $('#playerCoverageCard');
    coverageCard.classList.remove('ok', 'warning', 'over');
    if (summary.overrunSeconds) { coverageCard.classList.add('over'); $('#playerCoverageTime').textContent = `Excede ${formatDuration(summary.overrunSeconds)}`; }
    else if (!summary.gapSeconds && summary.targetSeconds) { coverageCard.classList.add('ok'); $('#playerCoverageTime').textContent = 'Tiempo cubierto'; }
    else { coverageCard.classList.add('warning'); $('#playerCoverageTime').textContent = `${formatDuration(summary.gapSeconds)} pendiente`; }
    $('#playerCoverageDetail').textContent = `${summary.coveragePercent}% cubierto por cantadas y fila reproducible`;
    $('#playerEventEndTime').textContent = summary.eventEndsAt ? clockTime(summary.eventEndsAt) : 'Sin iniciar';
    $('#playerEventEndDetail').textContent = summary.eventEndsAt ? `Organiza la rotación para terminar a las ${clockTime(summary.eventEndsAt)}.` : 'Configura la actividad y selecciona el modo de reproducción.';
    $('#playerTenantPath').textContent = state?.tenant?.hotel ? `${info.hotelName} • ${info.venueName}` : 'SELECCIONA UNA ACTIVIDAD';
    $('#playerSelectedActivityName').textContent = info.activityName;
    $('#playerActivityHeadline').textContent = activityRunning() ? `Actividad en curso · inició ${clockTime(state.activity.activityStartedAt)}` : !configured ? 'Selecciona una actividad antes de habilitar los controles.' : selectedMode ? `Lista para iniciar en modo ${selectedMode === 'player' ? 'Player interno' : 'Bridge con VirtualDJ'}` : 'Elige el reproductor antes de iniciar.';
    $('#playerRequestsToggle').checked = accepting;
    $('#playerRequestsToggle').disabled = !state?.tenant?.activity || !can('canOpenCloseRequests');
    $('#playerRequestsToggleLabel').textContent = accepting ? 'Abiertas' : 'Cerradas';
    const primary = $('#playerPrimaryActivity');
    primary.dataset.action = status === 'in_progress' ? 'finish' : status === 'finished' ? 'start-new' : 'start';
    primary.textContent = status === 'in_progress' ? 'Finalizar actividad' : status === 'finished' ? 'Iniciar nueva actividad' : 'Iniciar actividad';
    primary.disabled = !state?.tenant?.activity || (status === 'in_progress' ? !can('canFinishActivity') : status === 'finished' ? !can('canStartNewActivity') : !can('canStartActivity'));
    $('#playerShare').disabled = !configured || !info.publicUrl;
    $('#playerSettings').disabled = !configured;
    $('#playerScan').disabled = !configured;
    $('#playerSync').disabled = !configured;
    $('#playerOpenStarScreen').disabled = !preparationReady;
    $('#playerClose').classList.toggle('hidden', activityRunning() && selectedMode === 'player');
    document.querySelectorAll('[data-player-drawer]').forEach((button) => { button.disabled = !configured; });
    $('#playerPlay').disabled = !ready || (!current() && !queue().length);
    $('#playerRestart').disabled = !ready || !current() || !media.src || transitionBusy;
    $('#playerReturn').disabled = !ready || !current() || transitionBusy;
    ['#playerSkip', '#playerComplete', '#playerRemove'].forEach((selector) => { $(selector).disabled = !ready || (!current() && !queue().length) || transitionBusy; });
    $('#playerPlay').disabled = $('#playerPlay').disabled || transitionBusy;
    const hasBackground = backgroundTracks().length > 0;
    $('#playerBackgroundToggle').disabled = !preparationReady || !hasBackground || stageMode === 'karaoke' || Boolean(backgroundTransition);
    $('#playerBackgroundNext').disabled = !preparationReady || !hasBackground || stageMode === 'karaoke' || Boolean(backgroundTransition);
    $('#playerBackgroundPlaySelected').disabled = !preparationReady || !backgroundSelectedId || stageMode === 'karaoke' || Boolean(backgroundTransition);
    const stemTarget = current() || queue()[0] || null;
    const stemQuick = $('#playerStemQuickAction');
    const stemStatus = $('#playerStemQuickStatus');
    const stemReady = stemTarget?.stem?.ready === true;
    const stemBusy = stemTarget?.stem && !stemReady && stemTarget.stem.status !== 'failed';
    if (!state?.stemEngine?.available) stemStatus.textContent = 'Motor IA no disponible';
    else if (!stemTarget) stemStatus.textContent = 'Selecciona una pista';
    else if (!stemTarget.localAvailable) stemStatus.textContent = 'Falta el archivo local';
    else if (stemReady) stemStatus.textContent = 'Instrumental y voz listos';
    else if (stemBusy) stemStatus.textContent = `${Math.round(Number(stemTarget.stem.progress) || 0)}% · ${stemTarget.stem.phase || 'Preparando'}`;
    else if (stemTarget.stem?.status === 'failed') stemStatus.textContent = 'Falló · se puede reintentar';
    else stemStatus.textContent = `${guest(stemTarget)} · lista para preparar`;
    stemQuick.textContent = stemReady ? '✓ IA lista' : stemBusy ? 'Preparando…' : stemTarget?.stem?.status === 'failed' ? '↻ Reintentar' : '✦ Preparar IA';
    stemQuick.disabled = !preparationReady || !state?.stemEngine?.available || !stemTarget?.localAvailable || stemReady || stemBusy;
  }

  function youtubeDropdown(item) {
    if (item.sourceType === 'player_local') return '';
    const links = Array.isArray(item.youtube) ? item.youtube.slice(0, 6) : [];
    const requestId = escapeHtml(item.id);
    let content = '';
    if (links.length) {
      content = `<div class="player-youtube-list">${links.map((link, index) => {
        const kind = link.resultType === 'karaoke' ? 'Karaoke con letras' : 'Lyrics con voz';
        const detail = [kind, link.channel, formatDuration(link.durationSeconds, true)].filter(Boolean).join(' · ');
        return `<article class="player-youtube-option"><span><strong>${index + 1}. ${escapeHtml(link.title || 'Versión de YouTube')}</strong><small>${escapeHtml(detail)}</small></span><div><button type="button" data-player-youtube-copy="${requestId}" data-player-youtube-url="${escapeHtml(link.url)}">Copiar</button><button type="button" data-player-youtube-open="${escapeHtml(link.url)}">Abrir ↗</button></div></article>`;
      }).join('')}</div>`;
    } else if (item.youtubeSearching) {
      content = '<div class="player-youtube-empty"><span>Buscando versiones Karaoke/Lyrics…</span></div>';
    } else {
      const message = item.youtubeSearched ? 'No se encontró una versión confiable todavía.' : 'Busca hasta seis versiones Karaoke/Lyrics.';
      content = `<div class="player-youtube-empty"><span>${message}</span><button class="player-youtube-search" type="button" data-player-youtube-search="${requestId}">${item.youtubeSearched ? 'Reintentar' : 'Buscar'}</button></div>`;
    }
    const summary = links.length ? `${links.length} ${links.length === 1 ? 'enlace' : 'enlaces'}` : item.youtubeSearching ? 'Buscando…' : 'Abrir opciones';
    return `<details class="player-queue-youtube" data-player-youtube-details="${requestId}" ${openYoutubeIds.has(String(item.id)) ? 'open' : ''}><summary>VERSIONES KARAOKE DE YOUTUBE <span>${summary}</span></summary>${content}</details>`;
  }

  function stemAction(item) {
    if (!state?.stemEngine?.available || !item.localAvailable) return '';
    if (item.stem?.ready) return '<div class="player-stem-ready">IA LISTA · instrumental + control de voz</div>';
    const retry = item.stem?.status === 'failed';
    return `<button class="player-stem-prepare" type="button" data-player-stem-prepare="${escapeHtml(item.id)}">${retry ? '↻ Reintentar instrumental IA' : '✦ Preparar instrumental IA'}</button>`;
  }

  function renderQueue() {
    const items = queue();
    const preparing = (state?.requests || []).filter((item) =>
      !terminalRequest(item) && item.stem && item.stem.status !== 'ready'
    );
    if (currentId && !items.some((item) => String(item.id) === currentId)) {
      currentId = '';
      setScene('lobby');
      media.pause();
      instrumentalAudio.pause();
      vocalsAudio.pause();
    }
    $('#playerQueueCount').textContent = String(items.length);
    let cumulativeSeconds = 0;
    const preparationHtml = preparing.length
      ? `<section class="player-stem-jobs"><strong>STEMS IA EN PREPARACIÓN</strong>${preparing.map((item) => {
        const progress = Math.max(0, Math.min(100, Math.round(Number(item.stem.progress) || 0)));
        const failed = item.stem.status === 'failed';
        return `<article><span class="player-stem-progress ${failed ? 'failed' : ''}" style="--stem-progress:${progress * 3.6}deg"><b>${failed ? '!' : `${progress}%`}</b></span><span class="player-stem-job-copy"><b>${escapeHtml(guest(item))}</b><small>${escapeHtml(item.song)} · ${escapeHtml(item.stem.phase || 'Esperando')}</small></span>${failed ? `<button type="button" data-player-stem-prepare="${escapeHtml(item.id)}">Reintentar</button>` : ''}</article>`;
      }).join('')}</section>`
      : '';
    const queueHtml = items.length
      ? items.map((item, index) => {
        const estimated = new Date(Date.now() + cumulativeSeconds * 1000);
        const duration = (Number(item.durationSeconds) || 240) + (Number(item.transitionSeconds) || Number(state?.activity?.transitionSeconds) || 0);
        cumulativeSeconds += duration;
        const comment = String(item.comment || '').trim();
        const localOwn = item.sourceType === 'player_local';
        const expanded = expandedRequestIds.has(String(item.id));
        return `<article class="player-queue-row ${String(item.id) === currentId ? 'active' : ''} ${expanded ? 'expanded' : ''}" data-player-row="${escapeHtml(item.id)}"><div class="player-queue-compact"><button class="player-queue-select" data-player-request="${escapeHtml(item.id)}"><b>#${index + 1}</b><span><strong>${escapeHtml(guest(item))}</strong><small>${escapeHtml(item.song)}${item.artist ? ` · ${escapeHtml(item.artist)}` : ''}</small></span><i class="player-local-state ${item.localAvailable ? '' : 'missing'}">${item.localAvailable ? 'LOCAL' : 'SIN ARCHIVO'}</i></button><button class="player-queue-expand" type="button" data-player-expand="${escapeHtml(item.id)}" aria-expanded="${expanded}" title="${expanded ? 'Ocultar opciones' : 'Mostrar opciones'}">⌄</button></div><div class="player-queue-details ${expanded ? '' : 'hidden'}"><div class="player-queue-meta"><em>${localOwn ? 'Agregada manualmente al Player' : `Llegada #${index + 1}`} · turno estimado ${escapeHtml(clockTime(estimated))}</em><em>${escapeHtml(item.language || 'Idioma no indicado')} · ${escapeHtml(formatDuration(duration))}</em>${comment ? `<q>${escapeHtml(comment)}</q>` : ''}</div><div class="player-queue-actions" aria-label="Acciones para ${escapeHtml(guest(item))}"><button data-player-move="-1" data-player-id="${escapeHtml(item.id)}" ${index === 0 ? 'disabled' : ''} title="Subir un turno">↑</button><button data-player-move="1" data-player-id="${escapeHtml(item.id)}" ${index === items.length - 1 ? 'disabled' : ''} title="Bajar un turno">↓</button><button data-player-row-outcome="completed" data-player-id="${escapeHtml(item.id)}" title="Marcar como ya cantó">✓</button><button data-player-row-outcome="skipped" data-player-id="${escapeHtml(item.id)}" title="Saltar cantante">↷</button><button class="danger" data-player-row-outcome="removed" data-player-id="${escapeHtml(item.id)}" title="Quitar de la fila">×</button></div>${stemAction(item)}${youtubeDropdown(item)}</div></article>`;
      }).join('')
      : '<p class="player-empty">No hay solicitudes activas en esta actividad.</p>';
    $('#playerQueue').innerHTML = `${preparationHtml}${queueHtml}`;
  }

  function renderCompleted() {
    const items = (state?.requests || []).filter(terminalRequest);
    $('#playerCompletedCount').textContent = String(items.length);
    $('#playerHistoryBadge').textContent = String(items.length);
    $('#playerCompleted').innerHTML = items.length
      ? items.map((item) => {
        const removed = item.outcome === 'removed' || item.status === 'Retirada del Player';
        const skipped = item.outcome === 'skipped' || item.status === 'Saltado';
        return `<article class="player-completed-row ${removed ? 'removed' : skipped ? 'skipped' : 'completed'}"><span>${removed ? '×' : skipped ? '−' : '✓'}</span><div><strong>${escapeHtml(guest(item))}</strong><small>${escapeHtml(item.song)}${item.artist ? ` · ${escapeHtml(item.artist)}` : ''} · ${removed ? 'Retirada' : skipped ? 'Omitida' : 'Cantada'}</small></div><button class="button ghost" data-player-undo="${escapeHtml(item.id)}">Deshacer</button></article>`;
      }).join('')
      : '<p class="player-empty">Las canciones cantadas u omitidas aparecerán aquí.</p>';
  }

  function activePlanBItems() {
    if (planBItems.length) return planBItems;
    return Array.isArray(state?.hitSuggestions) ? state.hitSuggestions : [];
  }

  function renderPlanB() {
    const items = activePlanBItems();
    $('#playerPlanBBadge').textContent = String(items.length);
    if (planBLoading) {
      $('#playerPlanB').innerHTML = '<p class="player-empty">Preparando una rotación Plan B…</p>';
      return;
    }
    $('#playerPlanB').innerHTML = items.length
      ? items.map((item, index) => {
        const youtube = Array.isArray(item.youtube) ? item.youtube[0] : null;
        const localAction = item.localAvailable && item.trackId
          ? `<button class="button primary" type="button" data-player-plan-b-assign="${index}">Asignar cantante</button>`
          : youtube
            ? `<button class="button ghost" type="button" data-player-plan-b-open="${escapeHtml(youtube.url)}">Abrir Karaoke ↗</button>`
            : `<button class="button ghost" type="button" data-player-plan-b-youtube="${index}">${item.youtubeSearching ? 'Buscando…' : 'Buscar Karaoke'}</button>`;
        return `<article class="player-plan-b-row"><span>${escapeHtml(item.language || item.list || 'Plan B')}</span><div><strong>${escapeHtml(item.song)}</strong><small>${escapeHtml(item.artist || 'Artista no indicado')}</small></div><em class="${item.localAvailable ? 'available' : ''}">${item.localAvailable ? 'LOCAL' : 'SIN ARCHIVO'}</em>${localAction}</article>`;
      }).join('')
      : '<p class="player-empty">Pulsa Balanceada, Español, English o Favoritos para preparar el Plan B.</p>';
  }

  async function drawPlanB(list) {
    if (planBLoading) return;
    planBLoading = true;
    renderPlanB();
    try {
      const data = await api('/api/rotation/draw', {
        method: 'POST',
        body: JSON.stringify({ list, count: 8 })
      });
      planBItems = data.items || [];
      showNotice(planBItems.length
        ? 'Plan B actualizado. Las pistas locales se pueden asignar directamente a un cantante.'
        : 'Esa lista todavía no tiene pistas disponibles.');
    } catch (error) { showNotice(error.message, true); }
    finally { planBLoading = false; renderPlanB(); }
  }

  async function searchPlanBYoutube(index) {
    const item = activePlanBItems()[Number(index)];
    if (!item || item.youtubeSearching) return;
    item.youtubeSearching = true;
    renderPlanB();
    try {
      const data = await api('/api/suggestions/youtube', {
        method: 'POST',
        body: JSON.stringify({ song: item.song, artist: item.artist, language: item.language, list: item.list, force: true })
      });
      item.youtube = data.items || [];
      item.youtubeSearched = true;
      showNotice(item.youtube.length ? 'Versión Karaoke encontrada para el Plan B.' : 'No se encontró una versión Karaoke confiable.');
    } catch (error) { showNotice(error.message, true); }
    finally { item.youtubeSearching = false; renderPlanB(); }
  }

  function renderNow() {
    const item = current();
    $('#playerNowSong').textContent = item?.song || 'Selecciona una canción';
    $('#playerNowSinger').textContent = item ? guest(item) : 'Star Lineup y la música de fondo permanecen activos hasta pulsar Reproducir.';
    $('#playerPlayLabel').textContent = stageMode === 'karaoke' && !media.paused ? '⏸ Pausar' : '▶ Reproducir';
    $('#playerCurrentTime').textContent = formatDuration(media.currentTime, true);
    $('#playerDuration').textContent = formatDuration(Number.isFinite(media.duration) ? media.duration : 0, true);
    $('#playerMediaStatus').textContent = transitionBusy
      ? scenePhase === 'to-karaoke' ? 'Fade a karaoke…' : 'Fade a Star Lineup…'
      : !item ? 'Motor preparado' : media.error ? 'Formato no compatible' : media.readyState >= 3 ? (stageMode === 'karaoke' ? 'Video en Star Screen' : 'Video listo · Star Lineup visible') : 'Cargando archivo local…';
  }

  function renderBackgroundPicker() {
    const tracks = backgroundTracks();
    const query = normalizeSearch($('#playerBackgroundSearch').value);
    const filtered = tracks.filter((track) => !query || normalizeSearch(`${track.song} ${track.artist} ${track.name}`).includes(query)).slice(0, 200);
    const signature = `${query}|${filtered.map((track) => track.id).join(',')}`;
    const select = $('#playerBackgroundTrackSelect');
    if (backgroundPickerSignature !== signature) {
      const preserved = backgroundSelectedId || select.value || backgroundCurrentId;
      select.innerHTML = `<option value="">${filtered.length ? 'Selecciona una canción…' : 'No hay coincidencias'}</option>${filtered.map((track) => `<option value="${escapeHtml(track.id)}">${escapeHtml(track.song || track.name)}${track.artist ? ` — ${escapeHtml(track.artist)}` : ''}</option>`).join('')}`;
      select.value = filtered.some((track) => track.id === preserved) ? preserved : '';
      backgroundSelectedId = select.value;
      backgroundPickerSignature = signature;
    }
  }

  function renderBackground() {
    const background = state?.backgroundMusic || {};
    const track = backgroundPending() || backgroundCurrent();
    const sources = Array.isArray(background.sources) ? background.sources : [];
    const configuredVolume = Math.max(0, Math.min(1, Number(background.volume ?? backgroundTargetVolume)));
    if (!$('#playerBackgroundVolume').matches(':active') && !backgroundTransition && Math.abs(configuredVolume - backgroundTargetVolume) > 0.001) backgroundTargetVolume = configuredVolume;
    $('#playerBackgroundVolume').value = String(backgroundTargetVolume);
    $('#playerBackgroundVolumeValue').textContent = `${Math.round(backgroundTargetVolume * 100)}%`;
    $('#playerBackgroundCount').textContent = `${Number(background.count) || 0} pistas`;
    $('#playerBackgroundSong').textContent = track?.song || 'Sin música configurada';
    $('#playerBackgroundArtist').textContent = track?.artist || (background.error || 'Selecciona una carpeta o un archivo de audio.');
    $('#playerBackgroundStatus').textContent = backgroundStatusOverride || (stageMode === 'karaoke'
      ? 'Pausada mientras canta el invitado'
      : backgroundTransition
        ? 'Aplicando transición suave…'
      : backgroundAudio.src && !backgroundAudio.paused
        ? `Reproduciendo aleatoriamente · ${formatDuration(backgroundAudio.currentTime, true)}`
        : track ? 'Lista para Star Lineup' : 'En espera');
    $('#playerBackgroundToggleLabel').textContent = backgroundAudio.src && !backgroundAudio.paused ? '⏸ Pausar ambiente' : '▶ Reproducir ambiente';
    $('#playerBackgroundSources').innerHTML = sources.length
      ? sources.map((source, index) => `<div class="player-background-source"><span>${escapeHtml(source)}</span><button type="button" data-background-remove="${index}" aria-label="Quitar fuente">×</button></div>`).join('')
      : '<p class="player-empty">Aún no se configuró música de fondo.</p>';
    renderBackgroundPicker();
  }

  function render() {
    if (!state) return;
    renderBranding(); renderQueue(); renderCompleted(); renderPlanB(); renderNow(); renderBackground(); renderAudioSettings(); renderOperations(); publish();
  }

  async function loadRequest(id, autoplay = false) {
    if (!playerReady()) { showNotice('Inicia la actividad en modo Player antes de reproducir.', true); return; }
    if (transitionBusy) return;
    const item = requestsById().get(String(id));
    if (!item) return;
    if (stageMode === 'karaoke' && currentId && currentId !== String(id)) await enterLobby({ clearMedia: true });
    currentId = String(id);
    setScene('lobby');
    if (!item.localAvailable) { render(); showNotice('Esta solicitud todavía no tiene un archivo local exacto.', true); return; }
    const source = `/api/player/media/${encodeURIComponent(currentId)}`;
    const expected = new URL(source, location.origin).href;
    if (media.src !== expected) { media.pause(); media.src = source; media.load(); }
    clearStemMedia();
    if (item.stem?.ready) {
      instrumentalAudio.src = `/api/player/stems/${encodeURIComponent(currentId)}/instrumental`;
      vocalsAudio.src = `/api/player/stems/${encodeURIComponent(currentId)}/vocals`;
      instrumentalAudio.load();
      vocalsAudio.load();
    }
    applyAudioSettings();
    render();
    if (autoplay) await startKaraoke();
    else await ensureBackgroundPlaying();
  }

  async function startKaraoke() {
    if (!playerReady()) { showNotice('Inicia la actividad en modo Player antes de reproducir.', true); return; }
    if (transitionBusy) return;
    if (!current()) {
      const next = queue()[0];
      if (!next) return;
      await loadRequest(next.id, false);
    }
    if (!media.src) {
      const source = sourceForCurrent();
      if (!source) return;
      media.src = source;
      media.load();
    }
    const token = ++transitionToken;
    transitionBusy = true;
    const resuming = stageMode === 'karaoke';
    ensureAudioEngine();
    setKaraokeVolume(0);
    try {
      await audioContext?.resume();
      const stemElements = current()?.stem?.ready ? [instrumentalAudio, vocalsAudio] : [];
      await Promise.all([
        waitUntilPlayable(media, backgroundGeneration, 8000),
        ...stemElements.map((element) => waitUntilPlayable(element, backgroundGeneration, 8000))
      ]);
      syncStemTimes(true);
      await Promise.all([
        media.play(),
        ...stemElements.map((element) => element.play())
      ]);
      if (token !== transitionToken) return;
      if (!resuming) {
        setScene('karaoke', 'to-karaoke');
        scheduleRuntimeSave(0);
      }
      render();
      await Promise.all([
        fadeKaraokeVolume(karaokeMuted ? 0 : mediaTargetVolume, resuming ? 360 : FADE_MS, () => token === transitionToken),
        backgroundAudio.src && !backgroundAudio.paused
          ? fadeVolume(backgroundAudio, 0, FADE_MS, () => token === transitionToken)
          : Promise.resolve(true)
      ]);
      if (token !== transitionToken) return;
      backgroundAudio.pause();
      backgroundAudio.volume = 0;
      setScene('karaoke');
      scheduleRuntimeSave(0);
      backgroundStatusOverride = '';
      render();
    } catch (error) {
      if (token === transitionToken) {
        setScene('lobby');
        render();
        await ensureBackgroundPlaying();
        showNotice(`No se pudo reproducir el video: ${error.message}`, true);
      }
    } finally {
      if (token === transitionToken) { transitionBusy = false; render(); }
    }
  }

  async function pauseKaraoke() {
    if (media.paused || transitionBusy) return;
    const token = ++transitionToken;
    transitionBusy = true;
    try {
      await fadeKaraokeVolume(0, 320, () => token === transitionToken);
      if (token === transitionToken) {
        media.pause();
        instrumentalAudio.pause();
        vocalsAudio.pause();
      }
    } finally {
      if (token === transitionToken) { transitionBusy = false; render(); }
    }
  }

  async function restartKaraoke() {
    if (!media.src || transitionBusy) return;
    const token = ++transitionToken;
    transitionBusy = true;
    const wasPlaying = !media.paused;
    try {
      if (wasPlaying) await fadeKaraokeVolume(0, 240, () => token === transitionToken);
      if (token !== transitionToken) return;
      media.currentTime = 0;
      syncStemTimes(true);
      if (wasPlaying) {
        const stemElements = current()?.stem?.ready ? [instrumentalAudio, vocalsAudio] : [];
        await Promise.all([
          waitUntilPlayable(media, backgroundGeneration, 8000),
          ...stemElements.map((element) => waitUntilPlayable(element, backgroundGeneration, 8000))
        ]);
        syncStemTimes(true);
        await Promise.all([
          media.play(),
          ...stemElements.map((element) => element.play())
        ]);
        await fadeKaraokeVolume(karaokeMuted ? 0 : mediaTargetVolume, 360, () => token === transitionToken);
      }
    } finally {
      if (token === transitionToken) { transitionBusy = false; render(); }
    }
  }

  function refillBackgroundShuffle() {
    const available = backgroundTracks().map((track) => track.id).filter((id) => !backgroundFailedIds.has(id));
    backgroundShuffle = shuffled(available);
    if (backgroundShuffle.length > 1 && backgroundShuffle[0] === lastBackgroundId) backgroundShuffle.push(backgroundShuffle.shift());
  }

  async function playNextBackground({ resetFailures = false, preferredId = '' } = {}) {
    if (!playerPreparationReady() || stageMode === 'karaoke') return;
    if (!backgroundTracks().length) { renderBackground(); return; }
    if (backgroundTransition) return backgroundTransition;
    if (resetFailures) { backgroundFailedIds.clear(); backgroundShuffle = []; }
    if (preferredId && !backgroundTracks().some((track) => track.id === preferredId)) preferredId = '';
    if (preferredId && backgroundTracks().some((track) => track.id === preferredId)) backgroundFailedIds.delete(preferredId);
    const generation = ++backgroundGeneration;
    backgroundTransition = (async () => {
      backgroundStatusOverride = 'Aplicando fade de música ambiental…';
      renderBackground();
      if (backgroundAudio.src && !backgroundAudio.paused) await fadeVolume(backgroundAudio, 0, 420, () => generation === backgroundGeneration);
      backgroundAudio.pause();
      const maximumAttempts = Math.min(backgroundTracks().length, 3);
      for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
        if (!backgroundShuffle.length || !backgroundShuffle.some((id) => backgroundTracks().some((track) => track.id === id) && !backgroundFailedIds.has(id))) refillBackgroundShuffle();
        let nextId = '';
        if (attempt === 0 && preferredId) {
          nextId = preferredId;
          backgroundShuffle = backgroundShuffle.filter((id) => id !== preferredId);
        } else {
          nextId = backgroundShuffle.shift() || '';
        }
        if (!nextId) break;
        backgroundPendingId = nextId;
        const track = backgroundPending();
        if (!track) continue;
        backgroundStatusOverride = `Preparando ${track.song || track.name || 'música ambiental'}…`;
        backgroundAudio.volume = 0;
        backgroundAudio.src = `/api/player/background/media/${encodeURIComponent(track.id)}`;
        backgroundAudio.load();
        renderBackground(); publish();
        try {
          await waitUntilPlayable(backgroundAudio, generation);
          if (generation !== backgroundGeneration || stageMode !== 'lobby') return false;
          await backgroundAudio.play();
          if (generation !== backgroundGeneration || stageMode !== 'lobby') return false;
          backgroundCurrentId = nextId;
          backgroundPendingId = '';
          lastBackgroundId = nextId;
          backgroundFailedIds.delete(nextId);
          backgroundStatusOverride = '';
          renderBackground(); publish();
          await fadeVolume(backgroundAudio, backgroundTargetVolume, FADE_MS, () => generation === backgroundGeneration && stageMode === 'lobby');
          return true;
        } catch (error) {
          if (generation !== backgroundGeneration) return false;
          if (error?.name === 'NotAllowedError') {
            backgroundStatusOverride = 'Pulsa Reproducir ambiente para autorizar el audio.';
            return false;
          }
          backgroundFailedIds.add(nextId);
          backgroundPendingId = '';
          backgroundAudio.pause();
          backgroundAudio.removeAttribute('src');
          backgroundAudio.load();
        }
      }
      backgroundCurrentId = '';
      backgroundPendingId = '';
      backgroundStatusOverride = backgroundFailedIds.size >= backgroundTracks().length
        ? 'Ningún audio ambiental pudo reproducirse. Revisa el formato y pulsa Reintentar.'
        : `${backgroundFailedIds.size} audios no pudieron abrirse. Pulsa Reintentar para probar los restantes.`;
      return false;
    })().finally(() => {
      if (generation === backgroundGeneration) {
        backgroundTransition = null;
        renderBackground(); publish(); renderOperations();
      }
    });
    return backgroundTransition;
  }

  async function ensureBackgroundPlaying() {
    if (!playerPreparationReady() || stageMode === 'karaoke' || !backgroundTracks().length) return;
    const pending = backgroundPending();
    if (!backgroundAudio.src || (!backgroundCurrent() && !pending)) return playNextBackground();
    if (backgroundAudio.paused) {
      try {
        backgroundAudio.volume = 0;
        await backgroundAudio.play();
        if (pending) {
          backgroundCurrentId = pending.id;
          backgroundPendingId = '';
          lastBackgroundId = pending.id;
          backgroundFailedIds.delete(pending.id);
        }
        backgroundStatusOverride = '';
        await fadeVolume(backgroundAudio, backgroundTargetVolume, FADE_MS, () => stageMode === 'lobby');
      } catch { backgroundStatusOverride = 'Pulsa Reproducir ambiente para activar el audio.'; renderBackground(); }
    }
  }

  async function enterLobby({ startBackground = true, clearMedia = false } = {}) {
    if (transitionBusy && scenePhase === 'to-lobby') return;
    const token = ++transitionToken;
    transitionBusy = true;
    setScene('lobby', 'to-lobby');
    render();
    const backgroundPromise = startBackground
      ? Promise.race([ensureBackgroundPlaying(), wait(FADE_MS)])
      : Promise.resolve();
    await Promise.all([
      media.src && !media.paused ? fadeKaraokeVolume(0, FADE_MS, () => token === transitionToken) : Promise.resolve(true),
      backgroundPromise
    ]);
    try {
      if (token !== transitionToken) return;
      media.pause();
      instrumentalAudio.pause();
      vocalsAudio.pause();
      setScene('lobby');
      scheduleRuntimeSave(0);
      if (clearMedia) clearPlayerMedia();
    } finally {
      if (token === transitionToken) { transitionBusy = false; render(); }
    }
  }

  async function searchLibrary({ silent = false, append = false, browseAll = false } = {}) {
    const query = $('#playerLibrarySearch').value.trim();
    const list = $('#playerLibraryList');
    const previousScroll = list.scrollTop;
    if (!append) {
      libraryOffset = 0;
      libraryTracks = [];
      libraryBrowseAll = browseAll || !query;
    }
    if (!silent) list.innerHTML = '<p class="player-empty">Buscando en la biblioteca local…</p>';
    try {
      const data = await api(`/api/player/library?query=${encodeURIComponent(query)}&offset=${libraryOffset}&limit=60&all=${libraryBrowseAll ? '1' : '0'}`);
      const tracks = data.tracks || [];
      libraryTracks = append ? [...libraryTracks, ...tracks] : tracks;
      libraryOffset = libraryTracks.length;
      libraryHasMore = data.hasMore === true;
      const signature = libraryTracks.map((track) => track.id).join('|');
      if (silent && list.dataset.resultSignature === signature) { libraryLoaded = true; return; }
      list.innerHTML = libraryTracks.length
        ? `${libraryTracks.map((track) => `<button class="player-library-row" data-library-track="${escapeHtml(track.id)}"><i class="player-library-icon">${String(track.mediaType).startsWith('video/') ? '▣' : '♫'}</i><span><strong>${escapeHtml(track.song || track.name)}</strong><small>${track.artist ? `${escapeHtml(track.artist)} · ` : ''}${escapeHtml(track.extension)} · asignar cantante</small></span></button>`).join('')}${libraryHasMore ? '<button class="button ghost player-library-more" id="playerLibraryMore" type="button">Cargar 60 más</button>' : ''}`
        : '<p class="player-empty">No se encontraron archivos con esa búsqueda.</p>';
      list.dataset.tracks = JSON.stringify(libraryTracks);
      list.dataset.resultSignature = signature;
      if (silent) list.scrollTop = previousScroll;
      libraryLoaded = true;
    } catch (error) { if (!silent) list.innerHTML = `<p class="player-empty">${escapeHtml(error.message)}</p>`; }
  }

  function openSingerAssignment(track) {
    if (!playerPreparationReady()) { showNotice('Selecciona una actividad y el modo Player antes de asignar un cantante.', true); return; }
    pendingTrack = track;
    $('#playerAssignSong').textContent = track.song || track.name || 'Pista local';
    $('#playerAssignArtist').textContent = track.artist || `${track.extension || ''} · archivo local`;
    $('#playerAssignSinger').value = '';
    const stemsOption = $('#playerAssignStemsOption');
    stemsOption.classList.remove('hidden');
    $('#playerAssignStems').disabled = state?.stemEngine?.available !== true;
    $('small', stemsOption).textContent = state?.stemEngine?.available === true
      ? 'Opcional: separa instrumental y voz antes de añadirla a Star Lineup.'
      : 'El motor Stems IA no está instalado; la pista se agregará con su audio original.';
    $('#playerAssignStems').checked = false;
    if (assignDialog.open) assignDialog.close();
    assignDialog.showModal();
    window.setTimeout(() => $('#playerAssignSinger').focus(), 30);
  }

  async function assignSinger(event) {
    event.preventDefault();
    if (!pendingTrack) return;
    const singer = $('#playerAssignSinger').value.trim();
    if (!singer) return;
    try {
      const data = await api('/api/player/local-requests', {
        method: 'POST',
        body: JSON.stringify({
          trackId: pendingTrack.id,
          singer,
          prepareStems: state?.stemEngine?.available === true && $('#playerAssignStems').checked
        })
      });
      assignDialog.close();
      pendingTrack = null;
      sync(await api('/api/state'));
      if (data.item.stem?.status && data.item.stem.status !== 'ready') {
        showNotice(`${singer} está en preparación IA y aparecerá en la fila solo cuando esté listo.`);
      } else {
        if (playerReady()) await loadRequest(data.item.id, false);
        showNotice(playerReady()
          ? `${singer} fue agregado a la fila. Star Lineup seguirá visible hasta que pulses Reproducir.`
          : `${singer} fue agregado a la fila y estará listo cuando inicies la actividad.`);
      }
    } catch (error) { showNotice(error.message, true); }
  }

  function ensureAudioEngine() {
    if (mediaAudioGraph) { applyAudioSettings(); return true; }
    try {
      const AudioEngine = window.AudioContext || window.webkitAudioContext;
      if (!AudioEngine) throw new Error('Web Audio no está disponible en este navegador.');
      audioContext = audioContext || new AudioEngine();
      const source = audioContext.createMediaElementSource(media);
      const instrumentalSource = audioContext.createMediaElementSource(instrumentalAudio);
      const vocalsSource = audioContext.createMediaElementSource(vocalsAudio);
      const bus = audioContext.createGain();
      const normalGain = audioContext.createGain();
      const instrumentalGain = audioContext.createGain();
      const vocalsGain = audioContext.createGain();
      const master = audioContext.createGain();
      source.connect(normalGain);
      normalGain.connect(bus);
      instrumentalSource.connect(instrumentalGain);
      instrumentalGain.connect(bus);
      vocalsSource.connect(vocalsGain);
      vocalsGain.connect(bus);

      const low = audioContext.createBiquadFilter();
      low.type = 'lowshelf'; low.frequency.value = 180;
      const mid = audioContext.createBiquadFilter();
      mid.type = 'peaking'; mid.frequency.value = 1100; mid.Q.value = 0.85;
      const high = audioContext.createBiquadFilter();
      high.type = 'highshelf'; high.frequency.value = 6500;
      analyser = audioContext.createAnalyser(); analyser.fftSize = 256;
      bus.connect(low); low.connect(mid); mid.connect(high); high.connect(analyser); analyser.connect(master); master.connect(audioContext.destination);
      mediaAudioGraph = {
        source, instrumentalSource, vocalsSource, bus, low, mid, high, analyser, master,
        normalGain, instrumentalGain, vocalsGain
      };
      master.gain.value = karaokeMuted ? 0 : mediaTargetVolume;
      applyAudioSettings();

      const canvas = $('#playerWaveform'), context = canvas.getContext('2d'), values = new Uint8Array(analyser.frequencyBinCount);
      const draw = () => {
        requestAnimationFrame(draw); analyser.getByteFrequencyData(values); context.clearRect(0, 0, canvas.width, canvas.height);
        const width = canvas.width / values.length;
        values.forEach((value, index) => {
          const height = Math.max(2, value / 255 * canvas.height);
          const gradient = context.createLinearGradient(0, canvas.height, 0, 0); gradient.addColorStop(0, '#ff2da9'); gradient.addColorStop(1, '#7a5cff');
          context.fillStyle = gradient; context.fillRect(index * width, canvas.height - height, Math.max(1, width - 2), height);
        });
      };
      draw();
      return true;
    } catch (error) {
      showNotice(`El navegador no pudo activar el ecualizador: ${error.message}`, true);
      return false;
    }
  }

  function setKaraokeVolume(value) {
    const level = Math.max(0, Math.min(1, Number(value) || 0));
    if (mediaAudioGraph) mediaAudioGraph.master.gain.value = level;
    else media.volume = level;
  }

  async function fadeKaraokeVolume(target, duration = FADE_MS, valid = () => true) {
    ensureAudioEngine();
    const destination = Math.max(0, Math.min(1, Number(target) || 0));
    const origin = mediaAudioGraph ? mediaAudioGraph.master.gain.value : media.volume;
    if (duration <= 0 || Math.abs(origin - destination) < 0.002) {
      if (valid()) setKaraokeVolume(destination);
      return valid();
    }
    const startedAt = performance.now();
    return new Promise((resolve) => {
      const frame = (now) => {
        if (!valid()) { resolve(false); return; }
        const progress = Math.min(1, Math.max(0, (now - startedAt) / duration));
        const eased = 0.5 - Math.cos(Math.PI * progress) / 2;
        setKaraokeVolume(origin + (destination - origin) * eased);
        if (progress < 1) requestAnimationFrame(frame);
        else resolve(true);
      };
      requestAnimationFrame(frame);
    });
  }

  function clearStemMedia() {
    for (const element of [instrumentalAudio, vocalsAudio]) {
      element.pause();
      element.removeAttribute('src');
      element.load();
    }
  }

  function pauseStemTracks() {
    instrumentalAudio.pause();
    vocalsAudio.pause();
  }

  async function resumeStemTracks() {
    if (current()?.stem?.ready !== true || media.paused || stageMode !== 'karaoke' || transitionBusy) return;
    try {
      await Promise.all([
        waitUntilPlayable(instrumentalAudio, backgroundGeneration, 8000),
        waitUntilPlayable(vocalsAudio, backgroundGeneration, 8000)
      ]);
      if (media.paused || stageMode !== 'karaoke' || transitionBusy) return;
      syncStemTimes(true);
      await Promise.all([instrumentalAudio.play(), vocalsAudio.play()]);
    } catch {
      pauseStemTracks();
    }
  }

  function syncStemTimes(force = false) {
    if (current()?.stem?.ready !== true) return;
    const now = performance.now();
    if (!force && now - lastStemSyncAt < 750) return;
    lastStemSyncAt = now;
    for (const element of [instrumentalAudio, vocalsAudio]) {
      try {
        const drift = (media.currentTime || 0) - (element.currentTime || 0);
        element.playbackRate = 1;
        if (force || Math.abs(drift) > 0.45) {
          element.currentTime = Math.max(0, media.currentTime || 0);
        }
      } catch { /* Metadata will align both tracks as soon as it is available. */ }
    }
  }

  function clearPlayerMedia() {
    intentionalMediaReset = true;
    media.pause(); media.removeAttribute('src'); media.load();
    clearStemMedia();
    window.setTimeout(() => { intentionalMediaReset = false; }, 0);
  }

  function clearBackgroundMedia() {
    intentionalBackgroundReset = true;
    backgroundAudio.pause(); backgroundAudio.removeAttribute('src'); backgroundAudio.load();
    window.setTimeout(() => { intentionalBackgroundReset = false; }, 0);
  }

  async function advance(outcome, requestedId = currentId || queue()[0]?.id) {
    const item = requestsById().get(String(requestedId));
    if (!item || !playerReady()) return;
    const wasCurrent = String(item.id) === currentId;
    if (wasCurrent && transitionBusy) return;
    if (outcome === 'skipped' && !(await confirmAction({ title: 'Saltar canción', detail: `${guest(item)} — ${item.song} quedará marcada como omitida.`, confirmLabel: 'Saltar' }))) return;
    if (outcome === 'removed' && !(await confirmAction({ title: 'Quitar de la fila', detail: `${guest(item)} — ${item.song} saldrá de esta fila. Podrás recuperarla con Deshacer.`, confirmLabel: 'Quitar' }))) return;
    if (wasCurrent) await enterLobby();
    try {
      await api(`/api/player/requests/${encodeURIComponent(item.id)}/outcome`, { method: 'POST', body: JSON.stringify({ outcome }) });
      order = order.filter((id) => id !== String(item.id));
      if (wasCurrent) { currentId = ''; clearPlayerMedia(); }
      saveOrder({ remote: true });
      sync(await api('/api/state'));
      if (!wasCurrent) render();
    } catch (error) { showNotice(error.message, true); }
  }

  function moveQueueItem(id, direction) {
    const ids = queue().map((item) => String(item.id));
    const index = ids.indexOf(String(id));
    const nextIndex = index + Number(direction);
    if (index < 0 || nextIndex < 0 || nextIndex >= ids.length) return;
    [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
    order = ids; saveOrder({ remote: true }); renderQueue(); publish();
  }

  async function returnToEnd() {
    if (!currentId || !playerReady()) return;
    const returned = currentId;
    await enterLobby();
    order = [...order.filter((id) => id !== returned), returned]; currentId = ''; saveOrder({ remote: true });
    clearPlayerMedia(); render();
  }

  async function undoOutcome(id) {
    try { await api(`/api/player/requests/${encodeURIComponent(id)}/undo`, { method: 'POST', body: '{}' }); sync(await api('/api/state')); showNotice('La canción volvió al final de la fila del Player.'); }
    catch (error) { showNotice(error.message, true); }
  }

  async function searchPlayerYoutube(id) {
    const item = requestsById().get(String(id));
    if (!item || item.sourceType === 'player_local') return;
    item.youtubeSearching = true;
    renderQueue();
    try {
      const data = await api(`/api/requests/${encodeURIComponent(id)}/youtube`, { method: 'POST', body: '{}' });
      item.youtube = data.items || [];
      item.youtubeSearched = true;
      item.youtubeSearching = false;
      renderQueue();
      showNotice(item.youtube.length ? `${item.youtube.length} versiones Karaoke disponibles.` : 'No se encontró una versión confiable todavía.');
    } catch (error) {
      item.youtubeSearching = false;
      renderQueue();
      showNotice(error.message, true);
    }
  }

  async function preparePlayerStems(id) {
    const item = requestsById().get(String(id));
    if (!item) return;
    try {
      await api(`/api/player/requests/${encodeURIComponent(id)}/stems`, {
        method: 'POST',
        body: '{}'
      });
      sync(await api('/api/state'));
      showNotice(`${guest(item)} quedó en preparación IA fuera de la fila. Entrará automáticamente cuando instrumental y voz estén validados.`);
    } catch (error) { showNotice(error.message, true); }
  }

  async function copyPlayerYoutube(id, url) {
    try {
      await api(`/api/requests/${encodeURIComponent(id)}/youtube/copy`, { method: 'POST', body: JSON.stringify({ url }) });
      showNotice('Enlace Karaoke copiado y guardado en esta solicitud.');
    } catch (error) { showNotice(error.message, true); }
  }

  async function openPlayerYoutube(url) {
    try { await api('/api/external/open', { method: 'POST', body: JSON.stringify({ url }) }); }
    catch (error) { showNotice(error.message, true); }
  }

  async function syncPlayer() {
    try { $('#playerSync').classList.add('is-loading'); sync(await api('/api/player/requests/pull', { method: 'POST', body: '{}' })); showNotice('Solicitudes públicas del Player actualizadas.'); }
    catch (error) { showNotice(error.message, true); }
    finally { $('#playerSync').classList.remove('is-loading'); }
  }

  async function chooseBackgroundSource(endpoint) {
    try {
      const next = await api(endpoint, { method: 'POST', body: '{}' });
      sync(next); backgroundShuffle = []; backgroundFailedIds.clear(); backgroundStatusOverride = '';
      showNotice('Música de fondo actualizada. Guest Star la mezclará aleatoriamente entre cantantes.');
      await ensureBackgroundPlaying();
    } catch (error) { showNotice(error.message, true); }
  }

  async function removeBackgroundSource(index) {
    const sources = [...(state?.backgroundMusic?.sources || [])];
    sources.splice(index, 1);
    try {
      const next = await api('/api/player/background/config', { method: 'POST', body: JSON.stringify({ sources }) });
      backgroundGeneration += 1; clearBackgroundMedia(); backgroundCurrentId = ''; backgroundPendingId = ''; backgroundShuffle = []; backgroundFailedIds.clear(); backgroundStatusOverride = '';
      sync(next); await ensureBackgroundPlaying();
    } catch (error) { showNotice(error.message, true); }
  }

  function open() {
    opened = true; document.body.classList.add('player-mode'); $('#playerWorkspace').classList.remove('hidden');
    render(); void ensureBackgroundPlaying();
  }

  function close({ force = false } = {}) {
    if (!force && playerReady()) {
      showNotice('La actividad está en curso en Player. Finalízala antes de salir de este modo.', true);
      return false;
    }
    closeDrawers();
    opened = false; document.body.classList.remove('player-mode'); $('#playerWorkspace').classList.add('hidden'); publish();
    return true;
  }

  function closeDrawers() {
    document.querySelectorAll('[data-player-drawer-panel].is-open').forEach((panel) => panel.classList.remove('is-open'));
    document.body.classList.remove('player-drawer-open');
  }

  function openDrawer(name) {
    closeDrawers();
    const panel = document.querySelector(`[data-player-drawer-panel="${name}"]`);
    if (!panel) return;
    panel.classList.add('is-open');
    document.body.classList.add('player-drawer-open');
    if (name === 'library') window.setTimeout(() => $('#playerLibrarySearch').focus(), 30);
  }

  function sync(next) {
    const previousActivity = activityId();
    const wasPreparationReady = playerPreparationReady();
    const previousLibraryScanAt = lastLibraryScanAt;
    state = next;
    lastLibraryScanAt = String(state?.library?.lastScanAt || '');
    if (previousActivity !== activityId()) {
      transitionToken += 1; backgroundGeneration += 1; transitionBusy = false; backgroundTransition = null;
      currentId = ''; setScene('lobby'); clearPlayerMedia(); clearBackgroundMedia();
      backgroundCurrentId = ''; backgroundPendingId = ''; backgroundShuffle = []; backgroundFailedIds.clear(); backgroundStatusOverride = ''; libraryLoaded = false; planBItems = []; loadOrder();
    }
    if (Array.isArray(state?.playerRuntime?.queueOrder)) {
      order = [...new Set(state.playerRuntime.queueOrder.map(String).filter(Boolean))];
      localStorage.setItem(storageKey(), JSON.stringify(order));
    }
    if (state?.operatingMode?.locked && mode() === 'bridge' && opened) close({ force: true });
    if (!playerReady()) {
      setScene('lobby'); media.pause(); instrumentalAudio.pause(); vocalsAudio.pause();
    }
    if (!playerPreparationReady()) backgroundAudio.pause();
    render();
    const runtimePlayback = state?.playerRuntime?.playback;
    if (playerReady() && activityId() && runtimeRestoreActivityId !== activityId()) {
      runtimeRestoreActivityId = activityId();
      const resumeId = String(runtimePlayback?.currentRequestId || '');
      if (resumeId && requestsById().has(resumeId)) {
        pendingResumeTime = Math.max(0, Number(runtimePlayback.currentTimeSeconds) || 0);
        window.setTimeout(async () => {
          await loadRequest(resumeId, false);
          showNotice(runtimePlayback.wasPlaying
            ? 'Sesión recuperada. Pulsa Reproducir para continuar desde la posición guardada.'
            : 'Sesión y posición del Player recuperadas.');
        }, 0);
      }
    }
    if (opened && libraryLoaded && lastLibraryScanAt && lastLibraryScanAt !== previousLibraryScanAt) window.setTimeout(() => void searchLibrary({ silent: true, browseAll: libraryBrowseAll }), 0);
    if ((!wasPreparationReady && playerPreparationReady()) || (playerPreparationReady() && stageMode === 'lobby' && !backgroundAudio.src)) window.setTimeout(() => void ensureBackgroundPlaying(), 0);
  }

  $('#playerQueue').addEventListener('click', (event) => {
    const expand = event.target.closest('[data-player-expand]');
    if (expand) {
      const id = String(expand.dataset.playerExpand || '');
      if (expandedRequestIds.has(id)) expandedRequestIds.delete(id);
      else expandedRequestIds.add(id);
      renderQueue();
      return;
    }
    const stemPrepare = event.target.closest('[data-player-stem-prepare]');
    if (stemPrepare) { void preparePlayerStems(stemPrepare.dataset.playerStemPrepare); return; }
    const youtubeSearch = event.target.closest('[data-player-youtube-search]');
    if (youtubeSearch) { void searchPlayerYoutube(youtubeSearch.dataset.playerYoutubeSearch); return; }
    const youtubeCopy = event.target.closest('[data-player-youtube-copy]');
    if (youtubeCopy) { void copyPlayerYoutube(youtubeCopy.dataset.playerYoutubeCopy, youtubeCopy.dataset.playerYoutubeUrl); return; }
    const youtubeOpen = event.target.closest('[data-player-youtube-open]');
    if (youtubeOpen) { void openPlayerYoutube(youtubeOpen.dataset.playerYoutubeOpen); return; }
    const move = event.target.closest('[data-player-move]');
    if (move) { moveQueueItem(move.dataset.playerId, Number(move.dataset.playerMove)); return; }
    const outcome = event.target.closest('[data-player-row-outcome]');
    if (outcome) { void advance(outcome.dataset.playerRowOutcome, outcome.dataset.playerId); return; }
    const id = event.target.closest('[data-player-request]')?.dataset.playerRequest;
    if (id) void loadRequest(id, false);
  });
  document.querySelectorAll('[data-player-drawer]').forEach((button) => {
    button.addEventListener('click', () => openDrawer(button.dataset.playerDrawer));
  });
  document.querySelectorAll('[data-player-drawer-close]').forEach((button) => {
    button.addEventListener('click', closeDrawers);
  });
  document.querySelectorAll('[data-player-plan-b-list]').forEach((button) => {
    button.addEventListener('click', () => void drawPlanB(button.dataset.playerPlanBList));
  });
  $('#playerPlanB').addEventListener('click', (event) => {
    const assign = event.target.closest('[data-player-plan-b-assign]');
    if (assign) {
      const item = activePlanBItems()[Number(assign.dataset.playerPlanBAssign)];
      if (item?.trackId) openSingerAssignment({ id: item.trackId, song: item.song, artist: item.artist, extension: 'LOCAL' });
      return;
    }
    const youtube = event.target.closest('[data-player-plan-b-youtube]');
    if (youtube) { void searchPlanBYoutube(youtube.dataset.playerPlanBYoutube); return; }
    const open = event.target.closest('[data-player-plan-b-open]');
    if (open) void openPlayerYoutube(open.dataset.playerPlanBOpen);
  });
  $('#playerQueue').addEventListener('toggle', (event) => {
    const details = event.target.closest?.('[data-player-youtube-details]');
    if (!details) return;
    if (details.open) openYoutubeIds.add(details.dataset.playerYoutubeDetails);
    else openYoutubeIds.delete(details.dataset.playerYoutubeDetails);
  }, true);
  $('#playerCompleted').addEventListener('click', (event) => { const id = event.target.closest('[data-player-undo]')?.dataset.playerUndo; if (id) void undoOutcome(id); });
  $('#playerPlay').addEventListener('click', async () => {
    if (!playerReady()) return showNotice('Inicia la actividad en modo Player antes de reproducir.', true);
    if (stageMode !== 'karaoke' || media.paused) await startKaraoke(); else await pauseKaraoke();
  });
  $('#playerRestart').addEventListener('click', () => void restartKaraoke());
  $('#playerReturn').addEventListener('click', () => void returnToEnd());
  $('#playerSkip').addEventListener('click', () => void advance('skipped'));
  $('#playerComplete').addEventListener('click', () => void advance('completed'));
  $('#playerRemove').addEventListener('click', () => void advance('removed'));
  $('#playerClose').addEventListener('click', () => close());
  $('#playerStemQuickAction').addEventListener('click', () => {
    const item = current() || queue()[0];
    if (item) void preparePlayerStems(item.id);
  });
  $('#playerStemOriginal').addEventListener('click', () => {
    audioSettings.stemMode = 'original'; persistAudioSettings(); applyAudioSettings(); renderAudioSettings();
  });
  $('#playerStemSeparated').addEventListener('click', () => {
    if (current()?.stem?.ready !== true) return;
    audioSettings.stemMode = 'separated'; persistAudioSettings(); applyAudioSettings(); renderAudioSettings();
  });
  $('#playerOpenStarScreen').addEventListener('click', async () => {
    if (!playerPreparationReady()) return showNotice('Selecciona una actividad y el modo Player antes de abrir Star Screen.', true);
    try {
      const result = await api('/api/player/star-screen/open', { method: 'POST', body: '{}' });
      showNotice(result.reused ? 'Star Screen ya está activa en la pantalla secundaria.' : 'Star Screen abierta en la pantalla secundaria. Si solo hay una pantalla, se muestra como preview 16:9.');
    } catch (error) { showNotice(error.message, true); }
  });
  $('#playerLibraryRefresh').addEventListener('click', () => void searchLibrary({ browseAll: !$('#playerLibrarySearch').value.trim() }));
  $('#playerLibrarySearch').addEventListener('keydown', (event) => { if (event.key === 'Enter') void searchLibrary({ browseAll: !event.currentTarget.value.trim() }); });
  $('#playerLibraryList').addEventListener('click', (event) => {
    if (event.target.closest('#playerLibraryMore')) { void searchLibrary({ append: true, browseAll: libraryBrowseAll }); return; }
    const id = event.target.closest('[data-library-track]')?.dataset.libraryTrack;
    if (!id) return;
    try { const tracks = JSON.parse($('#playerLibraryList').dataset.tracks || '[]'); const track = tracks.find((entry) => entry.id === id); if (track) openSingerAssignment(track); }
    catch { /* Ignore stale rows. */ }
  });
  $('#playerAssignSingerForm').addEventListener('submit', (event) => void assignSinger(event));
  const closeAssign = () => { pendingTrack = null; if (assignDialog.open) assignDialog.close(); };
  $('#playerAssignSingerClose').addEventListener('click', closeAssign);
  $('#playerAssignSingerCancel').addEventListener('click', closeAssign);
  $('#playerShare').addEventListener('click', () => operations.openShare?.());
  $('#playerSettings').addEventListener('click', () => operations.openSettings?.());
  $('#playerScan').addEventListener('click', () => operations.scanLibrary?.());
  $('#playerSync').addEventListener('click', () => void syncPlayer());
  $('#playerPrimaryActivity').addEventListener('click', () => operations.controlActivity?.($('#playerPrimaryActivity').dataset.action || 'start'));
  $('#playerRequestsToggle').addEventListener('change', (event) => operations.controlActivity?.(event.target.checked ? 'open' : 'close'));
  $('#playerMute').addEventListener('click', () => {
    karaokeMuted = !karaokeMuted;
    if (!transitionBusy && !media.paused) setKaraokeVolume(karaokeMuted ? 0 : mediaTargetVolume);
    $('#playerMute').textContent = karaokeMuted ? '🔇 Silenciado' : '🔊 Audio';
    publish();
  });
  $('#playerVolume').addEventListener('input', (event) => {
    mediaTargetVolume = Math.max(0, Math.min(1, Number(event.target.value)));
    if (mediaTargetVolume > 0) karaokeMuted = false;
    if (!transitionBusy) setKaraokeVolume(karaokeMuted ? 0 : mediaTargetVolume);
    $('#playerMute').textContent = karaokeMuted || mediaTargetVolume === 0 ? '🔇 Silenciado' : '🔊 Audio';
    publish();
  });
  for (const band of ['low', 'mid', 'high']) {
    const title = band[0].toUpperCase() + band.slice(1);
    const input = $(`#playerEq${title}`);
    const shell = input.closest('.player-knob-shell');
    const updateBand = (value) => {
      input.value = String(Math.max(-12, Math.min(12, Math.round(Number(value) || 0))));
      ensureAudioEngine();
      void audioContext?.resume();
      audioSettings[band] = Number(input.value);
      persistAudioSettings(); applyAudioSettings(); renderAudioSettings();
    };
    input.addEventListener('input', (event) => {
      updateBand(event.target.value);
    });
    let drag = null;
    shell.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      input.focus({ preventScroll: true });
      drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, value: Number(input.value) || 0 };
      shell.setPointerCapture(event.pointerId);
      shell.classList.add('dragging');
    });
    shell.addEventListener('pointermove', (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.preventDefault();
      updateBand(drag.value + ((drag.y - event.clientY) + (event.clientX - drag.x)) / 4);
    });
    const finishDrag = (event) => {
      if (!drag || drag.pointerId !== event.pointerId) return;
      drag = null;
      shell.classList.remove('dragging');
      if (shell.hasPointerCapture(event.pointerId)) shell.releasePointerCapture(event.pointerId);
    };
    shell.addEventListener('pointerup', finishDrag);
    shell.addEventListener('pointercancel', finishDrag);
    shell.addEventListener('click', (event) => event.preventDefault());
    shell.addEventListener('wheel', (event) => {
      event.preventDefault();
      updateBand((Number(input.value) || 0) + (event.deltaY < 0 ? 1 : -1));
    }, { passive: false });
    shell.addEventListener('dblclick', (event) => {
      event.preventDefault();
      updateBand(0);
    });
  }
  $('#playerEqReset').addEventListener('click', () => {
    audioSettings = { ...audioSettings, low: 0, mid: 0, high: 0 };
    persistAudioSettings(); applyAudioSettings(); renderAudioSettings();
  });
  $('#playerVocalLevel').addEventListener('input', (event) => {
    audioSettings.vocalLevel = Math.max(0, Math.min(1, Number(event.target.value) || 0));
    persistAudioSettings();
    ensureAudioEngine();
    applyAudioSettings();
    renderAudioSettings();
  });
  $('#playerBackgroundToggle').addEventListener('click', async () => {
    if (!backgroundAudio.paused) { await fadeVolume(backgroundAudio, 0, 420); backgroundAudio.pause(); }
    else if (!backgroundAudio.src || !backgroundCurrent()) await playNextBackground({ resetFailures: backgroundFailedIds.size >= backgroundTracks().length });
    else await ensureBackgroundPlaying();
  });
  $('#playerBackgroundNext').addEventListener('click', () => void playNextBackground({ resetFailures: backgroundFailedIds.size >= backgroundTracks().length }));
  $('#playerBackgroundSearch').addEventListener('input', () => { backgroundPickerSignature = ''; renderBackgroundPicker(); renderOperations(); });
  $('#playerBackgroundTrackSelect').addEventListener('change', (event) => { backgroundSelectedId = event.target.value; renderOperations(); });
  $('#playerBackgroundPlaySelected').addEventListener('click', () => {
    if (backgroundSelectedId) void playNextBackground({ preferredId: backgroundSelectedId });
  });
  $('#playerBackgroundChooseFolder').addEventListener('click', () => void chooseBackgroundSource('/api/player/background/choose-folder'));
  $('#playerBackgroundChooseFile').addEventListener('click', () => void chooseBackgroundSource('/api/player/background/choose-file'));
  $('#playerBackgroundSources').addEventListener('click', (event) => { const raw = event.target.closest('[data-background-remove]')?.dataset.backgroundRemove; if (raw !== undefined) void removeBackgroundSource(Number(raw)); });
  $('#playerBackgroundVolume').addEventListener('input', (event) => {
    backgroundTargetVolume = Math.max(0, Math.min(1, Number(event.target.value)));
    if (!backgroundTransition && !backgroundAudio.paused) backgroundAudio.volume = backgroundTargetVolume;
    $('#playerBackgroundVolumeValue').textContent = `${Math.round(backgroundTargetVolume * 100)}%`;
    publish();
  });
  $('#playerBackgroundVolume').addEventListener('change', async () => {
    try { state = await api('/api/player/background/config', { method: 'POST', body: JSON.stringify({ volume: backgroundTargetVolume }) }); renderBackground(); }
    catch (error) { showNotice(error.message, true); }
  });
  media.addEventListener('play', () => { ensureAudioEngine(); void audioContext?.resume(); renderNow(); renderOperations(); publish(); scheduleRuntimeSave(100); });
  media.addEventListener('pause', () => { pauseStemTracks(); renderNow(); renderOperations(); publish(); scheduleRuntimeSave(100); });
  media.addEventListener('waiting', pauseStemTracks);
  media.addEventListener('stalled', pauseStemTracks);
  media.addEventListener('seeking', pauseStemTracks);
  media.addEventListener('playing', () => void resumeStemTracks());
  media.addEventListener('seeked', () => { syncStemTimes(true); void resumeStemTracks(); });
  media.addEventListener('loadedmetadata', () => {
    if (pendingResumeTime !== null) {
      media.currentTime = Math.min(Math.max(0, pendingResumeTime), Math.max(0, Number(media.duration) || pendingResumeTime));
      pendingResumeTime = null;
    }
    syncStemTimes(true);
    $('#playerSeek').max = Math.floor(media.duration || 0); renderNow(); publish(); scheduleRuntimeSave(100);
  });
  media.addEventListener('canplay', () => { $('#playerMediaStatus').textContent = 'Video listo'; publish(); });
  media.addEventListener('timeupdate', () => {
    $('#playerSeek').max = Math.floor(media.duration || 0); $('#playerSeek').value = Math.floor(media.currentTime || 0); renderNow(); publish();
    syncStemTimes(false);
    if (Date.now() - lastRuntimeCheckpoint >= 10000) { lastRuntimeCheckpoint = Date.now(); scheduleRuntimeSave(500); }
  });
  media.addEventListener('ended', () => void advance('completed'));
  media.addEventListener('error', () => {
    if (intentionalMediaReset || (!media.currentSrc && !media.getAttribute('src'))) return;
    const detail = { 1: 'reproducción cancelada', 2: 'archivo no disponible', 3: 'formato o códec no compatible', 4: 'formato no compatible' }[media.error?.code] || 'error desconocido';
    transitionToken += 1; transitionBusy = false; setScene('lobby'); $('#playerMediaStatus').textContent = `Error: ${detail}`; showNotice(`El video local no pudo reproducirse: ${detail}.`, true); publish(); void ensureBackgroundPlaying();
  });
  $('#playerSeek').addEventListener('input', (event) => { media.currentTime = Number(event.target.value); publish(); scheduleRuntimeSave(150); });
  instrumentalAudio.addEventListener('loadedmetadata', () => syncStemTimes(true));
  vocalsAudio.addEventListener('loadedmetadata', () => syncStemTimes(true));
  backgroundAudio.addEventListener('play', () => { renderBackground(); publish(); });
  backgroundAudio.addEventListener('pause', () => { renderBackground(); publish(); });
  backgroundAudio.addEventListener('timeupdate', () => { renderBackground(); publish(); });
  backgroundAudio.addEventListener('ended', () => { if (!backgroundTransition && stageMode === 'lobby') void playNextBackground(); });
  backgroundAudio.addEventListener('error', () => {
    if (!backgroundTransition && !intentionalBackgroundReset && (backgroundAudio.currentSrc || backgroundAudio.getAttribute('src'))) {
      backgroundStatusOverride = 'El audio ambiental actual no es compatible. Pulsa Siguiente o Reintentar.';
      renderBackground(); publish();
    }
  });
  document.addEventListener('keydown', (event) => {
    if (opened && event.key === 'Escape' && !assignDialog.open) { closeDrawers(); return; }
    if (!opened || !event.shiftKey || event.repeat || assignDialog.open) return;
    const tag = String(event.target?.tagName || '').toLowerCase();
    if (['input', 'textarea', 'select'].includes(tag) || event.target?.isContentEditable) return;
    const actions = {
      Space: () => $('#playerPlay').click(),
      KeyR: () => $('#playerRestart').click(),
      KeyB: () => $('#playerReturn').click(),
      KeyS: () => $('#playerSkip').click(),
      KeyC: () => $('#playerComplete').click(),
      KeyX: () => $('#playerRemove').click(),
      KeyA: () => $('#playerBackgroundToggle').click(),
      KeyN: () => $('#playerBackgroundNext').click(),
      ArrowUp: () => currentId && moveQueueItem(currentId, -1),
      ArrowDown: () => currentId && moveQueueItem(currentId, 1)
    };
    const action = actions[event.code];
    if (!action) return;
    event.preventDefault(); action();
  });
  channel.addEventListener('message', (event) => { if (event.data?.type === 'request-state') publish(); });
  window.addEventListener('beforeunload', () => {
    if (!playerReady()) return;
    void fetch('/api/player/runtime', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(runtimePayload()),
      keepalive: true
    });
  });
  window.setInterval(() => { if (opened && state) renderOperations(); }, 1000);

  return { open, close, sync, isOpen: () => opened };
}
