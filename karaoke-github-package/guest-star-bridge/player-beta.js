import { setLocalQrImage } from './qr-ui.js';
import { currentHostActivityAccess } from './host-activity-access.js';
import { starScreenLifecycle, starScreenPreferences, starScreenRequestData } from './star-screen-presentation.js';
import { initCurrentSongBackground } from './player-visuals.js';
import { attachPlayerQueueUI, reorderPlayerQueue, queueStemLabel } from './player-queue-ui.js';

const $ = (selector, root = document) => root.querySelector(selector);
const activeRequest = (item) => !item?.outcome &&
  !['Ya cantó', 'Saltado', 'Retirada del Player'].includes(String(item?.status || ''));
const terminalRequest = (item) => Boolean(item?.outcome) || ['Ya cantó', 'Saltado', 'Retirada del Player'].includes(String(item?.status || ''));
const escapeHtml = (value) => String(value || '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const isVideoName = (value) => /\.(mp4|m4v|mov|webm)$/i.test(String(value || ''));
const normalizeSearch = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const FADE_MS = 760;
// A media time-stretcher is not an AudioParam: changing its rate can restart
// internal analysis. Pointer events arrive much faster than an audible control
// needs, so keep a continuous gesture below six retunes per second and always
// flush the final value when the gesture ends.
const TEMPO_APPLY_MIN_INTERVAL_MS = 180;

export function playerProgressState(currentTime, duration) {
  const total = Number(duration);
  const valid = Number.isFinite(total) && total > 0;
  if (!valid) return { valid: false, currentTime: 0, duration: 0, max: 1, value: 0, percent: 0, disabled: true };
  const current = Math.max(0, Math.min(total, Number(currentTime) || 0));
  return {
    valid: true,
    currentTime: current,
    duration: total,
    max: total,
    value: current,
    percent: (current / total) * 100,
    disabled: false
  };
}

export function playerStemMix({ stemsReady = false, vocalLevel = 0 } = {}) {
  const separated = stemsReady === true;
  return {
    normal: separated ? 0 : 1,
    instrumental: separated ? 1 : 0,
    vocals: separated ? Math.max(0, Math.min(1, Number(vocalLevel) || 0)) : 0
  };
}

export function playerQueueOrderSignature(values = []) {
  return JSON.stringify([...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))]);
}

export function pendingQueueIds(values = []) {
  return (Array.isArray(values) ? values : []).filter(activeRequest).map((item) => String(item.id || '')).filter(Boolean);
}

export function playerQueueShortcutTarget({ focusedId = '', hoveredId = '', selectedId = '', queueIds = [] } = {}) {
  const validIds = new Set((Array.isArray(queueIds) ? queueIds : []).map(String).filter(Boolean));
  return [focusedId, hoveredId, selectedId].map((value) => String(value || '')).find((id) => validIds.has(id)) || '';
}

export function playerShortcutIsEditable({ tagName = '', isContentEditable = false, withinEditable = false } = {}) {
  return ['input', 'textarea', 'select'].includes(String(tagName || '').toLowerCase()) || isContentEditable === true || withinEditable === true;
}

export function playerShortcutIsDeleteKey({ key = '', code = '' } = {}) {
  return ['Delete', 'Backspace'].includes(String(key || '')) || ['Delete', 'Backspace'].includes(String(code || ''));
}

export function playerClearQueueControl({ itemCount = 0, transitionBusy = false } = {}) {
  const empty = Math.max(0, Number(itemCount) || 0) === 0;
  return {
    disabled: empty || transitionBusy === true,
    title: empty ? 'La cola está vacía' : transitionBusy ? 'Espera a que termine la transición actual' : 'Quitar todos los turnos pendientes'
  };
}

export function movePlayerQueueOrder(values, id, direction) {
  const order = [...new Set((Array.isArray(values) ? values : []).map(String).filter(Boolean))];
  const index = order.indexOf(String(id));
  const nextIndex = index + Number(direction);
  if (index < 0 || !Number.isInteger(nextIndex) || nextIndex < 0 || nextIndex >= order.length) {
    return { order, moved: false };
  }
  [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
  return { order, moved: true };
}

export function choosePlayerQueueOrder({ remoteOrder, localOrder, pendingSignature = '' } = {}) {
  const remote = [...new Set((Array.isArray(remoteOrder) ? remoteOrder : []).map(String).filter(Boolean))];
  const local = [...new Set((Array.isArray(localOrder) ? localOrder : []).map(String).filter(Boolean))];
  const localSignature = playerQueueOrderSignature(local);
  const remoteSignature = playerQueueOrderSignature(remote);
  const pending = String(pendingSignature || '');
  if (pending && pending === localSignature && remoteSignature !== pending) {
    return { order: local, acceptedRemote: false, acknowledgedPending: false };
  }
  return {
    order: remote,
    acceptedRemote: true,
    acknowledgedPending: Boolean(pending && remoteSignature === pending)
  };
}

export function playerTrackChangeAllowed({ activeTrackId = '', targetTrackId = '', authorized = false } = {}) {
  const active = String(activeTrackId || '');
  const target = String(targetTrackId || '');
  return Boolean(target) && (authorized === true || !active);
}

export function playerStarScreenConnection({
  expected = false,
  lastHeartbeatAt = 0,
  visible = false,
  now = Date.now(),
  timeoutMs = 6500
} = {}) {
  const ageMs = Math.max(0, Number(now) - Number(lastHeartbeatAt || 0));
  const connected = expected === true && visible === true && Number(lastHeartbeatAt) > 0 && ageMs <= timeoutMs;
  return { expected: expected === true, connected, ageMs: Number(lastHeartbeatAt) > 0 ? ageMs : null };
}

export function playerAudioRecoveryAction(state) {
  if (state === 'closed') return 'closed';
  if (state === 'suspended' || state === 'interrupted') return 'resume';
  return state === 'running' ? 'ready' : 'wait';
}

export function playerAudioOutputSupported(AudioEngine, mediaDevices, nativeBridge = false) {
  return Boolean(nativeBridge || (
    AudioEngine &&
    typeof AudioEngine.prototype?.setSinkId === 'function' &&
    mediaDevices &&
    typeof mediaDevices.enumerateDevices === 'function'
  ));
}

export function normalizeAutoGainSettings(value = {}) {
  const finiteOr = (candidate, fallback) => Number.isFinite(Number(candidate)) ? Number(candidate) : fallback;
  return {
    enabled: value.enabled !== false,
    targetLufs: Math.max(-18, Math.min(-10, finiteOr(value.targetLufs, -14))),
    maxBoostDb: Math.max(0, Math.min(12, finiteOr(value.maxBoostDb, 6))),
    maxAttenuationDb: Math.max(0, Math.min(24, finiteOr(value.maxAttenuationDb, 12))),
    truePeakCeilingDbtp: Math.max(-3, Math.min(0, finiteOr(value.truePeakCeilingDbtp, -1))),
    masterDb: Math.max(-60, Math.min(0, finiteOr(value.masterDb, 0)))
  };
}

export function calculateTrackAutoGain(analysis, settings = {}) {
  const normalized = normalizeAutoGainSettings(settings);
  const loudness = Number(analysis?.integratedLufs);
  const peak = Number(analysis?.truePeakDbtp);
  if (!normalized.enabled || !Number.isFinite(loudness) || !Number.isFinite(peak)) {
    return { requiredDb: 0, peakLimitedDb: 0, appliedDb: 0, limitedByPeak: false, pending: !analysis || analysis.pending === true };
  }
  const requiredDb = normalized.targetLufs - loudness;
  const boundedLoudnessDb = Math.max(-normalized.maxAttenuationDb, Math.min(normalized.maxBoostDb, requiredDb));
  const peakLimitedDb = normalized.truePeakCeilingDbtp - peak;
  const appliedDb = Math.min(boundedLoudnessDb, peakLimitedDb);
  return { requiredDb, peakLimitedDb, appliedDb, limitedByPeak: appliedDb < boundedLoudnessDb - 0.005, pending: false };
}

export function dbToLinear(db) {
  const value = Number(db);
  return value <= -60 ? 0 : 10 ** (value / 20);
}

export function linearToDbfs(value) {
  return Math.max(-60, 20 * Math.log10(Math.max(0.001, Number(value) || 0)));
}

export function tempoRate(originalBpm, targetBpm) {
  const original = Number(originalBpm);
  const target = Number(targetBpm);
  if (!(original > 0) || !(target > 0)) return 1;
  return Math.max(0.5, Math.min(1.5, target / original));
}

export function normalizeTempoPercent(value) {
  return Math.max(50, Math.min(150, Math.round((Number(value) || 100) * 10) / 10));
}

export function applyTempoRate(element, rate) {
  const normalizedRate = Math.max(0.5, Math.min(1.5, Number(rate) || 1));
  if (!element) return normalizedRate;
  // WebKit uses the prefixed property while modern engines use preservesPitch.
  // Both keep the tempo control from becoming a hidden pitch control.
  // Do not reassign any of these values when nothing changed: assigning
  // playbackRate restarts WebKit's real-time time-stretch analysis.
  try {
    if (element.preservesPitch !== true) element.preservesPitch = true;
    if (element.webkitPreservesPitch !== true) element.webkitPreservesPitch = true;
    if (Math.abs((Number(element.playbackRate) || 1) - normalizedRate) > 0.0001) {
      element.playbackRate = normalizedRate;
    }
  } catch {
    // An unavailable media element will receive the requested rate after it
    // loads.  A tempo interaction must never interrupt the active player.
  }
  return normalizedRate;
}

export function tempoApplicationDelay({
  now = 0,
  lastAppliedAt = -Infinity,
  minimumIntervalMs = TEMPO_APPLY_MIN_INTERVAL_MS,
  immediate = false
} = {}) {
  if (immediate) return 0;
  const elapsed = Math.max(0, Number(now) - Number(lastAppliedAt));
  return Math.max(0, Math.round(Number(minimumIntervalMs) || 0) - elapsed);
}

// AVAudioEngine owns the audible clock.  WebKit receives only a gentle visual
// correction: small drift is absorbed with a bounded rate adjustment and a
// decoder-expensive seek is reserved for a real discontinuity.
export function nativeVisualSyncPlan({
  audioPosition = 0,
  visualPosition = 0,
  tempoPercent = 100,
  seeking = false,
  millisecondsSinceHardSeek = Infinity,
  hardSeekThreshold = 1.25,
  hardSeekCooldownMs = 5000
} = {}) {
  const nativePosition = Math.max(0, Number(audioPosition) || 0);
  const currentPosition = Math.max(0, Number(visualPosition) || 0);
  const baseRate = Math.max(0.5, Math.min(1.5, (Number(tempoPercent) || 100) / 100));
  const drift = nativePosition - currentPosition;
  const hardSeek = !seeking && Math.abs(drift) >= hardSeekThreshold && Number(millisecondsSinceHardSeek) >= hardSeekCooldownMs;
  const correction = Math.max(-0.015, Math.min(0.015, drift * 0.08));
  const playbackRate = hardSeek || Math.abs(drift) < 0.06
    ? baseRate
    : Math.max(0.5, Math.min(1.5, baseRate * (1 + correction)));
  return { drift, baseRate, playbackRate, seekTo: hardSeek ? nativePosition : null };
}

export function nextTempoPercent(current, direction, step = 1) {
  const increment = Math.abs(Number(step) || 1);
  return normalizeTempoPercent(normalizeTempoPercent(current) + Math.sign(Number(direction) || 0) * increment);
}

export function bpmAtTempo(originalBpm, tempoPercent = 100) {
  const bpm = Number(originalBpm);
  return bpm > 0 ? Math.round(bpm * normalizeTempoPercent(tempoPercent) / 100) : 0;
}

export function nextSemitone(current, direction) {
  return Math.max(-6, Math.min(6, Math.round(Number(current) || 0) + Math.sign(Number(direction) || 0)));
}

export function trackAnalysisIsCurrent({ generation, currentGeneration, requestId, currentRequestId } = {}) {
  return Number(generation) === Number(currentGeneration) && String(requestId || '') === String(currentRequestId || '');
}

export function embeddedBpm(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value || 0);
  const limit = Math.min(bytes.length - 11, 1024 * 1024);
  for (let index = 0; index < limit; index += 1) {
    if (bytes[index] !== 0x54 || bytes[index + 1] !== 0x42 || bytes[index + 2] !== 0x50 || bytes[index + 3] !== 0x4d) continue;
    const size = ((bytes[index + 4] << 24) >>> 0) + (bytes[index + 5] << 16) + (bytes[index + 6] << 8) + bytes[index + 7];
    if (size < 2 || size > 32 || index + 10 + size > bytes.length) continue;
    const text = String.fromCharCode(...bytes.subarray(index + 11, index + 10 + size)).replace(/\0/g, '').trim();
    const bpm = Number(text.match(/\d+(?:\.\d+)?/)?.[0]);
    if (bpm >= 30 && bpm <= 300) return Math.round(bpm);
  }
  return 0;
}

export function fadeGainForVolume(configuredVolume, targetVolume) {
  const configured = Math.max(0, Math.min(1, Number(configuredVolume) || 0));
  const target = Math.max(0, Math.min(configured, Number(targetVolume) || 0));
  return configured > 0 ? target / configured : 0;
}

