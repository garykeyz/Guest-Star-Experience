import assert from "node:assert/strict";
import { createHmac, generateKeyPairSync, sign as rsaSign } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
  type D1DatabaseLike,
  type D1StatementLike,
  activeRequests,
  backendMode,
  DAILY_FREE_TRANSLATION_NEURON_BUDGET,
  d1Health,
  ensureD1Schema,
  importD1Snapshot,
  listRecords,
  moveActiveRequestBefore,
  updateActiveRequest,
  upsertRequest,
  reserveDailyFreeTranslationBudget,
  upsertRecord
} from "../lib/guest-star/d1-store";
import {
  handleD1HostAction,
  handleD1PublicGet,
  handleD1PublicPost,
  loginD1WithVerifiedGoogle,
  nextScheduleOccurrence,
  setD1BackendMode
} from "../lib/guest-star/d1-actions";
import { hmacSha256Hex } from "../lib/guest-star/crypto";
import { ensureVenueAccess } from "../lib/guest-star/activity-access";
import { googleDriveFileId, normalizeBrandImageUrl } from "../lib/guest-star/media-url";
import { canonicalHostPanelPath, isHostPanelHostname } from "../lib/guest-star/site-routing";
import {
  clearGoogleIdentityKeyCacheForTests,
  verifyGoogleIdentityToken
} from "../lib/guest-star/google-identity";
import {
  BRANDING_MESSAGE_FIELDS,
  GUEST_LANGUAGE_CODES,
  parseLocalizedMessages,
  prepareBrandingLocalization
} from "../lib/guest-star/translation";

