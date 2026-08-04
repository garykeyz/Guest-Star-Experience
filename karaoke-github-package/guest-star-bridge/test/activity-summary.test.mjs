import assert from "node:assert/strict";
import test from "node:test";
import {
  buildActivitySummary,
  requestOutcome
} from "../src/activity-summary.mjs";

test("cuenta ya cantó, conserva la cola real y resta saltados", () => {
  const summary = buildActivitySummary(
    {
      activityHours: 2,
      transitionSeconds: 30,
      accepting: true,
      activityStartedAt: "2026-07-29T14:00:00.000Z"
    },
    [
      {
        status: "Ya cantó",
        durationSeconds: 240,
        transitionSeconds: 30,
        queued: false
      },
      {
        status: "Agregada a VirtualDJ",
        durationSeconds: 210,
        transitionSeconds: 30,
        queued: true
      },
      {
        status: "Saltado",
        durationSeconds: 300,
        transitionSeconds: 30,
        queued: false
      }
    ],
    Date.parse("2026-07-29T15:00:00.000Z")
  );

  assert.equal(summary.completedSeconds, 270);
  assert.equal(summary.queuedSeconds, 240);
  assert.equal(summary.confirmedSeconds, 510);
  assert.equal(summary.skippedSeconds, 330);
  assert.equal(summary.plannedSeconds, 510);
  assert.equal(summary.elapsedSeconds, 3600);
  assert.equal(summary.gapSeconds, 6690);
  assert.equal(summary.queueSongCount, 1);
});

test("recomienda cerrar cuando lo cantado y la cola cubren la actividad", () => {
  const summary = buildActivitySummary(
    { activityHours: 0.1, transitionSeconds: 0, accepting: true },
    [
      { status: "Ya cantó", durationSeconds: 180 },
      { status: "Agregada a VirtualDJ", durationSeconds: 200, queued: true }
    ]
  );

  assert.equal(summary.suggestClose, true);
  assert.equal(summary.overrunSeconds, 20);
});

test("normaliza los resultados finales en español", () => {
  assert.equal(requestOutcome("Ya cantó"), "completed");
  assert.equal(requestOutcome("Saltado"), "skipped");
  assert.equal(requestOutcome("Agregada a VirtualDJ"), "");
});

test("mantiene el reloj en cero hasta iniciar y calcula la hora final exacta", () => {
  const waiting = buildActivitySummary(
    { activityHours: 2, transitionSeconds: 30, activityStartedAt: "" },
    [],
    Date.parse("2026-08-04T12:00:00.000Z")
  );
  assert.equal(waiting.activityRunning, false);
  assert.equal(waiting.elapsedSeconds, 0);
  assert.equal(waiting.eventEndsAt, "");

  const running = buildActivitySummary(
    {
      activityHours: 2,
      transitionSeconds: 30,
      activityStartedAt: "2026-08-04T10:30:00.000Z"
    },
    [],
    Date.parse("2026-08-04T11:15:07.000Z")
  );
  assert.equal(running.activityRunning, true);
  assert.equal(running.elapsedSeconds, 2707);
  assert.equal(running.eventEndsAt, "2026-08-04T12:30:00.000Z");
});
