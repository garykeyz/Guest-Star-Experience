import {
  type ActivityRuntime,
  type D1DatabaseLike,
  type GuestStarRequest,
  type JsonObject,
  activeRequests,
  archiveActiveRequests,
  checkRateLimit,
  findActiveRequest,
  getActivityRuntime,
  getMeta,
  getRecord,
  insertPublicRequestAtomically,
  listRecords,
  listRecordsByJsonField,
  setMeta,
  updateActiveRequest,
  updateRecord,
  upsertActivityRuntime,
  upsertRecord,
  upsertRequest
} from "./d1-store";
import { hmacSha256Hex, randomId, randomToken, safeEqual, sha256Hex } from "./crypto";

export const GUEST_STAR_D1_VERSION = "4.4.0";
export const GUEST_STAR_BRIDGE_COMPAT_VERSION = "4.2.0";

const PERMISSIONS = [
  "canStartActivity", "canFinishActivity", "canStartNewActivity",
  "canArchiveQueue", "canOpenCloseRequests", "canChangeSchedule",
  "canChangeDuration", "canChangeTransition", "canShowHidePublicStatus",
  "canCustomizeGuestMessages", "canControlVirtualDJ", "canCreateActivities",
  "canViewHistory", "canViewReviews", "canDeleteReviews", "canViewGuestContact",
  "canManageHosts", "canManageDevices", "canViewQR", "canDownloadQR",
  "canCopyPublicLink", "canScheduleNextActivity", "canManageRecurrence",
  "canManageHotelBranding", "canManageReviewDestinations"
] as const;

const PUBLIC_BASE_URL = "https://request.gstarxp.com";
const HOST_BASE_URL = "https://host.gstarxp.com";
const DEFAULT_PUBLIC_EXPERIENCE_SETTING = "defaultPublicExperience";
const PUBLIC_SCHEDULE_CHECK_INTERVAL_MS = 2_000;
const PUBLIC_SCHEDULE_LEASE_MS = 5_000;
export const GUEST_STAR_LANGUAGE_CODES = ["es", "en", "fr", "it", "de", "ru", "pt"] as const;

type PermissionName = typeof PERMISSIONS[number];
type Auth = {
  user: JsonObject;
  session: JsonObject;
  device: JsonObject | null;
};
type Context = {
  hotel: JsonObject;
  venue: JsonObject | null;
  activity: JsonObject | null;
  permissions: Record<string, boolean>;
};
type ResolvedPublicContext = {
  hotel: JsonObject;
  activityId: string;
  configuredDefault: boolean;
};
type PublicScheduleCheckState = {
  nextCheckAt: number;
  operation?: Promise<boolean>;
};

const publicScheduleChecks = new WeakMap<object, Map<string, PublicScheduleCheckState>>();

function nowIso() {
  return new Date().toISOString();
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function limitedText(value: unknown, maximum: number) {
  return text(value).slice(0, Math.max(0, maximum));
}

function numberValue(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bounded(value: unknown, fallback: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, numberValue(value, fallback)));
}

function localDateTimeToUtc(value: unknown, timeZone: unknown) {
  const source = text(value);
  if (!source) return new Date("");
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(source)) return new Date(source);
  const match = source.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) return new Date(source);
  const parts = match.slice(1).map(Number);
  const desiredUtc = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5] || 0);
  const zone = text(timeZone) || "UTC";
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  });
  let candidate = desiredUtc;
  for (let iteration = 0; iteration < 2; iteration += 1) {
    const formatted = Object.fromEntries(
      formatter.formatToParts(new Date(candidate)).map((part) => [part.type, part.value])
    );
    const representedUtc = Date.UTC(
      Number(formatted.year), Number(formatted.month) - 1, Number(formatted.day),
      Number(formatted.hour), Number(formatted.minute), Number(formatted.second)
    );
    candidate += desiredUtc - representedUtc;
  }
  return new Date(candidate);
}

function bool(value: unknown) {
  return value === true || String(value).toLowerCase() === "true";
}

