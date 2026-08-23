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
  reserveDailyFreeTranslationBudget
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
const appsScriptSource = readFileSync("google-apps-script/Code.gs", "utf8");
const upstreamSource = readFileSync("lib/guest-star/upstream.ts", "utf8");
const bridgeServerSource = readFileSync("guest-star-bridge/src/server.mjs", "utf8");
assert.match(rootPageSource, /isHostPanelHostname\(hostname\)/,
  "the production host domain root must render the Host Panel");
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
assert.match(hostPanelSource, /Default experience for request\.gstarxp\.com/,
  "Superhost must be able to choose the optional root-domain experience");
assert.match(hostPanelSource, /action:"setDefaultPublicExperience"/,
  "the root-domain selection must be saved through the authenticated Host API");
assert.match(hostPanelSource, /Google Form and Sheet Backup/,
  "Host Panel must expose the reusable Google operational backup");
assert.match(hostPanelSource, /action:"setDefaultGoogleFallback"/,
  "Superhost must be able to assign or remove the Google fallback at the root domain");
assert.match(hostRouteSource, /getRecord\(db!, "GlobalSettings", "defaultGoogleFallback"\)/,
  "the Host Panel must report the live D1 root fallback instead of a stale Sheets mirror");
assert.match(publicExperienceSource, /googleFallbackCard/,
  "the root Google fallback must remain inside a branded Guest Star handoff");
assert.match(appsScriptSource, /FormApp\.DestinationType\.SPREADSHEET/,
  "the reusable Google Form must store responses in its linked Sheet");
assert.match(appsScriptSource, /resetGoogleFallbackForArchiveV43_/,
  "archiving or starting a new activity must reset the operational Google backup automatically");
assert.match(appsScriptSource, /https:\/\/www\.googleapis\.com\/auth\/forms/,
  "Apps Script must request the Forms scope explicitly");
assert.match(bridgeServerSource, /"setDefaultPublicExperience"/,
  "the local Bridge Superhost proxy must allow the root-domain setting");
assert.match(bridgeServerSource, /"setDefaultGoogleFallback"/,
  "the local Bridge Superhost proxy must preserve the root Google fallback setting");
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
assert.doesNotMatch(hostRouteSource, /!\["me", "adminState"\]\.includes\(action\)/,
  "opening the panel must also trigger a non-blocking automatic backup");
assert.match(upstreamSource, /flushD1BackupFully\(db, 4\)/,
  "background backup must drain multiple batches without requiring a user button");

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
assert.equal(health.mode, "apps_script");
assert.equal(health.migrationStatus, "ready");
assert.equal(health.counts.users, 1);
assert.equal(health.counts.requests, 1);
await setD1BackendMode(db, "d1_primary");
assert.equal(await backendMode(db), "d1_primary");

const googleBridgeLogin = await loginD1WithVerifiedGoogle(db, verifiedGoogle.email, {
  clientType: "bridge", deviceName: "Google Test Bridge", bridgeVersion: "4.3.0",
  rememberLogin: true
}) as Record<string, unknown>;
assert.equal(googleBridgeLogin?.ok, true,
  "a verified Google address registered to an active Guest Star user must create a Bridge session");
assert.ok(String(googleBridgeLogin?.authToken || "").length >= 40);
assert.ok(String(googleBridgeLogin?.deviceToken || "").length >= 40);
assert.equal(((await loginD1WithVerifiedGoogle(db, "unknown@example.com", {
  clientType: "bridge", deviceName: "Unknown Bridge", bridgeVersion: "4.3.0"
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
assert.equal((await handleD1HostAction(db, {
  action: "selectActivity", ...bridgeAuth, hotelId, venueId, activityId, source: "bridge"
}))?.ok, true);
assert.equal((await handleD1HostAction(db, {
  action: "bridgeHeartbeat", ...bridgeAuth, virtualDJConnected: true, bridgeVersion: "4.2.0"
}))?.ok, true);
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
  "Fuera de VirtualDJ", "a complete VDJ snapshot must retire stale external rows after a restart");
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
  permissions: { canChangeSchedule: true, canStartActivity: true, canOpenCloseRequests: true }
}))?.ok, true);

const hostLogin = await handleD1HostAction(db, {
  action: "login", username: "host.one", password: hostPassword,
  clientType: "web", rememberLogin: true
});
assert.equal(hostLogin?.ok, true);
const hostToken = String(hostLogin?.authToken);
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
assert.equal((await handleD1PublicGet(db, publicParams) as Record<string, unknown>).accepting, false,
  "future schedules must stay closed until requestOpeningAt");
