import assert from "node:assert/strict";
import test from "node:test";
import { normalizeQueueState } from "../src/queue-state.mjs";

test("conserva solo entradas eliminables de VirtualDJ", () => {
  const state = normalizeQueueState({
    activityId: "activity-1",
    activityStartedAt: "2026-07-29T20:00:00.000Z",
    suppressedIds: ["request-3", "", "request-3"],
    removedIds: ["request-2", "request-2", ""],
    entries: [
      {
        id: "request-1",
        filePath: "/Music/Karaoke/song.mp4",
        singer: "Ana",
        song: "Song",
        artist: "Artist"
      },
      { id: "request-2", filePath: "", singer: "Carlos" }
    ],
    recoveries: [
      {
        id: "request-1",
        outcome: "completed",
        previousStatus: "Agregada a VirtualDJ",
        originalPosition: 2,
        markedAt: "2026-07-29T20:10:00.000Z",
        entry: {
          id: "request-1",
          filePath: "/Music/Karaoke/song.mp4",
          singer: "Ana",
          song: "Song",
          artist: "Artist"
        }
      }
    ]
  });
  assert.equal(state.activityId, "activity-1");
  assert.equal(state.activityStartedAt, "2026-07-29T20:00:00.000Z");
  assert.equal(state.entries.length, 1);
  assert.equal(state.entries[0].id, "request-1");
  assert.deepEqual(state.suppressedIds, ["request-3"]);
  assert.deepEqual(state.removedIds, ["request-2"]);
  assert.equal(state.recoveries.length, 1);
  assert.equal(state.recoveries[0].originalPosition, 2);
  assert.equal(state.recoveries[0].entry.singer, "Ana");
});
