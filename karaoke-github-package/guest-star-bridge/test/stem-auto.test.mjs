import assert from "node:assert/strict";
import test from "node:test";
import {
  StemResourceController,
  autoStemPlan,
  bestCachedStem,
  demucsExecutionBudget,
  detectStemResourceState,
  estimateTurnSeconds,
  normalizeStemEngine,
  prioritizeStemJobs,
  spleeterExecutionBudget,
  stemJobKey,
  stemSourceForIntent
} from "../src/stem-auto.mjs";

test("AUTO consulta primero el mejor caché y nunca espera una mejora Demucs", () => {
  assert.deepEqual(autoStemPlan({ spleeter: true, demucs: true }), {
    ready: true,
    source: "demucs",
    prepare: [],
    improving: false
  });
  assert.deepEqual(autoStemPlan({ spleeter: true, demucs: false }), {
    ready: true,
    source: "spleeter",
    prepare: ["demucs"],
    improving: true
  });
  assert.deepEqual(autoStemPlan({ spleeter: false, demucs: false }), {
    ready: false,
    source: "original",
    prepare: ["spleeter", "demucs"],
    improving: false
  });
  assert.equal(bestCachedStem({ spleeter: true, demucs: true }), "demucs");
  assert.equal(bestCachedStem({ spleeter: true }), "spleeter");
  assert.equal(bestCachedStem({}), "original");
});

test("la fuente queda bloqueada durante reproducción y no cambia por una mejora tardía", () => {
  assert.equal(stemSourceForIntent({
    intent: "auto",
    cache: { spleeter: true, demucs: true },
    lockedSource: "spleeter"
  }), "spleeter");
  assert.equal(stemSourceForIntent({
    intent: "auto",
    cache: { spleeter: true, demucs: true },
    lockedSource: "original"
  }), "original");
  assert.equal(stemSourceForIntent({
    intent: "auto",
    cache: { spleeter: true, demucs: true }
  }), "demucs");
  assert.equal(stemSourceForIntent({
    intent: "spleeter",
    cache: { demucs: true }
  }), "original");
  assert.equal(stemSourceForIntent({
    intent: "demucs",
    cache: { spleeter: true }
  }), "original");
});

test("normaliza el motor e identifica cada trabajo por solicitud y motor", () => {
  assert.equal(normalizeStemEngine(" AUTO "), "auto");
  assert.equal(normalizeStemEngine("SPLEETER"), "spleeter");
  assert.equal(normalizeStemEngine("otro"), "auto");
  assert.equal(normalizeStemEngine("otro", "demucs"), "demucs");
  assert.equal(stemJobKey(" request-7 ", "DEMUCS"), "request-7:demucs");
});

test("prioriza Spleeter requerido, luego Spleeter opcional y Demucs explícito", () => {
  const ordered = prioritizeStemJobs([
    {
      id: "demucs-opportunistic",
      engine: "demucs",
      intent: "auto",
      status: "queued",
      estimatedTurnSeconds: 5,
      requestedAt: "2026-08-01T20:00:00.000Z"
    },
    {
      id: "demucs-explicit",
      engine: "demucs",
      intent: "demucs",
      status: "queued",
      estimatedTurnSeconds: 120,
      requestedAt: "2026-08-01T20:01:00.000Z"
    },
    {
      id: "spleeter-optional",
      engine: "spleeter",
      required: false,
      status: "queued",
      estimatedTurnSeconds: 1,
      requestedAt: "2026-08-01T20:02:00.000Z"
    },
    {
      id: "spleeter-required-later",
      engine: "spleeter",
      required: true,
      status: "queued",
      estimatedTurnSeconds: 80,
      requestedAt: "2026-08-01T20:04:00.000Z"
    },
    {
      id: "spleeter-required-next",
      engine: "spleeter",
      required: true,
      status: "queued",
      estimatedTurnSeconds: 20,
      requestedAt: "2026-08-01T20:03:00.000Z"
    },
    {
      id: "already-ready",
      engine: "spleeter",
      status: "ready",
      estimatedTurnSeconds: 0,
      requestedAt: "2026-08-01T19:00:00.000Z"
    }
  ]);

  assert.deepEqual(ordered.map((job) => job.id), [
    "spleeter-required-next",
    "spleeter-required-later",
    "spleeter-optional",
    "demucs-explicit",
    "demucs-opportunistic"
  ]);
});