class TestStatement implements D1StatementLike {
  private values: unknown[] = [];
  constructor(private database: DatabaseSync, private query: string) {}
  bind(...values: unknown[]) { this.values = values; return this; }
  async all<T>() {
    const results = this.database.prepare(this.query).all(...this.values as SQLInputValue[]) as T[];
    return { success: true, results };
  }
  async first<T>(column?: string) {
    const row = this.database.prepare(this.query).get(...this.values as SQLInputValue[]) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }
  async run() {
    const result = this.database.prepare(this.query).run(...this.values as SQLInputValue[]);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
}

class TestD1 implements D1DatabaseLike {
  readonly database = new DatabaseSync(":memory:");
  prepare(query: string) { return new TestStatement(this.database, query); }
  async batch<T>(statements: D1StatementLike[]) {
    const results: unknown[] = [];
    this.database.exec("BEGIN");
    try {
      for (const statement of statements) results.push(await statement.run());
      this.database.exec("COMMIT");
      return results as T[];
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
  async exec(query: string) {
    assert.doesNotMatch(
      query,
      /\bPRAGMA\s+foreign_keys\s*=/i,
      "Cloudflare D1 enforces foreign keys and rejects changing this PRAGMA inside its implicit transaction"
    );
    for (const line of query.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)) {
      this.database.exec(line);
    }
    return { success: true };
  }
}

const migrationDb = new TestD1();
migrationDb.database.exec(readFileSync("migrations/0001_guest_star_core.sql", "utf8"));
migrationDb.database.exec(readFileSync("migrations/0002_atomic_request_queue.sql", "utf8"));
migrationDb.database.exec(readFileSync("migrations/0003_d1_hot_path_indexes.sql", "utf8"));
migrationDb.database.exec(readFileSync("migrations/0004_activity_kiosk_access.sql", "utf8"));
migrationDb.database.exec(readFileSync("migrations/0005_venue_room_access.sql", "utf8"));
migrationDb.database.exec(readFileSync("migrations/0006_persistent_activity_access.sql", "utf8"));
const explainDetails = (database: DatabaseSync, query: string) => (
  database.prepare(`EXPLAIN QUERY PLAN ${query}`).all()
    .map((row) => String((row as Record<string, unknown>).detail || ""))
    .join("\n")
);
assert.match(explainDetails(migrationDb.database, `
  SELECT data_json FROM guest_star_records
  WHERE scope = 'master' AND table_name = 'AuthSessions' AND json_valid(data_json)
    AND json_extract(data_json, '$.sessionTokenHash') = 'test-hash'
  LIMIT 1
`), /guest_star_records_auth_session_hash/,
"session authentication must use the token-hash expression index");
assert.match(explainDetails(migrationDb.database, `
  SELECT data_json FROM guest_star_records
  WHERE scope = 'master' AND table_name = 'BridgeCommands' AND json_valid(data_json)
    AND json_extract(data_json, '$.deviceId') = 'device'
    AND json_extract(data_json, '$.activityId') = 'activity'
    AND json_extract(data_json, '$.status') = 'pending'
  ORDER BY json_extract(data_json, '$.createdAt'), record_id
  LIMIT 25
`), /guest_star_records_bridge_commands_pending/,
"Bridge polling must use the pending-command expression index");
assert.match(explainDetails(migrationDb.database, `
  SELECT data_json FROM guest_star_records
  WHERE scope = 'master' AND table_name = 'Users'
  ORDER BY created_at, record_id
`), /guest_star_records_created_order/,
"record listings must use the created-order index");
assert.match(explainDetails(migrationDb.database, `
  SELECT row_id FROM guest_star_requests
  WHERE hotel_id = 'hotel' AND activity_id = 'activity' AND archived_at = ''
    AND cycle_id IN ('', 'cycle')
  LIMIT 1000
`), /guest_star_requests_active_cycle/,
"current-cycle queue reads must use the active-cycle index");

const driveFileId = "1MoonPalaceLogo_2026abcXYZ";
const driveShareUrl = `https://drive.google.com/file/d/${driveFileId}/view?usp=drive_link`;
assert.equal(googleDriveFileId(driveShareUrl), driveFileId);
assert.equal(
  normalizeBrandImageUrl(driveShareUrl),
  `https://drive.google.com/thumbnail?id=${driveFileId}&sz=w1000`,
  "Google Drive share pages must be converted to image responses before rendering"
);
assert.equal(
  normalizeBrandImageUrl(`https://drive.google.com/open?id=${driveFileId}&resourcekey=public-key`),
  `https://drive.google.com/thumbnail?id=${driveFileId}&sz=w1000&resourcekey=public-key`
);
assert.equal(normalizeBrandImageUrl("https://cdn.example.com/logo.png"), "https://cdn.example.com/logo.png");
assert.equal(isHostPanelHostname("host.gstarxp.com"), true);
assert.equal(isHostPanelHostname("HOST.GSTARXP.COM:443"), true);
assert.equal(isHostPanelHostname("request.gstarxp.com"), false);
assert.equal(canonicalHostPanelPath("host.gstarxp.com"), "/");
assert.equal(canonicalHostPanelPath("localhost:3000"), "/host");
const rootPageSource = readFileSync("app/page.tsx", "utf8");
const hostPanelSource = readFileSync("components/HostPanel.tsx", "utf8");
const publicExperienceSource = readFileSync("components/KaraokeExperience.tsx", "utf8");
const globalCssSource = readFileSync("app/globals.css", "utf8");
const hostRouteSource = readFileSync("app/api/host/route.ts", "utf8");
const bridgeRouteSource = readFileSync("app/api/bridge/route.ts", "utf8");
const karaokeRouteSource = readFileSync("app/api/karaoke/route.ts", "utf8");
const d1ActionsSource = readFileSync("lib/guest-star/d1-actions.ts", "utf8");
const bridgeServerSource = readFileSync("guest-star-bridge/src/server.mjs", "utf8");
assert.match(rootPageSource, /isHostPanelHostname\(hostname\)/,
  "the production host domain root must render the Host Panel");
assert.match(rootPageSource, /"use client"/,
  "the root experience must be prerenderable as a static Cloudflare asset");
assert.doesNotMatch(rootPageSource, /from "next\/headers"/,
  "root navigation must not spend Worker CPU resolving the hostname");
assert.match(hostPanelSource, /name="venueId" required/,
  "activity creation must require an explicit venue selection");
assert.match(hostPanelSource, /action:"updateVenue"/,
  "Superhost must be able to administer existing venues");
assert.match(hostPanelSource, /<summary>Configure branding and public experience<\/summary>/,
  "the full branding form must stay collapsed until the Superhost needs it");
assert.match(hostPanelSource, /<summary>Manage Bridge devices \(\{adminDevices\.length\}\)<\/summary>/,
  "Bridge device history must stay compact by default");
assert.match(hostPanelSource, /<summary>Revoked devices \(\{revokedAdminDevices\.length\}\)<\/summary>/,
  "revoked Bridge devices must be grouped in a secondary collapsed section");
assert.match(hostPanelSource, /Default experience for request\.gstarxp\.com — Disabled/,
  "Host must show that the legacy default root experience is disabled");
assert.match(hostPanelSource, /Session PIN required/,
  "Host must explain that request.gstarxp.com now requires the activity PIN");
assert.doesNotMatch(hostPanelSource, /action:"setDefaultPublicExperience"/,
  "Host must not be able to restore a default root activity");
assert.doesNotMatch(hostPanelSource, /Google Form and Sheet Backup|linkGoogleFallback/,
  "Host Panel must not expose Google Forms or Sheets as a live request destination");
assert.match(hostRouteSource, /GOOGLE_REQUEST_BACKUP_DISABLED/,
  "the Host API must reject the retired Google request fallback explicitly");
assert.match(karaokeRouteSource, /D1_SERVICE_UNAVAILABLE/,
  "the public API must fail closed with a retryable D1 response");
assert.match(karaokeRouteSource, /X-Guest-Star-Backend": "d1-only"/,
  "public responses must identify the D1-only request path");
assert.doesNotMatch(karaokeRouteSource, /AppsScript|script\.google|scheduleD1Backup|callAppsScript/,
  "public requests must never call Apps Script or schedule a Sheets mirror");
assert.doesNotMatch(bridgeRouteSource, /scheduleD1Backup|callAppsScript/,
  "Bridge live operations must never call Apps Script or schedule a Sheets mirror");
assert.doesNotMatch(hostRouteSource, /scheduleD1Backup/,
  "Host live operations must never schedule a Sheets mirror");
assert.doesNotMatch(d1ActionsSource, /appendOutbox/,
  "D1 mutations must not create Google Sheets backup work during a live activity");
assert.doesNotMatch(bridgeServerSource, /"setDefaultPublicExperience"/,
  "the local Bridge proxy must not expose the disabled root-domain setting");
assert.doesNotMatch(bridgeServerSource, /"setDefaultGoogleFallback"/,
  "the local Guest Star service must not proxy the retired Google request fallback");
assert.match(publicExperienceSource, /normalizeBrandImageUrl/,
  "the public experience must normalize Google Drive logo links");
assert.match(publicExperienceSource, /className="tenantLogo"/,
  "hotel logos must render inside a dedicated presentation frame");
assert.match(globalCssSource, /\.tenantLogo\{width:92px;height:92px/,
  "hotel logos with built-in whitespace must remain large enough to identify");
assert.match(globalCssSource, /filter:brightness\(\.58\) contrast\(1\.85\)/,
  "very pale hotel logos must receive enough contrast to remain visible");
assert.doesNotMatch(hostPanelSource, /Fast Backend|Import & Validate|Activate D1|Backup Now|Rollback|Hotel Sheet/,
  "migration, backup, and legacy storage controls must stay out of the operational panel");
assert.doesNotMatch(publicExperienceSource, /setInterval\(refreshStatus/,
  "a healthy realtime connection must not coexist with public status polling");
assert.match(publicExperienceSource, /new WebSocket\(realtimeUrl\(realtimeChannel\),"guest-star-v1"\)/,
  "public state must use one hotel-scoped realtime connection");
assert.match(publicExperienceSource, /Math\.min\(30000,1000\*\(2\*\*Math\.min\(reconnectAttempt,5\)\)\)/,
  "public realtime reconnect must use capped exponential backoff");
assert.match(publicExperienceSource, /\(!force&&socket\?\.readyState===WebSocket\.OPEN\)/,
  "HTTP fallback must stop while WebSocket is healthy");
assert.match(publicExperienceSource, /!hasLoadedPublicState\.current&&code==="PUBLIC_LINK_NOT_FOUND"/,
  "a transient poll failure must not replace valid public state with a false inactive-link banner");
assert.match(publicExperienceSource, /unavailableConfirmations\.current>=3/,
  "an inactive-link banner must require three confirmed responses");
assert.match(publicExperienceSource, /transientRetries:5/,
  "song submissions must retry transient Worker or network failures safely");
assert.match(publicExperienceSource, /hindiLatinRequired=active\[0\]==="hi"/,
  "the client-side Latin-letter rule must activate only for Hindi song requests");
assert.match(publicExperienceSource, /name:"Rahul",song:"Tum Hi Ho",artist:"Arijit Singh"/,
  "Hindi placeholders must teach the required Latin-letter format");
assert.match(publicExperienceSource, /!hasHindiScriptError/,
  "the client must block submission while a Hindi identification field contains Devanagari");
const sessionExperienceSource = readFileSync("components/SessionRequestExperience.tsx", "utf8");
const accessSource = readFileSync("lib/guest-star/activity-access.ts", "utf8");
assert.match(rootPageSource, /isKioskHostname\(hostname\)/,
  "kiosko.gstarxp.com must render the dedicated kiosk entry surface");
assert.match(sessionExperienceSource, /IDLE_TIMEOUT_MS = 60_000/,
  "the kiosk attract screen must activate after exactly sixty seconds");
assert.match(sessionExperienceSource, /pointerdown.*touchstart.*click.*keydown/,
  "touch, pointer, click and keyboard interaction must dismiss the attract screen");
assert.doesNotMatch(sessionExperienceSource, /setInterval\([^)]*(?:fetch|sessionApi)/,
  "the kiosk screensaver must not poll the Worker or D1");
assert.match(accessSource, /crypto\.getRandomValues/,
  "six-digit room PINs must use a cryptographically secure random source");
assert.match(accessSource, /WHERE hotel_id = \? AND activity_id = \? AND venue_id = \? AND status = 'active'/,
  "the active PIN must be scoped to one hotel, activity and venue");
assert.match(hostPanelSource, /user\.role==="host"&&selected&&kioskAccess/,
  "only an operational Host may see the room PIN card");
assert.match(hostPanelSource, /if\(user\.role==="host"\)void refreshSelected\(\)/,
  "a Host must load the selected room PIN immediately without pressing Load Activity");
assert.doesNotMatch(accessSource, /_requestFingerprint.*device_hash|device_hash.*_requestFingerprint/,
  "an IP signal must never become the primary guest session identity");

const googleClientId = "guest-star-test.apps.googleusercontent.com";
const googleKeyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const googlePublicJwk = googleKeyPair.publicKey.export({ format: "jwk" });
googlePublicJwk.kid = "guest-star-test-key";
googlePublicJwk.alg = "RS256";
googlePublicJwk.use = "sig";
const googleNow = Date.now();
const base64UrlJson = (value:unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
const googleUnsignedToken = [
  base64UrlJson({ alg: "RS256", kid: googlePublicJwk.kid, typ: "JWT" }),
  base64UrlJson({
    iss: "https://accounts.google.com", aud: googleClientId,
    sub: "google-user-1", email: "owner@example.com", email_verified: true,
    name: "Guest Star Owner", iat: Math.floor(googleNow / 1000) - 5,
    exp: Math.floor(googleNow / 1000) + 3600
  })
].join(".");
const googleCredential = `${googleUnsignedToken}.${rsaSign(
  "RSA-SHA256", Buffer.from(googleUnsignedToken), googleKeyPair.privateKey
).toString("base64url")}`;
clearGoogleIdentityKeyCacheForTests();
const verifiedGoogle = await verifyGoogleIdentityToken(googleCredential, googleClientId, {
  now: googleNow,
  fetcher: async () => new Response(JSON.stringify({ keys: [googlePublicJwk] }), {
    status: 200,
    headers: { "content-type": "application/json", "cache-control": "public,max-age=3600" }
  })
});
assert.equal(verifiedGoogle.email, "owner@example.com");
const googleCredentialParts = googleCredential.split(".");
googleCredentialParts[2] = `${googleCredentialParts[2][0] === "A" ? "B" : "A"}${googleCredentialParts[2].slice(1)}`;
await assert.rejects(
  verifyGoogleIdentityToken(googleCredentialParts.join("."), googleClientId, { now: googleNow }),
  /INVALID_GOOGLE_CREDENTIAL/,
  "Google linking must reject a tampered identity token"
);

const db = new TestD1();
await ensureD1Schema(db);
assert.equal(await reserveDailyFreeTranslationBudget(db, DAILY_FREE_TRANSLATION_NEURON_BUDGET - 1), true);
assert.equal(await reserveDailyFreeTranslationBudget(db, 2), false,
  "concurrent-safe translation budget must reject an over-quota reservation");
assert.equal(await reserveDailyFreeTranslationBudget(db, 1), true);

const superPassword = "Superhost-Password-2026";
const superSalt = "0123456789abcdef0123456789abcdef";
const superHash = await hmacSha256Hex(superPassword, superSalt);
assert.equal(
  superHash,
  createHmac("sha256", superSalt).update(superPassword).digest("hex"),
  "password hashes must stay compatible with Apps Script HMAC-SHA256"
);

const hotelId = "hotel-main";
const venueId = "venue-main";
const activityId = "activity-main";
await importD1Snapshot(db, {
  schemaVersion: "4.2.0",
  backupSecret: "backup-secret-for-test-only",
  master: {
    Users: [{
      userId: "superhost-1", username: "superhost", displayName: "Superhost",
      email: "owner@example.com", passwordHash: superHash, passwordSalt: superSalt,
      role: "superhost", status: "active", staticHostSlug: "superhost",
      mustChangePassword: false, createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(), lastLoginAt: "", passwordUpdatedAt: new Date().toISOString()
    }],
    Hotels: [{
      hotelId, name: "Moon Palace", slug: "moon-palace", publicCode: "public-test-code",
      publicUrl: "https://request.gstarxp.com/h/moon-palace-public-test-code",
      qrFileId: "", qrVersion: 1, activePublicActivityId: activityId, timezone: "America/Santo_Domingo",
      dataSheetId: "legacy-sheet", status: "active", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }],
    Venues: [{
      venueId, hotelId, name: "Lobby Bar", slug: "lobby-bar", status: "active",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
    }],
    Activities: [{
      activityId, hotelId, venueId, name: "Karaoke Night", internalCode: "karaoke-night",
      status: "ready", defaultDurationSeconds: 7200, defaultTransitionSeconds: 30,
      showPublicStatus: true, showCountdown: true, scheduledStartAt: "",
      autoStartEnabled: false, acceptEarlyRequests: false, currentCycleId: "",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      allowedLanguagesJson: JSON.stringify(["es", "en"])
    }],
    UserAssignments: [], Devices: [], BridgeCommands: [], AuthSessions: [],
    OneTimeLoginCodes: [], AuditLog: [], HotelBranding: [], ActivitySchedules: [],
    UpcomingActivities: [], GlobalSettings: []
  },
  hotels: [{
    hotelId,
    legacyConfig: { accepting: false, activityRunning: false },
    tables: {
      Solicitudes: [{
        "Fecha y hora": new Date().toISOString(), "Nombre": "Legacy Guest",
        "Canción": "Legacy Song", "Artista": "Legacy Artist", "Idioma": "Español",
        "Language code": "es", "Estado": "Pendiente", "ID": "legacy-request-1"
      }],
      Historial: [], ActivityCycles: [], Reviews: [], ReviewInvitations: [], GuestReminders: []
    }
  }]
});

let health = await d1Health(db);
assert.equal(health.mode, "d1_primary");
assert.equal(health.migrationStatus, "ready");
assert.equal(health.counts.users, 1);
assert.equal(health.counts.requests, 1);
await setD1BackendMode(db, "d1_primary");
assert.equal(await backendMode(db), "d1_primary");

const googleBridgeLogin = await loginD1WithVerifiedGoogle(db, verifiedGoogle.email, {
  clientType: "bridge", deviceName: "Google Test Bridge", bridgeVersion: "4.4.0",
  rememberLogin: true
}) as Record<string, unknown>;
assert.equal(googleBridgeLogin?.ok, true,
  "a verified Google address registered to an active Guest Star user must create a Bridge session");
assert.ok(String(googleBridgeLogin?.authToken || "").length >= 40);
assert.ok(String(googleBridgeLogin?.deviceToken || "").length >= 40);
assert.equal(((await loginD1WithVerifiedGoogle(db, "unknown@example.com", {
  clientType: "bridge", deviceName: "Unknown Bridge", bridgeVersion: "4.4.0"
})) as Record<string, unknown>).code, "GOOGLE_ACCOUNT_NOT_REGISTERED",
"Google login must never create an unregistered Guest Star account implicitly");

const login = await handleD1HostAction(db, {
  action: "login", username: "superhost", password: superPassword,
  clientType: "web", rememberLogin: true
});
assert.equal(login?.ok, true);
const superToken = String(login?.authToken || "");
assert.ok(superToken.length >= 40);
assert.ok(Date.parse(String(login?.expiresAt)) - Date.now() > 29 * 24 * 60 * 60 * 1000);

const superAuth = { authToken: superToken };
const migratedAdmin = await handleD1HostAction(db, { action: "adminState", ...superAuth });
const migratedActivity = (migratedAdmin?.activities as Array<Record<string, unknown>>)
  .find((activity) => activity.activityId === activityId);
assert.deepEqual(migratedActivity?.allowedLanguages, [...GUEST_LANGUAGE_CODES],
  "the one-time migration must restore all seven languages on legacy bilingual activities");
const bridgeLogin = await handleD1HostAction(db, {
  action: "login", username: "superhost", password: superPassword,
  clientType: "bridge", deviceName: "Test Bridge", bridgeVersion: "4.2.0",
  rememberLogin: true
});
assert.equal(bridgeLogin?.ok, true);
assert.equal(bridgeLogin?.codeVersion, "4.2.0", "Bridge and service must report version 4.2.0");
const bridgeAuth = {
  authToken: String(bridgeLogin?.authToken),
  deviceToken: String(bridgeLogin?.deviceToken)
};
const diagnosticPayload = {
  reportId: "GS-D1-REPORT-0001",
  automatic: true,
  severity: "ERROR",
  createdAt: "2026-09-07T17:00:00.000Z",
  firstSeenAt: "2026-09-07T16:59:00.000Z",
  lastSeenAt: "2026-09-07T17:00:00.000Z",
  modules: ["Bridge", "Network/API", "Bridge"],
  summary: "La entrega técnica requiere revisión.",
  description: "Prueba controlada de entrega D1.",
  userAction: "Activar reportes técnicos",
  version: "4.4.1",
  build: "test",
  stack: "Error: backend delivery",
  snapshot: {
    authToken: "must-not-be-stored",
    password: "must-not-be-stored",
    selectedSong: "must-not-be-stored",
    permitted: "safe-value"
  },
  recentEvents: [{ severity: "ERROR", timestamp: "2026-09-07T17:00:00.000Z", message: "network failure" }],
  health: { Diagnostics: "ERROR" }
};
assert.equal((await handleD1HostAction(db, {
  action: "submitDiagnosticReport", ...bridgeAuth, report: diagnosticPayload
}))?.ok, true, "an authenticated Bridge must persist a diagnostic report in D1");
const savedDiagnosticReports = await listRecords(db, "TechnicalReports");
assert.equal(savedDiagnosticReports.length, 1);
const savedDiagnostic = savedDiagnosticReports[0] as Record<string, unknown>;
assert.equal(savedDiagnostic.reportId, diagnosticPayload.reportId);
assert.equal(savedDiagnostic.reporterRole, "superhost", "the backend must derive the role from the session");
assert.equal(savedDiagnostic.status, "Nuevo", "a client cannot choose a Superhost report status");
assert.equal((savedDiagnostic.snapshot as Record<string, unknown>).authToken, "<redacted>");
assert.equal((savedDiagnostic.snapshot as Record<string, unknown>).password, "<redacted>");
assert.equal((savedDiagnostic.snapshot as Record<string, unknown>).selectedSong, "<redacted>");
assert.equal((savedDiagnostic.snapshot as Record<string, unknown>).permitted, "safe-value");
const duplicateDiagnostic = await handleD1HostAction(db, {
  action: "submitDiagnosticReport", ...bridgeAuth, report: diagnosticPayload
});
assert.equal(duplicateDiagnostic?.ok, true);
assert.equal(duplicateDiagnostic?.deduplicated, true,
  "a bridge retry must acknowledge the original report instead of duplicating it");
assert.equal((await listRecords(db, "TechnicalReports")).length, 1);
assert.equal((await handleD1HostAction(db, {
  action: "submitDiagnosticReport", report: diagnosticPayload
}))?.code, "UNAUTHORIZED", "a report without a valid session must be rejected");
assert.equal((await handleD1HostAction(db, {
  action: "submitDiagnosticReport", ...bridgeAuth, report: { reportId: "bad" }
}))?.code, "INVALID_DIAGNOSTIC_REPORT", "a malformed report must never be persisted");
const bridgeSelected = await handleD1HostAction(db, {
  action: "selectActivity", ...bridgeAuth, hotelId, venueId, activityId, source: "bridge"
});
assert.equal(bridgeSelected?.ok, true);
assert.match(String((bridgeSelected?.kioskAccess as Record<string, unknown>)?.pin || ""), /^\d{6}$/,
  "a Superhost Bridge session must receive the operational PIN for its selected activity");
assert.equal((await handleD1HostAction(db, {
  action: "bridgeHeartbeat", ...bridgeAuth, virtualDJConnected: true, bridgeVersion: "4.2.0"
}))?.ok, true);
const bridgeDeviceId = String(bridgeLogin?.deviceId);
const commandCreatedAt = Date.now();
for (let index = 0; index < 26; index += 1) {
  await upsertRecord(db, "BridgeCommands", {
    commandId: `poll-command-${String(index).padStart(2, "0")}`,
    deviceId: bridgeDeviceId,
    requestedByUserId: "superhost-1",
    activityId,
    commandType: "synchronize",
    payloadJson: JSON.stringify({ index }),
    status: "pending",
    createdAt: new Date(commandCreatedAt + index).toISOString(),
    startedAt: "",
    completedAt: "",
    resultJson: "",
    errorMessage: ""
  });
}
const [firstConcurrentPoll, secondConcurrentPoll] = await Promise.all([
  handleD1HostAction(db, { action: "pollBridgeCommands", ...bridgeAuth }),
  handleD1HostAction(db, { action: "pollBridgeCommands", ...bridgeAuth })
]);
const firstPollCommands = [firstConcurrentPoll, secondConcurrentPoll].flatMap((poll) => (
  Array.isArray(poll?.commands) ? poll.commands : []
));
assert.ok([firstConcurrentPoll, secondConcurrentPoll].every((poll) => (
  (Array.isArray(poll?.commands) ? poll.commands.length : 0) <= 25
)), "each concurrent Bridge poll must enforce LIMIT 25");
assert.equal(firstPollCommands.length, 26,
  "concurrent polls may divide all available work without losing a command");
assert.equal(new Set(firstPollCommands.map((command) => command.commandId)).size, 26,
  "a conditional claim must prevent duplicate command delivery");
const finalCommandPoll = await handleD1HostAction(db, {
  action: "pollBridgeCommands", ...bridgeAuth
});
assert.equal(Array.isArray(finalCommandPoll?.commands) ? finalCommandPoll.commands.length : 0, 0,
  "concurrent Bridge polls must leave no claimed command pending");
assert.equal((await handleD1HostAction(db, {
  action: "bridgeExternalSync", ...bridgeAuth,
  entries: [{
    virtualDJItemId: "external-vdj-1", singer: "VirtualDJ",
    song: "Que Dios Decida", artist: "El Gary", index: 0,
    durationSeconds: 252
  }]
}))?.ok, true);
let externalRows = await activeRequests(db, hotelId, activityId);
assert.equal(externalRows.find((item) => item.virtualDJItemId === "external-vdj-1")?.sourceType,
  "virtualdj_external", "VDJ-only tracks must stay identifiable and separate from online requests");
assert.equal((await handleD1HostAction(db, {
  action: "bridgeExternalSync", ...bridgeAuth,
  entries: [{
    virtualDJItemId: "error-entry", singer: "ERROR:-2147467259",
    song: "error:-2147467259", artist: "error:-2147467259", index: 0
  }]
}))?.ok, true);
externalRows = await activeRequests(db, hotelId, activityId);
assert.equal(externalRows.some((item) => item.virtualDJItemId === "error-entry"), false,
  "Network Control HRESULT values must never be stored as requests");
assert.equal(externalRows.find((item) => item.virtualDJItemId === "external-vdj-1")?.status,
  "Agregada a VirtualDJ", "one incomplete VDJ snapshot must not retire a live row");
assert.equal((await handleD1HostAction(db, {
  action: "bridgeExternalSync", ...bridgeAuth,
  entries: [], confirmedMissingIds: ["external-vdj-1"]
}))?.ok, true);
externalRows = await activeRequests(db, hotelId, activityId);
assert.equal(externalRows.find((item) => item.virtualDJItemId === "external-vdj-1")?.status,
  "Fuera de VirtualDJ", "only a locally confirmed absence may retire an external VDJ row");
// External queue observations must preserve the administrative lifecycle.
for (const status of ['Ya cantó', 'Saltado']) {
  const row = (await activeRequests(db, hotelId, activityId)).find(item => item.virtualDJItemId === 'external-vdj-1')!;
  await updateActiveRequest(db, hotelId, row.requestId, { status, stateRevision: row.stateRevision + 1 });
  await handleD1HostAction(db, { action: 'bridgeExternalSync', ...bridgeAuth, entries: [{ virtualDJItemId: 'external-vdj-1', singer: 'VirtualDJ', song: 'Que Dios Decida', artist: 'El Gary', index: 0, durationSeconds: 252 }] });
  await handleD1HostAction(db, { action: 'bridgeExternalSync', ...bridgeAuth, entries: [], confirmedMissingIds: ['external-vdj-1'] });
  assert.equal((await activeRequests(db, hotelId, activityId)).find(item => item.requestId === row.requestId)?.status, status);
  const protectedResult = await handleD1HostAction(db, { action: 'bridgeRequestUpdate', ...bridgeAuth, id: row.requestId, status: 'Pendiente', bridgeLifecycle: true });
  assert.equal(protectedResult?.code, 'MANUAL_OUTCOME_PROTECTED');
  const returned = await handleD1HostAction(db, { action: 'bridgeRequestUpdate', ...bridgeAuth, id: row.requestId, status: 'Pendiente', bridgeLifecycle: true, eventOrigin: 'USER_RETURN' });
  assert.equal(returned?.ok, true);
}
const oneTimeCode = await handleD1HostAction(db, {
  action: "createOneTimeLoginCode", ...bridgeAuth
});
assert.equal(oneTimeCode?.ok, true);
const rawOneTimeCode = new URL(String(oneTimeCode?.url)).searchParams.get("code") || "";
assert.equal((await handleD1HostAction(db, {
  action: "consumeOneTimeLoginCode", code: rawOneTimeCode
}))?.ok, true);
assert.equal((await handleD1HostAction(db, {
  action: "consumeOneTimeLoginCode", code: rawOneTimeCode
}))?.code, "INVALID_OR_EXPIRED_CODE", "one-time login codes must be consumed atomically");
const selected = await handleD1HostAction(db, {
  action: "selectActivity", ...superAuth, hotelId, venueId, activityId, source: "web"
});
assert.equal(selected?.ok, true, "activity selection must no longer return 502");

const hostPassword = "Host-Permanent-Password-2026";
const createdHost = await handleD1HostAction(db, {
  action: "createHost", ...superAuth, username: "host.one", displayName: "Host One",
  email: "host@example.com", password: hostPassword
});
assert.equal(createdHost?.ok, true);
const hostUser = createdHost?.user as Record<string, unknown>;
const hostId = String(hostUser.userId);
assert.equal("passwordHash" in hostUser, false, "admin API must never expose hashes");

assert.equal((await handleD1HostAction(db, {
  action: "assignUser", ...superAuth, userId: hostId, hotelId,
  permissions: {
    canChangeSchedule: true, canStartActivity: true, canFinishActivity: true,
    canOpenCloseRequests: true,
    canViewQR: true, canCustomizeGuestMessages: true
  }
}))?.ok, true);

const hostLogin = await handleD1HostAction(db, {
  action: "login", username: "host.one", password: hostPassword,
  clientType: "web", rememberLogin: true
});
assert.equal(hostLogin?.ok, true);
const hostToken = String(hostLogin?.authToken);
const hostAuth = { authToken: hostToken };
const hostSelection = hostLogin?.selection as { hotels?: Array<Record<string, unknown>> };
assert.equal("dataSheetId" in (hostSelection.hotels?.[0] || {}), false, "Host APIs must hide Google Sheet IDs");
assert.equal((await handleD1HostAction(db, {
  action: "updateActivityLanguages", authToken: hostToken,
  hotelId, venueId, activityId, allowedLanguages: ["es"]
}))?.ok, true, "assigned Host can select per-activity languages");

const switchedDeviceLogin = await handleD1HostAction(db, {
  action: "login", username: "host.one", password: hostPassword,
  clientType: "bridge", deviceId: String(bridgeLogin?.deviceId),
  deviceName: "Shared DJ Mac", bridgeVersion: "4.2.0", rememberLogin: true
});
assert.equal(switchedDeviceLogin?.ok, true, "a shared Mac must be reassigned instead of returning DEVICE_NOT_AUTHORIZED");
assert.notEqual(switchedDeviceLogin?.deviceId, bridgeLogin?.deviceId,
  "changing the Bridge user must revoke the previous device identity");
const switchedBridgeAuth = {
  authToken: String(switchedDeviceLogin?.authToken),
  deviceToken: String(switchedDeviceLogin?.deviceToken)
};
assert.equal((await handleD1HostAction(db, {
  action: "selectActivity", ...switchedBridgeAuth, hotelId, venueId, activityId, source: "bridge"
}))?.ok, true);
assert.equal((await handleD1HostAction(db, { action: "me", ...bridgeAuth }))?.code, "UNAUTHORIZED",
  "switching a Mac user must revoke the prior Bridge session");

const secondSuperPassword = "Second-Superhost-Password-2026";
const createdSuperhost = await handleD1HostAction(db, {
  action: "createHost", ...superAuth, role: "superhost", username: "super.two",
  displayName: "Second Superhost", email: "super2@example.com", password: secondSuperPassword
});
assert.equal((createdSuperhost?.user as Record<string, unknown>).role, "superhost");
const secondSuperId = String((createdSuperhost?.user as Record<string, unknown>).userId);
assert.equal((await handleD1HostAction(db, {
  action: "login", username: "super.two", password: secondSuperPassword,
  clientType: "web", rememberLogin: true
}))?.ok, true, "additional Superhosts must be able to sign in");
assert.equal((await handleD1HostAction(db, {
  action: "updateHost", ...superAuth, userId: secondSuperId, status: "inactive"
}))?.ok, true);
assert.equal((await handleD1HostAction(db, {
  action: "updateHost", ...superAuth, userId: "superhost-1", status: "inactive"
}))?.code, "LAST_SUPERHOST", "the last active Superhost must remain protected");
assert.equal((await handleD1HostAction(db, {
  action: "updateHost", ...superAuth, userId: secondSuperId, status: "active"
}))?.ok, true);

const publicParams = new URLSearchParams({ action: "publicBootstrap", hotel: "moon-palace-public-test-code" });
const futureSchedule = await handleD1HostAction(db, {
  action: "scheduleActivity", ...superAuth, hotelId, venueId, activityId,
  scheduledStartAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  durationSeconds: 7200, requestOpeningLeadSeconds: 600,
  autoOpenRequests: true, autoStartActivity: true, showCountdown: true,
  recurrenceType: "none", recurrenceInterval: 1
});
assert.equal(futureSchedule?.ok, true);
const publicScheduleLeaseKey = `public_schedule_check:${hotelId}`;
const idlePublicWritesBefore = Number((db.database.prepare(
  "SELECT total_changes() AS total"
).get() as Record<string, unknown>).total);
const futurePublicState = await handleD1PublicGet(db, publicParams) as Record<string, unknown>;
const idlePublicWritesAfter = Number((db.database.prepare(
  "SELECT total_changes() AS total"
).get() as Record<string, unknown>).total);
assert.equal(futurePublicState.accepting, false,
  "future schedules must stay closed until requestOpeningAt");
assert.equal(idlePublicWritesAfter, idlePublicWritesBefore,
  "public polling must not write a scheduler lease when no schedule is due");
assert.equal(db.database.prepare(
  "SELECT value FROM guest_star_meta WHERE key = ?"
).get(publicScheduleLeaseKey), undefined,
"an idle public poll must not create a scheduler lease row");
assert.equal((await handleD1HostAction(db, {
  action: "cancelSchedule", ...superAuth,
  scheduleId: String((futureSchedule?.schedule as Record<string, unknown>).scheduleId)
}))?.ok, true);

const earlyOpenSchedule = await handleD1HostAction(db, {
  action: "scheduleActivity", ...superAuth, hotelId, venueId, activityId,
  scheduledStartAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  durationSeconds: 7200, requestOpeningLeadSeconds: 600,
  autoOpenRequests: true, showCountdown: true,
  recurrenceType: "none", recurrenceInterval: 1
});
assert.equal(earlyOpenSchedule?.ok, true);
const earlyOpenPublicState = await handleD1PublicGet(db, publicParams);
assert.equal(earlyOpenPublicState.accepting, true,
  "a one-time activity must open inside its configured pre-event window");
assert.equal(earlyOpenPublicState.activityRunning, false,
  "opening requests early must never start Player or Bridge");
assert.equal((await handleD1HostAction(db, {
  action: "cancelSchedule", ...superAuth,
  scheduleId: String((earlyOpenSchedule?.schedule as Record<string, unknown>).scheduleId)
}))?.ok, true);

const dueSchedule = await handleD1HostAction(db, {
  action: "scheduleActivity", ...superAuth, hotelId, venueId, activityId,
  scheduledStartAt: new Date(Date.now() - 1000).toISOString(),
  durationSeconds: 7200, requestOpeningLeadSeconds: 600,
  autoOpenRequests: true, autoStartActivity: true, showCountdown: true,
  recurrenceType: "none", recurrenceInterval: 1
});
assert.equal(dueSchedule?.ok, true);
assert.equal(String((dueSchedule?.schedule as Record<string, unknown>).status), "completed");
assert.equal((dueSchedule?.schedule as Record<string, unknown>).autoStartActivity, false,
  "schedules must never choose or start a playback engine automatically");
assert.equal((await handleD1HostAction(db, {
  action: "activityState", ...superAuth, hotelId, venueId, activityId
}))?.ok, true, "due schedules must be processed by Host/Bridge state reads");

const scheduledPublicState = await handleD1PublicGet(db, publicParams);
assert.equal(scheduledPublicState.ok, true);
assert.equal((scheduledPublicState as Record<string, unknown>).accepting, true);
assert.equal((scheduledPublicState as Record<string, unknown>).activityRunning, false,
  "a due schedule may open requests but must wait for the Host to select Player or Bridge");
assert.equal((scheduledPublicState as Record<string, unknown>).queuePeopleCount, 1,
  "legacy requests without tenant IDs must inherit the active hotel activity during import");
assert.equal((await handleD1HostAction(db, {
  action: "startActivityV4", ...superAuth, hotelId, venueId, activityId
}))?.code, "PLAYBACK_MODE_REQUIRED", "an activity cannot start without a playback mode");
assert.equal((await handleD1HostAction(db, {
  action: "startActivityV4", ...superAuth, hotelId, venueId, activityId, source: "player"
}))?.ok, true, "the Host can explicitly start the internal Player");
const kioskSelected = await handleD1HostAction(db, {
  action: "activityState", ...hostAuth, hotelId, venueId, activityId
});
const firstKioskAccess = kioskSelected?.kioskAccess as Record<string, unknown>;
assert.equal((bridgeSelected?.kioskAccess as Record<string, unknown>)?.accessId, firstKioskAccess.accessId,
  "Superhost Bridge and Host must share the same persistent activity access");
const firstSessionPin = String(firstKioskAccess.pin || "");
const firstJoinToken = String(firstKioskAccess.joinUrl || "").split("/").pop() || "";
assert.match(firstSessionPin, /^\d{6}$/,
  "an activity must expose one exact six-digit PIN to its authorized Host");
const otherActivityAccess = await ensureVenueAccess(db, { hotelId, venueId, activityId: "other-activity", cycleId: "" });
const otherVenueAccess = await ensureVenueAccess(db, { hotelId, venueId: "other-venue", activityId, cycleId: "" });
const otherHotelAccess = await ensureVenueAccess(db, { hotelId: "other-hotel", venueId, activityId, cycleId: "" });
assert.notEqual(otherActivityAccess.pin, firstSessionPin, "another activity in the same venue has another PIN");
assert.notEqual(otherVenueAccess.pin, firstSessionPin, "another venue has another PIN");
assert.notEqual(otherHotelAccess.pin, firstSessionPin, "another hotel has another PIN");
assert.equal((await handleD1HostAction(db, {
  action: "activityState", ...superAuth, hotelId, venueId, activityId
}))?.kioskAccess, null, "Superhost must not receive the operational room PIN");
assert.equal(String(firstKioskAccess.joinUrl).startsWith("https://request.gstarxp.com/join/"), true);
assert.equal((await handleD1PublicPost(db, {
  action: "joinByPin", pin: "000000", guestDeviceId: "wrong-pin-device-123456", _requestFingerprint: "203.0.113.9"
})).code, "INVALID_PIN");
const joinedKiosk = await handleD1PublicPost(db, {
  action: "joinByPin", pin: firstSessionPin,
  guestDeviceId: "kiosk-device-1234567890", _requestFingerprint: "203.0.113.9"
});
assert.equal(joinedKiosk.ok, true);
const firstActivitySessionToken = String(joinedKiosk.activitySessionToken || "");
assert.ok(firstActivitySessionToken.length >= 40);
const chainB = await handleD1PublicPost(db, {
  action: "joinByToken", joinToken: firstJoinToken,
  guestDeviceId: "chain-device-b-1234567890"
});
const chainC = await handleD1PublicPost(db, {
  action: "joinByToken", joinToken: firstJoinToken,
  guestDeviceId: "chain-device-c-1234567890"
});
assert.equal(chainB.ok, true);
assert.equal(chainC.ok, true);
assert.equal((chainB.kioskAccess as Record<string, unknown>).accessId, firstKioskAccess.accessId);
assert.equal((chainC.kioskAccess as Record<string, unknown>).accessId, firstKioskAccess.accessId);
assert.equal((chainB.kioskAccess as Record<string, unknown>).pin, firstSessionPin);
assert.notEqual(chainB.activitySessionToken, firstActivitySessionToken);
assert.notEqual(chainC.activitySessionToken, chainB.activitySessionToken);
assert.equal(String(firstKioskAccess.joinUrl).includes(firstActivitySessionToken), false,
  "the public QR must never contain a guest session");
assert.equal((await handleD1PublicPost(db, {
  action: "resumeSession", activitySessionToken: firstActivitySessionToken,
  guestDeviceId: "kiosk-device-1234567890"
})).ok, true, "a kiosk refresh must resume without asking for its PIN again");
assert.equal((await handleD1PublicPost(db, {
  action: "resumeSession", activitySessionToken: firstActivitySessionToken,
  guestDeviceId: "different-device-1234567890"
})).code, "SESSION_DEVICE_MISMATCH",
"copying localStorage to a different browser identity must not transfer a session");
const savedMessages = await handleD1HostAction(db, {
  action: "updateKioskMessages", ...hostAuth, hotelId, venueId, activityId,
  defaultMessagesEnabled: true,
  customMessages: ["Winner gets a prize!", "Winner gets a prize!", "Sing with us tonight"]
});
assert.deepEqual((savedMessages?.kioskAccess as Record<string, unknown>).customMessages,
  ["Winner gets a prize!", "Sing with us tonight"]);
assert.equal((await handleD1HostAction(db, {
  action: "toggleRequests", ...superAuth, hotelId, venueId, activityId,
  open: false, resetSessionPin: false
}))?.ok, true);
const closedKioskSession = await handleD1PublicPost(db, {
  action: "resumeSession", activitySessionToken: firstActivitySessionToken,
  guestDeviceId: "kiosk-device-1234567890"
});
assert.equal(closedKioskSession.ok, true);
assert.equal(closedKioskSession.accepting, false,
  "requests closed must keep the activity session valid while showing the closed state");
assert.equal((await handleD1HostAction(db, {
  action: "toggleRequests", ...superAuth, hotelId, venueId, activityId, open: true
}))?.ok, true);
const resetPinState = await handleD1HostAction(db, {
  action: "resetSessionPin", ...hostAuth, hotelId, venueId, activityId
});
const secondKioskAccess = resetPinState?.kioskAccess as Record<string, unknown>;
const secondSessionPin = String(secondKioskAccess.pin || "");
assert.match(secondSessionPin, /^\d{6}$/);
assert.notEqual(secondSessionPin, firstSessionPin);
assert.equal((await handleD1PublicPost(db, {
  action: "joinByPin", pin: firstSessionPin, guestDeviceId: "old-pin-device-1234567890"
})).code, "PIN_EXPIRED", "reset must invalidate the old PIN immediately");
assert.equal((await handleD1PublicPost(db, {
  action: "joinByToken", joinToken: firstJoinToken, guestDeviceId: "old-link-device-1234567890"
})).code, "JOIN_LINK_EXPIRED", "reset must invalidate the old QR link immediately");
assert.equal((await handleD1PublicPost(db, {
  action: "resumeSession", activitySessionToken: firstActivitySessionToken,
  guestDeviceId: "kiosk-device-1234567890"
})).code, "SESSION_PIN_CHANGED", "reset must revoke sessions created under the old PIN version");
const sharedNatJoins = await Promise.all(Array.from({length:50},(_,index)=>handleD1PublicPost(db, {
  action:"joinByPin", pin:secondSessionPin,
  guestDeviceId:`hotel-nat-device-${String(index).padStart(4,"0")}-123456`,
  _requestFingerprint:"198.51.100.24"
})));
assert.equal(sharedNatJoins.every(result=>result.ok===true),true,
  "fifty browsers behind one hotel NAT must receive independent activity sessions");
assert.equal(new Set(sharedNatJoins.map(result=>String(result.activitySessionToken))).size,50);
const idleResumeToken=String(sharedNatJoins[0].activitySessionToken);
const idleReadsBefore=Number((db.database.prepare("SELECT total_changes() AS total").get() as Record<string,unknown>).total);
for(let index=0;index<5;index+=1)assert.equal((await handleD1PublicPost(db,{
  action:"resumeSession",activitySessionToken:idleResumeToken,
  guestDeviceId:"hotel-nat-device-0000-123456"
})).ok,true);
const idleReadsAfter=Number((db.database.prepare("SELECT total_changes() AS total").get() as Record<string,unknown>).total);
assert.equal(idleReadsAfter,idleReadsBefore,
  "resuming or idling a valid kiosk session must not create D1 writes");
const publicState = await handleD1PublicGet(db, publicParams);
assert.equal((publicState as Record<string, unknown>).activityRunning, true);
assert.equal((publicState as Record<string, unknown>).playbackMode, "player");
assert.equal((await handleD1HostAction(db, {
  action: "updateActivityLanguages", authToken: hostToken,
  hotelId, venueId, activityId, allowedLanguages: ["es", "en", "hi"]
}))?.ok, true, "the isolated Hindi validation fixture must allow Hindi requests");
const rejectedHindiSong = await handleD1PublicPost(db, {
  publicCode: "moon-palace-public-test-code", guestDeviceId: "hindi-script-device-1234567890",
  name: "Rahul", song: "तुम ही हो", artist: "Arijit Singh",
  language: "हिन्दी", languageCode: "hi", comment: ""
});
assert.equal(rejectedHindiSong.code, "HINDI_LATIN_REQUIRED",
  "a Hindi song title in Devanagari must not reach the Host");
const rejectedHindiArtist = await handleD1PublicPost(db, {
  publicCode: "moon-palace-public-test-code", guestDeviceId: "hindi-artist-device-1234567890",
  name: "Rahul", song: "Tum Hi Ho", artist: "अरिजीत सिंह",
  language: "हिन्दी", languageCode: "hi", comment: ""
});
assert.equal(rejectedHindiArtist.code, "HINDI_LATIN_REQUIRED",
  "a Hindi artist in Devanagari must not reach the Host");
const rejectedHindiParticipant = await handleD1PublicPost(db, {
  publicCode: "moon-palace-public-test-code", guestDeviceId: "hindi-name-device-1234567890",
  name: "राहुल", song: "Tum Hi Ho", artist: "Arijit Singh",
  language: "हिन्दी", languageCode: "hi", comment: ""
});
assert.equal(rejectedHindiParticipant.code, "HINDI_LATIN_REQUIRED",
  "a Hindi participant name in Devanagari must not reach the Host");
const latinHindiRequest = await handleD1PublicPost(db, {
  publicCode: "moon-palace-public-test-code", guestDeviceId: "hindi-latin-device-1234567890",
  name: "Rahul", song: "Tum Hi Ho", artist: "Arijit Singh",
  language: "हिन्दी", languageCode: "hi", comment: "शुभकामनाएँ"
});
assert.equal(latinHindiRequest.ok, true,
  "Hindi requests written with Latin letters must remain valid");
const storedLatinHindiRequest = (await activeRequests(db, hotelId, activityId))
  .find(request=>request.requestId===latinHindiRequest.id);
assert.equal(storedLatinHindiRequest?.singer, "Rahul");
assert.equal(storedLatinHindiRequest?.song, "Tum Hi Ho");
assert.equal(storedLatinHindiRequest?.artist, "Arijit Singh");
const punctuationHindiRequest = await handleD1PublicPost(db, {
  publicCode: "moon-palace-public-test-code", guestDeviceId: "hindi-punctuation-device-1234567890",
  name: "Rahul", song: "Tum Hi Ho - Arijit Singh", artist: "Arijit Singh",
  language: "हिन्दी", languageCode: "hi", comment: ""
});
assert.equal(punctuationHindiRequest.ok, true,
  "Latin text with normal song-title punctuation must remain valid in Hindi");
const numericHindiRequest = await handleD1PublicPost(db, {
  publicCode: "moon-palace-public-test-code", guestDeviceId: "hindi-number-device-1234567890",
  name: "Rahul", song: "295", artist: "Sidhu Moose Wala",
  language: "हिन्दी", languageCode: "hi", comment: ""
});
assert.equal(numericHindiRequest.ok, true,
  "numeric Hindi song titles must remain valid");
const spanishUnchangedRequest = await handleD1PublicPost(db, {
  publicCode: "moon-palace-public-test-code", guestDeviceId: "spanish-script-device-1234567890",
  name: "राहुल", song: "तुम ही हो", artist: "अरिजीत सिंह",
  language: "Español", languageCode: "es", comment: ""
});
assert.equal(spanishUnchangedRequest.ok, true,
  "switching to Spanish must remove the Hindi-only script rule");
const englishUnchangedRequest = await handleD1PublicPost(db, {
  publicCode: "moon-palace-public-test-code", guestDeviceId: "english-script-device-1234567890",
  name: "रवि", song: "अंग्रेज़ी गीत", artist: "अन्य कलाकार",
  language: "English", languageCode: "en", comment: ""
});
assert.equal(englishUnchangedRequest.ok, true,
  "English requests must preserve their original behavior");
const rejectedHindiAgain = await handleD1PublicPost(db, {
  publicCode: "moon-palace-public-test-code", guestDeviceId: "hindi-again-device-1234567890",
  name: "Rahul", song: "तुम ही हो", artist: "Arijit Singh",
  language: "हिन्दी", languageCode: "hi", comment: ""
});
assert.equal(rejectedHindiAgain.code, "HINDI_LATIN_REQUIRED",
  "switching back to Hindi must reactivate the script rule");
for (const requestId of [
  latinHindiRequest.id, punctuationHindiRequest.id, numericHindiRequest.id,
  spanishUnchangedRequest.id, englishUnchangedRequest.id
]) {
  db.database.prepare("DELETE FROM guest_star_requests WHERE request_id = ?")
    .run(String(requestId));
}
const publicRequest = await handleD1PublicPost(db, {
  publicCode: "moon-palace-public-test-code", name: "Guest One", song: "Song One",
  artist: "Artist One", language: "Español", languageCode: "es", comment: ""
});
assert.equal(publicRequest.ok, true);
assert.equal((publicRequest as Record<string, unknown>).queuePeopleCount, 2,
  "an accepted request must return the absolute public count for incremental fanout");
const playerRuntimeUpdate = await handleD1HostAction(db, {
  action: "playerRuntimeUpdate", ...superAuth, hotelId, venueId, activityId,
  queueOrder: [publicRequest.id],
  playback: {
    currentRequestId: publicRequest.id,
    currentTimeSeconds: 83.5,
    scene: "karaoke",
    wasPlaying: true
  }
});
assert.equal(playerRuntimeUpdate?.ok, true);
const resumedOnAnotherLaptop = await handleD1HostAction(db, {
  action: "activityState", ...switchedBridgeAuth, hotelId, venueId, activityId
});
assert.deepEqual(
  (resumedOnAnotherLaptop?.playerRuntime as Record<string, unknown>).queueOrder,
  [publicRequest.id],
  "the Player queue must resume from D1 on another authorized laptop"
);
assert.equal(Number(((resumedOnAnotherLaptop?.playerRuntime as Record<string, unknown>)
  .playback as Record<string, unknown>).currentTimeSeconds), 83.5,
  "the Player position must survive a restart or laptop change");
assert.equal((await handleD1HostAction(db, {
  action: "startActivityV4", ...switchedBridgeAuth, hotelId, venueId, activityId, source: "bridge"
}))?.code, "PLAYBACK_MODE_LOCKED", "a running Player activity cannot switch to Bridge");
const removedFromPlayer = await handleD1HostAction(db, {
  action: "bridgeRequestUpdate", ...switchedBridgeAuth,
  id: publicRequest.id, status: "Retirada del Player"
});
assert.equal(removedFromPlayer?.ok, true, JSON.stringify(removedFromPlayer));
assert.equal(removedFromPlayer?.queuePeopleCount, 1,
  "a queue status change must publish the new count without one public refetch per client");
assert.equal((await activeRequests(db, hotelId, activityId))
  .find((request) => request.requestId === publicRequest.id)?.status, "Retirada del Player",
"a Player removal must survive the next shared-service synchronization");
const beforeMetadata = (await activeRequests(db, hotelId, activityId)).find(item => item.requestId === publicRequest.id)!;
const metadataEdit = await handleD1HostAction(db, {
  action: 'bridgeRequestUpdate', ...switchedBridgeAuth, id: publicRequest.id,
  singer: 'Edited Participant', song: 'Edited Title', artist: 'Edited Artist',
  expectedRevision: beforeMetadata.stateRevision, eventOrigin: 'USER_ACTION'
});
assert.equal(metadataEdit?.ok, true, JSON.stringify(metadataEdit));
const editedMetadata = metadataEdit?.request as Record<string, unknown>;
assert.equal(editedMetadata.name, 'Edited Participant'); assert.equal(editedMetadata.song, 'Edited Title');
assert.equal(editedMetadata.artist, 'Edited Artist'); assert.equal(editedMetadata.id, publicRequest.id);
assert.equal((await handleD1HostAction(db, {
  action: 'bridgeRequestUpdate', ...switchedBridgeAuth, id: publicRequest.id,
  singer: 'Stale Participant', expectedRevision: beforeMetadata.stateRevision
}))?.code, 'REQUEST_REVISION_CONFLICT');
assert.equal((await handleD1HostAction(db, {
  action: 'bridgeRequestUpdate', ...switchedBridgeAuth, id: publicRequest.id, status: 'Ya cantó',
  expectedRevision: editedMetadata.stateRevision, eventOrigin: 'VDJ_EVENT'
}))?.code, 'MANUAL_OUTCOME_PROTECTED');
assert.equal((await handleD1HostAction(db, {
  action: 'bridgeRequestUpdate', ...switchedBridgeAuth, id: publicRequest.id,
  singer: beforeMetadata.singer, song: beforeMetadata.song, artist: beforeMetadata.artist,
  expectedRevision: editedMetadata.stateRevision, eventOrigin: 'USER_ACTION'
}))?.ok, true);
const reorderDb = new TestD1(); await ensureD1Schema(reorderDb);
for (let index = 1; index <= 4; index++) {
  await upsertRequest(reorderDb, { ...beforeMetadata, rowId: `order-${index}`, requestId: `order-${index}`,
    hotelId: 'order-hotel', activityId: 'order-activity', cycleId: 'order-cycle',
    status: 'Pendiente', queuePosition: index, stateRevision: 1, archivedAt: '' });
}
const orderIds = async () => (await activeRequests(reorderDb, 'order-hotel', 'order-activity')).map(item => item.requestId);
assert.ok(await moveActiveRequestBefore(reorderDb, 'order-hotel', 'order-activity', 'order-3', 'order-1', 1, 'order-cycle'));
assert.deepEqual(await orderIds(), ['order-3', 'order-1', 'order-2', 'order-4'], 'new arrival survives identity-based reorder');
assert.equal(await moveActiveRequestBefore(reorderDb, 'order-hotel', 'order-activity', 'order-3', null, 1, 'order-cycle'), null);
assert.equal(await moveActiveRequestBefore(reorderDb, 'order-hotel', 'order-activity', 'order-1', 'gone-target', 2, 'order-cycle'), null);
assert.ok(await moveActiveRequestBefore(reorderDb, 'order-hotel', 'order-activity', 'order-3', null, 2, 'order-cycle'));
assert.deepEqual(await orderIds(), ['order-1', 'order-2', 'order-4', 'order-3']);
assert.ok(await updateActiveRequest(reorderDb, 'order-hotel', 'order-1', { status: 'Saltado', stateRevision: 4 }, 3));
assert.equal(await updateActiveRequest(reorderDb, 'order-hotel', 'order-1', { status: 'Ya cantó', stateRevision: 4 }, 3), null,
  'stale Played cannot overwrite manual Skip');
assert.equal(await updateActiveRequest(reorderDb, 'order-hotel', 'order-1', { remainingSeconds: 10 }, 3), null,
  'stale timeline recalculation cannot overwrite newer manual state');
const firstAlex = await handleD1PublicPost(db, {
  publicCode: "moon-palace-public-test-code", guestDeviceId: "device-alex-a-1234567890",
  name: "Alex", song: "Valió la pena", artist: "Marc Anthony",
  language: "Español", languageCode: "es", comment: ""
});
assert.equal(firstAlex.ok, true);
const repeatedAlex = await handleD1PublicPost(db, {
  publicCode: "moon-palace-public-test-code", guestDeviceId: "device-alex-a-1234567890",
  name: "Alex", song: "Marc Anthony", artist: "Valió la pena",
  language: "Español", languageCode: "es", comment: ""
});
assert.equal(repeatedAlex.ok, true);
assert.equal(repeatedAlex.deduplicated, true,
  "the same device must not create a second request when title and artist are inverted");
assert.equal(repeatedAlex.id, firstAlex.id);
const secondAlex = await handleD1PublicPost(db, {
  publicCode: "moon-palace-public-test-code", guestDeviceId: "device-alex-b-0987654321",
  name: "Alex", song: "Vivir mi vida", artist: "Marc Anthony",
  language: "Español", languageCode: "es", comment: ""
});
assert.equal(secondAlex.ok, true);
const alexRequests = (await activeRequests(db, hotelId, activityId))
  .filter((request) => request.singer === "Alex");
assert.equal(alexRequests.length, 2,
  "an idempotent retry must stay single while a second Alex on another device remains distinct");
assert.notEqual(alexRequests[0].sourceType, alexRequests[1].sourceType,
  "different guest devices must receive different anonymous identities");
const burstStartedAt = performance.now();
const burstResults = await Promise.all(
  Array.from({ length: 200 }, (_, index) => handleD1PublicPost(db, {
    publicCode: "moon-palace-public-test-code",
    guestDeviceId: `burst-device-${String(index).padStart(6, "0")}`,
    name: `Burst Guest ${index + 1}`,
    song: `Burst Song ${index + 1}`,
    artist: `Burst Artist ${index + 1}`,
    language: "Español",
    languageCode: "es",
    comment: ""
  }))
);
const burst200Ms = performance.now() - burstStartedAt;
assert.equal(burstResults.filter((result) => result.ok === true).length, 200,
  "two hundred independent guests must be accepted in one simultaneous burst");
const burstRows = (await activeRequests(db, hotelId, activityId))
  .filter((request) => request.singer.startsWith("Burst Guest "));
assert.equal(burstRows.length, 200,
  "a simultaneous burst must not lose or merge requests from different devices");
assert.equal(new Set(burstRows.map((request) => request.queuePosition)).size, 200,
  "every simultaneous guest must receive one stable queue position");
const bridgeAfterBurst = await handleD1HostAction(db, {
  action: "activityState", ...switchedBridgeAuth, hotelId, venueId, activityId
});
const bridgeBurstRows = Array.isArray(bridgeAfterBurst?.requests)
  ? bridgeAfterBurst.requests.filter((request) => String(request.name || "").startsWith("Burst Guest "))
  : [];
assert.equal(bridgeBurstRows.length, 200,
  "the same two hundred public requests must be immediately visible to Player and Bridge activityState");
const sameDeviceResults = [];
for (let index = 0; index < 9; index += 1) {
  sameDeviceResults.push(await handleD1PublicPost(db, {
    publicCode: "moon-palace-public-test-code",
    guestDeviceId: "same-device-rate-limit-1234567890",
    name: "Rate Test Guest",
    song: `Rate Test Song ${index + 1}`,
    artist: `Rate Test Artist ${index + 1}`,
    language: "Español",
    languageCode: "es",
    confirmDuplicate: true,
    comment: ""
  }));
}
assert.equal(sameDeviceResults.slice(0, 8).every((result) => result.ok === true), true,
  "one device must be able to complete eight distinct requests per minute");
assert.equal(sameDeviceResults[8].code, "RATE_LIMITED",
  "the ninth completed request from one device in a minute must be rate-limited");
assert.equal((await handleD1HostAction(db, {
  action: "finishActivityV4", ...superAuth, hotelId, venueId, activityId, source: "web"
}))?.ok, true);
assert.equal((await handleD1PublicPost(db, {
  action:"resumeSession",activitySessionToken:idleResumeToken,
  guestDeviceId:"hotel-nat-device-0000-123456"
})).ok,true,
"finishing an occurrence preserves device access");
assert.equal((await handleD1PublicPost(db, {
  action:"joinByPin",pin:secondSessionPin,guestDeviceId:"ended-pin-device-1234567890"
})).ok,true,
"a finished occurrence retains its public activity PIN");
assert.equal((await handleD1HostAction(db, {
  action: "startActivityV4", ...superAuth, hotelId, venueId, activityId, source: "player"
}))?.ok, true, "restarting the same configured activity must create a fresh cycle");
const restartedRoomState = await handleD1HostAction(db, {
  action: "activityState", ...hostAuth, hotelId, venueId, activityId
});
assert.equal(String((restartedRoomState?.kioskAccess as Record<string, unknown>).pin), secondSessionPin,
  "starting a new occurrence of the same hotel/activity/venue must preserve its PIN");
assert.equal((await handleD1PublicPost(db, {
  action: "joinByPin", pin: secondSessionPin,
  guestDeviceId: "same-room-new-activity-123456"
})).ok, true, "the room PIN must join the new active activity in the same venue");
const repeatedInFreshCycle = await handleD1PublicPost(db, {
  publicCode: "moon-palace-public-test-code", guestDeviceId: "device-alex-a-1234567890",
  name: "Alex", song: "Valió la pena", artist: "Marc Anthony",
  language: "Español", languageCode: "es", comment: ""
});
assert.equal(repeatedInFreshCycle.ok, true);
assert.notEqual(repeatedInFreshCycle.deduplicated, true,
  "a singer or song from a finished cycle must never trigger a duplicate in the new activity cycle");
assert.equal((await handleD1HostAction(db, {
  action: "startNewActivityV4", ...superAuth, hotelId, venueId, activityId, source: "bridge"
}))?.code, "ACTIVITY_ALREADY_RUNNING",
"a Host must finish the current activity before replacing it with a new cycle");
const finishedWithoutReset = await handleD1HostAction(db, {
  action: "finishActivityV4", ...hostAuth, hotelId, venueId, activityId,
  source: "player", resetSessionPin: true
});
assert.equal(finishedWithoutReset?.ok, true);
const retainedPin = String((finishedWithoutReset?.kioskAccess as Record<string, unknown>).pin);
assert.equal(retainedPin, secondSessionPin,
  "Finish must preserve the activity PIN even when an old client sends resetSessionPin");
assert.equal((await handleD1PublicPost(db, {
  action: "joinByPin", pin: secondSessionPin, guestDeviceId: "finish-reset-old-pin-123456"
})).ok, true, "Finish must keep the public join access available");
assert.equal((await handleD1HostAction(db, {
  action: "startNewActivityV4", ...superAuth, hotelId, venueId, activityId, source: "bridge"
}))?.ok, true, "after finishing, a new cycle may explicitly choose Bridge");
assert.equal(String(((await handleD1HostAction(db, {
  action: "activityState", ...hostAuth, hotelId, venueId, activityId
}))?.kioskAccess as Record<string, unknown>).pin), retainedPin,
"starting the next cycle must retain the persistent activity PIN");

assert.equal((await handleD1HostAction(db, {
  action: "updateHotelBranding", ...superAuth, hotelId,
  branding: { showRemindMe: true, showInternalRating: true }
}))?.ok, true);
const reminder = await handleD1PublicPost(db, {
  action: "createGuestReminder", publicCode: "moon-palace-public-test-code",
  guestEmail: "guest@example.com", consent: true
});
assert.equal(reminder.ok, true);
assert.equal((await handleD1PublicPost(db, {
  action: "unsubscribeGuest", publicCode: "moon-palace-public-test-code",
  recordId: reminder.recordId, token: "wrong-token"
})).code, "INVALID_UNSUBSCRIBE_TOKEN");
assert.equal((await handleD1PublicPost(db, {
  action: "unsubscribeGuest", publicCode: "moon-palace-public-test-code",
  recordId: reminder.recordId, token: reminder.token
})).ok, true);

const submittedReview = await handleD1PublicPost(db, {
  action: "submitReview", publicCode: "moon-palace-public-test-code", rating: 5,
  guestName: "Guest One", comment: "Excellent", activityId: "forged-activity",
  venueId: "forged-venue", cycleId: "forged-cycle"
});
assert.equal(submittedReview.ok, true);
const storedReview = (await listRecords(db, "Reviews", hotelId))[0];
assert.equal(storedReview.activityId, activityId, "public reviews must be clamped to the active tenant activity");
assert.equal(storedReview.venueId, venueId, "public reviews must not accept forged venue IDs");

const replacement = "Host-Replaced-Password-2026";
assert.equal((await handleD1HostAction(db, {
  action: "setHostPassword", ...superAuth, userId: hostId, password: replacement
}))?.ok, true);
assert.equal((await handleD1HostAction(db, { action: "me", authToken: hostToken }))?.code, "UNAUTHORIZED");
assert.equal((await handleD1HostAction(db, {
  action: "login", username: "host.one", password: replacement,
  clientType: "web", rememberLogin: true
}))?.ok, true);

const secondHotel = await handleD1HostAction(db, {
  action: "createHotel", ...superAuth, name: "Other Hotel", timezone: "America/Santo_Domingo"
});
assert.equal(secondHotel?.ok, true);
const otherHotelId = String((secondHotel?.hotel as Record<string, unknown>).hotelId);
assert.equal(String((secondHotel?.venue as Record<string, unknown>).hotelId), otherHotelId,
  "new D1 hotels must include their default venue");
assert.deepEqual((secondHotel?.activity as Record<string, unknown>).allowedLanguages, ["es", "en", "fr", "it", "de", "ru", "pt", "hi"],
  "new D1 hotels must include the full language catalog");
assert.equal(String((secondHotel?.assignment as Record<string, unknown>).userId), "superhost-1",
  "new D1 hotels must assign the Superhost automatically");
const editableActivity = secondHotel?.activity as Record<string, unknown>;
const editableActivityId = String(editableActivity.activityId);
const editableVenueId = String((secondHotel?.venue as Record<string, unknown>).venueId);
assert.equal((await handleD1HostAction(db, {
  action: "startActivityV4", ...superAuth, hotelId: otherHotelId,
  venueId: editableVenueId, activityId: editableActivityId, source: "bridge"
}))?.ok, true);
assert.equal((await handleD1HostAction(db, {
  action: "setDefaultPublicExperience", ...superAuth, enabled: true,
  hotelId: otherHotelId, venueId: editableVenueId, activityId: editableActivityId
}))?.code, "DEFAULT_PUBLIC_EXPERIENCE_DISABLED");
const rootAdminState = await handleD1HostAction(db, { action: "adminState", ...superAuth });
assert.deepEqual(rootAdminState?.defaultPublicExperience, {
  disabled: true, configured: false, available: false
});
const rootPublicState = await handleD1PublicGet(db, new URLSearchParams({
  action: "publicBootstrap", hotel: "default"
})) as Record<string, unknown>;
assert.equal(rootPublicState.code, "PUBLIC_LINK_NOT_FOUND",
  "request.gstarxp.com without a PIN session must not resolve a default activity");
const otherHotelIdentifier = String((secondHotel?.hotel as Record<string, unknown>).publicUrl);
const permanentOtherState = await handleD1PublicGet(db, new URLSearchParams({
  action: "publicBootstrap", hotel: otherHotelIdentifier
})) as Record<string, unknown>;
assert.equal((permanentOtherState.activity as Record<string, unknown>).activityId, editableActivityId,
  "permanent hotel links must remain independent from the root-domain override");
assert.equal(permanentOtherState.accepting, true);
const fallbackFormUrl = "https://docs.google.com/forms/d/e/1FAIpQLGuestStarFallback/viewform";
assert.equal((await handleD1HostAction(db, {
  action: "setDefaultGoogleFallback", ...superAuth, enabled: true,
  formUrl: fallbackFormUrl, userId: "superhost-1",
  hotelId: otherHotelId, venueId: editableVenueId, activityId: editableActivityId
}))?.code, "GOOGLE_REQUEST_BACKUP_DISABLED");
const fallbackRootState = await handleD1PublicGet(db, new URLSearchParams({
  action: "publicBootstrap", hotel: "default"
})) as Record<string, unknown>;
assert.equal(fallbackRootState.googleFallback, undefined,
  "request.gstarxp.com must never expose Google Forms as its live request path");
assert.equal(fallbackRootState.code, "PUBLIC_LINK_NOT_FOUND",
  "request.gstarxp.com must remain PIN-only after rejected fallback configuration");
assert.equal((await handleD1PublicPost(db, {
  publicCode: "default", name: "Fallback Guest", song: "Song", artist: "Artist", language: "English"
})).code, "PUBLIC_LINK_NOT_FOUND");
const permanentDuringFallback = await handleD1PublicGet(db, new URLSearchParams({
  action: "publicBootstrap", hotel: otherHotelIdentifier
})) as Record<string, unknown>;
assert.equal(permanentDuringFallback.googleFallback, undefined,
  "permanent hotel URLs must remain D1-only");
assert.equal((await handleD1HostAction(db, {
  action: "finishActivityV4", ...superAuth, hotelId: otherHotelId,
  venueId: editableVenueId, activityId: editableActivityId, source: "web"
}))?.ok, true);
assert.equal((await handleD1HostAction(db, {
  action: "updateVenue", ...superAuth, venueId: editableVenueId, status: "inactive"
}))?.code, "VENUE_HAS_ACTIVE_ACTIVITIES",
"venues with active activities must not disappear from Host selection");
const createdManagedVenue = await handleD1HostAction(db, {
  action: "createVenue", ...superAuth, hotelId: otherHotelId, name: "Wet Deck"
});
assert.equal(createdManagedVenue?.ok, true);
const managedVenueId = String((createdManagedVenue?.venue as Record<string, unknown>).venueId);
const renamedVenue = await handleD1HostAction(db, {
  action: "updateVenue", ...superAuth, venueId: managedVenueId, name: "Unique Day Club"
});
assert.equal((renamedVenue?.venue as Record<string, unknown>).name, "Unique Day Club");
assert.equal((await handleD1HostAction(db, {
  action: "updateVenue", ...superAuth, venueId: managedVenueId, status: "inactive"
}))?.ok, true);
const selectionWithoutDeletedVenue = (await handleD1HostAction(db, {
  action: "me", ...superAuth
}))?.selection as { venues: Array<Record<string, unknown>> };
assert.equal(selectionWithoutDeletedVenue.venues.some((venue) => venue.venueId === managedVenueId), false,
  "deleted venues must leave the operational selector immediately");
assert.equal((await handleD1HostAction(db, {
  action: "updateVenue", ...superAuth, venueId: managedVenueId, status: "active"
}))?.ok, true, "deleted venues must remain recoverable");
const renamedActivity = await handleD1HostAction(db, {
  action: "updateActivity", ...superAuth, activityId: editableActivityId,
  name: "International Karaoke", defaultDurationSeconds: 5400, defaultTransitionSeconds: 45
});
assert.equal((renamedActivity?.activity as Record<string, unknown>).name, "International Karaoke");
assert.equal((renamedActivity?.activity as Record<string, unknown>).defaultDurationSeconds, 5400);
const recurringSchedule = await handleD1HostAction(db, {
  action: "scheduleActivity", ...superAuth, hotelId: otherHotelId,
  venueId: editableVenueId, activityId: editableActivityId,
  scheduledStartAt: "2026-08-19T20:00:00.000Z", durationSeconds: 5400,
  recurrenceType: "biweekly", recurrenceDays: [1, 3], autoOpenRequests: false,
  autoStartActivity: false, showCountdown: true
});
const recurringRecord = recurringSchedule?.schedule as Record<string, unknown>;
assert.equal(recurringRecord.recurrenceType, "weekly");
assert.equal(recurringRecord.recurrenceInterval, 2);
assert.deepEqual(JSON.parse(String(recurringRecord.recurrenceDaysJson)), [1, 3]);
assert.equal(recurringRecord.recurrenceDayOfMonth, 19);
assert.equal(nextScheduleOccurrence({
  scheduledStartAt: "2026-08-19T20:00:00.000Z", recurrenceType: "weekly",
  recurrenceInterval: 2, recurrenceDaysJson: JSON.stringify([1, 3])
}, "UTC"), "2026-08-31T20:00:00.000Z", "biweekly recurrence must skip the intervening week");
assert.equal(nextScheduleOccurrence({
  scheduledStartAt: "2027-01-31T20:00:00.000Z", recurrenceType: "monthly",
  recurrenceInterval: 1, recurrenceDaysJson: "[]", recurrenceDayOfMonth: 31
}, "UTC"), "2027-02-28T20:00:00.000Z", "monthly recurrence must clamp safely to month end");
assert.equal(nextScheduleOccurrence({
  scheduledStartAt: "2027-02-28T20:00:00.000Z", recurrenceType: "monthly",
  recurrenceInterval: 1, recurrenceDaysJson: "[]", recurrenceDayOfMonth: 31
}, "UTC"), "2027-03-31T20:00:00.000Z", "monthly recurrence must retain its original calendar day");
const weekdayAnnouncements = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday, time: "22:30", title: weekday === 2 ? "Rock Band" : weekday === 5 ? "Jazz" : "Hotel Show",
  message: "Continúa la noche en el Lobby Bar."
}));
const liveRecurringSchedule = await handleD1HostAction(db, {
  action: "scheduleActivity", ...superAuth, hotelId: otherHotelId,
  venueId: editableVenueId, activityId: editableActivityId,
  scheduledStartAt: new Date(Date.now() - 1000).toISOString(), durationSeconds: 3600,
  recurrenceType: "weekly", recurrenceDays: [0, 1, 2, 3, 4, 5, 6],
  weekdayAnnouncements, autoOpenRequests: false, showCountdown: true
});
assert.equal(liveRecurringSchedule?.ok, true);
const liveScheduleRecord = liveRecurringSchedule?.schedule as Record<string, unknown>;
assert.equal(String(liveScheduleRecord.status), "active", "a weekly series must advance instead of completing");
assert.ok(Date.parse(String(liveScheduleRecord.scheduledStartAt)) > Date.now(),
  "a weekly series must keep its next occurrence in the future");
assert.equal((await handleD1HostAction(db, {
  action: "startActivityV4", ...superAuth, hotelId: otherHotelId,
  venueId: editableVenueId, activityId: editableActivityId, source: "player"
}))?.ok, true);
assert.equal((await handleD1HostAction(db, {
  action: "finishActivityV4", ...superAuth, hotelId: otherHotelId,
  venueId: editableVenueId, activityId: editableActivityId, source: "player"
}))?.ok, true);
const announcementState = await handleD1PublicGet(db, new URLSearchParams({
  action: "publicBootstrap", hotel: otherHotelIdentifier
})) as Record<string, unknown>;
const postAnnouncement = announcementState.postActivityAnnouncement as Record<string, unknown>;
assert.ok(postAnnouncement, "finishing a scheduled activity must expose its day-specific announcement");
assert.equal(String(postAnnouncement.message), "Continúa la noche en el Lobby Bar.");
assert.ok(Date.parse(String(postAnnouncement.nextGuestStarAt)) > Date.now(),
  "the finished page must announce when Guest Star repeats at the hotel");
const updatedLiveSchedule = await handleD1HostAction(db, {
  action: "updateSchedule", ...superAuth, scheduleId: String(liveScheduleRecord.scheduleId),
  recurrenceType: "weekly", scheduledTime: "20:00", recurrenceDays: [2, 5],
  durationSeconds: 7200, requestOpeningLeadSeconds: 3600,
  weekdayAnnouncements: [
    { weekday: 2, time: "22:30", title: "Rock Band", message: "Rock después del karaoke." },
    { weekday: 5, time: "22:30", title: "Jazz", message: "Jazz después del karaoke." }
  ], autoOpenRequests: true, showCountdown: true
});
assert.equal(updatedLiveSchedule?.ok, true);
assert.equal(String((updatedLiveSchedule?.schedule as Record<string, unknown>).scheduleId), String(liveScheduleRecord.scheduleId),
  "editing a recurring series must preserve its identity");
assert.deepEqual(JSON.parse(String((updatedLiveSchedule?.schedule as Record<string, unknown>).recurrenceDaysJson)), [2, 5]);
assert.deepEqual(JSON.parse(String((updatedLiveSchedule?.schedule as Record<string, unknown>).weekdayAnnouncementsJson)).map(
  (item: Record<string, unknown>) => item.title
), ["Rock Band", "Jazz"], "Tuesday and Friday must retain independent announcements");
assert.equal((await handleD1HostAction(db, {
  action: "updateActivity", ...superAuth, activityId: editableActivityId, status: "inactive"
}))?.ok, true);
assert.equal(String((await listRecords(db, "ActivitySchedules")).find(
  (schedule) => schedule.scheduleId === recurringRecord.scheduleId
)?.status), "cancelled", "deleting an activity must cancel its active schedule");
assert.equal((await handleD1HostAction(db, {
  action: "updateActivity", ...superAuth, activityId: editableActivityId, status: "ready"
}))?.ok, true, "deleted activities must remain recoverable");
const forbidden = await handleD1HostAction(db, {
  action: "selectActivity", authToken: String((await handleD1HostAction(db, {
    action: "login", username: "host.one", password: replacement, clientType: "web", rememberLogin: true
  }))?.authToken), hotelId: otherHotelId, venueId: "", activityId: ""
});
assert.equal(forbidden?.code, "FORBIDDEN");

const outbox = await listRecords(db, "Users");
assert.equal(outbox.length, 3);
const serializedOutbox = JSON.stringify(
  db.database.prepare("SELECT action, payload_json FROM guest_star_outbox").all()
);
assert.equal(serializedOutbox, "[]",
  "live D1 mutations must not create Google Sheets backup work");
assert.equal(serializedOutbox.includes(hostPassword), false, "plaintext passwords must never enter backup events");
assert.equal(serializedOutbox.includes(replacement), false, "replacement passwords must never enter backup events");
assert.equal(serializedOutbox.includes(String(bridgeLogin?.deviceToken)), false, "Bridge tokens must never enter backup events");
assert.equal(serializedOutbox.includes("deviceTokenHash"), false, "Bridge token hashes must stay out of Sheets backup events");

const performanceStartedAt = performance.now();
const sessionLatencies: number[] = [];
for (let index = 0; index < 100; index += 1) {
  const startedAt = performance.now();
  assert.equal((await handleD1HostAction(db, { action: "me", ...superAuth }))?.ok, true);
  sessionLatencies.push(performance.now() - startedAt);
}
assert.ok(performance.now() - performanceStartedAt < 1000, "100 local D1 session reads should finish within one second");
sessionLatencies.sort((left, right) => left - right);
const sessionP95 = sessionLatencies[Math.floor(sessionLatencies.length * 0.95)];
assert.ok(sessionP95 < 20, `local D1 session p95 should stay under 20 ms; received ${sessionP95.toFixed(2)} ms`);

const separator = "\n\n<<<94721001>>>\n\n";
const translated = await prepareBrandingLocalization({
  messageSourceLanguage: "en", translationMode: "auto",
  welcomeMessage: "Welcome {hotel_name}", inProgressTitle: "Live now"
}, {
  async run(_model, input) {
    assert.equal(input.text.includes("{hotel_name}"), false,
      "placeholders must be protected before automatic translation");
    return {
      translated_text: input.text.split(separator)
        .map((message) => `${input.target_lang}:${message}`).join(separator)
    };
  }
});
assert.equal(translated.branding.translationStatus, "automatic");
const translatedMessages = parseLocalizedMessages(translated.branding.localizedMessagesJson);
assert.equal(translatedMessages.fr.welcomeMessage, "fr:Welcome {hotel_name}");
assert.equal(translatedMessages.pt.inProgressTitle, "pt:Live now");
const manualTranslation = await prepareBrandingLocalization({
  messageSourceLanguage: "es", translationMode: "manual", welcomeMessage: "Bienvenidos",
  localizedMessagesJson: { en: { welcomeMessage: "Welcome" }, fr: { welcomeMessage: "Bienvenue" } }
}, null);
assert.equal(manualTranslation.branding.translationStatus, "manual");
assert.equal(parseLocalizedMessages(manualTranslation.branding.localizedMessagesJson).es.welcomeMessage, "Bienvenidos");
const oversizedManualInput = Object.fromEntries(GUEST_LANGUAGE_CODES.map((code) => [
  code,
  Object.fromEntries(BRANDING_MESSAGE_FIELDS.map((field) => [field, "x".repeat(1_000)]))
]));
const boundedManualTranslation = await prepareBrandingLocalization({
  messageSourceLanguage: "en", translationMode: "manual",
  localizedMessagesJson: oversizedManualInput
}, null);
const boundedManualJson = String(boundedManualTranslation.branding.localizedMessagesJson);
assert.ok(boundedManualJson.length < 49_000, "manual translations must keep a bounded D1 payload");
assert.equal(parseLocalizedMessages(boundedManualJson).fr.welcomeMessage.length, 300);
const unavailableTranslation = await prepareBrandingLocalization({
  messageSourceLanguage: "en", translationMode: "auto", welcomeMessage: "Welcome",
  localizedMessagesJson: { es: { welcomeMessage: "Conservar" } }
}, null);
assert.equal(unavailableTranslation.branding.translationStatus, "manual_required");
assert.equal("localizedMessagesJson" in unavailableTranslation.branding, false,
  "free-quota failure must omit the field so stored manual translations are preserved");

await assert.rejects(
  () => setD1BackendMode(db, "apps_script"),
  /D1_ONLY_MODE/,
  "the live backend must never be switched back to Apps Script"
);
health = await d1Health(db);
assert.equal(health.mode, "d1_primary");

console.log("D1 backend tests passed", {
  users: health.counts.users,
  publicRequestId: publicRequest.id,
  burst200Ms: Number(burst200Ms.toFixed(1)),
  sessionP95Ms: Number(sessionP95.toFixed(3))
});
