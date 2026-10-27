import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os, { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { promisify } from "node:util";
import WebSocket from "ws";

// Some managed runners block libuv interface enumeration. Miniflare only needs
// loopback networking for this local harness.
os.networkInterfaces = () => ({
  lo: [{
    address: "127.0.0.1",
    netmask: "255.0.0.0",
    family: "IPv4",
    mac: "00:00:00:00:00:00",
    internal: true,
    cidr: "127.0.0.1/8"
  }]
});

const execute = promisify(execFile);
const packageRoot = resolve(new URL("..", import.meta.url).pathname);
const wrangler = resolve(packageRoot, "node_modules/.bin/wrangler");
const clientCount = 100;
const hotelId = "hotel-reconnect-load-0001";
const protocol = "guest-star-v1";
const messageTimeoutMs = 10_000;
const quietWindowMs = 150;
const bundleRoot = await mkdtemp(join(tmpdir(), "guest-star-reconnect-bundle-"));
const liveSockets = new Set();
let miniflare;

const harnessWrapperSource = String.raw`
import workerUnderTest, { GuestStarRealtime as RealtimeUnderTest } from "./worker.js";

function guardedEnvironment(environment, counter) {
  const d1Tripwire = new Proxy(Object.create(null), {
    get(_target, property) {
      counter.value += 1;
      throw new Error("REALTIME_D1_ACCESS_FORBIDDEN:" + String(property));
    }
  });
  return new Proxy(environment, {
    get(target, property, receiver) {
      if (property === "GUEST_STAR_DB") {
        counter.value += 1;
        return d1Tripwire;
      }
      return Reflect.get(target, property, receiver);
    }
  });
}

const workerD1Touches = { value: 0 };

export class GuestStarRealtime extends RealtimeUnderTest {
  constructor(state, environment) {
    const counter = { value: 0 };
    super(state, guardedEnvironment(environment, counter));
    this.harnessD1Touches = counter;
  }

  async fetch(request) {
    if (new URL(request.url).pathname === "/__harness/d1-touch-count") {
      return new Response(String(this.harnessD1Touches.value));
    }
    return super.fetch(request);
  }
}

export default {
  async fetch(request, environment, context) {
    if (new URL(request.url).pathname === "/__harness/d1-touch-count") {
      return new Response(String(workerD1Touches.value));
    }
    return workerUnderTest.fetch(
      request,
      guardedEnvironment(environment, workerD1Touches),
      context
    );
  }
};
`;

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

function messageCount(client, type, action = "") {
  return client.messages.filter((message) =>
    message.type === type && (!action || message.action === action)
  ).length;
}

function createTracker(socket, logicalId, phase) {
  const tracker = {
    logicalId,
    phase,
    socket,
    messages: [],
    invalidMessages: [],
    errors: [],
    waiters: new Set(),
    connectedMs: 0
  };
  socket.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString("utf8"));
    } catch {
      tracker.invalidMessages.push(raw.toString("utf8").slice(0, 160));
      return;
    }
    tracker.messages.push(message);
    for (const waiter of [...tracker.waiters]) {
      if (!waiter.predicate(message)) continue;
      clearTimeout(waiter.timer);
      tracker.waiters.delete(waiter);
      waiter.resolve(message);
    }
  });
  socket.on("error", (error) => tracker.errors.push(String(error?.message || error)));
  return tracker;
}

function waitForMessage(client, predicate, description) {
  const existing = client.messages.find(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolveMessage, rejectMessage) => {
    const waiter = {
      predicate,
      resolve: resolveMessage,
      timer: setTimeout(() => {
        client.waiters.delete(waiter);
        rejectMessage(new Error(
          `${client.phase} client ${client.logicalId} timed out waiting for ${description}`
        ));
      }, messageTimeoutMs)
    };
    client.waiters.add(waiter);
  });
}

