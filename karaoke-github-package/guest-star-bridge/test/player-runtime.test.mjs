import assert from "node:assert/strict";
import test from "node:test";

import { escapeDiagnosticHtml } from "../public/diagnostics.js";
import {
  analyzeAudioFeatures,
  applyTempoRate,
  bpmAtTempo,
  choosePlayerQueueOrder,
  fadeGainForVolume,
  embeddedBpm,
  movePlayerQueueOrder,
  nativeVisualSyncPlan,
  playerAudioOutputSupported,
  playerAudioRecoveryAction,
  playerProgressState,
  playerQueueOrderSignature,
  playerStarScreenConnection,
  playerTrackChangeAllowed,
  reconnectPlayerAudioGraph,
  nextTempoPercent,
  nextSemitone,
  normalizeTempoPercent,
  tempoApplicationDelay,
  trackAnalysisIsCurrent,
  tempoRate,
  transposeKey
} from "../public/player-beta.js";

test("el bloqueo de sesión impide sustituir la pista activa sin autorización", () => {
  assert.equal(playerTrackChangeAllowed({ activeTrackId: "A", targetTrackId: "B" }), false);
  assert.equal(playerTrackChangeAllowed({ activeTrackId: "A", targetTrackId: "A" }), false);
  assert.equal(playerTrackChangeAllowed({ activeTrackId: "", targetTrackId: "B" }), true);
  assert.equal(playerTrackChangeAllowed({ activeTrackId: "A", targetTrackId: "B", authorized: true }), true);
  assert.equal(playerTrackChangeAllowed({ activeTrackId: "", targetTrackId: "" }), false);
});

test("el progreso vuelve a cero cuando aún no hay duración válida", () => {
  assert.deepEqual(playerProgressState(83, Number.NaN), {
    valid: false,
    currentTime: 0,
    duration: 0,
    max: 1,
    value: 0,
    percent: 0,
    disabled: true
  });
  assert.deepEqual(playerProgressState(30, 120), {
    valid: true,
    currentTime: 30,
    duration: 120,
    max: 120,
    value: 30,
    percent: 25,
    disabled: false
  });
});

test("el orden local exacto no se revierte antes de recibir su acuse remoto", () => {
  const moved = movePlayerQueueOrder(["a", "b", "c"], "b", -1);
  assert.deepEqual(moved, { order: ["b", "a", "c"], moved: true });
  const pending = playerQueueOrderSignature(moved.order);
  assert.deepEqual(choosePlayerQueueOrder({
    remoteOrder: ["a", "b", "c"], localOrder: moved.order, pendingSignature: pending
  }), { order: moved.order, acceptedRemote: false, acknowledgedPending: false });
  assert.deepEqual(choosePlayerQueueOrder({
    remoteOrder: moved.order, localOrder: moved.order, pendingSignature: pending
  }), { order: moved.order, acceptedRemote: true, acknowledgedPending: true });
});

test("el heartbeat distingue Star Screen conectada, oculta y vencida", () => {
  assert.equal(playerStarScreenConnection({ expected: false, now: 10_000 }).connected, false);
  assert.equal(playerStarScreenConnection({ expected: true, visible: false, lastHeartbeatAt: 9_000, now: 10_000 }).connected, false);
  assert.equal(playerStarScreenConnection({ expected: true, visible: true, lastHeartbeatAt: 9_000, now: 10_000 }).connected, true);
  assert.equal(playerStarScreenConnection({ expected: true, visible: true, lastHeartbeatAt: 1_000, now: 10_000 }).connected, false);
});

test("la recuperación de AudioContext y la capacidad de salida son explícitas", () => {
  assert.equal(playerAudioRecoveryAction("running"), "ready");
  assert.equal(playerAudioRecoveryAction("suspended"), "resume");
  assert.equal(playerAudioRecoveryAction("interrupted"), "resume");
  assert.equal(playerAudioRecoveryAction("closed"), "closed");
  class SupportedAudioContext {}
  SupportedAudioContext.prototype.setSinkId = async () => {};
  assert.equal(playerAudioOutputSupported(SupportedAudioContext, { enumerateDevices() {} }), true);
  assert.equal(playerAudioOutputSupported(SupportedAudioContext, null), false);
  assert.equal(playerAudioOutputSupported(null, null, true), true);
});

