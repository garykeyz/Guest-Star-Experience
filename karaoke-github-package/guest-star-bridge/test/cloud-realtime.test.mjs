import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { realtimeResponseHeaders } from "../../lib/guest-star/realtime-event.ts";
import { bridgeRealtimeConnection } from "../src/apps-script.mjs";

const sampleConfig = {
  appsScriptUrl: "https://request.gstarxp.com/api/bridge",
  authToken: "auth-token-12345678",
  deviceToken: "device-token-12345678",
  deviceId: "device-12345678",
  lastHotelId: "hotel-12345678",
  lastActivityId: "activity-12345678"
};

test("realtime keeps credentials out of the URL and isolates the hotel channel", () => {
  const connection = bridgeRealtimeConnection(sampleConfig, "bridge");
  const url = new URL(connection.url);
  assert.equal(url.protocol, "wss:");
  assert.equal(url.pathname, "/api/realtime");
  assert.equal(url.searchParams.get("channel"), sampleConfig.lastHotelId);
  assert.equal(url.searchParams.get("activityId"), sampleConfig.lastActivityId);
  assert.equal(url.searchParams.get("deviceId"), sampleConfig.deviceId);
  assert.equal(url.searchParams.get("mode"), "bridge");
  assert.deepEqual(connection.protocols, ["guest-star-v1"]);
  assert.deepEqual(connection.authentication, {
    type: "auth",
    authToken: sampleConfig.authToken,
    deviceToken: sampleConfig.deviceToken
  });
  const handshakeMetadata = [connection.url, ...connection.protocols].join("\n");
  assert.equal(handshakeMetadata.includes(sampleConfig.authToken), false);
  assert.equal(handshakeMetadata.includes(sampleConfig.deviceToken), false);
});

test("realtime publishes only the supported operating mode", () => {
  assert.equal(
    new URL(bridgeRealtimeConnection(sampleConfig, "player").url).searchParams.get("mode"),
    "player"
  );
  assert.equal(
    new URL(bridgeRealtimeConnection(sampleConfig, "unexpected").url).searchParams.get("mode"),
    "observer"
  );
});

