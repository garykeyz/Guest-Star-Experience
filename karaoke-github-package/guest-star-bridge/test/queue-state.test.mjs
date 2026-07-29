import assert from "node:assert/strict";
import test from "node:test";
import { normalizeQueueState } from "../src/queue-state.mjs";

test("conserva solo entradas eliminables de VirtualDJ", () => {
  const state = normalizeQueueState({
    activityId: "activity-1",
    suppressedIds: ["request-3", "", "request-3"],
    entries: [
      {
        id: "request-1",
        filePath: "/Music/Karaoke/song.mp4",
        singer: "Ana",
        song: "Song",
        artist: "Artist"
      },
      { id: "request-2", filePath: "", singer: "Carlos" }
    ]
  });
  assert.equal(state.activityId, "activity-1");
  assert.equal(state.entries.length, 1);
  assert.equal(state.entries[0].id, "request-1");
  assert.deepEqual(state.suppressedIds, ["request-3"]);
});
