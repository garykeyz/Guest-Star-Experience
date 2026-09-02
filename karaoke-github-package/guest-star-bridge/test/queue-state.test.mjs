import assert from "node:assert/strict";
import test from "node:test";
import { normalizeQueueState } from "../src/queue-state.mjs";

test("conserva solo entradas eliminables de VirtualDJ", () => {
  const state = normalizeQueueState({
    activityId: "activity-1",
    activityStartedAt: "2026-07-29T20:00:00.000Z",
    operatingMode: "player",
    suppressedIds: ["request-3", "", "request-3"],
    removedIds: ["request-2", "request-2", ""],
    entries: [
      {
        id: "request-1",
        filePath: "/Music/Karaoke/song.mp4",
        singer: "Ana",
        song: "Song",
        artist: "Artist",
        manualLink: true
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
    ],
    playerRequests: [
      {
        id: "player-local-1",
        filePath: "/Music/Karaoke/local.mp4",
        singer: "Yefry",
        song: "Mi canción",
        artist: "Artista",
        outcome: "skipped"
      }
    ],
    playerOrder: ["request-1", "player-local-1", "request-1"],
    playerQueueVisibility: {
      "request-1": false,
      "player-local-1": true,
      "": false
    },
    playerPlayback: {
      currentRequestId: "request-1",
      currentTimeSeconds: 83.5,
      scene: "karaoke",
      wasPlaying: true,
      updatedAt: "2026-07-29T20:12:00.000Z"
    },
    playerStemJobs: [{
      id: "request-1:spleeter",
      requestId: "request-1",
      jobId: "stem-job-1",
      filePath: "/Music/Karaoke/song.mp4",
      engine: "spleeter",
      intent: "auto",
      required: true,
      opportunistic: false,
      status: "processing",
      progress: 45,
      phase: "Separando con Spleeter",
      fingerprint: "track-fingerprint",
      cacheKey: "cache-key",
      modelVersion: "spleeter-model-v1",
      manifestPath: "/Music/Karaoke/.guest-star-stems/hash/manifest.json",
      instrumentalPath: "/Music/Karaoke/.guest-star-stems/hash/instrumental.m4a",
      vocalsPath: "/Music/Karaoke/.guest-star-stems/hash/vocals.m4a",
      estimatedTurnSeconds: 90,
      etaSeconds: 25,
      resourceState: "live",
      actualThreads: 2,
      osPriorityApplied: 19,
      updatedAt: "2026-07-29T20:11:00.000Z"
    }]
  });
  assert.equal(state.activityId, "activity-1");
  assert.equal(state.activityStartedAt, "2026-07-29T20:00:00.000Z");
  assert.equal(state.operatingMode, "player");
  assert.equal(state.entries.length, 1);
  assert.equal(state.entries[0].id, "request-1");
  assert.equal(state.entries[0].manualLink, true);
  assert.deepEqual(state.suppressedIds, ["request-3"]);
  assert.deepEqual(state.removedIds, ["request-2"]);
  assert.equal(state.recoveries.length, 1);
  assert.equal(state.recoveries[0].originalPosition, 2);
  assert.equal(state.recoveries[0].entry.singer, "Ana");
  assert.equal(state.playerRequests.length, 1);
  assert.equal(state.playerRequests[0].singer, "Yefry");
  assert.equal(state.playerRequests[0].status, "Saltado");
  assert.deepEqual(state.playerOrder, ["request-1", "player-local-1"]);
  assert.deepEqual(state.playerQueueVisibility, {
    "request-1": false,
    "player-local-1": true
  });
  assert.equal(state.playerPlayback.currentRequestId, "request-1");
  assert.equal(state.playerPlayback.currentTimeSeconds, 83.5);
  assert.equal(state.playerPlayback.wasPlaying, true);
  assert.equal(state.playerStemJobs.length, 1);
  assert.equal(state.playerStemJobs[0].id, "request-1:spleeter");
  assert.equal(state.playerStemJobs[0].engine, "spleeter");
  assert.equal(state.playerStemJobs[0].intent, "auto");
  assert.equal(state.playerStemJobs[0].status, "queued");
  assert.equal(state.playerStemJobs[0].actualThreads, 2);
  assert.equal(state.playerStemJobs[0].resourceState, "LIVE");
  assert.match(state.playerStemJobs[0].instrumentalPath, /instrumental\.m4a$/);
  assert.match(state.playerStemJobs[0].vocalsPath, /vocals\.m4a$/);
});
