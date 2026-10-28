import assert from "node:assert/strict";
import { setTimeout as wait } from "node:timers/promises";
import WebSocket from "ws";
import { loadConfig } from "../guest-star-bridge/src/config.mjs";

const endpoint = new URL(
  process.env.GUEST_STAR_REALTIME_URL || "https://request.gstarxp.com"
);
const durationMs = Math.max(
  600_000,
  Number(process.env.GUEST_STAR_IDLE_DURATION_MS) || 600_000
);
const participantCount = 30;
const publicOnly = process.env.GUEST_STAR_IDLE_PUBLIC_ONLY === "1";
const protocol = "guest-star-v1";
const timeoutMs = 15_000;
const sockets = new Set();

function socketUrl(params) {
  const url = new URL("/api/realtime", endpoint);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}

function waitForMessage(client, predicate, description) {
  const existing = client.messages.find(({ value }) => predicate(value));
  if (existing) return Promise.resolve(existing.value);
  return new Promise((resolve, reject) => {
    const waiter = { predicate, resolve, reject, description };
    client.waiters.add(waiter);
    waiter.timer = setTimeout(() => {
      client.waiters.delete(waiter);
      reject(new Error(`${client.name} timed out waiting for ${description}`));
    }, timeoutMs);
  });
}

async function connect(name, params, options = {}) {
  const socket = new WebSocket(socketUrl(params), protocol, {
    origin: endpoint.origin,
    handshakeTimeout: timeoutMs,
    perMessageDeflate: false,
    ...(options.cookie ? { headers: { Cookie: options.cookie } } : {})
  });
  sockets.add(socket);
  const client = {
    name,
    socket,
    messages: [],
    errors: [],
    closes: [],
    waiters: new Set()
  };
  socket.on("message", (raw) => {
    let value;
    try { value = JSON.parse(raw.toString("utf8")); }
    catch { value = { type: "invalid-json" }; }
    client.messages.push({ receivedAt: Date.now(), value });
    for (const waiter of [...client.waiters]) {
      if (!waiter.predicate(value)) continue;
      clearTimeout(waiter.timer);
      client.waiters.delete(waiter);
      waiter.resolve(value);
    }
  });
  socket.on("error", (error) => client.errors.push(String(error?.message || error)));
  socket.on("close", (code, reason) => {
    client.closes.push({ code, reason: reason.toString("utf8") });
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${name} connection timed out`)), timeoutMs);
    socket.once("open", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return client;
}

async function closeAll() {
  await Promise.all([...sockets].map((socket) => new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) return resolve();
    const timer = setTimeout(() => {
      socket.terminate();
      resolve();
    }, 2_000);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.close(1000, "connected idle complete");
  })));
}

let clients = [];
try {
  const config = await loadConfig();
  assert.ok(config.authToken && config.deviceToken && config.deviceId, "Saved Bridge session required");
  assert.ok(config.lastHotelId && config.lastActivityId, "Saved Bridge selection required");

  const publicClients = await Promise.all(Array.from(
    { length: participantCount },
    (_, index) => connect(`participant-${index + 1}`, {
      channel: config.lastHotelId,
      role: "public"
    })
  ));
  await Promise.all(publicClients.map((client) => waitForMessage(
    client,
    (message) => message.type === "realtime.ready",
    "realtime.ready"
  )));

  let host = null;
  let superhost = null;
  if (!publicOnly) {
    host = await connect("host", {
      channel: config.lastHotelId,
      role: "host"
    }, {
      cookie: `guest_star_host_session=${config.authToken}`
    });
    await waitForMessage(host, (message) => message.type === "realtime.ready", "realtime.ready");

    superhost = await connect("superhost-bridge", {
      channel: config.lastHotelId,
      role: "bridge",
      activityId: config.lastActivityId,
      deviceId: config.deviceId,
      mode: "bridge"
    });
    await waitForMessage(
      superhost,
      (message) => message.type === "realtime.auth-required",
      "realtime.auth-required"
    );
    superhost.socket.send(JSON.stringify({
      type: "auth",
      authToken: config.authToken,
      deviceToken: config.deviceToken
    }));
    await waitForMessage(superhost, (message) => message.type === "realtime.ready", "realtime.ready");
  }

  clients = [...publicClients, ...(host ? [host] : []), ...(superhost ? [superhost] : [])];
  await wait(2_000);
  const startedAt = Date.now();
  const startedMonotonic = performance.now();
  const startedIso = new Date(startedAt).toISOString();
  while (performance.now() - startedMonotonic < durationMs) {
    await wait(Math.max(1, durationMs - (performance.now() - startedMonotonic)));
  }
  const finishedAt = Date.now();
  const elapsedMs = performance.now() - startedMonotonic;
  const finishedIso = new Date(finishedAt).toISOString();
  assert.ok(elapsedMs >= durationMs, "Connected idle window ended before its minimum duration");

  const windowMessages = clients.flatMap((client) => client.messages
    .filter(({ receivedAt }) => receivedAt >= startedAt && receivedAt <= finishedAt)
    .map(({ value }) => ({ client: client.name, type: value.type || "unknown" }))
  );
  const disconnected = clients.filter((client) => client.socket.readyState !== WebSocket.OPEN);
  const errors = clients.flatMap((client) => client.errors.map((error) => ({ client: client.name, error })));
  const closes = clients.flatMap((client) => client.closes.map((close) => ({ client: client.name, ...close })));
  assert.deepEqual(disconnected.map((client) => client.name), [], "Idle clients disconnected");
  assert.deepEqual(errors, [], "Idle clients emitted errors");
  assert.deepEqual(closes, [], "Idle clients closed before the measurement ended");
  assert.deepEqual(windowMessages, [], "Idle window received application broadcasts");

  console.log(JSON.stringify({
    ok: true,
    endpoint: endpoint.origin,
    startedAt: startedIso,
    finishedAt: finishedIso,
    durationMs: Number(elapsedMs.toFixed(1)),
    wallClockDurationMs: finishedAt - startedAt,
    clients: {
      participants: publicClients.length,
      host: host ? 1 : 0,
      superhost: superhost ? 1 : 0,
      total: clients.length,
      socketsPerClient: 1,
      authenticatedRolesSkipped: publicOnly
    },
    activityDuringWindow: {
      clientMessages: windowMessages.length,
      socketErrors: errors.length,
      prematureCloses: closes.length,
      reconnects: 0,
      applicationBroadcasts: 0,
      clientHttpPollingRequests: 0
    }
  }, null, 2));
} finally {
  await closeAll();
}
