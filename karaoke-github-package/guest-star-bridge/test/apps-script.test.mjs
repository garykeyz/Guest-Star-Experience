import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import {
  appsScriptAction,
  controlActivity,
  searchKaraokeYouTube,
  signInBridge,
  updateBridgeConfig,
  updateBridgeRequest
} from "../src/apps-script.mjs";

function d1Config(port) {
  return {
    appsScriptUrl: `http://127.0.0.1:${port}/api/bridge`,
    authToken: "auth-token",
    deviceToken: "device-token",
    deviceId: "device-1",
    lastHotelId: "hotel-1",
    lastVenueId: "venue-1",
    lastActivityId: "activity-1"
  };
}

test("espera el arranque lento del servicio D1 al iniciar sesion", async (t) => {
  const server = createServer(async (request, response) => {
    for await (const _chunk of request) {
      // Consume the request body before simulating an Apps Script cold start.
    }
    await new Promise((resolve) => setTimeout(resolve, 10500));
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      ok: true,
      authToken: "auth-token",
      deviceToken: "device-token",
      deviceId: "device-1",
      user: { userId: "user-1", role: "superhost" },
      selection: { hotels: [], venues: [], activities: [] }
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const result = await signInBridge({
    appsScriptUrl: `http://127.0.0.1:${server.address().port}/exec`
  }, {
    username: "superhost",
    password: "temporary-password",
    deviceName: "Guest Star Bridge test"
  });

  assert.equal(result.ok, true);
  assert.equal(result.deviceId, "device-1");
});

test("bloquea por completo el backend heredado de Google Sheets y PIN", async () => {
  await assert.rejects(
    appsScriptAction({ appsScriptUrl: "https://script.google.com/example", hostPin: "123456" }, "bridgeUpdate"),
    /Google Sheets\/PIN backend is disabled/
  );
});

test("envía los controles compartidos con origen bridge", async (t) => {
  let received;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      ok: true,
      codeVersion: "4.2.0",
      state: { accepting: false, stateRevision: 8, activityId: "activity-2" },
      requests: []
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const config = d1Config(server.address().port);

  const result = await controlActivity(config, "close");

  assert.equal(result.state.accepting, false);
  assert.deepEqual(received, {
    action: "toggleRequests",
    authToken: "auth-token",
    deviceToken: "device-token",
    hotelId: "hotel-1",
    venueId: "venue-1",
    activityId: "activity-1",
    source: "bridge",
    open: false
  });
});

test("inicia el reloj compartido sin archivar las solicitudes", async (t) => {
  let received;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      ok: true,
      state: {
        accepting: true,
        lastAction: "start",
        activityStartedAt: "2026-08-04T12:00:00.000Z"
      },
      requests: [{ id: "request-before-start" }]
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  const result = await controlActivity(d1Config(server.address().port), "start");

  assert.equal(result.state.lastAction, "start");
  assert.equal(result.requests.length, 1);
  assert.equal(received.action, "startActivityV4");
  assert.equal(received.source, "bridge");
});

test("inicia Player con origen player y no lo convierte en Bridge", async (t) => {
  let received;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      ok: true,
      state: { activityRunning: true, playbackMode: "player" },
      requests: []
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  await controlActivity(d1Config(server.address().port), "start", "player");

  assert.equal(received.action, "startActivityV4");
  assert.equal(received.source, "player");
});

test("actualiza en la fila un solo enlace elegido y la duración exacta", async (t) => {
  let received;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, state: {} }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  await updateBridgeRequest(
    d1Config(server.address().port),
    "request-1",
    "No está local",
    "",
    {
      durationSeconds: 243,
      sourceUrl: "https://www.youtube.com/watch?v=karaoke123"
    }
  );

  assert.equal(received.sourceUrl, "https://www.youtube.com/watch?v=karaoke123");
  assert.equal(received.durationSeconds, 243);
});

test("envía el idioma de la canción al buscar opciones en YouTube", async (t) => {
  let received;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, items: [] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  await searchKaraokeYouTube(
    d1Config(server.address().port),
    "Vivir Mi Vida",
    "Marc Anthony",
    "Español",
    "spanish"
  );

  assert.deepEqual(received, {
    action: "youtubeSearchV4",
    authToken: "auth-token",
    deviceToken: "device-token",
    hotelId: "hotel-1",
    venueId: "venue-1",
    activityId: "activity-1",
    song: "Vivir Mi Vida",
    artist: "Marc Anthony",
    language: "Español",
    languageCode: "spanish"
  });
});

test("actualiza duración, transición y apertura desde la app", async (t) => {
  let received;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, state: {} }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  await updateBridgeConfig(
    d1Config(server.address().port),
    {
      activityHours: 3,
      transitionSeconds: 45,
      accepting: false
    }
  );

  assert.deepEqual(received, {
    action: "updateActivitySettings",
    authToken: "auth-token",
    deviceToken: "device-token",
    hotelId: "hotel-1",
    venueId: "venue-1",
    activityId: "activity-1",
    source: "bridge",
    defaultDurationSeconds: 10800,
    defaultTransitionSeconds: 45
  });
});

test("avisa al Host cuando el servicio publicado todavía es anterior a 4.1", async (t) => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: false, code: "INVALID_ACTION" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());

  await assert.rejects(
    controlActivity(
      d1Config(server.address().port),
      "reset"
    ),
    /service version 4\.2\.0.*Contact the Superhost/i
  );
});
