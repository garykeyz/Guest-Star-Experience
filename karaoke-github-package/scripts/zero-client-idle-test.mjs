import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);
const minimumDurationMs = Math.max(
  600_000,
  Number(process.env.GUEST_STAR_ZERO_IDLE_DURATION_MS) || 600_000
);
const forbiddenProcessPatterns = [
  /\/Applications\/Guest Star[^/]*\.app\//i,
  /com\.gstarxp\.guest-star/i,
  /guest-star-bridge\/src\/server\.mjs/i,
  /production-connected-idle-test\.mjs/i,
  /local-connected-idle-test\.mjs/i,
  /realtime-reconnect-load-test\.mjs/i,
  /local-d1-http-load-test\.mjs/i
];

async function activeGuestStarClients() {
  const { stdout } = await execute("ps", ["-axo", "pid=,command="], {
    maxBuffer: 5 * 1024 * 1024
  });
  return stdout.split("\n").map((line) => line.trim()).filter(Boolean).filter((line) => {
    const [pid] = line.split(/\s+/, 1);
    if (Number(pid) === process.pid) return false;
    return forbiddenProcessPatterns.some((pattern) => pattern.test(line));
  });
}

const clientsBefore = await activeGuestStarClients();
assert.deepEqual(clientsBefore, [], `Guest Star clients/tests still active: ${clientsBefore.join(" | ")}`);

const startedAt = new Date();
const startedMonotonic = performance.now();
console.log(JSON.stringify({
  event: "zero-client-idle-started",
  startedAt: startedAt.toISOString(),
  minimumDurationMs,
  activeGuestStarClients: 0
}));

let remainingMs = minimumDurationMs;
while (remainingMs > 0) {
  await wait(Math.min(60_000, remainingMs));
  remainingMs = minimumDurationMs - (performance.now() - startedMonotonic);
}

const elapsedMs = performance.now() - startedMonotonic;
const finishedAt = new Date();
const clientsAfter = await activeGuestStarClients();
assert.ok(elapsedMs >= 600_000, `Zero-client idle window was too short: ${elapsedMs}ms`);
assert.deepEqual(clientsAfter, [], `Guest Star clients/tests appeared: ${clientsAfter.join(" | ")}`);

console.log(JSON.stringify({
  ok: true,
  event: "zero-client-idle-completed",
  startedAt: startedAt.toISOString(),
  finishedAt: finishedAt.toISOString(),
  elapsedMs: Number(elapsedMs.toFixed(3)),
  activeGuestStarClientsBefore: clientsBefore.length,
  activeGuestStarClientsAfter: clientsAfter.length
}, null, 2));
