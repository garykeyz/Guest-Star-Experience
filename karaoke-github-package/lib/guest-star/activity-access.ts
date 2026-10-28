import type { D1DatabaseLike, JsonObject } from "./d1-store";
import { getMeta } from "./d1-store";
import { hmacSha256Hex, randomId, randomToken, safeEqual, sha256Hex } from "./crypto";

export type ActivityAccessRow = {
  access_id: string;
  hotel_id: string;
  venue_id: string;
  activity_id: string;
  cycle_id: string;
  pin: string;
  pin_hash: string;
  join_token: string;
  join_token_hash: string;
  access_version: number;
  status: "active" | "revoked" | "ended";
  default_messages_enabled: number;
  custom_messages_json: string;
  created_at: string;
  updated_at: string;
  revoked_at: string;
};

export type ActivitySessionRow = {
  session_token_hash: string;
  access_id: string;
  hotel_id: string;
  venue_id: string;
  activity_id: string;
  device_hash: string;
  auth_method: "pin" | "join";
  created_at: string;
  expires_at: string;
  revoked_at: string;
};

type AccessContext = {
  hotelId: string;
  venueId: string;
  activityId: string;
  cycleId: string;
};

const SESSION_LIFETIME_MS = 365 * 24 * 60 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function text(value: unknown) {
  return value === null || value === undefined ? "" : String(value).trim();
}

function cleanMessages(value: unknown) {
  const input = Array.isArray(value) ? value : [];
  return [...new Set(input.map((item) => text(item).slice(0, 160)).filter(Boolean))].slice(0, 8);
}

async function secretHash(db: D1DatabaseLike, value: unknown) {
  const secret = await getMeta(db, "session_hash_secret");
  if (!secret) throw new Error("D1_SESSION_SECRET_MISSING");
  return hmacSha256Hex(value, secret);
}

function secureSixDigitPin() {
  const range = 900_000;
  const maximum = Math.floor(0x1_0000_0000 / range) * range;
  const sample = new Uint32Array(1);
  do crypto.getRandomValues(sample); while (sample[0] >= maximum);
  return String(100_000 + (sample[0] % range));
}