function normalizeIdentifier(value: unknown) {
  return text(value).toLowerCase().normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function normalizeEmail(value: unknown) {
  const email = text(value).toLowerCase();
  if (!email) return "";
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function publicUser(user: JsonObject | null) {
  if (!user) return null;
  return {
    userId: text(user.userId),
    username: text(user.username),
    displayName: text(user.displayName),
    email: text(user.email),
    role: text(user.role),
    status: text(user.status),
    staticHostSlug: text(user.staticHostSlug),
    mustChangePassword: bool(user.mustChangePassword),
    lastLoginAt: text(user.lastLoginAt),
    passwordUpdatedAt: text(user.passwordUpdatedAt || user.updatedAt)
  };
}

function visibleHotel(user: JsonObject, hotel: JsonObject) {
  if (text(user.role) === "superhost") return hotel;
  const { dataSheetId: _dataSheetId, qrFileId: _qrFileId, ...safe } = hotel;
  return safe;
}

function languageCode(value: unknown) {
  const language = text(value).toLowerCase();
  if (["es", "spanish", "español"].includes(language)) return "es";
  if (["en", "english", "inglés"].includes(language)) return "en";
  if (["fr", "french", "français", "francais"].includes(language)) return "fr";
  if (["it", "italian", "italiano"].includes(language)) return "it";
  if (["de", "german", "deutsch", "alemán", "aleman"].includes(language)) return "de";
  if (["ru", "russian", "русский", "ruso"].includes(language)) return "ru";
  if (["pt", "portuguese", "português", "portugues"].includes(language)) return "pt";
  return "";
}

function normalizeLanguages(value: unknown) {
  let requested: unknown = value;
  if (typeof requested === "string") {
    const source = requested;
    try { requested = JSON.parse(source || "[]"); }
    catch { requested = source.split(","); }
  }
  const languages = Array.isArray(requested)
    ? requested.map(languageCode).filter(Boolean)
    : [];
  return [...new Set(languages)].length ? [...new Set(languages)] : [...GUEST_STAR_LANGUAGE_CODES];
}

async function migrateLanguageCatalog(db: D1DatabaseLike) {
  if (await getMeta(db, "language_catalog_v42_migrated") === "true") return;
  for (const activity of await listRecords(db, "Activities")) {
    const languages = normalizeLanguages(activity.allowedLanguagesJson);
    if (languages.length === 2 && languages.includes("es") && languages.includes("en")) {
      await patchRecord(db, "Activities", text(activity.activityId), {
        allowedLanguagesJson: JSON.stringify(GUEST_STAR_LANGUAGE_CODES),
        updatedAt: nowIso()
      });
    }
  }
  await setMeta(db, "language_catalog_v42_migrated", "true");
}

function activityWithLanguages(activity: JsonObject | null) {
  return activity ? {
    ...activity,
    allowedLanguages: normalizeLanguages(activity.allowedLanguagesJson)
  } : null;
}

function parseObject(value: unknown) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }
  try {
    const parsed = JSON.parse(text(value) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as JsonObject
      : {};
  } catch {
    return {};
  }
}

async function save(
  db: D1DatabaseLike,
  table: string,
  record: JsonObject,
  scope = "master",
  _backup = false
) {
  return upsertRecord(db, table, record, scope);
}

async function patchRecord(
  db: D1DatabaseLike,
  table: string,
  id: string,
  changes: JsonObject,
  scope = "master",
  _backup = false
) {
  return updateRecord(db, table, id, changes, scope);
}

async function audit(db: D1DatabaseLike, entry: JsonObject) {
  const record = {
    logId: randomId(),
    userId: text(entry.userId),
    deviceId: text(entry.deviceId),
    action: text(entry.action),
    hotelId: text(entry.hotelId),
    venueId: text(entry.venueId),
    activityId: text(entry.activityId),
    targetId: text(entry.targetId),
    detailsJson: JSON.stringify(entry.details || {}),
    createdAt: nowIso()
  };
  await save(db, "AuditLog", record);
}

async function sessionHash(db: D1DatabaseLike, token: unknown) {
  return hmacSha256Hex(token, await getMeta(db, "session_hash_secret"));
}

async function revokeUserAccess(db: D1DatabaseLike, userId: string) {
  const stamp = nowIso();
  for (const session of await listRecords(db, "AuthSessions")) {
    if (text(session.userId) === userId && !text(session.revokedAt)) {
      await patchRecord(db, "AuthSessions", text(session.authSessionId), { revokedAt: stamp }, "master", false);
    }
  }
  for (const device of await listRecords(db, "Devices")) {
    if (text(device.userId) === userId && text(device.status) === "active") {
      await patchRecord(db, "Devices", text(device.deviceId), {
        status: "revoked", updatedAt: stamp
      });
    }
  }
}

async function createSession(
  db: D1DatabaseLike,
  user: JsonObject,
  deviceId: string,
  rememberLogin: boolean
) {
  const token = randomToken(64);
  const createdAt = nowIso();
  const expiresAt = new Date(
    Date.now() + (rememberLogin ? 30 * 24 * 60 * 60 * 1000 : 12 * 60 * 60 * 1000)
  ).toISOString();
  const session = {
    authSessionId: randomId(),
    userId: text(user.userId),
    sessionTokenHash: await sessionHash(db, token),
    deviceId,
    createdAt,
    expiresAt,
    lastUsedAt: createdAt,
    revokedAt: ""
  };
  await save(db, "AuthSessions", session, "master", false);
  return { token, expiresAt, session };
}

async function authenticate(db: D1DatabaseLike, body: JsonObject): Promise<Auth | null> {
  const rawToken = text(body.authToken);
  if (!rawToken) return null;
  const hash = await sessionHash(db, rawToken);
  const sessions = await listRecords(db, "AuthSessions");
  const session = sessions.find((candidate) => safeEqual(candidate.sessionTokenHash, hash)) || null;
  if (!session || text(session.revokedAt) || Date.parse(text(session.expiresAt)) <= Date.now()) return null;
  const user = await getRecord(db, "Users", text(session.userId));
  if (!user || text(user.status) !== "active") return null;
  let device: JsonObject | null = null;
  if (text(session.deviceId)) {
    device = await getRecord(db, "Devices", text(session.deviceId));
    if (!device || text(device.status) !== "active" || text(device.userId) !== text(user.userId)) return null;
    const rawDeviceToken = text(body.deviceToken);
    if (!rawDeviceToken || !safeEqual(await sessionHash(db, rawDeviceToken), device.deviceTokenHash)) return null;
  }
  const lastUsedAt = Date.parse(text(session.lastUsedAt));
  if (!Number.isFinite(lastUsedAt) || Date.now() - lastUsedAt > 5 * 60 * 1000) {
    await patchRecord(db, "AuthSessions", text(session.authSessionId), { lastUsedAt: nowIso() }, "master", false);
  }
  return { user, session, device };
}

async function requireAuth(db: D1DatabaseLike, body: JsonObject) {
  const auth = await authenticate(db, body);
  if (!auth) throw new Error("UNAUTHORIZED");
  return auth;
}

function assignmentMatches(assignment: JsonObject, context: JsonObject) {
  if (text(assignment.status) !== "active") return false;
  if (text(assignment.hotelId) && text(assignment.hotelId) !== text(context.hotelId)) return false;
  if (text(assignment.venueId) && text(assignment.venueId) !== text(context.venueId)) return false;
  if (text(assignment.activityId) && text(assignment.activityId) !== text(context.activityId)) return false;
  return true;
}

async function effectivePermissions(
  db: D1DatabaseLike,
  user: JsonObject,
  context: JsonObject
) {
  const result: Record<string, boolean> = {};
  for (const permission of PERMISSIONS) result[permission] = false;
  if (text(user.role) === "superhost") {
    for (const permission of PERMISSIONS) result[permission] = true;
    result.all = true;
    return result;
  }
  const assignments = (await listRecords(db, "UserAssignments"))
    .filter((assignment) => text(assignment.userId) === text(user.userId) && assignmentMatches(assignment, context))
    .sort((left, right) => {
      const score = (item: JsonObject) => text(item.activityId) ? 3 : text(item.venueId) ? 2 : 1;
      return score(left) - score(right);
    });
  for (const assignment of assignments) {
    const permissions = parseObject(assignment.permissionsJson);
    if (permissions.all === true) for (const permission of PERMISSIONS) result[permission] = true;
    for (const permission of PERMISSIONS) {
      if (typeof permissions[permission] === "boolean") result[permission] = permissions[permission] as boolean;
    }
  }
  return result;
}

async function accessibleSelection(db: D1DatabaseLike, user: JsonObject) {
  const hotels = (await listRecords(db, "Hotels")).filter((hotel) => text(hotel.status) === "active");
  const venues = (await listRecords(db, "Venues")).filter((venue) => text(venue.status) === "active");
  const activeHotelIds = new Set(hotels.map((hotel) => text(hotel.hotelId)));
  const activeVenueIds = new Set(venues.map((venue) => text(venue.venueId)));
  const activities = (await listRecords(db, "Activities"))
    .filter((activity) => (
      text(activity.status) !== "inactive" &&
      activeHotelIds.has(text(activity.hotelId)) &&
      activeVenueIds.has(text(activity.venueId))
    ))
    .map((activity) => activityWithLanguages(activity) as JsonObject);
  if (text(user.role) === "superhost") return { hotels, venues, activities };
  const assignments = (await listRecords(db, "UserAssignments"))
    .filter((assignment) => text(assignment.userId) === text(user.userId) && text(assignment.status) === "active");
  const allowedHotels = new Set<string>();
  const allowedVenues = new Set<string>();
  const allowedActivities = new Set<string>();
  for (const assignment of assignments) {
    const hotelId = text(assignment.hotelId);
    if (!hotelId) continue;
    allowedHotels.add(hotelId);
    if (text(assignment.activityId)) {
      for (const activity of activities) {
        if (text(activity.activityId) === text(assignment.activityId) && text(activity.hotelId) === hotelId) {
          allowedActivities.add(text(activity.activityId));
          allowedVenues.add(text(activity.venueId));
        }
      }
    } else if (text(assignment.venueId)) {
      allowedVenues.add(text(assignment.venueId));
      for (const activity of activities) {
        if (text(activity.hotelId) === hotelId && text(activity.venueId) === text(assignment.venueId)) {
          allowedActivities.add(text(activity.activityId));
        }
      }
    } else {
      for (const venue of venues) if (text(venue.hotelId) === hotelId) allowedVenues.add(text(venue.venueId));
      for (const activity of activities) if (text(activity.hotelId) === hotelId) allowedActivities.add(text(activity.activityId));
    }
  }
  return {
    hotels: hotels.filter((hotel) => allowedHotels.has(text(hotel.hotelId))).map((hotel) => visibleHotel(user, hotel)),
    venues: venues.filter((venue) => allowedVenues.has(text(venue.venueId))),
    activities: activities.filter((activity) => allowedActivities.has(text(activity.activityId)))
  };
}

async function tenantContext(db: D1DatabaseLike, auth: Auth, requested: JsonObject): Promise<Context> {
  const hotel = await getRecord(db, "Hotels", text(requested.hotelId));
  if (!hotel || text(hotel.status) !== "active") throw new Error("HOTEL_NOT_FOUND");
  const venue = text(requested.venueId) ? await getRecord(db, "Venues", text(requested.venueId)) : null;
  if (venue && (text(venue.hotelId) !== text(hotel.hotelId) || text(venue.status) !== "active")) {
    throw new Error("VENUE_NOT_FOUND");
  }
  const activity = text(requested.activityId)
    ? await getRecord(db, "Activities", text(requested.activityId))
    : null;
  if (activity && (
    text(activity.hotelId) !== text(hotel.hotelId) ||
    (venue && text(activity.venueId) !== text(venue.venueId)) ||
    text(activity.status) === "inactive"
  )) throw new Error("ACTIVITY_NOT_FOUND");
  const identifiers = {
    hotelId: text(hotel.hotelId),
    venueId: text(venue?.venueId),
    activityId: text(activity?.activityId)
  };
  const permissions = await effectivePermissions(db, auth.user, identifiers);
  if (text(auth.user.role) !== "superhost") {
    const assigned = (await listRecords(db, "UserAssignments")).some((assignment) =>
      text(assignment.userId) === text(auth.user.userId) && assignmentMatches(assignment, identifiers)
    );
    if (!assigned) throw new Error("FORBIDDEN");
  }
  return { hotel, venue, activity, permissions };
}

function requirePermission(context: Context, permission: PermissionName) {
  if (!context.permissions.all && !context.permissions[permission]) throw new Error("FORBIDDEN");
}

function shareInfo(hotel: JsonObject) {
  const publicUrl = text(hotel.publicUrl);
  const directQrUrl = `https://quickchart.io/qr?size=900&margin=2&format=png&text=${encodeURIComponent(publicUrl)}`;
  return {
    publicUrl,
    qrVersion: numberValue(hotel.qrVersion, 1),
    qrViewUrl: directQrUrl,
    qrDownloadUrl: directQrUrl
  };
}

async function runtimeFor(db: D1DatabaseLike, activity: JsonObject, hotel: JsonObject) {
  const existing = await getActivityRuntime(db, text(activity.activityId));
  if (existing) return existing;
  const status = text(activity.status);
  return {
    activityId: text(activity.activityId),
    hotelId: text(hotel.hotelId),
    venueId: text(activity.venueId),
    cycleId: text(activity.currentCycleId),
    // A scheduled activity is only opened by an explicit Host action or by the
    // due-schedule processor. Deriving `accepting` from the schedule itself
    // would open requests immediately instead of at requestOpeningAt.
    accepting: status === "in_progress",
    running: status === "in_progress",
    startedAt: "",
    finishedAt: "",
    stateRevision: 0,
    lastAction: "migration",
    lastSource: "d1",
    updatedAt: text(activity.updatedAt) || nowIso()
  } satisfies ActivityRuntime;
}

function playbackModeForRuntime(runtime: ActivityRuntime | null) {
  const source = text(runtime?.lastSource).toLowerCase();
  return source === "player" || source === "bridge" ? source : "";
}

function cleanPlayerQueueOrder(value: unknown) {
  return Array.isArray(value)
    ? [...new Set(value.map((id) => limitedText(id, 160)).filter(Boolean))].slice(0, 1000)
    : [];
}

function cleanPlayerPlayback(value: unknown, fallback: JsonObject = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
  return {
    currentRequestId: limitedText(
      source.currentRequestId === undefined ? fallback.currentRequestId : source.currentRequestId,
      160
    ),
    currentTimeSeconds: bounded(
      source.currentTimeSeconds === undefined ? fallback.currentTimeSeconds : source.currentTimeSeconds,
      0,
      0,
      12 * 60 * 60
    ),
    scene: text(source.scene === undefined ? fallback.scene : source.scene) === "karaoke"
      ? "karaoke"
      : "lobby",
    wasPlaying: source.wasPlaying === undefined
      ? bool(fallback.wasPlaying)
      : bool(source.wasPlaying),
    updatedAt: text(source.updatedAt === undefined ? fallback.updatedAt : source.updatedAt) || nowIso()
  };
}

async function playerRuntimeFor(db: D1DatabaseLike, activityId: string) {
  const existing = await getRecord(db, "PlayerActivityRuntime", activityId);
  const existingPlayback = existing?.playback && typeof existing.playback === "object" && !Array.isArray(existing.playback)
    ? existing.playback as JsonObject
    : {};
  return {
    playerRuntimeId: activityId,
    activityId,
    hotelId: text(existing?.hotelId),
    queueOrder: cleanPlayerQueueOrder(existing?.queueOrder),
    playback: cleanPlayerPlayback(existingPlayback, existingPlayback),
    updatedAt: text(existing?.updatedAt)
  };
}

async function recalculateQueue(
  db: D1DatabaseLike,
  hotelId: string,
  activity: JsonObject
) {
  const requests = await currentCycleRequests(db, hotelId, activity);
  const totalSeconds = Math.max(900, numberValue(activity.defaultDurationSeconds, 7200));
  const defaultTransition = Math.max(0, numberValue(activity.defaultTransitionSeconds, 30));
  let accumulated = 0;
  for (const request of requests) {
    const excluded = ["Retirada del Player", "Fuera de VirtualDJ", "Eliminada", "Cancelada"].includes(request.status);
    if (!excluded) accumulated += Math.max(0, request.durationSeconds) + Math.max(0, request.transitionSeconds || defaultTransition);
    const remaining = Math.max(0, totalSeconds - accumulated);
    if (request.accumulatedSeconds === accumulated && request.remainingSeconds === remaining) continue;
    await updateActiveRequest(db, hotelId, request.requestId, {
      accumulatedSeconds: accumulated,
      remainingSeconds: remaining,
      updatedAt: nowIso()
    });
  }
  return accumulated;
}

async function stateFor(
  db: D1DatabaseLike,
  hotel: JsonObject,
  activity: JsonObject,
  knownRequests?: GuestStarRequest[]
) {
  const runtime = await runtimeFor(db, activity, hotel);
  const requests = knownRequests || await currentCycleRequests(db, text(hotel.hotelId), activity);
  const accumulatedSeconds = requests.reduce((total, request) => {
    if (["Retirada del Player", "Fuera de VirtualDJ", "Eliminada", "Cancelada"].includes(request.status)) return total;
    return total + Math.max(0, request.durationSeconds) + Math.max(0, request.transitionSeconds || numberValue(activity.defaultTransitionSeconds, 30));
  }, 0);
  const totalSeconds = Math.max(900, numberValue(activity.defaultDurationSeconds, 7200));
  return {
    accepting: runtime.accepting,
    activityHours: totalSeconds / 3600,
    transitionSeconds: Math.max(0, numberValue(activity.defaultTransitionSeconds, 30)),
    accumulatedSeconds,
    remainingSeconds: Math.max(0, totalSeconds - accumulatedSeconds),
    activityStartedAt: runtime.startedAt,
    activityFinishedAt: runtime.finishedAt,
    activityRunning: runtime.running,
    showPublicStatus: bool(activity.showPublicStatus),
    queuePeopleCount: new Set(requests.filter(publicRequestIsActive).map(publicGuestKey)).size,
    stateRevision: runtime.stateRevision,
    activityId: runtime.activityId,
    updatedAt: runtime.updatedAt,
    lastAction: runtime.lastAction,
    lastSource: runtime.lastSource,
    playbackMode: playbackModeForRuntime(runtime)
  };
}

function bridgeRequest(request: GuestStarRequest) {
  const guestIdentity = publicGuestIdentityFromSource(request.sourceType);
  return {
    id: request.requestId,
    timestamp: request.createdAt,
    name: request.singer,
    song: request.song,
    artist: request.artist,
    comment: request.comment,
    language: request.language,
    languageCode: request.languageCode,
    durationSeconds: request.durationSeconds,
    transitionSeconds: request.transitionSeconds,
    accumulatedSeconds: request.accumulatedSeconds,
    remainingSeconds: request.remainingSeconds,
    sourceUrl: request.sourceUrl,
    status: request.status,
    fileName: request.fileName,
    sourceType: request.sourceType,
    guestIdentity,
    guestCode: publicGuestCode(request.sourceType),
    virtualDJItemId: request.virtualDJItemId,
    queuePosition: request.queuePosition,
    syncState: request.syncState,
    lastSeenAt: request.lastSeenAt,
    stateRevision: request.stateRevision
  };
}

async function upcomingActivities(db: D1DatabaseLike, hotelId: string) {
  const schedules = (await listRecordsByJsonField(db, "ActivitySchedules", "hotelId", hotelId))
    .filter((schedule) => text(schedule.status) === "active" && Date.parse(text(schedule.scheduledStartAt)) > Date.now())
    .sort((left, right) => Date.parse(text(left.scheduledStartAt)) - Date.parse(text(right.scheduledStartAt)))
    .slice(0, 3);
  return await Promise.all(schedules.map(async (schedule) => {
    const [activity, venue] = await Promise.all([
      getRecord(db, "Activities", text(schedule.activityId)),
      getRecord(db, "Venues", text(schedule.venueId))
    ]);
    return {
      scheduleId: text(schedule.scheduleId),
      activityId: text(schedule.activityId),
      activityName: text(activity?.name) || "Guest Star Activity",
      venueName: text(venue?.name),
      scheduledStartAt: text(schedule.scheduledStartAt),
      durationSeconds: numberValue(schedule.durationSeconds),
      showCountdown: bool(schedule.showCountdown)
    };
  }));
}

async function selectedState(db: D1DatabaseLike, auth: Auth, context: Context) {
  if (!context.activity) throw new Error("ACTIVITY_REQUIRED");
  const freshActivity = await getRecord(db, "Activities", text(context.activity.activityId));
  const freshHotel = await getRecord(db, "Hotels", text(context.hotel.hotelId));
  if (!freshActivity || !freshHotel) throw new Error("ACTIVITY_NOT_FOUND");
  const requests = await currentCycleRequests(db, text(freshHotel.hotelId), freshActivity);
  const schedules = (await listRecordsByJsonField(
    db,
    "ActivitySchedules",
    "hotelId",
    text(freshHotel.hotelId)
  )).filter((schedule) => text(schedule.activityId) === text(freshActivity.activityId))
    .sort((left, right) => Date.parse(text(left.scheduledStartAt)) - Date.parse(text(right.scheduledStartAt)));
  return {
    ok: true,
    codeVersion: GUEST_STAR_BRIDGE_COMPAT_VERSION,
    codeBuild: GUEST_STAR_D1_VERSION,
    serverNow: nowIso(),
    user: publicUser(auth.user),
    hotel: visibleHotel(auth.user, freshHotel),
    branding: await safeBranding(db, text(freshHotel.hotelId)),
    venue: context.venue,
    activity: activityWithLanguages(freshActivity),
    permissions: await effectivePermissions(db, auth.user, {
      hotelId: freshHotel.hotelId,
      venueId: context.venue?.venueId || "",
      activityId: freshActivity.activityId
    }),
    state: await stateFor(db, freshHotel, freshActivity, requests),
    config: {
      activityHours: numberValue(freshActivity.defaultDurationSeconds, 7200) / 3600,
      transitionSeconds: numberValue(freshActivity.defaultTransitionSeconds, 30)
    },
    requests: requests
      .filter((request) => !["Eliminada", "Cancelada"].includes(request.status))
      .map(bridgeRequest),
    playerRuntime: await playerRuntimeFor(db, text(freshActivity.activityId)),
    schedules,
    share: shareInfo(freshHotel),
    upcomingActivities: await upcomingActivities(db, text(freshHotel.hotelId))
  };
}

async function completeLogin(
  db: D1DatabaseLike,
  user: JsonObject,
  body: JsonObject,
  auditAction = "login.succeeded"
) {
  let deviceId = "";
  let deviceToken = "";
  if (text(body.clientType).toLowerCase() === "bridge") {
    const requestedId = text(body.deviceId);
    let device = requestedId ? await getRecord(db, "Devices", requestedId) : null;
    if (device && text(device.userId) !== text(user.userId)) {
      const previousDeviceId = text(device.deviceId);
      const stamp = nowIso();
      await patchRecord(db, "Devices", previousDeviceId, { status: "revoked", updatedAt: stamp });
      for (const previousSession of await listRecords(db, "AuthSessions")) {
        if (text(previousSession.deviceId) === previousDeviceId && !text(previousSession.revokedAt)) {
          await patchRecord(db, "AuthSessions", text(previousSession.authSessionId), {
            revokedAt: stamp
          }, "master", false);
        }
      }
      await audit(db, {
        userId: user.userId,
        deviceId: previousDeviceId,
        action: "device.user.switched",
        details: { previousUserId: device.userId }
      });
      device = null;
    }
    deviceToken = randomToken(64);
    const stamp = nowIso();
    deviceId = text(device?.deviceId) || randomId();
    device = await save(db, "Devices", {
      ...(device || {}),
      deviceId,
      deviceName: text(body.deviceName) || text(device?.deviceName) || "Guest Star Bridge",
      userId: text(user.userId),
      hotelId: text(device?.hotelId),
      venueId: text(device?.venueId),
      activityId: text(device?.activityId),
      deviceTokenHash: await sessionHash(db, deviceToken),
      status: "active",
      lastHeartbeatAt: stamp,
      bridgeVersion: text(body.bridgeVersion) || GUEST_STAR_BRIDGE_COMPAT_VERSION,
      virtualDJConnected: false,
      createdAt: text(device?.createdAt) || stamp,
      updatedAt: stamp
    });
  }
  const session = await createSession(db, user, deviceId, body.rememberLogin !== false);
  const updatedUser = await patchRecord(db, "Users", text(user.userId), {
    lastLoginAt: nowIso(), updatedAt: nowIso()
  }) || user;
  await audit(db, { userId: user.userId, deviceId, action: auditAction });
  return {
    ok: true,
    codeVersion: GUEST_STAR_BRIDGE_COMPAT_VERSION,
    codeBuild: GUEST_STAR_D1_VERSION,
    authToken: session.token,
    expiresAt: session.expiresAt,
    deviceId,
    deviceToken,
    user: publicUser(updatedUser),
    selection: await accessibleSelection(db, updatedUser)
  };
}

async function login(db: D1DatabaseLike, body: JsonObject) {
  const identifier = text(body.username || body.email).toLowerCase();
  const password = String(body.password || "");
  if (!identifier || !password) return { ok: false, code: "MISSING_CREDENTIALS" };
  const rateKey = `login:${(await sha256Hex(identifier)).slice(0, 32)}`;
  if (!await checkRateLimit(db, rateKey, 5, 600)) return { ok: false, code: "RATE_LIMITED" };
  const user = (await listRecords(db, "Users")).find((candidate) =>
    text(candidate.username).toLowerCase() === identifier || text(candidate.email).toLowerCase() === identifier
  ) || null;
  const valid = Boolean(user && text(user.status) === "active" && safeEqual(
    await hmacSha256Hex(password, user.passwordSalt), user.passwordHash
  ));
  if (!valid || !user) {
    await audit(db, { action: "login.failed", details: { identifierHash: await sha256Hex(identifier) } });
    return { ok: false, code: "INVALID_CREDENTIALS" };
  }
  await checkRateLimit(db, rateKey, 5, 600, true);
  return await completeLogin(db, user, body);
}

export async function loginD1WithVerifiedGoogle(
  db: D1DatabaseLike,
  verifiedEmail: string,
  body: JsonObject
) {
  const email = normalizeEmail(verifiedEmail);
  if (!email) return { ok: false, code: "INVALID_GOOGLE_CREDENTIAL" };
  const rateKey = `google-login:${(await sha256Hex(email)).slice(0, 32)}`;
  if (!await checkRateLimit(db, rateKey, 10, 600)) return { ok: false, code: "RATE_LIMITED" };
  const user = (await listRecords(db, "Users")).find((candidate) =>
    text(candidate.email).toLowerCase() === email
  ) || null;
  if (!user || text(user.status) !== "active") {
    await audit(db, { action: "google.login.failed", details: { emailHash: await sha256Hex(email) } });
    return { ok: false, code: "GOOGLE_ACCOUNT_NOT_REGISTERED" };
  }
  await checkRateLimit(db, rateKey, 10, 600, true);
  return await completeLogin(db, user, body, "google.login.succeeded");
}

async function adminState(db: D1DatabaseLike, auth: Auth) {
  if (text(auth.user.role) !== "superhost") throw new Error("FORBIDDEN");
  await migrateLanguageCatalog(db);
  return {
    ok: true,
    codeVersion: GUEST_STAR_BRIDGE_COMPAT_VERSION,
    codeBuild: GUEST_STAR_D1_VERSION,
    backend: "cloudflare-d1",
    users: (await listRecords(db, "Users")).map(publicUser),
    hotels: await listRecords(db, "Hotels"),
    venues: await listRecords(db, "Venues"),
    activities: (await listRecords(db, "Activities")).map((activity) => activityWithLanguages(activity)),
    assignments: await listRecords(db, "UserAssignments"),
    devices: (await listRecords(db, "Devices")).map((device) => ({
      deviceId: device.deviceId,
      deviceName: device.deviceName,
      userId: device.userId,
      hotelId: device.hotelId,
      venueId: device.venueId,
      activityId: device.activityId,
      status: device.status,
      lastHeartbeatAt: device.lastHeartbeatAt,
      bridgeVersion: device.bridgeVersion,
      virtualDJConnected: device.virtualDJConnected,
      createdAt: device.createdAt,
      updatedAt: device.updatedAt
    })),
    schedules: await listRecords(db, "ActivitySchedules"),
    upcomingActivities: await listRecords(db, "UpcomingActivities"),
    branding: await listRecords(db, "HotelBranding"),
    defaultPublicExperience: await defaultPublicExperienceSetting(db),
    auditLog: (await listRecords(db, "AuditLog")).slice(-500)
  };
}

async function defaultPublicExperienceSetting(db: D1DatabaseLike) {
  const record = await getRecord(db, "GlobalSettings", DEFAULT_PUBLIC_EXPERIENCE_SETTING);
  const setting = parseObject(record?.settingValue);
  const hotelId = text(setting.hotelId);
  const venueId = text(setting.venueId);
  const activityId = text(setting.activityId);
  const configured = bool(setting.enabled) && Boolean(hotelId && venueId && activityId);
  let available = false;
  if (configured) {
    const [hotel, venue, activity] = await Promise.all([
      getRecord(db, "Hotels", hotelId),
      getRecord(db, "Venues", venueId),
      getRecord(db, "Activities", activityId)
    ]);
    available = Boolean(
      hotel && text(hotel.status) === "active" &&
      venue && text(venue.status) === "active" && text(venue.hotelId) === hotelId &&
      activity && text(activity.status) !== "inactive" &&
      text(activity.hotelId) === hotelId && text(activity.venueId) === venueId
    );
  }
  return {
    configured,
    available,
    hotelId,
    venueId,
    activityId,
    updatedAt: text(record?.updatedAt)
  };
}

async function setDefaultPublicExperience(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  if (text(auth.user.role) !== "superhost") throw new Error("FORBIDDEN");
  const enabled = body.enabled !== false;
  let settingValue: JsonObject = { enabled: false, hotelId: "", venueId: "", activityId: "" };
  if (enabled) {
    const context = await tenantContext(db, auth, {
      hotelId: body.hotelId,
      venueId: body.venueId,
      activityId: body.activityId
    });
    if (!context.venue || !context.activity) return { ok: false, code: "DEFAULT_EXPERIENCE_REQUIRED" };
    settingValue = {
      enabled: true,
      hotelId: text(context.hotel.hotelId),
      venueId: text(context.venue.venueId),
      activityId: text(context.activity.activityId)
    };
  }
  const stamp = nowIso();
  await save(db, "GlobalSettings", {
    settingKey: DEFAULT_PUBLIC_EXPERIENCE_SETTING,
    settingValue: JSON.stringify(settingValue),
    updatedAt: stamp
  });
  await audit(db, {
    userId: auth.user.userId,
    action: enabled ? "public.defaultExperience.updated" : "public.defaultExperience.cleared",
    hotelId: settingValue.hotelId,
    venueId: settingValue.venueId,
    activityId: settingValue.activityId
  });
  return { ok: true, defaultPublicExperience: await defaultPublicExperienceSetting(db) };
}

async function createHost(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  if (text(auth.user.role) !== "superhost") throw new Error("FORBIDDEN");
  const username = normalizeIdentifier(body.username).replace(/-/g, ".");
  const rawEmail = text(body.email);
  const email = normalizeEmail(rawEmail);
  const password = String(body.password || "");
  if (username.length < 3) return { ok: false, code: "INVALID_USERNAME" };
  if (rawEmail && !email) return { ok: false, code: "INVALID_EMAIL" };
  const users = await listRecords(db, "Users");
  if (users.some((user) => text(user.username).toLowerCase() === username || (email && text(user.email).toLowerCase() === email))) {
    return { ok: false, code: "USER_EXISTS" };
  }
  if (password.length < 12 || password.length > 128) return { ok: false, code: "WEAK_PASSWORD" };
  const salt = randomToken(32);
  const stamp = nowIso();
  const role = text(body.role) === "superhost" ? "superhost" : "host";
  const user = await save(db, "Users", {
    userId: randomId(),
    username,
    displayName: text(body.displayName) || username,
    email,
    passwordHash: await hmacSha256Hex(password, salt),
    passwordSalt: salt,
    role,
    status: "active",
    staticHostSlug: `${normalizeIdentifier(username) || "host"}-${randomToken(6)}`,
    mustChangePassword: false,
    createdAt: stamp,
    updatedAt: stamp,
    lastLoginAt: "",
    passwordUpdatedAt: stamp
  });
  await audit(db, { userId: auth.user.userId, action: "user.created", targetId: user.userId, details: { role } });
  return { ok: true, user: publicUser(user) };
}

async function updateHost(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  if (text(auth.user.role) !== "superhost") throw new Error("FORBIDDEN");
  const user = await getRecord(db, "Users", text(body.userId));
  if (!user || !["host", "superhost"].includes(text(user.role))) return { ok: false, code: "USER_NOT_FOUND" };
  const changes: JsonObject = { updatedAt: nowIso() };
  const users = await listRecords(db, "Users");
  if (body.username !== undefined) {
    const username = normalizeIdentifier(body.username).replace(/-/g, ".");
    if (username.length < 3) return { ok: false, code: "INVALID_USERNAME" };
    if (users.some((candidate) => text(candidate.userId) !== text(user.userId) && text(candidate.username).toLowerCase() === username)) {
      return { ok: false, code: "USER_EXISTS" };
    }
    changes.username = username;
  }
  if (body.displayName !== undefined) changes.displayName = text(body.displayName);
  if (body.email !== undefined) {
    const rawEmail = text(body.email);
    const email = normalizeEmail(rawEmail);
    if (rawEmail && !email) return { ok: false, code: "INVALID_EMAIL" };
    if (email && users.some((candidate) => text(candidate.userId) !== text(user.userId) && text(candidate.email).toLowerCase() === email)) {
      return { ok: false, code: "USER_EXISTS" };
    }
    changes.email = email;
  }
  if (body.status !== undefined) {
    const nextStatus = body.status === "inactive" ? "inactive" : "active";
    if (text(user.role) === "superhost" && nextStatus === "inactive") {
      const activeSuperhosts = users.filter((candidate) =>
        text(candidate.role) === "superhost" && text(candidate.status) === "active"
      );
      if (activeSuperhosts.length <= 1) return { ok: false, code: "LAST_SUPERHOST" };
    }
    changes.status = nextStatus;
  }
  const updated = await patchRecord(db, "Users", text(user.userId), changes) || user;
  if (changes.status === "inactive") await revokeUserAccess(db, text(user.userId));
  await audit(db, { userId: auth.user.userId, action: "user.updated", targetId: user.userId, details: changes });
  return { ok: true, user: publicUser(updated) };
}

async function setHostPassword(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  if (text(auth.user.role) !== "superhost") throw new Error("FORBIDDEN");
  const user = await getRecord(db, "Users", text(body.userId));
  if (!user || !["host", "superhost"].includes(text(user.role))) return { ok: false, code: "USER_NOT_FOUND" };
  const password = String(body.password || "");
  if (password.length < 12 || password.length > 128) return { ok: false, code: "WEAK_PASSWORD" };
  const stamp = nowIso();
  const salt = randomToken(32);
  const updated = await patchRecord(db, "Users", text(user.userId), {
    passwordHash: await hmacSha256Hex(password, salt),
    passwordSalt: salt,
    mustChangePassword: false,
    passwordUpdatedAt: stamp,
    updatedAt: stamp
  }) || user;
  await revokeUserAccess(db, text(user.userId));
  await audit(db, {
    userId: auth.user.userId,
    action: "host.password.set",
    targetId: user.userId,
    details: { sessionsRevoked: true }
  });
  return { ok: true, user: publicUser(updated) };
}

async function createHotel(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  if (text(auth.user.role) !== "superhost") throw new Error("FORBIDDEN");
  const name = text(body.name);
  if (!name) return { ok: false, code: "HOTEL_NAME_REQUIRED" };
  const timezone = text(body.timezone) || "America/Santo_Domingo";
  try { new Intl.DateTimeFormat("en", { timeZone: timezone }); }
  catch { return { ok: false, code: "INVALID_TIMEZONE" }; }
  const hotels = await listRecords(db, "Hotels");
  const base = normalizeIdentifier(name) || "hotel";
  if (hotels.some((hotel) => normalizeIdentifier(hotel.name) === base || text(hotel.slug) === base)) {
    return { ok: false, code: "HOTEL_ALREADY_EXISTS", error: `A hotel named ${name} already exists.` };
  }
  let slug = base;
  let suffix = 2;
  while (hotels.some((hotel) => text(hotel.slug) === slug)) slug = `${base}-${suffix++}`;
  const stamp = nowIso();
  const publicCode = randomToken(20);
  let hotel = await save(db, "Hotels", {
    hotelId: randomId(),
    name,
    slug,
    publicCode,
    publicUrl: `${PUBLIC_BASE_URL}/h/${slug}-${publicCode}`,
    qrFileId: "",
    qrVersion: 1,
    activePublicActivityId: "",
    timezone,
    dataSheetId: "",
    status: "active",
    createdAt: stamp,
    updatedAt: stamp
  });
  const venue = await save(db, "Venues", {
    venueId: randomId(), hotelId: hotel.hotelId,
    name: text(body.defaultVenueName) || "Main Venue",
    slug: "main-venue", status: "active", createdAt: stamp, updatedAt: stamp
  });
  const activity = await save(db, "Activities", {
    activityId: randomId(), hotelId: hotel.hotelId, venueId: venue.venueId,
    name: text(body.defaultActivityName) || "Guest Star Karaoke",
    internalCode: "karaoke", status: "ready",
    defaultDurationSeconds: 7200, defaultTransitionSeconds: 30,
    showPublicStatus: false, showCountdown: true, scheduledStartAt: "",
    autoStartEnabled: false, acceptEarlyRequests: false, currentCycleId: "",
    createdAt: stamp, updatedAt: stamp,
    allowedLanguagesJson: JSON.stringify(GUEST_STAR_LANGUAGE_CODES)
  });
  hotel = await patchRecord(db, "Hotels", text(hotel.hotelId), {
    activePublicActivityId: activity.activityId,
    updatedAt: stamp
  }) || hotel;
  const assignment = await save(db, "UserAssignments", {
    assignmentId: randomId(), userId: auth.user.userId, hotelId: hotel.hotelId,
    venueId: "", activityId: "", permissionsJson: JSON.stringify({ all: true }),
    status: "active", createdAt: stamp, updatedAt: stamp
  });
  const branding = await save(db, "HotelBranding", {
    hotelBrandingId: randomId(), hotelId: hotel.hotelId,
    teamDisplayName: "Guest Star Team", teamType: "Entertainment Team",
    tagline: "Your moment. Your song. Your stage.",
    welcomeMessage: "Choose your song and get ready to be the Guest Star.",
    activityEndingMessage: "Thank you for singing with us.",
    upcomingActivityMessage: "Join us again for the next Guest Star experience.",
    primaryColor: "#ff2d95", secondaryColor: "#8b3dff", accentColor: "#00c8ff",
    showHotelName: true, showHotelLogo: true, showTeamIdentity: true,
    showActivityDetails: true, showCountdown: true, showNextActivity: true,
    showInternalRating: false, showExternalReview: false, showRemindMe: false,
    showAddToCalendar: true, offerFollowUp: false, updatedAt: stamp
  });
  await audit(db, {
    userId: auth.user.userId, action: "hotel.created", hotelId: hotel.hotelId,
    targetId: branding.hotelBrandingId,
    details: { venueId: venue.venueId, activityId: activity.activityId }
  });
  return {
    ok: true,
    hotel,
    venue,
    activity: activityWithLanguages(activity),
    assignment
  };
}

async function updateHotelAction(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  if (text(auth.user.role) !== "superhost") throw new Error("FORBIDDEN");
  const hotel = await getRecord(db, "Hotels", text(body.hotelId));
  if (!hotel) return { ok: false, code: "HOTEL_NOT_FOUND" };
  if (body.status === "inactive" && text(body.confirmHotelName) !== text(hotel.name)) {
    return { ok: false, code: "HOTEL_CONFIRMATION_REQUIRED" };
  }
  const status = body.status === "inactive" ? "inactive" : "active";
  const updated = await patchRecord(db, "Hotels", text(hotel.hotelId), { status, updatedAt: nowIso() }) || hotel;
  await audit(db, { userId: auth.user.userId, action: status === "inactive" ? "hotel.deleted" : "hotel.restored", hotelId: hotel.hotelId });
  return { ok: true, hotel: updated, recoverable: true };
}

async function createVenue(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  const context = await tenantContext(db, auth, { hotelId: body.hotelId });
  if (text(auth.user.role) !== "superhost") requirePermission(context, "canCreateActivities");
  const name = text(body.name);
  if (!name) return { ok: false, code: "VENUE_NAME_REQUIRED" };
  const venues = await listRecords(db, "Venues");
  const base = normalizeIdentifier(name) || "venue";
  let slug = base;
  let suffix = 2;
  while (venues.some((venue) => text(venue.hotelId) === text(context.hotel.hotelId) && text(venue.slug) === slug)) {
    slug = `${base}-${suffix++}`;
  }
  const stamp = nowIso();
  const venue = await save(db, "Venues", {
    venueId: randomId(), hotelId: context.hotel.hotelId, name, slug,
    status: "active", createdAt: stamp, updatedAt: stamp
  });
  await audit(db, { userId: auth.user.userId, action: "venue.created", hotelId: context.hotel.hotelId, venueId: venue.venueId });
  return { ok: true, venue };
}

async function updateVenue(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  if (text(auth.user.role) !== "superhost") throw new Error("FORBIDDEN");
  const venue = await getRecord(db, "Venues", text(body.venueId));
  if (!venue) return { ok: false, code: "VENUE_NOT_FOUND" };
  const hotel = await getRecord(db, "Hotels", text(venue.hotelId));
  if (!hotel) return { ok: false, code: "VENUE_NOT_FOUND" };

  const requestedStatus = text(body.status);
  const deleting = requestedStatus === "inactive";
  if (deleting) {
    const linkedActivities = (await listRecords(db, "Activities")).filter((activity) => (
      text(activity.venueId) === text(venue.venueId) && text(activity.status) !== "inactive"
    ));
    if (linkedActivities.length) {
      return {
        ok: false,
        code: "VENUE_HAS_ACTIVE_ACTIVITIES",
        error: "Delete the active activities assigned to this venue before deleting the venue."
      };
    }
  }

  const changes: JsonObject = { updatedAt: nowIso() };
  if (body.name !== undefined) {
    const name = text(body.name);
    if (!name) return { ok: false, code: "VENUE_NAME_REQUIRED" };
    changes.name = name;
  }
  if (body.status !== undefined) changes.status = deleting ? "inactive" : "active";
  const updated = await patchRecord(db, "Venues", text(venue.venueId), changes) || venue;
  await audit(db, {
    userId: auth.user.userId,
    action: deleting ? "venue.deleted" : body.status !== undefined ? "venue.restored" : "venue.updated",
    hotelId: venue.hotelId,
    venueId: venue.venueId,
    details: changes
  });
  return { ok: true, venue: updated, recoverable: deleting };
}

async function createActivity(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  const context = await tenantContext(db, auth, { hotelId: body.hotelId, venueId: body.venueId });
  if (text(auth.user.role) !== "superhost") requirePermission(context, "canCreateActivities");
  if (!context.venue) return { ok: false, code: "VENUE_REQUIRED" };
  const name = text(body.name);
  if (!name) return { ok: false, code: "ACTIVITY_NAME_REQUIRED" };
  const stamp = nowIso();
  const activity = await save(db, "Activities", {
    activityId: randomId(), hotelId: context.hotel.hotelId, venueId: context.venue.venueId,
    name, internalCode: normalizeIdentifier(body.internalCode || name), status: "ready",
    defaultDurationSeconds: Math.round(bounded(body.defaultDurationSeconds, 7200, 900, 604800)),
    defaultTransitionSeconds: Math.round(bounded(body.defaultTransitionSeconds, 30, 0, 900)),
    showPublicStatus: body.showPublicStatus === true,
    showCountdown: body.showCountdown !== false,
    scheduledStartAt: text(body.scheduledStartAt),
    autoStartEnabled: body.autoStartEnabled === true,
    acceptEarlyRequests: body.acceptEarlyRequests === true,
    currentCycleId: "", createdAt: stamp, updatedAt: stamp,
    allowedLanguagesJson: JSON.stringify(normalizeLanguages(body.allowedLanguages))
  });
  await audit(db, { userId: auth.user.userId, action: "activity.created", hotelId: context.hotel.hotelId, venueId: context.venue.venueId, activityId: activity.activityId });
  return { ok: true, activity: activityWithLanguages(activity) };
}

async function updateActivityRecord(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  if (text(auth.user.role) !== "superhost") throw new Error("FORBIDDEN");
  const activity = await getRecord(db, "Activities", text(body.activityId));
  if (!activity) return { ok: false, code: "ACTIVITY_NOT_FOUND" };
  const hotel = await getRecord(db, "Hotels", text(activity.hotelId));
  const venue = await getRecord(db, "Venues", text(activity.venueId));
  if (!hotel || !venue) return { ok: false, code: "ACTIVITY_NOT_FOUND" };
  const deleting = body.status === "inactive";
  if (deleting && text(activity.status) === "in_progress") {
    return { ok: false, code: "ACTIVITY_IN_PROGRESS", error: "Finish the activity before deleting it." };
  }
  const changes: JsonObject = { updatedAt: nowIso() };
  if (body.name !== undefined) {
    const name = text(body.name);
    if (!name) return { ok: false, code: "ACTIVITY_NAME_REQUIRED" };
    changes.name = name;
  }
  if (body.defaultDurationSeconds !== undefined) {
    changes.defaultDurationSeconds = Math.round(bounded(body.defaultDurationSeconds, numberValue(activity.defaultDurationSeconds, 7200), 900, 604800));
  }
  if (body.defaultTransitionSeconds !== undefined) {
    changes.defaultTransitionSeconds = Math.round(bounded(body.defaultTransitionSeconds, numberValue(activity.defaultTransitionSeconds, 30), 0, 900));
  }
  if (body.status !== undefined) changes.status = deleting ? "inactive" : "ready";
  const updated = await patchRecord(db, "Activities", text(activity.activityId), changes) || activity;
  if (deleting) {
    for (const schedule of await listRecords(db, "ActivitySchedules")) {
      if (text(schedule.activityId) === text(activity.activityId) && text(schedule.status) === "active") {
        await patchRecord(db, "ActivitySchedules", text(schedule.scheduleId), { status: "cancelled", updatedAt: nowIso() });
      }
    }
    for (const device of await listRecords(db, "Devices")) {
      if (text(device.activityId) === text(activity.activityId)) {
        await patchRecord(db, "Devices", text(device.deviceId), { activityId: "", updatedAt: nowIso() });
      }
    }
    if (text(hotel.activePublicActivityId) === text(activity.activityId)) {
      await patchRecord(db, "Hotels", text(hotel.hotelId), { activePublicActivityId: "", updatedAt: nowIso() });
    }
    const runtime = await getActivityRuntime(db, text(activity.activityId));
    if (runtime) await upsertActivityRuntime(db, { ...runtime, accepting: false, running: false, updatedAt: nowIso() });
  }
  await audit(db, {
    userId: auth.user.userId,
    action: deleting ? "activity.deleted" : body.status !== undefined ? "activity.restored" : "activity.updated",
    hotelId: activity.hotelId,
    venueId: activity.venueId,
    activityId: activity.activityId,
    details: changes
  });
  return { ok: true, activity: activityWithLanguages(updated), recoverable: deleting };
}

async function updateActivityLanguages(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  const context = await tenantContext(db, auth, body);
  if (!context.activity || !context.venue) throw new Error("ACTIVITY_REQUIRED");
  if (text(auth.user.role) !== "superhost") requirePermission(context, "canChangeSchedule");
  const allowedLanguages = normalizeLanguages(body.allowedLanguages);
  const updated = await patchRecord(db, "Activities", text(context.activity.activityId), {
    allowedLanguagesJson: JSON.stringify(allowedLanguages), updatedAt: nowIso()
  }) || context.activity;
  await audit(db, { userId: auth.user.userId, action: "activity.languages.updated", hotelId: context.hotel.hotelId, venueId: context.venue.venueId, activityId: context.activity.activityId, details: { allowedLanguages } });
  return { ok: true, activity: activityWithLanguages(updated) };
}

async function assignUser(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  if (text(auth.user.role) !== "superhost") throw new Error("FORBIDDEN");
  const user = await getRecord(db, "Users", text(body.userId));
  if (!user || text(user.status) !== "active") return { ok: false, code: "USER_NOT_FOUND" };
  const context = await tenantContext(db, auth, body);
  const venueId = text(context.venue?.venueId);
  const activityId = text(context.activity?.activityId);
  const assignments = await listRecords(db, "UserAssignments");
  const existing = assignments.find((assignment) =>
    text(assignment.userId) === text(user.userId) &&
    text(assignment.hotelId) === text(context.hotel.hotelId) &&
    text(assignment.venueId) === venueId && text(assignment.activityId) === activityId &&
    text(assignment.status) === "active"
  );
  const requested = parseObject(body.permissions);
  const cleanPermissions: JsonObject = {};
  if (requested.all === true) cleanPermissions.all = true;
  for (const permission of PERMISSIONS) if (typeof requested[permission] === "boolean") cleanPermissions[permission] = requested[permission];
  const stamp = nowIso();
  const assignment = existing
    ? await patchRecord(db, "UserAssignments", text(existing.assignmentId), { permissionsJson: JSON.stringify(cleanPermissions), updatedAt: stamp })
    : await save(db, "UserAssignments", {
      assignmentId: randomId(), userId: user.userId, hotelId: context.hotel.hotelId,
      venueId, activityId, permissionsJson: JSON.stringify(cleanPermissions),
      status: "active", createdAt: stamp, updatedAt: stamp
    });
  await audit(db, { userId: auth.user.userId, action: existing ? "assignment.updated" : "assignment.created", hotelId: context.hotel.hotelId, venueId, activityId, targetId: user.userId });
  return { ok: true, assignment, idempotent: Boolean(existing) };
}

async function revokeAssignment(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  if (text(auth.user.role) !== "superhost") throw new Error("FORBIDDEN");
  const assignment = await getRecord(db, "UserAssignments", text(body.assignmentId));
  if (!assignment) return { ok: false, code: "ASSIGNMENT_NOT_FOUND" };
  await patchRecord(db, "UserAssignments", text(assignment.assignmentId), { status: "revoked", updatedAt: nowIso() });
  await audit(db, { userId: auth.user.userId, action: "assignment.revoked", hotelId: assignment.hotelId, targetId: assignment.assignmentId });
  return { ok: true };
}

async function revokeDevice(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  if (text(auth.user.role) !== "superhost") throw new Error("FORBIDDEN");
  const device = await getRecord(db, "Devices", text(body.deviceId));
  if (!device) return { ok: false, code: "DEVICE_NOT_FOUND" };
  await patchRecord(db, "Devices", text(device.deviceId), { status: "revoked", updatedAt: nowIso() });
  for (const session of await listRecords(db, "AuthSessions")) {
    if (text(session.deviceId) === text(device.deviceId) && !text(session.revokedAt)) {
      await patchRecord(db, "AuthSessions", text(session.authSessionId), { revokedAt: nowIso() }, "master", false);
    }
  }
  await audit(db, { userId: auth.user.userId, action: "device.revoked", targetId: device.deviceId });
  return { ok: true };
}

async function selectActivity(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  const context = await tenantContext(db, auth, body);
  if (!context.activity || !context.venue) throw new Error("ACTIVITY_REQUIRED");
  if (auth.device) {
    await patchRecord(db, "Devices", text(auth.device.deviceId), {
      hotelId: context.hotel.hotelId,
      venueId: context.venue.venueId,
      activityId: context.activity.activityId,
      lastHeartbeatAt: nowIso(),
      updatedAt: nowIso()
    });
  }
  return selectedState(db, auth, context);
}

async function writeRuntime(
  db: D1DatabaseLike,
  context: Context,
  changes: Partial<ActivityRuntime>,
  body: JsonObject
) {
  if (!context.activity) throw new Error("ACTIVITY_REQUIRED");
  const current = await runtimeFor(db, context.activity, context.hotel);
  const requestedSource = text(body.source).toLowerCase();
  const lockedMode = current.running && changes.running !== false
    ? playbackModeForRuntime(current)
    : "";
  const nextSource = lockedMode || (
    ["player", "bridge", "web"].includes(requestedSource)
      ? requestedSource
      : text(current.lastSource) || "web"
  );
  const next: ActivityRuntime = {
    ...current,
    ...changes,
    activityId: text(context.activity.activityId),
    hotelId: text(context.hotel.hotelId),
    venueId: text(context.venue?.venueId || context.activity.venueId),
    stateRevision: current.stateRevision + 1,
    lastSource: nextSource,
    updatedAt: nowIso()
  };
  await upsertActivityRuntime(db, next);
  return next;
}

async function updatePlayerRuntime(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  const context = await tenantContext(db, auth, body);
  if (!context.activity) throw new Error("ACTIVITY_REQUIRED");
  const runtime = await runtimeFor(db, context.activity, context.hotel);
  if (!runtime.running || playbackModeForRuntime(runtime) !== "player") {
    return { ok: false, code: "PLAYER_MODE_NOT_ACTIVE" };
  }
  const activityId = text(context.activity.activityId);
  const existing = await playerRuntimeFor(db, activityId);
  const queueOrder = body.queueOrder === undefined
    ? existing.queueOrder
    : cleanPlayerQueueOrder(body.queueOrder);
  const stamp = nowIso();
  const requestedPlayback = body.playback && typeof body.playback === "object" && !Array.isArray(body.playback)
    ? body.playback as JsonObject
    : {};
  const playback = body.playback === undefined
    ? existing.playback
    : cleanPlayerPlayback({ ...requestedPlayback, updatedAt: stamp }, existing.playback as JsonObject);
  const saved = await save(db, "PlayerActivityRuntime", {
    playerRuntimeId: activityId,
    activityId,
    hotelId: text(context.hotel.hotelId),
    queueOrder,
    playback,
    updatedAt: stamp
  }, "master", false);
  return {
    ok: true,
    playerRuntime: {
      ...saved,
      queueOrder: cleanPlayerQueueOrder(saved.queueOrder),
      playback: cleanPlayerPlayback(saved.playback, playback as JsonObject),
      updatedAt: stamp
    }
  };
}

async function resetPlayerRuntime(db: D1DatabaseLike, context: Context) {
  if (!context.activity) return;
  const activityId = text(context.activity.activityId);
  const stamp = nowIso();
  await save(db, "PlayerActivityRuntime", {
    playerRuntimeId: activityId,
    activityId,
    hotelId: text(context.hotel.hotelId),
    queueOrder: [],
    playback: {
      currentRequestId: "",
      currentTimeSeconds: 0,
      scene: "lobby",
      wasPlaying: false,
      updatedAt: stamp
    },
    updatedAt: stamp
  }, "master", false);
}

async function ensureCycle(
  db: D1DatabaseLike,
  auth: Auth,
  context: Context,
  status: "scheduled" | "in_progress",
  forceNew = false
) {
  if (!context.activity) throw new Error("ACTIVITY_REQUIRED");
  const scope = text(context.hotel.hotelId);
  let cycle = !forceNew && text(context.activity.currentCycleId)
    ? await getRecord(db, "ActivityCycles", text(context.activity.currentCycleId), scope)
    : null;
  if (!cycle || ["finished", "archived"].includes(text(cycle.status))) {
    const stamp = nowIso();
    cycle = await save(db, "ActivityCycles", {
      cycleId: randomId(), activityId: context.activity.activityId,
      hotelId: context.hotel.hotelId, venueId: context.venue?.venueId || context.activity.venueId,
      startedByUserId: auth.user.userId,
      scheduledStartAt: context.activity.scheduledStartAt || "",
      startedAt: status === "in_progress" ? stamp : "",
      finishedAt: "", status, archivedAt: ""
    }, scope);
  } else {
    cycle = await patchRecord(db, "ActivityCycles", text(cycle.cycleId), {
      startedAt: text(cycle.startedAt) || (status === "in_progress" ? nowIso() : ""),
      status
    }, scope) || cycle;
  }
  context.activity = await patchRecord(db, "Activities", text(context.activity.activityId), {
    currentCycleId: cycle.cycleId,
    status: status === "in_progress" ? "in_progress" : "scheduled",
    updatedAt: nowIso()
  }) || context.activity;
  return cycle;
}

async function activatePublicActivity(db: D1DatabaseLike, context: Context) {
  if (!context.activity) return;
  context.hotel = await patchRecord(db, "Hotels", text(context.hotel.hotelId), {
    activePublicActivityId: context.activity.activityId, updatedAt: nowIso()
  }) || context.hotel;
}

async function startActivity(
  db: D1DatabaseLike,
  auth: Auth,
  body: JsonObject,
  startNew: boolean
) {
  const context = await tenantContext(db, auth, body);
  if (!context.activity || !context.venue) throw new Error("ACTIVITY_REQUIRED");
  requirePermission(context, startNew ? "canStartNewActivity" : "canStartActivity");
  const requestedMode = text(body.source).toLowerCase();
  if (requestedMode !== "player" && requestedMode !== "bridge") {
    return { ok: false, code: "PLAYBACK_MODE_REQUIRED" };
  }
  const previousRuntime = await runtimeFor(db, context.activity, context.hotel);
  const lockedMode = playbackModeForRuntime(previousRuntime);
  if (previousRuntime.running && startNew) {
    return { ok: false, code: "ACTIVITY_ALREADY_RUNNING", playbackMode: lockedMode };
  }
  if (previousRuntime.running && lockedMode && lockedMode !== requestedMode) {
    return { ok: false, code: "PLAYBACK_MODE_LOCKED", playbackMode: lockedMode };
  }
  if (previousRuntime.running && lockedMode === requestedMode) {
    return selectedState(db, auth, context);
  }
  if (startNew) {
    const archivedAt = nowIso();
    await archiveActiveRequests(db, text(context.hotel.hotelId), text(context.activity.activityId), archivedAt);
  }
  const cycle = await ensureCycle(db, auth, context, "in_progress", startNew);
  await activatePublicActivity(db, context);
  if (startNew || !previousRuntime.running) await resetPlayerRuntime(db, context);
  await writeRuntime(db, context, {
    cycleId: text(cycle.cycleId), accepting: true, running: true,
    startedAt: text(cycle.startedAt) || nowIso(), finishedAt: "",
    lastAction: startNew ? "activity.startNew" : "activity.start"
  }, body);
  await audit(db, { userId: auth.user.userId, deviceId: auth.device?.deviceId, action: startNew ? "activity.startNew" : "activity.start", hotelId: context.hotel.hotelId, venueId: context.venue.venueId, activityId: context.activity.activityId, targetId: cycle.cycleId });
  return selectedState(db, auth, context);
}

async function finishActivity(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  const context = await tenantContext(db, auth, body);
  if (!context.activity) throw new Error("ACTIVITY_REQUIRED");
  requirePermission(context, "canFinishActivity");
  await processD1ActivitySchedules(db, text(context.hotel.hotelId));
  context.activity = await getRecord(db, "Activities", text(context.activity.activityId)) || context.activity;
  const stamp = nowIso();
  const scope = text(context.hotel.hotelId);
  if (text(context.activity.currentCycleId)) {
    await patchRecord(db, "ActivityCycles", text(context.activity.currentCycleId), {
      finishedAt: stamp, status: "finished"
    }, scope);
  }
  const currentScheduleId = text(context.activity.currentScheduleId);
  const currentSchedule = currentScheduleId
    ? await getRecord(db, "ActivitySchedules", currentScheduleId)
    : null;
  const completedOccurrence = text(
    currentSchedule?.lastOccurrenceAt || context.activity.currentScheduleOccurrenceAt
  );
  context.activity = await patchRecord(db, "Activities", text(context.activity.activityId), {
    status: "finished",
    lastCompletedScheduleId: currentScheduleId,
    lastCompletedScheduleOccurrenceAt: completedOccurrence,
    updatedAt: stamp
  }) || context.activity;
  await writeRuntime(db, context, { accepting: false, running: false, finishedAt: stamp, lastAction: "activity.finish" }, body);
  await audit(db, { userId: auth.user.userId, action: "activity.finish", hotelId: context.hotel.hotelId, venueId: context.venue?.venueId, activityId: context.activity.activityId });
  return selectedState(db, auth, context);
}

async function archiveQueue(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  const context = await tenantContext(db, auth, body);
  if (!context.activity) throw new Error("ACTIVITY_REQUIRED");
  requirePermission(context, "canArchiveQueue");
  const stamp = nowIso();
  await archiveActiveRequests(db, text(context.hotel.hotelId), text(context.activity.activityId), stamp);
  if (text(context.activity.currentCycleId)) {
    await patchRecord(db, "ActivityCycles", text(context.activity.currentCycleId), { status: "archived", archivedAt: stamp }, text(context.hotel.hotelId));
  }
  context.activity = await patchRecord(db, "Activities", text(context.activity.activityId), {
    status: "ready", currentCycleId: "", updatedAt: stamp
  }) || context.activity;
  await resetPlayerRuntime(db, context);
  await writeRuntime(db, context, { cycleId: "", accepting: false, running: false, startedAt: "", finishedAt: "", lastAction: "queue.archiveClear" }, body);
  await audit(db, { userId: auth.user.userId, action: "queue.archiveClear", hotelId: context.hotel.hotelId, activityId: context.activity.activityId });
  return selectedState(db, auth, context);
}

async function toggleRequests(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  const context = await tenantContext(db, auth, body);
  if (!context.activity) throw new Error("ACTIVITY_REQUIRED");
  requirePermission(context, "canOpenCloseRequests");
  const open = body.open === true;
  let cycle: JsonObject | null = null;
  if (open && text(context.activity.status) !== "in_progress") {
    cycle = await ensureCycle(db, auth, context, "scheduled");
    context.activity = await patchRecord(db, "Activities", text(context.activity.activityId), {
      status: "scheduled", acceptEarlyRequests: true, updatedAt: nowIso()
    }) || context.activity;
    await activatePublicActivity(db, context);
  }
  await writeRuntime(db, context, {
    cycleId: text(cycle?.cycleId || context.activity.currentCycleId),
    accepting: open,
    lastAction: open ? "requests.open" : "requests.close"
  }, body);
  await audit(db, { userId: auth.user.userId, action: open ? "requests.open" : "requests.close", hotelId: context.hotel.hotelId, activityId: context.activity.activityId });
  return selectedState(db, auth, context);
}

async function updateActivitySettings(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  const context = await tenantContext(db, auth, body);
  if (!context.activity) throw new Error("ACTIVITY_REQUIRED");
  const changes: JsonObject = { updatedAt: nowIso() };
  if (body.defaultDurationSeconds !== undefined) {
    requirePermission(context, "canChangeDuration");
    changes.defaultDurationSeconds = Math.round(bounded(body.defaultDurationSeconds, numberValue(context.activity.defaultDurationSeconds, 7200), 900, 604800));
  }
  if (body.defaultTransitionSeconds !== undefined) {
    requirePermission(context, "canChangeTransition");
    changes.defaultTransitionSeconds = Math.round(bounded(body.defaultTransitionSeconds, numberValue(context.activity.defaultTransitionSeconds, 30), 0, 900));
  }
  if (body.showPublicStatus !== undefined) {
    requirePermission(context, "canShowHidePublicStatus");
    changes.showPublicStatus = body.showPublicStatus === true;
  }
  if (body.scheduledStartAt !== undefined || body.showCountdown !== undefined || body.autoStartEnabled !== undefined || body.acceptEarlyRequests !== undefined) {
    requirePermission(context, "canChangeSchedule");
    if (body.scheduledStartAt !== undefined) {
      const value = text(body.scheduledStartAt);
      if (value && !Number.isFinite(Date.parse(value))) return { ok: false, code: "INVALID_SCHEDULE" };
      changes.scheduledStartAt = value;
    }
    if (body.showCountdown !== undefined) changes.showCountdown = body.showCountdown === true;
    if (body.autoStartEnabled !== undefined) changes.autoStartEnabled = body.autoStartEnabled === true;
    if (body.acceptEarlyRequests !== undefined) changes.acceptEarlyRequests = body.acceptEarlyRequests === true;
  }
  if (body.allowedLanguages !== undefined) {
    if (text(auth.user.role) !== "superhost") requirePermission(context, "canChangeSchedule");
    changes.allowedLanguagesJson = JSON.stringify(normalizeLanguages(body.allowedLanguages));
  }
  context.activity = await patchRecord(db, "Activities", text(context.activity.activityId), changes) || context.activity;
  await activatePublicActivity(db, context);
  const runtime = await runtimeFor(db, context.activity, context.hotel);
  await writeRuntime(db, context, { ...runtime, lastAction: "activity.settings" }, body);
  await audit(db, { userId: auth.user.userId, action: "activity.settings", hotelId: context.hotel.hotelId, activityId: context.activity.activityId, details: changes });
  return selectedState(db, auth, context);
}

function scheduleRecurrence(value: unknown) {
  const requested = text(value).toLowerCase();
  if (requested === "biweekly") return { type: "weekly", interval: 2, requested };
  if (["daily", "weekly", "monthly"].includes(requested)) {
    return { type: requested, interval: 1, requested };
  }
  return { type: "none", interval: 1, requested: "none" };
}

function normalizedRecurrenceDays(value: unknown) {
  let requested: unknown = value;
  if (typeof requested === "string") {
    try { requested = JSON.parse(requested || "[]"); }
    catch { requested = []; }
  }
  return Array.isArray(requested)
    ? [...new Set(requested.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
    : [];
}

function scheduleTime(value: unknown) {
  const candidate = text(value);
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(candidate) ? candidate : "";
}

function localTimeFor(date: Date, timeZone: unknown) {
  const local = zonedCalendarDate(date, timeZone);
  return `${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}`;
}

function firstRecurringOccurrence(
  timeValue: unknown,
  recurrenceType: string,
  recurrenceDaysValue: unknown,
  recurrenceDayOfMonthValue: unknown,
  timeZone: unknown,
  after = new Date()
) {
  const time = scheduleTime(timeValue);
  if (!time) return new Date("");
  const [hour, minute] = time.split(":").map(Number);
  const allowedDays = normalizedRecurrenceDays(recurrenceDaysValue);
  const localNow = zonedCalendarDate(after, timeZone);
  const targetDayOfMonth = Math.min(31, Math.max(1, Math.round(numberValue(
    recurrenceDayOfMonthValue,
    localNow.getUTCDate()
  ))));
  for (let offset = 0; offset <= 400; offset += 1) {
    const candidate = new Date(localNow.getTime());
    candidate.setUTCHours(hour, minute, 0, 0);
    candidate.setUTCDate(candidate.getUTCDate() + offset);
    const allowed = recurrenceType === "daily"
      || (recurrenceType === "weekly" && allowedDays.includes(candidate.getUTCDay()))
      || (recurrenceType === "monthly" && candidate.getUTCDate() === Math.min(
        targetDayOfMonth,
        new Date(Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, 0)).getUTCDate()
      ));
    if (!allowed) continue;
    const utc = localDateTimeToUtc(localCalendarText(candidate), timeZone);
    if (Number.isFinite(utc.getTime()) && utc.getTime() > after.getTime()) return utc;
  }
  return new Date("");
}

type WeekdayAnnouncement = {
  weekday: number;
  time: string;
  title: string;
  message: string;
};

function normalizedWeekdayAnnouncements(value: unknown, allowedDays: number[] = []) {
  let requested: unknown = value;
  if (typeof requested === "string") {
    try { requested = JSON.parse(requested || "[]"); }
    catch { requested = []; }
  }
  if (requested && typeof requested === "object" && !Array.isArray(requested)) {
    requested = Object.entries(requested as JsonObject).map(([weekday, announcement]) => ({
      weekday: Number(weekday),
      ...parseObject(announcement)
    }));
  }
  if (!Array.isArray(requested)) return [];
  const unique = new Map<number, WeekdayAnnouncement>();
  for (const item of requested) {
    const record = parseObject(item);
    const weekday = Number(record.weekday);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
    if (allowedDays.length && !allowedDays.includes(weekday)) continue;
    const announcement = {
      weekday,
      time: scheduleTime(record.time),
      title: limitedText(record.title, 120),
      message: limitedText(record.message, 500)
    };
    if (!announcement.time && !announcement.title && !announcement.message) continue;
    unique.set(weekday, announcement);
  }
  return [...unique.values()].sort((left, right) => left.weekday - right.weekday);
}

function scheduleInput(
  context: Context,
  body: JsonObject,
  existing: JsonObject | null = null
) {
  const requestedRecurrence = body.recurrenceType === undefined
    ? text(existing?.recurrenceType) === "weekly" && numberValue(existing?.recurrenceInterval, 1) === 2
      ? "biweekly"
      : text(existing?.recurrenceType) || "none"
    : text(body.recurrenceType);
  const recurrence = scheduleRecurrence(requestedRecurrence);
  const recurrenceInterval = requestedRecurrence === "biweekly"
    ? 2
    : Math.round(bounded(
      body.recurrenceInterval,
      numberValue(existing?.recurrenceInterval, recurrence.interval),
      1,
      52
    ));
  const existingDays = normalizedRecurrenceDays(existing?.recurrenceDaysJson);
  const recurrenceDays = body.recurrenceDays === undefined
    ? existingDays
    : normalizedRecurrenceDays(body.recurrenceDays);
  const existingStart = new Date(text(existing?.scheduledStartAt));
  const requestedTime = scheduleTime(
    body.scheduledTime === undefined
      ? Number.isFinite(existingStart.getTime()) ? localTimeFor(existingStart, context.hotel.timezone) : ""
      : body.scheduledTime
  );
  const raw = text(body.scheduledStartAt || body.scheduledLocal);
  let scheduledStart = raw
    ? localDateTimeToUtc(raw, context.hotel.timezone)
    : existing && body.scheduledTime === undefined && body.recurrenceType === undefined
      ? existingStart
      : firstRecurringOccurrence(
        requestedTime,
        recurrence.type,
        recurrenceDays,
        body.recurrenceDayOfMonth ?? existing?.recurrenceDayOfMonth,
        context.hotel.timezone
      );
  if (recurrence.type === "none" && !raw && !existing) scheduledStart = new Date("");
  if (!Number.isFinite(scheduledStart.getTime())) {
    return { ok: false as const, code: recurrence.type === "none" ? "ONE_TIME_DATE_REQUIRED" : "RECURRENCE_TIME_REQUIRED" };
  }
  const localStart = zonedCalendarDate(scheduledStart, context.hotel.timezone);
  if (recurrence.type === "weekly" && !recurrenceDays.length) {
    return { ok: false as const, code: "RECURRENCE_DAYS_REQUIRED" };
  }
  const durationSeconds = Math.round(bounded(
    body.durationSeconds,
    numberValue(existing?.durationSeconds, numberValue(context.activity?.defaultDurationSeconds, 7200)),
    900,
    604800
  ));
  const previousLead = Number.isFinite(Date.parse(text(existing?.requestOpeningAt)))
    ? Math.max(0, (Date.parse(text(existing?.scheduledStartAt)) - Date.parse(text(existing?.requestOpeningAt))) / 1000)
    : 3600;
  const openingLead = Math.round(bounded(
    body.requestOpeningLeadSeconds,
    numberValue(existing?.requestOpeningLeadSeconds, previousLead),
    0,
    604800
  ));
  const autoOpenRequests = body.autoOpenRequests === undefined
    ? bool(existing?.autoOpenRequests)
    : body.autoOpenRequests === true;
  const allowedAnnouncementDays = recurrence.type === "weekly"
    ? recurrenceDays
    : recurrence.type === "none"
      ? [localStart.getUTCDay()]
      : [];
  const announcements = body.weekdayAnnouncements === undefined
    ? normalizedWeekdayAnnouncements(existing?.weekdayAnnouncementsJson, allowedAnnouncementDays)
    : normalizedWeekdayAnnouncements(body.weekdayAnnouncements, allowedAnnouncementDays);
  const recurrenceDayOfMonth = Math.min(31, Math.max(1, Math.round(numberValue(
    body.recurrenceDayOfMonth,
    numberValue(existing?.recurrenceDayOfMonth, localStart.getUTCDate())
  ))));
  return {
    ok: true as const,
    fields: {
      scheduledStartAt: scheduledStart.toISOString(),
      durationSeconds,
      requestOpeningLeadSeconds: openingLead,
      requestOpeningAt: autoOpenRequests
        ? new Date(scheduledStart.getTime() - openingLead * 1000).toISOString()
        : "",
      autoOpenRequests,
      autoStartActivity: false,
      showCountdown: body.showCountdown === undefined ? existing?.showCountdown !== false : body.showCountdown !== false,
      recurrenceType: recurrence.type,
      recurrenceInterval,
      recurrenceDaysJson: JSON.stringify(recurrenceDays),
      recurrenceDayOfMonth,
      recurrenceTime: requestedTime || localTimeFor(scheduledStart, context.hotel.timezone),
      recurrenceEndAt: body.recurrenceEndAt === undefined ? text(existing?.recurrenceEndAt) : text(body.recurrenceEndAt),
      weekdayAnnouncementsJson: JSON.stringify(announcements)
    }
  };
}

async function scheduleActivity(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  const context = await tenantContext(db, auth, body);
  if (!context.activity || !context.venue) throw new Error("ACTIVITY_REQUIRED");
  requirePermission(context, "canChangeSchedule");
  const normalized = scheduleInput(context, body);
  if (!normalized.ok) return normalized;
  const stamp = nowIso();
  const schedule = await save(db, "ActivitySchedules", {
    scheduleId: randomId(), hotelId: context.hotel.hotelId, venueId: context.venue.venueId,
    activityId: context.activity.activityId,
    ...normalized.fields,
    status: "active", lastOccurrenceAt: "", lastOccurrenceEndAt: "",
    createdByUserId: auth.user.userId, createdAt: stamp, updatedAt: stamp
  });
  context.activity = await patchRecord(db, "Activities", text(context.activity.activityId), {
    status: text(context.activity.status) === "in_progress" ? "in_progress" : "scheduled",
    defaultDurationSeconds: normalized.fields.durationSeconds,
    scheduledStartAt: normalized.fields.scheduledStartAt,
    currentScheduleId: schedule.scheduleId,
    currentScheduleOccurrenceAt: normalized.fields.scheduledStartAt,
    showCountdown: normalized.fields.showCountdown,
    autoStartEnabled: false,
    acceptEarlyRequests: normalized.fields.autoOpenRequests,
    updatedAt: stamp
  }) || context.activity;
  await activatePublicActivity(db, context);
  if (text(context.activity.status) !== "in_progress") {
    await writeRuntime(db, context, {
      accepting: false,
      running: false,
      startedAt: "",
      finishedAt: "",
      lastAction: "schedule.created"
    }, body);
  }
  await audit(db, { userId: auth.user.userId, action: "activity.scheduled", hotelId: context.hotel.hotelId, venueId: context.venue.venueId, activityId: context.activity.activityId, targetId: schedule.scheduleId });
  await processD1ActivitySchedules(db, text(context.hotel.hotelId));
  return {
    ok: true,
    schedule: await getRecord(db, "ActivitySchedules", text(schedule.scheduleId)),
    activity: activityWithLanguages(await getRecord(db, "Activities", text(context.activity.activityId)))
  };
}

async function updateSchedule(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  const existing = await getRecord(db, "ActivitySchedules", text(body.scheduleId));
  if (!existing) return { ok: false, code: "SCHEDULE_NOT_FOUND" };
  const context = await tenantContext(db, auth, existing);
  if (!context.activity || !context.venue) throw new Error("ACTIVITY_REQUIRED");
  requirePermission(context, "canChangeSchedule");
  if (text(existing.status) !== "active") return { ok: false, code: "SCHEDULE_NOT_ACTIVE" };
  const normalized = scheduleInput(context, body, existing);
  if (!normalized.ok) return normalized;
  const stamp = nowIso();
  const schedule = await patchRecord(db, "ActivitySchedules", text(existing.scheduleId), {
    ...normalized.fields,
    lastOpenedFor: "",
    updatedAt: stamp
  }) || existing;
  if (text(context.activity.status) !== "in_progress") {
    context.activity = await patchRecord(db, "Activities", text(context.activity.activityId), {
      status: "scheduled",
      defaultDurationSeconds: normalized.fields.durationSeconds,
      scheduledStartAt: normalized.fields.scheduledStartAt,
      currentScheduleId: existing.scheduleId,
      currentScheduleOccurrenceAt: normalized.fields.scheduledStartAt,
      showCountdown: normalized.fields.showCountdown,
      autoStartEnabled: false,
      acceptEarlyRequests: normalized.fields.autoOpenRequests,
      updatedAt: stamp
    }) || context.activity;
  }
  await activatePublicActivity(db, context);
  await audit(db, {
    userId: auth.user.userId,
    action: "activity.scheduleUpdated",
    hotelId: context.hotel.hotelId,
    venueId: context.venue.venueId,
    activityId: context.activity.activityId,
    targetId: existing.scheduleId
  });
  await processD1ActivitySchedules(db, text(context.hotel.hotelId));
  return {
    ok: true,
    schedule: await getRecord(db, "ActivitySchedules", text(schedule.scheduleId)),
    activity: activityWithLanguages(await getRecord(db, "Activities", text(context.activity.activityId)))
  };
}

async function cancelSchedule(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  const schedule = await getRecord(db, "ActivitySchedules", text(body.scheduleId));
  if (!schedule) return { ok: false, code: "SCHEDULE_NOT_FOUND" };
  const context = await tenantContext(db, auth, schedule);
  if (!context.activity) throw new Error("ACTIVITY_REQUIRED");
  requirePermission(context, "canChangeSchedule");
  await patchRecord(db, "ActivitySchedules", text(schedule.scheduleId), {
    status: "cancelled", updatedAt: nowIso()
  });
  const remainingSchedules = (await listRecordsByJsonField(
    db,
    "ActivitySchedules",
    "hotelId",
    text(context.hotel.hotelId)
  )).filter((candidate) =>
    text(candidate.scheduleId) !== text(schedule.scheduleId) &&
    text(candidate.activityId) === text(context.activity?.activityId) &&
    text(candidate.status) === "active" &&
    Number.isFinite(Date.parse(text(candidate.scheduledStartAt)))
  ).sort((left, right) => Date.parse(text(left.scheduledStartAt)) - Date.parse(text(right.scheduledStartAt)));
  const nextSchedule = remainingSchedules[0] || null;
  context.activity = await patchRecord(db, "Activities", text(context.activity.activityId), {
    scheduledStartAt: text(nextSchedule?.scheduledStartAt),
    status: text(context.activity.status) === "in_progress"
      ? "in_progress"
      : nextSchedule ? "scheduled" : "ready",
    acceptEarlyRequests: nextSchedule ? bool(nextSchedule.autoOpenRequests) : false,
    updatedAt: nowIso()
  }) || context.activity;
  if (text(context.activity.status) !== "in_progress") {
    await writeRuntime(db, context, {
      accepting: false,
      running: false,
      startedAt: "",
      finishedAt: "",
      lastAction: "schedule.cancelled"
    }, { source: "web" });
  }
  await audit(db, { userId: auth.user.userId, action: "schedule.cancelled", hotelId: context.hotel.hotelId, activityId: context.activity.activityId, targetId: schedule.scheduleId });
  return selectedState(db, auth, context);
}

function recurrenceDays(value: unknown) {
  try {
    const values = JSON.parse(text(value) || "[]");
    return Array.isArray(values)
      ? [...new Set(values.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))]
      : [];
  } catch {
    return [];
  }
}

function announcementForOccurrence(
  schedule: JsonObject,
  occurrenceValue: unknown,
  hotelTimezone: unknown
) {
  const occurrence = new Date(text(occurrenceValue));
  if (!Number.isFinite(occurrence.getTime())) return null;
  const localOccurrence = zonedCalendarDate(occurrence, hotelTimezone);
  const announcement = normalizedWeekdayAnnouncements(schedule.weekdayAnnouncementsJson)
    .find((item) => item.weekday === localOccurrence.getUTCDay());
  if (!announcement) return null;
  let followingEventAt = "";
  if (announcement.time) {
    const [hour, minute] = announcement.time.split(":").map(Number);
    const localEvent = new Date(localOccurrence.getTime());
    localEvent.setUTCHours(hour, minute, 0, 0);
    let eventDate = localDateTimeToUtc(localCalendarText(localEvent), hotelTimezone);
    if (eventDate.getTime() <= occurrence.getTime()) {
      localEvent.setUTCDate(localEvent.getUTCDate() + 1);
      eventDate = localDateTimeToUtc(localCalendarText(localEvent), hotelTimezone);
    }
    if (Number.isFinite(eventDate.getTime())) followingEventAt = eventDate.toISOString();
  }
  const nextGuestStarAt = text(schedule.status) === "active"
    && Date.parse(text(schedule.scheduledStartAt)) > occurrence.getTime()
    ? text(schedule.scheduledStartAt)
    : "";
  return {
    scheduleId: text(schedule.scheduleId),
    weekday: announcement.weekday,
    title: announcement.title,
    message: announcement.message,
    followingEventAt,
    nextGuestStarAt
  };
}

async function postActivityAnnouncement(
  db: D1DatabaseLike,
  hotel: JsonObject,
  activity: JsonObject | null
) {
  if (!activity || text(activity.status) !== "finished") return null;
  const schedules = (await listRecordsByJsonField(
    db,
    "ActivitySchedules",
    "hotelId",
    text(hotel.hotelId)
  )).filter((schedule) => text(schedule.activityId) === text(activity.activityId));
  const requestedScheduleId = text(activity.lastCompletedScheduleId || activity.currentScheduleId);
  const requestedOccurrence = text(
    activity.lastCompletedScheduleOccurrenceAt || activity.currentScheduleOccurrenceAt
  );
  const selected = schedules.find((schedule) => text(schedule.scheduleId) === requestedScheduleId)
    || schedules.sort((left, right) =>
      Date.parse(text(right.lastOccurrenceAt || right.scheduledStartAt))
      - Date.parse(text(left.lastOccurrenceAt || left.scheduledStartAt))
    )[0];
  if (!selected) return null;
  const occurrence = requestedOccurrence
    || text(selected.lastOccurrenceAt)
    || text(selected.scheduledStartAt);
  return announcementForOccurrence(selected, occurrence, hotel.timezone);
}

function zonedCalendarDate(date: Date, timeZone: unknown) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: text(timeZone) || "UTC",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23"
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );
  return new Date(Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour), Number(parts.minute), Number(parts.second)
  ));
}

