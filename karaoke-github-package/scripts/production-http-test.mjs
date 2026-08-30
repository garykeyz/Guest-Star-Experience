import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
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

// This deliberately reachable fake represents the retired Apps Script path.
// No Guest Star live API is allowed to contact it.
const appsScript = createServer(async (request, response) => {
  let body = "";
  for await (const chunk of request) body += chunk;
  received.push({ method: request.method, body });
  json(response, { ok: true, unsafeFallbackReached: true });
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
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Next.js did not become ready.\n${output.join("")}`);
}

async function measureRoute(label, samples, operation) {
  const latencies = [];
  for (let index = 0; index < samples; index += 1) {
    const startedAt = performance.now();
    const response = await operation();
    assert.equal(response.status, 200, `${label} should render`);
    await response.arrayBuffer();
    latencies.push(performance.now() - startedAt);
  }
  latencies.sort((left, right) => left - right);
  return Number(latencies[Math.floor(latencies.length * 0.95)].toFixed(2));
}

try {
  await waitUntilReady();

  for (const path of ["/", "/h/moon-palace-test", "/host", "/bridge-login?code=one-time", "/icon.svg"]) {
    const response = await request(path);
    assert.equal(response.status, 200, `${path} should render in production`);
  }

  const publicBootstrap = await request(
    "/api/karaoke?action=publicBootstrap&hotel=moon-palace-test"
  );
  assert.equal(publicBootstrap.status, 503);
  assert.equal(publicBootstrap.headers.get("retry-after"), "2");
  assert.equal(publicBootstrap.headers.get("x-guest-star-backend"), "d1-only");
  const publicBody = await publicBootstrap.json();
  assert.equal(publicBody.code, "D1_SERVICE_UNAVAILABLE");
  assert.notEqual(publicBody.code, "PUBLIC_LINK_NOT_FOUND");

  const publicPost = await request("/api/karaoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicCode: "moon-palace-test", guestDeviceId: "device-local-production-test",
      name: "Guest", song: "Song", artist: "Artist", languageCode: "es"
    })
  });
  assert.equal(publicPost.status, 503);
  assert.equal((await publicPost.json()).code, "D1_SERVICE_UNAVAILABLE");

  const host = await request("/api/host", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", username: "host", password: "password" })
  });
  assert.equal(host.status, 503);
  assert.equal((await host.json()).code, "D1_SERVICE_UNAVAILABLE");

  const bridge = await request("/api/bridge", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login", username: "host", password: "password" })
  });
  assert.equal(bridge.status, 503);
  assert.equal((await bridge.json()).code, "D1_SERVICE_UNAVAILABLE");

  const blockedPublicGet = await request("/api/karaoke?action=login");
  assert.equal(blockedPublicGet.status, 403);
  const blockedPublicPost = await request("/api/karaoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "login" })
  });
  assert.equal(blockedPublicPost.status, 403);

  const rootP95Ms = await measureRoute("static root", 30, () => request("/"));
  const hotelPageP95Ms = await measureRoute("hotel request page", 30, () => request("/h/moon-palace-test"));
  assert.equal(received.length, 0,
    "neither Request, Host nor Bridge may fall back to Apps Script/Sheets when D1 is unavailable");

  console.log("Production build fail-closed HTTP test passed", {
    appsScriptCalls: received.length,
    rootP95Ms,
    hotelPageP95Ms
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