const PITCH_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
export function transposeKey(key, semitones = 0) {
  const match = String(key || '').trim().match(/^([A-G])([#b]?)(m?)$/);
  if (!match) return '';
  const flatToSharp = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
  const root = flatToSharp[`${match[1]}${match[2]}`] || `${match[1]}${match[2]}`;
  const index = PITCH_NAMES_SHARP.indexOf(root);
  if (index < 0) return '';
  const shifted = PITCH_NAMES_SHARP[(index + Math.round(Number(semitones) || 0) % 12 + 12) % 12];
  return `${shifted}${match[3]}`;
}

function fftMagnitudes(input) {
  const size = input.length;
  const real = new Float64Array(size);
  const imag = new Float64Array(size);
  for (let index = 0; index < size; index += 1) real[index] = input[index] * (0.5 - 0.5 * Math.cos(2 * Math.PI * index / (size - 1)));
  for (let index = 1, reverse = 0; index < size; index += 1) {
    let bit = size >> 1;
    for (; reverse & bit; bit >>= 1) reverse ^= bit;
    reverse ^= bit;
    if (index < reverse) { [real[index], real[reverse]] = [real[reverse], real[index]]; [imag[index], imag[reverse]] = [imag[reverse], imag[index]]; }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = -2 * Math.PI / length;
    for (let offset = 0; offset < size; offset += length) {
      for (let index = 0; index < length / 2; index += 1) {
        const cosine = Math.cos(angle * index); const sine = Math.sin(angle * index);
        const even = offset + index; const odd = even + length / 2;
        const tr = real[odd] * cosine - imag[odd] * sine;
        const ti = real[odd] * sine + imag[odd] * cosine;
        real[odd] = real[even] - tr; imag[odd] = imag[even] - ti;
        real[even] += tr; imag[even] += ti;
      }
    }
  }
  return real.slice(0, size / 2).map((value, index) => Math.hypot(value, imag[index]));
}

export function analyzeAudioFeatures(samples, sampleRate) {
  const pcm = samples instanceof Float32Array ? samples : Float32Array.from(samples || []);
  const rate = Number(sampleRate) || 44100;
  if (pcm.length < rate * 2) return { bpm: null, key: '', keyConfidence: 0 };
  const hop = 256;
  const windowSize = 1024;
  const envelope = [];
  let previousEnergy = 0;
  for (let offset = 0; offset + windowSize <= pcm.length; offset += hop) {
    let energy = 0;
    for (let index = 0; index < windowSize; index += 1) energy += pcm[offset + index] * pcm[offset + index];
    energy = Math.sqrt(energy / windowSize);
    envelope.push(Math.max(0, energy - previousEnergy));
    previousEnergy = energy;
  }
  let bestBpm = 0; let bestScore = -Infinity;
  for (let bpm = 60; bpm <= 200; bpm += 1) {
    const lag = (60 * rate) / (bpm * hop);
    let score = 0;
    const first = Math.ceil(lag);
    for (let index = first; index < envelope.length; index += 1) {
      const position = index - lag; const before = Math.floor(position); const fraction = position - before;
      const delayed = envelope[before] * (1 - fraction) + (envelope[before + 1] || 0) * fraction;
      score += envelope[index] * delayed;
    }
    const normalized = score / Math.max(1, envelope.length - first);
    if (normalized > bestScore) { bestScore = normalized; bestBpm = bpm; }
  }
  if (bestBpm > 0 && bestBpm < 70) bestBpm *= 2;
  else if (bestBpm > 150) bestBpm = Math.round(bestBpm / 2);
  const envelopePeak = Math.max(...envelope);
  const validBpm = envelopePeak > 0 && envelope.filter((value) => value >= envelopePeak * 0.2).length >= 4;

  const fftSize = 4096;
  const chroma = new Float64Array(12);
  const analysisSeconds = Math.min(120, pcm.length / rate);
  const frames = Math.max(1, Math.min(180, Math.floor(analysisSeconds * 2)));
  for (let frame = 0; frame < frames; frame += 1) {
    const offset = Math.min(pcm.length - fftSize, Math.floor((pcm.length - fftSize) * frame / Math.max(1, frames - 1)));
    const magnitudes = fftMagnitudes(pcm.subarray(Math.max(0, offset), Math.max(0, offset) + fftSize));
    for (let bin = Math.ceil(55 * fftSize / rate); bin < magnitudes.length; bin += 1) {
      const frequency = bin * rate / fftSize;
      if (frequency > 1760) break;
      if (magnitudes[bin] < magnitudes[bin - 1] || magnitudes[bin] < magnitudes[bin + 1]) continue;
      const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
      chroma[(midi % 12 + 12) % 12] += Math.sqrt(magnitudes[bin]);
    }
  }
  const majorProfile = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const minorProfile = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const chromaMean = chroma.reduce((sum, value) => sum + value, 0) / 12;
  const chromaNorm = Math.sqrt(chroma.reduce((sum, value) => sum + (value - chromaMean) ** 2, 0));
  if (chromaNorm < 1e-9) return { bpm: bestScore > 0 && validBpm ? bestBpm : null, key: '', keyConfidence: 0 };
  let bestKey = ''; let bestKeyScore = -Infinity; let secondKeyScore = -Infinity;
  for (let root = 0; root < 12; root += 1) {
    for (const [profile, suffix] of [[majorProfile, ''], [minorProfile, 'm']]) {
      const profileMean = profile.reduce((sum, value) => sum + value, 0) / 12;
      const profileNorm = Math.sqrt(profile.reduce((sum, value) => sum + (value - profileMean) ** 2, 0)) || 1;
      let score = 0;
      for (let pitch = 0; pitch < 12; pitch += 1) score += (chroma[pitch] - chromaMean) * (profile[(pitch - root + 12) % 12] - profileMean);
      score /= chromaNorm * profileNorm;
      if (score > bestKeyScore) {
        secondKeyScore = bestKeyScore;
        bestKeyScore = score;
        bestKey = `${PITCH_NAMES_SHARP[root]}${suffix}`;
      } else if (score > secondKeyScore) secondKeyScore = score;
    }
  }
  // A profile correlation is only a ranking, not a calibrated probability.
  // Report a bounded margin so ambiguous major/relative-minor results remain
  // visibly low-confidence instead of being presented as certain.
  const keyConfidence = Math.max(0, Math.min(1, (bestKeyScore - secondKeyScore) / 0.25));
  return { bpm: bestScore > 0 && validBpm ? bestBpm : null, key: bestKey, keyConfidence };
}

function disconnectNode(node) {
  try { node?.disconnect(); } catch { /* A partially-built graph may not be connected yet. */ }
}

export function reconnectPlayerAudioGraph(graph) {
  if (!graph?.destination) throw new Error('The Player audio destination is unavailable.');
  const nodes = [
    graph.source, graph.instrumentalSource, graph.vocalsSource, graph.backgroundSource,
    graph.normalGain, graph.instrumentalGain, graph.vocalsGain, graph.backgroundGain, graph.backgroundFade,
    graph.bus, graph.karaokeAutoGain, graph.backgroundAutoGain, graph.pitch, graph.low, graph.mid, graph.high,
    graph.analyser, graph.master, graph.karaokeFade, graph.outputMix, graph.finalMaster, graph.outputAnalyser,
    graph.outputMeterSplitter, graph.outputAnalyserLeft, graph.outputAnalyserRight, graph.outputMeterMerger
  ];
  nodes.forEach(disconnectNode);
  graph.source.connect(graph.normalGain);
  graph.normalGain.connect(graph.bus);
  graph.instrumentalSource.connect(graph.instrumentalGain);
  graph.instrumentalGain.connect(graph.bus);
  graph.vocalsSource.connect(graph.vocalsGain);
  graph.vocalsGain.connect(graph.bus);
  graph.bus.connect(graph.karaokeAutoGain || graph.pitch || graph.low);
  if (graph.karaokeAutoGain) graph.karaokeAutoGain.connect(graph.pitch || graph.low);
  if (graph.pitch) graph.pitch.connect(graph.low);
  graph.low.connect(graph.mid);
  graph.mid.connect(graph.high);
  graph.high.connect(graph.analyser);
  graph.analyser.connect(graph.master);
  graph.master.connect(graph.karaokeFade || graph.outputMix || graph.destination);
  if (graph.karaokeFade) graph.karaokeFade.connect(graph.outputMix || graph.destination);
  graph.backgroundSource.connect(graph.backgroundAutoGain || graph.backgroundGain);
  if (graph.backgroundAutoGain) graph.backgroundAutoGain.connect(graph.backgroundGain);
  graph.backgroundGain.connect(graph.backgroundFade || graph.destination);
  if (graph.backgroundFade) graph.backgroundFade.connect(graph.outputMix || graph.destination);
  if (graph.outputMix) graph.outputMix.connect(graph.finalMaster || graph.outputAnalyser || graph.destination);
  if (graph.finalMaster) graph.finalMaster.connect(graph.outputMeterSplitter || graph.outputAnalyser || graph.destination);
  if (graph.outputMeterSplitter && graph.outputAnalyserLeft) graph.outputMeterSplitter.connect(graph.outputAnalyserLeft, 0);
  if (graph.outputMeterSplitter && graph.outputAnalyserRight) graph.outputMeterSplitter.connect(graph.outputAnalyserRight, 1);
  if (graph.outputAnalyserLeft && graph.outputMeterMerger) graph.outputAnalyserLeft.connect(graph.outputMeterMerger, 0, 0);
  if (graph.outputAnalyserRight && graph.outputMeterMerger) graph.outputAnalyserRight.connect(graph.outputMeterMerger, 0, 1);
  if (graph.outputMeterMerger) graph.outputMeterMerger.connect(graph.outputAnalyser || graph.destination);
  if (graph.outputAnalyser) graph.outputAnalyser.connect(graph.destination);
  graph.connected = true;
  return graph;
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

export function initPlayerBeta({ api, showNotice, confirmAction, diagnostics = null, operations = {} }) {
  const planBPanel = $('#playerWorkspace .player-plan-b-card');
  if (planBPanel) planBPanel.open = false;
  let media = $('#playerMedia');
  const currentSongBackground = initCurrentSongBackground({ getMedia: () => media, getSource: () => sourceForCurrent() });
  let instrumentalAudio = $('#playerInstrumentalAudio');
  let vocalsAudio = $('#playerVocalsAudio');
  let backgroundAudio = $('#playerBackgroundAudio');
  const assignDialog = $('#playerAssignSingerDialog');
  const channel = new BroadcastChannel('guest-star-player');
  let state = null;
  let currentId = '';
  let activePlaybackSession = null;
  let order = [];
  let queueVisibility = {};
  let pendingOrderSignature = '';
  let queueOrderSaveTimer = 0;
  let queueOrderSaveInFlight = false;
  let queueOrderSavePending = false;
  let pendingVisibilitySignature = '';
  const openYoutubeIds = new Set();
  const expandedRequestIds = new Set();
  let opened = false;
  let libraryLoaded = false;
  let libraryTracks = [];
  let libraryOffset = 0;
  let libraryHasMore = false;
  let libraryBrowseAll = false;
  let libraryGeneration = 0;
  let librarySearchTimer = 0;
  let libraryOpened = false;
  let libraryScanAt = '';
  let libraryRequestKey = '';
  let libraryLoading = false;
  let planBItems = [];
  let planBLoading = false;
  let planBSelectionMade = false;
  let activePlanBList = 'both';
  let pendingTrack = null;
  let stageMode = 'lobby';
  let scenePhase = 'lobby';
  let sceneRevision = 0;
  let publishSequence = 0;
  let transitionToken = 0;
  let transitionBusy = false;
  let karaokeFadeGeneration = 0;
  let backgroundFadeGeneration = 0;
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
  let pitchWorkletState = 'loading';
  let pitchWorkletPromise = null;
  let waveformFrame = 0;
  let nativeWaveformPaintAt = -Infinity;
  let audioRecoveryPromise = null;
  let audioOutputLost = false;
  let currentAudioOutputId = '';
  let lastRequestedAudioOutputId = null;
  let tempoPercent = 100;
  let karaokeTempoTimer = 0;
  let karaokeTempoLastAppliedAt = -Infinity;
  let karaokeTempoLocked = false;
  let keySemitones = 0;
  let backgroundTempoPercent = 100;
  let backgroundTempoTimer = 0;
  let backgroundTempoLastAppliedAt = -Infinity;
  let backgroundTempoLocked = false;
  let currentAnalysis = null;
  let analysisGeneration = 0;
  let backgroundAnalysis = null;
  let backgroundAnalysisGeneration = 0;
  let currentLoudness = null;
  let backgroundLoudness = null;
  let karaokeAutoGainDb = 0;
  let backgroundAutoGainDb = 0;
  let appliedMasterDb = 0;
  const gainRampGeneration = { karaoke: 0, background: 0, master: 0 };
  let outputMeterFrame = 0;
  let outputMeterSamples = { left: null, right: null };
  let outputMeterPaintAt = 0;
  let outputMeterSource = { rmsL: 0, rmsR: 0, peakL: 0, peakR: 0, receivedAt: 0 };
  let outputMeterVisual = { rmsL: 0, rmsR: 0, peakL: 0, peakR: 0, holdL: -60, holdR: -60, holdUntilL: 0, holdUntilR: 0, clipUntil: 0 };
  const analysisCache = new Map();
  const analysisTasks = new Map();
  const nativeAudioRequests = new Map();
  const nativeDeckConfigPending = new Map();
  const nativeDeckConfigTimers = new Map();
  let nativeAudioState = null;
  let nativeAudioStateReceivedAt = 0;
  let nativeKaraokeGain = mediaTargetVolume;
  let nativeBackgroundGain = backgroundTargetVolume;
  let nativeVisualSeekUntil = 0;
  let nativeVisualSeekTimer = 0;
  let nativeVisualSeekPending = false;
  let nativeVisualPlaybackExpected = false;
  let nativeVisualPlayPending = false;
  let nativeVisualPlayRetryAt = 0;
  let karaokeSeekGeneration = 0;
  let karaokeScrubPreview = null;
  let karaokeSeekPointerActive = false;
  let nativeKaraokeTransportIntent = null;
  let nativeKaraokeTransportIntentAt = -Infinity;
  let nativeBackgroundTransportIntent = null;
  let nativeBackgroundTransportIntentAt = -Infinity;
  // The transport button owns this value only while an async play/pause
  // transition is in flight.  It lets the visible state change on the same
  // click frame; media/native events then reconcile it with the real engine.
  let backgroundUiTransportIntent = null;
  let backgroundUserPaused = false;
  let nativeBackgroundWasPlaying = false;
  let nativeKaraokeClockOverride = null;
  let karaokePendingStartPosition = 0;
  // A row selection is a transport boundary, not merely a UI change.  Keep
  // this identity separate from the AVAudioEngine deck so a late metadata,
  // stem, or AVFoundation download from the former row can never become the
  // source for the newly selected video.
  let karaokeMediaGeneration = 0;
  let karaokeMediaRequestId = '';
  let nativeKaraokeDeckRequestId = '';
  let lockedStemRequestId = '';
  let nativeTransportPublishAt = -Infinity;
  let visualTransportRevision = 0;
  let nativeKaraokeWasPlaying = false;
  let nativeLastHardVisualSeekAt = -Infinity;
  let nativeAudioHealthSignature = '';
  const nativeVideoSyncMetrics = { stateEvents: 0, hardSeeks: 0, rateWrites: 0, maxDriftSeconds: 0 };
  let nativeWaveformHistory = [];
  let lockedStemEngine = '';
  let lockedStemFormat = '';
  const automaticStemRequestIds = new Set();
  let directSearchTimer = 0;
  let directSearchGeneration = 0;
  let directSearchTracks = [];
  let runtimeSaveTimer = 0;
  let runtimeRestoreActivityId = '';
  let pendingResumeTime = null;
  let lastRuntimeCheckpoint = 0;
  let lastStemSyncAt = 0;
  let starScreenExpected = false;
  let starScreenLastHeartbeatAt = 0;
  let starScreenHeartbeatVisible = false;
  let starScreenVideoHealth = null;
  const audioSettingsKey = 'guest-star:player-audio-processing';
  const autoGainSettingsKey = 'guest-star:auto-gain-v1';
  let audioSettings = (() => {
    try {
      const saved = JSON.parse(localStorage.getItem(audioSettingsKey) || '{}');
      return {
        low: Math.max(-12, Math.min(12, Number(saved.low) || 0)),
        mid: Math.max(-12, Math.min(12, Number(saved.mid) || 0)),
        high: Math.max(-12, Math.min(12, Number(saved.high) || 0)),
        vocalLevel: Math.max(0, Math.min(1, Number(saved.vocalLevel) || 0)),
        backgroundTempoPercent: normalizeTempoPercent(saved.backgroundTempoPercent),
        backgroundTempoLocked: saved.backgroundTempoLocked === true
      };
    } catch { return { low: 0, mid: 0, high: 0, vocalLevel: 0, backgroundTempoPercent: 100, backgroundTempoLocked: false }; }
  })();
  let autoGainSettings = (() => {
    try { return normalizeAutoGainSettings(JSON.parse(localStorage.getItem(autoGainSettingsKey) || '{}')); }
    catch { return normalizeAutoGainSettings(); }
  })();
  appliedMasterDb = autoGainSettings.masterDb;
  backgroundTempoPercent = audioSettings.backgroundTempoPercent;
  backgroundTempoLocked = audioSettings.backgroundTempoLocked;

  const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  const nativeAudioBridge = () => Boolean(window.webkit?.messageHandlers?.guestStarNative?.postMessage);
  const usingNativeAudio = () => nativeAudioBridge();
  window.addEventListener('gueststar:native-audio-result', (event) => {
    const detail = event.detail || {};
    const pending = nativeAudioRequests.get(String(detail.requestId || ''));
    if (!pending) return;
    nativeAudioRequests.delete(String(detail.requestId || ''));
    window.clearTimeout(pending.timeout);
    if (detail.ok === false) pending.reject(new Error(detail.error || 'La operación nativa de audio falló.'));
    else pending.resolve(detail);
  });

  function nativeAudioRequest(action, payload = {}) {
    return new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      // A video may need an AVFoundation extraction pass before it becomes an
      // audio file.  Keep the request alive long enough for a local, large
      // karaoke asset without silently falling back to WebKit audio.
      const timeout = window.setTimeout(() => { nativeAudioRequests.delete(requestId); reject(new Error('El bridge nativo de audio no respondió.')); }, 60000);
      nativeAudioRequests.set(requestId, { resolve, reject, timeout });
      window.webkit.messageHandlers.guestStarNative.postMessage({ action, requestId, ...payload });
    });
  }

  function nativeAudioCommand(action, payload = {}) {
    if (!usingNativeAudio()) return;
    window.webkit.messageHandlers.guestStarNative.postMessage({ action, ...payload });
  }

  function silenceWebKitAudio() {
    if (!usingNativeAudio()) return;
    // WKWebView still owns the video frames and metadata, but never an audible
    // track.  All four possible audio sources are rendered by AVAudioEngine.
    for (const element of [media, instrumentalAudio, vocalsAudio, backgroundAudio]) element.muted = true;
  }

  function visualRate(element, percent) {
    const rate = Math.max(0.5, Math.min(1.5, Number(percent) / 100 || 1));
    try {
      if (Math.abs((Number(element.playbackRate) || 1) - rate) > 0.003) {
        element.playbackRate = rate;
        nativeVideoSyncMetrics.rateWrites += 1;
      }
    } catch { /* The next metadata event will apply it. */ }
    return rate;
  }

  function visualRateValue(element, rate) {
    return visualRate(element, Math.max(50, Math.min(150, Number(rate) * 100)));
  }

  function nativeVisualSeekIsPending() {
    return nativeVisualSeekPending || performance.now() < nativeVisualSeekUntil;
  }

  function setVisualClockPosition(element, position) {
    nativeVisualSeekPending = true;
    nativeVisualSeekUntil = performance.now() + 1200;
    window.clearTimeout(nativeVisualSeekTimer);
    try { element.currentTime = Math.max(0, Number(position) || 0); } catch { /* Metadata may still be loading. */ }
    nativeVisualSeekTimer = window.setTimeout(() => {
      nativeVisualSeekPending = false;
      nativeVisualSeekUntil = 0;
    }, 1200);
  }

  function karaokeMediaSource(requestId = currentId) {
    const id = String(requestId || '');
    return id ? `/api/player/media/${encodeURIComponent(id)}` : '';
  }

  function karaokeStemSource(requestId, kind, engine = lockedStemEngine) {
    const id = String(requestId || '');
    const selectedEngine = String(engine || '').toLowerCase();
    if (!id || !['instrumental', 'vocals'].includes(kind) || !['spleeter', 'demucs'].includes(selectedEngine)) return '';
    return `/api/player/stems/${encodeURIComponent(id)}/${kind}?engine=${encodeURIComponent(selectedEngine)}`;
  }

  function karaokeGSXSource(requestId, engine = lockedStemEngine) {
    const id = String(requestId || '');
    const selectedEngine = String(engine || '').toLowerCase();
    if (!id || !['spleeter', 'demucs'].includes(selectedEngine)) return '';
    return `/api/player/stems/${encodeURIComponent(id)}/container?engine=${encodeURIComponent(selectedEngine)}`;
  }

  function nativeKaraokeSources(requestId = currentId) {
    const id = String(requestId || '');
    const original = absoluteMediaURL(karaokeMediaSource(id));
    // Never read currentSrc here.  WKWebView may keep the previous video's
    // resolved URL while the replacement is loading, which made its audio
    // become the native track for a newly selected row.
    if (!original) return [];
    if (!lockedStemSourceReady(id)) return [{ slot: 'original', url: original, gain: 1 }];
    if (lockedStemFormat === 'gsx') {
      return [{ slot: 'gsx', url: absoluteMediaURL(karaokeGSXSource(id)), gain: 1 }];
    }
    return [
      { slot: 'instrumental', url: absoluteMediaURL(karaokeStemSource(id, 'instrumental')), gain: 1 },
      // The source is always loaded at unity.  vocalLevel is sent separately
      // to the native vocals mixer, so a slider move changes only that real
      // channel and can never be mistaken for the master gain.
      { slot: 'vocals', url: absoluteMediaURL(karaokeStemSource(id, 'vocals')), gain: 1 }
    ].filter((source) => Boolean(source.url));
  }

  function nativeDeckIsLoaded(deck) {
    return Number((nativeAudioState?.decks || []).find((entry) => entry.deck === deck)?.sources) > 0;
  }

  function nativeDeckState(deck) {
    return (nativeAudioState?.decks || []).find((entry) => entry.deck === deck) || null;
  }

  // Native transport replies and its four-per-second status snapshots arrive
  // on separate IPC paths.  Keep a very short optimistic snapshot between
  // them so a just-paused deck cannot be announced to Star Screen as playing,
  // and a just-seeked deck cannot be announced at its old position.
  function setNativeKaraokeTransportSnapshot(position, playing) {
    const bounded = Math.max(0, Number(position) || 0);
    nativeKaraokeClockOverride = {
      position: bounded,
      playing: Boolean(playing),
      tempoPercent,
      receivedAt: performance.now()
    };
    karaokePendingStartPosition = bounded;
  }

  function setNativeKaraokeTransportIntent(playing, position) {
    nativeKaraokeTransportIntent = Boolean(playing);
    nativeKaraokeTransportIntentAt = performance.now();
    if (Number.isFinite(Number(position))) setNativeKaraokeTransportSnapshot(position, playing);
  }

  function nativeKaraokeTransportIsPlaying() {
    if (!usingNativeAudio()) return Boolean(media.src && !media.paused && !media.ended);
    // An explicit play/pause reply owns the UI for a bounded handoff window.
    // After that, the native deck is again the sole source of truth (including
    // natural end-of-track and output-device recovery).
    if (nativeKaraokeTransportIntent !== null && performance.now() - nativeKaraokeTransportIntentAt < 1250) {
      return nativeKaraokeTransportIntent;
    }
    nativeKaraokeTransportIntent = null;
    return nativeAudioState?.running === true && nativeDeckState('karaoke')?.playing === true;
  }

  function karaokeTransportIsPlaying() {
    return nativeKaraokeTransportIsPlaying();
  }

  // WKWebView may suspend a muted <audio> element whenever its window is
  // minimized or occluded.  It is metadata-only in native mode, so its paused
  // state must never be allowed to control AVAudioEngine's ambient deck.
  function backgroundEngineIsPlaying() {
    if (!usingNativeAudio()) return Boolean(backgroundAudio.src && !backgroundAudio.paused && !backgroundAudio.ended);
    if (nativeBackgroundTransportIntent !== null && performance.now() - nativeBackgroundTransportIntentAt < 1250) {
      return nativeBackgroundTransportIntent;
    }
    nativeBackgroundTransportIntent = null;
    return nativeAudioState?.running === true && nativeDeckState('background')?.playing === true;
  }

  function backgroundTransportIsPlaying() {
    return backgroundUiTransportIntent !== null ? backgroundUiTransportIntent : backgroundEngineIsPlaying();
  }

  function backgroundClockPosition() {
    const position = Number(nativeDeckState('background')?.position);
    return usingNativeAudio() && Number.isFinite(position) ? Math.max(0, position) : Math.max(0, Number(backgroundAudio.currentTime) || 0);
  }

  function backgroundClockDuration() {
    const duration = Number(nativeDeckState('background')?.duration);
    return usingNativeAudio() && duration > 0 ? duration : Math.max(0, Number(backgroundAudio.duration) || 0);
  }

  function keepNativeVideoVisualPlaying(element = media) {
    if (!usingNativeAudio() || !nativeVisualPlaybackExpected || !element.paused || element.ended || nativeVisualPlayPending) return;
    const now = performance.now();
    if (now < nativeVisualPlayRetryAt) return;
    nativeVisualPlayPending = true;
    Promise.resolve(element.play())
      .then(() => { nativeVisualPlayRetryAt = 0; })
      .catch(() => { nativeVisualPlayRetryAt = performance.now() + 1000; })
      .finally(() => { nativeVisualPlayPending = false; });
  }

  function karaokeClockPosition() {
    const deck = nativeDeckState('karaoke');
    const position = Number(deck?.position);
    if (!usingNativeAudio()) return Math.max(0, Number(media.currentTime) || 0);
    const optimistic = nativeKaraokeClockOverride;
    if (optimistic && performance.now() - optimistic.receivedAt < 1250) {
      const rate = Math.max(50, Math.min(150, Number(optimistic.tempoPercent) || tempoPercent)) / 100;
      const elapsed = optimistic.playing ? Math.max(0, (performance.now() - optimistic.receivedAt) / 1000) : 0;
      const duration = Number(deck?.duration) || Number(media.duration);
      const predicted = optimistic.position + elapsed * rate;
      return duration > 0 ? Math.min(duration, predicted) : predicted;
    }
    // A fresh AVAudioEngine reports an empty karaoke deck as position zero.
    // Keep the recovered position visible and ready for nativeAudioLoad until
    // that deck has actual files; otherwise reopening the app looks like a
    // reset and Play starts the restored song at the wrong time.
    if (!nativeDeckIsLoaded('karaoke')) return Math.max(0, Number(karaokePendingStartPosition) || 0);
    if (!Number.isFinite(position)) return Math.max(0, Number(media.currentTime) || 0);
    const elapsed = deck?.playing === true ? Math.max(0, (performance.now() - nativeAudioStateReceivedAt) / 1000) : 0;
    const predicted = position + elapsed * (Math.max(50, Math.min(150, Number(deck?.tempoPercent) || tempoPercent)) / 100);
    const duration = Number(deck?.duration);
    return duration > 0 ? Math.min(duration, predicted) : predicted;
  }

  function karaokeClockDuration() {
    const duration = Number(nativeDeckState('karaoke')?.duration);
    return usingNativeAudio() && duration > 0 ? duration : Math.max(0, Number(media.duration) || 0);
  }

  function nativeDeckConfiguration(deck, position) {
    return {
      deck,
      position: Math.max(0, Number(position) || 0),
      tempoPercent: deck === 'karaoke' ? tempoPercent : backgroundTempoPercent,
      pitchSemitones: deck === 'karaoke' ? keySemitones : 0,
      volume: deck === 'karaoke' ? nativeKaraokeGain : nativeBackgroundGain,
      autoGainDb: deck === 'karaoke' ? karaokeAutoGainDb : backgroundAutoGainDb,
      vocalLevel: deck === 'karaoke' ? audioSettings.vocalLevel : 0,
      eq: deck === 'karaoke'
        ? { low: audioSettings.low, mid: audioSettings.mid, high: audioSettings.high }
        : { low: 0, mid: 0, high: 0 }
    };
  }

  async function loadNativeDeck(deck, sources, position = 0) {
    if (!usingNativeAudio()) return null;
    silenceWebKitAudio();
    const result = await nativeAudioRequest('nativeAudioLoad', {
      ...nativeDeckConfiguration(deck, position),
      sources
    });
    recordAudio('NATIVE_AUDIO_DECK_READY', 'INFO', {
      deck,
      engine: result.engine,
      timePitch: result.timePitch,
      duration: result.duration
    });
    return result;
  }

  function flushNativeDeckConfiguration(deck) {
    window.clearTimeout(nativeDeckConfigTimers.get(deck));
    nativeDeckConfigTimers.delete(deck);
    const payload = nativeDeckConfigPending.get(deck);
    nativeDeckConfigPending.delete(deck);
    if (payload) nativeAudioCommand('nativeAudioConfigure', payload);
  }

  function configureNativeDeck(deck, values = {}, { immediate = false } = {}) {
    if (!usingNativeAudio()) return;
    const position = deck === 'karaoke' ? karaokeClockPosition() : backgroundClockPosition();
    nativeDeckConfigPending.set(deck, { ...nativeDeckConfiguration(deck, position), ...values, deck });
    if (immediate) {
      flushNativeDeckConfiguration(deck);
      return;
    }
    if (!nativeDeckConfigTimers.has(deck)) {
      nativeDeckConfigTimers.set(deck, window.setTimeout(() => flushNativeDeckConfiguration(deck), 33));
    }
  }

  function configureNativeMaster({ immediate = false } = {}) {
    if (!usingNativeAudio()) return;
    const send = () => nativeAudioCommand('nativeAudioMaster', { masterDb: appliedMasterDb });
    if (immediate) send();
    else window.setTimeout(send, 0);
  }

  async function playNativeDeck(deck, position) {
    if (!usingNativeAudio()) return;
    return nativeAudioRequest('nativeAudioPlay', { deck, position: Math.max(0, Number(position) || 0) });
  }

  async function playNativeBackgroundDeck(position) {
    if (!usingNativeAudio()) return;
    nativeBackgroundTransportIntent = true;
    nativeBackgroundTransportIntentAt = performance.now();
    const result = await playNativeDeck('background', position);
    nativeBackgroundTransportIntent = true;
    nativeBackgroundTransportIntentAt = performance.now();
    nativeBackgroundWasPlaying = true;
    return result;
  }

  async function pauseNativeBackgroundDeck() {
    if (!usingNativeAudio()) return;
    nativeBackgroundTransportIntent = false;
    nativeBackgroundTransportIntentAt = performance.now();
    const result = await nativeAudioRequest('nativeAudioPause', { deck: 'background' });
    nativeBackgroundTransportIntent = false;
    nativeBackgroundTransportIntentAt = performance.now();
    nativeBackgroundWasPlaying = false;
    return result;
  }

  function pauseNativeDeck(deck) { nativeAudioCommand('nativeAudioPause', { deck }); }
  function stopNativeDeck(deck) { nativeAudioCommand('nativeAudioStop', { deck }); }
  function seekNativeDeck(deck, position) { nativeAudioCommand('nativeAudioSeek', { deck, position: Math.max(0, Number(position) || 0) }); }

  async function pauseNativeKaraokeDeck(position) {
    if (!usingNativeAudio()) return;
    // Set this before the IPC round trip.  The native timer deliberately
    // stops when playback stops, so waiting for its next snapshot can leave a
    // visible video running with no audible audio.
    setNativeKaraokeTransportIntent(false, position);
    const result = await nativeAudioRequest('nativeAudioPause', { deck: 'karaoke' });
    setNativeKaraokeTransportIntent(false, Number(result.position ?? position));
  }

  function cancelPendingKaraokeSeek() {
    karaokeSeekGeneration += 1;
    karaokeScrubPreview = null;
    karaokeSeekPointerActive = false;
  }

  async function seekKaraokeTransport(position) {
    const target = Math.max(0, Math.min(karaokeClockDuration() || Infinity, Number(position) || 0));
    const requestedAt = performance.now();
    const generation = ++karaokeSeekGeneration;
    const mediaGeneration = karaokeMediaGeneration;
    const requestId = currentId;
    karaokeScrubPreview = target;
    recordAudio('SEEK_REQUEST', 'INFO', { position: target, trackId: requestId });
    renderNow();
    try {
      const result = usingNativeAudio() && nativeKaraokeDeckRequestId === requestId && nativeDeckIsLoaded('karaoke')
        ? await nativeAudioRequest('nativeAudioSeek', { deck: 'karaoke', position: target, revision: generation })
        : { position: target };
      if (generation !== karaokeSeekGeneration || mediaGeneration !== karaokeMediaGeneration || requestId !== currentId) return;
      const committed = Number(result.position ?? target);
      setVisualClockPosition(media, committed);
      if (usingNativeAudio()) setNativeKaraokeTransportSnapshot(committed, karaokeTransportIsPlaying());
      visualTransportRevision += 1;
      karaokeScrubPreview = null;
      recordAudio('SEEK_COMPLETE', 'INFO', { position: committed, roundTripMs: Math.round(performance.now() - requestedAt), trackId: requestId });
      renderNow();
      publish();
      scheduleRuntimeSave(0);
    } catch (error) {
      if (generation === karaokeSeekGeneration) {
        karaokeScrubPreview = null;
        renderNow();
        showNotice(`No se pudo cambiar la posición: ${error.message}`, true);
      }
    }
  }

  function publishNativeTransportUpdate() {
    const now = performance.now();
    if (now - nativeTransportPublishAt < 250) return;
    nativeTransportPublishAt = now;
    renderNow();
    publish();
    if (Date.now() - lastRuntimeCheckpoint >= 10000) {
      lastRuntimeCheckpoint = Date.now();
      scheduleRuntimeSave(500);
    }
  }

  window.addEventListener('gueststar:native-audio-state', (event) => {
    nativeAudioState = event.detail || null;
    nativeAudioStateReceivedAt = performance.now();
    if (!nativeAudioState) return;
    if (nativeAudioState.error) {
      recordAudio('NATIVE_AUDIO_ENGINE_ERROR', 'ERROR', { message: nativeAudioState.error });
      diagnostics?.setHealth?.('Audio', 'ERROR', { engine: 'AVAudioEngine', message: nativeAudioState.error });
      nativeKaraokeTransportIntent = null;
      nativeVisualPlaybackExpected = false;
      renderNow();
      publish();
      return;
    }
    const healthSignature = `${nativeAudioState.running ? 'OK' : 'RECOVERING'}:${nativeAudioState.timePitchNodeCount || 0}`;
    if (healthSignature !== nativeAudioHealthSignature) {
      nativeAudioHealthSignature = healthSignature;
      diagnostics?.setHealth?.('Audio', nativeAudioState.running ? 'OK' : 'RECOVERING', {
        engine: nativeAudioState.engine || 'AVAudioEngine',
        timePitchNodes: nativeAudioState.timePitchNodeCount || 0
      });
    }
    nativeVideoSyncMetrics.stateEvents += 1;
    for (const deck of Array.isArray(nativeAudioState.decks) ? nativeAudioState.decks : []) {
      const element = deck.deck === 'karaoke' ? media : deck.deck === 'background' ? backgroundAudio : null;
      if (!element || !Number.isFinite(Number(deck.position))) continue;
      if (deck.deck === 'karaoke') {
        nativeWaveformHistory.push(Math.max(0, Math.min(1, Number(deck.meter) || 0)));
        if (nativeWaveformHistory.length > 96) nativeWaveformHistory = nativeWaveformHistory.slice(-96);
      }
      // Background has no visual surface to correct. Its HTML element is a
      // metadata mirror only; native transport must survive WebKit suspension
      // while the app is hidden or not key.
      if (deck.deck !== 'karaoke') {
        if (usingNativeAudio()) {
          if (nativeBackgroundTransportIntent !== null && deck.playing === nativeBackgroundTransportIntent) {
            nativeBackgroundTransportIntent = null;
          }
          const playing = backgroundTransportIsPlaying();
          const endedNaturally = nativeBackgroundWasPlaying && !playing &&
            Number(deck.duration) > 0 && Number(deck.position) >= Number(deck.duration) - 0.08 &&
            stageMode === 'lobby' && !backgroundTransition;
          nativeBackgroundWasPlaying = playing;
          if (endedNaturally) void playNextBackground();
        } else visualRate(element, deck.tempoPercent);
        continue;
      }
      // The Player element is intentionally hidden; Star Screen is the single
      // WebKit video decoder.  Keeping this second element playing consumed a
      // full additional decode pipeline and competed with visible frames.
      // AVAudioEngine remains the clock, while the visible follower receives
      // transport snapshots below.
      if (usingNativeAudio()) {
        if (!element.paused) element.pause();
        const reportedPlaying = deck.playing === true;
        if (nativeKaraokeTransportIntent !== null) {
          if (reportedPlaying === nativeKaraokeTransportIntent || performance.now() - nativeKaraokeTransportIntentAt >= 1250) {
            nativeKaraokeTransportIntent = null;
          }
        }
        const playing = nativeKaraokeTransportIsPlaying();
        const endedNaturally = nativeKaraokeWasPlaying && !playing &&
          Number(deck.duration) > 0 && Number(deck.position) >= Number(deck.duration) - 0.08 &&
          stageMode === 'karaoke' && Boolean(currentId) && !transitionBusy;
        nativeKaraokeWasPlaying = playing;
        if (endedNaturally) {
          nativeVisualPlaybackExpected = false;
          void advance('completed');
        } else if (playing) {
          publishNativeTransportUpdate();
        } else {
          // This is the confirming status event for a pause or a seek while
          // paused.  Publish it once, since the native timer will not run
          // again while both decks are stopped.
          renderNow();
          publish();
        }
        continue;
      }
      const plan = nativeVisualSyncPlan({
        audioPosition: deck.position,
        visualPosition: element.currentTime,
        tempoPercent: deck.tempoPercent,
        seeking: element.seeking || nativeVisualSeekIsPending(),
        millisecondsSinceHardSeek: performance.now() - nativeLastHardVisualSeekAt
      });
      nativeVideoSyncMetrics.maxDriftSeconds = Math.max(nativeVideoSyncMetrics.maxDriftSeconds, Math.abs(plan.drift));
      if (plan.seekTo !== null) {
        nativeLastHardVisualSeekAt = performance.now();
        nativeVideoSyncMetrics.hardSeeks += 1;
        setVisualClockPosition(element, plan.seekTo);
      }
      visualRateValue(element, plan.playbackRate);
      if (deck.playing === true) keepNativeVideoVisualPlaying(element);
    }
  });

  window.addEventListener('gueststar:native-output-meter', (event) => {
    const detail = event.detail || {};
    outputMeterSource = {
      rmsL: Math.max(0, Number(detail.rmsL) || 0),
      rmsR: Math.max(0, Number(detail.rmsR) || 0),
      peakL: Math.max(0, Number(detail.peakL) || 0),
      peakR: Math.max(0, Number(detail.peakR) || 0),
      receivedAt: performance.now()
    };
  });

  function readWebOutputMeter() {
    const fallback = mediaAudioGraph?.outputAnalyser;
    const left = mediaAudioGraph?.outputAnalyserLeft || fallback;
    const right = mediaAudioGraph?.outputAnalyserRight || fallback;
    if (!left || !right) return { rmsL: 0, rmsR: 0, peakL: 0, peakR: 0 };
    const read = (node, side) => {
      if (!outputMeterSamples[side] || outputMeterSamples[side].length !== node.fftSize) {
        outputMeterSamples[side] = new Float32Array(node.fftSize);
      }
      node.getFloatTimeDomainData(outputMeterSamples[side]);
      let energy = 0; let peak = 0;
      for (const sample of outputMeterSamples[side]) { energy += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
      return { rms: Math.sqrt(energy / outputMeterSamples[side].length), peak };
    };
    const l = read(left, 'left');
    const r = read(right, 'right');
    return { rmsL: l.rms, rmsR: r.rms, peakL: l.peak, peakR: r.peak };
  }

  function meterPercent(linear) {
    return Math.max(0, Math.min(100, ((linearToDbfs(linear) + 60) / 60) * 100));
  }

  function startOutputMeter() {
    if (outputMeterFrame) return;
    const paint = (now) => {
      outputMeterFrame = requestAnimationFrame(paint);
      if (now - outputMeterPaintAt < 30) return;
      const elapsed = Math.max(0.03, (now - outputMeterPaintAt) / 1000);
      outputMeterPaintAt = now;
      const source = usingNativeAudio() && now - outputMeterSource.receivedAt < 500
        ? outputMeterSource
        : readWebOutputMeter();
      const decay = Math.exp(-elapsed * 5.5);
      for (const side of ['L', 'R']) {
        const rmsKey = `rms${side}`; const peakKey = `peak${side}`; const holdKey = `hold${side}`; const untilKey = `holdUntil${side}`;
        outputMeterVisual[rmsKey] = Math.max(source[rmsKey], outputMeterVisual[rmsKey] * decay);
        outputMeterVisual[peakKey] = Math.max(source[peakKey], outputMeterVisual[peakKey] * Math.exp(-elapsed * 9));
        const peakDb = linearToDbfs(source[peakKey]);
        if (peakDb >= outputMeterVisual[holdKey] || now >= outputMeterVisual[untilKey]) {
          outputMeterVisual[holdKey] = peakDb;
          outputMeterVisual[untilKey] = now + 1600;
        }
        const fill = $(`#playerMeter${side}Fill`);
        const marker = $(`#playerMeter${side}Peak`);
        const value = $(`#playerMeter${side}Value`);
        if (fill) fill.style.height = `${meterPercent(outputMeterVisual[rmsKey])}%`;
        if (marker) marker.style.bottom = `${Math.max(0, Math.min(100, ((outputMeterVisual[holdKey] + 60) / 60) * 100))}%`;
        if (value) value.textContent = linearToDbfs(outputMeterVisual[peakKey]).toFixed(1);
        if (source[peakKey] >= 1) outputMeterVisual.clipUntil = now + 3000;
      }
      $('#playerMasterClip')?.classList.toggle('is-clipping', now < outputMeterVisual.clipUntil);
    };
    outputMeterFrame = requestAnimationFrame(paint);
  }

  function analyzeOffThread(samples, sampleRate) {
    if (typeof Worker !== 'function') return Promise.resolve(analyzeAudioFeatures(samples, sampleRate));
    return new Promise((resolve, reject) => {
      const worker = new Worker('/audio-analysis-worker.js', { type: 'module' });
      const timeout = window.setTimeout(() => { worker.terminate(); reject(new Error('El análisis de audio excedió el tiempo disponible.')); }, 30000);
      worker.addEventListener('message', (event) => { window.clearTimeout(timeout); worker.terminate(); event.data?.error ? reject(new Error(event.data.error)) : resolve(event.data); }, { once: true });
      worker.addEventListener('error', (event) => { window.clearTimeout(timeout); worker.terminate(); reject(new Error(event.message || 'El analizador de audio falló.')); }, { once: true });
      worker.postMessage({ samples: samples.buffer, sampleRate }, [samples.buffer]);
    });
  }

  function paintRange(input) {
    if (!input) return;
    const minimum = Number(input.min) || 0;
    const maximum = Number(input.max) || 0;
    const value = Math.max(minimum, Math.min(maximum || minimum, Number(input.value) || 0));
    const progress = maximum > minimum ? ((value - minimum) / (maximum - minimum)) * 100 : 0;
    input.style.setProperty('--range-progress', `${progress}%`);
  }

  function renderKaraokeVolume() {
    const volume = $('#playerVolume');
    if (!volume) return;
    volume.value = String(mediaTargetVolume);
    paintRange(volume);
    const output = $('#playerVolumeValue');
    if (output) output.textContent = `${Math.round(mediaTargetVolume * 100)}%`;
  }

  function persistAudioSettings() {
    localStorage.setItem(audioSettingsKey, JSON.stringify(audioSettings));
  }

  function persistAutoGainSettings() {
    localStorage.setItem(autoGainSettingsKey, JSON.stringify(autoGainSettings));
  }

  function renderAutoGainSettings() {
    const values = {
      preferenceAutoGain: autoGainSettings.enabled,
      preferenceTargetLufs: autoGainSettings.targetLufs,
      preferenceMaxBoost: autoGainSettings.maxBoostDb,
      preferenceMaxAttenuation: autoGainSettings.maxAttenuationDb,
      preferenceTruePeakCeiling: autoGainSettings.truePeakCeilingDbtp,
      playerMasterVolume: autoGainSettings.masterDb
    };
    for (const [id, value] of Object.entries(values)) {
      const control = $(`#${id}`);
      if (!control) continue;
      if (control.type === 'checkbox') control.checked = Boolean(value);
      else control.value = String(value);
      if (control.type === 'range') paintRange(control);
    }
    const labels = {
      preferenceTargetLufsValue: `${autoGainSettings.targetLufs.toFixed(1)} LUFS`,
      preferenceMaxBoostValue: `+${autoGainSettings.maxBoostDb.toFixed(1)} dB`,
      preferenceMaxAttenuationValue: `−${autoGainSettings.maxAttenuationDb.toFixed(1)} dB`,
      preferenceTruePeakCeilingValue: `${autoGainSettings.truePeakCeilingDbtp.toFixed(1)} dBTP`,
      playerMasterVolumeValue: autoGainSettings.masterDb <= -59.5 ? '−∞' : `${autoGainSettings.masterDb.toFixed(1)} dB`
    };
    for (const [id, value] of Object.entries(labels)) if ($(`#${id}`)) $(`#${id}`).textContent = value;
    const karaokeReadout = $('#playerKaraokeAutoGain');
    if (karaokeReadout) karaokeReadout.textContent = currentLoudness?.pending ? 'AUTO pendiente' : `AUTO ${karaokeAutoGainDb >= 0 ? '+' : ''}${karaokeAutoGainDb.toFixed(1)} dB`;
    const backgroundReadout = $('#playerBackgroundAutoGain');
    if (backgroundReadout) backgroundReadout.textContent = backgroundLoudness?.pending ? 'AUTO pendiente' : `AUTO ${backgroundAutoGainDb >= 0 ? '+' : ''}${backgroundAutoGainDb.toFixed(1)} dB`;
  }

  function rampGain(kind, targetDb, duration = 260) {
    const generation = ++gainRampGeneration[kind];
    const currentDb = kind === 'karaoke' ? karaokeAutoGainDb : kind === 'background' ? backgroundAutoGainDb : appliedMasterDb;
    const target = Number(targetDb) || 0;
    const webParameter = kind === 'karaoke'
      ? mediaAudioGraph?.karaokeAutoGain?.gain
      : kind === 'background'
        ? mediaAudioGraph?.backgroundAutoGain?.gain
        : mediaAudioGraph?.finalMaster?.gain;
    if (webParameter) setAudioParam(webParameter, dbToLinear(target), 0.075);
    const startedAt = performance.now();
    let lastNativeAt = -Infinity;
    const frame = (now) => {
      if (gainRampGeneration[kind] !== generation) return;
      const progress = duration <= 0 ? 1 : Math.min(1, (now - startedAt) / duration);
      const eased = 0.5 - Math.cos(Math.PI * progress) / 2;
      const value = currentDb + (target - currentDb) * eased;
      if (kind === 'karaoke') karaokeAutoGainDb = value;
      else if (kind === 'background') backgroundAutoGainDb = value;
      else appliedMasterDb = value;
      if (usingNativeAudio() && (now - lastNativeAt >= 32 || progress >= 1)) {
        lastNativeAt = now;
        if (kind === 'master') nativeAudioCommand('nativeAudioMaster', { masterDb: value });
        else configureNativeDeck(kind, { autoGainDb: value }, { immediate: true });
      }
      if (progress < 1) requestAnimationFrame(frame);
      else renderAutoGainSettings();
    };
    requestAnimationFrame(frame);
  }

  function applyAutoGain({ smooth = true } = {}) {
    const karaoke = calculateTrackAutoGain(currentLoudness, autoGainSettings);
    const background = calculateTrackAutoGain(backgroundLoudness, autoGainSettings);
    rampGain('karaoke', karaoke.appliedDb, smooth ? 260 : 0);
    rampGain('background', background.appliedDb, smooth ? 260 : 0);
    rampGain('master', autoGainSettings.masterDb, smooth ? 260 : 0);
    renderAutoGainSettings();
  }

  async function requestLoudness(kind, id, { force = false } = {}) {
    if (!id) return null;
    const pending = { pending: true };
    if (kind === 'karaoke') currentLoudness = pending;
    else backgroundLoudness = pending;
    renderAutoGainSettings();
    try {
      const result = await api(`/api/player/loudness/${kind}/${encodeURIComponent(id)}`, force
        ? { method: 'POST', body: JSON.stringify({ force: true }) }
        : undefined);
      const active = kind === 'karaoke' ? currentId : (backgroundPendingId || backgroundCurrentId);
      if (String(active || '') !== String(id)) return result;
      if (kind === 'karaoke') currentLoudness = result;
      else backgroundLoudness = result;
      applyAutoGain();
      recordAudio('LOUDNESS_ANALYSIS_COMPLETED', 'INFO', {
        deck: kind,
        integratedLufs: result.integratedLufs,
        truePeakDbtp: result.truePeakDbtp,
        autoGainDb: calculateTrackAutoGain(result, autoGainSettings).appliedDb,
        cached: result.cached === true
      });
      return result;
    } catch (error) {
      const fallback = { error: error.message };
      if (kind === 'karaoke') currentLoudness = fallback;
      else backgroundLoudness = fallback;
      applyAutoGain();
      recordAudio('LOUDNESS_ANALYSIS_FAILED', 'WARNING', { deck: kind, message: error.message });
      return fallback;
    }
  }

  function setAudioParam(parameter, value, smoothing = 0.035) {
    if (!parameter || !audioContext) return;
    const now = audioContext.currentTime;
    parameter.cancelScheduledValues(now);
    parameter.setTargetAtTime(Number(value) || 0, now, smoothing);
  }

  function applyAudioSettings({ synchronizePlayback = false } = {}) {
    if (usingNativeAudio()) {
      configureNativeDeck('karaoke');
      configureNativeDeck('background');
      configureNativeMaster();
      if (synchronizePlayback) applyPlaybackProcessing();
      return;
    }
    if (!mediaAudioGraph) return;
    setAudioParam(mediaAudioGraph.low.gain, audioSettings.low);
    setAudioParam(mediaAudioGraph.mid.gain, audioSettings.mid);
    setAudioParam(mediaAudioGraph.high.gain, audioSettings.high);
    const stemsReady = lockedStemSourceReady();
    setAudioParam(mediaAudioGraph.normalGain.gain, stemsReady ? 0 : 1, 0.025);
    setAudioParam(mediaAudioGraph.instrumentalGain.gain, stemsReady ? 1 : 0, 0.025);
    setAudioParam(mediaAudioGraph.vocalsGain.gain, stemsReady ? audioSettings.vocalLevel : 0, 0.025);
    setAudioParam(mediaAudioGraph.master?.gain, mediaTargetVolume, 0.025);
    setAudioParam(mediaAudioGraph.backgroundGain?.gain, backgroundTargetVolume, 0.025);
    setAudioParam(mediaAudioGraph.karaokeAutoGain?.gain, dbToLinear(karaokeAutoGainDb), 0.075);
    setAudioParam(mediaAudioGraph.backgroundAutoGain?.gain, dbToLinear(backgroundAutoGainDb), 0.075);
    setAudioParam(mediaAudioGraph.finalMaster?.gain, dbToLinear(appliedMasterDb), 0.075);
    // EQ, gain, fade and output maintenance must not retune a live media
    // element. A rate change is requested only when a media source or graph
    // has just been created/recovered.
    if (synchronizePlayback) applyPlaybackProcessing();
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
    paintRange(vocal);
    const vocalControl = $('#playerVocalControl');
    const stemsReady = lockedStemSourceReady();
    if (vocalControl) vocalControl.classList.remove('hidden');
    if (vocal) vocal.disabled = !stemsReady;
    renderPlaybackProcessing();
  }

  function setPreservedRate(element, rate) {
    return applyTempoRate(element, rate);
  }

  function ensurePitchWorklet(graph = mediaAudioGraph) {
    if (!graph || graph.pitchWorklet || pitchWorkletState !== 'ready' || typeof AudioWorkletNode !== 'function') return graph?.pitchWorklet || null;
    try {
      const bypass = graph.pitch;
      const worklet = new AudioWorkletNode(audioContext, 'guest-star-pitch-shifter');
      graph.pitch = worklet;
      graph.pitchWorklet = worklet;
      disconnectNode(bypass);
      reconnectPlayerAudioGraph(graph);
      return worklet;
    } catch (error) {
      pitchWorkletState = 'unsupported';
      recordAudio('PITCH_WORKLET_CREATE_FAILED', 'ERROR', { message: error.message });
      renderPlaybackProcessing();
      return null;
    }
  }

  function setPitchRatio(node, semitones) {
    // Tempo is handled by WebKit's preservesPitch path.  The independent pitch
    // processor stays out of the signal path at 0 semitones, preventing an
    // unnecessary worklet from competing with real-time time-stretching.
    const pitchNode = Number(semitones) === 0 ? node?.pitchWorklet || node : ensurePitchWorklet(mediaAudioGraph);
    const parameter = pitchNode?.parameters?.get?.('ratio');
    if (parameter) setAudioParam(parameter, 2 ** (Number(semitones || 0) / 12), 0.02);
  }

  function applyPitchProcessing() {
    if (usingNativeAudio()) {
      configureNativeDeck('karaoke', { pitchSemitones: keySemitones }, { immediate: true });
      return;
    }
    setPitchRatio(mediaAudioGraph?.pitch, keySemitones);
  }

  function applyKaraokeTempoNow() {
    window.clearTimeout(karaokeTempoTimer);
    karaokeTempoTimer = 0;
    karaokeTempoLastAppliedAt = performance.now();
    const karaokeRate = tempoPercent / 100;
    if (usingNativeAudio()) {
      // playbackRate is visual clock only in native mode: the muted video must
      // advance with AVAudioUnitTimePitch, but it never renders WebKit audio.
      visualRate(media, tempoPercent);
      if (lockedStemSourceReady()) [instrumentalAudio, vocalsAudio].forEach((element) => visualRate(element, tempoPercent));
      configureNativeDeck('karaoke', { tempoPercent }, { immediate: true });
      publish();
      return;
    }
    setPreservedRate(media, karaokeRate);
    // Stems are synchronized only when they are part of the active mix.  This
    // avoids waking two inactive WebKit decoders for every karaoke adjustment.
    if (lockedStemSourceReady()) [instrumentalAudio, vocalsAudio].forEach((element) => setPreservedRate(element, karaokeRate));
  }

  function applyBackgroundTempoNow() {
    window.clearTimeout(backgroundTempoTimer);
    backgroundTempoTimer = 0;
    backgroundTempoLastAppliedAt = performance.now();
    if (usingNativeAudio()) {
      visualRate(backgroundAudio, backgroundTempoPercent);
      configureNativeDeck('background', { tempoPercent: backgroundTempoPercent }, { immediate: true });
      return;
    }
    setPreservedRate(backgroundAudio, backgroundTempoPercent / 100);
  }

  function scheduleKaraokeTempoApplication({ immediate = false } = {}) {
    window.clearTimeout(karaokeTempoTimer);
    const delay = tempoApplicationDelay({ now: performance.now(), lastAppliedAt: karaokeTempoLastAppliedAt, immediate });
    if (delay <= 0) applyKaraokeTempoNow();
    else karaokeTempoTimer = window.setTimeout(applyKaraokeTempoNow, delay);
  }

  function scheduleBackgroundTempoApplication({ immediate = false } = {}) {
    window.clearTimeout(backgroundTempoTimer);
    const delay = tempoApplicationDelay({ now: performance.now(), lastAppliedAt: backgroundTempoLastAppliedAt, immediate });
    if (delay <= 0) applyBackgroundTempoNow();
    else backgroundTempoTimer = window.setTimeout(applyBackgroundTempoNow, delay);
  }

  function applyPlaybackProcessing() {
    // This path is used at graph/media initialization, never for every slider
    // event.  It applies the current independent values without rebuilding the
    // graph or resetting position, fades, output selection, or key state.
    applyKaraokeTempoNow();
    applyBackgroundTempoNow();
    applyPitchProcessing();
  }

  function renderPlaybackProcessing() {
    const bpm = currentAnalysis?.bpm || 0;
    const currentBpm = bpmAtTempo(bpm, tempoPercent);
    const tempoLabel = Number.isInteger(tempoPercent) ? String(tempoPercent) : tempoPercent.toFixed(1);
    $('#playerBpmValue').textContent = bpm ? (tempoPercent === 100 ? `${bpm} BPM` : `${bpm} → ${currentBpm} BPM`) : '—';
    $('#playerBpmStatus').textContent = currentAnalysis?.pending ? 'Analizando pista actual…' : currentAnalysis?.error ? 'Análisis no disponible para esta pista' : bpm ? `Original: ${bpm} · Actual: ${currentBpm}` : currentId ? 'BPM no detectable' : 'Selecciona una canción';
    const key = currentAnalysis?.key || '';
    const shiftedKey = transposeKey(key, keySemitones);
    $('#playerKeyValue').textContent = shiftedKey ? `${key} → ${shiftedKey}` : '—';
    $('#playerKeyStatus').textContent = currentAnalysis?.pending ? 'Analizando pista actual…' : currentAnalysis?.error ? 'Análisis no disponible para esta pista' : key ? `Original: ${key} · confianza de perfil ${Math.round((Number(currentAnalysis?.keyConfidence) || 0) * 100)}% · ${keySemitones > 0 ? '+' : ''}${keySemitones} semitonos` : currentId ? 'Tonalidad no detectable' : 'Selecciona una canción';
    $('#playerKeyReanalyze').disabled = !current()?.localAvailable || currentAnalysis?.pending === true;
    $('#playerTempo').value = String(tempoPercent); $('#playerTempoValue').textContent = `${tempoLabel}%`; paintRange($('#playerTempo'));
    $('#playerTempoLock').checked = karaokeTempoLocked;
    $('#playerTempo').disabled = karaokeTempoLocked;
    $('#playerTempoDown').disabled = karaokeTempoLocked || tempoPercent <= 50;
    // Reset is an explicit recovery action. It returns only this player's tempo
    // to its original rate without changing the independent Lock Tempo state.
    $('#playerTempoReset').disabled = tempoPercent === 100;
    $('#playerTempoUp').disabled = karaokeTempoLocked || tempoPercent >= 150;
    $('#playerKeyShiftValue').textContent = `${keySemitones > 0 ? '+' : ''}${keySemitones}`;
    const backgroundBpm = backgroundAnalysis?.bpm || 0;
    const backgroundCurrentBpm = bpmAtTempo(backgroundBpm, backgroundTempoPercent);
    const backgroundTempoLabel = Number.isInteger(backgroundTempoPercent) ? String(backgroundTempoPercent) : backgroundTempoPercent.toFixed(1);
    const backgroundTrack = backgroundPending() || backgroundCurrent();
    $('#playerBackgroundBpmValue').textContent = backgroundBpm ? (backgroundTempoPercent === 100 ? `${backgroundBpm} BPM` : `${backgroundBpm} → ${backgroundCurrentBpm} BPM`) : '—';
    $('#playerBackgroundBpmStatus').textContent = backgroundAnalysis?.pending ? 'Analizando pista de fondo…' : backgroundAnalysis?.error ? 'Análisis no disponible' : backgroundBpm ? `Original: ${backgroundBpm} · Actual: ${backgroundCurrentBpm}` : backgroundTrack ? 'BPM no detectable' : 'Selecciona una pista';
    $('#playerBackgroundTempo').value = String(backgroundTempoPercent); $('#playerBackgroundTempoValue').textContent = `${backgroundTempoLabel}%`; paintRange($('#playerBackgroundTempo'));
    $('#playerBackgroundTempoLock').checked = backgroundTempoLocked;
    $('#playerBackgroundTempo').disabled = backgroundTempoLocked;
    $('#playerBackgroundTempoDown').disabled = backgroundTempoLocked || backgroundTempoPercent <= 50;
    $('#playerBackgroundTempoReset').disabled = backgroundTempoPercent === 100;
    $('#playerBackgroundTempoUp').disabled = backgroundTempoLocked || backgroundTempoPercent >= 150;
    const pitchDisabled = !usingNativeAudio() && pitchWorkletState === 'unsupported';
    $('#playerKeyDown').disabled = pitchDisabled || keySemitones <= -6;
    $('#playerKeyReset').disabled = pitchDisabled || keySemitones === 0;
    $('#playerKeyUp').disabled = pitchDisabled || keySemitones >= 6;
  }

  function setScene(modeName, phase = modeName) {
    if (stageMode === modeName && scenePhase === phase) return;
    stageMode = modeName;
    scenePhase = phase;
    sceneRevision += 1;
  }

  function fadeVolume(element, target, duration = FADE_MS, valid = () => true) {
    const fadeGeneration = element === backgroundAudio ? ++backgroundFadeGeneration : 0;
    const isValid = () => (element !== backgroundAudio || fadeGeneration === backgroundFadeGeneration) && valid();
    const destination = Math.max(0, Math.min(1, Number(target) || 0));
    const nativeBackground = usingNativeAudio() && element === backgroundAudio;
    const gain = nativeBackground ? null : element === backgroundAudio ? mediaAudioGraph?.backgroundFade?.gain : null;
    const fadeDestination = gain ? fadeGainForVolume(backgroundTargetVolume, destination) : destination;
    const readVolume = () => nativeBackground ? nativeBackgroundGain : gain ? gain.value : element.volume;
    const writeVolume = (value) => {
      if (nativeBackground) setBackgroundVolume(value);
      else if (gain) gain.value = value;
      else element.volume = value;
    };
    const origin = Math.max(0, Math.min(1, Number(readVolume()) || 0));
    if (duration <= 0 || Math.abs(origin - fadeDestination) < 0.002) {
      if (isValid()) writeVolume(fadeDestination);
      return Promise.resolve(isValid());
    }
    const startedAt = performance.now();
    return new Promise((resolve) => {
      const frame = (now) => {
        if (!isValid()) { resolve(false); return; }
        const progress = Math.min(1, Math.max(0, (now - startedAt) / duration));
        const eased = 0.5 - Math.cos(Math.PI * progress) / 2;
        writeVolume(origin + (fadeDestination - origin) * eased);
        if (progress < 1) requestAnimationFrame(frame);
        else resolve(true);
      };
      requestAnimationFrame(frame);
    });
  }

  function absoluteMediaURL(value) {
    try { return value ? new URL(value, location.origin).href : ''; }
    catch { return ''; }
  }

  function waitUntilPlayable(element, generation, timeoutMs = 3500, { expectedSource = '', isCurrent = () => true } = {}) {
    const expected = absoluteMediaURL(expectedSource);
    const matchesExpectedSource = () => !expected || absoluteMediaURL(element.currentSrc || element.src) === expected;
    const valid = () => isCurrent() && (element !== backgroundAudio || generation === backgroundGeneration);
    if (valid() && matchesExpectedSource() && element.readyState >= 3) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => finish(new Error('El archivo tardó demasiado en cargar.')), timeoutMs);
      const finish = (error) => {
        window.clearTimeout(timeout);
        element.removeEventListener('canplay', onReady);
        element.removeEventListener('error', onError);
        if (!valid()) reject(new Error('Carga reemplazada.'));
        else if (error) reject(error);
        else resolve();
      };
      const onReady = () => {
        if (!valid()) { finish(new Error('Carga reemplazada.')); return; }
        // An old canplay can be delivered after src has changed.  Leave this
        // waiter armed until the requested resource itself is playable.
        if (matchesExpectedSource()) finish();
      };
      const onError = () => finish(new Error('Formato o códec no compatible.'));
      element.addEventListener('canplay', onReady);
      element.addEventListener('error', onError, { once: true });
    });
  }

  const activityId = () => String(state?.account?.current?.activityId || '');
  const storageKey = () => `guest-star:player-order:${activityId() || 'none'}`;
  const visibilityStorageKey = () => `guest-star:player-star-visibility:${activityId() || 'none'}`;
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
    } else {
      try { order = JSON.parse(localStorage.getItem(storageKey()) || '[]'); }
      catch { order = []; }
    }
    const remoteVisibility = state?.playerRuntime?.queueVisibility;
    if (remoteVisibility && typeof remoteVisibility === 'object' && !Array.isArray(remoteVisibility)) {
      queueVisibility = Object.fromEntries(Object.entries(remoteVisibility).map(([id, visible]) => [String(id), visible !== false]));
      localStorage.setItem(visibilityStorageKey(), JSON.stringify(queueVisibility));
    } else {
      try { queueVisibility = JSON.parse(localStorage.getItem(visibilityStorageKey()) || '{}'); }
      catch { queueVisibility = {}; }
    }
  }

  function visibilitySignature(value = queueVisibility) {
    return JSON.stringify(Object.fromEntries(Object.entries(value || {}).sort(([left], [right]) => left.localeCompare(right))));
  }

  function saveOrder({ remote = false, queueOnly = false } = {}) {
    localStorage.setItem(storageKey(), JSON.stringify(order));
    localStorage.setItem(visibilityStorageKey(), JSON.stringify(queueVisibility));
    if (remote) {
      pendingOrderSignature = playerQueueOrderSignature(order);
      if (queueOnly) { scheduleQueueOrderSave(); return; }
      pendingVisibilitySignature = visibilitySignature();
      scheduleRuntimeSave(120);
    }
  }

  function scheduleQueueOrderSave() {
    queueOrderSavePending = true;
    window.clearTimeout(queueOrderSaveTimer);
    queueOrderSaveTimer = window.setTimeout(() => void persistQueueOrder(), 120);
  }

  async function persistQueueOrder() {
    if (queueOrderSaveInFlight || !playerPreparationReady()) return;
    queueOrderSaveInFlight = true;
    try {
      while (queueOrderSavePending) {
        queueOrderSavePending = false;
        // The existing runtime endpoint accepts partial updates. Omitting playback
        // also avoids running its playback/stem-lock update branch on a reorder.
        await api('/api/player/runtime', {
          method: 'POST', body: JSON.stringify({ queueOrder: [...order] }), keepalive: true
        });
      }
    } catch {
      // Keep the local order and retry delivery to the local server. Its existing
      // persistence mechanism takes care of disk and cloud synchronization.
      queueOrderSavePending = true;
      window.clearTimeout(queueOrderSaveTimer);
      queueOrderSaveTimer = window.setTimeout(() => void persistQueueOrder(), 2000);
    } finally { queueOrderSaveInFlight = false; }
  }

  function runtimePayload() {
    return {
      queueOrder: [...order],
      queueVisibility: { ...queueVisibility },
      playback: {
        currentRequestId: currentId,
        currentTimeSeconds: karaokeClockPosition(),
        scene: stageMode === 'karaoke' ? 'karaoke' : 'lobby',
        wasPlaying: stageMode === 'karaoke' && karaokeTransportIsPlaying()
      }
    };
  }

  async function persistRuntime() {
    window.clearTimeout(runtimeSaveTimer);
    runtimeSaveTimer = 0;
    if (!playerPreparationReady()) return;
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
    const previousSignature = playerQueueOrderSignature(order);
    order = [...order.filter((id) => ids.includes(id)), ...ids.filter((id) => !order.includes(id))];
    if (pendingOrderSignature && playerQueueOrderSignature(order) !== previousSignature) {
      pendingOrderSignature = playerQueueOrderSignature(order);
      scheduleQueueOrderSave();
    }
    saveOrder();
    return order.map((id) => byId.get(id)).filter(Boolean);
  }

  function visibleOnStarScreen(item) {
    return queueVisibility[String(item?.id || '')] !== false;
  }

  function identity() {
    const hotel = state?.tenant?.hotel || {};
    const branding = state?.tenant?.branding || {};
    const venue = state?.tenant?.venue || {};
    const activity = state?.tenant?.activity || {};
    const share = state?.tenant?.share || {};
    const access = currentHostActivityAccess(state, { superhostInHostView: opened });
    const nextSchedule = (state?.tenant?.schedules || [])
      .filter(item => item.status === 'active' && item.activityId === activity.activityId && item.venueId === venue.venueId && Date.parse(item.scheduledStartAt) > Date.now())
      .sort((a, b) => Date.parse(a.scheduledStartAt) - Date.parse(b.scheduledStartAt))[0];
    const nextActivity = (state?.tenant?.upcomingActivities || [])
      .filter((item) =>
        (!item.hotelId || String(item.hotelId) === String(hotel.hotelId || '')) &&
        !['cancelled', 'completed', 'finished', 'inactive'].includes(String(item.status || '').toLowerCase()) &&
        Number.isFinite(Date.parse(item?.scheduledStartAt)) &&
        Date.parse(item.scheduledStartAt) > Date.now()
      )
      .sort((a, b) => Date.parse(a.scheduledStartAt) - Date.parse(b.scheduledStartAt))[0] || null;
    const language = String(state?.config?.uiLanguage || 'es').toLowerCase();
    let localizedMessages = {};
    try {
      localizedMessages = typeof branding.localizedMessagesJson === 'string'
        ? JSON.parse(branding.localizedMessagesJson || '{}')
        : branding.localizedMessagesJson || {};
    } catch { localizedMessages = {}; }
    const localized = localizedMessages?.[language] || {};
    const currentSchedule = (state?.tenant?.schedules || []).find((item) =>
      String(item.scheduleId || '') === String(activity.currentScheduleId || '')
    );
    let scheduleAnnouncement = null;
    try {
      const raw = typeof currentSchedule?.weekdayAnnouncementsJson === 'string'
        ? JSON.parse(currentSchedule.weekdayAnnouncementsJson || '[]')
        : currentSchedule?.weekdayAnnouncementsJson || [];
      const occurrence = new Date(activity.currentScheduleOccurrenceAt || state?.activity?.activityStartedAt || '');
      if (Array.isArray(raw) && Number.isFinite(occurrence.getTime())) {
        const short = new Intl.DateTimeFormat('en-US', { timeZone: hotel.timezone || 'UTC', weekday: 'short' }).format(occurrence);
        const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(short);
        scheduleAnnouncement = raw.find((item) => Number(item.weekday) === weekday) || null;
      }
    } catch { scheduleAnnouncement = null; }
    const lifecycle = starScreenLifecycle({
      status: activity.status,
      activityRunning: state?.activity?.activityRunning === true,
      finishedAt: state?.activity?.activityFinishedAt,
      requestsOpen: state?.activity?.accepting !== false
    });
    return {
      hotelName: hotel.name || 'Guest Star',
      hotelTimeZone: hotel.timezone || 'UTC',
      venueName: venue.name || 'Venue',
      activityName: activity.name || 'Actividad actual',
      starScreenColors: {
        primary: branding.primaryColor || '#ff2d95',
        secondary: branding.secondaryColor || '#8b3dff',
        accent: branding.accentColor || '#00c8ff'
      },
      starScreenLanguages: Array.isArray(activity.allowedLanguages) ? activity.allowedLanguages : (() => {
        try { return JSON.parse(activity.allowedLanguagesJson || '[]'); } catch { return []; }
      })(),
      logoUrl: branding.showHotelLogo === false
        ? ''
        : normalizeBrandImageUrl(branding.hotelLogoUrl || branding.teamLogoUrl || hotel.logoUrl || hotel.logo || hotel.branding?.logoUrl || ''),
      publicUrl: share.publicUrl || '',
      activityStatus: activity.status || '',
      activityLifecycle: lifecycle,
      finalExperience: lifecycle.mode === 'post-activity' ? {
        title: branding.activityFinishedTitle || (language === 'es' ? 'GRACIAS POR SER UNA ESTRELLA ✨' : 'THANK YOU FOR BEING A STAR ✨'),
        message: localized.activityEndingMessage || branding.activityFinishedMessage || branding.activityEndingMessage || '',
        starMomentMessage: scheduleAnnouncement?.message || localized.upcomingActivityMessage || branding.upcomingActivityMessage || '',
        language,
        nextActivity: nextActivity ? {
          name: nextActivity.activityName || '',
          venue: nextActivity.venueName || '',
          scheduledStartAt: nextActivity.scheduledStartAt || ''
        } : null
      } : null,
      activityAccess: access?.pin && access?.joinUrl ? {
        pin: access.pin, joinUrl: access.joinUrl,
        nextOccurrenceAt: nextSchedule?.scheduledStartAt || ''
      } : null
    };
  }

  function activePlaybackLocked() {
    return Boolean(activePlaybackSession?.trackId && currentId === activePlaybackSession.trackId);
  }

  function lockActivePlayback(item, source) {
    activePlaybackSession = {
      trackId: String(item?.id || ''),
      item: item ? { ...item } : null,
      source: String(source || ''),
      lockedAt: Date.now()
    };
  }

  function releaseActivePlayback(trackId = currentId) {
    if (activePlaybackSession?.trackId === String(trackId || '')) activePlaybackSession = null;
  }

  function current() {
    return requestsById().get(currentId) ||
      (activePlaybackSession?.trackId === currentId ? activePlaybackSession.item : null);
  }
  function guest(item) { return [item?.singer, item?.guestAlias].filter(Boolean).join(' ') || 'Próximo cantante'; }
  function sourceForCurrent() {
    return activePlaybackSession?.trackId === currentId
      ? activePlaybackSession.source
      : karaokeMediaSource(currentId);
  }
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
        ...starScreenRequestData(request),
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
      visualTransportRevision,
      playing: stageMode === 'karaoke' && karaokeTransportIsPlaying(),
      currentTime: karaokeClockPosition(),
      duration: karaokeClockDuration(),
      // The configured value is published immediately so the muted visual
      // follower switches rate in the same transport transaction as native
      // AVAudioUnitTimePitch, rather than waiting for a status timer tick.
      tempoPercent,
      volume: mediaTargetVolume,
      background: {
        track: background,
        playing: backgroundTransportIsPlaying(),
        currentTime: backgroundClockPosition(),
        duration: backgroundClockDuration(),
        volume: backgroundTargetVolume
      },
      showQueueCount: state?.activity?.showStarScreenQueueCount !== false,
      starScreenPreferences: starScreenPreferences(state?.config?.interfacePreferences),
      queue: queue().filter(visibleOnStarScreen).map((item) => ({
        ...starScreenRequestData(item),
        id: item.id,
        singer: item.singer,
        guestAlias: item.guestAlias,
        song: item.song,
        artist: item.artist,
        localAvailable: item.localAvailable,
        sourceType: item.sourceType || 'guest_request',
        visibleOnStarScreen: true
      })),
      stems: {
        requestedEngine: 'auto',
        lockedEngine: lockedStemEngine,
        ready: lockedStemSourceReady(),
        status: current()?.stem?.status || 'none'
      }
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
    const running = Number.isFinite(started) &&
      state?.activity?.activityRunning !== false &&
      !Number.isFinite(finished);
    const elapsedSeconds = running ? Math.max(0, Math.floor((Date.now() - started) / 1000)) : 0;
    const remainingActivitySeconds = running ? Math.max(0, targetSeconds - elapsedSeconds) : 0;
    const confirmedSeconds = completedSeconds + queuedSeconds;
    const gapSeconds = Math.max(0, targetSeconds - confirmedSeconds);
    const overrunSeconds = Math.max(0, confirmedSeconds - targetSeconds);
    const coveragePercent = targetSeconds ? Math.round((confirmedSeconds / targetSeconds) * 100) : 0;
    const knownSeconds = (item) => {
      const duration = Number(item?.durationSeconds);
      return Number.isFinite(duration) && duration > 0 ? duration + transition(item) : 0;
    };
    const average = (values) => values.length
      ? values.reduce((total, value) => total + value, 0) / values.length
      : 0;
    const knownAll = items.map(knownSeconds).filter(Boolean);
    const knownQueue = queue().map(knownSeconds).filter(Boolean);
    const knownCompleted = completed.map(knownSeconds).filter(Boolean);
    const averageSongSeconds = Math.max(60,
      Math.round(average(knownAll) || average(knownQueue) || average(knownCompleted) || 240 + Number(state?.activity?.transitionSeconds || 0))
    );
    let estimatedRemainingSongs = 0;
    if (running && remainingActivitySeconds > 3600) {
      estimatedRemainingSongs = Math.floor(remainingActivitySeconds / averageSongSeconds);
    } else if (running && remainingActivitySeconds > 0) {
      let secondsLeft = remainingActivitySeconds;
      const currentItem = current();
      const currentRemaining = currentId && stageMode === 'karaoke'
        ? Math.max(0, (knownSeconds(currentItem) || averageSongSeconds) - karaokeClockPosition())
        : 0;
      if (currentRemaining > 0 && currentRemaining <= secondsLeft) {
        estimatedRemainingSongs += 1;
        secondsLeft -= currentRemaining;
      } else if (currentRemaining > secondsLeft) {
        secondsLeft = 0;
      }
      const upcoming = queue().filter((item) => String(item.id) !== String(currentId));
      let allQueuedFit = true;
      for (const item of upcoming) {
        const seconds = knownSeconds(item) || averageSongSeconds;
        if (seconds > secondsLeft) { allQueuedFit = false; break; }
        estimatedRemainingSongs += 1;
        secondsLeft -= seconds;
      }
      if (allQueuedFit) estimatedRemainingSongs += Math.floor(secondsLeft / averageSongSeconds);
    }
    return {
      active, completed, skipped, plannedSeconds, confirmedSeconds, targetSeconds,
      elapsedSeconds, remainingActivitySeconds, estimatedRemainingSongs,
      averageSongSeconds, gapSeconds, overrunSeconds, coveragePercent,
      eventEndsAt: running && targetSeconds ? new Date(started + targetSeconds * 1000) : null
    };
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
    $('#playerEngineMetric').textContent = stageMode === 'karaoke' && karaokeTransportIsPlaying() ? 'Reproduciendo' : preparationReady ? 'Preparado' : 'En espera';
    $('#playerEngineDetail').textContent = selectedMode === 'bridge' ? 'Esta actividad está configurada para VirtualDJ' : 'Video karaoke limpio en Star Screen';
    $('#playerActivityMetric').textContent = activityRunning() ? `En curso · solicitudes ${accepting ? 'abiertas' : 'cerradas'}` : configured ? 'Lista para iniciar' : 'Sin configurar';
    $('#playerActivityDetail').textContent = activityRunning() ? `Transcurrido ${formatDuration(summary.elapsedSeconds)}` : !configured ? 'Selecciona hotel, venue y actividad' : selectedMode ? 'Modo preparado para iniciar' : 'Elige Player o Bridge';
    const scheduledStart = Date.parse(String(state?.tenant?.activity?.scheduledStartAt || ''));
    const scheduled = !activityRunning() && status === 'scheduled' && Number.isFinite(scheduledStart);
    const summaryRelevant = activityRunning() || scheduled;
    $('#playerElapsedTime').textContent = formatDuration(activityRunning() ? summary.elapsedSeconds : 0);
    $('#playerElapsedDetail').textContent = activityRunning() ? `${formatDuration(summary.remainingActivitySeconds)} restantes según horario` : 'El reloj inicia con la actividad';
    $('#playerConfirmedTime').textContent = formatDuration(summaryRelevant ? summary.confirmedSeconds : 0);
    $('#playerConfirmedDetail').textContent = `${summary.active.filter((item) => item.localAvailable).length} en fila · ${summary.completed.length} cantadas`;
    $('#playerPlannedTime').textContent = formatDuration(summaryRelevant ? summary.plannedSeconds : 0);
    $('#playerPlannedDetail').textContent = summary.skipped.length ? `${summary.skipped.length} omitidas excluidas` : 'Las omitidas no se incluyen';
    const coverageCard = $('#playerCoverageCard');
    coverageCard.classList.remove('ok', 'warning', 'over');
    if (!activityRunning()) {
      $('#playerCoverageTime').textContent = '—';
      $('#playerCoverageDetail').textContent = scheduled ? 'Programada · la cuenta regresiva todavía no ha comenzado' : 'Sin actividad en curso';
    } else if (!summary.remainingActivitySeconds) {
      coverageCard.classList.add('over');
      $('#playerCoverageTime').textContent = '0:00:00 · ≈ 0 canciones';
      $('#playerCoverageDetail').textContent = 'El horario programado ya terminó';
    } else {
      coverageCard.classList.add('warning');
      $('#playerCoverageTime').textContent = `${formatDuration(summary.remainingActivitySeconds)} · ≈ ${summary.estimatedRemainingSongs} ${summary.estimatedRemainingSongs === 1 ? 'canción' : 'canciones'}`;
      $('#playerCoverageDetail').textContent = summary.remainingActivitySeconds <= 3600
        ? 'Proyección de última hora con pista actual, fila y duraciones reales'
        : 'Tiempo real restante según el horario de la actividad';
    }
    const scheduledEnd = scheduled && summary.targetSeconds
      ? new Date(scheduledStart + summary.targetSeconds * 1000)
      : null;
    $('#playerEventEndTime').textContent = summary.eventEndsAt
      ? clockTime(summary.eventEndsAt)
      : scheduledEnd
        ? clockTime(scheduledEnd)
        : '—';
    $('#playerEventEndDetail').textContent = summary.eventEndsAt
      ? `Organiza la rotación para terminar a las ${clockTime(summary.eventEndsAt)}.`
      : scheduledEnd
        ? 'Fin programado · la cuenta regresiva comenzará al iniciar la actividad.'
        : 'Inicia una actividad para activar su hora de cierre.';
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
    const stemStatus = $('#playerStemQuickStatus');
    const stemReady = stemTarget?.stem?.ready === true;
    const stemBusy = stemTarget?.stem && !stemReady && stemTarget.stem.status !== 'failed';
    if (!state?.stemEngine?.available) stemStatus.textContent = 'Separación vocal no disponible';
    else if (!stemTarget) stemStatus.textContent = 'Selecciona una pista';
    else if (!stemTarget.localAvailable) stemStatus.textContent = 'Falta el archivo local';
    else if (stemReady && stemTarget.stem?.improving) stemStatus.textContent = 'Voz guía lista · mejorando calidad…';
    else if (stemReady) stemStatus.textContent = 'Voz guía lista';
    else if (stemBusy) stemStatus.textContent = `${Math.round(Number(stemTarget.stem.progress) || 0)}% · preparando voz guía`;
    else if (stemTarget.stem?.status === 'failed') stemStatus.textContent = 'Voz guía no disponible · reproducción normal';
    else stemStatus.textContent = 'Voz guía se preparará automáticamente';
  }

  function youtubeDropdown(item) {
    if (item.sourceType === 'player_local') return '';
    const links = Array.isArray(item.youtube) ? item.youtube.slice(0, 6) : [];
    const requestId = escapeHtml(item.id);
    let content = '';
    if (links.length) {
      content = `<div class="player-youtube-list">${links.map((link, index) => {
        const detail = [link.channel || 'Canal no indicado', formatDuration(link.durationSeconds, true)].filter(Boolean).join(' · ');
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
    if (item.stem?.ready) return `<div class="player-stem-ready">Voz guía lista${item.stem.improving ? ' · mejorando calidad' : ''}</div>`;
    return `<div class="player-stem-prepare" aria-live="polite">${item.stem?.status === 'failed' ? 'IA no disponible · reproducción normal' : 'IA automática en segundo plano'}</div>`;
  }

  function renderQueue() {
    const items = queue();
    if (currentId && !items.some((item) => String(item.id) === currentId) && !activePlaybackLocked()) {
      currentId = '';
      setScene('lobby');
      media.pause();
      instrumentalAudio.pause();
      vocalsAudio.pause();
    }
    $('#playerQueueCount').textContent = String(items.length);
    const clearQueueButton = $('#playerClearQueue');
    const clearQueueControl = playerClearQueueControl({ itemCount: items.length, transitionBusy });
    clearQueueButton.disabled = clearQueueControl.disabled;
    clearQueueButton.title = clearQueueControl.title;
    let cumulativeSeconds = 0;
    const queueHtml = items.length
      ? items.map((item, index) => {
        const estimated = new Date(Date.now() + cumulativeSeconds * 1000);
        const duration = (Number(item.durationSeconds) || 240) + (Number(item.transitionSeconds) || Number(state?.activity?.transitionSeconds) || 0);
        cumulativeSeconds += duration;
        const comment = String(item.comment || '').trim();
        const localOwn = item.sourceType === 'player_local';
        const expanded = expandedRequestIds.has(String(item.id));
        const publicVisible = visibleOnStarScreen(item);
        return `<article class="player-queue-row ${String(item.id) === currentId ? 'active' : ''} ${expanded ? 'expanded' : ''}" data-player-row="${escapeHtml(item.id)}"><div class="player-queue-compact"><button class="player-queue-drag-handle" type="button" data-player-drag="${escapeHtml(item.id)}" aria-label="Reordenar turno de ${escapeHtml(guest(item))}" title="Arrastrar para reordenar · ↑/↓ con teclado">⠿</button><button class="player-queue-select" data-player-request="${escapeHtml(item.id)}" aria-keyshortcuts="Shift+Delete" title="Seleccionar · Shift + Delete para quitar de la fila"><b>#${index + 1}</b><span><strong>${escapeHtml(guest(item))}</strong><small>${escapeHtml(item.song)}${item.artist ? ` · ${escapeHtml(item.artist)}` : ''}</small></span><span class="player-queue-status"><i class="player-local-state ${item.localAvailable ? '' : 'missing'}">${item.localAvailable ? 'LOCAL' : 'SIN ARCHIVO'}</i>${item.stem ? `<i class="player-queue-stem-state ${item.stem.status === 'failed' ? 'failed' : ''}" title="${escapeHtml(queueStemLabel(item.stem))}">${escapeHtml(queueStemLabel(item.stem))}</i>` : ''}</span></button><button class="player-queue-expand" type="button" data-player-expand="${escapeHtml(item.id)}" aria-expanded="${expanded}" aria-controls="playerQueueOptions" aria-haspopup="dialog" title="${expanded ? 'Ocultar opciones' : 'Mostrar opciones'}">⌄</button></div><div class="player-queue-details ${expanded ? '' : 'hidden'}"><div class="player-queue-meta"><em>${localOwn ? 'Agregada manualmente al Player' : `Llegada #${index + 1}`} · turno estimado ${escapeHtml(clockTime(estimated))}</em><em>${escapeHtml(item.language || 'Idioma no indicado')} · ${escapeHtml(formatDuration(duration))}</em>${comment ? `<q>${escapeHtml(comment)}</q>` : ''}</div><div class="player-queue-actions" aria-label="Acciones para ${escapeHtml(guest(item))}"><button data-player-move="-1" data-player-id="${escapeHtml(item.id)}" ${index === 0 ? 'disabled' : ''} title="Subir un turno">↑</button><button data-player-move="1" data-player-id="${escapeHtml(item.id)}" ${index === items.length - 1 ? 'disabled' : ''} title="Bajar un turno">↓</button><button data-player-row-outcome="completed" data-player-id="${escapeHtml(item.id)}" title="Marcar como ya cantó">✓</button><button data-player-row-outcome="skipped" data-player-id="${escapeHtml(item.id)}" title="Saltar cantante">↷</button><button class="danger" data-player-row-outcome="removed" data-player-id="${escapeHtml(item.id)}" title="Quitar de la fila">×</button><button class="player-public-visibility ${publicVisible ? '' : 'is-hidden-public'}" data-player-visibility="${escapeHtml(item.id)}" title="${publicVisible ? 'Ocultar solo de Star Screen' : 'Volver a mostrar en Star Screen'}">${publicVisible ? '◉ Público' : '○ Oculto'}</button></div>${stemAction(item)}${youtubeDropdown(item)}</div></article>`;
      }).join('')
      : '<p class="player-empty">No hay solicitudes activas en esta actividad.</p>';
    $('#playerQueue').innerHTML = queueHtml;
    queueUI.refresh();
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
    if (planBSelectionMade) return planBItems;
    return Array.isArray(state?.hitSuggestions) ? state.hitSuggestions : [];
  }

  function renderPlanBFilters() {
    document.querySelectorAll('[data-player-plan-b-list]').forEach((button) => {
      const active = button.dataset.playerPlanBList === activePlanBList;
      button.classList.toggle('primary', active);
      button.classList.toggle('ghost', !active);
      button.setAttribute('aria-pressed', String(active));
    });
  }

  function renderPlanB() {
    renderPlanBFilters();
    const items = activePlanBItems();
    $('#playerPlanBBadge').textContent = String(items.length);
    if (planBLoading) {
      $('#playerPlanB').innerHTML = '<p class="player-empty">Preparando una rotación Plan B…</p>';
      return;
    }
    $('#playerPlanB').innerHTML = items.length
      ? items.map((item, index) => {
        const youtube = Array.isArray(item.youtube) ? item.youtube.slice(0, 6) : [];
        const song = String(item.song || '').trim() || 'Título no indicado';
        const artist = String(item.artist || '').trim() || 'Artista no indicado';
        const language = String(item.language || item.list || '').trim() || 'Idioma no indicado';
        const listLabel = ({ spanish: 'Español', english: 'English', favorites: 'Favoritos', both: 'Balanceada' })[item.list] || item.list;
        const source = String(item.fileName || (item.localAvailable ? 'Biblioteca local' : listLabel ? `Lista ${listLabel}` : '')).trim();
        const localAction = item.localAvailable && item.trackId
          ? `<button class="button primary" type="button" data-player-plan-b-assign="${index}">Asignar cantante</button>`
          : !youtube.length
            ? `<button class="button ghost" type="button" data-player-plan-b-youtube="${index}">${item.youtubeSearching ? 'Buscando…' : item.youtubeSearched ? 'Reintentar' : 'Buscar Karaoke'}</button>`
            : '';
        const youtubeOptions = youtube.length
          ? `<details class="player-plan-b-youtube" open><summary>${youtube.length} ${youtube.length === 1 ? 'versión' : 'versiones'} Karaoke/Lyrics</summary><div>${youtube.map((link, optionIndex) => `<article><span><strong>${optionIndex + 1}. ${escapeHtml(link.title || 'Título externo no indicado')}</strong><small class="player-plan-b-youtube-artist">${escapeHtml(artist)}</small><small>${escapeHtml(['YouTube', link.channel || 'Canal no indicado', link.resultType === 'karaoke' ? 'Karaoke' : 'Lyrics', formatDuration(link.durationSeconds, true)].filter(Boolean).join(' · '))}</small></span><button type="button" data-player-plan-b-copy="${escapeHtml(link.url)}">Copiar</button><button type="button" data-player-plan-b-open="${escapeHtml(link.url)}">Abrir ↗</button></article>`).join('')}</div></details>`
          : '';
        return `<article class="player-plan-b-row"><div class="player-plan-b-primary"><strong>${escapeHtml(song)}</strong><small>${escapeHtml(artist)}</small></div><div class="player-plan-b-meta"><span>${escapeHtml(language)}</span><em class="${item.localAvailable ? 'available' : ''}">${item.localAvailable ? 'LOCAL' : 'SIN ARCHIVO'}</em>${source ? `<small title="${escapeHtml(source)}">${escapeHtml(source)}</small>` : ''}</div>${localAction ? `<div class="player-plan-b-action">${localAction}</div>` : ''}${youtubeOptions}</article>`;
      }).join('')
      : '<p class="player-empty">Pulsa Balanceada, Español, English o Favoritos para preparar el Plan B.</p>';
  }

  async function drawPlanB(list) {
    if (planBLoading) return;
    const requestedList = ['spanish', 'english', 'favorites', 'both'].includes(list) ? list : 'both';
    activePlanBList = requestedList;
    planBItems = [];
    planBSelectionMade = true;
    planBLoading = true;
    renderPlanB();
    try {
      const data = await api('/api/rotation/draw', {
        method: 'POST',
        body: JSON.stringify({ list: requestedList, count: 8 })
      });
      planBItems = data.items || [];
      showNotice(planBItems.length
        ? 'Plan B actualizado. Las pistas locales se pueden asignar directamente a un cantante.'
        : 'Esa lista todavía no tiene pistas disponibles.');
    } catch (error) {
      showNotice(error.message, true);
    }
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
    currentSongBackground.render();
    const progress = playerProgressState(karaokeScrubPreview ?? karaokeClockPosition(), karaokeClockDuration());
    $('#playerNowSong').textContent = item?.song || 'Selecciona una canción';
    $('#playerNowSinger').textContent = item ? guest(item) : 'Star Lineup y la música de fondo permanecen activos hasta pulsar Reproducir.';
    $('#playerPlayLabel').textContent = stageMode === 'karaoke' && karaokeTransportIsPlaying() ? '⏸ Pausar' : '▶ Reproducir';
    $('#playerCurrentTime').textContent = formatDuration(progress.currentTime, true);
    $('#playerDuration').textContent = formatDuration(progress.duration, true);
    const seek = $('#playerSeek');
    seek.max = String(progress.max);
    seek.value = String(progress.value);
    seek.disabled = progress.disabled;
    paintRange(seek);
    renderKaraokeVolume();
    $('#playerMediaStatus').textContent = transitionBusy
      ? scenePhase === 'to-karaoke' ? 'Fade a karaoke…' : 'Fade a Star Lineup…'
      : !item ? 'Motor preparado' : media.error ? 'Formato no compatible' : media.readyState >= 3 ? (stageMode === 'karaoke' ? 'Video en Star Screen' : 'Video listo · Star Lineup visible') : 'Cargando archivo local…';
  }

  function resetPlayerProgress() {
    const seek = $('#playerSeek');
    if (seek) {
      seek.max = '1';
      seek.value = '0';
      seek.disabled = true;
      paintRange(seek);
    }
    if ($('#playerCurrentTime')) $('#playerCurrentTime').textContent = '0:00';
    if ($('#playerDuration')) $('#playerDuration').textContent = '0:00';
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
    const hasConfiguredSources = sources.length > 0;
    const configuredSourceLabel = sources.length === 1
      ? sources[0]
      : `${sources.length} fuentes configuradas`;
    const configuredVolume = Math.max(0, Math.min(1, Number(background.volume ?? backgroundTargetVolume)));
    if (!$('#playerBackgroundVolume').matches(':active') && !backgroundTransition && Math.abs(configuredVolume - backgroundTargetVolume) > 0.001) backgroundTargetVolume = configuredVolume;
    $('#playerBackgroundVolume').value = String(backgroundTargetVolume);
    $('#playerBackgroundVolumeValue').textContent = `${Math.round(backgroundTargetVolume * 100)}%`;
    paintRange($('#playerBackgroundVolume'));
    $('#playerBackgroundCount').textContent = `${Number(background.count) || 0} pistas`;
    // A source can be fully restored after launch before the rotation picks
    // its first track.  Do not misreport that healthy state as unconfigured.
    $('#playerBackgroundSong').textContent = track?.song || (hasConfiguredSources ? 'Música ambiental configurada' : 'Sin música configurada');
    $('#playerBackgroundArtist').textContent = track?.artist || (background.error || (hasConfiguredSources ? configuredSourceLabel : 'Selecciona una carpeta o un archivo de audio.'));
    $('#playerBackgroundStatus').textContent = backgroundStatusOverride || (stageMode === 'karaoke'
      ? 'Pausada mientras canta el invitado'
      : backgroundTransition
        ? 'Aplicando transición suave…'
      : backgroundTransportIsPlaying()
        ? `Reproduciendo aleatoriamente · ${formatDuration(backgroundClockPosition(), true)}`
        : backgroundUserPaused
          ? 'Pausada'
        : track || hasConfiguredSources
          ? Number(background.count) > 0 ? 'Lista para Star Lineup' : 'Analizando fuentes configuradas…'
          : 'En espera');
    $('#playerBackgroundToggleLabel').textContent = backgroundTransportIsPlaying() ? '⏸ Pausar música de fondo' : '▶ Reproducir música de fondo';
    $('#playerBackgroundSources').innerHTML = sources.length
      ? sources.map((source, index) => `<div class="player-background-source"><span>${escapeHtml(source)}</span><button type="button" data-background-remove="${index}" aria-label="Quitar fuente">×</button></div>`).join('')
      : '<p class="player-empty">Aún no se configuró música de fondo.</p>';
    renderBackgroundPicker();
  }

  function render() {
    if (!state) return;
    renderBranding(); renderQueue(); renderCompleted(); renderPlanB(); renderNow(); renderBackground(); renderAudioSettings(); renderAutoGainSettings(); renderOperations(); publish();
  }

  async function loadRequest(id, autoplay = false) {
    if (!playerReady()) { showNotice('Inicia la actividad en modo Player antes de reproducir.', true); return; }
    const requestId = String(id || '');
    if (!playerTrackChangeAllowed({ activeTrackId: activePlaybackSession?.trackId, targetTrackId: requestId })) {
      showNotice('La pista cargada está protegida. Usa Devolver, Saltar, Ya cantó o Quitar para liberar el Player.', true);
      return false;
    }
    const item = requestsById().get(requestId);
    if (!item) return;
    // Last selected row wins.  Cancelling the old transition also invalidates
    // its async media and native-deck work before this selection awaits a
    // lobby fade.
    const mediaGeneration = ++karaokeMediaGeneration;
    if (transitionBusy) {
      transitionToken += 1;
      transitionBusy = false;
      nativeVisualPlaybackExpected = false;
    }
    // A slider's delayed seek belongs to the song it was issued for.  It must
    // never land on the next song while an AVFoundation extraction is pending.
    cancelPendingKaraokeSeek();
    const restoredPosition = pendingResumeTime;
    pendingResumeTime = null;
    karaokePendingStartPosition = Math.max(0, Number(restoredPosition) || 0);
    setNativeKaraokeTransportIntent(false, karaokePendingStartPosition);
    nativeKaraokeDeckRequestId = '';
    // nativeAudioStop also invalidates an in-flight AVFoundation extraction in
    // the host.  Without it, a former row could finish downloading after this
    // row had replaced the video and install the wrong audio into the deck.
    if (usingNativeAudio()) stopNativeDeck('karaoke');
    if (stageMode === 'karaoke' && currentId && currentId !== requestId) await enterLobby({ clearMedia: true });
    if (mediaGeneration !== karaokeMediaGeneration) return;
    analysisGeneration += 1;
    currentId = requestId;
    karaokeMediaRequestId = requestId;
    tempoPercent = 100; karaokeTempoLocked = false; keySemitones = 0;
    visualTransportRevision += 1;
    nativeKaraokeWasPlaying = false;
    nativeLastHardVisualSeekAt = -Infinity;
    Object.assign(nativeVideoSyncMetrics, { stateEvents: 0, hardSeeks: 0, rateWrites: 0, maxDriftSeconds: 0 });
    const analysisKey = trackAnalysisKey(currentId, item);
    currentAnalysis = item.localAvailable ? (analysisCache.get(analysisKey) || { pending: true }) : { bpm: null, key: '', error: 'No hay un archivo local para analizar.' };
    currentLoudness = item.localAvailable ? { pending: true } : { error: 'No hay un archivo local para analizar.' };
    applyAutoGain();
    setScene('lobby');
    if (!item.localAvailable) { render(); showNotice('Esta solicitud todavía no tiene un archivo local exacto.', true); return; }
    const source = karaokeMediaSource(requestId);
    lockActivePlayback(item, source);
    const expected = new URL(source, location.origin).href;
    if (media.src !== expected) {
      media.pause();
      resetPlayerProgress();
      media.src = source;
      media.load();
      // This muted, hidden element only supplies duration/metadata.  Mark the
      // internal seek so its event cannot enqueue a second native seek.
      setVisualClockPosition(media, karaokePendingStartPosition);
    }
    clearStemMedia();
    applyAudioSettings({ synchronizePlayback: true });
    render();
    void queueStemsForAvailability(item);
    void analyzeCurrentTrack(currentId, source, analysisKey);
    void requestLoudness('karaoke', currentId);
    if (autoplay) await startKaraoke();
    else await ensureBackgroundPlaying();
  }

  async function analyzeMediaSource(source) {
    let context = null;
    try {
      const response = await fetch(source);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = await response.arrayBuffer();
      const taggedBpm = embeddedBpm(bytes);
      const AnalysisContext = window.AudioContext || window.webkitAudioContext;
      if (typeof AnalysisContext !== 'function') throw new Error('Este sistema no ofrece decodificación de audio para el análisis.');
      context = new AnalysisContext();
      const decoded = await context.decodeAudioData(bytes.slice(0));
      const targetRate = Math.min(11025, decoded.sampleRate);
      const stride = Math.max(1, Math.round(decoded.sampleRate / targetRate));
      const length = Math.min(Math.floor(decoded.length / stride), targetRate * 120);
      const mono = new Float32Array(length);
      for (let channel = 0; channel < decoded.numberOfChannels; channel += 1) {
        const data = decoded.getChannelData(channel);
        for (let index = 0; index < length; index += 1) mono[index] += data[index * stride] / decoded.numberOfChannels;
      }
      const result = await analyzeOffThread(mono, decoded.sampleRate / stride);
      return taggedBpm ? { ...result, bpm: taggedBpm, bpmSource: 'metadata' } : { ...result, bpmSource: 'audio' };
    } finally {
      try { await context?.close(); } catch { /* The temporary decoder may already be closed. */ }
    }
  }

  function trackAnalysisKey(requestId, item) {
    return `${requestId}|${item?.filePath || item?.queuedFilePath || item?.matches?.[0]?.filePath || ''}`;
  }

  function analysisForSource(analysisKey, source) {
    if (analysisCache.has(analysisKey)) return Promise.resolve(analysisCache.get(analysisKey));
    if (analysisTasks.has(analysisKey)) return analysisTasks.get(analysisKey);
    const task = analyzeMediaSource(source)
      .catch((error) => ({ bpm: null, key: '', error: error.message }))
      .then((result) => { if (analysisTasks.get(analysisKey) === task) analysisCache.set(analysisKey, result); return result; })
      .finally(() => { if (analysisTasks.get(analysisKey) === task) analysisTasks.delete(analysisKey); });
    analysisTasks.set(analysisKey, task);
    return task;
  }

  async function analyzeCurrentTrack(requestId, source, analysisKey = requestId) {
    const generation = ++analysisGeneration;
    const cached = analysisCache.has(analysisKey);
    const result = await analysisForSource(analysisKey, source);
    if (trackAnalysisIsCurrent({ generation, currentGeneration: analysisGeneration, requestId, currentRequestId: currentId })) { currentAnalysis = result; renderPlaybackProcessing(); }
    recordAudio(result.error ? 'TRACK_ANALYSIS_FAILED' : 'TRACK_ANALYSIS_COMPLETED', result.error ? 'WARNING' : 'INFO', result.error ? { message: result.error } : { bpm: result.bpm, key: result.key, cached });
  }

  async function analyzeBackgroundTrack(trackId, source, analysisKey = `background|${trackId}`) {
    const generation = ++backgroundAnalysisGeneration;
    const cached = analysisCache.has(analysisKey);
    const result = await analysisForSource(analysisKey, source);
    const activeId = backgroundPendingId || backgroundCurrentId;
    if (trackAnalysisIsCurrent({ generation, currentGeneration: backgroundAnalysisGeneration, requestId: trackId, currentRequestId: activeId })) { backgroundAnalysis = result; renderPlaybackProcessing(); }
    recordAudio(result.error ? 'BACKGROUND_TRACK_ANALYSIS_FAILED' : 'BACKGROUND_TRACK_ANALYSIS_COMPLETED', result.error ? 'WARNING' : 'INFO', result.error ? { message: result.error } : { bpm: result.bpm, cached });
  }

  function prepareBackgroundAnalysis(track) {
    backgroundAnalysisGeneration += 1;
    if (!track?.id) { backgroundAnalysis = null; backgroundLoudness = null; applyAutoGain(); renderPlaybackProcessing(); return; }
    const analysisKey = `background|${track.id}`;
    backgroundAnalysis = analysisCache.get(analysisKey) || { pending: true };
    renderPlaybackProcessing();
    if (!analysisCache.has(analysisKey)) void analyzeBackgroundTrack(track.id, `/api/player/background/media/${encodeURIComponent(track.id)}`, analysisKey);
    backgroundLoudness = { pending: true };
    applyAutoGain();
    void requestLoudness('background', track.id);
  }

  async function startKaraoke() {
    recordAudio('KARAOKE_START_REQUEST', 'INFO', { trackId: currentId, stageMode, transitionBusy });
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
    const requestId = String(currentId || '');
    const mediaGeneration = karaokeMediaGeneration;
    if (!requestId || karaokeMediaRequestId !== requestId) return;
    const isCurrentSelection = () => (
      currentId === requestId &&
      karaokeMediaRequestId === requestId &&
      karaokeMediaGeneration === mediaGeneration
    );
    lockStemSourceForCurrent();
    const token = ++transitionToken;
    transitionBusy = true;
    const resuming = stageMode === 'karaoke';
    const nativeDeckAlreadyLoaded = usingNativeAudio() &&
      nativeKaraokeDeckRequestId === requestId && nativeDeckIsLoaded('karaoke');
    let startPosition = nativeDeckAlreadyLoaded && resuming
      ? karaokeClockPosition()
      : Math.max(0, Number(karaokePendingStartPosition) || 0);
    nativeVisualPlaybackExpected = true;
    ensureAudioEngine();
    setKaraokeVolume(0);
    try {
      await ensureAudioReady('karaoke-start');
      let stemElements = !usingNativeAudio() && lockedStemSourceReady() ? [instrumentalAudio, vocalsAudio] : [];
      try {
        await Promise.all([
          waitUntilPlayable(media, mediaGeneration, 8000, {
            expectedSource: karaokeMediaSource(requestId),
            isCurrent: isCurrentSelection
          }),
          ...stemElements.map((element) => waitUntilPlayable(element, mediaGeneration, 8000, {
            expectedSource: element.src,
            isCurrent: isCurrentSelection
          }))
        ]);
      } catch (error) {
        if (!stemElements.length) throw error;
        const failedEngine = lockedStemEngine;
        clearStemMedia();
        lockedStemEngine = 'original';
        lockedStemFormat = 'legacy';
        stemElements = [];
        applyAudioSettings({ synchronizePlayback: true });
        recordAudio('STEM_SOURCE_FALLBACK_ORIGINAL', 'WARNING', { engine: failedEngine, message: error.message });
        await waitUntilPlayable(media, mediaGeneration, 8000, {
          expectedSource: karaokeMediaSource(requestId),
          isCurrent: isCurrentSelection
        });
      }
      if (token !== transitionToken || !isCurrentSelection()) return;
      if (usingNativeAudio() && (!resuming || !nativeDeckAlreadyLoaded)) {
        // The host may scrub while AVFoundation is preparing the file.  The
        // latest staged master position wins over the initial load snapshot.
        startPosition = karaokePendingStartPosition;
        try {
          await loadNativeDeck('karaoke', nativeKaraokeSources(requestId), startPosition);
          if (token !== transitionToken || !isCurrentSelection()) {
            stopNativeDeck('karaoke');
            return;
          }
          nativeKaraokeDeckRequestId = requestId;
        } catch (error) {
          if (!lockedStemSourceReady()) throw error;
          const failedEngine = lockedStemEngine;
          clearStemMedia();
          lockedStemEngine = 'original';
          lockedStemFormat = 'legacy';
          applyAudioSettings({ synchronizePlayback: true });
          recordAudio('NATIVE_STEM_SOURCE_FALLBACK_ORIGINAL', 'WARNING', { engine: failedEngine, message: error.message });
          await loadNativeDeck('karaoke', nativeKaraokeSources(requestId), startPosition);
          if (token !== transitionToken || !isCurrentSelection()) {
            stopNativeDeck('karaoke');
            return;
          }
          nativeKaraokeDeckRequestId = requestId;
        }
      }
      if (usingNativeAudio() && (!resuming || !nativeDeckAlreadyLoaded)) {
        startPosition = karaokePendingStartPosition;
      }
      syncStemTimes(true);
      const visualPlayback = usingNativeAudio() ? Promise.resolve() : media.play().catch((error) => {
        // The muted WebKit element is only a video follower. A transient
        // visual autoplay pause must not cancel AVAudioEngine transport.
        if (!usingNativeAudio()) throw error;
        nativeVisualPlayRetryAt = performance.now() + 250;
      });
      const playbackResults = await Promise.all([
        visualPlayback,
        ...stemElements.map((element) => element.play()),
        ...(usingNativeAudio() ? [playNativeDeck('karaoke', startPosition)] : [])
      ]);
      if (token !== transitionToken || !isCurrentSelection()) {
        if (usingNativeAudio()) stopNativeDeck('karaoke');
        return;
      }
      if (usingNativeAudio()) {
        const nativeResult = playbackResults.at(-1);
        setNativeKaraokeTransportIntent(true, Number(nativeResult?.position ?? startPosition));
        media.pause();
      }
      else keepNativeVideoVisualPlaying(media);
      if (token !== transitionToken) return;
      if (!resuming) {
        setScene('karaoke', 'to-karaoke');
        scheduleRuntimeSave(0);
      }
      render();
      await Promise.all([
        fadeKaraokeVolume(karaokeMuted ? 0 : mediaTargetVolume, resuming ? 360 : FADE_MS, () => token === transitionToken),
        backgroundAudio.src && backgroundTransportIsPlaying()
          ? fadeVolume(backgroundAudio, 0, FADE_MS, () => token === transitionToken)
          : Promise.resolve(true)
      ]);
      if (token !== transitionToken) return;
      backgroundAudio.pause();
      if (usingNativeAudio()) await pauseNativeBackgroundDeck();
      else pauseNativeDeck('background');
      setBackgroundFade(0);
      setScene('karaoke');
      scheduleRuntimeSave(0);
      backgroundStatusOverride = '';
      render();
    } catch (error) {
      if (token === transitionToken) {
        recordAudio('KARAOKE_START_FAILED', 'ERROR', { trackId: requestId, message: error.message, nativeDeckLoaded: nativeDeckIsLoaded('karaoke'), mediaReadyState: media.readyState });
        nativeVisualPlaybackExpected = false;
        setNativeKaraokeTransportIntent(false, karaokeClockPosition());
        setScene('lobby');
        setKaraokeVolume(karaokeMuted ? 0 : mediaTargetVolume);
        render();
        await ensureBackgroundPlaying();
        showNotice(`No se pudo reproducir el video: ${error.message}`, true);
      }
    } finally {
      if (token === transitionToken) { transitionBusy = false; render(); scheduleRuntimeSave(0); }
    }
  }

  async function pauseKaraoke() {
    if (!karaokeTransportIsPlaying()) return;
    const token = ++transitionToken;
    transitionBusy = true;
    nativeVisualPlaybackExpected = false;
    try {
      const pausePosition = karaokeClockPosition();
      if (usingNativeAudio()) setNativeKaraokeTransportIntent(false, pausePosition);
      media.pause();
      pauseStemTracks();
      renderNow();
      publish();
      if (usingNativeAudio()) await pauseNativeKaraokeDeck(pausePosition);
      else pauseNativeDeck('karaoke');
      nativeKaraokeWasPlaying = false;
    } finally {
      if (token === transitionToken) { transitionBusy = false; render(); scheduleRuntimeSave(0); }
    }
  }

  async function restartKaraoke() {
    if (!media.src || transitionBusy) return;
    const token = ++transitionToken;
    transitionBusy = true;
    const wasPlaying = karaokeTransportIsPlaying();
    try {
      if (wasPlaying) await fadeKaraokeVolume(0, 240, () => token === transitionToken);
      if (token !== transitionToken) return;
      await seekKaraokeTransport(0);
      syncStemTimes(true);
      if (wasPlaying) {
        nativeVisualPlaybackExpected = true;
        await ensureAudioReady('karaoke-restart');
        const stemElements = !usingNativeAudio() && lockedStemSourceReady() ? [instrumentalAudio, vocalsAudio] : [];
        await Promise.all([
          waitUntilPlayable(media, backgroundGeneration, 8000),
          ...stemElements.map((element) => waitUntilPlayable(element, backgroundGeneration, 8000))
        ]);
        syncStemTimes(true);
        const visualPlayback = usingNativeAudio() ? Promise.resolve() : media.play().catch((error) => {
          if (!usingNativeAudio()) throw error;
          nativeVisualPlayRetryAt = performance.now() + 250;
        });
        const playbackResults = await Promise.all([
          visualPlayback,
          ...stemElements.map((element) => element.play()),
          ...(usingNativeAudio() ? [playNativeDeck('karaoke', 0)] : [])
        ]);
        if (usingNativeAudio()) {
          const nativeResult = playbackResults.at(-1);
          setNativeKaraokeTransportIntent(true, Number(nativeResult?.position ?? 0));
          media.pause();
        }
        else keepNativeVideoVisualPlaying(media);
        await fadeKaraokeVolume(karaokeMuted ? 0 : mediaTargetVolume, 360, () => token === transitionToken);
      }
    } finally {
      if (token === transitionToken) { transitionBusy = false; render(); scheduleRuntimeSave(0); }
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
      try { await ensureAudioReady('background-start'); }
      catch (error) { backgroundStatusOverride = error.message; return false; }
      backgroundStatusOverride = 'Aplicando fade de música de fondo…';
      renderBackground();
      if (backgroundAudio.src && backgroundTransportIsPlaying()) await fadeVolume(backgroundAudio, 0, 420, () => generation === backgroundGeneration);
      backgroundAudio.pause();
      // On the first ambient Play after launch the native deck does not exist
      // yet. Loading the next track creates it; pausing it first rejects the
      // transition and leaves this background-only UI flow at the fade status.
      if (usingNativeAudio()) {
        if (nativeDeckIsLoaded('background')) await pauseNativeBackgroundDeck();
      } else pauseNativeDeck('background');
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
        prepareBackgroundAnalysis(track);
        backgroundStatusOverride = `Preparando ${track.song || track.name || 'música de fondo'}…`;
        setBackgroundVolume(backgroundTargetVolume); setBackgroundFade(0);
        backgroundAudio.src = `/api/player/background/media/${encodeURIComponent(track.id)}`;
        backgroundAudio.load();
        applyBackgroundTempoNow();
        renderBackground(); publish();
        try {
          await waitUntilPlayable(backgroundAudio, generation);
          if (generation !== backgroundGeneration || stageMode !== 'lobby') return false;
          if (usingNativeAudio()) {
            await loadNativeDeck('background', [{ slot: 'original', url: backgroundAudio.currentSrc || backgroundAudio.src, gain: 1 }], backgroundAudio.currentTime);
          }
          await Promise.all([
            ...(usingNativeAudio()
              ? [playNativeBackgroundDeck(backgroundAudio.currentTime)]
              : [backgroundAudio.play()])
          ]);
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
            backgroundStatusOverride = 'Pulsa Reproducir música de fondo para autorizar el audio.';
            return false;
          }
          backgroundFailedIds.add(nextId);
          backgroundPendingId = '';
          backgroundAudio.pause();
          stopNativeDeck('background');
          backgroundAudio.removeAttribute('src');
          backgroundAudio.load();
        }
      }
      backgroundCurrentId = '';
      backgroundPendingId = '';
      prepareBackgroundAnalysis(null);
      backgroundStatusOverride = backgroundFailedIds.size >= backgroundTracks().length
        ? 'Ningún audio de fondo pudo reproducirse. Revisa el formato y pulsa Reintentar.'
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
    if (!playerPreparationReady() || stageMode === 'karaoke' || !backgroundTracks().length) return false;
    const pending = backgroundPending();
    if (!backgroundAudio.src || (!backgroundCurrent() && !pending)) return playNextBackground();
    // A hidden WebKit mirror may be paused while AVAudioEngine continues
    // normally.  Do not restart, seek, or change the native ambient track.
    if (backgroundEngineIsPlaying()) return true;
    if (backgroundAudio.paused || usingNativeAudio()) {
      try {
        await ensureAudioReady('background-resume');
        setBackgroundVolume(backgroundTargetVolume); setBackgroundFade(0);
        if (usingNativeAudio() && !nativeDeckIsLoaded('background')) {
          await loadNativeDeck('background', [{ slot: 'original', url: backgroundAudio.currentSrc || backgroundAudio.src, gain: 1 }], backgroundAudio.currentTime);
        }
        await Promise.all([
          ...(usingNativeAudio()
            ? [playNativeBackgroundDeck(backgroundAudio.currentTime)]
            : [backgroundAudio.play()])
        ]);
        if (pending) {
          backgroundCurrentId = pending.id;
          backgroundPendingId = '';
          lastBackgroundId = pending.id;
          backgroundFailedIds.delete(pending.id);
        }
        backgroundStatusOverride = '';
        await fadeVolume(backgroundAudio, backgroundTargetVolume, FADE_MS, () => stageMode === 'lobby');
        return true;
      } catch {
        backgroundStatusOverride = 'Pulsa Reproducir música de fondo para activar el audio.';
        renderBackground();
        return false;
      }
    }
    return backgroundTransportIsPlaying();
  }

  async function enterLobby({ startBackground = true, clearMedia = false, authorized = false } = {}) {
    if (activePlaybackLocked() && !authorized) {
      recordAudio('ACTIVE_PLAYBACK_MUTATION_BLOCKED', 'WARNING', { action: 'enterLobby', trackId: currentId });
      return false;
    }
    if (transitionBusy && scenePhase === 'to-lobby') return;
    const token = ++transitionToken;
    transitionBusy = true;
    nativeVisualPlaybackExpected = false;
    setScene('lobby', 'to-lobby');
    render();
    const backgroundPromise = startBackground
      ? Promise.race([ensureBackgroundPlaying(), wait(FADE_MS)])
      : Promise.resolve();
    await Promise.all([
      media.src && karaokeTransportIsPlaying() ? fadeKaraokeVolume(0, FADE_MS, () => token === transitionToken) : Promise.resolve(true),
      backgroundPromise
    ]);
    try {
      if (token !== transitionToken) return;
      const pausePosition = karaokeClockPosition();
      if (usingNativeAudio()) setNativeKaraokeTransportIntent(false, pausePosition);
      media.pause();
      instrumentalAudio.pause();
      vocalsAudio.pause();
      if (usingNativeAudio()) await pauseNativeKaraokeDeck(pausePosition);
      else pauseNativeDeck('karaoke');
      nativeKaraokeWasPlaying = false;
      setScene('lobby');
      scheduleRuntimeSave(0);
      if (clearMedia) clearPlayerMedia();
    } finally {
      if (token === transitionToken) { transitionBusy = false; render(); }
    }
    return true;
  }

  async function searchLibrary({ silent = false, append = false, browseAll = false } = {}) {
    const query = $('#playerDirectSearch').value.trim();
    const generation = ++libraryGeneration;
    const requestKey = query;
    if (append && requestKey !== libraryRequestKey) append = false;
    const offset = append ? libraryOffset : 0;
    const list = $('#playerLibraryList');
    const previousScroll = list.scrollTop;
    libraryLoading = true;
    libraryBrowseAll = browseAll || !query;
    if (!silent && !append) list.innerHTML = '<p class="player-empty">Buscando en el índice local…</p>';
    try {
      const data = await api(`/api/player/library?query=${encodeURIComponent(query)}&offset=${offset}&limit=60&all=1&sort=title`);
      if (generation !== libraryGeneration) return;
      const tracks = data.tracks || [];
      libraryTracks = append ? [...libraryTracks, ...tracks] : tracks;
      libraryOffset = libraryTracks.length;
      libraryHasMore = data.hasMore === true;
      libraryRequestKey = requestKey;
      libraryScanAt = String(state?.library?.lastScanAt || '');
      $('#playerLibraryCount').textContent = `${libraryTracks.length} de ${data.total || 0} pistas`;
      const signature = JSON.stringify(libraryTracks);
      if (silent && list.dataset.resultSignature === signature) { libraryLoaded = true; return; }
      list.innerHTML = libraryTracks.length
        ? `${libraryTracks.map((track) => `<button type="button" class="player-library-row" data-library-track="${escapeHtml(track.id)}" title="${escapeHtml(track.name)}"><i class="player-library-icon">${String(track.mediaType).startsWith('video/') ? '▣' : '♫'}</i><span><strong>${escapeHtml(track.song || track.name)}</strong><small>${escapeHtml([track.artist, track.channel, track.provider, Number(track.durationSeconds) > 0 ? formatDuration(track.durationSeconds) : '', track.language, 'Local', track.extension].filter(Boolean).join(' · '))}</small></span><b aria-hidden="true">＋ Fila</b></button>`).join('')}${libraryHasMore ? '<button class="button ghost player-library-more" id="playerLibraryMore" type="button">Cargar 60 más</button>' : ''}`
        : `<p class="player-empty">${query ? 'No hay coincidencias con esa búsqueda.' : 'La biblioteca está vacía. Usa «Escanear biblioteca» para actualizar el índice local.'}</p>`;
      list.dataset.tracks = JSON.stringify(libraryTracks);
      list.dataset.resultSignature = signature;
      list.scrollTop = silent || append ? previousScroll : 0;
      libraryLoaded = true;
    } catch (error) { if (generation === libraryGeneration) { libraryLoaded = false; if (!silent) list.innerHTML = `<p class="player-empty">${escapeHtml(error.message)}</p>`; } }
    finally { if (generation === libraryGeneration) libraryLoading = false; }
  }

  function openLocalLibrary() {
    window.clearTimeout(directSearchTimer);
    window.clearTimeout(librarySearchTimer);
    ++directSearchGeneration;
    $('#playerDirectSearch').value = '';
    closeDirectSearch();
    libraryOpened = true;
    document.body.classList.add('player-library-open');
    $('#playerLocalLibrary').classList.remove('hidden');
    $('#playerLibraryBrowse').setAttribute('aria-expanded', 'true');
    if (!libraryLoaded || libraryRequestKey || libraryScanAt !== String(state?.library?.lastScanAt || '')) void searchLibrary({ browseAll: true });
    $('#playerDirectSearch').focus({ preventScroll: true });
  }

  function closeLocalLibrary() {
    libraryOpened = false;
    document.body.classList.remove('player-library-open');
    $('#playerLocalLibrary').classList.add('hidden');
    $('#playerLibraryBrowse').setAttribute('aria-expanded', 'false');
    $('#playerLibraryBrowse').focus({ preventScroll: true });
  }

  function closeDirectSearch() {
    const input = $('#playerDirectSearch');
    const results = $('#playerDirectResults');
    results?.classList.add('hidden');
    input?.setAttribute('aria-expanded', 'false');
  }

  function renderDirectSearch(message = '') {
    const input = $('#playerDirectSearch');
    const results = $('#playerDirectResults');
    if (!input || !results) return;
    const query = input.value.trim();
    if (!query) { closeDirectSearch(); return; }
    results.innerHTML = directSearchTracks.length
      ? directSearchTracks.slice(0, 6).map((track, index) => `<button type="button" role="option" data-player-direct-track="${index}"><i>${String(track.mediaType || '').startsWith('video/') ? '▣' : '♫'}</i><span><strong>${escapeHtml(track.song || track.name || 'Pista local')}</strong><small>${escapeHtml([track.artist, track.extension, 'Asignar cantante'].filter(Boolean).join(' · '))}</small></span></button>`).join('')
      : `<p>${escapeHtml(message || 'No hay coincidencias locales.')}</p>`;
    results.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
  }

  async function runDirectSearch() {
    const query = $('#playerDirectSearch')?.value.trim() || '';
    const generation = ++directSearchGeneration;
    if (!query) { directSearchTracks = []; closeDirectSearch(); return; }
    renderDirectSearch('Buscando en la biblioteca local…');
    try {
      const data = await api(`/api/player/library?query=${encodeURIComponent(query)}&offset=0&limit=6&all=0`);
      if (generation !== directSearchGeneration) return;
      directSearchTracks = Array.isArray(data.tracks) ? data.tracks.slice(0, 6) : [];
      renderDirectSearch();
    } catch (error) {
      if (generation !== directSearchGeneration) return;
      directSearchTracks = [];
      renderDirectSearch(error.message || 'No se pudo buscar la biblioteca.');
    }
  }

  function openSingerAssignment(track) {
    if (!playerPreparationReady()) { showNotice('Selecciona una actividad y el modo Player antes de asignar un cantante.', true); return; }
    pendingTrack = track;
    $('#playerAssignSong').textContent = track.song || track.name || 'Pista local';
    $('#playerAssignArtist').textContent = track.artist || `${track.extension || ''} · archivo local`;
    $('#playerAssignSinger').value = '';
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
          singer
        })
      });
      assignDialog.close();
      pendingTrack = null;
      sync(await api('/api/state'));
      showNotice(playerReady()
        ? `${singer} fue agregado a la fila. La preparación IA continúa en segundo plano y no retiene la reproducción.`
        : `${singer} fue agregado a la fila y estará listo cuando inicies la actividad.`);
    } catch (error) { showNotice(error.message, true); }
  }

  function recordAudio(event, severity = 'INFO', context = {}) {
    diagnostics?.record?.({ module: 'Audio', severity, event, summary: event.replaceAll('_', ' '), context });
  }

  function startWaveform() {
    window.cancelAnimationFrame(waveformFrame);
    const canvas = $('#playerWaveform');
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;
    if (usingNativeAudio()) {
      const drawNative = (now) => {
        waveformFrame = requestAnimationFrame(drawNative);
        const frameTime = Number(now) || performance.now();
        if (frameTime - nativeWaveformPaintAt < 33) return;
        nativeWaveformPaintAt = frameTime;
        const values = nativeWaveformHistory;
        context.clearRect(0, 0, canvas.width, canvas.height);
        const gradient = context.createLinearGradient(0, canvas.height, 0, 0);
        gradient.addColorStop(0, '#ff2da9'); gradient.addColorStop(1, '#7a5cff');
        context.fillStyle = gradient;
        const width = canvas.width / Math.max(1, values.length || 64);
        const visible = values.length ? values : [0];
        visible.forEach((value, index) => {
          const height = Math.max(2, Math.min(canvas.height, value * canvas.height));
          context.fillRect(index * width, canvas.height - height, Math.max(1, width - 2), height);
        });
      };
      drawNative();
      return;
    }
    if (!analyser) return;
    const values = new Uint8Array(analyser.frequencyBinCount);
    const draw = () => {
      if (!analyser) return;
      waveformFrame = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(values);
      context.clearRect(0, 0, canvas.width, canvas.height);
      const width = canvas.width / values.length;
      const gradient = context.createLinearGradient(0, canvas.height, 0, 0);
      gradient.addColorStop(0, '#ff2da9'); gradient.addColorStop(1, '#7a5cff');
      context.fillStyle = gradient;
      values.forEach((value, index) => {
        const height = Math.max(2, value / 255 * canvas.height);
        context.fillRect(index * width, canvas.height - height, Math.max(1, width - 2), height);
      });
    };
    draw();
  }

  function audioElements() {
    return [media, instrumentalAudio, vocalsAudio, backgroundAudio];
  }

  function ensureAudioEngine() {
    if (usingNativeAudio()) {
      silenceWebKitAudio();
      startWaveform();
      return true;
    }
    if (mediaAudioGraph && audioContext?.state !== 'closed') {
      applyAudioSettings();
      if (playerAudioRecoveryAction(audioContext.state) === 'resume') void recoverAudioEngine('ensure');
      return true;
    }
    if (audioContext?.state === 'closed') {
      void recoverAudioEngine('closed-context');
      return false;
    }
    try {
      const AudioEngine = window.AudioContext || window.webkitAudioContext;
      if (!AudioEngine) throw new Error('Web Audio no está disponible en este navegador.');
      audioContext = new AudioEngine();
      const graph = {
        source: audioContext.createMediaElementSource(media),
        instrumentalSource: audioContext.createMediaElementSource(instrumentalAudio),
        vocalsSource: audioContext.createMediaElementSource(vocalsAudio),
        backgroundSource: audioContext.createMediaElementSource(backgroundAudio),
        bus: audioContext.createGain(),
        normalGain: audioContext.createGain(),
        instrumentalGain: audioContext.createGain(),
        vocalsGain: audioContext.createGain(),
        karaokeAutoGain: audioContext.createGain(),
        backgroundAutoGain: audioContext.createGain(),
        backgroundGain: audioContext.createGain(),
        backgroundFade: audioContext.createGain(),
        pitch: audioContext.createGain(),
        master: audioContext.createGain(),
        karaokeFade: audioContext.createGain(),
        outputMix: audioContext.createGain(),
        finalMaster: audioContext.createGain(),
        destination: audioContext.destination
      };
      graph.low = audioContext.createBiquadFilter();
      graph.low.type = 'lowshelf'; graph.low.frequency.value = 180;
      graph.mid = audioContext.createBiquadFilter();
      graph.mid.type = 'peaking'; graph.mid.frequency.value = 1100; graph.mid.Q.value = 0.85;
      graph.high = audioContext.createBiquadFilter();
      graph.high.type = 'highshelf'; graph.high.frequency.value = 6500;
      graph.analyser = audioContext.createAnalyser(); graph.analyser.fftSize = 256;
      graph.outputAnalyser = audioContext.createAnalyser(); graph.outputAnalyser.fftSize = 1024; graph.outputAnalyser.smoothingTimeConstant = 0.55;
      graph.outputMeterSplitter = audioContext.createChannelSplitter(2);
      graph.outputMeterMerger = audioContext.createChannelMerger(2);
      graph.outputAnalyserLeft = audioContext.createAnalyser(); graph.outputAnalyserLeft.fftSize = 1024; graph.outputAnalyserLeft.smoothingTimeConstant = 0.55;
      graph.outputAnalyserRight = audioContext.createAnalyser(); graph.outputAnalyserRight.fftSize = 1024; graph.outputAnalyserRight.smoothingTimeConstant = 0.55;
      mediaAudioGraph = reconnectPlayerAudioGraph(graph);
      analyser = graph.analyser;
      graph.master.gain.value = mediaTargetVolume;
      graph.karaokeFade.gain.value = karaokeMuted ? 0 : 1;
      graph.backgroundGain.gain.value = backgroundTargetVolume;
      graph.backgroundFade.gain.value = backgroundAudio.paused ? 0 : 1;
      graph.karaokeAutoGain.gain.value = dbToLinear(karaokeAutoGainDb);
      graph.backgroundAutoGain.gain.value = dbToLinear(backgroundAutoGainDb);
      graph.finalMaster.gain.value = dbToLinear(appliedMasterDb);
      audioContext.addEventListener('statechange', () => {
        const contextState = audioContext?.state || 'closed';
        recordAudio('AUDIO_CONTEXT_STATE_CHANGED', ['closed', 'interrupted'].includes(contextState) ? 'WARNING' : 'INFO', { state: contextState });
        diagnostics?.setHealth?.('Audio', contextState === 'running' ? 'OK' : contextState === 'closed' ? 'ERROR' : 'RECOVERING', { state: contextState });
        if (playerAudioRecoveryAction(contextState) !== 'ready' && audioElements().some((element) => !element.paused)) void recoverAudioEngine('statechange');
      });
      applyAudioSettings({ synchronizePlayback: true });
      pitchWorkletPromise = initializePitchWorklets(audioContext, graph);
      startWaveform();
      recordAudio('AUDIO_GRAPH_CREATED', 'INFO', { sources: 4 });
      diagnostics?.setHealth?.('Audio', audioContext.state === 'running' ? 'OK' : 'RECOVERING', { state: audioContext.state });
      return true;
    } catch (error) {
      recordAudio('AUDIO_GRAPH_CREATE_FAILED', 'ERROR', { message: error.message });
      diagnostics?.setHealth?.('Audio', 'ERROR', { message: error.message });
      showNotice(`Guest Star no pudo activar el motor de audio: ${error.message}`, true);
      return false;
    }
  }

  async function initializePitchWorklets(context, graph) {
    if (!context.audioWorklet || typeof AudioWorkletNode !== 'function') {
      pitchWorkletState = 'unsupported'; renderPlaybackProcessing(); return;
    }
    try {
      await context.audioWorklet.addModule('/pitch-shifter-worklet.js');
      if (audioContext !== context || mediaAudioGraph !== graph) return;
      // Keep the gain-node bypass in place until the operator actually changes
      // Key.  Constructing and reconnecting a worklet while tempo is live used
      // to introduce an avoidable discontinuity in the karaoke bus.
      pitchWorkletState = 'ready'; applyAudioSettings(); renderPlaybackProcessing();
      recordAudio('PITCH_WORKLET_READY', 'INFO');
    } catch (error) {
      pitchWorkletState = 'unsupported';
      recordAudio('PITCH_WORKLET_FAILED', 'ERROR', { message: error.message });
      renderPlaybackProcessing();
    }
  }

  function captureMediaState(element) {
    return {
      src: element.getAttribute('src') || '',
      currentTime: Math.max(0, Number(element.currentTime) || 0),
      paused: element.paused,
      volume: element.volume,
      playbackRate: element.playbackRate
    };
  }

  async function rebuildClosedAudioEngine() {
    const snapshots = audioElements().map(captureMediaState);
    window.cancelAnimationFrame(waveformFrame);
    mediaAudioGraph = null; analyser = null; audioContext = null;
    const replace = (element) => {
      const replacement = element.cloneNode(false);
      replacement.removeAttribute('src');
      replacement.removeAttribute('data-diagnostics-observed');
      element.replaceWith(replacement);
      return replacement;
    };
    media = replace(media);
    instrumentalAudio = replace(instrumentalAudio);
    vocalsAudio = replace(vocalsAudio);
    backgroundAudio = replace(backgroundAudio);
    bindMediaEvents();
    audioElements().forEach((element, index) => {
      const snapshot = snapshots[index];
      element.volume = snapshot.volume;
      element.playbackRate = snapshot.playbackRate;
      if (!snapshot.src) return;
      element.src = snapshot.src;
      element.addEventListener('loadedmetadata', () => {
        try { element.currentTime = Math.min(snapshot.currentTime, Number(element.duration) || snapshot.currentTime); } catch { /* Best effort restore. */ }
      }, { once: true });
      element.load();
    });
    if (!ensureAudioEngine()) throw new Error('No se pudo reconstruir el grafo de audio.');
    if (currentAudioOutputId) await applyAudioOutput(currentAudioOutputId, { silent: true });
    await Promise.all(audioElements().map(async (element, index) => {
      if (snapshots[index].paused || !snapshots[index].src) return;
      try { await waitUntilPlayable(element, backgroundGeneration, 5000); await element.play(); } catch { /* The operator can resume explicitly. */ }
    }));
  }

  async function recoverAudioEngine(reason = 'unknown') {
    if (usingNativeAudio()) {
      try {
        const result = await nativeAudioRequest('nativeAudioStatus');
        const nativeState = result.state || {};
        if (nativeState.running === false && (stageMode === 'karaoke' || backgroundTransportIsPlaying())) throw new Error('AVAudioEngine no está en ejecución.');
        recordAudio('NATIVE_AUDIO_RECOVERY_CONFIRMED', 'INFO', { reason, engine: nativeState.engine || 'AVAudioEngine' });
        diagnostics?.setHealth?.('Audio', 'OK', { recovered: true, reason, engine: 'AVAudioEngine' });
        return true;
      } catch (error) {
        recordAudio('NATIVE_AUDIO_RECOVERY_FAILED', 'ERROR', { reason, message: error.message });
        diagnostics?.setHealth?.('Audio', 'ERROR', { reason, message: error.message, engine: 'AVAudioEngine' });
        return false;
      }
    }
    if (audioRecoveryPromise) return audioRecoveryPromise;
    audioRecoveryPromise = (async () => {
      recordAudio('AUDIO_RECOVERY_STARTED', 'WARNING', { reason, state: audioContext?.state || 'missing' });
      try {
        const action = playerAudioRecoveryAction(audioContext?.state || 'closed');
        if (action === 'closed') await rebuildClosedAudioEngine();
        else {
          if (!mediaAudioGraph && !ensureAudioEngine()) throw new Error('El grafo de audio no está disponible.');
          if (audioContext?.state !== 'running') await audioContext?.resume();
          if (mediaAudioGraph?.connected !== true) reconnectPlayerAudioGraph(mediaAudioGraph);
        }
        if (audioContext?.state !== 'running') throw new Error(`AudioContext quedó en estado ${audioContext?.state || 'desconocido'}.`);
        applyAudioSettings({ synchronizePlayback: true });
        recordAudio('AUDIO_RECOVERY_SUCCEEDED', 'INFO', { reason, state: audioContext.state });
        diagnostics?.setHealth?.('Audio', 'OK', { recovered: true, reason });
        return true;
      } catch (error) {
        recordAudio('AUDIO_RECOVERY_FAILED', 'ERROR', { reason, message: error.message });
        diagnostics?.setHealth?.('Audio', 'ERROR', { reason, message: error.message });
        return false;
      } finally { audioRecoveryPromise = null; }
    })();
    return audioRecoveryPromise;
  }

  async function ensureAudioReady(reason) {
    if (usingNativeAudio()) return true;
    if (!ensureAudioEngine() || audioContext?.state !== 'running') {
      const recovered = await recoverAudioEngine(reason);
      if (!recovered) throw new Error('El motor de audio no respondió. Intenta reproducir nuevamente.');
    }
    await pitchWorkletPromise;
    return true;
  }

  function audioOutputCapability() {
    const AudioEngine = window.AudioContext || window.webkitAudioContext;
    const webSupported = playerAudioOutputSupported(AudioEngine, navigator.mediaDevices);
    const nativeSupported = nativeAudioBridge();
    const supported = webSupported || nativeSupported;
    return Promise.resolve({
      supported,
      mode: nativeSupported ? 'coreaudio' : webSupported ? 'webkit' : 'none',
      reason: supported ? '' : 'Esta versión de WebKit no permite seleccionar una salida de audio y el bridge nativo no está disponible.'
    });
  }

  async function listAudioOutputs() {
    const capability = await audioOutputCapability();
    if (!capability.supported) return [];
    if (capability.mode === 'coreaudio') {
      const result = await nativeAudioRequest('listAudioOutputs');
      return Array.isArray(result.devices) ? result.devices : [];
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter((device) => device.kind === 'audiooutput').map((device, index) => ({
      deviceId: device.deviceId,
      groupId: device.groupId || '',
      label: device.label || `Salida de audio ${index + 1}`
    }));
  }

  async function applyAudioOutput(deviceId = '', { silent = false } = {}) {
    const target = String(deviceId || '');
    const capability = await audioOutputCapability();
    if (!capability.supported) {
      audioOutputLost = Boolean(target);
      return { ok: target === '', supported: false, error: target ? capability.reason : '' };
    }
    if (capability.mode === 'coreaudio') {
      try {
        const result = await nativeAudioRequest('setAudioOutput', { deviceId: target });
        currentAudioOutputId = target ? String(result.deviceId || target) : '';
        audioOutputLost = false;
        recordAudio('AUDIO_OUTPUT_CHANGED_NATIVE', 'INFO', { deviceId: currentAudioOutputId ? '[selected-device]' : 'default' });
        diagnostics?.setHealth?.('Audio Output', 'OK', { selected: Boolean(target), engine: 'AVAudioEngine' });
        return { ok: true, supported: true, deviceId: currentAudioOutputId, native: true };
      } catch (error) {
        audioOutputLost = Boolean(target);
        recordAudio('AUDIO_OUTPUT_CHANGE_FAILED_NATIVE', 'ERROR', { message: error.message });
        return { ok: false, supported: true, error: error.message };
      }
    }
    if (!ensureAudioEngine()) await recoverAudioEngine('output-change');
    try {
      if (!audioContext || typeof audioContext.setSinkId !== 'function') throw new Error(capability.reason);
      await audioContext.setSinkId(target);
      currentAudioOutputId = target;
      audioOutputLost = false;
      recordAudio('AUDIO_OUTPUT_CHANGED', 'INFO', { deviceId: target ? '[selected-device]' : 'default' });
      diagnostics?.setHealth?.('Audio Output', 'OK', { selected: Boolean(target) });
      return { ok: true, supported: true, deviceId: target };
    } catch (error) {
      recordAudio('AUDIO_OUTPUT_CHANGE_FAILED', 'ERROR', { message: error.message });
      audioOutputLost = Boolean(target);
      try {
        await audioContext?.setSinkId?.('');
        currentAudioOutputId = '';
        diagnostics?.setHealth?.('Audio Output', 'WARNING', { fallback: 'default', message: error.message });
        if (!silent) showNotice('La salida elegida no está disponible. Guest Star volvió a la salida predeterminada.', true);
      } catch { diagnostics?.setHealth?.('Audio Output', 'ERROR', { message: error.message }); }
      return { ok: false, supported: true, fallback: true, error: error.message };
    }
  }

  function setKaraokeVolume(value) {
    const level = Math.max(0, Math.min(1, Number(value) || 0));
    if (usingNativeAudio()) {
      nativeKaraokeGain = level;
      configureNativeDeck('karaoke', { volume: level });
      return;
    }
    if (mediaAudioGraph) {
      mediaAudioGraph.master.gain.value = mediaTargetVolume;
      mediaAudioGraph.karaokeFade.gain.value = mediaTargetVolume > 0 ? Math.min(1, level / mediaTargetVolume) : 0;
    }
    else media.volume = level;
  }

  function setBackgroundVolume(value) {
    const level = Math.max(0, Math.min(1, Number(value) || 0));
    if (usingNativeAudio()) {
      nativeBackgroundGain = level;
      configureNativeDeck('background', { volume: level });
      return;
    }
    backgroundAudio.volume = 1;
    if (mediaAudioGraph?.backgroundGain) mediaAudioGraph.backgroundGain.gain.value = level;
  }

  function setBackgroundFade(value) {
    if (usingNativeAudio()) {
      nativeBackgroundGain = backgroundTargetVolume * Math.max(0, Math.min(1, Number(value) || 0));
      configureNativeDeck('background', { volume: nativeBackgroundGain });
      return;
    }
    if (mediaAudioGraph?.backgroundFade) mediaAudioGraph.backgroundFade.gain.value = Math.max(0, Math.min(1, Number(value) || 0));
  }

  async function fadeKaraokeVolume(target, duration = FADE_MS, valid = () => true) {
    const fadeGeneration = ++karaokeFadeGeneration;
    const isValid = () => fadeGeneration === karaokeFadeGeneration && valid();
    ensureAudioEngine();
    const destination = Math.max(0, Math.min(1, Number(target) || 0));
    if (usingNativeAudio()) {
      const origin = nativeKaraokeGain;
      if (duration <= 0 || Math.abs(origin - destination) < 0.002) { if (isValid()) setKaraokeVolume(destination); return isValid(); }
      const startedAt = performance.now();
      return new Promise((resolve) => {
        const frame = (now) => {
          if (!isValid()) { resolve(false); return; }
          const progress = Math.min(1, Math.max(0, (now - startedAt) / duration));
          setKaraokeVolume(origin + (destination - origin) * (0.5 - Math.cos(Math.PI * progress) / 2));
          if (progress < 1) requestAnimationFrame(frame); else resolve(true);
        };
        requestAnimationFrame(frame);
      });
    }
    if (mediaAudioGraph) mediaAudioGraph.master.gain.value = mediaTargetVolume;
    const destinationFade = mediaAudioGraph ? fadeGainForVolume(mediaTargetVolume, destination) : destination;
    const origin = mediaAudioGraph ? mediaAudioGraph.karaokeFade.gain.value : media.volume;
    if (duration <= 0 || Math.abs(origin - destinationFade) < 0.002) {
      if (isValid()) setKaraokeVolume(destination);
      return isValid();
    }
    const startedAt = performance.now();
    return new Promise((resolve) => {
      const frame = (now) => {
        if (!isValid()) { resolve(false); return; }
        const progress = Math.min(1, Math.max(0, (now - startedAt) / duration));
        const eased = 0.5 - Math.cos(Math.PI * progress) / 2;
        if (mediaAudioGraph) mediaAudioGraph.karaokeFade.gain.value = origin + (destinationFade - origin) * eased;
        else media.volume = origin + (destinationFade - origin) * eased;
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
    lockedStemEngine = '';
    lockedStemFormat = '';
    lockedStemRequestId = '';
  }

  function lockStemSourceForCurrent() {
    const requestId = String(currentId || '');
    if (!requestId) return 'original';
    if (lockedStemEngine && lockedStemRequestId === requestId) return lockedStemEngine;
    if (lockedStemRequestId && lockedStemRequestId !== requestId) clearStemMedia();
    const item = current();
    const candidates = [
      item?.stem?.lockedSource,
      item?.stem?.engine,
      item?.stem?.source,
      item?.stem?.readyEngine,
      item?.stem?.selectedEngine
    ].map((value) => String(value || '').toLowerCase());
    const engine = item?.stem?.ready === true
      ? candidates.find((value) => ['spleeter', 'demucs'].includes(value)) || ''
      : '';
    lockedStemEngine = engine || 'original';
    lockedStemFormat = engine && item?.stem?.format === 'gsx' ? 'gsx' : 'legacy';
    lockedStemRequestId = requestId;
    if (engine) {
      instrumentalAudio.src = karaokeStemSource(requestId, 'instrumental', engine);
      vocalsAudio.src = karaokeStemSource(requestId, 'vocals', engine);
      instrumentalAudio.load();
      vocalsAudio.load();
    }
    applyAudioSettings({ synchronizePlayback: true });
    diagnostics?.record?.({
      module: 'Stems IA',
      event: 'STEM_SOURCE_LOCKED',
      summary: `Fuente ${lockedStemEngine} bloqueada al iniciar reproducción`,
      engine: lockedStemEngine,
      context: { requestId }
    });
    return lockedStemEngine;
  }

  function lockedStemSourceReady(requestId = currentId) {
    return Boolean(
      ['spleeter', 'demucs'].includes(lockedStemEngine) &&
      lockedStemRequestId === String(requestId || '') &&
      instrumentalAudio.getAttribute('src') &&
      vocalsAudio.getAttribute('src')
    );
  }

  function pauseStemTracks() {
    instrumentalAudio.pause();
    vocalsAudio.pause();
  }

  async function resumeStemTracks() {
    if (usingNativeAudio()) return;
    if (!lockedStemSourceReady() || media.paused || stageMode !== 'karaoke' || transitionBusy) return;
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
    if (!lockedStemSourceReady()) return;
    const now = performance.now();
    if (!force && now - lastStemSyncAt < 750) return;
    lastStemSyncAt = now;
    for (const element of [instrumentalAudio, vocalsAudio]) {
      try {
        const drift = (media.currentTime || 0) - (element.currentTime || 0);
        if (force || Math.abs(drift) > 0.45) {
          element.currentTime = Math.max(0, media.currentTime || 0);
        }
      } catch { /* Metadata will align both tracks as soon as it is available. */ }
    }
  }

  function clearPlayerMedia() {
    if (activePlaybackLocked()) {
      recordAudio('ACTIVE_PLAYBACK_MUTATION_BLOCKED', 'WARNING', { action: 'clearPlayerMedia', trackId: currentId });
      return false;
    }
    analysisGeneration += 1;
    karaokeMediaRequestId = '';
    nativeKaraokeDeckRequestId = '';
    currentAnalysis = null;
    currentLoudness = null;
    applyAutoGain();
    window.clearTimeout(karaokeTempoTimer);
    window.clearTimeout(nativeVisualSeekTimer);
    karaokeTempoTimer = 0;
    cancelPendingKaraokeSeek();
    nativeVisualSeekPending = false;
    nativeVisualSeekUntil = 0;
    nativeVisualPlaybackExpected = false;
    nativeVisualPlayPending = false;
    nativeVisualPlayRetryAt = 0;
    nativeKaraokeWasPlaying = false;
    setNativeKaraokeTransportIntent(false, 0);
    tempoPercent = 100;
    karaokeTempoLocked = false;
    keySemitones = 0;
    intentionalMediaReset = true;
    media.pause(); media.removeAttribute('src'); media.load();
    stopNativeDeck('karaoke');
    clearStemMedia();
    lockedStemEngine = '';
    lockedStemFormat = '';
    resetPlayerProgress();
    window.setTimeout(() => { intentionalMediaReset = false; }, 0);
    return true;
  }

  function clearBackgroundMedia() {
    backgroundAnalysisGeneration += 1;
    backgroundAnalysis = null;
    backgroundLoudness = null;
    applyAutoGain();
    window.clearTimeout(backgroundTempoTimer);
    backgroundTempoTimer = 0;
    intentionalBackgroundReset = true;
    backgroundAudio.pause(); backgroundAudio.removeAttribute('src'); backgroundAudio.load();
    stopNativeDeck('background');
    window.setTimeout(() => { intentionalBackgroundReset = false; }, 0);
  }

  async function advance(outcome, requestedId = currentId || queue()[0]?.id, { focusAfterRemoval = false } = {}) {
    const item = requestsById().get(String(requestedId)) || (String(requestedId) === currentId ? current() : null);
    if (!item || !playerReady()) return;
    const queueIdsBefore = queue().map((entry) => String(entry.id));
    const removedIndex = queueIdsBefore.indexOf(String(item.id));
    const nextFocusId = focusAfterRemoval && outcome === 'removed'
      ? (queueIdsBefore[removedIndex + 1] || queueIdsBefore[removedIndex - 1] || '')
      : '';
    const wasCurrent = String(item.id) === currentId;
    if (wasCurrent && transitionBusy) return;
    const playingCurrent = wasCurrent && karaokeTransportIsPlaying();
    const protectedAction = {
      skipped: { detail: 'Esta canción está en reproducción. ¿Saltar al siguiente turno?', confirmLabel: 'Saltar' },
      completed: { detail: 'Esta canción todavía está reproduciéndose. ¿Marcarla como completada?', confirmLabel: 'Ya cantó' },
      removed: { detail: 'Esta canción está reproduciéndose. Quitarla interrumpirá el Player.', confirmLabel: 'Quitar de todas formas' }
    }[outcome];
    if (playingCurrent && protectedAction && !(await confirmAction({ title: 'Canción en reproducción', ...protectedAction }))) return;
    if (wasCurrent) await enterLobby({ authorized: true });
    try {
      await api(`/api/player/requests/${encodeURIComponent(item.id)}/outcome`, { method: 'POST', body: JSON.stringify({ outcome }) });
      order = order.filter((id) => id !== String(item.id));
      if (wasCurrent) { releaseActivePlayback(item.id); currentId = ''; clearPlayerMedia(); }
      saveOrder({ remote: true });
      sync(await api('/api/state'));
      if (!wasCurrent) render();
      if (nextFocusId) window.requestAnimationFrame(() => {
        document.querySelector(`[data-player-row="${CSS.escape(nextFocusId)}"] .player-queue-select`)?.focus();
      });
      showNotice(`${guest(item)} — ${item.song} · ${{ removed: 'quitada de la fila', skipped: 'omitida', completed: 'ya cantó' }[outcome] || outcome}`, false, { label: 'Deshacer', run: () => undoOutcome(item.id) });
    } catch (error) { showNotice(error.message, true); }
  }

  async function clearPendingQueue() {
    const items = queue();
    if (!items.length || transitionBusy) return;
    const stopsCurrentSong = Boolean(currentId && karaokeTransportIsPlaying());
    if (!(await confirmAction({
      title: '¿Limpiar la cola pendiente?',
      detail: `Se quitarán ${items.length} ${items.length === 1 ? 'turno pendiente' : 'turnos pendientes'} y pasarán al historial como retirados.${stopsCurrentSong ? ' La canción actual se detendrá.' : ''} Las canciones ya completadas, el historial y la configuración no cambian.`,
      confirmLabel: 'Limpiar cola'
    }))) return;
    const ids = pendingQueueIds(items);
    const failures = [];
    if (currentId) await enterLobby({ authorized: true });
    for (const id of ids) {
      try {
        await api(`/api/player/requests/${encodeURIComponent(id)}/outcome`, { method: 'POST', body: JSON.stringify({ outcome: 'removed' }) });
      } catch (error) {
        failures.push(error.message || String(error));
      }
    }
    order = order.filter((id) => !ids.includes(String(id)));
    if (currentId && ids.includes(String(currentId))) releaseActivePlayback(currentId);
    currentId = '';
    clearPlayerMedia();
    saveOrder({ remote: true });
    sync(await api('/api/state'));
    if (failures.length) showNotice(`Se limpiaron ${ids.length - failures.length} de ${ids.length} turnos. ${failures[0]}`, true);
    else showNotice(`${ids.length} ${ids.length === 1 ? 'turno pendiente retirado' : 'turnos pendientes retirados'}; el historial se conservó.`);
  }

  function moveQueueItem(id, direction) {
    const moved = movePlayerQueueOrder(queue().map((item) => String(item.id)), id, direction);
    if (!moved.moved) return;
    order = moved.order; saveOrder({ remote: true, queueOnly: true }); renderQueue(); publish();
  }

  async function returnToEnd() {
    if (!currentId || !playerReady()) return;
    const returned = currentId;
    if (karaokeTransportIsPlaying() && !(await confirmAction({
      title: 'Canción en reproducción',
      detail: 'Esta canción está en reproducción. ¿Devolverla a la fila?',
      confirmLabel: 'Devolver'
    }))) return;
    await enterLobby({ authorized: true });
    releaseActivePlayback(returned);
    order = [...order.filter((id) => id !== returned), returned]; currentId = ''; saveOrder({ remote: true });
    clearPlayerMedia(); render();
    showNotice('La canción volvió al final de la fila.');
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

  async function queueStemsForAvailability(item) {
    const id = String(item?.id || '');
    // Local assignments are queued atomically by the server.  Public requests
    // are scheduled here at selection time, still without waiting for them.
    if (!id || item?.sourceType === 'player_local' || !item?.localAvailable || !state?.stemEngine?.available || item.stem || automaticStemRequestIds.has(id)) return;
    automaticStemRequestIds.add(id);
    try {
      const result = await api(`/api/player/requests/${encodeURIComponent(id)}/stems`, {
        method: 'POST', body: JSON.stringify({ engine: 'auto' })
      });
      if (result?.stem) item.stem = result.stem;
      recordAudio('STEMS_AUTO_QUEUED', 'INFO', { requestId: id });
      render();
    } catch (error) {
      recordAudio('STEMS_AUTO_QUEUE_FAILED', 'WARNING', { requestId: id, message: error.message });
    }
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

  function setInlineSummaryExpanded(expanded) {
    const panel = $('#playerSummaryInline');
    const button = document.querySelector('[data-player-drawer="summary"]');
    if (!panel || !button) return;
    panel.classList.toggle('is-expanded', expanded);
    button.setAttribute('aria-expanded', String(expanded));
    button.setAttribute('aria-label', expanded ? 'Ocultar resumen de la actividad' : 'Mostrar resumen de la actividad');
    button.title = expanded ? 'Ocultar resumen de la actividad' : 'Mostrar resumen de la actividad';
  }

  function openDrawer(name) {
    if (name === 'summary') {
      setInlineSummaryExpanded(!$('#playerSummaryInline')?.classList.contains('is-expanded'));
      return;
    }
    closeDrawers();
    const panel = document.querySelector(`[data-player-drawer-panel="${name}"]`);
    if (!panel) return;
    panel.classList.add('is-open');
    document.body.classList.add('player-drawer-open');
    if (name === 'library') window.setTimeout(() => $('#playerDirectSearch').focus(), 30);
  }

  function sync(next) {
    const previousActivity = activityId();
    const wasPreparationReady = playerPreparationReady();
    const previousLibraryScanAt = lastLibraryScanAt;
    state = next;
    lastLibraryScanAt = String(state?.library?.lastScanAt || '');
    if (previousActivity !== activityId()) {
      setInlineSummaryExpanded(true);
      if (!activePlaybackLocked()) {
        transitionToken += 1; backgroundGeneration += 1; transitionBusy = false; backgroundTransition = null;
        currentId = ''; setScene('lobby'); clearPlayerMedia(); clearBackgroundMedia();
      }
      backgroundCurrentId = ''; backgroundPendingId = ''; backgroundShuffle = []; backgroundFailedIds.clear(); backgroundStatusOverride = ''; libraryLoaded = false; planBItems = []; planBSelectionMade = false; activePlanBList = 'both';
      pendingOrderSignature = ''; pendingVisibilitySignature = '';
      starScreenExpected = false; starScreenLastHeartbeatAt = 0; starScreenHeartbeatVisible = false;
      loadOrder();
    } else {
      const remoteOrder = state?.playerRuntime?.queueOrder;
      if (Array.isArray(remoteOrder)) {
        const choice = choosePlayerQueueOrder({ remoteOrder, localOrder: order, pendingSignature: pendingOrderSignature });
        order = choice.order;
        if (choice.acknowledgedPending) pendingOrderSignature = '';
        localStorage.setItem(storageKey(), JSON.stringify(order));
      }
      const remoteVisibility = state?.playerRuntime?.queueVisibility;
      if (remoteVisibility && typeof remoteVisibility === 'object' && !Array.isArray(remoteVisibility)) {
        const normalized = Object.fromEntries(Object.entries(remoteVisibility).map(([id, visible]) => [String(id), visible !== false]));
        const remoteSignature = visibilitySignature(normalized);
        if (!pendingVisibilitySignature || pendingVisibilitySignature === remoteSignature) {
          queueVisibility = normalized;
          if (pendingVisibilitySignature === remoteSignature) pendingVisibilitySignature = '';
          localStorage.setItem(visibilityStorageKey(), JSON.stringify(queueVisibility));
        }
      }
    }
    const configuredOutput = String(state?.config?.audioOutputDeviceId || '');
    if (configuredOutput !== lastRequestedAudioOutputId) {
      lastRequestedAudioOutputId = configuredOutput;
      window.setTimeout(() => void applyAudioOutput(configuredOutput, { silent: true }), 0);
    }
    if (state?.operatingMode?.locked && mode() === 'bridge' && opened) close({ force: true });
    if (!playerReady() && !activePlaybackLocked()) {
      setScene('lobby'); media.pause(); instrumentalAudio.pause(); vocalsAudio.pause();
    }
    if (!playerPreparationReady() && !activePlaybackLocked()) {
      backgroundAudio.pause();
      if (usingNativeAudio()) stopNativeDeck('background');
    }
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
    if (opened && libraryOpened && libraryLoaded && lastLibraryScanAt && lastLibraryScanAt !== previousLibraryScanAt) window.setTimeout(() => void searchLibrary({ silent: true, browseAll: libraryBrowseAll }), 0);
    if ((!wasPreparationReady && playerPreparationReady()) || (playerPreparationReady() && stageMode === 'lobby' && !backgroundAudio.src)) window.setTimeout(() => void ensureBackgroundPlaying(), 0);
  }

  function reorderQueueItem(id, beforeId) {
    const moved = reorderPlayerQueue(queue().map(item => String(item.id)), id, beforeId);
    if (!moved.moved) return;
    order = moved.order;
    saveOrder({ remote: true, queueOnly: true }); renderQueue(); publish();
  }

  const queueUI = attachPlayerQueueUI($('#playerQueue'), {
    reorder: reorderQueueItem,
    move: moveQueueItem,
    closeOptions: () => { expandedRequestIds.clear(); renderQueue(); }
  });

  function handleQueueClick(event) {
    const expand = event.target.closest('[data-player-expand]');
    if (expand) {
      const id = String(expand.dataset.playerExpand || '');
      if (expandedRequestIds.has(id)) expandedRequestIds.delete(id);
      else { expandedRequestIds.clear(); expandedRequestIds.add(id); }
      renderQueue();
      return;
    }
    const youtubeSearch = event.target.closest('[data-player-youtube-search]');
    if (youtubeSearch) { void searchPlayerYoutube(youtubeSearch.dataset.playerYoutubeSearch); return; }
    const youtubeCopy = event.target.closest('[data-player-youtube-copy]');
    if (youtubeCopy) { void copyPlayerYoutube(youtubeCopy.dataset.playerYoutubeCopy, youtubeCopy.dataset.playerYoutubeUrl); return; }
    const youtubeOpen = event.target.closest('[data-player-youtube-open]');
    if (youtubeOpen) { void openPlayerYoutube(youtubeOpen.dataset.playerYoutubeOpen); return; }
    const move = event.target.closest('[data-player-move]');
    if (move) { moveQueueItem(move.dataset.playerId, Number(move.dataset.playerMove)); return; }
    const visibility = event.target.closest('[data-player-visibility]');
    if (visibility) {
      const id = String(visibility.dataset.playerVisibility || '');
      queueVisibility[id] = !visibleOnStarScreen({ id });
      saveOrder({ remote: true }); renderQueue(); publish();
      diagnostics?.record?.({ module: 'Queue', event: 'STAR_SCREEN_VISIBILITY_CHANGED', summary: `${queueVisibility[id] ? 'Mostrada' : 'Oculta'} solo en Star Screen`, context: { requestId: id, visible: queueVisibility[id] } });
      return;
    }
    const outcome = event.target.closest('[data-player-row-outcome]');
    if (outcome) { void advance(outcome.dataset.playerRowOutcome, outcome.dataset.playerId); return; }
    const id = event.target.closest('[data-player-request]')?.dataset.playerRequest;
    if (id) void loadRequest(id, false);
  }
  $('#playerQueue').addEventListener('click', handleQueueClick);
  queueUI.options.addEventListener('click', handleQueueClick);
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
    const copy = event.target.closest('[data-player-plan-b-copy]');
    if (copy) {
      void navigator.clipboard.writeText(copy.dataset.playerPlanBCopy || '').then(() => showNotice('Enlace de YouTube copiado.')).catch((error) => showNotice(error.message, true));
      return;
    }
    const open = event.target.closest('[data-player-plan-b-open]');
    if (open) void openPlayerYoutube(open.dataset.playerPlanBOpen);
  });
  queueUI.options.addEventListener('toggle', (event) => {
    const details = event.target.closest?.('[data-player-youtube-details]');
    if (!details) return;
    if (details.open) openYoutubeIds.add(details.dataset.playerYoutubeDetails);
    else openYoutubeIds.delete(details.dataset.playerYoutubeDetails);
  }, true);
  $('#playerCompleted').addEventListener('click', (event) => { const id = event.target.closest('[data-player-undo]')?.dataset.playerUndo; if (id) void undoOutcome(id); });
  $('#playerPlay').addEventListener('click', async () => {
    if (!playerReady()) return showNotice('Inicia la actividad en modo Player antes de reproducir.', true);
    if (karaokeTransportIsPlaying()) await pauseKaraoke(); else await startKaraoke();
  });
  $('#playerRestart').addEventListener('click', () => void restartKaraoke());
  $('#playerReturn').addEventListener('click', () => void returnToEnd());
  $('#playerSkip').addEventListener('click', () => void advance('skipped'));
  $('#playerComplete').addEventListener('click', () => void advance('completed'));
  $('#playerRemove').addEventListener('click', () => void advance('removed'));
  $('#playerClearQueue').addEventListener('click', () => void clearPendingQueue());
  $('#playerOpenStarScreen').addEventListener('click', async () => {
    if (!playerPreparationReady()) return showNotice('Selecciona una actividad y el modo Player antes de abrir Star Screen.', true);
    starScreenExpected = true;
    const nativeHandler = window.webkit?.messageHandlers?.guestStarNative;
    if (nativeHandler?.postMessage) {
      nativeHandler.postMessage({
        action: 'openStarScreen',
        displayId: state?.config?.starScreenDisplayId || '',
        url: '/star-screen.html?display=1&visual=canonical-canvas-7',
        preview: false
      });
      diagnostics?.record?.({ module: 'Star Screen', event: 'STAR_SCREEN_NATIVE_OPEN_REQUESTED', summary: 'Star Screen solicitada al host nativo', context: { configuredDisplay: Boolean(state?.config?.starScreenDisplayId) } });
      return;
    }
    try {
      const result = await api('/api/player/star-screen/open', { method: 'POST', body: '{}' });
      showNotice(result.reused ? 'La ventana de Star Screen volvió al frente.' : 'Star Screen se abrió en una ventana del navegador; dentro de Guest Star.app se usa el destino nativo configurado.');
    } catch (error) { showNotice(error.message, true); }
  });
  $('#playerDirectSearch').addEventListener('input', () => {
    window.clearTimeout(directSearchTimer);
    window.clearTimeout(librarySearchTimer);
    if (libraryOpened) {
      ++directSearchGeneration;
      closeDirectSearch();
      ++libraryGeneration;
      libraryLoading = false;
      librarySearchTimer = window.setTimeout(() => void searchLibrary(), 180);
    } else {
      directSearchTimer = window.setTimeout(() => void runDirectSearch(), 240);
    }
  });
  $('#playerDirectSearch').addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (libraryOpened) closeLocalLibrary(); else { closeDirectSearch(); event.currentTarget.blur(); }
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (libraryOpened) { window.clearTimeout(librarySearchTimer); void searchLibrary(); }
      else void runDirectSearch();
    }
  });
  $('#playerDirectResults').addEventListener('click', (event) => {
    const raw = event.target.closest('[data-player-direct-track]')?.dataset.playerDirectTrack;
    if (raw === undefined) return;
    const track = directSearchTracks[Number(raw)];
    if (!track) return;
    closeDirectSearch();
    openSingerAssignment(track);
  });
  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.player-direct-search')) closeDirectSearch();
  });
  $('#playerLibraryBrowse').addEventListener('click', () => libraryOpened ? closeLocalLibrary() : openLocalLibrary());
  $('#playerLibraryClose').addEventListener('click', closeLocalLibrary);
  $('#playerLocalLibrary').addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.preventDefault(); closeLocalLibrary(); } });
  $('#playerLibraryList').addEventListener('click', (event) => {
    if (event.target.closest('#playerLibraryMore')) { if (!libraryLoading) void searchLibrary({ append: true, browseAll: libraryBrowseAll }); return; }
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
    if (!transitionBusy && karaokeTransportIsPlaying()) setKaraokeVolume(karaokeMuted ? 0 : mediaTargetVolume);
    $('#playerMute').textContent = karaokeMuted ? '🔇 Silenciado' : '🔊 Audio';
    publish();
  });
  $('#playerVolume').addEventListener('input', (event) => {
    mediaTargetVolume = Math.max(0, Math.min(1, Number(event.target.value)));
    if (mediaTargetVolume > 0) karaokeMuted = false;
    if (!transitionBusy) setKaraokeVolume(karaokeMuted ? 0 : mediaTargetVolume);
    $('#playerMute').textContent = karaokeMuted || mediaTargetVolume === 0 ? '🔇 Silenciado' : '🔊 Audio';
    renderKaraokeVolume();
    publish();
  });
  for (const band of ['low', 'mid', 'high']) {
    const title = band[0].toUpperCase() + band.slice(1);
    const input = $(`#playerEq${title}`);
    const shell = input.closest('.player-knob-shell');
    const updateBand = (value) => {
      input.value = String(Math.max(-12, Math.min(12, Math.round(Number(value) || 0))));
      ensureAudioEngine();
      void ensureAudioReady('eq-change');
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
    if (backgroundTransportIsPlaying()) {
      backgroundUiTransportIntent = false;
      backgroundUserPaused = true;
      backgroundStatusOverride = 'Pausada';
      renderBackground(); publish();
      try {
        if (await fadeVolume(backgroundAudio, 0, 420)) {
          backgroundAudio.pause();
          if (usingNativeAudio()) await pauseNativeBackgroundDeck();
          else pauseNativeDeck('background');
        }
      } finally {
        backgroundUiTransportIntent = null;
        backgroundStatusOverride = '';
        renderBackground(); publish();
      }
    } else {
      backgroundUiTransportIntent = true;
      backgroundUserPaused = false;
      backgroundStatusOverride = 'Iniciando música de fondo…';
      renderBackground(); publish();
      try {
        const started = !backgroundAudio.src || !backgroundCurrent()
          ? await playNextBackground({ resetFailures: backgroundFailedIds.size >= backgroundTracks().length })
          : await ensureBackgroundPlaying();
        if (!started && !backgroundStatusOverride) backgroundStatusOverride = 'No se pudo iniciar la música de fondo.';
      } finally {
        backgroundUiTransportIntent = null;
        if (backgroundTransportIsPlaying()) backgroundStatusOverride = '';
        renderBackground(); publish();
      }
    }
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
    if (!backgroundTransition && backgroundTransportIsPlaying()) setBackgroundVolume(backgroundTargetVolume);
    $('#playerBackgroundVolumeValue').textContent = `${Math.round(backgroundTargetVolume * 100)}%`;
    paintRange(event.currentTarget);
    publish();
  });
  $('#playerBackgroundVolume').addEventListener('change', async () => {
    try { state = await api('/api/player/background/config', { method: 'POST', body: JSON.stringify({ volume: backgroundTargetVolume }) }); renderBackground(); }
    catch (error) { showNotice(error.message, true); }
  });
  function bindAutoGainControl(id, key, { checkbox = false } = {}) {
    const control = $(`#${id}`);
    if (!control) return;
    control.addEventListener('input', (event) => {
      autoGainSettings = normalizeAutoGainSettings({
        ...autoGainSettings,
        [key]: checkbox ? event.currentTarget.checked : Number(event.currentTarget.value)
      });
      persistAutoGainSettings();
      applyAutoGain();
    });
  }
  bindAutoGainControl('preferenceAutoGain', 'enabled', { checkbox: true });
  bindAutoGainControl('preferenceTargetLufs', 'targetLufs');
  bindAutoGainControl('preferenceMaxBoost', 'maxBoostDb');
  bindAutoGainControl('preferenceMaxAttenuation', 'maxAttenuationDb');
  bindAutoGainControl('preferenceTruePeakCeiling', 'truePeakCeilingDbtp');
  bindAutoGainControl('playerMasterVolume', 'masterDb');
  $('#preferenceAutoGainReanalyze')?.addEventListener('click', () => {
    if (currentId) void requestLoudness('karaoke', currentId, { force: true });
    const backgroundId = backgroundPendingId || backgroundCurrentId;
    if (backgroundId) void requestLoudness('background', backgroundId, { force: true });
  });
  function setKaraokeTempo(nextValue, { immediate = false } = {}) {
    tempoPercent = normalizeTempoPercent(nextValue);
    // Keep the label immediate, but coalesce pointer events before asking
    // WebKit to retune its time-stretcher.  Background and pitch are untouched.
    scheduleKaraokeTempoApplication({ immediate });
    renderPlaybackProcessing();
  }
  function setBackgroundTempo(nextValue, { immediate = false } = {}) {
    backgroundTempoPercent = normalizeTempoPercent(nextValue);
    audioSettings.backgroundTempoPercent = backgroundTempoPercent;
    persistAudioSettings();
    // The ambient deck has its own rate and never reconfigures karaoke/stems.
    scheduleBackgroundTempoApplication({ immediate });
    renderPlaybackProcessing();
  }
  $('#playerTempo').addEventListener('input', (event) => { if (!karaokeTempoLocked) setKaraokeTempo(event.target.value); });
  $('#playerTempo').addEventListener('change', () => scheduleKaraokeTempoApplication({ immediate: true }));
  $('#playerTempoDown').addEventListener('click', () => { if (!karaokeTempoLocked) setKaraokeTempo(nextTempoPercent(tempoPercent, -1)); });
  $('#playerTempoReset').addEventListener('click', () => setKaraokeTempo(100, { immediate: true }));
  $('#playerTempoUp').addEventListener('click', () => { if (!karaokeTempoLocked) setKaraokeTempo(nextTempoPercent(tempoPercent, 1)); });
  $('#playerTempoLock').addEventListener('change', (event) => { karaokeTempoLocked = event.target.checked; renderPlaybackProcessing(); publish(); });
  function changeKeySemitones(nextValue) {
    keySemitones = Math.max(-6, Math.min(6, Math.round(Number(nextValue) || 0)));
    applyPitchProcessing(); renderPlaybackProcessing(); publish();
  }
  $('#playerKeyDown').addEventListener('click', () => changeKeySemitones(nextSemitone(keySemitones, -1)));
  $('#playerKeyReset').addEventListener('click', () => changeKeySemitones(0));
  $('#playerKeyUp').addEventListener('click', () => changeKeySemitones(nextSemitone(keySemitones, 1)));
  $('#playerKeyReanalyze').addEventListener('click', () => {
    const item = current();
    if (!item?.localAvailable) return;
    const requestId = currentId;
    const analysisKey = trackAnalysisKey(requestId, item);
    analysisCache.delete(analysisKey);
    analysisTasks.delete(analysisKey);
    currentAnalysis = { pending: true };
    renderPlaybackProcessing();
    void analyzeCurrentTrack(requestId, karaokeMediaSource(requestId), analysisKey);
  });
  $('#playerBackgroundTempo').addEventListener('input', (event) => { if (!backgroundTempoLocked) setBackgroundTempo(event.target.value); });
  $('#playerBackgroundTempo').addEventListener('change', () => scheduleBackgroundTempoApplication({ immediate: true }));
  $('#playerBackgroundTempoDown').addEventListener('click', () => { if (!backgroundTempoLocked) setBackgroundTempo(nextTempoPercent(backgroundTempoPercent, -1)); });
  $('#playerBackgroundTempoReset').addEventListener('click', () => setBackgroundTempo(100, { immediate: true }));
  $('#playerBackgroundTempoUp').addEventListener('click', () => { if (!backgroundTempoLocked) setBackgroundTempo(nextTempoPercent(backgroundTempoPercent, 1)); });
  $('#playerBackgroundTempoLock').addEventListener('change', (event) => {
    backgroundTempoLocked = event.target.checked;
    audioSettings.backgroundTempoLocked = backgroundTempoLocked;
    persistAudioSettings(); renderPlaybackProcessing(); publish();
  });
  $('#playerSeek').addEventListener('input', (event) => {
    const position = Number(event.target.value);
    karaokeScrubPreview = position;
    paintRange(event.currentTarget);
    $('#playerCurrentTime').textContent = formatDuration(position, true);
    if (!karaokeSeekPointerActive) void seekKaraokeTransport(position);
  });
  $('#playerSeek').addEventListener('pointerdown', () => { karaokeSeekPointerActive = true; });
  $('#playerSeek').addEventListener('pointercancel', () => { karaokeSeekPointerActive = false; karaokeScrubPreview = null; renderNow(); });
  $('#playerSeek').addEventListener('pointerup', () => { karaokeSeekPointerActive = false; });
  $('#playerSeek').addEventListener('change', (event) => {
    void seekKaraokeTransport(Number(event.currentTarget.value));
  });
  function bindMediaEvents() {
    media.addEventListener('play', () => {
      void ensureAudioReady('media-play').catch((error) => showNotice(error.message, true));
      renderNow(); renderOperations(); publish(); scheduleRuntimeSave(100);
    });
    media.addEventListener('pause', () => {
      pauseStemTracks();
      // AVAudioEngine owns transport in native mode. WebKit can pause a muted
      // visual follower while decoding or seeking; it must not stop audio.
      if (!usingNativeAudio()) pauseNativeDeck('karaoke');
      renderNow(); renderOperations(); publish(); scheduleRuntimeSave(100);
    });
    for (const type of ['waiting', 'stalled']) {
      media.addEventListener(type, () => {
        pauseStemTracks();
        recordAudio(`KARAOKE_${type.toUpperCase()}`, 'WARNING', { readyState: media.readyState, currentTime: media.currentTime });
        diagnostics?.setHealth?.('Player', 'WARNING', { event: type });
      });
    }
    media.addEventListener('seeking', () => {
      pauseStemTracks();
      // In native mode this element is metadata-only.  All user seeks travel
      // through seekKaraokeTransport(), which has a request/reply and a song
      // generation.  Letting a late WebKit seeking event issue another command
      // was the source of stale seeks after pause and song changes.
      if (usingNativeAudio()) return;
    });
    media.addEventListener('playing', () => {
      diagnostics?.setHealth?.('Player', 'OK', { playing: true });
      void resumeStemTracks();
    });
    media.addEventListener('seeked', () => { syncStemTimes(true); void resumeStemTracks(); });
    const metadataChanged = () => {
      if (pendingResumeTime !== null) {
        const restored = Math.min(Math.max(0, pendingResumeTime), Math.max(0, Number(media.duration) || pendingResumeTime));
        karaokePendingStartPosition = restored;
        setVisualClockPosition(media, restored);
        pendingResumeTime = null;
      }
      syncStemTimes(true);
      renderNow(); publish(); scheduleRuntimeSave(100);
    };
    media.addEventListener('loadedmetadata', metadataChanged);
    media.addEventListener('durationchange', metadataChanged);
    media.addEventListener('canplay', () => { $('#playerMediaStatus').textContent = 'Video listo'; publish(); });
    media.addEventListener('timeupdate', () => {
      if (usingNativeAudio()) return;
      renderNow(); publish(); syncStemTimes(false);
      if (Date.now() - lastRuntimeCheckpoint >= 10000) { lastRuntimeCheckpoint = Date.now(); scheduleRuntimeSave(500); }
    });
    media.addEventListener('ended', () => {
      // The muted Player element is never the video renderer in native mode.
      // A late end event from an old WebKit resource cannot be allowed to
      // complete the current native song.
      if (usingNativeAudio()) return;
      nativeVisualPlaybackExpected = false;
      stopNativeDeck('karaoke');
      void advance('completed');
    });
    media.addEventListener('error', () => {
      if (intentionalMediaReset || (!media.currentSrc && !media.getAttribute('src'))) return;
      const detail = { 1: 'reproducción cancelada', 2: 'archivo no disponible', 3: 'formato o códec no compatible', 4: 'formato no compatible' }[media.error?.code] || 'error desconocido';
      recordAudio('KARAOKE_MEDIA_ERROR', 'ERROR', { code: media.error?.code || 0, detail });
      diagnostics?.setHealth?.('Player', 'ERROR', { detail });
      stopNativeDeck('karaoke');
      transitionToken += 1; transitionBusy = false; setScene('lobby'); $('#playerMediaStatus').textContent = `Error: ${detail}`; showNotice(`El video local no pudo reproducirse: ${detail}.`, true); publish(); void ensureBackgroundPlaying();
    });
    instrumentalAudio.addEventListener('loadedmetadata', () => syncStemTimes(true));
    vocalsAudio.addEventListener('loadedmetadata', () => syncStemTimes(true));
    instrumentalAudio.addEventListener('error', () => recordAudio('INSTRUMENTAL_MEDIA_ERROR', 'ERROR', { code: instrumentalAudio.error?.code || 0 }));
    vocalsAudio.addEventListener('error', () => recordAudio('VOCALS_MEDIA_ERROR', 'ERROR', { code: vocalsAudio.error?.code || 0 }));
    backgroundAudio.addEventListener('play', () => { renderBackground(); publish(); diagnostics?.setHealth?.('Background Audio', 'OK', { playing: true }); });
    backgroundAudio.addEventListener('pause', () => {
      // WKWebView pauses hidden/occluded media on its own.  In native mode it
      // is not an instruction to stop the ambient AVAudioEngine deck.
      if (!usingNativeAudio()) pauseNativeDeck('background');
      renderBackground(); publish();
    });
    backgroundAudio.addEventListener('timeupdate', () => { renderBackground(); publish(); });
    backgroundAudio.addEventListener('ended', () => {
      if (usingNativeAudio()) return;
      stopNativeDeck('background');
      if (!backgroundTransition && stageMode === 'lobby') void playNextBackground();
    });
    backgroundAudio.addEventListener('error', () => {
      if (!backgroundTransition && !intentionalBackgroundReset && (backgroundAudio.currentSrc || backgroundAudio.getAttribute('src'))) {
        backgroundStatusOverride = 'El audio de fondo actual no es compatible. Pulsa Siguiente o Reintentar.';
        recordAudio('BACKGROUND_MEDIA_ERROR', 'ERROR', { code: backgroundAudio.error?.code || 0 });
        diagnostics?.setHealth?.('Background Audio', 'ERROR', { code: backgroundAudio.error?.code || 0 });
        renderBackground(); publish();
      }
    });
  }
  bindMediaEvents();
  renderAutoGainSettings();
  applyAutoGain({ smooth: false });
  startOutputMeter();
  document.addEventListener('keydown', (event) => {
    if (opened && event.key === 'Escape' && !assignDialog.open) { if (libraryOpened) closeLocalLibrary(); closeDrawers(); return; }
    if (!opened || !event.shiftKey || event.repeat || assignDialog.open) return;
    const tag = String(event.target?.tagName || '').toLowerCase();
    if (playerShortcutIsEditable({
      tagName: tag,
      isContentEditable: event.target?.isContentEditable,
      withinEditable: Boolean(event.target?.closest?.('[contenteditable="true"], [role="textbox"]'))
    })) return;
    if (playerShortcutIsDeleteKey(event)) {
      const focusedId = event.target?.closest?.('#playerQueue [data-player-row]')?.dataset.playerRow || '';
      const hoveredId = document.querySelector('#playerQueue [data-player-row]:hover')?.dataset.playerRow || '';
      const targetId = playerQueueShortcutTarget({
        focusedId,
        hoveredId,
        selectedId: currentId,
        queueIds: queue().map((item) => item.id)
      });
      if (!targetId) return;
      event.preventDefault();
      void advance('removed', targetId, { focusAfterRemoval: true });
      return;
    }
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
  channel.addEventListener('message', (event) => {
    if (event.data?.type === 'request-state') {
      publish();
      return;
    }
    if (event.data?.type === 'star-screen-video-health') {
      const detail = event.data;
      const sentAt = Math.max(0, Number(detail.sentAt) || Date.now());
      const freshDisplayHealth = starScreenVideoHealth?.preview === false && Date.now() - Number(starScreenVideoHealth.sentAt || 0) < 6500;
      if (freshDisplayHealth && detail.preview === true) return;
      starScreenVideoHealth = {
        preview: detail.preview === true,
        sentAt,
        totalFrames: Math.max(0, Number(detail.totalFrames) || 0),
        droppedFrames: Math.max(0, Number(detail.droppedFrames) || 0),
        corruptedFrames: Math.max(0, Number(detail.corruptedFrames) || 0),
        frameRate: Math.max(0, Number(detail.frameRate) || 0),
        hardResyncs: Math.max(0, Number(detail.hardResyncs) || 0),
        rateWrites: Math.max(0, Number(detail.rateWrites) || 0),
        maxDriftSeconds: Math.max(0, Number(detail.maxDriftSeconds) || 0),
        lastSeekFrameLatencyMs: detail.lastSeekFrameLatencyMs != null && Number.isFinite(Number(detail.lastSeekFrameLatencyMs))
          ? Math.max(0, Number(detail.lastSeekFrameLatencyMs)) : null,
        readyState: Math.max(0, Math.min(4, Number(detail.readyState) || 0)),
        paused: detail.paused === true
      };
      return;
    }
    if (event.data?.type !== 'star-screen-heartbeat' || event.data.preview === true) return;
    starScreenLastHeartbeatAt = Date.now();
    starScreenHeartbeatVisible = event.data.visible !== false;
    channel.postMessage({
      type: 'star-screen-ack',
      instanceId: String(event.data.instanceId || ''),
      sequence: Number(event.data.sequence) || 0,
      acknowledgedAt: Date.now()
    });
  });
  async function handleAudioDeviceChange() {
    recordAudio('AUDIO_DEVICE_CHANGE_DETECTED', 'WARNING');
    const configured = String(state?.config?.audioOutputDeviceId || '');
    if (!configured) return;
    try {
      const outputs = await listAudioOutputs();
      if (outputs.some((device) => device.deviceId === configured)) {
        await applyAudioOutput(configured, { silent: true });
        showNotice('La salida de audio configurada volvió a estar disponible.');
      } else {
        audioOutputLost = true;
        await applyAudioOutput('', { silent: true });
        audioOutputLost = true;
        showNotice('La salida de audio configurada se desconectó. Guest Star continúa por la salida predeterminada.', true);
      }
    } catch (error) {
      recordAudio('AUDIO_DEVICE_REFRESH_FAILED', 'ERROR', { message: error.message });
    }
  }
  navigator.mediaDevices?.addEventListener?.('devicechange', handleAudioDeviceChange);
  window.addEventListener('gueststar:native-audio-devices-changed', handleAudioDeviceChange);
  window.addEventListener('gueststar:native-star-screen-result', (event) => {
    const result = event.detail || {};
    if (result.preview !== true) starScreenExpected = true;
    diagnostics?.record?.({ module: 'Star Screen', severity: result.ok ? result.fallback ? 'WARNING' : 'INFO' : 'ERROR', event: result.ok ? result.reused ? 'STAR_SCREEN_REFOCUSED' : 'STAR_SCREEN_OPENED' : 'STAR_SCREEN_OPEN_FAILED', summary: result.error || (result.reused ? 'Star Screen enfocada' : 'Star Screen abierta'), context: { fallback: result.fallback === true, displayId: result.displayId || '' } });
    diagnostics?.setHealth?.('Star Screen', result.ok ? result.fallback ? 'WARNING' : 'OK' : 'ERROR', { fallback: result.fallback === true });
  });
  window.addEventListener('beforeunload', () => {
    if (!playerPreparationReady()) return;
    void fetch('/api/player/runtime', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(runtimePayload()),
      keepalive: true
    });
  });
  window.setInterval(() => { if (opened && state) renderOperations(); }, 1000);
  window.setInterval(() => {
    if (!opened || !state) return;
    const starScreen = playerStarScreenConnection({
      expected: starScreenExpected,
      lastHeartbeatAt: starScreenLastHeartbeatAt,
      visible: starScreenHeartbeatVisible
    });
    void diagnostics?.reportPlayerHealth?.({
      playing: stageMode === 'karaoke' && karaokeTransportIsPlaying(),
      karaokeActive: stageMode === 'karaoke' && karaokeTransportIsPlaying(),
      videoActive: stageMode === 'karaoke' && current()?.localAvailable === true,
      backgroundPlaying: stageMode === 'lobby' && backgroundTransportIsPlaying(),
      transitionBusy,
      audioContextState: audioContext?.state || 'missing',
      audioRecovering: Boolean(audioRecoveryPromise) || ['suspended', 'interrupted', 'closed'].includes(audioContext?.state),
      audioOutputLost,
      starScreenExpected: starScreen.expected,
      starScreenConnected: starScreen.connected,
      mediaState: transitionBusy ? 'waiting' : media.error ? 'error' : karaokeTransportIsPlaying() ? 'playing' : 'idle',
      queueLength: queue().length,
      currentTime: karaokeClockPosition(),
      duration: karaokeClockDuration(),
      videoFrames: starScreenVideoHealth?.totalFrames || 0,
      videoDroppedFrames: starScreenVideoHealth?.droppedFrames || 0,
      videoCorruptedFrames: starScreenVideoHealth?.corruptedFrames || 0,
      videoFrameRate: starScreenVideoHealth?.frameRate || 0,
      videoHardResyncs: starScreenVideoHealth?.hardResyncs || 0,
      videoRateWrites: starScreenVideoHealth?.rateWrites || 0,
      videoDriftSeconds: starScreenVideoHealth?.maxDriftSeconds || 0,
      videoReadyState: starScreenVideoHealth?.readyState || 0,
      videoPaused: starScreenVideoHealth?.paused === true
    });
  }, 5000);

  function diagnosticSnapshot() {
    return {
      audio: {
        contextState: audioContext?.state || 'missing',
        graphConnected: mediaAudioGraph?.connected === true,
        requestedOutput: state?.config?.audioOutputDeviceId ? 'selected-device' : 'default',
        activeOutput: currentAudioOutputId ? 'selected-device' : 'default',
        outputLost: audioOutputLost,
        mediaReadyState: media.readyState,
        mediaNetworkState: media.networkState,
        currentTime: karaokeClockPosition(),
        duration: karaokeClockDuration(),
        backgroundReadyState: backgroundAudio.readyState,
        nativeEngine: usingNativeAudio() ? 'AVAudioEngine' : '',
        nativeStateEvents: nativeVideoSyncMetrics.stateEvents,
        videoHardResyncs: nativeVideoSyncMetrics.hardSeeks,
        videoRateWrites: nativeVideoSyncMetrics.rateWrites,
        maxVideoDriftSeconds: Number(nativeVideoSyncMetrics.maxDriftSeconds.toFixed(3)),
        starScreenVideo: starScreenVideoHealth
      },
      stems: {
        selectedEngine: 'auto',
        lockedEngine: lockedStemEngine,
        ready: lockedStemSourceReady(),
        status: current()?.stem?.status || 'none'
      },
      player: {
        stageMode,
        scenePhase,
        transitionBusy,
        currentRequestId: currentId,
        queueLength: queue().length,
        starScreen: playerStarScreenConnection({ expected: starScreenExpected, lastHeartbeatAt: starScreenLastHeartbeatAt, visible: starScreenHeartbeatVisible })
      }
    };
  }

  return {
    open, close, sync, isOpen: () => opened,
    audioOutputCapability, listAudioOutputs, applyAudioOutput,
    diagnosticSnapshot
  };
}
