import {createLyricsWorker} from './worker-lyrics-scope.mjs';
import { processHotelAutomation, nextHotelAutomationWake } from './lib/guest-star/run-automation.ts';
import openNextWorker from "./.open-next/worker.js";

const REALTIME_PATH = "/api/realtime";
const REALTIME_PROTOCOL = "guest-star-v1";
const PUBLIC_EXPERIENCE_HOSTNAMES = new Set(["request.gstarxp.com", "kiosko.gstarxp.com"]);
const CHANNEL_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const ID_PATTERN = /^[A-Za-z0-9._:-]{0,160}$/;
const ROLES = new Set(["public", "host", "bridge"]);

const BROADCAST_TARGETS = new Map([
  ["public.request.created", ["public", "host", "bridge"]],
  ["bridge.command.queued", ["bridge"]],
  ["bridge.command.completed", ["host"]],
  ["request.changed", ["public", "host", "bridge"]],
  ["activity.changed", ["public", "host", "bridge"]],
  ["experience.changed", ["public", "host", "bridge"]]
]);

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });
}

function publicExperienceDocumentResponse(request, url, response) {
  if (
    !PUBLIC_EXPERIENCE_HOSTNAMES.has(url.hostname.toLowerCase()) ||
    !["GET", "HEAD"].includes(request.method) ||
    !String(response.headers.get("Content-Type") || "").toLowerCase().includes("text/html")
  ) return response;
  const headers = new Headers(response.headers);
  headers.set("Cache-Control", "no-cache, no-store, must-revalidate");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function safeId(value) {
  const candidate = String(value || "").trim();
  return ID_PATTERN.test(candidate) ? candidate : "";
}

function socketRole(value) {
  const role = String(value || "public").toLowerCase();
  return ROLES.has(role) ? role : "public";
}

function websocketResponseHeaders() {
  return { "Sec-WebSocket-Protocol": REALTIME_PROTOCOL };
}

function realtimeStub(env, channel) {
  const id = env.GUEST_STAR_REALTIME.idFromName(channel);
  return env.GUEST_STAR_REALTIME.get(id);
}

function responseRealtimeChannels(response) {
  return [...new Set([
    response.headers.get("X-Guest-Star-Realtime-Channel"),
    ...String(response.headers.get("X-Guest-Star-Realtime-Channels") || "").split(",")
  ].map(safeId).filter((channel) => channel && CHANNEL_PATTERN.test(channel)))].slice(0, 4);
}

function durableExecutionContext(state) {
  return {
    waitUntil(promise) {
      if (typeof state.waitUntil === "function") state.waitUntil(promise);
    },
    passThroughOnException() {}
  };
}

function requestsRealtimeProtocol(request) {
  return String(request.headers.get("Sec-WebSocket-Protocol") || "")
    .split(",")
    .map((value) => value.trim())
    .includes(REALTIME_PROTOCOL);
}

async function verifyBridgeCredentials(env, executionContext, requested, credentials) {
  if (!credentials?.authToken || !credentials.deviceToken) return null;
  const url = new URL("https://realtime.internal/api/bridge");
  const verification = await openNextWorker.fetch(new Request(url, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      action: "realtimeConnect",
      authToken: credentials.authToken,
      deviceToken: credentials.deviceToken,
      hotelId: requested.hotelId,
      activityId: requested.activityId,
      deviceId: requested.deviceId
    })
  }), env, executionContext);
  if (!verification.ok) return null;
  const result = await verification.json().catch(() => null);
  if (!result?.ok) return null;
  const verified = {
    hotelId: safeId(result.hotelId),
    activityId: safeId(result.activityId),
    deviceId: safeId(result.deviceId)
  };
  if (
    verified.hotelId !== requested.hotelId ||
    verified.activityId !== requested.activityId ||
    verified.deviceId !== requested.deviceId
  ) return null;
  return verified;
}

function validSameOrigin(request) {
  const value = String(request.headers.get("Origin") || "");
  if (!value) return false;
  try {
    return new URL(value).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

async function verifyHostSocket(request, env, ctx, hotelId) {
  const cookie = request.headers.get("Cookie") || "";
  if (!cookie) return false;
  const url = new URL("/api/host", request.url);
  const verification = await openNextWorker.fetch(new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookie
    },
    body: JSON.stringify({ action: "me" })
  }), env, ctx);
  if (!verification.ok) return false;
  const result = await verification.json().catch(() => null);
  return result?.ok === true && Array.isArray(result?.selection?.hotels) &&
    result.selection.hotels.some((hotel) => safeId(hotel?.hotelId) === hotelId);
}