async function connectClient(websocketUrl, origin, logicalId, phase) {
  const startedAt = performance.now();
  const socket = new WebSocket(websocketUrl, protocol, {
    origin,
    handshakeTimeout: messageTimeoutMs,
    perMessageDeflate: false
  });
  liveSockets.add(socket);
  const client = createTracker(socket, logicalId, phase);
  await new Promise((resolveOpen, rejectOpen) => {
    const timer = setTimeout(() => {
      cleanup();
      rejectOpen(new Error(`${phase} client ${logicalId} timed out opening`));
    }, messageTimeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("open", onOpen);
      socket.off("error", onError);
      socket.off("close", onClose);
      socket.off("unexpected-response", onUnexpectedResponse);
    };
    const onOpen = () => {
      cleanup();
      resolveOpen();
    };
    const onError = (error) => {
      cleanup();
      rejectOpen(error);
    };
    const onClose = (code, reason) => {
      cleanup();
      rejectOpen(new Error(
        `${phase} client ${logicalId} closed during handshake: ${code} ${reason}`
      ));
    };
    const onUnexpectedResponse = (_request, response) => {
      cleanup();
      rejectOpen(new Error(
        `${phase} client ${logicalId} received HTTP ${response.statusCode}`
      ));
    };
    socket.on("open", onOpen);
    socket.on("error", onError);
    socket.on("close", onClose);
    socket.on("unexpected-response", onUnexpectedResponse);
  });
  assert.equal(socket.protocol, protocol, `${phase} client ${logicalId} negotiated the wrong protocol`);
  await waitForMessage(client, (message) => message.type === "realtime.ready", "realtime.ready");
  socket.send(JSON.stringify({ type: "ping", client: logicalId, phase }));
  await waitForMessage(client, (message) => message.type === "pong", "pong");
  client.connectedMs = performance.now() - startedAt;
  return client;
}

async function connectBatch(websocketUrl, origin, phase, withJitter = false) {
  const attempts = Array.from({ length: clientCount }, async (_, index) => {
    if (withJitter) await wait((index * 47) % 501);
    return connectClient(websocketUrl, origin, index, phase);
  });
  const settled = await Promise.allSettled(attempts);
  const failures = settled.flatMap((result, index) =>
    result.status === "rejected"
      ? [{ index, error: String(result.reason?.message || result.reason) }]
      : []
  );
  assert.deepEqual(failures, [], `${phase} connection failures: ${JSON.stringify(failures)}`);
  return settled.map((result) => result.value);
}

async function broadcastAndVerify(realtimeStub, clients, action) {
  const deliveries = clients.map((client) => waitForMessage(
    client,
    (message) => message.type === "request.changed" && message.action === action,
    `request.changed/${action}`
  ));
  const response = await realtimeStub.fetch("https://realtime.internal/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "request.changed",
      action,
      targets: ["public"],
      at: new Date().toISOString()
    })
  });
  assert.equal(response.status, 200, `${action} broadcast failed`);
  const result = await response.json();
  assert.equal(result.delivered, clientCount,
    `${action} must reach exactly one socket per logical client`);
  await Promise.all(deliveries);
  await wait(quietWindowMs);
  for (const client of clients) {
    assert.equal(messageCount(client, "realtime.ready"), 1,
      `${client.phase} client ${client.logicalId} received duplicate ready messages`);
    assert.equal(messageCount(client, "pong"), 1,
      `${client.phase} client ${client.logicalId} received duplicate pong messages`);
    assert.equal(messageCount(client, "request.changed", action), 1,
      `${client.phase} client ${client.logicalId} received duplicate invalidations`);
    assert.deepEqual(client.invalidMessages, [],
      `${client.phase} client ${client.logicalId} received invalid JSON`);
    assert.deepEqual(client.errors, [],
      `${client.phase} client ${client.logicalId} emitted socket errors`);
  }
}

async function closeForStorm(client, abrupt) {
  if (client.socket.readyState === WebSocket.CLOSED) return;
  const closed = new Promise((resolveClosed, rejectClosed) => {
    const timer = setTimeout(() => {
      rejectClosed(new Error(
        `${client.phase} client ${client.logicalId} did not close during the simulated outage`
      ));
    }, messageTimeoutMs);
    client.socket.once("close", () => {
      clearTimeout(timer);
      resolveClosed();
    });
  });
  if (abrupt) client.socket.terminate();
  else client.socket.close(1000, "reconnect load test");
  await closed;
}