test("estima el tiempo hasta el turno usando progreso, duraciones y transiciones", () => {
  const queue = [
    { id: "now", durationSeconds: 240 },
    { id: "next", durationSeconds: 180, transitionSeconds: 15 },
    { id: "target", durationSeconds: 200 }
  ];

  assert.equal(estimateTurnSeconds({
    requestId: "target",
    queue,
    currentRequestId: "now",
    currentTimeSeconds: 60,
    currentDurationSeconds: 240,
    transitionSeconds: 30
  }), 375);
  assert.equal(estimateTurnSeconds({ requestId: "missing", queue }), Number.POSITIVE_INFINITY);
});

test("IDLE, LIVE y PRESSURE se derivan de señales reales de reproducción y recursos", () => {
  assert.equal(detectStemResourceState({}), "IDLE");
  assert.equal(detectStemResourceState({ karaokeActive: true }), "LIVE");
  assert.equal(detectStemResourceState({ videoActive: true }), "LIVE");
  assert.equal(detectStemResourceState({ backgroundActive: true }), "LIVE");
  assert.equal(detectStemResourceState({ karaokeActive: true, cpuLoadRatio: 0.91 }), "PRESSURE");
  assert.equal(detectStemResourceState({ memoryPressure: true }), "PRESSURE");
  assert.equal(detectStemResourceState({ audioContextState: "interrupted" }), "PRESSURE");
  assert.equal(detectStemResourceState({ mediaState: "stalled" }), "PRESSURE");
  assert.equal(detectStemResourceState({ audioOutputLost: true }), "PRESSURE");
});

test("la histéresis escala de inmediato y recupera capacidad de forma gradual", () => {
  let now = 0;
  const controller = new StemResourceController({
    now: () => now,
    promoteAfterMs: 1000
  });

  assert.deepEqual(controller.update({ karaokeActive: true }), {
    state: "LIVE",
    previous: "IDLE",
    changed: true,
    desired: "LIVE"
  });
  assert.equal(controller.update({ memoryPressure: true }).state, "PRESSURE");

  assert.deepEqual(controller.update({}), {
    state: "PRESSURE",
    changed: false,
    desired: "IDLE"
  });
  now = 999;
  assert.equal(controller.update({}).state, "PRESSURE");
  now = 1000;
  assert.deepEqual(controller.update({}), {
    state: "LIVE",
    previous: "PRESSURE",
    changed: true,
    desired: "IDLE"
  });

  assert.equal(controller.update({}).state, "LIVE");
  now = 1999;
  assert.equal(controller.update({}).state, "LIVE");
  now = 2000;
  assert.deepEqual(controller.update({}), {
    state: "IDLE",
    previous: "LIVE",
    changed: true,
    desired: "IDLE"
  });
});

test("Demucs admite como máximo una tarea pesada y PRESSURE pausa ambos motores", () => {
  const demucsIdle = demucsExecutionBudget(12, "IDLE");
  const demucsLive = demucsExecutionBudget(12, "LIVE");
  const demucsPressure = demucsExecutionBudget(12, "PRESSURE");
  const spleeterIdle = spleeterExecutionBudget(12, "IDLE");
  const spleeterLive = spleeterExecutionBudget(12, "LIVE");
  const spleeterPressure = spleeterExecutionBudget(12, "PRESSURE");

  assert.equal(demucsIdle.maxHeavyJobs, 1);
  assert.equal(demucsIdle.workerProcesses, 1);
  assert.equal(demucsLive.maxHeavyJobs, 1);
  assert.equal(demucsLive.workerProcesses, 1);
  assert.equal(demucsLive.internalThreads, null);
  assert.ok(demucsLive.recommendedThreadCeiling <= demucsIdle.recommendedThreadCeiling);
  assert.equal(demucsPressure.maxHeavyJobs, 0);
  assert.equal(demucsPressure.workerProcesses, 0);
  assert.equal(demucsPressure.paused, true);

  assert.equal(spleeterIdle.maxJobs, 1);
  assert.equal(spleeterIdle.numThreads, 4);
  assert.equal(spleeterLive.maxJobs, 1);
  assert.equal(spleeterLive.numThreads, 2);
  assert.equal(spleeterPressure.maxJobs, 0);
  assert.equal(spleeterPressure.numThreads, 1);
  assert.equal(spleeterPressure.paused, true);
});