async function handleRealtime(request, env, ctx) {
  if (String(request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
    return jsonResponse({ ok: false, code: "WEBSOCKET_REQUIRED" }, 426, {
      Upgrade: "websocket"
    });
  }
  const url = new URL(request.url);
  if (!requestsRealtimeProtocol(request)) {
    return jsonResponse({ ok: false, code: "REALTIME_PROTOCOL_REQUIRED" }, 400);
  }
  const channel = safeId(url.searchParams.get("channel"));
  if (!channel || !CHANNEL_PATTERN.test(channel)) {
    return jsonResponse({ ok: false, code: "INVALID_REALTIME_CHANNEL" }, 400);
  }
  const role = socketRole(url.searchParams.get("role"));
  const requested = {
    hotelId: channel,
    activityId: safeId(url.searchParams.get("activityId")),
    deviceId: safeId(url.searchParams.get("deviceId")),
    mode: ["bridge", "player", "observer"].includes(url.searchParams.get("mode"))
      ? url.searchParams.get("mode")
      : "observer"
  };
  if (role !== "bridge" && !validSameOrigin(request)) {
    return jsonResponse({ ok: false, code: "REALTIME_ORIGIN_REJECTED" }, 403);
  }
  if (role === "host" && !await verifyHostSocket(request, env, ctx, channel)) {
    return jsonResponse({ ok: false, code: "REALTIME_UNAUTHORIZED" }, 401);
  }
  if (role === "bridge") {
    if (!requested.activityId || !requested.deviceId) {
      return jsonResponse({ ok: false, code: "REALTIME_IDENTITY_REQUIRED" }, 401);
    }
  }
  const headers = new Headers({
    Upgrade: "websocket",
    "X-Guest-Star-Realtime-Role": role,
    "X-Guest-Star-Realtime-Hotel": requested.hotelId,
    "X-Guest-Star-Realtime-Device": requested.deviceId,
    "X-Guest-Star-Realtime-Activity": requested.activityId,
    "X-Guest-Star-Realtime-Mode": requested.mode
  });
  const response = await realtimeStub(env, channel).fetch("https://realtime.internal/connect", {
    headers
  });
  const outputHeaders = new Headers(response.headers);
  outputHeaders.set("Sec-WebSocket-Protocol", REALTIME_PROTOCOL);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: outputHeaders,
    webSocket: response.webSocket
  });
}

async function presence(stub, body) {
  const url = new URL("https://realtime.internal/presence");
  url.searchParams.set("role", "bridge");
  url.searchParams.set("deviceId", safeId(body.deviceId));
  url.searchParams.set("activityId", safeId(body.activityId));
  url.searchParams.set("mode", "bridge");
  const response = await stub.fetch(url);
  if (!response.ok) return false;
  const result = await response.json().catch(() => null);
  return result?.online === true;
}

async function broadcast(env, channel, eventName, action, queuePeopleCount = null) {
  const targets = BROADCAST_TARGETS.get(eventName) || [];
  if (!targets.length) return;
  await realtimeStub(env, channel).fetch("https://realtime.internal/broadcast", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: eventName,
      action,
      targets,
      ...(Number.isInteger(queuePeopleCount) && queuePeopleCount >= 0
        ? { queuePeopleCount }
        : {}),
      at: new Date().toISOString()
    })
  });
}

async function parseJsonClone(value) {
  try {
    return await value.clone().json();
  } catch {
    return null;
  }
}

