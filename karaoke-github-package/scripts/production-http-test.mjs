import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sessionToken = "production-test-session-token";
const deviceToken = "production-test-device-token";
const received = [];

function json(response, body, status = 200) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function close(server) {
  if (!server.listening) return;
  server.close();
  await once(server, "close");
}

const appsScript = createServer(async (request, response) => {
  const url = new URL(request.url || "/", "http://127.0.0.1");
  let payload = Object.fromEntries(url.searchParams);
  if (request.method === "POST") {
    let body = "";
    for await (const chunk of request) body += chunk;
    payload = JSON.parse(body || "{}");
  }
  received.push({ method: request.method, payload });

  if (payload.action === "login") {
    return json(response, {
      ok: true,
      authToken: sessionToken,
      deviceToken,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      user: { userId: "superhost-1", role: "superhost" },
      selection: { hotels: [], venues: [], activities: [] }
    });
  }
  if (payload.action === "consumeOneTimeLoginCode") {
    return json(response, {
      ok: true,
      authToken: sessionToken,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      user: { userId: "host-1", role: "host" }
    });
  }
  if (["me", "logout"].includes(String(payload.action || ""))) {
    if (payload.authToken !== sessionToken) {
      return json(response, { ok: false, code: "UNAUTHORIZED" });
    }
    return json(response, {
      ok: true,
      authToken: sessionToken,
      deviceToken,
      user: { userId: "superhost-1", role: "superhost" }
    });
  }
  return json(response, {
    ok: true,
    action: payload.action || "status",
    hotel: { name: "Production Test Hotel", slug: "production-test-hotel" },
    activity: { activityId: "activity-1", status: "open" },
    requests: []
  });
});

const appsScriptPort = await listen(appsScript);
const probe = createServer();
const webPort = await listen(probe);
await close(probe);

