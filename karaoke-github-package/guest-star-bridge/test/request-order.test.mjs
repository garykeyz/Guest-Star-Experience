import assert from "node:assert/strict";
import test from "node:test";
import { orderRequestViews } from "../src/request-order.mjs";

test("ordena la rotación por la posición real de VirtualDJ", () => {
  const ordered = orderRequestViews([
    { id: "pending", timestamp: "2026-07-29T10:00:00Z", queued: false },
    { id: "second", timestamp: "2026-07-29T09:00:00Z", queued: true, queuePosition: 2 },
    { id: "first", timestamp: "2026-07-29T11:00:00Z", queued: true, queuePosition: 1 }
  ]);

  assert.deepEqual(
    ordered.map((item) => item.id),
    ["first", "second", "pending"]
  );
});

test("una canción recolocada pasa al final de la rotación", () => {
  const before = orderRequestViews([
    { id: "a", timestamp: "2026-07-29T09:00:00Z", queued: true, queuePosition: 1 },
    { id: "b", timestamp: "2026-07-29T10:00:00Z", queued: true, queuePosition: 2 }
  ]);
  const after = orderRequestViews([
    { ...before[0], queuePosition: 3 },
    before[1]
  ]);

  assert.deepEqual(
    after.map((item) => item.id),
    ["b", "a"]
  );
});

test("deja los resultados finales debajo de la rotación activa", () => {
  const result = orderRequestViews([
    { id: "done", timestamp: "2026-07-29T09:00:00Z", outcome: "completed" },
    { id: "pending", timestamp: "2026-07-29T10:00:00Z", queued: false },
    {
      id: "queued",
      timestamp: "2026-07-29T11:00:00Z",
      queued: true,
      queuePosition: 1
    }
  ]);

  assert.deepEqual(result.map((item) => item.id), ["queued", "pending", "done"]);
});