async function insertAccess(
  db: D1DatabaseLike,
  context: AccessContext,
  version: number,
  messages: string[] = [],
  defaultMessagesEnabled = true,
  previousPin = ""
) {
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const pin = secureSixDigitPin();
    if (pin === previousPin) continue;
    const joinToken = randomToken(48);
    const stamp = nowIso();
    const row: ActivityAccessRow = {
      access_id: randomId(),
      hotel_id: context.hotelId,
      venue_id: context.venueId,
      activity_id: context.activityId,
      cycle_id: context.cycleId,
      pin,
      pin_hash: await secretHash(db, pin),
      join_token: joinToken,
      join_token_hash: await secretHash(db, joinToken),
      access_version: Math.max(1, Math.floor(version)),
      status: "active",
      default_messages_enabled: defaultMessagesEnabled ? 1 : 0,
      custom_messages_json: JSON.stringify(cleanMessages(messages)),
      created_at: stamp,
      updated_at: stamp,
      revoked_at: ""
    };
    try {
      await db.prepare(`
        INSERT INTO guest_star_activity_access (
          access_id, hotel_id, venue_id, activity_id, cycle_id,
          pin, pin_hash, join_token, join_token_hash, access_version, status,
          default_messages_enabled, custom_messages_json, created_at, updated_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        row.access_id, row.hotel_id, row.venue_id, row.activity_id, row.cycle_id,
        row.pin, row.pin_hash, row.join_token, row.join_token_hash, row.access_version,
        row.status, row.default_messages_enabled, row.custom_messages_json,
        row.created_at, row.updated_at, row.revoked_at
      ).run();
      return row;
    } catch (error) {
      const active = await activeActivityAccess(db, context.hotelId, context.activityId, context.venueId);
      if (active) return active;
      if (attempt === 31) throw error;
    }
  }
  throw new Error("PIN_GENERATION_FAILED");
}

export async function activeActivityAccess(db: D1DatabaseLike, hotelId: string, activityId: string, venueId: string) {
  return db.prepare(`
    SELECT * FROM guest_star_activity_access
    WHERE hotel_id = ? AND activity_id = ? AND venue_id = ? AND status = 'active'
    ORDER BY access_version DESC LIMIT 1
  `).bind(hotelId, activityId, venueId).first<ActivityAccessRow>();
}

export async function ensureVenueAccess(db: D1DatabaseLike, context: AccessContext) {
  const current = await activeActivityAccess(db, context.hotelId, context.activityId, context.venueId);
  if (current) return current;
  // A pre-0006 room row with no activity can be claimed once, preserving its
  // deployed PIN and public join URL instead of silently replacing them.
  const legacy = await db.prepare(`
    SELECT * FROM guest_star_activity_access
    WHERE hotel_id = ? AND venue_id = ? AND activity_id = '' AND status = 'active'
    ORDER BY created_at DESC LIMIT 1
  `).bind(context.hotelId, context.venueId).first<ActivityAccessRow>();
  if (legacy) {
    await db.prepare(`
      UPDATE guest_star_activity_access SET activity_id = ?, cycle_id = ?, updated_at = ?
      WHERE access_id = ? AND activity_id = '' AND status = 'active'
    `).bind(context.activityId, context.cycleId, nowIso(), legacy.access_id).run();
    const claimed = await activeActivityAccess(db, context.hotelId, context.activityId, context.venueId);
    if (claimed) return claimed;
  }
  return insertAccess(db, context, 1);
}

export async function activateVenueAccess(db: D1DatabaseLike, context: AccessContext) {
  const current = await ensureVenueAccess(db, context);
  if (current.activity_id === context.activityId && current.cycle_id === context.cycleId) return current;
  const stamp = nowIso();
  await db.prepare(`
    UPDATE guest_star_activity_access
    SET activity_id = ?, cycle_id = ?, updated_at = ?
    WHERE access_id = ? AND status = 'active'
  `).bind(context.activityId, context.cycleId, stamp, current.access_id).run();
  return { ...current, activity_id: context.activityId, cycle_id: context.cycleId, updated_at: stamp };
}

export async function resetVenueAccess(db: D1DatabaseLike, context: AccessContext) {
  const current = await activeActivityAccess(db, context.hotelId, context.activityId, context.venueId);
  const stamp = nowIso();
  if (current) {
    await db.prepare(`
      UPDATE guest_star_activity_access
      SET status = 'revoked', revoked_at = ?, updated_at = ?
      WHERE access_id = ? AND status = 'active'
    `).bind(stamp, stamp, current.access_id).run();
  }
  const messages = current ? cleanMessages(JSON.parse(current.custom_messages_json || "[]")) : [];
  return insertAccess(
    db,
    context,
    Number(current?.access_version || 0) + 1,
    messages,
    current ? Boolean(current.default_messages_enabled) : true,
    current?.pin || ""
  );
}

export async function clearVenueActivityAccess(db: D1DatabaseLike, context: AccessContext) {
  // Ending a cycle closes its requests, never its persistent access.
  void db;
  void context;
}

export async function updateVenueAccessMessages(
  db: D1DatabaseLike,
  hotelId: string,
  activityId: string,
  venueId: string,
  defaultMessagesEnabled: boolean,
  messages: unknown
) {
  const current = await activeActivityAccess(db, hotelId, activityId, venueId);
  if (!current) throw new Error("KIOSK_PIN_NOT_ACTIVE");
  const cleaned = cleanMessages(messages);
  await db.prepare(`
    UPDATE guest_star_activity_access
    SET default_messages_enabled = ?, custom_messages_json = ?, updated_at = ?
    WHERE access_id = ? AND status = 'active'
  `).bind(defaultMessagesEnabled ? 1 : 0, JSON.stringify(cleaned), nowIso(), current.access_id).run();
  return { ...current, default_messages_enabled: defaultMessagesEnabled ? 1 : 0, custom_messages_json: JSON.stringify(cleaned) };
}

export function activityAccessView(row: ActivityAccessRow | null) {
  if (!row) return null;
  const joinUrl = `https://request.gstarxp.com/join/${encodeURIComponent(row.join_token)}`;
  const kioskUrl = `https://kiosko.gstarxp.com/join/${encodeURIComponent(row.join_token)}`;
  return {
    accessId: row.access_id,
    hotelId: row.hotel_id,
    activityId: row.activity_id,
    venueId: row.venue_id,
    status: row.status,
    pin: row.pin,
    accessVersion: row.access_version,
    joinUrl,
    kioskUrl,
    qrViewUrl: `https://quickchart.io/qr?size=900&margin=2&format=png&text=${encodeURIComponent(joinUrl)}`,
    defaultMessagesEnabled: Boolean(row.default_messages_enabled),
    customMessages: cleanMessages(JSON.parse(row.custom_messages_json || "[]"))
  };
}

export function publicActivityAccessView(row: ActivityAccessRow) {
  const view = activityAccessView(row);
  if (!view) return null;
  const { pin: _pin, ...safe } = view;
  return safe;
}

export async function findAccessByPin(db: D1DatabaseLike, pin: string) {
  const hash = await secretHash(db, pin);
  return db.prepare(`
    SELECT * FROM guest_star_activity_access
    WHERE pin_hash = ?
    ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, created_at DESC LIMIT 1
  `).bind(hash).first<ActivityAccessRow>();
}

export async function findAccessByJoinToken(db: D1DatabaseLike, token: string) {
  const hash = await secretHash(db, token);
  return db.prepare(`
    SELECT * FROM guest_star_activity_access
    WHERE join_token_hash = ? LIMIT 1
  `).bind(hash).first<ActivityAccessRow>();
}

export async function createActivitySession(
  db: D1DatabaseLike,
  access: ActivityAccessRow,
  deviceId: string,
  authMethod: "pin" | "join"
) {
  const token = randomToken(64);
  const stamp = nowIso();
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS).toISOString();
  await db.prepare(`
    INSERT INTO guest_star_activity_sessions (
      session_token_hash, access_id, hotel_id, venue_id, activity_id, device_hash,
      auth_method, created_at, expires_at, revoked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '')
  `).bind(
    await secretHash(db, token), access.access_id, access.hotel_id, access.venue_id, access.activity_id,
    await sha256Hex(`guest-device|${deviceId}`), authMethod, stamp, expiresAt
  ).run();
  return { token, expiresAt };
}

export async function resolveActivitySession(
  db: D1DatabaseLike,
  token: string,
  deviceId: string
): Promise<{ session: ActivitySessionRow; access: ActivityAccessRow } | { code: string }> {
  if (!token || !deviceId) return { code: "SESSION_REQUIRED" };
  const session = await db.prepare(`
    SELECT * FROM guest_star_activity_sessions
    WHERE session_token_hash = ? LIMIT 1
  `).bind(await secretHash(db, token)).first<ActivitySessionRow>();
  if (!session || session.revoked_at || Date.parse(session.expires_at) <= Date.now()) {
    return { code: "SESSION_EXPIRED" };
  }
  const expectedDevice = await sha256Hex(`guest-device|${deviceId}`);
  if (!safeEqual(session.device_hash, expectedDevice)) return { code: "SESSION_DEVICE_MISMATCH" };
  const access = await db.prepare(`
    SELECT * FROM guest_star_activity_access WHERE access_id = ? LIMIT 1
  `).bind(session.access_id).first<ActivityAccessRow>();
  if (!access) return { code: "SESSION_EXPIRED" };
  if (access.status === "revoked") return { code: "SESSION_PIN_CHANGED" };
  if (access.status === "ended") return { code: "ACTIVITY_ENDED" };
  if (access.status !== "active") return { code: "SESSION_EXPIRED" };
  return { session, access };
}

export async function renewActivitySession(db: D1DatabaseLike, session: ActivitySessionRow, token: string) {
  const remaining = Date.parse(session.expires_at) - Date.now();
  if (remaining > SESSION_LIFETIME_MS / 2) return null;
  const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS).toISOString();
  await db.prepare(`
    UPDATE guest_star_activity_sessions SET expires_at = ?
    WHERE session_token_hash = ? AND revoked_at = ''
  `).bind(expiresAt, session.session_token_hash).run();
  return { token, expiresAt };
}