const output = [];
const nextServer = spawn(
  process.execPath,
  [resolve(packageRoot, "node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(webPort)],
  {
    cwd: packageRoot,
    env: {
      ...process.env,
      NODE_ENV: "production",
      KARAOKE_APPS_SCRIPT_URL: `http://127.0.0.1:${appsScriptPort}/exec`
    },
    stdio: ["ignore", "pipe", "pipe"]
  }
);
nextServer.stdout.on("data", (chunk) => output.push(String(chunk)));
nextServer.stderr.on("data", (chunk) => output.push(String(chunk)));

const origin = `http://127.0.0.1:${webPort}`;

async function request(path, init = {}) {
  return fetch(`${origin}${path}`, { redirect: "manual", ...init });
}

async function measureRoute(label, samples, operation) {
  const latencies = [];
  for (let index = 0; index < samples; index += 1) {
    const startedAt = performance.now();
    const response = await operation();
    assert.equal(response.status, 200, `${label} performance probe should succeed`);
    await response.arrayBuffer();
    latencies.push(performance.now() - startedAt);
  }
  latencies.sort((left, right) => left - right);
  const p95 = latencies[Math.floor(latencies.length * 0.95)];
  assert.ok(p95 < 250, `${label} local production p95 should stay under 250 ms; received ${p95.toFixed(2)} ms`);
  return Number(p95.toFixed(2));
}

async function waitUntilReady() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (nextServer.exitCode !== null) {
      throw new Error(`Next.js exited before becoming ready.\n${output.join("")}`);
    }
    try {
      const response = await request("/");
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error(`Next.js did not become ready.\n${output.join("")}`);
}

try {
  await waitUntilReady();

  for (const path of ["/", "/h/production-test-hotel", "/host", "/bridge-login?code=one-time", "/icon.svg"]) {
    const response = await request(path);
    assert.equal(response.status, 200, `${path} should render in production`);
  }

  const publicBootstrap = await request(
    "/api/karaoke?action=publicBootstrap&hotel=production-test-hotel"
  );
  assert.equal(publicBootstrap.status, 200);
  assert.equal((await publicBootstrap.json()).hotel.slug, "production-test-hotel");

  const blockedPublicGet = await request("/api/karaoke?action=login");
  assert.equal(blockedPublicGet.status, 403);
  const blockedPublicPost = await request("/api/karaoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login" })
  });
  assert.equal(blockedPublicPost.status, 403);

  const review = await request("/api/karaoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "submitReview", rating: 5 })
  });
  assert.equal(review.status, 200);

  const login = await request("/api/host", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "login",
      username: "superhost",
      password: "not-a-real-password",
      authToken: "attacker-token",
      deviceToken: "attacker-device"
    })
  });
  assert.equal(login.status, 200);
  const loginBody = await login.json();
  assert.equal(loginBody.ok, true);
  assert.equal("authToken" in loginBody, false);
  assert.equal("deviceToken" in loginBody, false);
  const cookie = login.headers.get("set-cookie") || "";
  assert.match(cookie, /guest_star_host_session=/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);
  assert.match(cookie, /SameSite=Lax/i);
  const loginPayload = received.find((entry) => entry.payload.action === "login")?.payload;
  assert.equal(loginPayload.clientType, "web");
  assert.equal("authToken" in loginPayload, false);
  assert.equal("deviceToken" in loginPayload, false);

  const sessionCookie = cookie.split(";", 1)[0];
  const me = await request("/api/host", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: sessionCookie },
    body: JSON.stringify({ action: "me", authToken: "attacker-token", deviceToken: "attacker-device" })
  });
  assert.equal(me.status, 200);
  const meBody = await me.json();
  assert.equal("authToken" in meBody, false);
  assert.equal("deviceToken" in meBody, false);
  const mePayload = received.find((entry) => entry.payload.action === "me")?.payload;
  assert.equal(mePayload.authToken, sessionToken);
  assert.equal("deviceToken" in mePayload, false);

  const oneTime = await request("/api/host", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: "guest_star_host_session=old-session" },
    body: JSON.stringify({ action: "consumeOneTimeLoginCode", code: "one-time" })
  });
  assert.equal(oneTime.status, 200);
  assert.match(oneTime.headers.get("set-cookie") || "", /guest_star_host_session=/);
  const oneTimePayload = received.find(
    (entry) => entry.payload.action === "consumeOneTimeLoginCode"
  )?.payload;
  assert.equal("authToken" in oneTimePayload, false);

  const publicP95Ms = await measureRoute("public bootstrap", 30, () => request(
    "/api/karaoke?action=publicBootstrap&hotel=production-test-hotel"
  ));
  const sessionP95Ms = await measureRoute("remembered Host session", 30, () => request("/api/host", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: sessionCookie },
    body: JSON.stringify({ action: "me" })
  }));

  const logout = await request("/api/host", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: sessionCookie },
    body: JSON.stringify({ action: "logout" })
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie") || "", /Max-Age=0/i);
  const logoutBody = await logout.json();
  assert.equal("authToken" in logoutBody, false);
  assert.equal("deviceToken" in logoutBody, false);

  const bridgeLogin = await request("/api/bridge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "login",
      username: "superhost",
      password: "not-a-real-password",
      clientType: "bridge",
      deviceName: "Production Test Bridge"
    })
  });
  assert.equal(bridgeLogin.status, 200);
  assert.equal(bridgeLogin.headers.get("x-guest-star-bridge-proxy"), "4.3.0");
  const bridgeLoginBody = await bridgeLogin.json();
  assert.equal(bridgeLoginBody.authToken, sessionToken);
  assert.equal(bridgeLoginBody.deviceToken, deviceToken);
  const bridgeLoginPayload = received
    .filter((entry) => entry.payload.action === "login")
    .at(-1)?.payload;
  assert.equal(bridgeLoginPayload.clientType, "bridge");
  assert.equal(bridgeLoginPayload.deviceName, "Production Test Bridge");

  console.log("Production HTTP routes, security and local latency passed.", {
    publicP95Ms,
    sessionP95Ms
  });
} finally {
  nextServer.kill("SIGTERM");
  if (nextServer.exitCode === null) {
    await Promise.race([
      once(nextServer, "exit"),
      new Promise((resolveDelay) => setTimeout(resolveDelay, 5_000))
    ]);
  }
  if (nextServer.exitCode === null) nextServer.kill("SIGKILL");
  await close(appsScript);
}
