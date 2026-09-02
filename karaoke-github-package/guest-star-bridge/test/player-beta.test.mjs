import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

async function listen(server) {
  await new Promise((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  return server.address().port;
}

async function freePort() {
  const server = createServer();
  const port = await listen(server);
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

async function waitForState(url, predicate, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    try {
      latest = await fetch(`${url}/api/state`).then((response) => response.json());
      if (predicate(latest)) return latest;
    } catch {
      // Guest Star can still be starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
  }
  throw new Error(`El Player no llegó al estado esperado: ${JSON.stringify(latest)}`);
}

test("el Player crea una fila local antes de iniciar la actividad y la conserva al comenzar", async (t) => {
  const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const tempRoot = await mkdtemp(join(tmpdir(), "guest-star-player-beta-"));
  const bridgeRoot = join(tempRoot, "bridge");
  const karaokeFolder = join(tempRoot, "karaoke");
  const backgroundFolder = join(tempRoot, "background");
  await cp(sourceRoot, bridgeRoot, { recursive: true });
  await mkdir(join(bridgeRoot, "data"), { recursive: true });
  await mkdir(karaokeFolder, { recursive: true });
  await mkdir(backgroundFolder, { recursive: true });
  await writeFile(join(karaokeFolder, "Marc Anthony - Vivir Mi Vida.mp4"), Buffer.alloc(64));
  await writeFile(join(backgroundFolder, "Purple Disco Machine - Save Me Lonely.mp3"), Buffer.alloc(64));

  const activityStartTime = "2026-08-27T15:00:00.000Z";
  let activityRunning = false;
  const publicRequests = [];
  let youtubeSearchStarted = false;
  const guestStarService = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    let payload = { ok: true };
    if (body.action === "me") {
      payload = {
        ok: true,
        user: { userId: "host-1", username: "host", role: "host" },
        selection: {
          hotels: [{ hotelId: "hotel-1", name: "Moon Palace" }],
          venues: [{ venueId: "venue-1", hotelId: "hotel-1", name: "Lobby Bar" }],
          activities: [{ activityId: "activity-1", hotelId: "hotel-1", venueId: "venue-1", name: "Karaoke Night", status: activityRunning ? "in_progress" : "ready" }]
        }
      };
    } else if (["activityState", "selectActivity", "startActivityV4"].includes(body.action)) {
      if (body.action === "startActivityV4") activityRunning = true;
      payload = {
        ok: true,
        hotel: { hotelId: "hotel-1", name: "Moon Palace" },
        branding: { showHotelLogo: true, hotelLogoUrl: "https://cdn.example.com/moon-palace.png" },
        venue: { venueId: "venue-1", name: "Lobby Bar" },
        activity: { activityId: "activity-1", name: "Karaoke Night", status: activityRunning ? "in_progress" : "ready" },
        share: { publicUrl: "https://request.gstarxp.com/h/moon-palace" },
        state: {
          activityId: "activity-1",
          activityStartedAt: activityRunning ? activityStartTime : "",
          activityRunning,
          activityHours: 2,
          transitionSeconds: 30,
          accepting: true,
          playbackMode: "player",
          lastSource: "player"
        },
        requests: publicRequests
      };
    } else if (body.action === "youtubeSearchV4") {
      youtubeSearchStarted = true;
      await new Promise((resolveWait) => setTimeout(resolveWait, 1200));
      payload = { ok: true, items: [] };
    } else if (body.action === "pollBridgeCommands") {
      payload = { ok: true, commands: [] };
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(payload));
  });
  const servicePort = await listen(guestStarService);
  const bridgePort = await freePort();

  await writeFile(join(bridgeRoot, "data", "config.json"), `${JSON.stringify({
    configVersion: 12,
    bridgePort,
    authToken: "auth-token",
    deviceToken: "device-token",
    deviceId: "device-1",
    lastHotelId: "hotel-1",
    lastVenueId: "venue-1",
    lastActivityId: "activity-1",
    libraryFolders: [karaokeFolder],
    backgroundMusicSources: [backgroundFolder],
    backgroundMusicVolume: 0.37,
    appsScriptUrl: `http://127.0.0.1:${servicePort}/exec`,
    virtualDJ: { host: "127.0.0.1", port: 9, password: "", timeoutMs: 500 },
    requestIntervalSeconds: 120,
    scanIntervalSeconds: 120,
    autoQueueExact: false
  }, null, 2)}\n`);
  await writeFile(join(bridgeRoot, "data", "queue-state.json"), `${JSON.stringify({
    activityId: "activity-1",
    activityStartedAt: "",
    operatingMode: "player",
    entries: [],
    suppressedIds: [],
    recoveries: [],
    removedIds: [],
    playerRequests: []
  }, null, 2)}\n`);

  const child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: bridgeRoot,
    env: { ...process.env, GUEST_STAR_WEB_BETA: "1" },
    stdio: ["ignore", "ignore", "pipe"]
  });
  let childError = "";
  child.stderr.on("data", (chunk) => { childError += chunk.toString("utf8"); });
  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolveClose) => guestStarService.close(resolveClose));
  });

  const url = `http://127.0.0.1:${bridgePort}`;
  let state = await waitForState(url, (candidate) =>
    candidate.account?.authenticated === true &&
    candidate.operatingMode?.selected === "player" &&
    candidate.activity?.activityRunning === false &&
    candidate.tenant?.branding?.hotelLogoUrl &&
    candidate.tenant?.share?.publicUrl &&
    candidate.library?.count === 1 &&
    candidate.backgroundMusic?.count === 1
  );
  assert.equal(state.backgroundMusic.volume, 0.37);
  assert.equal(state.tenant.branding.hotelLogoUrl, "https://cdn.example.com/moon-palace.png");
  assert.equal(state.tenant.share.publicUrl, "https://request.gstarxp.com/h/moon-palace");

  const backgroundTrack = state.backgroundMusic.tracks[0];
  const backgroundMedia = await fetch(`${url}/api/player/background/media/${encodeURIComponent(backgroundTrack.id)}`);
  assert.equal(backgroundMedia.status, 200);
  assert.equal((await backgroundMedia.arrayBuffer()).byteLength, 64);

  await writeFile(join(karaokeFolder, "Bad Bunny - Yo Perreo Sola.mp4"), Buffer.alloc(80));
  const rescanned = await fetch(`${url}/api/player/sync`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  }).then((response) => response.json());
  assert.equal(rescanned.ok, true, rescanned.error || childError);
  assert.equal(rescanned.library.count, 2);
  const detected = await fetch(`${url}/api/player/library?query=perreo`).then((response) => response.json());
  assert.equal(detected.tracks[0].song, "Yo Perreo Sola");

  const track = await fetch(`${url}/api/player/library?query=vivir`).then((response) => response.json()).then((data) => data.tracks[0]);
  assert.equal(track.artist, "Marc Anthony");
  assert.equal(track.song, "Vivir Mi Vida");

  const created = await fetch(`${url}/api/player/local-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trackId: track.id, singer: "Gary" })
  }).then((response) => response.json());
  assert.equal(created.ok, true, created.error || childError);
  assert.equal(created.item.singer, "Gary");
  assert.equal(created.item.sourceType, "player_local");

  state = await fetch(`${url}/api/state`).then((response) => response.json());
  const local = state.requests.find((item) => item.id === created.item.id);
  assert.equal(local.status, "En fila del Player");
  assert.equal(local.localAvailable, true);
  assert.equal(state.activity.activityRunning, false);

  const started = await fetch(`${url}/api/activity/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  }).then((response) => response.json());
  assert.equal(started.ok, true, started.error || childError);
  assert.equal(started.activity.activityRunning, true);

  publicRequests.push({
    id: "public-request-slow-maintenance",
    timestamp: "2026-08-27T15:00:30.000Z",
    singer: "Diana",
    song: "Pista Que No Existe",
    artist: "Artista Remoto",
    language: "Español",
    sourceType: "guest_request",
    status: "Pendiente",
    durationSeconds: 240,
    transitionSeconds: 30
  });
  await fetch(`${url}/api/player/requests/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  });
  const maintenanceDeadline = Date.now() + 2000;
  while (!youtubeSearchStarted && Date.now() < maintenanceDeadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  assert.equal(youtubeSearchStarted, true, "the slow optional YouTube maintenance must be running in the background");

  publicRequests.push({
    id: "public-request-live-1",
    timestamp: "2026-08-27T15:01:00.000Z",
    singer: "Moises",
    song: "Yo Perreo Sola",
    artist: "Bad Bunny",
    language: "Español",
    sourceType: "guest_request",
    status: "Pendiente",
    durationSeconds: 240,
    transitionSeconds: 30
  });
  const pullStartedAt = performance.now();
  const pulled = await fetch(`${url}/api/player/requests/pull`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  }).then((response) => response.json());
  const pullElapsedMs = performance.now() - pullStartedAt;
  assert.equal(pulled.ok, true, pulled.error || childError);
  assert.equal(
    pulled.requests.some((item) => item.id === "public-request-live-1" && item.singer === "Moises"),
    true,
    "a public request must enter the running Player without any VirtualDJ dependency"
  );
  assert.ok(pullElapsedMs < 700,
    `public requests must not wait for YouTube/local maintenance (${pullElapsedMs.toFixed(1)} ms)`);

  const completed = await fetch(`${url}/api/player/requests/${encodeURIComponent(local.id)}/outcome`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ outcome: "completed" })
  }).then((response) => response.json());
  assert.equal(completed.ok, true, completed.error || childError);
  assert.equal(completed.status, "Ya cantó");

  const finalState = await fetch(`${url}/api/state`).then((response) => response.json());
  assert.equal(finalState.requests.find((item) => item.id === local.id).outcome, "completed");

  const undone = await fetch(`${url}/api/player/requests/${encodeURIComponent(local.id)}/undo`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}"
  }).then((response) => response.json());
  assert.equal(undone.ok, true, undone.error || childError);
  const removed = await fetch(`${url}/api/player/requests/${encodeURIComponent(local.id)}/outcome`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ outcome: "removed" })
  }).then((response) => response.json());
  assert.equal(removed.status, "Retirada del Player");
  const removedState = await fetch(`${url}/api/state`).then((response) => response.json());
  assert.equal(removedState.requests.find((item) => item.id === local.id).outcome, "removed");
});
