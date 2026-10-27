import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os, { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as wait } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import WebSocket from "ws";

// Some managed runners block libuv's interface enumeration. Miniflare only
// needs loopback networking for this local harness.
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
const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const wrangler = resolve(packageRoot, "node_modules/.bin/wrangler");
const durationMs = Math.max(
  600_000,
  Number(process.env.GUEST_STAR_IDLE_DURATION_MS) || 600_000
);
const actionOnly = process.env.GUEST_STAR_CONNECTED_ACTION_ONLY === "1";
const publicClientCount = 30;
const protocol = "guest-star-v1";
const messageTimeoutMs = 15_000;
const settleMs = 2_000;
const hotelId = "hotel-connected-idle-0001";
const venueId = "venue-connected-idle-0001";
const activityId = "activity-connected-idle-0001";
const cycleId = "cycle-connected-idle-0001";
const publicToken = "4b9a99b9f7a140d4bb86cafe";
const publicCode = `connected-idle-${publicToken}`;
const hostPassword = "Host-Connected-Idle-2026";
const bridgePassword = "Superhost-Connected-Idle-2026";
const hostSalt = "0123456789abcdef0123456789abcdef";
const bridgeSalt = "fedcba9876543210fedcba9876543210";
const bundleRoot = await mkdtemp(join(tmpdir(), "guest-star-connected-idle-bundle-"));
const liveSockets = new Set();
let miniflare;

