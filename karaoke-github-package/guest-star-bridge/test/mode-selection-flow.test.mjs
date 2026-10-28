import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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

async function waitForState(url, predicate, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    try {
      latest = await fetch(`${url}/api/state`).then((response) => response.json());
      if (predicate(latest)) return latest;
    } catch {
      // The isolated Bridge can still be starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
  }
  throw new Error(`El estado esperado no llegó: ${JSON.stringify(latest)}`);
}

async function post(url, path, body = {}) {
  const response = await fetch(`${url}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await response.json();
  return { response, data };
}

test("Superhost puede cambiar el modo durante una actividad sin finalizarla", async (t) => {
  const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const tempRoot = await mkdtemp(join(tmpdir(), "guest-star-mode-flow-"));
  const bridgeRoot = join(tempRoot, "bridge");
  await mkdir(bridgeRoot, { recursive: true });
  await Promise.all([
    cp(join(sourceRoot, "src"), join(bridgeRoot, "src"), { recursive: true }),
    cp(join(sourceRoot, "public"), join(bridgeRoot, "public"), { recursive: true }),
    cp(join(sourceRoot, "package.json"), join(bridgeRoot, "package.json"))
  ]);
  await mkdir(join(bridgeRoot, "data"), { recursive: true });

  const requests = [{
    id: "request-mode-1",
    timestamp: "2026-09-18T12:00:00.000Z",
    singer: "Ana",
    song: "Hello",
    artist: "Adele",
    status: "Pendiente",
    durationSeconds: 240,
    transitionSeconds: 15
  }];
  const activity = {
    accepting: true,
    activityHours: 2,
    transitionSeconds: 15,
    remainingSeconds: 7200,
    activityStartedAt: "",
    activityFinishedAt: "",
    activityRunning: false,
    activityId: "activity-mode-1",
    playbackMode: "",
    stateRevision: 1,
    lastAction: "setup",
    lastSource: "cloud"
  };
  let status = "ready";
  const receivedActions = [];

  const cloudServer = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    receivedActions.push({ action: body.action, source: body.source || "" });
    let payload = { ok: true };
    if (body.action === "me") {
      payload = {
        ok: true,
        user: { id: "superhost-mode", role: "superhost", displayName: "Mode Tester" },
        selection: {
          hotels: [{ hotelId: "hotel-mode", name: "Mode Hotel" }],
          venues: [{ venueId: "venue-mode", hotelId: "hotel-mode", name: "Mode Venue" }],
          activities: [{ activityId: activity.activityId, hotelId: "hotel-mode", venueId: "venue-mode", name: "Mode Night", status }]
        }
      };
    } else if (body.action === "startActivityV4" || body.action === "startNewActivityV4") {
      if (body.action === "startNewActivityV4") activity.activityId = "activity-mode-2";
      activity.activityRunning = true;
      activity.activityStartedAt = "2026-09-18T12:30:00.000Z";
      activity.activityFinishedAt = "";
      activity.playbackMode = body.source;
      activity.lastSource = body.source;
      activity.lastAction = "activity.start";
      activity.stateRevision += 1;
      status = "in_progress";
    } else if (body.action === "finishActivityV4") {
      activity.activityRunning = false;
      activity.activityFinishedAt = "2026-09-18T14:30:00.000Z";
      activity.lastAction = "activity.finish";
      activity.stateRevision += 1;
      status = "finished";
    }
    if (["activityState", "startActivityV4", "startNewActivityV4", "finishActivityV4"].includes(body.action)) {
      payload = {
        ok: true,
        codeVersion: "4.5",
        state: { ...activity },
        requests,
        hotel: { hotelId: "hotel-mode", name: "Mode Hotel" },
        venue: { venueId: "venue-mode", name: "Mode Venue" },
        activity: { activityId: activity.activityId, name: "Mode Night", status },
        permissions: { all: true }
      };
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(payload));
  });
  const cloudPort = await listen(cloudServer);
  const bridgePort = await freePort();

  await writeFile(join(bridgeRoot, "data", "config.json"), `${JSON.stringify({
    configVersion: 12,
    bridgePort,
    authToken: "mode-auth-token",
    deviceToken: "mode-device-token",
    deviceId: "mode-device",
    lastHotelId: "hotel-mode",
    lastVenueId: "venue-mode",
    lastActivityId: "activity-mode-1",
    appsScriptUrl: `http://127.0.0.1:${cloudPort}/exec`,
    virtualDJ: { host: "127.0.0.1", port: 9, password: "", timeoutMs: 100 },
    scanIntervalSeconds: 60,
    autoQueueExact: false
  }, null, 2)}\n`);

  const child = spawn(process.env.GUEST_STAR_TEST_NODE || process.execPath, ["src/server.mjs"], {
    cwd: bridgeRoot,
    stdio: ["ignore", "ignore", "pipe"]
  });
  let childError = "";
  child.stderr.on("data", (chunk) => { childError += chunk.toString("utf8"); });
  t.after(async () => {
    child.kill("SIGTERM");
    await new Promise((resolveClose) => cloudServer.close(resolveClose));
    await rm(tempRoot, { recursive: true, force: true });
  });

  const bridgeUrl = `http://127.0.0.1:${bridgePort}`;
  let state = await waitForState(bridgeUrl, (candidate) =>
    candidate.account?.authenticated === true && candidate.tenant?.activity?.activityId === "activity-mode-1"
  );
  assert.equal(state.activity.activityRunning, false);
  assert.equal(state.operatingMode.locked, false);
  assert.equal(state.requests.length, 1);

  for (const mode of ["bridge", "player", "bridge", "player", "bridge"]) {
    const { response, data } = await post(bridgeUrl, "/api/activity/mode", { mode });
    assert.equal(response.status, 200);
    assert.equal(data.operatingMode.selected, mode);
    assert.equal(data.operatingMode.locked, false);
    assert.equal(data.activity.activityRunning, false, "seleccionar o abrir un modo no inicia la actividad");
    assert.equal(data.requests[0].id, "request-mode-1", "cambiar modo conserva la preparación");
  }
  const configured = await post(bridgeUrl, "/api/config", {
    virtualDJ: { host: "127.0.0.1", port: 9, password: "", timeoutMs: 120 }
  });
  assert.equal(configured.response.status, 200);
  state = await fetch(`${bridgeUrl}/api/state`).then((response) => response.json());
  assert.equal(state.activity.activityRunning, false, "configurar VirtualDJ no inicia la actividad");
  assert.equal(state.operatingMode.selected, "bridge");
  assert.equal(state.operatingMode.locked, false, "preparar solicitudes no bloquea el modo");
  assert.equal(state.requests[0].id, "request-mode-1");
  assert.equal(receivedActions.some(({ action }) => action === "startActivityV4"), false);

  ({ data: state } = await post(bridgeUrl, "/api/activity/start"));
  assert.equal(state.operatingMode.selected, "bridge");
  assert.equal(state.operatingMode.locked, false);
  assert.equal(state.activity.activityRunning, true);
  assert.equal(state.activity.playbackMode, "bridge");
  assert.equal(receivedActions.findLast(({ action }) => action === "startActivityV4")?.source, "bridge");
  let switched = await post(bridgeUrl, "/api/activity/mode", { mode: "player" });
  assert.equal(switched.response.status, 200);
  assert.equal(switched.data.operatingMode.selected, "player");
  assert.equal(switched.data.activity.activityRunning, true);
  ({ data: state } = await post(bridgeUrl, "/api/requests/sync"));
  assert.equal(state.operatingMode.selected, "player", "el refresco remoto conserva la elección Superhost");

  ({ data: state } = await post(bridgeUrl, "/api/activity/finish"));
  assert.equal(state.activity.activityRunning, false);
  assert.equal(state.operatingMode.locked, false);
  assert.equal(state.operatingMode.selected, "");

  ({ data: state } = await post(bridgeUrl, "/api/activity/mode", { mode: "player" }));
  assert.equal(state.operatingMode.selected, "player");
  assert.equal(state.operatingMode.locked, false);
  ({ data: state } = await post(bridgeUrl, "/api/activity/start-new"));
  assert.equal(state.operatingMode.selected, "player");
  assert.equal(state.operatingMode.locked, false);
  assert.equal(state.activity.activityRunning, true);
  assert.equal(state.activity.playbackMode, "player");
  assert.equal(receivedActions.findLast(({ action }) => action === "startNewActivityV4")?.source, "player");
  switched = await post(bridgeUrl, "/api/activity/mode", { mode: "bridge" });
  assert.equal(switched.response.status, 200);
  assert.equal(switched.data.operatingMode.selected, "bridge");
  assert.equal(switched.data.activity.activityRunning, true);
  ({ data: state } = await post(bridgeUrl, "/api/requests/sync"));
  assert.equal(state.operatingMode.selected, "bridge", "el refresco remoto conserva el cambio a Bridge");

  ({ data: state } = await post(bridgeUrl, "/api/activity/finish"));
  assert.equal(state.operatingMode.locked, false);
  assert.equal(state.operatingMode.selected, "");
  assert.equal(state.requests[0].id, "request-mode-1");
  assert.equal(childError, "");
});