function connectionSummary(clients) {
  const latencies = clients.map((client) => client.connectedMs);
  return {
    connected: clients.length,
    failures: 0,
    duplicateMessages: clients.reduce((total, client) =>
      total + Math.max(0, messageCount(client, "realtime.ready") - 1)
      + Math.max(0, messageCount(client, "pong") - 1)
      + Math.max(0, messageCount(client, "request.changed") - 1), 0),
    latencyMs: {
      p50: Number(percentile(latencies, 0.5).toFixed(2)),
      p95: Number(percentile(latencies, 0.95).toFixed(2)),
      max: Number(Math.max(...latencies).toFixed(2))
    }
  };
}

try {
  await execute(wrangler, ["deploy", "--dry-run", "--outdir", bundleRoot], {
    cwd: packageRoot,
    env: { ...process.env, NO_COLOR: "1" },
    maxBuffer: 20 * 1024 * 1024
  });
  const bundlePath = join(bundleRoot, "worker.js");
  const bundleSource = await readFile(bundlePath, "utf8");
  const { Miniflare } = await import("miniflare");
  miniflare = new Miniflare({
    rootPath: bundleRoot,
    modulesRoot: bundleRoot,
    modules: [
      {
        type: "ESModule",
        path: join(bundleRoot, "harness-entry.mjs"),
        contents: harnessWrapperSource
      },
      { type: "ESModule", path: bundlePath, contents: bundleSource }
    ],
    compatibilityDate: "2026-07-28",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: {
      GUEST_STAR_REALTIME: { className: "GuestStarRealtime", useSQLite: true }
    },
    host: "127.0.0.1",
    port: 0,
    inspectorPort: 0,
    logRequests: false,
    unsafeDevRegistryPath: "",
    telemetry: { enabled: false }
  });

  const readyUrl = await miniflare.ready;
  const websocketUrl = new URL("/api/realtime", readyUrl);
  websocketUrl.protocol = readyUrl.protocol === "https:" ? "wss:" : "ws:";
  websocketUrl.searchParams.set("channel", hotelId);
  websocketUrl.searchParams.set("role", "public");

  const namespace = await miniflare.getDurableObjectNamespace("GUEST_STAR_REALTIME");
  const realtimeStub = namespace.get(namespace.idFromName(hotelId));

  const initialClients = await connectBatch(websocketUrl, readyUrl.origin, "initial");
  await broadcastAndVerify(realtimeStub, initialClients, "reconnect.initial");

  await Promise.all(initialClients.map((client, index) => closeForStorm(client, index % 2 === 0)));

  const reconnectedClients = await connectBatch(websocketUrl, readyUrl.origin, "reconnect", true);
  await broadcastAndVerify(realtimeStub, reconnectedClients, "reconnect.after-outage");

  const workerTouches = Number(await fetch(
    new URL("/__harness/d1-touch-count", readyUrl)
  ).then((response) => response.text()));
  const durableObjectTouches = Number(await realtimeStub.fetch(
    "https://realtime.internal/__harness/d1-touch-count"
  ).then((response) => response.text()));
  assert.equal(workerTouches, 0, "connect/reconnect touched D1 in the Worker");
  assert.equal(durableObjectTouches, 0, "connect/reconnect touched D1 in the Durable Object");

  console.log(JSON.stringify({
    ok: true,
    clients: clientCount,
    connections: clientCount * 2,
    simulatedOutage: { abrupt: clientCount / 2, graceful: clientCount / 2 },
    reconnectJitterMs: { minimum: 0, maximum: 500 },
    initial: connectionSummary(initialClients),
    reconnect: connectionSummary(reconnectedClients),
    d1: {
      workerTouches,
      durableObjectTouches,
      guard: "Any GUEST_STAR_DB property access throws inside the harness."
    }
  }, null, 2));
} finally {
  for (const socket of liveSockets) {
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.terminate();
    }
  }
  if (miniflare) await miniflare.dispose();
  await rm(bundleRoot, { recursive: true, force: true });
}