test("tempo y tonalidad se calculan y transponen sin acoplarse", () => {
  assert.equal(tempoRate(128, 132), 1.03125);
  assert.equal(tempoRate(128, 64), 0.5);
  assert.equal(tempoRate(128, 192), 1.5);
  assert.equal(tempoRate(128, 240), 1.5);
  assert.equal(normalizeTempoPercent(103.14), 103.1);
  assert.equal(normalizeTempoPercent(49), 50);
  assert.equal(normalizeTempoPercent(151), 150);
  for (const percent of [50, 75, 100, 125, 150]) assert.equal(normalizeTempoPercent(percent), percent);
  assert.equal(nextTempoPercent(50, -1), 50);
  assert.equal(nextTempoPercent(100, -1), 99);
  assert.equal(nextTempoPercent(150, 1), 150);
  assert.equal(bpmAtTempo(128, 103.1), 132);
  assert.equal(bpmAtTempo(128, 50), 64);
  assert.equal(bpmAtTempo(128, 75), 96);
  assert.equal(bpmAtTempo(128, 100), 128);
  assert.equal(bpmAtTempo(128, 125), 160);
  assert.equal(bpmAtTempo(128, 150), 192);
  assert.equal(transposeKey("Em", 1), "Fm");
  assert.equal(transposeKey("Em", -2), "Dm");
  assert.equal(transposeKey("G", 1), "G#");
  assert.equal(nextSemitone(0, 1), 1);
  assert.equal(nextSemitone(1, -1), 0);
  assert.equal(nextSemitone(6, 1), 6);
  assert.equal(trackAnalysisIsCurrent({ generation: 4, currentGeneration: 4, requestId: 'B', currentRequestId: 'B' }), true);
  assert.equal(trackAnalysisIsCurrent({ generation: 3, currentGeneration: 4, requestId: 'A', currentRequestId: 'B' }), false);
  const sampleRate = 11025;
  const pcm = new Float32Array(sampleRate * 12);
  for (let beat = 0; beat < 24; beat += 1) {
    const start = Math.floor(beat * 0.5 * sampleRate);
    for (let index = 0; index < 180; index += 1) pcm[start + index] = Math.exp(-index / 35);
  }
  assert.equal(analyzeAudioFeatures(pcm, sampleRate).bpm, 120);
  const slowPcm = new Float32Array(sampleRate * 12);
  for (let beat = 0; beat < 16; beat += 1) {
    const start = Math.floor(beat * 0.75 * sampleRate);
    for (let index = 0; index < 180; index += 1) slowPcm[start + index] = Math.exp(-index / 35);
  }
  assert.ok(Math.abs(analyzeAudioFeatures(slowPcm, sampleRate).bpm - 80) <= 1);
  const tagged = Uint8Array.from([0x54, 0x42, 0x50, 0x4d, 0, 0, 0, 3, 0, 0, 0, 0x38, 0x30]);
  assert.equal(embeddedBpm(tagged), 80);
});

test("el detector distingue acordes de Mi mayor y menor y no inventa tonalidad en silencio", () => {
  const sampleRate = 11025;
  const tone = (frequencies) => {
    const samples = new Float32Array(sampleRate * 12);
    for (let frame = 0; frame < samples.length; frame += 1) {
      for (const frequency of frequencies) samples[frame] += Math.sin(2 * Math.PI * frequency * frame / sampleRate) / frequencies.length;
    }
    return samples;
  };
  const major = analyzeAudioFeatures(tone([164.81, 207.65, 246.94, 329.63, 415.30, 493.88]), sampleRate);
  const minor = analyzeAudioFeatures(tone([164.81, 196, 246.94, 329.63, 392, 493.88]), sampleRate);
  const silent = analyzeAudioFeatures(new Float32Array(sampleRate * 3), sampleRate);
  assert.equal(major.key, "E");
  assert.equal(minor.key, "Em");
  assert.ok(major.keyConfidence > 0 && major.keyConfidence <= 1);
  assert.equal(silent.key, "");
  assert.equal(silent.keyConfidence, 0);
});

test("el tempo aplica playbackRate real y preserva la tonalidad por reproductor", () => {
  const karaoke = {};
  const background = {};
  for (const [percent, rate] of [[50, 0.5], [75, 0.75], [100, 1], [125, 1.25], [150, 1.5]]) {
    assert.equal(applyTempoRate(karaoke, percent / 100), rate);
    assert.equal(karaoke.playbackRate, rate);
    assert.equal(karaoke.preservesPitch, true);
    assert.equal(karaoke.webkitPreservesPitch, true);
  }
  applyTempoRate(karaoke, 0.5);
  applyTempoRate(background, 1.5);
  assert.equal(karaoke.playbackRate, 0.5);
  assert.equal(background.playbackRate, 1.5);
  assert.equal(applyTempoRate(background, 2), 1.5);
  assert.equal(applyTempoRate(background, 0.1), 0.5);
});