export class GuestStarRealtime {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async alarm() {
    const pending=await this.state.storage.get('activityRunWakeups')||{};
    for(const [id,item] of Object.entries(pending)){
      if(Date.parse(item.startsAt)>Date.now())continue;
      try {
        const result=await processHotelAutomation(this.env.GUEST_STAR_DB,item.hotelId);
        if(result.changes.length)await broadcast(this.env,item.hotelId,'activity.changed','session.automation');
        if(result.nextAt)item.startsAt=new Date(result.nextAt).toISOString();else delete pending[id];
      } catch { item.startsAt=new Date(Date.now()+5000).toISOString(); }
    }
    await this.state.storage.put('activityRunWakeups',pending);
    const times=Object.values(pending).map(item=>Date.parse(item.startsAt)).filter(Number.isFinite);
    if(times.length)await this.state.storage.setAlarm(Math.max(Date.now()+100,Math.min(...times)));
  }

  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/schedule-run" && request.method === "POST") {
      const item = await request.json();
      if (!CHANNEL_PATTERN.test(safeId(item.hotelId))) return jsonResponse({ok:false},400);
      const pending=await this.state.storage.get('activityRunWakeups')||{};
      const nextAt=await nextHotelAutomationWake(this.env.GUEST_STAR_DB,item.hotelId);
      if(nextAt)pending[item.hotelId]={hotelId:item.hotelId,startsAt:new Date(nextAt).toISOString()};else delete pending[item.hotelId];
      await this.state.storage.put('activityRunWakeups',pending);
      const times=Object.values(pending).map(value=>Date.parse(value.startsAt)).filter(Number.isFinite);
      if(times.length)await this.state.storage.setAlarm(Math.max(Date.now()+100,Math.min(...times)));
      return jsonResponse({ok:true});
    }
    if (url.pathname === "/connect") {
      if (String(request.headers.get("Upgrade") || "").toLowerCase() !== "websocket") {
        return jsonResponse({ ok: false, code: "WEBSOCKET_REQUIRED" }, 426);
      }
      const role = socketRole(request.headers.get("X-Guest-Star-Realtime-Role"));
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      this.state.acceptWebSocket(server, [`role:${role}`]);
      server.serializeAttachment({
        role,
        hotelId: safeId(request.headers.get("X-Guest-Star-Realtime-Hotel")),
        deviceId: safeId(request.headers.get("X-Guest-Star-Realtime-Device")),
        activityId: safeId(request.headers.get("X-Guest-Star-Realtime-Activity")),
        mode: ["bridge", "player", "observer"].includes(request.headers.get("X-Guest-Star-Realtime-Mode"))
          ? request.headers.get("X-Guest-Star-Realtime-Mode")
          : "observer",
        authenticated: role !== "bridge",
        authenticating: false
      });
      server.send(JSON.stringify({
        type: role === "bridge" ? "realtime.auth-required" : "realtime.ready"
      }));
      return new Response(null, {
        status: 101,
        headers: websocketResponseHeaders(),
        webSocket: client
      });
    }
    if (url.pathname === "/presence") {
      const role = socketRole(url.searchParams.get("role"));
      const deviceId = safeId(url.searchParams.get("deviceId"));
      const activityId = safeId(url.searchParams.get("activityId"));
      const mode = String(url.searchParams.get("mode") || "");
      const online = this.state.getWebSockets(`role:${role}`).some((socket) => {
        const attached = socket.deserializeAttachment() || {};
        return attached.authenticated === true &&
          (!deviceId || attached.deviceId === deviceId) &&
          (!activityId || attached.activityId === activityId) &&
          (!mode || attached.mode === mode);
      });
      return jsonResponse({ ok: true, online });
    }
    if (url.pathname === "/broadcast" && request.method === "POST") {
      const event = await request.json().catch(() => null);
      if (!event || typeof event.type !== "string") {
        return jsonResponse({ ok: false, code: "INVALID_REALTIME_EVENT" }, 400);
      }
      const sockets = new Set();
      for (const target of Array.isArray(event.targets) ? event.targets : []) {
        if (!ROLES.has(target)) continue;
        for (const socket of this.state.getWebSockets(`role:${target}`)) sockets.add(socket);
      }
      const payload = JSON.stringify({
        type: String(event.type).slice(0, 80),
        action: String(event.action || "").slice(0, 80),
        ...(Number.isInteger(event.queuePeopleCount) && event.queuePeopleCount >= 0
          ? { queuePeopleCount: event.queuePeopleCount }
          : {}),
        at: String(event.at || new Date().toISOString())
      });
      let delivered = 0;
      for (const socket of sockets) {
        try {
          const attached = socket.deserializeAttachment() || {};
          if (attached.authenticated !== true) continue;
          socket.send(payload);
          delivered += 1;
        } catch {
          try { socket.close(1011, "Delivery failed"); } catch { /* already closed */ }
        }
      }
      return jsonResponse({ ok: true, delivered });
    }
    return jsonResponse({ ok: false, code: "NOT_FOUND" }, 404);
  }

  async webSocketMessage(socket, message) {
    const initialAttachment = socket.deserializeAttachment() || {};
    if (typeof message !== "string" || message.length > 1024) {
      if (initialAttachment.role === "bridge" && initialAttachment.authenticated !== true) {
        socket.close(1008, "Realtime authentication frame required");
      }
      return;
    }
    try {
      const parsed = JSON.parse(message);
      const attached = initialAttachment;
      if (attached.role === "bridge" && attached.authenticated !== true) {
        if (attached.authenticating === true) return;
        if (parsed?.type !== "auth") {
          socket.close(1008, "Realtime authentication frame required");
          return;
        }
        socket.serializeAttachment({ ...attached, authenticating: true });
        let verified;
        try {
          verified = await verifyBridgeCredentials(
            this.env,
            durableExecutionContext(this.state),
            {
              hotelId: safeId(attached.hotelId),
              activityId: safeId(attached.activityId),
              deviceId: safeId(attached.deviceId)
            },
            {
              authToken: safeId(parsed.authToken),
              deviceToken: safeId(parsed.deviceToken)
            }
          );
        } catch {
          socket.close(1011, "Realtime authentication unavailable");
          return;
        }
        if (!verified || verified.hotelId !== safeId(attached.hotelId)) {
          socket.close(1008, "Realtime authentication failed");
          return;
        }
        socket.serializeAttachment({ ...attached, authenticated: true, authenticating: false });
        socket.send(JSON.stringify({ type: "realtime.ready" }));
        return;
      }
      if (parsed?.type === "ping") {
        socket.send(JSON.stringify({ type: "pong", at: new Date().toISOString() }));
      }
    } catch {
      if (initialAttachment.role === "bridge" && initialAttachment.authenticated !== true) {
        try { socket.close(1008, "Realtime authentication frame required"); } catch { /* already closed */ }
      }
      // Authenticated clients only receive server invalidations; malformed frames are ignored.
    }
  }

  async webSocketClose(socket, code, reason) {
    try { socket.close(code, reason); } catch { /* already closed */ }
  }

  async webSocketError(socket) {
    try { socket.close(1011, "Realtime socket error"); } catch { /* already closed */ }
  }
}