function localCalendarText(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

export function nextScheduleOccurrence(schedule: JsonObject, hotelTimezone: unknown) {
  const start = new Date(text(schedule.scheduledStartAt));
  if (!Number.isFinite(start.getTime())) return "";
  const interval = Math.max(1, Math.round(numberValue(schedule.recurrenceInterval, 1)));
  const type = text(schedule.recurrenceType);
  const localCalendar = zonedCalendarDate(start, hotelTimezone);
  if (type === "daily") {
    localCalendar.setUTCDate(localCalendar.getUTCDate() + interval);
  } else if (type === "monthly") {
    const originalDay = Math.min(31, Math.max(
      1,
      Math.round(numberValue(schedule.recurrenceDayOfMonth, localCalendar.getUTCDate()))
    ));
    const targetMonth = new Date(Date.UTC(
      localCalendar.getUTCFullYear(), localCalendar.getUTCMonth() + interval, 1
    ));
    const lastTargetDay = new Date(Date.UTC(
      targetMonth.getUTCFullYear(), targetMonth.getUTCMonth() + 1, 0
    )).getUTCDate();
    localCalendar.setUTCFullYear(targetMonth.getUTCFullYear(), targetMonth.getUTCMonth(), Math.min(originalDay, lastTargetDay));
  } else if (type === "weekly") {
    const allowed = recurrenceDays(schedule.recurrenceDaysJson);
    const days = (allowed.length ? allowed : [localCalendar.getUTCDay()]).sort((left, right) => left - right);
    const currentDay = localCalendar.getUTCDay();
    const laterDay = days.find((day) => day > currentDay);
    const offset = laterDay !== undefined
      ? laterDay - currentDay
      : 7 * interval - (currentDay - days[0]);
    localCalendar.setUTCDate(localCalendar.getUTCDate() + offset);
  } else {
    return "";
  }
  const next = localDateTimeToUtc(localCalendarText(localCalendar), hotelTimezone);
  if (!Number.isFinite(next.getTime())) return "";
  const recurrenceEnd = Date.parse(text(schedule.recurrenceEndAt));
  if (Number.isFinite(recurrenceEnd) && next.getTime() > recurrenceEnd) return "";
  return next.toISOString();
}

export async function processD1ActivitySchedules(db: D1DatabaseLike, onlyHotelId = "") {
  const now = Date.now();
  const scheduleRows = onlyHotelId
    ? await listRecordsByJsonField(db, "ActivitySchedules", "hotelId", onlyHotelId)
    : await listRecords(db, "ActivitySchedules");
  const schedules = scheduleRows
    .filter((schedule) => text(schedule.status) === "active")
    .filter((schedule) => {
      const startAt = Date.parse(text(schedule.scheduledStartAt));
      if (!Number.isFinite(startAt)) return false;
      if (startAt <= now) return true;
      if (!bool(schedule.autoOpenRequests)) return false;
      if (text(schedule.lastOpenedFor) === text(schedule.scheduledStartAt)) return false;
      const explicitOpeningAt = Date.parse(text(schedule.requestOpeningAt));
      const openingLeadMilliseconds = Math.max(0, numberValue(schedule.requestOpeningLeadSeconds)) * 1000;
      const openingAt = Number.isFinite(explicitOpeningAt)
        ? explicitOpeningAt
        : startAt - openingLeadMilliseconds;
      return openingAt <= now;
    })
    .sort((left, right) => Date.parse(text(left.scheduledStartAt)) - Date.parse(text(right.scheduledStartAt)));
  if (!schedules.length) return [];

  const recordsByIds = async (tableName: string, ids: string[]) => {
    const records = await Promise.all(
      [...new Set(ids.filter(Boolean))].map((recordId) => getRecord(db, tableName, recordId))
    );
    return records.filter((record): record is JsonObject => Boolean(record));
  };
  const [hotels, activities, venues, users] = onlyHotelId
    ? await Promise.all([
        recordsByIds("Hotels", schedules.map((schedule) => text(schedule.hotelId))),
        recordsByIds("Activities", schedules.map((schedule) => text(schedule.activityId))),
        recordsByIds("Venues", schedules.map((schedule) => text(schedule.venueId))),
        recordsByIds("Users", schedules.map((schedule) => text(schedule.createdByUserId)))
      ])
    : await Promise.all([
        listRecords(db, "Hotels"),
        listRecords(db, "Activities"),
        listRecords(db, "Venues"),
        listRecords(db, "Users")
      ]);
  const processed: JsonObject[] = [];

  for (const schedule of schedules) {
    const hotel = hotels.find((record) => text(record.hotelId) === text(schedule.hotelId));
    let activity = activities.find((record) => text(record.activityId) === text(schedule.activityId));
    const venue = venues.find((record) => text(record.venueId) === text(schedule.venueId));
    const owner = users.find((record) => text(record.userId) === text(schedule.createdByUserId));
    if (!hotel || !activity || !venue || !owner || text(hotel.status) !== "active" || text(owner.status) !== "active") continue;
    if (text(activity.hotelId) !== text(hotel.hotelId) || text(venue.hotelId) !== text(hotel.hotelId)) continue;

    const occurrence = text(schedule.scheduledStartAt);
    const startAt = Date.parse(occurrence);
    const durationMilliseconds = Math.max(900, numberValue(schedule.durationSeconds, 7200)) * 1000;
    const openingLeadMilliseconds = Math.max(0, numberValue(
      schedule.requestOpeningLeadSeconds,
      Number.isFinite(Date.parse(text(schedule.requestOpeningAt))) && Number.isFinite(startAt)
        ? Math.max(0, startAt - Date.parse(text(schedule.requestOpeningAt))) / 1000
        : 0
    )) * 1000;
    let lastOccurrence = "";
    let nextOccurrence = occurrence;
    let cursor = { ...schedule };
    for (let iteration = 0; iteration < 400; iteration += 1) {
      const cursorStart = Date.parse(text(cursor.scheduledStartAt));
      if (!Number.isFinite(cursorStart) || cursorStart > now) {
        nextOccurrence = text(cursor.scheduledStartAt);
        break;
      }
      lastOccurrence = text(cursor.scheduledStartAt);
      const next = nextScheduleOccurrence(cursor, hotel.timezone);
      if (!next) {
        nextOccurrence = "";
        break;
      }
      nextOccurrence = next;
      cursor = { ...cursor, scheduledStartAt: next };
    }
    const lastOccurrenceAt = Date.parse(lastOccurrence);
    const occurrenceInProgress = Number.isFinite(lastOccurrenceAt)
      && now < lastOccurrenceAt + durationMilliseconds;
    const activeOccurrence = occurrenceInProgress ? lastOccurrence : "";
    const nextOccurrenceAt = Date.parse(nextOccurrence);
    const earlyOccurrence = Number.isFinite(nextOccurrenceAt)
      && nextOccurrenceAt > now
      && now >= nextOccurrenceAt - openingLeadMilliseconds
      ? nextOccurrence
      : "";
    const openingOccurrence = activeOccurrence || earlyOccurrence;
    const openingAt = Date.parse(openingOccurrence) - openingLeadMilliseconds;
    if (
      bool(schedule.autoOpenRequests) &&
      openingOccurrence &&
      Number.isFinite(openingAt) && openingAt <= now &&
      text(activity.status) !== "in_progress" &&
      text(schedule.lastOpenedFor) !== openingOccurrence
    ) {
      const stamp = nowIso();
      const scheduleContext: Context = {
        hotel,
        venue,
        activity,
        permissions: {}
      };
      const scheduledCycle = await ensureCycle(
        db,
        { user: owner, session: {}, device: null },
        scheduleContext,
        "scheduled"
      );
      activity = scheduleContext.activity || activity;
      await patchRecord(db, "Hotels", text(hotel.hotelId), {
        activePublicActivityId: activity.activityId,
        updatedAt: stamp
      });
      activity = await patchRecord(db, "Activities", text(activity.activityId), {
        status: "scheduled",
        acceptEarlyRequests: true,
        scheduledStartAt: openingOccurrence,
        currentScheduleId: text(schedule.scheduleId),
        currentScheduleOccurrenceAt: openingOccurrence,
        updatedAt: stamp
      }) || activity;
      const currentRuntime = await runtimeFor(db, activity, hotel);
      const runtime: ActivityRuntime = {
        ...currentRuntime,
        hotelId: text(hotel.hotelId),
        venueId: text(venue.venueId),
        cycleId: text(scheduledCycle.cycleId),
        accepting: true,
        running: false,
        stateRevision: currentRuntime.stateRevision + 1,
        lastAction: "schedule.autoOpen",
        lastSource: "d1-automation",
        updatedAt: stamp
      };
      await upsertActivityRuntime(db, runtime);
      await patchRecord(db, "ActivitySchedules", text(schedule.scheduleId), {
        lastOpenedFor: openingOccurrence,
        updatedAt: stamp
      });
      processed.push({ scheduleId: schedule.scheduleId, action: "opened" });
    }

    if (lastOccurrence) {
      const scheduleChanges: JsonObject = {
        lastOccurrenceAt: lastOccurrence,
        lastOccurrenceEndAt: new Date(lastOccurrenceAt + durationMilliseconds).toISOString(),
        updatedAt: nowIso()
      };
      if (nextOccurrence) {
        scheduleChanges.scheduledStartAt = nextOccurrence;
        scheduleChanges.requestOpeningAt = bool(schedule.autoOpenRequests)
          ? new Date(Date.parse(nextOccurrence) - openingLeadMilliseconds).toISOString()
          : "";
      } else if (text(schedule.recurrenceType) === "none") {
        scheduleChanges.status = "completed";
      }
      await patchRecord(db, "ActivitySchedules", text(schedule.scheduleId), scheduleChanges);

      const sameFinishedOccurrence = text(activity.status) === "finished"
        && text(activity.currentScheduleOccurrenceAt) === lastOccurrence;
      const activityChanges: JsonObject = {
        currentScheduleId: text(schedule.scheduleId),
        currentScheduleOccurrenceAt: lastOccurrence,
        updatedAt: nowIso()
      };
      if (occurrenceInProgress) {
        activityChanges.scheduledStartAt = lastOccurrence;
        if (text(activity.status) !== "in_progress" && !sameFinishedOccurrence) {
          activityChanges.status = "scheduled";
        }
      } else if (nextOccurrence && text(activity.status) !== "in_progress") {
        activityChanges.scheduledStartAt = nextOccurrence;
        if (text(activity.status) !== "finished") activityChanges.status = "scheduled";
      }
      activity = await patchRecord(db, "Activities", text(activity.activityId), activityChanges) || activity;
    }
  }
  return processed;
}

async function updateBranding(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  const context = await tenantContext(db, auth, { hotelId: body.hotelId });
  requirePermission(context, "canManageHotelBranding");
  const requested = parseObject(body.branding);
  const allowed = [
    "teamDisplayName", "teamType", "tagline", "hotelLogoUrl", "teamLogoUrl",
    "primaryColor", "secondaryColor", "accentColor", "welcomeMessage",
    "inProgressTitle", "inProgressMessage", "activityFinishedMessage",
    "upcomingActivityMessage", "reviewInvitationMessage", "externalReviewProvider",
    "externalReviewUrl", "showHotelName", "showHotelLogo", "showTeamIdentity",
    "showActivityDetails", "showCountdown", "showNextActivity", "showInternalRating",
    "showExternalReview", "showRemindMe", "showAddToCalendar", "offerFollowUp",
    "activityEndingMessage", "generalReviewMessage", "beforeStartClosedTitle",
    "beforeStartClosedMessage", "beforeStartOpenTitle", "beforeStartOpenMessage",
    "requestsClosedTitle", "requestsClosedMessage", "activityFinishedTitle",
    "noActivityTitle", "noActivityMessage", "messageSourceLanguage",
    "translationMode", "localizedMessagesJson", "translationStatus", "translatedAt"
  ];
  const brandingRows = await listRecords(db, "HotelBranding");
  const existing = brandingRows.find((record) => text(record.hotelId) === text(context.hotel.hotelId));
  const changes: JsonObject = {};
  for (const field of allowed) if (requested[field] !== undefined) changes[field] = requested[field];
  const record = await save(db, "HotelBranding", {
    ...(existing || {}),
    hotelBrandingId: text(existing?.hotelBrandingId) || randomId(),
    hotelId: context.hotel.hotelId,
    ...changes,
    updatedAt: nowIso()
  });
  await audit(db, { userId: auth.user.userId, action: "hotel.branding.updated", hotelId: context.hotel.hotelId, targetId: record.hotelBrandingId });
  return { ok: true, branding: record };
}

async function listReviewsAction(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  const context = await tenantContext(db, auth, body);
  requirePermission(context, "canViewReviews");
  const reviews = (await listRecords(db, "Reviews", text(context.hotel.hotelId)))
    .filter((review) => !text(review.deletedAt) && text(review.status) !== "deleted")
    .sort((left, right) => Date.parse(text(right.createdAt)) - Date.parse(text(left.createdAt)));
  return { ok: true, reviews };
}

async function updateReviewAction(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  const context = await tenantContext(db, auth, body);
  requirePermission(context, body.operation === "delete" ? "canDeleteReviews" : "canViewReviews");
  const scope = text(context.hotel.hotelId);
  const review = await getRecord(db, "Reviews", text(body.reviewId), scope);
  if (
    !review ||
    text(review.hotelId) !== scope ||
    (context.activity && text(review.activityId) && text(review.activityId) !== text(context.activity.activityId)) ||
    (context.venue && text(review.venueId) && text(review.venueId) !== text(context.venue.venueId))
  ) return { ok: false, code: "REVIEW_NOT_FOUND" };
  const changes = body.operation === "delete"
    ? { status: "deleted", deletedAt: nowIso(), updatedAt: nowIso() }
    : { status: "archived", archivedAt: nowIso(), updatedAt: nowIso() };
  const updated = await patchRecord(db, "Reviews", text(review.reviewId), changes, scope);
  await audit(db, { userId: auth.user.userId, action: `review.${body.operation === "delete" ? "deleted" : "archived"}`, hotelId: context.hotel.hotelId, activityId: context.activity?.activityId, targetId: review.reviewId });
  return { ok: true, review: updated };
}

async function createOneTimeCode(db: D1DatabaseLike, auth: Auth) {
  if (!auth.device) return { ok: false, code: "BRIDGE_DEVICE_REQUIRED" };
  const rawCode = randomToken(40);
  const stamp = nowIso();
  const expiresAt = new Date(Date.now() + 90_000).toISOString();
  await save(db, "OneTimeLoginCodes", {
    codeId: randomId(), userId: auth.user.userId, deviceId: auth.device.deviceId,
    codeHash: await sessionHash(db, rawCode), createdAt: stamp, expiresAt, usedAt: ""
  }, "master", false);
  return { ok: true, url: `${HOST_BASE_URL}/bridge-login?code=${encodeURIComponent(rawCode)}`, expiresAt };
}

async function consumeOneTimeCode(db: D1DatabaseLike, body: JsonObject) {
  const codeHash = await sessionHash(db, body.code);
  const record = (await listRecords(db, "OneTimeLoginCodes"))
    .find((candidate) => safeEqual(candidate.codeHash, codeHash));
  if (!record || text(record.usedAt) || Date.parse(text(record.expiresAt)) <= Date.now()) {
    return { ok: false, code: "INVALID_OR_EXPIRED_CODE" };
  }
  const user = await getRecord(db, "Users", text(record.userId));
  const device = await getRecord(db, "Devices", text(record.deviceId));
  if (!user || text(user.status) !== "active" || !device || text(device.status) !== "active") {
    return { ok: false, code: "UNAUTHORIZED" };
  }
  const usedAt = nowIso();
  const consumed = await db.prepare(`
    UPDATE guest_star_records
    SET data_json = json_set(data_json, '$.usedAt', ?), updated_at = ?
    WHERE scope = 'master' AND table_name = 'OneTimeLoginCodes' AND record_id = ?
      AND COALESCE(json_extract(data_json, '$.usedAt'), '') = ''
  `).bind(usedAt, usedAt, text(record.codeId)).run();
  if (Number(consumed.meta?.changes) !== 1) {
    return { ok: false, code: "INVALID_OR_EXPIRED_CODE" };
  }
  const session = await createSession(db, user, "", true);
  await audit(db, { userId: user.userId, deviceId: device.deviceId, action: "web.oneTimeLogin" });
  return {
    ok: true, authToken: session.token, expiresAt: session.expiresAt,
    user: publicUser(user), selection: await accessibleSelection(db, user)
  };
}

async function bridgeHeartbeat(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  if (!auth.device) return { ok: false, code: "BRIDGE_DEVICE_REQUIRED" };
  const device = await patchRecord(db, "Devices", text(auth.device.deviceId), {
    bridgeVersion: text(body.bridgeVersion) || text(auth.device.bridgeVersion),
    virtualDJConnected: body.virtualDJConnected === true,
    lastHeartbeatAt: nowIso(), updatedAt: nowIso()
  }, "master", false) || auth.device;
  return { ok: true, serverNow: nowIso(), deviceId: device.deviceId };
}

async function queueBridgeCommand(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  const context = await tenantContext(db, auth, body);
  if (!context.activity) throw new Error("ACTIVITY_REQUIRED");
  requirePermission(context, "canControlVirtualDJ");
  const allowed = ["addRequest", "removeRequest", "markSang", "markSkipped", "undo", "synchronize", "moveRequest"];
  const commandType = text(body.commandType);
  if (!allowed.includes(commandType)) return { ok: false, code: "INVALID_COMMAND" };
  const deviceId = text(body.deviceId);
  const device = deviceId ? await getRecord(db, "Devices", deviceId) : null;
  const heartbeatAge = Date.now() - Date.parse(text(device?.lastHeartbeatAt));
  if (
    !device || text(device.status) !== "active" ||
    text(device.hotelId) !== text(context.hotel.hotelId) ||
    text(device.activityId) !== text(context.activity.activityId) ||
    !Number.isFinite(heartbeatAge) || heartbeatAge > 15_000
  ) return { ok: false, code: "BRIDGE_OFFLINE" };
  const requestedId = text(body.commandId);
  const commandId = /^[A-Za-z0-9_-]{8,80}$/.test(requestedId) ? requestedId : randomId();
  const existing = await getRecord(db, "BridgeCommands", commandId);
  if (existing) {
    if (text(existing.requestedByUserId) !== text(auth.user.userId)) throw new Error("FORBIDDEN");
    return { ok: true, command: existing, idempotent: true };
  }
  const command = await save(db, "BridgeCommands", {
    commandId, deviceId, requestedByUserId: auth.user.userId,
    activityId: context.activity.activityId, commandType,
    payloadJson: JSON.stringify(body.payload || {}), status: "pending",
    createdAt: nowIso(), startedAt: "", completedAt: "", resultJson: "", errorMessage: ""
  });
  await audit(db, { userId: auth.user.userId, deviceId, action: "bridgeCommand.queued", hotelId: context.hotel.hotelId, activityId: context.activity.activityId, targetId: command.commandId, details: { commandType } });
  return { ok: true, command, idempotent: false };
}

async function pollBridgeCommands(db: D1DatabaseLike, auth: Auth) {
  if (!auth.device) return { ok: false, code: "BRIDGE_DEVICE_REQUIRED" };
  if (!text(auth.device.activityId)) return { ok: false, code: "DEVICE_SELECTION_REQUIRED" };
  const commands: JsonObject[] = [];
  for (const command of await listRecords(db, "BridgeCommands")) {
    if (
      text(command.deviceId) !== text(auth.device.deviceId) ||
      text(command.activityId) !== text(auth.device.activityId) ||
      text(command.status) !== "pending"
    ) continue;
    const age = Date.now() - Date.parse(text(command.createdAt));
    if (!Number.isFinite(age) || age > 120_000) {
      await patchRecord(db, "BridgeCommands", text(command.commandId), {
        status: "expired", completedAt: nowIso(), errorMessage: "Bridge did not collect the command before it expired."
      });
      continue;
    }
    await patchRecord(db, "BridgeCommands", text(command.commandId), {
      status: "processing", startedAt: nowIso()
    });
    commands.push({
      commandId: command.commandId,
      commandType: command.commandType,
      payload: parseObject(command.payloadJson),
      createdAt: command.createdAt
    });
    if (commands.length >= 25) break;
  }
  return { ok: true, serverNow: nowIso(), commands };
}

async function completeBridgeCommand(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  if (!auth.device) return { ok: false, code: "BRIDGE_DEVICE_REQUIRED" };
  const command = await getRecord(db, "BridgeCommands", text(body.commandId));
  if (!command || text(command.deviceId) !== text(auth.device.deviceId)) return { ok: false, code: "COMMAND_NOT_FOUND" };
  if (["completed", "failed", "expired"].includes(text(command.status))) {
    return { ok: true, commandId: command.commandId, status: command.status, idempotent: true };
  }
  const updated = await patchRecord(db, "BridgeCommands", text(command.commandId), {
    status: body.ok === true ? "completed" : "failed",
    completedAt: nowIso(), resultJson: JSON.stringify(body.result || {}),
    errorMessage: text(body.errorMessage)
  });
  await audit(db, { userId: auth.user.userId, deviceId: auth.device.deviceId, action: body.ok === true ? "bridgeCommand.completed" : "bridgeCommand.failed", activityId: command.activityId, targetId: command.commandId });
  return { ok: true, commandId: updated?.commandId, status: updated?.status, idempotent: false };
}

async function bridgeRequestUpdate(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  if (!auth.device) return { ok: false, code: "BRIDGE_DEVICE_REQUIRED" };
  const activityId = text(auth.device.activityId || body.activityId);
  const hotelId = text(auth.device.hotelId || body.hotelId);
  const request = await findActiveRequest(db, hotelId, text(body.id));
  if (!request || (activityId && request.activityId !== activityId)) return { ok: false, code: "REQUEST_NOT_FOUND" };
  const allowedStatuses = new Set([
    "Pendiente", "Agregada a VirtualDJ", "Ya cantó", "Saltado",
    "Retirada del Player", "Fuera de VirtualDJ", "No está local", "Eliminada", "Cancelada",
    "Reagregada a VirtualDJ", "Reenviada a VirtualDJ", "Retirada de rotación"
  ]);
  const requestedStatus = text(body.status);
  const nextStatus = allowedStatuses.has(requestedStatus) ? requestedStatus : request.status;
  const nextFileName = body.fileName === undefined ? request.fileName : text(body.fileName);
  const nextDurationSeconds = body.durationSeconds === undefined
    ? request.durationSeconds
    : Math.max(0, numberValue(body.durationSeconds));
  const nextSourceUrl = body.sourceUrl === undefined ? request.sourceUrl : text(body.sourceUrl);
  const nextVirtualDJItemId = body.virtualDJItemId === undefined
    ? request.virtualDJItemId
    : text(body.virtualDJItemId);
  const nextQueuePosition = body.queuePosition === undefined
    ? request.queuePosition
    : Math.max(0, numberValue(body.queuePosition));
  const nextSyncState = body.syncState === undefined ? request.syncState : text(body.syncState);
  const nextLastSeenAt = body.lastSeenAt === undefined ? request.lastSeenAt : text(body.lastSeenAt);
  if (
    request.status === nextStatus &&
    request.fileName === nextFileName &&
    request.durationSeconds === nextDurationSeconds &&
    request.sourceUrl === nextSourceUrl &&
    request.virtualDJItemId === nextVirtualDJItemId &&
    request.queuePosition === nextQueuePosition &&
    request.syncState === nextSyncState &&
    request.lastSeenAt === nextLastSeenAt
  ) {
    return { ok: true, request: bridgeRequest(request), backupNeeded: false };
  }
  const changes: Partial<GuestStarRequest> = {
    status: nextStatus,
    fileName: nextFileName,
    durationSeconds: nextDurationSeconds,
    sourceUrl: nextSourceUrl,
    virtualDJItemId: nextVirtualDJItemId,
    queuePosition: nextQueuePosition,
    syncState: nextSyncState,
    lastSeenAt: nextLastSeenAt,
    stateRevision: request.stateRevision + 1,
    updatedAt: nowIso()
  };
  const updated = await updateActiveRequest(db, hotelId, request.requestId, changes);
  const activity = activityId ? await getRecord(db, "Activities", activityId) : null;
  if (activity) await recalculateQueue(db, hotelId, activity);
  const refreshed = await findActiveRequest(db, hotelId, request.requestId);
  return {
    ok: true,
    request: refreshed ? bridgeRequest(refreshed) : null,
    backupNeeded: Boolean(updated)
  };
}

async function bridgeExternalSync(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  if (!auth.device) return { ok: false, code: "BRIDGE_DEVICE_REQUIRED" };
  const hotelId = text(auth.device.hotelId);
  const activityId = text(auth.device.activityId);
  if (!hotelId || !activityId) return { ok: false, code: "ACTIVITY_REQUIRED" };
  const entries = Array.isArray(body.entries) ? body.entries.filter((item): item is JsonObject => Boolean(item && typeof item === "object")) : [];
  const confirmedMissingIds = Array.isArray(body.confirmedMissingIds)
    ? body.confirmedMissingIds.map(text)
    : [];
  const currentActivity = await getRecord(db, "Activities", activityId);
  const existing = currentActivity
    ? await currentCycleRequests(db, hotelId, currentActivity)
    : await activeRequests(db, hotelId, activityId);
  const existingByVirtualId = new Map(
    existing
      .filter((item) => item.virtualDJItemId)
      .map((item) => [item.virtualDJItemId, item])
  );
  let imported = 0;
  let changed = 0;
  const seen = new Set<string>();
  const technicalError = (value: unknown) => /^error\s*:\s*-?\d+$/i.test(text(value));
  for (const [entryIndex, entry] of entries.slice(0, 100).entries()) {
    const virtualId = text(entry.virtualDJItemId || entry.id);
    if (
      !virtualId || seen.has(virtualId) || technicalError(virtualId) ||
      technicalError(entry.singer || entry.name) ||
      technicalError(entry.song || entry.title) ||
      technicalError(entry.artist) || technicalError(entry.fileName)
    ) continue;
    seen.add(virtualId);
    const match = existingByVirtualId.get(virtualId);
    const stamp = nowIso();
    const nextStatus = text(entry.status) || "Agregada a VirtualDJ";
    const nextFileName = text(entry.filePath || entry.fileName) || match?.fileName || "";
    const nextQueuePosition = numberValue(
      entry.index ?? entry.queuePosition,
      match?.queuePosition ?? entryIndex
    );
    const nextSinger = text(entry.singer || entry.name) || match?.singer || "VirtualDJ";
    const nextSong = text(entry.song || entry.title) || match?.song || nextFileName || "Untitled";
    const nextArtist = text(entry.artist) || match?.artist || "";
    const reportedDuration = numberValue(entry.durationSeconds, 0);
    const nextDuration = reportedDuration > 0
      ? reportedDuration
      : match?.durationSeconds || 0;
    const unchanged = match !== undefined &&
      match.status === nextStatus &&
      match.fileName === nextFileName &&
      match.queuePosition === nextQueuePosition &&
      match.syncState === "confirmed" &&
      match.singer === nextSinger &&
      match.song === nextSong &&
      match.artist === nextArtist &&
      match.durationSeconds === nextDuration;
    if (unchanged) continue;
    const request: GuestStarRequest = match ? {
      ...match,
      singer: nextSinger,
      song: nextSong,
      artist: nextArtist,
      durationSeconds: nextDuration,
      status: nextStatus,
      fileName: nextFileName,
      queuePosition: nextQueuePosition,
      syncState: "confirmed", lastSeenAt: stamp, updatedAt: stamp,
      stateRevision: match.stateRevision + 1
    } : {
      rowId: randomId(), requestId: `vdj-${virtualId}`, hotelId,
      venueId: text(auth.device.venueId), activityId, cycleId: "",
      singer: nextSinger,
      song: nextSong,
      artist: nextArtist, comment: "", language: text(entry.language),
      languageCode: languageCode(entry.languageCode || entry.language),
      durationSeconds: nextDuration, transitionSeconds: 0,
      accumulatedSeconds: 0, remainingSeconds: 0,
      sourceUrl: text(entry.sourceUrl), status: nextStatus,
      fileName: nextFileName, sourceType: "virtualdj_external",
      virtualDJItemId: virtualId, queuePosition: nextQueuePosition,
      syncState: "confirmed", lastSeenAt: stamp, stateRevision: 1,
      createdAt: stamp, updatedAt: stamp, archivedAt: ""
    };
    await upsertRequest(db, request);
    existingByVirtualId.set(virtualId, request);
    if (!match) imported += 1;
    changed += 1;
  }
  const missingIds = new Set(confirmedMissingIds);
  for (const virtualId of missingIds) {
    if (seen.has(virtualId)) continue;
    const match = existingByVirtualId.get(virtualId);
    if (!match || match.sourceType !== "virtualdj_external") continue;
    if (
      match.status === "Fuera de VirtualDJ" &&
      match.syncState === "confirmed_missing"
    ) continue;
    const updated = await updateActiveRequest(db, hotelId, match.requestId, {
      status: "Fuera de VirtualDJ", syncState: "confirmed_missing",
      stateRevision: match.stateRevision + 1, updatedAt: nowIso()
    });
    if (updated) {
      changed += 1;
    }
  }
  const activity = await getRecord(db, "Activities", activityId);
  if (changed && activity) await recalculateQueue(db, hotelId, activity);
  return {
    ok: true,
    imported,
    changed,
    externalCount: seen.size,
    backupNeeded: changed > 0
  };
}

async function changePassword(db: D1DatabaseLike, auth: Auth, body: JsonObject) {
  const current = String(body.currentPassword || "");
  const next = String(body.newPassword || "");
  if (!safeEqual(await hmacSha256Hex(current, auth.user.passwordSalt), auth.user.passwordHash)) {
    return { ok: false, code: "INVALID_CURRENT_PASSWORD" };
  }
  if (next.length < 12 || next.length > 128) return { ok: false, code: "WEAK_PASSWORD" };
  const salt = randomToken(32);
  const stamp = nowIso();
  await patchRecord(db, "Users", text(auth.user.userId), {
    passwordHash: await hmacSha256Hex(next, salt), passwordSalt: salt,
    mustChangePassword: false, passwordUpdatedAt: stamp, updatedAt: stamp
  });
  await audit(db, { userId: auth.user.userId, action: "password.changed" });
  return { ok: true };
}

function isoDurationSeconds(value: unknown) {
  const match = text(value).match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  return match
    ? Number(match[1] || 0) * 3600 + Number(match[2] || 0) * 60 + Number(match[3] || 0)
    : 0;
}

async function youtubeSearch(db: D1DatabaseLike, body: JsonObject) {
  const apiKey = await getMeta(db, "youtube_api_key");
  if (!apiKey) {
    return { ok: false, code: "YOUTUBE_SEARCH_NOT_CONFIGURED", error: "Contact the Superhost to configure YouTube search." };
  }
  const requestedLanguage = languageCode(body.languageCode || body.language) || "es";
  const song = text(body.song);
  const artist = text(body.artist);
  if (!song) return { ok: false, code: "SONG_REQUIRED" };
  const terms = requestedLanguage === "es"
    ? `${song} ${artist} karaoke letra instrumental`
    : `${song} ${artist} karaoke lyrics instrumental`;
  const searchParams = new URLSearchParams({
    part: "snippet", type: "video", maxResults: "10", q: terms,
    videoEmbeddable: "true", safeSearch: "moderate",
    relevanceLanguage: requestedLanguage,
    regionCode: requestedLanguage === "es" ? "DO" : "US",
    key: apiKey
  });
  const searchResponse = await fetch(`https://www.googleapis.com/youtube/v3/search?${searchParams}`, {
    cache: "no-store"
  });
  if (!searchResponse.ok) return { ok: false, code: "YOUTUBE_SEARCH_UNAVAILABLE" };
  const searchData = await searchResponse.json() as {
    items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string } }>;
  };
  const candidates = (searchData.items || []).map((item) => ({
    id: text(item.id?.videoId),
    title: text(item.snippet?.title),
    channel: text(item.snippet?.channelTitle)
  })).filter((item) => item.id);
  if (!candidates.length) return { ok: true, languageCode: requestedLanguage, items: [] };
  const detailParams = new URLSearchParams({
    part: "contentDetails", id: candidates.map((item) => item.id).join(","), key: apiKey
  });
  const detailResponse = await fetch(`https://www.googleapis.com/youtube/v3/videos?${detailParams}`, {
    cache: "no-store"
  });
  const details = detailResponse.ok
    ? await detailResponse.json() as { items?: Array<{ id?: string; contentDetails?: { duration?: string } }> }
    : { items: [] };
  const durations = new Map((details.items || []).map((item) => [text(item.id), isoDurationSeconds(item.contentDetails?.duration)]));
  const priorityChannels = ["sing king", "stingray karaoke", "karafun", "karaokemedia", "the karaoke channel"];
  const items = candidates.map((item) => {
    const lower = `${item.title} ${item.channel}`.toLowerCase();
    const durationSeconds = durations.get(item.id) || 0;
    const karaoke = /karaoke|instrumental|lyrics|letra/.test(lower);
    const priority = priorityChannels.findIndex((channel) => lower.includes(channel));
    const qualityScore = (karaoke ? 70 : 30) + (priority >= 0 ? 25 - priority * 3 : 0);
    return {
      ...item,
      durationSeconds,
      url: `https://www.youtube.com/watch?v=${item.id}`,
      qualityScore,
      channelPriority: priority >= 0 ? priority : 999,
      languagePriority: requestedLanguage,
      resultType: karaoke ? "karaoke" : "lyrics-vocals",
      recommended: karaoke && durationSeconds >= 90 && durationSeconds <= 900,
      lyricsVisible: karaoke,
      notice: karaoke ? "Versión karaoke con letra en pantalla." : "Verifica la pista antes de agregarla."
    };
  }).filter((item) => item.recommended)
    .sort((left, right) => left.channelPriority - right.channelPriority || right.qualityScore - left.qualityScore)
    .slice(0, 6);
  return { ok: true, languageCode: requestedLanguage, items };
}