test("el tempo coalesce cambios del slider sin reconfigurar rutas ajenas", () => {
  assert.equal(tempoApplicationDelay({ now: 100, lastAppliedAt: 100 }), 180);
  assert.equal(tempoApplicationDelay({ now: 200, lastAppliedAt: 100 }), 80);
  assert.equal(tempoApplicationDelay({ now: 280, lastAppliedAt: 100 }), 0);
  assert.equal(tempoApplicationDelay({ now: 101, lastAppliedAt: 100, immediate: true }), 0);

  let playbackRateWrites = 0;
  const karaoke = {
    playbackRate: 1,
    set preservesPitch(value) { this._preservesPitch = value; },
    get preservesPitch() { return this._preservesPitch; },
    set webkitPreservesPitch(value) { this._webkitPreservesPitch = value; },
    get webkitPreservesPitch() { return this._webkitPreservesPitch; },
    set playbackRate(value) { playbackRateWrites += 1; this._playbackRate = value; },
    get playbackRate() { return this._playbackRate ?? 1; }
  };
  applyTempoRate(karaoke, 1.25);
  applyTempoRate(karaoke, 1.25);
  assert.equal(playbackRateWrites, 1);
  assert.equal(karaoke.playbackRate, 1.25);
});

test("el reloj visual sigue AVAudioEngine sin seeks pequeños en 50–150%", () => {
  for (const [tempoPercent, rate] of [[50, 0.5], [75, 0.75], [100, 1], [125, 1.25], [150, 1.5]]) {
    const plan = nativeVisualSyncPlan({ audioPosition: 30.08, visualPosition: 30, tempoPercent });
    assert.equal(plan.baseRate, rate);
    assert.equal(plan.seekTo, null);
    assert.ok(plan.playbackRate >= 0.5 && plan.playbackRate <= 1.5);
  }
  const discontinuity = nativeVisualSyncPlan({ audioPosition: 42, visualPosition: 40, tempoPercent: 125, millisecondsSinceHardSeek: 5100 });
  assert.equal(discontinuity.seekTo, 42);
  assert.equal(discontinuity.playbackRate, 1.25);
  const cooldown = nativeVisualSyncPlan({ audioPosition: 42, visualPosition: 40, tempoPercent: 125, millisecondsSinceHardSeek: 1200 });
  assert.equal(cooldown.seekTo, null);
  const browserIsSeeking = nativeVisualSyncPlan({ audioPosition: 42, visualPosition: 40, tempoPercent: 100, seeking: true });
  assert.equal(browserIsSeeking.seekTo, null);
});

test("el fade conserva separado el volumen configurado y la ganancia temporal", () => {
  assert.equal(fadeGainForVolume(0.6, 0.6), 1);
  assert.equal(fadeGainForVolume(0.6, 0.3), 0.5);
  assert.equal(fadeGainForVolume(0.6, 0), 0);
  assert.equal(fadeGainForVolume(0, 0), 0);
});

test("el grafo único conecta karaoke, stems y ambiente a la misma salida", () => {
  const edges = [];
  const node = (name) => ({
    name,
    disconnect() {},
    connect(destination) { edges.push(`${name}->${destination.name}`); }
  });
  const graph = Object.fromEntries([
    "source", "instrumentalSource", "vocalsSource", "backgroundSource",
    "normalGain", "instrumentalGain", "vocalsGain", "backgroundGain", "backgroundFade",
    "bus", "low", "mid", "high", "analyser", "master", "karaokeFade", "destination"
  ].map((name) => [name, node(name)]));

  assert.equal(reconnectPlayerAudioGraph(graph).connected, true);
  assert.deepEqual(new Set(edges), new Set([
    "source->normalGain", "normalGain->bus",
    "instrumentalSource->instrumentalGain", "instrumentalGain->bus",
    "vocalsSource->vocalsGain", "vocalsGain->bus",
    "bus->low", "low->mid", "mid->high", "high->analyser",
    "analyser->master", "master->karaokeFade", "karaokeFade->destination",
    "backgroundSource->backgroundGain", "backgroundGain->backgroundFade", "backgroundFade->destination"
  ]));
});

test("la UI de diagnósticos escapa texto y atributos antes de usar HTML", () => {
  assert.equal(
    escapeDiagnosticHtml('<img src=x onerror="boom"> & test'),
    '&lt;img src=x onerror=&quot;boom&quot;&gt; &amp; test'
  );
});