const workerWithExistingRoutes = {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === REALTIME_PATH) return handleRealtime(request, env, ctx);

    let body = null;
    let forwardedRequest = request;
    if (
      request.method === "POST" && url.pathname === "/api/host" &&
      request.headers.get("X-Guest-Star-Action") === "queueBridgeCommand"
    ) {
      body = await parseJsonClone(request);
      if (body?.action === "queueBridgeCommand") {
        const channel = safeId(body.hotelId);
        const checked = Boolean(channel && body.deviceId && body.activityId);
        const online = checked
          ? await presence(realtimeStub(env, channel), body)
          : false;
        body._realtimePresenceChecked = checked;
        body._realtimeBridgeOnline = online;
        const headers = new Headers(request.headers);
        headers.delete("Content-Length");
        forwardedRequest = new Request(request, {
          headers,
          body: JSON.stringify(body)
        });
      }
    }

    const response = await openNextWorker.fetch(forwardedRequest, env, ctx);
    if (!response.ok) return response;
    const wakeup = response.headers.get("X-Guest-Star-Run-Wakeup");
    if (wakeup) {
      const item = JSON.parse(wakeup);
      // Only backend-authorized response headers route timers to a hotel DO.
      if (CHANNEL_PATTERN.test(safeId(item.hotelId))) ctx.waitUntil(realtimeStub(env,item.hotelId).fetch("https://realtime.internal/schedule-run", {
        method:"POST",headers:{"Content-Type":"application/json"},body:wakeup
      }));
    }
    const eventName = String(response.headers.get("X-Guest-Star-Realtime-Event") || "");
    const channels = responseRealtimeChannels(response);
    const action = String(response.headers.get("X-Guest-Star-Realtime-Action") || "");
    const queueCountHeader = String(
      response.headers.get("X-Guest-Star-Realtime-Queue-Count") || ""
    );
    const queuePeopleCount = /^\d{1,9}$/.test(queueCountHeader)
      ? Number(queueCountHeader)
      : null;
    if (eventName && channels.length) {
      ctx.waitUntil(Promise.all(
        channels.map((channel) => broadcast(
          env,
          channel,
          eventName,
          action,
          queuePeopleCount
        ))
      ));
    }
    return publicExperienceDocumentResponse(request, url, response);
  }
};

export default createLyricsWorker(workerWithExistingRoutes);