test("the cloud connection is event-driven when WebSocket is healthy", async () => {
  const source = await readFile(new URL("../src/server.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("async function requestLoop()"), false);
  assert.equal(source.includes("sendBridgeHeartbeat(config"), false);
  assert.match(source, /restartCloudRealtime\(\)/);
  assert.match(source, /Math\.min\(30_000, 1_000 \* \(2 \*\* Math\.min\(cloudRealtimeAttempt, 5\)\)\)/);
  assert.match(source, /socket\.send\(JSON\.stringify\(connection\.authentication\)\)/);
  assert.match(source, /message\.type === "realtime\.ready"/);
  assert.match(source, /if \(generation !== cloudRealtimeGeneration \|\| cloudRealtimeSocket !== socket\) return;\s*cloudRealtimeSocket = null;/);
  assert.doesNotMatch(source, /addEventListener\("error",\s*\(\)\s*=>\s*socket\.close/);
  assert.match(source, /socket\.addEventListener\("error", \(\) => \{[\s\S]*?cloudRealtimeReady = false;[\s\S]*?Undici closes failed WebSockets itself/);
  assert.match(source, /scheduleCloudFallback\(generation, true\)/);
});

test("realtime refreshes preserve a trailing invalidation", async () => {
  const [bridgeSource, hostSource, publicSource] = await Promise.all([
    readFile(new URL("../src/server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../components/HostPanel.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../components/KaraokeExperience.tsx", import.meta.url), "utf8")
  ]);
  assert.match(bridgeSource, /cloudRealtimePendingSync = false;[\s\S]*?if \(refreshState\) await syncNow\(\)/);
  assert.match(bridgeSource, /while \([\s\S]*?cloudRealtimePendingSync \|\| cloudRealtimePendingCommands[\s\S]*?\)/);
  assert.match(hostSource, /if\(refreshing\)\{refreshQueued=true;return;\}/);
  assert.match(hostSource, /while\(active&&refreshQueued\)/);
  assert.match(hostSource, /scheduleFallback\(true\)/);
  assert.match(publicSource, /if\(refreshInFlight\)\{refreshQueued=true;return refreshInFlight;\}/);
  assert.match(publicSource, /while\(mounted&&refreshQueued\)/);
  assert.match(publicSource, /invalidationTimer=window\.setTimeout/);
  assert.match(publicSource, /scheduleFallback\(true\)/);
});

test("the Worker accepts bridge credentials only in the first authenticated frame", async () => {
  const source = await readFile(new URL("../../worker.mjs", import.meta.url), "utf8");
  assert.equal(source.includes("guest-star-auth."), false);
  assert.match(source, /\["public\.request\.created", \["public", "host", "bridge"\]\]/);
  assert.match(source, /parsed\?\.type !== "auth"/);
  assert.match(source, /socket\.close\(1008, "Realtime authentication frame required"\)/);
  assert.match(source, /authToken: safeId\(parsed\.authToken\)/);
  assert.match(source, /socket\.serializeAttachment\(\{ \.\.\.attached, authenticated: true/);
});

test("realtime routing trusts the authorized response, never a submitted hotel", () => {
  const headers = realtimeResponseHeaders(
    "/api/bridge",
    "bridgeRequestUpdate",
    { hotelId: "spoofed-hotel" },
    { ok: true, realtimeChannel: "verified-hotel", backupNeeded: true }
  );
  assert.equal(headers["X-Guest-Star-Realtime-Channel"], "verified-hotel");
  assert.deepEqual(
    realtimeResponseHeaders(
      "/api/host",
      "toggleRequests",
      { hotelId: "submitted-only" },
      { ok: true }
    ),
    {}
  );
});

test("no-op and idempotent writes do not fan out invalidations", () => {
  assert.deepEqual(
    realtimeResponseHeaders(
      "/api/bridge",
      "bridgeRequestUpdate",
      {},
      { ok: true, realtimeChannel: "verified-hotel", backupNeeded: false }
    ),
    {}
  );
  assert.deepEqual(
    realtimeResponseHeaders(
      "/api/host",
      "queueBridgeCommand",
      {},
      { ok: true, realtimeChannel: "verified-hotel", idempotent: true }
    ),
    {}
  );
  const selectionHeaders=realtimeResponseHeaders('/api/bridge','selectActivity',{}, {ok:true,hotel:{hotelId:'verified-hotel'}});
  assert.equal(selectionHeaders['X-Guest-Star-Realtime-Channel'],undefined,'selection must not fan out a queue invalidation');
  assert.equal(JSON.parse(selectionHeaders['X-Guest-Star-Run-Wakeup']).hotelId,'verified-hotel','authorized selection may wake the run alarm');
});

test("public queue changes carry an absolute count instead of causing one D1 read per guest", async () => {
  const headers = realtimeResponseHeaders(
    "/api/karaoke",
    "",
    {},
    { ok: true, realtimeChannel: "verified-hotel", queuePeopleCount: 7 }
  );
  assert.equal(headers["X-Guest-Star-Realtime-Queue-Count"], "7");
  const [workerSource, publicSource] = await Promise.all([
    readFile(new URL("../../worker.mjs", import.meta.url), "utf8"),
    readFile(new URL("../../components/KaraokeExperience.tsx", import.meta.url), "utf8")
  ]);
  assert.match(workerSource, /queuePeopleCount: event\.queuePeopleCount/);
  assert.match(publicSource, /\["public\.request\.created","request\.changed"\]/);
  assert.match(publicSource, /queuePeopleCount:Math\.max\(0,Math\.floor/);
});

test("the disabled root experience cannot invalidate any hotel", () => {
  const headers = realtimeResponseHeaders(
    "/api/host",
    "setDefaultPublicExperience",
    {},
    {
      ok: false,
      code: "DEFAULT_PUBLIC_EXPERIENCE_DISABLED"
    }
  );
  assert.deepEqual(headers, {});
});
