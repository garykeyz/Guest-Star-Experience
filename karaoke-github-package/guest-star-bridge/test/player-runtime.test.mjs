import assert from "node:assert/strict";
import test from "node:test";

import { escapeDiagnosticHtml } from "../public/diagnostics.js";
import {
  choosePlayerQueueOrder,
  movePlayerQueueOrder,
  playerAudioOutputSupported,
  playerAudioRecoveryAction,
  playerProgressState,
  playerQueueOrderSignature,
  playerStarScreenConnection,
  reconnectPlayerAudioGraph
} from "../public/player-beta.js";

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
    "normalGain", "instrumentalGain", "vocalsGain", "backgroundGain",
    "bus", "low", "mid", "high", "analyser", "master", "destination"
  ].map((name) => [name, node(name)]));

  assert.equal(reconnectPlayerAudioGraph(graph).connected, true);
  assert.deepEqual(new Set(edges), new Set([
    "source->normalGain", "normalGain->bus",
    "instrumentalSource->instrumentalGain", "instrumentalGain->bus",
    "vocalsSource->vocalsGain", "vocalsGain->bus",
    "bus->low", "low->mid", "mid->high", "high->analyser",
    "analyser->master", "master->destination",
    "backgroundSource->backgroundGain", "backgroundGain->destination"
  ]));
});

test("la UI de diagnósticos escapa texto y atributos antes de usar HTML", () => {
  assert.equal(
    escapeDiagnosticHtml('<img src=x onerror="boom"> & test'),
    '&lt;img src=x onerror=&quot;boom&quot;&gt; &amp; test'
  );
});