const harnessWrapperSource = String.raw`
import workerUnderTest, { GuestStarRealtime as RealtimeUnderTest } from "./worker.js";

const rawStatement = Symbol("rawD1Statement");
const statementSql = Symbol("d1StatementSql");
const databaseWrappers = new WeakMap();

function emptyMetrics() {
  return {
    d1: { reads: 0, writes: 0, operations: 0 },
    http: { requests: 0, apiRequests: 0, pollingRequests: 0, websocketUpgrades: 0 },
    realtime: { connections: 0, broadcasts: 0, deliveries: 0 }
  };
}

const workerMetrics = emptyMetrics();
const durableMetrics = emptyMetrics();

function isWriteSql(sql) {
  return /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER|VACUUM|REINDEX)\b/i.test(
    String(sql || "").replace(/--[^\n]*/g, " ")
  );
}

function countOperation(metrics, sql, forcedKind = "") {
  const kind = forcedKind || (isWriteSql(sql) ? "writes" : "reads");
  metrics.d1[kind] += 1;
  metrics.d1.operations += 1;
}

function wrapStatement(statement, sql, metrics) {
  return {
    [rawStatement]: statement,
    [statementSql]: sql,
    bind(...values) {
      return wrapStatement(statement.bind(...values), sql, metrics);
    },
    async all() {
      countOperation(metrics, sql, "reads");
      return statement.all();
    },
    async first(column) {
      countOperation(metrics, sql, "reads");
      return column === undefined ? statement.first() : statement.first(column);
    },
    async raw(options) {
      countOperation(metrics, sql, "reads");
      return options === undefined ? statement.raw() : statement.raw(options);
    },
    async run() {
      countOperation(metrics, sql);
      return statement.run();
    }
  };
}

function instrumentDatabase(database, metrics) {
  if (!database || (typeof database !== "object" && typeof database !== "function")) {
    return database;
  }
  let wrappers = databaseWrappers.get(database);
  if (!wrappers) {
    wrappers = new Map();
    databaseWrappers.set(database, wrappers);
  }
  if (wrappers.has(metrics)) return wrappers.get(metrics);

  const wrapper = new Proxy(database, {
    get(target, property) {
      if (property === "prepare") {
        return (sql) => wrapStatement(target.prepare(sql), String(sql || ""), metrics);
      }
      if (property === "batch") {
        return async (statements) => {
          const raw = statements.map((statement) => {
            const sql = statement?.[statementSql] || "";
            countOperation(metrics, sql);
            return statement?.[rawStatement] || statement;
          });
          return target.batch(raw);
        };
      }
      if (property === "exec") {
        return async (sql) => {
          const statements = String(sql || "").split(";").map((value) => value.trim()).filter(Boolean);
          for (const statement of statements.length ? statements : [String(sql || "")]) {
            countOperation(metrics, statement);
          }
          return target.exec(sql);
        };
      }
      if (property === "dump") {
        return async (...args) => {
          countOperation(metrics, "DUMP", "reads");
          return target.dump(...args);
        };
      }
      if (property === "withSession") {
        return (...args) => instrumentDatabase(target.withSession(...args), metrics);
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  wrappers.set(metrics, wrapper);
  return wrapper;
}

function instrumentEnvironment(environment, metrics) {
  const measuredD1 = instrumentDatabase(environment.GUEST_STAR_DB, metrics);
  return new Proxy(environment, {
    get(target, property, receiver) {
      if (property === "GUEST_STAR_DB") return measuredD1;
      return Reflect.get(target, property, receiver);
    }
  });
}

function metricsResponse(metrics) {
  return new Response(JSON.stringify(metrics), {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

export class GuestStarRealtime extends RealtimeUnderTest {
  constructor(state, environment) {
    super(state, instrumentEnvironment(environment, durableMetrics));
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/__harness/metrics") return metricsResponse(durableMetrics);
    if (url.pathname === "/connect") durableMetrics.realtime.connections += 1;
    if (url.pathname === "/broadcast" && request.method === "POST") {
      durableMetrics.realtime.broadcasts += 1;
      const response = await super.fetch(request);
      const result = await response.clone().json().catch(() => null);
      durableMetrics.realtime.deliveries += Number(result?.delivered || 0);
      return response;
    }
    return super.fetch(request);
  }
}

export default {
  async fetch(request, environment, context) {
    const url = new URL(request.url);
    if (url.pathname === "/__harness/metrics") return metricsResponse(workerMetrics);

    const websocketUpgrade = String(request.headers.get("Upgrade") || "").toLowerCase() === "websocket";
    if (websocketUpgrade) {
      workerMetrics.http.websocketUpgrades += 1;
      if (url.pathname === "/api/realtime") workerMetrics.realtime.connections += 1;
    } else {
      workerMetrics.http.requests += 1;
      if (url.pathname.startsWith("/api/")) {
        workerMetrics.http.apiRequests += 1;
        workerMetrics.http.pollingRequests += 1;
      }
    }
    return workerUnderTest.fetch(
      request,
      instrumentEnvironment(environment, workerMetrics),
      context
    );
  }
};
`;

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function record(table, id, data, scope = "master") {
  return `INSERT INTO guest_star_records
    (scope, table_name, record_id, data_json, created_at, updated_at)
    VALUES (${sqlText(scope)}, ${sqlText(table)}, ${sqlText(id)}, ${sqlText(JSON.stringify(data))},
      ${sqlText(data.createdAt || new Date().toISOString())},
      ${sqlText(data.updatedAt || data.createdAt || new Date().toISOString())})`;
}

async function executeStatements(db, source) {
  for (const statement of String(source).split(";").map((value) => value.trim()).filter(Boolean)) {
    await db.prepare(statement).run();
  }
}

function passwordHash(password, salt) {
  return createHmac("sha256", salt).update(password).digest("hex");
}

async function jsonRequest(baseUrl, path, init = {}) {
  const response = await fetch(new URL(path, baseUrl), init);
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { ok: false, invalidJson: true, text: text.slice(0, 240) };
  }
  return { response, body };
}

function websocketUrl(baseUrl, parameters) {
  const url = new URL("/api/realtime", baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value);
  }
  return url;
}

function waitForMessage(client, predicate, description) {
  const existing = client.messages.find(({ value }) => predicate(value));
  if (existing) return Promise.resolve(existing.value);
  return new Promise((resolveMessage, rejectMessage) => {
    const waiter = {
      predicate,
      resolve: resolveMessage,
      reject: rejectMessage,
      timer: null
    };
    waiter.timer = setTimeout(() => {
      client.waiters.delete(waiter);
      rejectMessage(new Error(`${client.name} timed out waiting for ${description}`));
    }, messageTimeoutMs);
    client.waiters.add(waiter);
  });
}

