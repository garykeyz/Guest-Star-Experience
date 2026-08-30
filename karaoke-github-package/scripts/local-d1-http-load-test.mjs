import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import os, { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

// The managed test container blocks libuv's interface enumeration. Miniflare
// only needs a loopback address for its internal workerd process.
os.networkInterfaces = () => ({
  lo: [{
    address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4",
    mac: "00:00:00:00:00:00", internal: true, cidr: "127.0.0.1/8"
  }]
});

const execute = promisify(execFile);
const packageRoot = resolve(new URL("..", import.meta.url).pathname);
const wrangler = resolve(packageRoot, "node_modules/.bin/wrangler");
const publicCode = "moon-palace-4b9a99b9f7a140d4bb86";
const stamp = "2026-08-29T00:00:00.000Z";
const activityCount = Math.max(1, Math.min(250, Number(process.env.GUEST_STAR_LOAD_ACTIVITIES) || 1));
const guestsPerActivity = Math.max(1, Math.min(2_000, Number(process.env.GUEST_STAR_LOAD_GUESTS_PER_ACTIVITY) || 200));
const requestedConcurrency = Math.max(1, Math.min(
  2_000,
  Number(process.env.GUEST_STAR_LOAD_CONCURRENCY) || activityCount * guestsPerActivity
));
const publicReadCount = Math.max(1, Math.min(
  2_000,
  Number(process.env.GUEST_STAR_LOAD_READS) || 200
));
const loadContexts = Array.from({ length: activityCount }, (_, index) => {
  const suffix = String(index + 1).padStart(4, "0");
  return {
    hotelId: index === 0 ? "hotel-moon-palace" : `hotel-load-${suffix}`,
    venueId: index === 0 ? "venue-lobby-bar" : `venue-load-${suffix}`,
    activityId: index === 0 ? "activity-karaoke-night" : `activity-load-${suffix}`,
    cycleId: index === 0 ? "cycle-live-2026-08-29" : `cycle-load-${suffix}`,
    publicCode: index === 0 ? publicCode : `load-${suffix}-a1b2c3d4e5f6${suffix}`,
    hotelName: index === 0 ? "Moon Palace" : `Load Hotel ${index + 1}`
  };
});

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function record(table, id, data, scope = "master") {
  return `INSERT INTO guest_star_records
    (scope, table_name, record_id, data_json, created_at, updated_at)
    VALUES (${sqlText(scope)}, ${sqlText(table)}, ${sqlText(id)}, ${sqlText(JSON.stringify(data))}, ${sqlText(stamp)}, ${sqlText(stamp)})`;
}

async function executeStatements(db, source) {
  for (const statement of String(source).split(";").map((value) => value.trim()).filter(Boolean)) {
    await db.prepare(statement).run();
  }
}

const bundleRoot = await mkdtemp(join(tmpdir(), "guest-star-worker-bundle-"));
let miniflare;
try {
  await execute(wrangler, ["deploy", "--dry-run", "--outdir", bundleRoot], {
    cwd: packageRoot,
    env: { ...process.env, NO_COLOR: "1" },
    maxBuffer: 20 * 1024 * 1024
  });
  const bundlePath = join(bundleRoot, "worker.js");
  const { Miniflare } = await import("miniflare");
  miniflare = new Miniflare({
    rootPath: bundleRoot,
    modulesRoot: bundleRoot,
    modules: [{ type: "ESModule", path: bundlePath }],
    compatibilityDate: "2026-07-28",
    compatibilityFlags: ["nodejs_compat"],
    d1Databases: { GUEST_STAR_DB: "guest-star-http-load-test" },
    bindings: {
      KARAOKE_APPS_SCRIPT_URL: "http://127.0.0.1:9/google-disabled",
      GOOGLE_OAUTH_CLIENT_ID: "local-test.apps.googleusercontent.com"
    },
    host: "127.0.0.1",
    port: 0,
    inspectorPort: 0,
    logRequests: false,
    unsafeDevRegistryPath: "",
    telemetry: { enabled: false }
  });

  const db = await miniflare.getD1Database("GUEST_STAR_DB");
  await executeStatements(
    db,
    await readFile(resolve(packageRoot, "migrations/0001_guest_star_core.sql"), "utf8")
  );

  const [{ hotelId, venueId, activityId, cycleId }] = loadContexts;
  const seed = [
    `INSERT OR REPLACE INTO guest_star_meta (key, value, updated_at) VALUES ('backend_mode', 'd1_primary', ${sqlText(stamp)})`,
    `INSERT OR REPLACE INTO guest_star_meta (key, value, updated_at) VALUES ('session_hash_secret', 'local-load-test-secret', ${sqlText(stamp)})`,
    ...loadContexts.flatMap((context, index) => [
      record("Hotels", context.hotelId, {
        hotelId: context.hotelId, name: context.hotelName,
        slug: index === 0 ? "moon-palace" : `load-hotel-${String(index + 1).padStart(4, "0")}`,
        publicCode: context.publicCode.replace(/^.*-/, ""),
        publicUrl: `https://local.invalid/h/${context.publicCode}`,
        activePublicActivityId: context.activityId, timezone: "America/Santo_Domingo", status: "active",
        createdAt: stamp, updatedAt: stamp
      }),
      record("Venues", context.venueId, {
        venueId: context.venueId, hotelId: context.hotelId, name: "Lobby Bar",
        status: "active", createdAt: stamp, updatedAt: stamp
      }),
      record("Activities", context.activityId, {
        activityId: context.activityId, hotelId: context.hotelId, venueId: context.venueId,
        name: "Karaoke Night", status: "in_progress", currentCycleId: context.cycleId,
        defaultDurationSeconds: 7200, defaultTransitionSeconds: 30, acceptEarlyRequests: false,
        allowedLanguagesJson: JSON.stringify(["es", "en", "fr", "it", "de", "ru", "pt"]),
        createdAt: stamp, updatedAt: stamp
      }),
      record("ActivityCycles", context.cycleId, {
        cycleId: context.cycleId, activityId: context.activityId, hotelId: context.hotelId,
        venueId: context.venueId, status: "in_progress", startedAt: stamp,
        finishedAt: "", archivedAt: "", createdAt: stamp, updatedAt: stamp
      }, context.hotelId),
      record("HotelBranding", `branding-${context.hotelId}`, {
        hotelBrandingId: `branding-${context.hotelId}`, hotelId: context.hotelId,
        primaryColor: "#ff2d95", secondaryColor: "#8b3dff", accentColor: "#00c8ff",
        showHotelName: true, updatedAt: stamp
      }),
      `INSERT INTO guest_star_activity_runtime
        (activity_id, hotel_id, venue_id, cycle_id, accepting, running, started_at, finished_at,
         state_revision, last_action, last_source, updated_at)
        VALUES (${sqlText(context.activityId)}, ${sqlText(context.hotelId)}, ${sqlText(context.venueId)}, ${sqlText(context.cycleId)},
         1, 1, ${sqlText(stamp)}, '', 1, 'activity.start', 'player', ${sqlText(stamp)})`
    ]),
    `INSERT INTO guest_star_requests
      (row_id, request_id, hotel_id, venue_id, activity_id, cycle_id, singer, song, artist,
       comment, language, language_code, duration_seconds, transition_seconds, accumulated_seconds,
       remaining_seconds, source_url, status, file_name, source_type, virtual_dj_item_id,
       queue_position, sync_state, last_seen_at, state_revision, created_at, updated_at, archived_at)
      VALUES ('old-cycle-request', 'old-cycle-request', ${sqlText(hotelId)}, ${sqlText(venueId)},
       ${sqlText(activityId)}, 'cycle-previous', 'Same Singer', 'Past Song', 'Past Artist', '',
       'Español', 'es', 240, 30, 270, 6930, '', 'Pendiente', '', 'public_request', '',
       1, 'pending', '', 1, ${sqlText(stamp)}, ${sqlText(stamp)}, '')`
  ].join(";\n");
  await executeStatements(db, seed);

  const request = (path, init) => miniflare.dispatchFetch(`http://guest-star.local${path}`, init);
  const bootstrap = await request(
    `/api/karaoke?action=publicBootstrap&hotel=${encodeURIComponent(publicCode)}`
  );
  assert.equal(bootstrap.status, 200);
  assert.equal(bootstrap.headers.get("x-guest-star-backend"), "d1-only");
  const bootstrapBody = await bootstrap.json();
  assert.equal(bootstrapBody.ok, true);
  assert.equal(bootstrapBody.accepting, true);
  assert.equal(bootstrapBody.hotel.name, "Moon Palace");

  const readStartedAt = performance.now();
  const publicReads = await Promise.all(Array.from({ length: publicReadCount }, async () => {
    const requestStartedAt = performance.now();
    try {
      const response = await request(
        `/api/karaoke?action=publicBootstrap&hotel=${encodeURIComponent(publicCode)}`
      );
      const body = await response.json();
      return { status: response.status, body, latency: performance.now() - requestStartedAt };
    } catch (error) {
      return { status: 0, body: { ok: false, error: String(error) }, latency: performance.now() - requestStartedAt };
    }
  }));
  const readBurstMs = performance.now() - readStartedAt;
  assert.equal(publicReads.filter((result) => result.status === 200 && result.body.ok === true).length, publicReadCount,
    "concurrent public polling must remain available and return valid JSON");

  const priorCycleResponse = await request("/api/karaoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicCode,
      guestDeviceId: "new-cycle-device-00000001",
      name: "Same Singer", song: "Past Song", artist: "Past Artist",
      language: "Español", languageCode: "es"
    })
  });
  const priorCycleBody = await priorCycleResponse.json();
  assert.equal(priorCycleResponse.status, 200);
  assert.equal(priorCycleBody.ok, true,
    "a request from a previous activity cycle must not trigger a duplicate warning");

  const startedAt = performance.now();
  const loadCases = loadContexts.flatMap((context, activityIndex) =>
    Array.from({ length: guestsPerActivity }, (_, guestIndex) => ({ context, activityIndex, guestIndex }))
  );
  const results = new Array(loadCases.length);
  let nextLoadCase = 0;
  async function loadWorker() {
    while (nextLoadCase < loadCases.length) {
      const index = nextLoadCase;
      nextLoadCase += 1;
      const { context, activityIndex, guestIndex } = loadCases[index];
      const requestStartedAt = performance.now();
      try {
        const response = await request("/api/karaoke", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            publicCode: context.publicCode,
            guestDeviceId: `http-load-${String(activityIndex).padStart(4, "0")}-${String(guestIndex).padStart(6, "0")}`,
            name: `HTTP Guest ${activityIndex + 1}-${guestIndex + 1}`,
            song: `HTTP Song ${activityIndex + 1}-${guestIndex + 1}`,
            artist: `HTTP Artist ${activityIndex + 1}-${guestIndex + 1}`,
            language: "Español",
            languageCode: "es"
          })
        });
        const responseText = await response.text();
        let body;
        try { body = JSON.parse(responseText); }
        catch { body = { ok: false, invalidJson: true, text: responseText.slice(0, 120) }; }
        results[index] = {
          status: response.status,
          backend: response.headers.get("x-guest-star-backend"),
          body,
          latency: performance.now() - requestStartedAt
        };
      } catch (error) {
        results[index] = {
          status: 0,
          backend: "",
          body: { ok: false, networkError: String(error) },
          latency: performance.now() - requestStartedAt
        };
      }
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(requestedConcurrency, loadCases.length) },
    () => loadWorker()
  ));
  const burstMs = performance.now() - startedAt;
  assert.equal(results.filter((result) => result.status === 200).length, loadCases.length);
  assert.equal(results.filter((result) => result.body.ok === true).length, loadCases.length);
  assert.equal(results.filter((result) => result.body.invalidJson).length, 0);
  assert.equal(results.every((result) => result.backend === "d1-only"), true);

  const retry = await request("/api/karaoke", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publicCode,
      guestDeviceId: "http-load-0000-000000",
      name: "HTTP Guest 1-1", song: "HTTP Song 1-1", artist: "HTTP Artist 1-1",
      language: "Español", languageCode: "es"
    })
  }).then((response) => response.json());
  assert.equal(retry.ok, true);
  assert.equal(retry.deduplicated, true,
    "a safe client retry must return the existing request instead of creating another row");

  const finalState = await request(
    `/api/karaoke?action=publicBootstrap&hotel=${encodeURIComponent(publicCode)}`
  ).then((response) => response.json());
  assert.equal(finalState.queuePeopleCount, guestsPerActivity + 1);

  const outbox = await db.prepare("SELECT COUNT(*) AS total FROM guest_star_outbox").first();
  assert.equal(Number(outbox?.total), 0,
    "the HTTP burst must not enqueue Google Sheets backup work");
  for (const [index, context] of loadContexts.entries()) {
    const currentRows = await db.prepare(
      "SELECT COUNT(*) AS total FROM guest_star_requests WHERE cycle_id = ?"
    ).bind(context.cycleId).first();
    assert.equal(Number(currentRows?.total), guestsPerActivity + (index === 0 ? 1 : 0));
    const queuePositions = await db.prepare(
      `SELECT COUNT(*) AS total,
              COUNT(DISTINCT CASE WHEN queue_position > 0 THEN queue_position ELSE rowid END) AS distinct_positions
       FROM guest_star_requests WHERE cycle_id = ?`
    ).bind(context.cycleId).first();
    assert.equal(Number(queuePositions?.distinct_positions), Number(queuePositions?.total),
      "simultaneous HTTP writes must never assign the same effective queue position twice");
  }

  const latencies = results.map((result) => result.latency).sort((left, right) => left - right);
  const p95Ms = latencies[Math.floor(latencies.length * 0.95)];
  const readLatencies = publicReads.map((result) => result.latency).sort((left, right) => left - right);
  const readP95Ms = readLatencies[Math.floor(readLatencies.length * 0.95)];
  console.log("Local Worker + D1 HTTP burst passed", {
    activities: activityCount,
    guestsPerActivity,
    concurrency: Math.min(requestedConcurrency, loadCases.length),
    accepted: loadCases.length,
    lost: 0,
    invalidJson: 0,
    priorCycleFalseDuplicate: 0,
    sheetsCalls: 0,
    publicReads: publicReadCount,
    readBurstMs: Number(readBurstMs.toFixed(1)),
    readP95Ms: Number(readP95Ms.toFixed(1)),
    burstMs: Number(burstMs.toFixed(1)),
    p95Ms: Number(p95Ms.toFixed(1))
  });
} finally {
  if (miniflare) await miniflare.dispose();
  await rm(bundleRoot, { recursive: true, force: true });
}
