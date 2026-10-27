import assert from "node:assert/strict";
import WebSocket from "ws";

const endpoint = new URL(
  process.env.GUEST_STAR_REALTIME_URL ||
  "https://gueststarexperience.garyinirio421.workers.dev"
);
const protocol = "guest-star-v1";
const timeoutMs = 10_000;

function socketUrl(params) {
  const url = new URL("/api/realtime", endpoint);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url;
}

function expectedHttpStatus(params, status, options = {}) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(socketUrl(params), options.protocol || protocol, {
      origin: options.origin || endpoint.origin,
      handshakeTimeout: timeoutMs,
      perMessageDeflate: false
    });
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error(`Timed out waiting for HTTP ${status}`));
    }, timeoutMs);
    socket.once("open", () => {
      clearTimeout(timer);
      socket.terminate();
      reject(new Error(`WebSocket opened; expected HTTP ${status}`));
    });
    socket.once("unexpected-response", (_request, response) => {
      clearTimeout(timer);
      try {
        assert.equal(response.statusCode, status);
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        response.destroy();
        socket.terminate();
      }
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function waitForJson(socket, predicate, description) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${description}`));
    }, timeoutMs);
    const onMessage = (raw) => {
      let value;
      try { value = JSON.parse(raw.toString("utf8")); }
      catch { return; }
      if (!predicate(value)) return;
      cleanup();
      resolve(value);
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("message", onMessage);
      socket.off("error", onError);
    };
    socket.on("message", onMessage);
    socket.on("error", onError);
  });
}

async function openSocket(params) {
  const socket = new WebSocket(socketUrl(params), protocol, {
    origin: endpoint.origin,
    handshakeTimeout: timeoutMs,
    perMessageDeflate: false
  });
  await new Promise((resolve, reject) => {
    socket.once("open", resolve);
    socket.once("error", reject);
  });
  return socket;
}

function closeSocket(socket) {
  return new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) return resolve();
    const timer = setTimeout(() => {
      socket.terminate();
      resolve();
    }, 2_000);
    socket.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.close(1000, "production smoke complete");
  });
}

const channel = `hotel-production-smoke-${Date.now()}`;

await expectedHttpStatus({ channel: "bad", role: "public" }, 400);
await expectedHttpStatus(
  { channel, role: "public" },
  403,
  { origin: "https://invalid-origin.example" }
);
await expectedHttpStatus(
  { channel, role: "public" },
  400,
  { protocol: "invalid-protocol" }
);
await expectedHttpStatus({ channel, role: "host" }, 401);
await expectedHttpStatus({ channel, role: "bridge" }, 401);

const publicSocket = await openSocket({ channel, role: "public" });
assert.equal(publicSocket.protocol, protocol);
await waitForJson(publicSocket, (message) => message.type === "realtime.ready", "public ready");
const pong = waitForJson(publicSocket, (message) => message.type === "pong", "public pong");
publicSocket.send(JSON.stringify({ type: "ping" }));
await pong;
await closeSocket(publicSocket);

const bridgeSocket = await openSocket({
  channel,
  role: "bridge",
  activityId: "activity-production-smoke",
  deviceId: "device-production-smoke"
});
await waitForJson(
  bridgeSocket,
  (message) => message.type === "realtime.auth-required",
  "bridge auth challenge"
);
const policyClose = new Promise((resolve, reject) => {
  const timer = setTimeout(() => {
    bridgeSocket.terminate();
    reject(new Error("Bridge socket did not reject a non-auth first frame"));
  }, timeoutMs);
  bridgeSocket.once("close", (code) => {
    clearTimeout(timer);
    try {
      assert.equal(code, 1008);
      resolve();
    } catch (error) {
      reject(error);
    }
  });
});
bridgeSocket.send(JSON.stringify({ type: "ping" }));
await policyClose;

console.log(JSON.stringify({
  ok: true,
  endpoint: endpoint.origin,
  checks: {
    invalidChannel: 400,
    crossOrigin: 403,
    invalidProtocol: 400,
    hostWithoutSession: 401,
    bridgeWithoutIdentity: 401,
    publicReadyAndPong: true,
    bridgeFirstFramePolicyClose: 1008
  }
}, null, 2));