async function resolvePublicHotel(db: D1DatabaseLike, identifier: unknown) {
  const key = text(identifier)
    .replace(/^https?:\/\/[^/]+\/h\//i, "")
    .replace(/^\/+|\/+$/g, "");
  if (!key) return null;
  if (key === "default") {
    const defaultHotelId = await getMeta(db, "default_public_hotel_id");
    const selected = defaultHotelId ? await getRecord(db, "Hotels", defaultHotelId) : null;
    if (selected && text(selected.status) === "active") return selected;
    return (await listRecords(db, "Hotels")).find((hotel) => text(hotel.status) === "active") || null;
  }
  const modernCode = key.match(/([a-z0-9]{16,128})$/i)?.[1] || "";
  const candidates = modernCode
    ? await listRecordsByJsonField(db, "Hotels", "publicCode", modernCode, "master", 4)
    : await listRecords(db, "Hotels");
  if (modernCode && modernCode !== key) {
    candidates.push(...await listRecordsByJsonField(db, "Hotels", "publicCode", key, "master", 4));
  }
  return candidates.find((hotel) => text(hotel.status) === "active" && (
    text(hotel.publicCode) === key ||
    `${text(hotel.slug)}-${text(hotel.publicCode)}` === key ||
    text(hotel.publicUrl).replace(/^https?:\/\/[^/]+\/h\//i, "").replace(/^\/+|\/+$/g, "") === key
  )) || null;
}

async function resolvePublicContext(db: D1DatabaseLike, identifier: unknown): Promise<ResolvedPublicContext | null> {
  const key = text(identifier)
    .replace(/^https?:\/\/[^/]+\/h\//i, "")
    .replace(/^\/+|\/+$/g, "");
  if (key === "default") {
    const setting = await defaultPublicExperienceSetting(db);
    if (setting.configured && setting.available) {
      const hotel = await getRecord(db, "Hotels", setting.hotelId);
      if (hotel) return { hotel, activityId: setting.activityId, configuredDefault: true };
    }
  }
  const hotel = await resolvePublicHotel(db, identifier);
  return hotel ? {
    hotel,
    activityId: text(hotel.activePublicActivityId),
    configuredDefault: false
  } : null;
}

async function safeBranding(db: D1DatabaseLike, hotelId: string) {
  const branding = (await listRecordsByJsonField(db, "HotelBranding", "hotelId", hotelId, "master", 1))[0] || {};
  const safe: JsonObject = {};
  for (const [key, value] of Object.entries(branding)) {
    if (!["hotelBrandingId", "hotelId", "updatedAt"].includes(key)) safe[key] = value;
  }
  return safe;
}

async function publicExperience(db: D1DatabaseLike, hotel: JsonObject, activityId = text(hotel.activePublicActivityId)) {
  const activity = activityId
    ? await getRecord(db, "Activities", activityId)
    : null;
  const venue = activity ? await getRecord(db, "Venues", text(activity.venueId)) : null;
  const state = activity ? await stateFor(db, hotel, activity) : {
    accepting: false, activityHours: 2, transitionSeconds: 30,
    accumulatedSeconds: 0, remainingSeconds: 7200, activityStartedAt: "",
    activityFinishedAt: "", activityRunning: false, showPublicStatus: false,
    queuePeopleCount: 0, stateRevision: 0, activityId: "", updatedAt: "",
    lastAction: "", lastSource: "d1"
  };
  const status = text(activity?.status);
  const acceptsEarly = bool(activity?.acceptEarlyRequests);
  state.accepting = Boolean(activity && state.accepting && (status === "in_progress" || (status === "scheduled" && acceptsEarly)));
  return {
    ...state,
    ok: true,
    codeVersion: GUEST_STAR_BRIDGE_COMPAT_VERSION,
    serverNow: nowIso(),
    hotel: {
      name: hotel.name, slug: hotel.slug, publicUrl: hotel.publicUrl, timezone: hotel.timezone
    },
    venue: venue ? { name: venue.name } : null,
    activity: activity ? {
      activityId: activity.activityId, name: activity.name, status: activity.status,
      scheduledStartAt: text(activity.scheduledStartAt),
      showCountdown: bool(activity.showCountdown), acceptEarlyRequests: acceptsEarly,
      allowedLanguages: normalizeLanguages(activity.allowedLanguagesJson)
    } : null,
    branding: await safeBranding(db, text(hotel.hotelId)),
    postActivityAnnouncement: await postActivityAnnouncement(db, hotel, activity),
    upcomingActivities: await upcomingActivities(db, text(hotel.hotelId))
  };
}

function duplicateKey(value: unknown) {
  return text(value).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function requestMetadataKey(song: unknown, artist: unknown) {
  return [duplicateKey(song), duplicateKey(artist)].filter(Boolean).sort().join("|");
}

function publicGuestIdentityFromSource(sourceType: unknown) {
  const match = text(sourceType).match(/^public_request:([a-f0-9]{16,64})$/i);
  return match ? match[1].toLowerCase() : "";
}

function publicGuestCode(sourceType: unknown) {
  const identity = publicGuestIdentityFromSource(sourceType);
  return identity ? `G-${identity.slice(0, 4).toUpperCase()}` : "";
}

function publicGuestKey(request: GuestStarRequest) {
  return publicGuestIdentityFromSource(request.sourceType) || duplicateKey(request.singer);
}

function publicRequestIsActive(request: GuestStarRequest) {
  if (request.sourceType === "virtualdj_external") return false;
  return !["Ya cantó", "Saltado", "Retirada del Player", "Fuera de VirtualDJ", "Eliminada", "Cancelada"].includes(request.status);
}

async function currentCycleRequests(
  db: D1DatabaseLike,
  hotelId: string,
  activity: JsonObject
) {
  const requests = await activeRequests(db, hotelId, text(activity.activityId));
  const cycleId = text(activity.currentCycleId);
  if (!cycleId) return requests;
  // Old imports can legitimately have no cycle ID. Preserve those records,
  // while keeping every explicit previous cycle out of the current activity.
  return requests.filter((request) => !text(request.cycleId) || text(request.cycleId) === cycleId);
}

async function currentCycleDuplicateSignals(
  db: D1DatabaseLike,
  hotelId: string,
  activityId: string,
  cycleId: string,
  guestIdentity: string,
  singer: string,
  song: string,
  artist: string
) {
  const activeStatusSql = "status NOT IN ('Retirada del Player', 'Eliminada', 'Cancelada')";
  const repeatedSingerStatement = guestIdentity
    ? db.prepare(`
        SELECT 1 AS found FROM guest_star_requests
        WHERE hotel_id = ? AND activity_id = ? AND cycle_id = ? AND archived_at = ''
          AND source_type = ? AND ${activeStatusSql}
        LIMIT 1
      `).bind(hotelId, activityId, cycleId, `public_request:${guestIdentity}`)
    : db.prepare(`
        SELECT 1 AS found FROM guest_star_requests
        WHERE hotel_id = ? AND activity_id = ? AND cycle_id = ? AND archived_at = ''
          AND singer = ? COLLATE NOCASE AND ${activeStatusSql}
        LIMIT 1
      `).bind(hotelId, activityId, cycleId, singer);
  const duplicateSongStatement = db.prepare(`
    SELECT 1 AS found FROM guest_star_requests
    WHERE hotel_id = ? AND activity_id = ? AND cycle_id = ? AND archived_at = ''
      AND ${activeStatusSql}
      AND (
        (song = ? COLLATE NOCASE AND artist = ? COLLATE NOCASE) OR
        (song = ? COLLATE NOCASE AND artist = ? COLLATE NOCASE)
      )
    LIMIT 1
  `).bind(hotelId, activityId, cycleId, song, artist, artist, song);
  const [repeatedSinger, duplicateSong] = await Promise.all([
    repeatedSingerStatement.first<{ found: number }>(),
    duplicateSongStatement.first<{ found: number }>()
  ]);
  return { repeatedSinger: Boolean(repeatedSinger), duplicateSong: Boolean(duplicateSong) };
}

async function publicGuestIdentity(hotelId: string, deviceId: unknown) {
  const candidate = limitedText(deviceId, 128);
  if (!/^[a-z0-9._:-]{16,128}$/i.test(candidate)) return "";
  return (await sha256Hex(`guest-device|${hotelId}|${candidate}`)).slice(0, 32);
}

async function acquirePublicScheduleLease(db: D1DatabaseLike, hotelId: string) {
  const token = randomToken(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PUBLIC_SCHEDULE_LEASE_MS).toISOString();
  const key = `public_schedule_check:${hotelId}`;
  const result = await db.prepare(`
    INSERT INTO guest_star_meta (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
    WHERE guest_star_meta.updated_at <= ?
  `).bind(key, token, expiresAt, now.toISOString()).run();
  const changes = Number(result.meta?.changes);
  if (Number.isFinite(changes)) return changes > 0;
  const row = await db.prepare(
    "SELECT value FROM guest_star_meta WHERE key = ? LIMIT 1"
  ).bind(key).first<{ value: string }>();
  return row?.value === token;
}

async function processPublicSchedules(db: D1DatabaseLike, hotelId: string) {
  if (!hotelId) return false;
  let checks = publicScheduleChecks.get(db as object);
  if (!checks) {
    checks = new Map<string, PublicScheduleCheckState>();
    publicScheduleChecks.set(db as object, checks);
  }
  let state = checks.get(hotelId);
  if (!state) {
    state = { nextCheckAt: 0 };
    checks.set(hotelId, state);
  }
  if (state.operation) return state.operation;
  const now = Date.now();
  if (state.nextCheckAt > now) return false;
  state.nextCheckAt = now + PUBLIC_SCHEDULE_CHECK_INTERVAL_MS;
  const operation = (async () => {
    if (!await acquirePublicScheduleLease(db, hotelId)) return false;
    const changes = await processD1ActivitySchedules(db, hotelId);
    return changes.some((change) => text(change.action) === "opened");
  })();
  state.operation = operation;
  try {
    return await operation;
  } finally {
    if (state.operation === operation) delete state.operation;
  }
}

export async function handleD1PublicGet(db: D1DatabaseLike, params: URLSearchParams): Promise<JsonObject> {
  const identifier = params.get("hotel") || params.get("publicCode") || params.get("code");
  let context = await resolvePublicContext(db, identifier);
  if (!context) return { ok: false, code: "PUBLIC_LINK_NOT_FOUND" };
  if (await processPublicSchedules(db, text(context.hotel.hotelId))) {
    context = await resolvePublicContext(db, identifier) || context;
  }
  return publicExperience(db, context.hotel, context.activityId);
}

export async function handleD1PublicPost(db: D1DatabaseLike, body: JsonObject) {
  const action = text(body.action);
  const identifier = body.publicCode || body.hotel || body.hotelCode;
  let publicContext = await resolvePublicContext(db, identifier);
  if (!publicContext) return { ok: false, code: "PUBLIC_LINK_NOT_FOUND" };
  if (await processPublicSchedules(db, text(publicContext.hotel.hotelId))) {
    publicContext = await resolvePublicContext(db, identifier) || publicContext;
  }
  const hotel = publicContext.hotel;
  const publicActivityId = publicContext.activityId;
  const hotelId = text(hotel.hotelId);
  if (action === "submitReview") {
    const branding = await safeBranding(db, hotelId);
    if (!bool(branding.showInternalRating)) return { ok: false, code: "REVIEWS_DISABLED" };
    const rawRating = Number(body.rating);
    if (!Number.isFinite(rawRating) || rawRating < 1 || rawRating > 5) {
      return { ok: false, code: "INVALID_RATING" };
    }
    const rating = Math.round(rawRating);
    const fingerprint = limitedText(body._requestFingerprint || body.guestEmail || body.comment, 240);
    const rateKey = `review:${(await sha256Hex(`${hotelId}:${fingerprint}`)).slice(0, 32)}`;
    if (!await checkRateLimit(db, rateKey, 4, 600)) return { ok: false, code: "RATE_LIMITED" };
    const publicActivity = publicActivityId
      ? await getRecord(db, "Activities", publicActivityId)
      : null;
    const review = await save(db, "Reviews", {
      reviewId: randomId(), hotelId, venueId: text(publicActivity?.venueId),
      activityId: text(publicActivity?.activityId), cycleId: text(publicActivity?.currentCycleId),
      rating, guestName: limitedText(body.guestName, 120),
      guestEmail: normalizeEmail(body.guestEmail), comment: limitedText(body.comment, 2000),
      source: "public", status: "active", archivedAt: "", deletedAt: "",
      createdAt: nowIso(), updatedAt: nowIso()
    }, hotelId);
    return { ok: true, reviewId: review.reviewId };
  }
  if (action === "createGuestReminder") {
    const branding = await safeBranding(db, hotelId);
    if (!bool(branding.showRemindMe)) return { ok: false, code: "REMINDERS_DISABLED" };
    const email = normalizeEmail(body.guestEmail);
    if (!email || body.consent !== true) return { ok: false, code: "CONSENT_AND_EMAIL_REQUIRED" };
    const rateKey = `reminder:${(await sha256Hex(`${hotelId}:${email}`)).slice(0, 32)}`;
    if (!await checkRateLimit(db, rateKey, 4, 600)) return { ok: false, code: "RATE_LIMITED" };
    const unsubscribeToken = randomToken(32);
    const reminder = await save(db, "GuestReminders", {
      reminderId: randomId(), hotelId, activityId: publicActivityId, guestEmail: email,
      status: "active", consentAt: nowIso(), unsubscribedAt: "",
      unsubscribeTokenHash: await sessionHash(db, unsubscribeToken),
      createdAt: nowIso(), updatedAt: nowIso()
    }, hotelId);
    return { ok: true, recordId: reminder.reminderId, token: unsubscribeToken };
  }
  if (action === "unsubscribeGuest") {
    const reminder = await getRecord(db, "GuestReminders", text(body.recordId), hotelId);
    if (!reminder) return { ok: false, code: "REMINDER_NOT_FOUND" };
    if (!text(body.token) || !safeEqual(
      await sessionHash(db, body.token), reminder.unsubscribeTokenHash
    )) return { ok: false, code: "INVALID_UNSUBSCRIBE_TOKEN" };
    await patchRecord(db, "GuestReminders", text(reminder.reminderId), {
      status: "unsubscribed", unsubscribedAt: nowIso(), updatedAt: nowIso()
    }, hotelId);
    return { ok: true };
  }
  if (action) return { ok: false, code: "PUBLIC_ACTION_NOT_ALLOWED" };

  const activity = publicActivityId
    ? await getRecord(db, "Activities", publicActivityId)
    : null;
  if (!activity || text(activity.status) === "inactive") return { ok: false, code: "NO_PUBLIC_ACTIVITY" };
  const runtime = await runtimeFor(db, activity, hotel);
  const status = text(activity.status);
  if (!runtime.accepting || (status !== "in_progress" && !(status === "scheduled" && bool(activity.acceptEarlyRequests)))) {
    return { ok: false, code: "CLOSED" };
  }
  const singer = limitedText(body.name, 120);
  const song = limitedText(body.song, 180);
  const artist = limitedText(body.artist, 180);
  const requestedLanguage = languageCode(body.languageCode || body.language);
  if (!singer || !song || !artist || !requestedLanguage) return { ok: false, code: "MISSING_FIELDS" };
  if (!normalizeLanguages(activity.allowedLanguagesJson).includes(requestedLanguage)) {
    return { ok: false, code: "LANGUAGE_NOT_ALLOWED", state: await publicExperience(db, hotel, publicActivityId) };
  }
  const guestIdentity = await publicGuestIdentity(hotelId, body.guestDeviceId);
  const sourceType = guestIdentity ? `public_request:${guestIdentity}` : "public_request";
  const cycleId = text(activity.currentCycleId);
  const metadataKey = requestMetadataKey(song, artist);
  const deterministicRequestId = guestIdentity
    ? `req-${(await sha256Hex([
        hotelId, text(activity.activityId), cycleId, guestIdentity,
        duplicateKey(singer), metadataKey
      ].join("|"))).slice(0, 32)}`
    : "";
  const exactExisting = deterministicRequestId
    ? await findActiveRequest(db, hotelId, deterministicRequestId)
    : (await currentCycleRequests(db, hotelId, activity)).find((request) => (
        text(request.cycleId) === cycleId &&
        !["Retirada del Player", "Eliminada", "Cancelada"].includes(request.status) &&
        duplicateKey(request.singer) === duplicateKey(singer) &&
        requestMetadataKey(request.song, request.artist) === metadataKey
      ));
  if (exactExisting) {
    return {
      ok: true,
      id: exactExisting.requestId,
      deduplicated: true,
      backupNeeded: false
    };
  }
  const { repeatedSinger, duplicateSong } = await currentCycleDuplicateSignals(
    db, hotelId, text(activity.activityId), cycleId, guestIdentity, singer, song, artist
  );
  if (!bool(body.confirmDuplicate) && (repeatedSinger || duplicateSong)) {
    return {
      ok: false, code: "DUPLICATE_CONFIRMATION_REQUIRED",
      duplicates: { repeatedSinger, duplicateSong, duplicateSongState: "active" },
      state: await publicExperience(db, hotel, publicActivityId)
    };
  }
  const requestFingerprint = guestIdentity || limitedText(body._requestFingerprint, 240) || duplicateKey(singer);
  const rateKey = `request:${(await sha256Hex(`${hotelId}:${requestFingerprint}`)).slice(0, 32)}`;
  if (!await checkRateLimit(db, rateKey, 8, 60)) return { ok: false, code: "RATE_LIMITED" };
  const durationSeconds = Math.max(0, numberValue(body.durationSeconds));
  const transitionSeconds = Math.max(0, numberValue(activity.defaultTransitionSeconds, 30));
  const total = Math.max(900, numberValue(activity.defaultDurationSeconds, 7200));
  const stamp = nowIso();
  const requestId = deterministicRequestId || randomId();
  const request: GuestStarRequest = {
    rowId: requestId, requestId, hotelId,
    venueId: text(activity.venueId), activityId: text(activity.activityId),
    cycleId: text(activity.currentCycleId), singer, song, artist,
    comment: limitedText(body.comment, 500), language: limitedText(body.language, 40), languageCode: requestedLanguage,
    durationSeconds, transitionSeconds, accumulatedSeconds: 0,
    remainingSeconds: total,
    sourceUrl: "", status: "Pendiente", fileName: "", sourceType,
    virtualDJItemId: "", queuePosition: 0, syncState: "pending",
    lastSeenAt: "", stateRevision: 1, createdAt: stamp, updatedAt: stamp, archivedAt: ""
  };
  const savedRequest = await insertPublicRequestAtomically(db, request, total);
  return { ok: true, id: savedRequest.requestId, backupNeeded: false };
}

export async function handleD1HostAction(db: D1DatabaseLike, body: JsonObject): Promise<JsonObject | null> {
  const action = text(body.action);
  try {
    if (action === "login") return await login(db, body);
    if (action === "consumeOneTimeLoginCode") return await consumeOneTimeCode(db, body);
    const auth = await requireAuth(db, body);
    if (action === "logout") {
      await patchRecord(db, "AuthSessions", text(auth.session.authSessionId), { revokedAt: nowIso() }, "master", false);
      await audit(db, { userId: auth.user.userId, deviceId: auth.session.deviceId, action: "logout" });
      return { ok: true };
    }
    if (action === "me") return {
      ok: true, codeVersion: GUEST_STAR_BRIDGE_COMPAT_VERSION, codeBuild: GUEST_STAR_D1_VERSION,
      backend: "cloudflare-d1", user: publicUser(auth.user), selection: await accessibleSelection(db, auth.user)
    };
    if (action === "changePassword") return await changePassword(db, auth, body);
    if (action === "createOneTimeLoginCode") return await createOneTimeCode(db, auth);
    if (action === "adminState") return await adminState(db, auth);
    if (action === "setDefaultPublicExperience") return await setDefaultPublicExperience(db, auth, body);
    if (action === "setDefaultGoogleFallback") {
      return { ok: false, code: "GOOGLE_REQUEST_BACKUP_DISABLED" };
    }
    if (action === "createHost") return await createHost(db, auth, body);
    if (action === "updateHost") return await updateHost(db, auth, body);
    if (action === "setHostPassword") return await setHostPassword(db, auth, body);
    if (action === "createHotel") return await createHotel(db, auth, body);
    if (action === "updateHotel") return await updateHotelAction(db, auth, body);
    if (action === "createVenue") return await createVenue(db, auth, body);
    if (action === "updateVenue") return await updateVenue(db, auth, body);
    if (action === "createActivity") return await createActivity(db, auth, body);
    if (action === "updateActivity") return await updateActivityRecord(db, auth, body);
    if (action === "updateActivityLanguages") return await updateActivityLanguages(db, auth, body);
    if (action === "assignUser") return await assignUser(db, auth, body);
    if (action === "revokeAssignment") return await revokeAssignment(db, auth, body);
    if (action === "revokeDevice") return await revokeDevice(db, auth, body);
    if (action === "selectActivity") return await selectActivity(db, auth, body);
    if (action === "activityState") {
      await processD1ActivitySchedules(db, text(body.hotelId || auth.device?.hotelId));
      return await selectedState(db, auth, await tenantContext(db, auth, body));
    }
    if (action === "startActivityV4") return await startActivity(db, auth, body, false);
    if (action === "startNewActivityV4") return await startActivity(db, auth, body, true);
    if (action === "playerRuntimeUpdate") return await updatePlayerRuntime(db, auth, body);
    if (action === "finishActivityV4") return await finishActivity(db, auth, body);
    if (action === "archiveClearQueue") return await archiveQueue(db, auth, body);
    if (action === "toggleRequests") return await toggleRequests(db, auth, body);
    if (action === "updateActivitySettings") return await updateActivitySettings(db, auth, body);
    if (action === "scheduleActivity") return await scheduleActivity(db, auth, body);
    if (action === "updateSchedule") return await updateSchedule(db, auth, body);
    if (action === "cancelSchedule") return await cancelSchedule(db, auth, body);
    if (action === "updateHotelBranding") return await updateBranding(db, auth, body);
    if (action === "listReviews") return await listReviewsAction(db, auth, body);
    if (action === "updateReview") return await updateReviewAction(db, auth, body);
    if (action === "bridgeHeartbeat") return await bridgeHeartbeat(db, auth, body);
    if (action === "queueBridgeCommand") return await queueBridgeCommand(db, auth, body);
    if (action === "pollBridgeCommands") return await pollBridgeCommands(db, auth);
    if (action === "completeBridgeCommand") return await completeBridgeCommand(db, auth, body);
    if (action === "bridgeRequestUpdate") return await bridgeRequestUpdate(db, auth, body);
    if (action === "bridgeExternalSync") return await bridgeExternalSync(db, auth, body);
    if (action === "hotelShare" || action === "regenerateHotelQr") {
      const context = await tenantContext(db, auth, { hotelId: body.hotelId });
      requirePermission(context, "canViewQR");
      if (action === "regenerateHotelQr") {
        context.hotel = await patchRecord(db, "Hotels", text(context.hotel.hotelId), {
          qrVersion: numberValue(context.hotel.qrVersion, 1) + 1,
          updatedAt: nowIso()
        }) || context.hotel;
        await audit(db, {
          userId: auth.user.userId,
          action: "hotel.qrRegenerated",
          hotelId: context.hotel.hotelId
        });
      }
      return { ok: true, share: shareInfo(context.hotel) };
    }
    if (action === "youtubeSearchV4") {
      const context = await tenantContext(db, auth, body);
      requirePermission(context, "canControlVirtualDJ");
      return await youtubeSearch(db, body);
    }
    return null;
  } catch (error) {
    return { ok: false, code: error instanceof Error ? error.message : String(error) };
  }
}

export async function setD1BackendMode(db: D1DatabaseLike, mode: "apps_script" | "d1_primary") {
  if (mode !== "d1_primary") throw new Error("D1_ONLY_MODE");
  if (mode === "d1_primary") {
    const status = await getMeta(db, "migration_status");
    if (status !== "ready" && status !== "active") throw new Error("D1_MIGRATION_NOT_READY");
    const users = await listRecords(db, "Users");
    const hotels = await listRecords(db, "Hotels");
    if (!users.some((user) => text(user.role) === "superhost" && text(user.status) === "active") || !hotels.length) {
      throw new Error("D1_VALIDATION_FAILED");
    }
  }
  await setMeta(db, "backend_mode", mode);
  await setMeta(db, "migration_status", "active");
  return { ok: true, mode };
}

export async function createMigrationSession(db: D1DatabaseLike, userId: string) {
  const user = await getRecord(db, "Users", userId);
  if (!user || text(user.role) !== "superhost" || text(user.status) !== "active") {
    throw new Error("D1_SUPERHOST_NOT_FOUND");
  }
  const session = await createSession(db, user, "", true);
  await audit(db, { userId, action: "d1.migration.activated" });
  return { ...session, user };
}
