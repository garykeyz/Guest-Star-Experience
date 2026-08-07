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

test("espera el arranque lento de Apps Script al iniciar sesion", async (t) => {
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

test("envía al Apps Script la acción, el PIN y los datos de la solicitud", async (t) => {
  let received;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    received = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ ok: true, requests: [] }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const config = {
    appsScriptUrl: `http://127.0.0.1:${address.port}/exec`,
    hostPin: "123456"
  };
  const result = await appsScriptAction(config, "bridgeUpdate", {
    id: "request-1",
    status: "Agregada a VirtualDJ"
  });
  assert.equal(result.ok, true);
  assert.deepEqual(received, {
    action: "bridgeUpdate",
    pin: "123456",
    id: "request-1",
    status: "Agregada a VirtualDJ"
  });
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
      codeVersion: "4.1.0",
      state: { accepting: false, stateRevision: 8, activityId: "activity-2" },
      requests: []
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  const config = {
    appsScriptUrl: `http://127.0.0.1:${address.port}/exec`,
    hostPin: "123456"
  };

  const result = await controlActivity(config, "close");

  assert.equal(result.state.accepting, false);
  assert.deepEqual(received, {
    action: "bridgeControl",
    pin: "123456",
    control: "close",
    source: "bridge"
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

  const result = await controlActivity({
    appsScriptUrl: `http://127.0.0.1:${server.address().port}/exec`,
    hostPin: "123456"
  }, "start");

  assert.equal(result.state.lastAction, "start");
  assert.equal(result.requests.length, 1);
  assert.equal(received.control, "start");
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
    {
      appsScriptUrl: `http://127.0.0.1:${server.address().port}/exec`,
      hostPin: "123456"
    },
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
    {
      appsScriptUrl: `http://127.0.0.1:${server.address().port}/exec`,
      hostPin: "123456"
    },
    "Vivir Mi Vida",
    "Marc Anthony",
    "Español",
    "spanish"
  );

  assert.deepEqual(received, {
    action: "youtubeSearch",
    pin: "123456",
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
    {
      appsScriptUrl: `http://127.0.0.1:${server.address().port}/exec`,
      hostPin: "123456"
    },
    {
      activityHours: 3,
      transitionSeconds: 45,
      accepting: false
    }
  );

  assert.deepEqual(received, {
    action: "bridgeConfigUpdate",
    pin: "123456",
    source: "bridge",
    activityHours: 3,
    transitionSeconds: 45,
    accepting: false
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
      {
        appsScriptUrl: `http://127.0.0.1:${server.address().port}/exec`,
        hostPin: "123456"
      },
      "reset"
    ),
    /service version 4\.1\.0.*Contact the Superhost/i
  );
});