export async function pinAttemptState(db: D1DatabaseLike, attemptKey: string) {
  const row = await db.prepare(`
    SELECT attempts, window_expires_at, blocked_until
    FROM guest_star_pin_attempts WHERE attempt_key = ? LIMIT 1
  `).bind(attemptKey).first<{ attempts: number; window_expires_at: string; blocked_until: string }>();
  const now = Date.now();
  if (!row || Date.parse(row.window_expires_at) <= now) return { allowed: true, attempts: 0, retryAfterSeconds: 0 };
  const blockedUntil = Date.parse(row.blocked_until);
  return {
    allowed: !Number.isFinite(blockedUntil) || blockedUntil <= now,
    attempts: Number(row.attempts || 0),
    retryAfterSeconds: Number.isFinite(blockedUntil) ? Math.max(0, Math.ceil((blockedUntil - now) / 1000)) : 0
  };
}

export async function recordPinFailure(db: D1DatabaseLike, attemptKey: string) {
  const current = await pinAttemptState(db, attemptKey);
  const attempts = current.attempts + 1;
  const now = Date.now();
  const backoffSeconds = attempts >= 3 ? Math.min(30, 2 ** (attempts - 2)) : 0;
  const windowExpiresAt = new Date(now + 10 * 60 * 1000).toISOString();
  const blockedUntil = backoffSeconds ? new Date(now + backoffSeconds * 1000).toISOString() : "";
  await db.prepare(`
    INSERT INTO guest_star_pin_attempts
      (attempt_key, attempts, window_expires_at, blocked_until, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(attempt_key) DO UPDATE SET
      attempts = excluded.attempts,
      window_expires_at = excluded.window_expires_at,
      blocked_until = excluded.blocked_until,
      updated_at = excluded.updated_at
  `).bind(attemptKey, attempts, windowExpiresAt, blockedUntil, nowIso()).run();
  return { attempts, retryAfterSeconds: backoffSeconds };
}

export async function clearPinFailures(db: D1DatabaseLike, attemptKey: string) {
  await db.prepare("DELETE FROM guest_star_pin_attempts WHERE attempt_key = ?").bind(attemptKey).run();
}

export function accessContext(hotel: JsonObject, activity: JsonObject): AccessContext {
  return {
    hotelId: text(hotel.hotelId),
    venueId: text(activity.venueId),
    activityId: text(activity.activityId),
    cycleId: text(activity.currentCycleId)
  };
}