async function connectClient(baseUrl, options) {
  const url = websocketUrl(baseUrl, {
    channel: hotelId,
    role: options.role,
    ...(options.role === "bridge" ? {
      activityId,
      deviceId: options.deviceId,
      mode: "bridge"
    } : {})
  });
  const socket = new WebSocket(url, protocol, {
    origin: baseUrl.origin,
    handshakeTimeout: messageTimeoutMs,
    perMessageDeflate: false,
    ...(options.cookie ? { headers: { Cookie: options.cookie } } : {})
  });
  liveSockets.add(socket);
  const client = {
    name: options.name,
    role: options.role,
    socket,
    attempts: 1,
    messages: [],
    errors: [],
    closes: [],
    waiters: new Set()
  };
  socket.on("message", (raw) => {
    let value;
    try {
      value = JSON.parse(raw.toString("utf8"));
    } catch {
      value = { type: "invalid-json", raw: raw.toString("utf8").slice(0, 160) };
    }
    const message = { receivedAt: performance.now(), value };
    client.messages.push(message);
    for (const waiter of [...client.waiters]) {
      if (!waiter.predicate(value)) continue;
      clearTimeout(waiter.timer);
      client.waiters.delete(waiter);
      waiter.resolve(value);
    }
  });
  socket.on("error", (error) => client.errors.push(String(error?.message || error)));
  socket.on("close", (code, reason) => {
    const close = { code, reason: reason.toString("utf8"), at: performance.now() };
    client.closes.push(close);
    for (const waiter of [...client.waiters]) {
      clearTimeout(waiter.timer);
      client.waiters.delete(waiter);
      waiter.reject(new Error(`${client.name} closed before authentication: ${code} ${close.reason}`));
    }
  });

  await new Promise((resolveOpen, rejectOpen) => {
    const timer = setTimeout(() => {
      cleanup();
      rejectOpen(new Error(`${client.name} connection timed out`));
    }, messageTimeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("open", onOpen);
      socket.off("error", onError);
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
    const onUnexpectedResponse = (_request, response) => {
      cleanup();
      rejectOpen(new Error(`${client.name} received HTTP ${response.statusCode}`));
    };
    socket.once("open", onOpen);
    socket.once("error", onError);
    socket.once("unexpected-response", onUnexpectedResponse);
  });
  assert.equal(socket.protocol, protocol, `${client.name} negotiated the wrong protocol`);

  if (options.role === "bridge") {
    await waitForMessage(
      client,
      (message) => message.type === "realtime.auth-required",
      "realtime.auth-required"
    );
    socket.send(JSON.stringify({
      type: "auth",
      authToken: options.authToken,
      deviceToken: options.deviceToken
    }));
  }
  await waitForMessage(client, (message) => message.type === "realtime.ready", "realtime.ready");
  return client;
}

function subtractMetrics(after, before) {
  return {
    worker: {
      d1: {
        reads: after.worker.d1.reads - before.worker.d1.reads,
        writes: after.worker.d1.writes - before.worker.d1.writes,
        operations: after.worker.d1.operations - before.worker.d1.operations
      },
      http: {
        requests: after.worker.http.requests - before.worker.http.requests,
        apiRequests: after.worker.http.apiRequests - before.worker.http.apiRequests,
        pollingRequests: after.worker.http.pollingRequests - before.worker.http.pollingRequests,
        websocketUpgrades: after.worker.http.websocketUpgrades - before.worker.http.websocketUpgrades
      },
      realtime: {
        connections: after.worker.realtime.connections - before.worker.realtime.connections,
        broadcasts: after.worker.realtime.broadcasts - before.worker.realtime.broadcasts,
        deliveries: after.worker.realtime.deliveries - before.worker.realtime.deliveries
      }
    },
    durableObject: {
      d1: {
        reads: after.durableObject.d1.reads - before.durableObject.d1.reads,
        writes: after.durableObject.d1.writes - before.durableObject.d1.writes,
        operations: after.durableObject.d1.operations - before.durableObject.d1.operations
      },
      realtime: {
        connections: after.durableObject.realtime.connections - before.durableObject.realtime.connections,
        broadcasts: after.durableObject.realtime.broadcasts - before.durableObject.realtime.broadcasts,
        deliveries: after.durableObject.realtime.deliveries - before.durableObject.realtime.deliveries
      }
    }
  };
}

async function closeAll() {
  await Promise.all([...liveSockets].map((socket) => new Promise((resolveClose) => {
    if (socket.readyState === WebSocket.CLOSED) return resolveClose();
    const timer = setTimeout(() => {
      socket.terminate();
      resolveClose();
    }, 2_000);
    socket.once("close", () => {
      clearTimeout(timer);
      resolveClose();
    });
    socket.close(1000, "local connected idle complete");
  })));
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
    d1Databases: { GUEST_STAR_DB: "guest-star-connected-idle-test" },
    durableObjects: {
      GUEST_STAR_REALTIME: { className: "GuestStarRealtime", useSQLite: true }
    },
    bindings: {
      GOOGLE_OAUTH_CLIENT_ID: "local-connected-idle.apps.googleusercontent.com"
    },
    host: "127.0.0.1",
    port: 0,
    inspectorPort: 0,
    logRequests: false,
    unsafeDevRegistryPath: "",
    telemetry: { enabled: false }
  });

  const db = await miniflare.getD1Database("GUEST_STAR_DB");
  for (const migration of [
    "migrations/0001_guest_star_core.sql",
    "migrations/0002_atomic_request_queue.sql",
    "migrations/0003_d1_hot_path_indexes.sql"
  ]) {
    await executeStatements(db, await readFile(resolve(packageRoot, migration), "utf8"));
  }

  const stamp = new Date().toISOString();
  const userBase = {
    status: "active",
    mustChangePassword: false,
    createdAt: stamp,
    updatedAt: stamp,
    lastLoginAt: "",
    passwordUpdatedAt: stamp
  };
  const seed = [
    `INSERT OR REPLACE INTO guest_star_meta (key, value, updated_at) VALUES ('backend_mode', 'd1_primary', ${sqlText(stamp)})`,
    `INSERT OR REPLACE INTO guest_star_meta (key, value, updated_at) VALUES ('migration_status', 'active', ${sqlText(stamp)})`,
    `INSERT OR REPLACE INTO guest_star_meta (key, value, updated_at) VALUES ('session_hash_secret', 'local-connected-idle-session-secret', ${sqlText(stamp)})`,
    record("Users", "host-connected-idle", {
      ...userBase,
      userId: "host-connected-idle",
      username: "host.connected.idle",
      displayName: "Connected Idle Host",
      email: "host.connected.idle@example.invalid",
      passwordHash: passwordHash(hostPassword, hostSalt),
      passwordSalt: hostSalt,
      role: "host",
      staticHostSlug: "connected-idle-host"
    }),
    record("Users", "superhost-connected-idle", {
      ...userBase,
      userId: "superhost-connected-idle",
      username: "superhost.connected.idle",
      displayName: "Connected Idle Superhost",
      email: "superhost.connected.idle@example.invalid",
      passwordHash: passwordHash(bridgePassword, bridgeSalt),
      passwordSalt: bridgeSalt,
      role: "superhost",
      staticHostSlug: "connected-idle-superhost"
    }),
    record("Hotels", hotelId, {
      hotelId,
      name: "Connected Idle Hotel",
      slug: "connected-idle",
      publicCode: publicToken,
      publicUrl: `https://request.gstarxp.com/h/${publicCode}`,
      qrFileId: "",
      qrVersion: 1,
      activePublicActivityId: activityId,
      timezone: "America/Santo_Domingo",
      status: "active",
      createdAt: stamp,
      updatedAt: stamp
    }),
    record("Venues", venueId, {
      venueId,
      hotelId,
      name: "Connected Idle Lobby",
      slug: "connected-idle-lobby",
      status: "active",
      createdAt: stamp,
      updatedAt: stamp
    }),
    record("Activities", activityId, {
      activityId,
      hotelId,
      venueId,
      name: "Connected Idle Karaoke",
      internalCode: "connected-idle-karaoke",
      status: "in_progress",
      defaultDurationSeconds: 7200,
      defaultTransitionSeconds: 30,
      showPublicStatus: true,
      showCountdown: true,
      scheduledStartAt: "",
      autoStartEnabled: false,
      acceptEarlyRequests: false,
      currentCycleId: cycleId,
      allowedLanguagesJson: JSON.stringify(["es", "en"]),
      createdAt: stamp,
      updatedAt: stamp
    }),
    record("ActivityCycles", cycleId, {
      cycleId,
      activityId,
      hotelId,
      venueId,
      status: "in_progress",
      startedAt: stamp,
      finishedAt: "",
      archivedAt: "",
      createdAt: stamp,
      updatedAt: stamp
    }, hotelId),
    record("UserAssignments", "assignment-host-connected-idle", {
      assignmentId: "assignment-host-connected-idle",
      userId: "host-connected-idle",
      hotelId,
      venueId: "",
      activityId: "",
      permissionsJson: JSON.stringify({ all: true }),
      status: "active",
      createdAt: stamp,
      updatedAt: stamp
    }),
    record("HotelBranding", "branding-connected-idle", {
      hotelBrandingId: "branding-connected-idle",
      hotelId,
      primaryColor: "#ff2d95",
      secondaryColor: "#8b3dff",
      accentColor: "#00c8ff",
      showHotelName: true,
      updatedAt: stamp
    }),
    `INSERT INTO guest_star_activity_runtime
      (activity_id, hotel_id, venue_id, cycle_id, accepting, running, started_at, finished_at,
       state_revision, last_action, last_source, updated_at)
      VALUES (${sqlText(activityId)}, ${sqlText(hotelId)}, ${sqlText(venueId)}, ${sqlText(cycleId)},
       1, 1, ${sqlText(stamp)}, '', 1, 'activity.start', 'bridge', ${sqlText(stamp)})`
  ].join(";\n");
  await executeStatements(db, seed);

  const readyUrl = await miniflare.ready;
  const publicBootstraps = await Promise.all(Array.from(
    { length: publicClientCount },
    () => jsonRequest(
      readyUrl,
      `/api/karaoke?action=publicBootstrap&hotel=${encodeURIComponent(publicCode)}`
    )
  ));
  for (const { response, body } of publicBootstraps) {
    assert.equal(response.status, 200, "public bootstrap must use the real route");
    assert.equal(body.ok, true, JSON.stringify(body));
    assert.equal(body.realtimeChannel, hotelId);
    assert.equal(body.activityRunning, true);
  }

  const hostLogin = await jsonRequest(readyUrl, "/api/host", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "login",
      username: "host.connected.idle",
      password: hostPassword,
      rememberLogin: true
    })
  });
  assert.equal(hostLogin.response.status, 200, JSON.stringify(hostLogin.body));
  assert.equal(hostLogin.body.ok, true, JSON.stringify(hostLogin.body));
  assert.equal(hostLogin.body.user?.role, "host");
  const hostCookie = String(hostLogin.response.headers.get("set-cookie") || "").split(";", 1)[0];
  assert.match(hostCookie, /^guest_star_host_session=.+/, "Host login must issue its real session cookie");

  const bridgeLogin = await jsonRequest(readyUrl, "/api/bridge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "login",
      username: "superhost.connected.idle",
      password: bridgePassword,
      clientType: "bridge",
      deviceId: "bridge-connected-idle-0001",
      deviceName: "Connected Idle Bridge",
      bridgeVersion: "4.4.0",
      rememberLogin: true
    })
  });
  assert.equal(bridgeLogin.response.status, 200, JSON.stringify(bridgeLogin.body));
  assert.equal(bridgeLogin.body.ok, true, JSON.stringify(bridgeLogin.body));
  assert.equal(bridgeLogin.body.user?.role, "superhost");
  assert.ok(bridgeLogin.body.authToken && bridgeLogin.body.deviceToken && bridgeLogin.body.deviceId);
  const bridgeCredentials = {
    authToken: bridgeLogin.body.authToken,
    deviceToken: bridgeLogin.body.deviceToken,
    deviceId: bridgeLogin.body.deviceId
  };

  const selectedActivity = await jsonRequest(readyUrl, "/api/bridge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "selectActivity",
      ...bridgeCredentials,
      hotelId,
      venueId,
      activityId,
      source: "bridge"
    })
  });
  assert.equal(selectedActivity.response.status, 200, JSON.stringify(selectedActivity.body));
  assert.equal(selectedActivity.body.ok, true, JSON.stringify(selectedActivity.body));
  assert.equal(selectedActivity.body.hotel?.hotelId, hotelId);
  assert.equal(selectedActivity.body.activity?.activityId, activityId);

  const bridgeBootstrap = await jsonRequest(readyUrl, "/api/bridge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "activityState",
      ...bridgeCredentials,
      hotelId,
      venueId,
      activityId
    })
  });
  assert.equal(bridgeBootstrap.response.status, 200, JSON.stringify(bridgeBootstrap.body));
  assert.equal(bridgeBootstrap.body.ok, true, JSON.stringify(bridgeBootstrap.body));

  const connectionCases = [
    ...Array.from({ length: publicClientCount }, (_, index) => ({
      name: `public-${String(index + 1).padStart(2, "0")}`,
      role: "public"
    })),
    { name: "authenticated-host", role: "host", cookie: hostCookie },
    {
      name: "authenticated-bridge-superhost",
      role: "bridge",
      ...bridgeCredentials
    }
  ];
  const clients = await Promise.all(
    connectionCases.map((connection) => connectClient(readyUrl, connection))
  );
  assert.equal(clients.length, publicClientCount + 2);
  assert.equal(clients.filter((client) => client.role === "public").length, publicClientCount);
  assert.equal(clients.filter((client) => client.role === "host").length, 1);
  assert.equal(clients.filter((client) => client.role === "bridge").length, 1);
  assert.equal(clients.every((client) => client.attempts === 1), true);

  const namespace = await miniflare.getDurableObjectNamespace("GUEST_STAR_REALTIME");
  const realtimeStub = namespace.get(namespace.idFromName(hotelId));
  const readMetrics = async () => {
    const [worker, durableObject] = await Promise.all([
      jsonRequest(readyUrl, "/__harness/metrics").then(({ response, body }) => {
        assert.equal(response.status, 200);
        return body;
      }),
      realtimeStub.fetch("https://realtime.internal/__harness/metrics")
        .then(async (response) => {
          assert.equal(response.status, 200);
          return response.json();
        })
    ]);
    return { worker, durableObject };
  };

  await wait(settleMs);
  const before = await readMetrics();
  if (actionOnly) {
    const hostClient = clients.find((client) => client.role === "host");
    const bridgeClient = clients.find((client) => client.role === "bridge");
    assert.ok(hostClient && bridgeClient);
    let hostReceivedAt = 0;
    let bridgeReceivedAt = 0;
    const hostEvent = waitForMessage(hostClient, (message) => {
      if (message.type !== "public.request.created") return false;
      hostReceivedAt = performance.now();
      return true;
    }, "public.request.created on Host");
    const bridgeEvent = waitForMessage(bridgeClient, (message) => {
      if (message.type !== "public.request.created") return false;
      bridgeReceivedAt = performance.now();
      return true;
    }, "public.request.created on Bridge");
    const actionStartedAt = performance.now();
    const requestPayload = {
      publicCode,
      guestDeviceId: "connected-action-device-0001",
      name: "Latency Guest",
      song: "Realtime Delivery Test",
      artist: "Guest Star",
      language: "Español",
      languageCode: "es",
      durationSeconds: 180
    };
    const created = await jsonRequest(readyUrl, "/api/karaoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload)
    });
    const acceptedAt = performance.now();
    assert.equal(created.response.status, 200, JSON.stringify(created.body));
    assert.equal(created.body.ok, true, JSON.stringify(created.body));
    assert.equal(created.body.deduplicated, undefined);
    assert.equal(created.response.headers.get("x-guest-star-realtime-event"), "public.request.created");
    await Promise.all([hostEvent, bridgeEvent]);
    await wait(250);
    const firstActionFinishedAt = performance.now();
    const firstEventCounts = {
      host: hostClient.messages.filter(({ value }) => value.type === "public.request.created").length,
      bridge: bridgeClient.messages.filter(({ value }) => value.type === "public.request.created").length
    };
    assert.deepEqual(firstEventCounts, { host: 1, bridge: 1 });

    const retryStartedAt = performance.now();
    const retried = await jsonRequest(readyUrl, "/api/karaoke", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestPayload)
    });
    const retryAcceptedAt = performance.now();
    assert.equal(retried.response.status, 200, JSON.stringify(retried.body));
    assert.equal(retried.body.ok, true, JSON.stringify(retried.body));
    assert.equal(retried.body.deduplicated, true);
    assert.equal(retried.body.id, created.body.id);
    assert.equal(retried.response.headers.get("x-guest-star-realtime-event"), null);
    await wait(500);
    const finalEventCounts = {
      host: hostClient.messages.filter(({ value }) => value.type === "public.request.created").length,
      bridge: bridgeClient.messages.filter(({ value }) => value.type === "public.request.created").length
    };
    assert.deepEqual(finalEventCounts, firstEventCounts, "idempotent retry must not broadcast again");
    const after = await readMetrics();
    const delta = subtractMetrics(after, before);
    assert.equal(delta.durableObject.realtime.broadcasts, 1);
    assert.equal(delta.durableObject.realtime.deliveries, clients.length);
    assert.deepEqual(delta.durableObject.d1, { reads: 0, writes: 0, operations: 0 });

    console.log(JSON.stringify({
      ok: true,
      event: "local-connected-action-completed",
      clients: {
        public: publicClientCount,
        host: 1,
        bridgeSuperhost: 1,
        total: clients.length,
        socketsPerClient: 1
      },
      action: {
        httpAcceptedMs: Number((acceptedAt - actionStartedAt).toFixed(3)),
        hostDeliveredMs: Number((hostReceivedAt - actionStartedAt).toFixed(3)),
        bridgeDeliveredMs: Number((bridgeReceivedAt - actionStartedAt).toFixed(3)),
        firstActionObservedMs: Number((firstActionFinishedAt - actionStartedAt).toFixed(3)),
        hostEvents: firstEventCounts.host,
        bridgeEvents: firstEventCounts.bridge,
        broadcastDeliveries: delta.durableObject.realtime.deliveries
      },
      idempotentRetry: {
        acceptedMs: Number((retryAcceptedAt - retryStartedAt).toFixed(3)),
        deduplicated: retried.body.deduplicated,
        sameRequestId: retried.body.id === created.body.id,
        additionalHostEvents: finalEventCounts.host - firstEventCounts.host,
        additionalBridgeEvents: finalEventCounts.bridge - firstEventCounts.bridge
      },
      counters: { before, after, delta }
    }, null, 2));
  } else {
    const windowStartedAt = new Date();
    const windowStartedMonotonic = performance.now();
    console.log(JSON.stringify({
      event: "local-connected-idle-started",
      startedAt: windowStartedAt.toISOString(),
      minimumDurationMs: durationMs,
      clients: {
        public: publicClientCount,
        host: 1,
        bridgeSuperhost: 1,
        total: clients.length,
        socketsPerClient: 1
      },
      countersBefore: before
    }, null, 2));

    let remainingMs = durationMs;
    while (remainingMs > 0) {
      await wait(Math.min(60_000, remainingMs));
      remainingMs = durationMs - (performance.now() - windowStartedMonotonic);
    }
    const windowFinishedMonotonic = performance.now();
    const windowFinishedAt = new Date();
    const elapsedMs = windowFinishedMonotonic - windowStartedMonotonic;
    const after = await readMetrics();
    const delta = subtractMetrics(after, before);
    const windowMessages = clients.flatMap((client) => client.messages
      .filter(({ receivedAt }) => (
        receivedAt >= windowStartedMonotonic && receivedAt <= windowFinishedMonotonic
      ))
      .map(({ value }) => ({ client: client.name, type: value.type || "unknown" }))
    );
    const errors = clients.flatMap((client) =>
      client.errors.map((error) => ({ client: client.name, error }))
    );
    const prematureCloses = clients.flatMap((client) =>
      client.closes
        .filter((close) => close.at <= windowFinishedMonotonic)
        .map((close) => ({ client: client.name, code: close.code, reason: close.reason }))
    );

    assert.ok(elapsedMs >= 600_000, `idle window was too short: ${elapsedMs}ms`);
    assert.equal(clients.every((client) => client.socket.readyState === WebSocket.OPEN), true,
      "every client must retain exactly one open socket");
    assert.deepEqual(errors, [], "connected idle clients emitted socket errors");
    assert.deepEqual(prematureCloses, [], "connected idle clients closed or reconnected");
    assert.deepEqual(windowMessages, [], "connected idle clients received application broadcasts");
    assert.deepEqual(delta.worker.d1, { reads: 0, writes: 0, operations: 0 },
      "the Worker touched D1 during connected idle");
    assert.deepEqual(delta.durableObject.d1, { reads: 0, writes: 0, operations: 0 },
      "the realtime Durable Object touched D1 during connected idle");
    assert.deepEqual(delta.worker.http, {
      requests: 0,
      apiRequests: 0,
      pollingRequests: 0,
      websocketUpgrades: 0
    }, "connected idle generated HTTP polling or a reconnect upgrade");
    assert.deepEqual(delta.worker.realtime, { connections: 0, broadcasts: 0, deliveries: 0 },
      "the Worker routed realtime work during connected idle");
    assert.deepEqual(delta.durableObject.realtime, {
      connections: 0,
      broadcasts: 0,
      deliveries: 0
    }, "the Durable Object connected, broadcast, or delivered during idle");

    console.log(JSON.stringify({
      ok: true,
      event: "local-connected-idle-completed",
      startedAt: windowStartedAt.toISOString(),
      finishedAt: windowFinishedAt.toISOString(),
      elapsedMs: Number(elapsedMs.toFixed(3)),
      clients: {
        public: publicClientCount,
        host: 1,
        bridgeSuperhost: 1,
        total: clients.length,
        socketsPerClient: 1,
        connectionAttemptsPerClient: 1,
        openAtEnd: clients.filter((client) => client.socket.readyState === WebSocket.OPEN).length
      },
      counters: { before, after, delta },
      idleWindow: {
        d1Reads: delta.worker.d1.reads + delta.durableObject.d1.reads,
        d1Writes: delta.worker.d1.writes + delta.durableObject.d1.writes,
        d1Operations: delta.worker.d1.operations + delta.durableObject.d1.operations,
        httpPolling: delta.worker.http.pollingRequests,
        broadcasts: delta.durableObject.realtime.broadcasts,
        broadcastDeliveries: delta.durableObject.realtime.deliveries,
        reconnects: delta.worker.http.websocketUpgrades,
        clientMessages: windowMessages.length,
        socketErrors: errors.length,
        prematureCloses: prematureCloses.length
      }
    }, null, 2));
  }
} finally {
  await closeAll();
  if (miniflare) await miniflare.dispose();
  await rm(bundleRoot, { recursive: true, force: true });
}
