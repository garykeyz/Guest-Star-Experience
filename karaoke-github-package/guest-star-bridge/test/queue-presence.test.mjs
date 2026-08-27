import assert from "node:assert/strict";
import test from "node:test";
import { reconcileQueuePresence } from "../src/queue-presence.mjs";

test("espera tres lecturas ausentes antes de confirmar que una pista salió", () => {
  let previous = new Map();
  for (let scan = 1; scan <= 2; scan++) {
    const result = reconcileQueuePresence({
      previous,
      trackedIds: ["request-1"],
      matchedIds: new Set(),
      now: 10000 + scan
    });
    assert.deepEqual(result.confirmedMissing, []);
    assert.deepEqual(result.transientMissing, ["request-1"]);
    previous = result.next;
  }
  const third = reconcileQueuePresence({
    previous,
    trackedIds: ["request-1"],
    matchedIds: new Set(),
    now: 10003
  });
  assert.deepEqual(third.confirmedMissing, ["request-1"]);
});

test("la gracia de inserción evita el ciclo agregado a pendiente", () => {
  const result = reconcileQueuePresence({
    previous: new Map([["request-1", 2]]),
    trackedIds: ["request-1"],
    matchedIds: new Set(),
    pendingInsertions: new Map([["request-1", { startedAt: 5000 }]]),
    now: 9000
  });
  assert.deepEqual(result.confirmedMissing, []);
  assert.deepEqual(result.transientMissing, ["request-1"]);
  assert.equal(result.next.get("request-1"), 0);
});

test("una coincidencia restablece el contador de ausencias", () => {
  const result = reconcileQueuePresence({
    previous: new Map([["request-1", 2]]),
    trackedIds: ["request-1"],
    matchedIds: new Set(["request-1"])
  });
  assert.deepEqual(result.matched, ["request-1"]);
  assert.equal(result.next.get("request-1"), 0);
});

test("un comando aceptado nunca vuelve a pendiente ni se reenvía por baja coincidencia", () => {
  const result = reconcileQueuePresence({
    previous: new Map([["request-1", 99]]),
    trackedIds: ["request-1"],
    matchedIds: new Set(),
    pendingInsertions: new Map([[
      "request-1",
      { phase: "confirming", startedAt: 1, accepted: true }
    ]]),
    now: 60_000
  });

  assert.deepEqual(result.confirmedMissing, []);
  assert.deepEqual(result.transientMissing, ["request-1"]);
  assert.equal(result.next.get("request-1"), 0);
});