assert.equal((await handleD1HostAction(db, {
  action: "cancelSchedule", ...superAuth,
  scheduleId: String((futureSchedule?.schedule as Record<string, unknown>).scheduleId)
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
assert.equal((await handleD1HostAction(db, {
  action: "activityState", ...superAuth, hotelId, venueId, activityId
}))?.ok, true, "due schedules must be processed by Host/Bridge state reads");

const publicState = await handleD1PublicGet(db, publicParams);
assert.equal(publicState.ok, true);
assert.equal((publicState as Record<string, unknown>).accepting, true);
assert.equal((publicState as Record<string, unknown>).activityRunning, true,
  "due schedules must auto-start the activity exactly once");
assert.equal((publicState as Record<string, unknown>).queuePeopleCount, 1,
  "legacy requests without tenant IDs must inherit the active hotel activity during import");
const publicRequest = await handleD1PublicPost(db, {
  publicCode: "moon-palace-public-test-code", name: "Guest One", song: "Song One",
  artist: "Artist One", language: "Español", languageCode: "es", comment: ""
});
assert.equal(publicRequest.ok, true);
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
assert.equal((await handleD1HostAction(db, {
  action: "startNewActivityV4", ...superAuth, hotelId, venueId, activityId, source: "web"
}))?.ok, true, "starting a new cycle must archive the previous D1 queue");

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
assert.deepEqual((secondHotel?.activity as Record<string, unknown>).allowedLanguages, ["es", "en", "fr", "it", "de", "ru", "pt"],
  "new D1 hotels must include the full language catalog");
assert.equal(String((secondHotel?.assignment as Record<string, unknown>).userId), "superhost-1",
  "new D1 hotels must assign the Superhost automatically");
const editableActivity = secondHotel?.activity as Record<string, unknown>;
const editableActivityId = String(editableActivity.activityId);
const editableVenueId = String((secondHotel?.venue as Record<string, unknown>).venueId);
const rootOnlyActivity = await handleD1HostAction(db, {
  action: "createActivity", ...superAuth, hotelId: otherHotelId, venueId: editableVenueId,
  name: "Root Domain Event", defaultDurationSeconds: 5400, defaultTransitionSeconds: 30,
  allowedLanguages: ["es", "en"]
});
const rootOnlyActivityId = String((rootOnlyActivity?.activity as Record<string, unknown>).activityId);
assert.equal((await handleD1HostAction(db, {
  action: "startActivityV4", ...superAuth, hotelId: otherHotelId,
  venueId: editableVenueId, activityId: editableActivityId, source: "web"
}))?.ok, true);
assert.equal((await handleD1HostAction(db, {
  action: "setDefaultPublicExperience", ...superAuth, enabled: true,
  hotelId: otherHotelId, venueId: editableVenueId, activityId: rootOnlyActivityId
}))?.ok, true);
const rootAdminState = await handleD1HostAction(db, { action: "adminState", ...superAuth });
assert.deepEqual(rootAdminState?.defaultPublicExperience, {
  configured: true, available: true, hotelId: otherHotelId,
  venueId: editableVenueId, activityId: rootOnlyActivityId,
  updatedAt: String((rootAdminState?.defaultPublicExperience as Record<string, unknown>).updatedAt)
});
const rootPublicState = await handleD1PublicGet(db, new URLSearchParams({
  action: "publicBootstrap", hotel: "default"
})) as Record<string, unknown>;
assert.equal((rootPublicState.activity as Record<string, unknown>).activityId, rootOnlyActivityId,
  "request.gstarxp.com must use the exact Superhost-selected activity");
assert.equal(rootPublicState.accepting, false,
  "the selected root activity must keep its own request status instead of borrowing the hotel's active activity");
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
  hotelId: otherHotelId, venueId: editableVenueId, activityId: rootOnlyActivityId
}))?.ok, true);
const fallbackRootState = await handleD1PublicGet(db, new URLSearchParams({
  action: "publicBootstrap", hotel: "default"
})) as Record<string, unknown>;
assert.equal((fallbackRootState.googleFallback as Record<string, unknown>).formUrl, fallbackFormUrl,
  "request.gstarxp.com must expose only the explicitly assigned Google Form");
assert.equal((fallbackRootState.activity as Record<string, unknown>).activityId, rootOnlyActivityId,
  "the Google fallback must carry the exact Superhost-selected activity branding");
assert.equal(fallbackRootState.accepting, false,
  "Guest Star submissions must close while the root Google fallback is enabled");
assert.equal((await handleD1PublicPost(db, {
  publicCode: "default", name: "Fallback Guest", song: "Song", artist: "Artist", language: "English"
})).code, "GOOGLE_FALLBACK_ACTIVE");
const permanentDuringFallback = await handleD1PublicGet(db, new URLSearchParams({
  action: "publicBootstrap", hotel: otherHotelIdentifier
})) as Record<string, unknown>;
assert.equal(permanentDuringFallback.googleFallback, undefined,
  "permanent hotel URLs must never inherit the optional root Google fallback");
assert.equal((await handleD1HostAction(db, {
  action: "setDefaultGoogleFallback", ...superAuth, enabled: false
}))?.ok, true, "the Google root fallback must be removable immediately");
assert.equal((await handleD1HostAction(db, {
  action: "setDefaultPublicExperience", ...superAuth, enabled: false
}))?.ok, true, "the optional root-domain override must be removable");
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
assert.equal(serializedOutbox.includes('"action":"requests.archive"'), true,
  "start-new must replicate queue archival to the Sheets standby");
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
assert.ok(boundedManualJson.length < 49_000, "all manual translations must fit safely in one Google Sheets cell");
assert.equal(parseLocalizedMessages(boundedManualJson).fr.welcomeMessage.length, 300);
const unavailableTranslation = await prepareBrandingLocalization({
  messageSourceLanguage: "en", translationMode: "auto", welcomeMessage: "Welcome",
  localizedMessagesJson: { es: { welcomeMessage: "Conservar" } }
}, null);
assert.equal(unavailableTranslation.branding.translationStatus, "manual_required");
assert.equal("localizedMessagesJson" in unavailableTranslation.branding, false,
  "free-quota failure must omit the field so stored manual translations are preserved");

await setD1BackendMode(db, "apps_script");
health = await d1Health(db);
assert.equal(health.mode, "apps_script");
assert.ok(health.backup.pending > 0);

console.log("D1 backend tests passed", {
  users: health.counts.users,
  pendingBackupEvents: health.backup.pending,
  publicRequestId: publicRequest.id,
  sessionP95Ms: Number(sessionP95.toFixed(3))
});
