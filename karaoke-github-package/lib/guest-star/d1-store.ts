import { getCloudflareContext } from "@opennextjs/cloudflare";

export type JsonObject = Record<string, unknown>;

export interface D1RunResult {
  success?: boolean;
  meta?: Record<string, unknown>;
}

export interface D1AllResult<T> extends D1RunResult {
  results?: T[];
}

export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike;
  all<T = Record<string, unknown>>(): Promise<D1AllResult<T>>;
  first<T = Record<string, unknown>>(column?: string): Promise<T | null>;
  run(): Promise<D1RunResult>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1StatementLike;
  batch<T = D1RunResult>(statements: D1StatementLike[]): Promise<T[]>;
  exec(query: string): Promise<D1RunResult>;
}

export const D1_BINDING = "GUEST_STAR_DB";
export const D1_SCHEMA_VERSION = "4.2.0";
export const DAILY_FREE_TRANSLATION_NEURON_BUDGET = 7_000;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS guest_star_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS guest_star_records (
  scope TEXT NOT NULL,
  table_name TEXT NOT NULL,
  record_id TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (scope, table_name, record_id)
);
CREATE INDEX IF NOT EXISTS guest_star_records_table
  ON guest_star_records (scope, table_name, updated_at);
CREATE TABLE IF NOT EXISTS guest_star_requests (
  row_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  hotel_id TEXT NOT NULL,
  venue_id TEXT NOT NULL DEFAULT '',
  activity_id TEXT NOT NULL DEFAULT '',
  cycle_id TEXT NOT NULL DEFAULT '',
  singer TEXT NOT NULL,
  song TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  comment TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT '',
  language_code TEXT NOT NULL DEFAULT '',
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  transition_seconds INTEGER NOT NULL DEFAULT 0,
  accumulated_seconds INTEGER NOT NULL DEFAULT 0,
  remaining_seconds INTEGER NOT NULL DEFAULT 0,
  source_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'Pendiente',
  file_name TEXT NOT NULL DEFAULT '',
  source_type TEXT NOT NULL DEFAULT 'guest_request',
  virtual_dj_item_id TEXT NOT NULL DEFAULT '',
  queue_position INTEGER NOT NULL DEFAULT 0,
  sync_state TEXT NOT NULL DEFAULT '',
  last_seen_at TEXT NOT NULL DEFAULT '',
  state_revision INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS guest_star_requests_activity
  ON guest_star_requests (hotel_id, activity_id, archived_at, queue_position, created_at);
CREATE INDEX IF NOT EXISTS guest_star_requests_request_id
  ON guest_star_requests (hotel_id, request_id, archived_at);
CREATE INDEX IF NOT EXISTS guest_star_requests_virtual_dj
  ON guest_star_requests (hotel_id, activity_id, virtual_dj_item_id, archived_at);
CREATE TABLE IF NOT EXISTS guest_star_activity_runtime (
  activity_id TEXT PRIMARY KEY,
  hotel_id TEXT NOT NULL,
  venue_id TEXT NOT NULL DEFAULT '',
  cycle_id TEXT NOT NULL DEFAULT '',
  accepting INTEGER NOT NULL DEFAULT 0,
  running INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL DEFAULT '',
  finished_at TEXT NOT NULL DEFAULT '',
  state_revision INTEGER NOT NULL DEFAULT 0,
  last_action TEXT NOT NULL DEFAULT '',
  last_source TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS guest_star_activity_runtime_hotel
  ON guest_star_activity_runtime (hotel_id, updated_at);
CREATE TABLE IF NOT EXISTS guest_star_rate_limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS guest_star_outbox (
  event_id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS guest_star_outbox_pending
  ON guest_star_outbox (status, created_at);
`;

const TABLE_ID_FIELDS: Record<string, string> = {
  Users: "userId",
  Hotels: "hotelId",
  Venues: "venueId",
  Activities: "activityId",
  UserAssignments: "assignmentId",
  Devices: "deviceId",
  BridgeCommands: "commandId",
  AuthSessions: "authSessionId",
  OneTimeLoginCodes: "codeId",
  AuditLog: "logId",
  HotelBranding: "hotelBrandingId",
  ActivitySchedules: "scheduleId",
  UpcomingActivities: "upcomingActivityId",
  GlobalSettings: "settingKey",
  ActivityCycles: "cycleId",
  Reviews: "reviewId",
  ReviewInvitations: "invitationId",
  GuestReminders: "reminderId"
};

const schemaReady = new WeakMap<object, Promise<void>>();

function nowIso() {
  return new Date().toISOString();
}

function stringValue(value: unknown) {
  return value === null || value === undefined ? "" : String(value);
}

function numberValue(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function booleanValue(value: unknown) {
  return value === true || String(value).toLowerCase() === "true";
}

function cleanRecord(record: JsonObject): JsonObject {
  const output: JsonObject = {};
  for (const [key, value] of Object.entries(record || {})) {
    if (key === "_row") continue;
    output[key] = value;
  }
  return output;
}

function randomToken(size = 64) {
  const bytes = new Uint8Array(Math.max(16, size));
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, size);
}

export function getGuestStarD1(): D1DatabaseLike | null {
  try {
    const context = getCloudflareContext();
    const env = context.env as unknown as Record<string, unknown>;
    return (env[D1_BINDING] as D1DatabaseLike | undefined) || null;
  } catch {
    return null;
  }
}

export async function ensureD1Schema(db: D1DatabaseLike) {
  let ready = schemaReady.get(db as object);
  if (!ready) {
    ready = (async () => {
      await db.exec(SCHEMA_SQL);
      const now = nowIso();
      await db.batch([
        db.prepare(
          "INSERT OR IGNORE INTO guest_star_meta (key, value, updated_at) VALUES (?, ?, ?)"
        ).bind("schema_version", D1_SCHEMA_VERSION, now),
        db.prepare(
          "INSERT OR IGNORE INTO guest_star_meta (key, value, updated_at) VALUES (?, ?, ?)"
        ).bind("backend_mode", "apps_script", now),
        db.prepare(
          "INSERT OR IGNORE INTO guest_star_meta (key, value, updated_at) VALUES (?, ?, ?)"
        ).bind("session_hash_secret", randomToken(96), now)
      ]);
      await setMeta(db, "schema_version", D1_SCHEMA_VERSION);
    })();
    schemaReady.set(db as object, ready);
  }
  return ready;
}

export async function getMeta(db: D1DatabaseLike, key: string) {
  const row = await db.prepare(
    "SELECT value FROM guest_star_meta WHERE key = ? LIMIT 1"
  ).bind(key).first<{ value: string }>();
  return row?.value || "";
}

export async function setMeta(db: D1DatabaseLike, key: string, value: string) {
  await db.prepare(`
    INSERT INTO guest_star_meta (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).bind(key, value, nowIso()).run();
}

export async function reserveDailyFreeTranslationBudget(
  db: D1DatabaseLike,
  requestedNeurons: number
) {
  const neurons = Math.max(1, Math.ceil(Number(requestedNeurons) || 0));
  if (neurons > DAILY_FREE_TRANSLATION_NEURON_BUDGET) return false;
  await ensureD1Schema(db);

  // Workers AI's free allocation is daily. Keep a UTC-scoped, atomic application
  // budget below that allocation so concurrent saves cannot silently overrun it.
  const key = `workers_ai_translation_neurons:${new Date().toISOString().slice(0, 10)}`;
  const reservationId = `${nowIso()}#${randomToken(16)}`;
  const result = await db.prepare(`
    INSERT INTO guest_star_meta (key, value, updated_at)
    SELECT ?, ?, ? WHERE ? <= ?
    ON CONFLICT(key) DO UPDATE SET
      value = CAST(guest_star_meta.value AS INTEGER) + ?,
      updated_at = excluded.updated_at
    WHERE CAST(guest_star_meta.value AS INTEGER) + ? <= ?
  `).bind(
    key,
    String(neurons),
    reservationId,
    neurons,
    DAILY_FREE_TRANSLATION_NEURON_BUDGET,
    neurons,
    neurons,
    DAILY_FREE_TRANSLATION_NEURON_BUDGET
  ).run();

  const changes = Number(result.meta?.changes);
  if (Number.isFinite(changes)) return changes > 0;

  // Some D1 adapters omit `meta.changes`. The unique marker makes the fallback
  // concurrency-safe: a rejected reservation can never be mistaken for a
  // neighboring successful write. A simultaneous later success may only cause
  // a safe false negative (manual fallback), never an unbudgeted AI request.
  const row = await db.prepare(
    "SELECT value, updated_at FROM guest_star_meta WHERE key = ? LIMIT 1"
  ).bind(key).first<{ value: string; updated_at: string }>();
  return row?.updated_at === reservationId && Number(row.value) <= DAILY_FREE_TRANSLATION_NEURON_BUDGET;
}

export async function backendMode(db: D1DatabaseLike) {
  await ensureD1Schema(db);
  return (await getMeta(db, "backend_mode")) || "apps_script";
}

export async function listRecords(
  db: D1DatabaseLike,
  tableName: string,
  scope = "master"
) {
  const result = await db.prepare(`
    SELECT data_json FROM guest_star_records
    WHERE scope = ? AND table_name = ?
    ORDER BY created_at ASC, record_id ASC
  `).bind(scope, tableName).all<{ data_json: string }>();
  return (result.results || []).map((row) => JSON.parse(row.data_json) as JsonObject);
}

export async function getRecord(
  db: D1DatabaseLike,
  tableName: string,
  recordId: string,
  scope = "master"
) {
  const row = await db.prepare(`
    SELECT data_json FROM guest_star_records
    WHERE scope = ? AND table_name = ? AND record_id = ? LIMIT 1
  `).bind(scope, tableName, recordId).first<{ data_json: string }>();
  return row ? JSON.parse(row.data_json) as JsonObject : null;
}

export function recordIdFor(tableName: string, record: JsonObject) {
  const field = TABLE_ID_FIELDS[tableName];
  const value = field ? stringValue(record[field]) : "";
  if (value) return value;
  throw new Error(`MISSING_RECORD_ID:${tableName}`);
}

export async function upsertRecord(
  db: D1DatabaseLike,
  tableName: string,
  record: JsonObject,
  scope = "master"
) {
  const clean = cleanRecord(record);
  const id = recordIdFor(tableName, clean);
  const now = nowIso();
  const createdAt = stringValue(clean.createdAt) || now;
  const updatedAt = stringValue(clean.updatedAt) || now;
  await db.prepare(`
    INSERT INTO guest_star_records
      (scope, table_name, record_id, data_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(scope, table_name, record_id) DO UPDATE SET
      data_json = excluded.data_json,
      updated_at = excluded.updated_at
  `).bind(scope, tableName, id, JSON.stringify(clean), createdAt, updatedAt).run();
  return clean;
}

export async function updateRecord(
  db: D1DatabaseLike,
  tableName: string,
  recordId: string,
  changes: JsonObject,
  scope = "master"
) {
  const existing = await getRecord(db, tableName, recordId, scope);
  if (!existing) return null;
  const next = { ...existing, ...changes };
  await upsertRecord(db, tableName, next, scope);
  return next;
}

export async function deleteRecord(
  db: D1DatabaseLike,
  tableName: string,
  recordId: string,
  scope = "master"
) {
  await db.prepare(`
    DELETE FROM guest_star_records
    WHERE scope = ? AND table_name = ? AND record_id = ?
  `).bind(scope, tableName, recordId).run();
}

export interface GuestStarRequest {
  rowId: string;
  requestId: string;
  hotelId: string;
  venueId: string;
  activityId: string;
  cycleId: string;
  singer: string;
  song: string;
  artist: string;
  comment: string;
  language: string;
  languageCode: string;
  durationSeconds: number;
  transitionSeconds: number;
  accumulatedSeconds: number;
  remainingSeconds: number;
  sourceUrl: string;
  status: string;
  fileName: string;
  sourceType: string;
  virtualDJItemId: string;
  queuePosition: number;
  syncState: string;
  lastSeenAt: string;
  stateRevision: number;
  createdAt: string;
  updatedAt: string;
  archivedAt: string;
}

interface RequestRow {
  row_id: string;
  request_id: string;
  hotel_id: string;
  venue_id: string;
  activity_id: string;
  cycle_id: string;
  singer: string;
  song: string;
  artist: string;
  comment: string;
  language: string;
  language_code: string;
  duration_seconds: number;
  transition_seconds: number;
  accumulated_seconds: number;
  remaining_seconds: number;
  source_url: string;
  status: string;
  file_name: string;
  source_type: string;
  virtual_dj_item_id: string;
  queue_position: number;
  sync_state: string;
  last_seen_at: string;
  state_revision: number;
  created_at: string;
  updated_at: string;
  archived_at: string;
}

function requestFromRow(row: RequestRow): GuestStarRequest {
  return {
    rowId: row.row_id,
    requestId: row.request_id,
    hotelId: row.hotel_id,
    venueId: row.venue_id,
    activityId: row.activity_id,
    cycleId: row.cycle_id,
    singer: row.singer,
    song: row.song,
    artist: row.artist,
    comment: row.comment,
    language: row.language,
    languageCode: row.language_code,
    durationSeconds: Number(row.duration_seconds) || 0,
    transitionSeconds: Number(row.transition_seconds) || 0,
    accumulatedSeconds: Number(row.accumulated_seconds) || 0,
    remainingSeconds: Number(row.remaining_seconds) || 0,
    sourceUrl: row.source_url,
    status: row.status,
    fileName: row.file_name,
    sourceType: row.source_type,
    virtualDJItemId: row.virtual_dj_item_id,
    queuePosition: Number(row.queue_position) || 0,
    syncState: row.sync_state,
    lastSeenAt: row.last_seen_at,
    stateRevision: Number(row.state_revision) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}

export async function upsertRequest(db: D1DatabaseLike, item: GuestStarRequest) {
  await db.prepare(`
    INSERT INTO guest_star_requests (
      row_id, request_id, hotel_id, venue_id, activity_id, cycle_id,
      singer, song, artist, comment, language, language_code,
      duration_seconds, transition_seconds, accumulated_seconds, remaining_seconds,
      source_url, status, file_name, source_type, virtual_dj_item_id,
      queue_position, sync_state, last_seen_at, state_revision,
      created_at, updated_at, archived_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    ) ON CONFLICT(row_id) DO UPDATE SET
      request_id = excluded.request_id,
      hotel_id = excluded.hotel_id,
      venue_id = excluded.venue_id,
      activity_id = excluded.activity_id,
      cycle_id = excluded.cycle_id,
      singer = excluded.singer,
      song = excluded.song,
      artist = excluded.artist,
      comment = excluded.comment,
      language = excluded.language,
      language_code = excluded.language_code,
      duration_seconds = excluded.duration_seconds,
      transition_seconds = excluded.transition_seconds,
      accumulated_seconds = excluded.accumulated_seconds,
      remaining_seconds = excluded.remaining_seconds,
      source_url = excluded.source_url,
      status = excluded.status,
      file_name = excluded.file_name,
      source_type = excluded.source_type,
      virtual_dj_item_id = excluded.virtual_dj_item_id,
      queue_position = excluded.queue_position,
      sync_state = excluded.sync_state,
      last_seen_at = excluded.last_seen_at,
      state_revision = excluded.state_revision,
      updated_at = excluded.updated_at,
      archived_at = excluded.archived_at
  `).bind(
    item.rowId, item.requestId, item.hotelId, item.venueId, item.activityId, item.cycleId,
    item.singer, item.song, item.artist, item.comment, item.language, item.languageCode,
    item.durationSeconds, item.transitionSeconds, item.accumulatedSeconds, item.remainingSeconds,
    item.sourceUrl, item.status, item.fileName, item.sourceType, item.virtualDJItemId,
    item.queuePosition, item.syncState, item.lastSeenAt, item.stateRevision,
    item.createdAt, item.updatedAt, item.archivedAt
  ).run();
  return item;
}

export async function activeRequests(
  db: D1DatabaseLike,
  hotelId: string,
  activityId = ""
) {
  const query = activityId
    ? `SELECT * FROM guest_star_requests
       WHERE hotel_id = ? AND activity_id = ? AND archived_at = ''
       ORDER BY queue_position ASC, created_at ASC, row_id ASC`
    : `SELECT * FROM guest_star_requests
       WHERE hotel_id = ? AND archived_at = ''
       ORDER BY queue_position ASC, created_at ASC, row_id ASC`;
  const statement = activityId
    ? db.prepare(query).bind(hotelId, activityId)
    : db.prepare(query).bind(hotelId);
  const result = await statement.all<RequestRow>();
  return (result.results || []).map(requestFromRow);
}

export async function findActiveRequest(
  db: D1DatabaseLike,
  hotelId: string,
  requestId: string
) {
  const row = await db.prepare(`
    SELECT * FROM guest_star_requests
    WHERE hotel_id = ? AND request_id = ? AND archived_at = ''
    ORDER BY created_at DESC LIMIT 1
  `).bind(hotelId, requestId).first<RequestRow>();
  return row ? requestFromRow(row) : null;
}

export async function updateActiveRequest(
  db: D1DatabaseLike,
  hotelId: string,
  requestId: string,
  changes: Partial<GuestStarRequest>
) {
  const existing = await findActiveRequest(db, hotelId, requestId);
  if (!existing) return null;
  const next: GuestStarRequest = {
    ...existing,
    ...changes,
    rowId: existing.rowId,
    requestId: existing.requestId,
    hotelId: existing.hotelId,
    updatedAt: stringValue(changes.updatedAt) || nowIso()
  };
  return upsertRequest(db, next);
}

export async function archiveActiveRequests(
  db: D1DatabaseLike,
  hotelId: string,
  activityId: string,
  archivedAt = nowIso()
) {
  await db.prepare(`
    UPDATE guest_star_requests SET archived_at = ?, updated_at = ?
    WHERE hotel_id = ? AND activity_id = ? AND archived_at = ''
  `).bind(archivedAt, archivedAt, hotelId, activityId).run();
}

export interface ActivityRuntime {
  activityId: string;
  hotelId: string;
  venueId: string;
  cycleId: string;
  accepting: boolean;
  running: boolean;
  startedAt: string;
  finishedAt: string;
  stateRevision: number;
  lastAction: string;
  lastSource: string;
  updatedAt: string;
}

export async function getActivityRuntime(db: D1DatabaseLike, activityId: string) {
  const row = await db.prepare(`
    SELECT * FROM guest_star_activity_runtime WHERE activity_id = ? LIMIT 1
  `).bind(activityId).first<{
    activity_id: string; hotel_id: string; venue_id: string; cycle_id: string;
    accepting: number; running: number; started_at: string; finished_at: string;
    state_revision: number; last_action: string; last_source: string; updated_at: string;
  }>();
  if (!row) return null;
  return {
    activityId: row.activity_id,
    hotelId: row.hotel_id,
    venueId: row.venue_id,
    cycleId: row.cycle_id,
    accepting: Boolean(row.accepting),
    running: Boolean(row.running),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    stateRevision: Number(row.state_revision) || 0,
    lastAction: row.last_action,
    lastSource: row.last_source,
    updatedAt: row.updated_at
  } satisfies ActivityRuntime;
}

export async function upsertActivityRuntime(db: D1DatabaseLike, runtime: ActivityRuntime) {
  await db.prepare(`
    INSERT INTO guest_star_activity_runtime (
      activity_id, hotel_id, venue_id, cycle_id, accepting, running,
      started_at, finished_at, state_revision, last_action, last_source, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(activity_id) DO UPDATE SET
      hotel_id = excluded.hotel_id,
      venue_id = excluded.venue_id,
      cycle_id = excluded.cycle_id,
      accepting = excluded.accepting,
      running = excluded.running,
      started_at = excluded.started_at,
      finished_at = excluded.finished_at,
      state_revision = excluded.state_revision,
      last_action = excluded.last_action,
      last_source = excluded.last_source,
      updated_at = excluded.updated_at
  `).bind(
    runtime.activityId, runtime.hotelId, runtime.venueId, runtime.cycleId,
    runtime.accepting ? 1 : 0, runtime.running ? 1 : 0,
    runtime.startedAt, runtime.finishedAt, runtime.stateRevision,
    runtime.lastAction, runtime.lastSource, runtime.updatedAt
  ).run();
  return runtime;
}

export async function appendOutbox(
  db: D1DatabaseLike,
  action: string,
  payload: JsonObject
) {
  const eventId = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO guest_star_outbox
      (event_id, action, payload_json, status, attempts, created_at, processed_at, last_error)
    VALUES (?, ?, ?, 'pending', 0, ?, '', '')
  `).bind(eventId, action, JSON.stringify(payload), nowIso()).run();
  return eventId;
}

export interface OutboxEvent {
  eventId: string;
  action: string;
  payload: JsonObject;
  attempts: number;
  createdAt: string;
}

export async function pendingOutbox(db: D1DatabaseLike, limit = 50) {
  const result = await db.prepare(`
    SELECT event_id, action, payload_json, attempts, created_at
    FROM guest_star_outbox
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT ?
  `).bind(Math.max(1, Math.min(100, Math.round(limit)))).all<{
    event_id: string;
    action: string;
    payload_json: string;
    attempts: number;
    created_at: string;
  }>();
  return (result.results || []).map((row) => ({
    eventId: row.event_id,
    action: row.action,
    payload: JSON.parse(row.payload_json) as JsonObject,
    attempts: Number(row.attempts) || 0,
    createdAt: row.created_at
  } satisfies OutboxEvent));
}

export async function markOutboxProcessed(db: D1DatabaseLike, eventIds: string[]) {
  const processedAt = nowIso();
  await runBatches(db, eventIds.map((eventId) => db.prepare(`
    UPDATE guest_star_outbox
    SET status = 'processed', processed_at = ?, last_error = ''
    WHERE event_id = ?
  `).bind(processedAt, eventId)));
}

export async function markOutboxFailed(
  db: D1DatabaseLike,
  eventIds: string[],
  error: string
) {
  const message = String(error || "Backup delivery failed.").slice(0, 1000);
  await runBatches(db, eventIds.map((eventId) => db.prepare(`
    UPDATE guest_star_outbox
    SET attempts = attempts + 1, last_error = ?
    WHERE event_id = ? AND status = 'pending'
  `).bind(message, eventId)));
}

export async function outboxCounts(db: D1DatabaseLike) {
  const result = await db.prepare(`
    SELECT status, COUNT(*) AS count FROM guest_star_outbox GROUP BY status
  `).all<{ status: string; count: number }>();
  const counts: Record<string, number> = { pending: 0, processed: 0 };
  for (const row of result.results || []) counts[row.status] = Number(row.count) || 0;
  return counts;
}

export async function checkRateLimit(
  db: D1DatabaseLike,
  key: string,
  limit: number,
  windowSeconds: number,
  succeeded = false
) {
  const now = Date.now();
  const existing = await db.prepare(`
    SELECT attempts, expires_at FROM guest_star_rate_limits WHERE key = ? LIMIT 1
  `).bind(key).first<{ attempts: number; expires_at: string }>();
  if (succeeded) {
    await db.prepare("DELETE FROM guest_star_rate_limits WHERE key = ?").bind(key).run();
    return true;
  }
  const expired = !existing || Date.parse(existing.expires_at) <= now;
  const attempts = expired ? 1 : Number(existing.attempts || 0) + 1;
  const expiresAt = new Date(now + windowSeconds * 1000).toISOString();
  await db.prepare(`
    INSERT INTO guest_star_rate_limits (key, attempts, expires_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      attempts = excluded.attempts,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `).bind(key, attempts, expired ? expiresAt : existing.expires_at, nowIso()).run();
  return attempts <= limit;
}

export interface D1MigrationSnapshot {
  schemaVersion?: string;
  exportedAt?: string;
  backupSecret?: string;
  youtubeApiKey?: string;
  master?: Record<string, JsonObject[]>;
  hotels?: Array<{
    hotelId: string;
    error?: string;
    legacyConfig?: JsonObject;
    tables?: Record<string, JsonObject[]>;
  }>;
}

function durationSeconds(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.round(value <= 10 ? value * 86400 : value));
  }
  const text = stringValue(value).trim();
  if (!text) return 0;
  const parts = text.match(/^(\d+):(\d{1,2}):(\d{1,2})$/);
  if (parts) return Number(parts[1]) * 3600 + Number(parts[2]) * 60 + Number(parts[3]);
  const parsed = Date.parse(text);
  if (Number.isFinite(parsed) && /^1899-|^1900-/.test(text)) {
    const date = new Date(parsed);
    return date.getUTCHours() * 3600 + date.getUTCMinutes() * 60 + date.getUTCSeconds();
  }
  return Math.max(0, Math.round(Number(text) || 0));
}

function sheetRequest(
  record: JsonObject,
  hotelId: string,
  archived: boolean,
  index: number,
  defaults: { venueId?: string; activityId?: string; cycleId?: string } = {}
): GuestStarRequest | null {
  const requestId = stringValue(record["ID"] || record.requestId || record.id) || crypto.randomUUID();
  const singer = stringValue(record["Nombre"] || record.singer);
  const song = stringValue(record["Canción"] || record.song);
  if (!singer || !song) return null;
  const createdAt = stringValue(record["Fecha y hora"] || record.createdAt || record.timestamp) || nowIso();
  const updatedAt = stringValue(record["Actualizado"] || record.updatedAt) || createdAt;
  const language = stringValue(record["Idioma"] || record.language);
  const languageCode = stringValue(record["Language code"] || record.languageCode) ||
    (/^(es|spanish|español)$/i.test(language) ? "es" : /^(en|english|inglés)$/i.test(language) ? "en" : "");
  return {
    rowId: `${archived ? "history" : "active"}:${hotelId}:${requestId}:${index}`,
    requestId,
    hotelId: stringValue(record["Hotel ID"] || record.hotelId) || hotelId,
    venueId: stringValue(record["Venue ID"] || record.venueId || defaults.venueId),
    activityId: stringValue(record["Activity ID"] || record.activityId || defaults.activityId),
    cycleId: stringValue(record["Cycle ID"] || record.cycleId || defaults.cycleId),
    singer,
    song,
    artist: stringValue(record["Artista"] || record.artist),
    comment: stringValue(record["Comentario"] || record.comment),
    language,
    languageCode,
    durationSeconds: durationSeconds(record["Duración"] ?? record.durationSeconds),
    transitionSeconds: durationSeconds(record["Transición"] ?? record.transitionSeconds),
    accumulatedSeconds: durationSeconds(record["Tiempo acumulado"] ?? record.accumulatedSeconds),
    remainingSeconds: durationSeconds(record["Tiempo restante"] ?? record.remainingSeconds),
    sourceUrl: stringValue(record["Fuente"] || record.sourceUrl),
    status: stringValue(record["Estado"] || record.status) || "Pendiente",
    fileName: stringValue(record["Archivo local"] || record.fileName),
    sourceType: stringValue(record["Source type"] || record.sourceType) || "guest_request",
    virtualDJItemId: stringValue(record["VirtualDJ item ID"] || record.virtualDJItemId),
    queuePosition: numberValue(record["Queue position"] ?? record.queuePosition),
    syncState: stringValue(record["Sync state"] || record.syncState),
    lastSeenAt: stringValue(record["Last seen in VirtualDJ"] || record.lastSeenAt),
    stateRevision: numberValue(record["Status revision"] ?? record.stateRevision),
    createdAt,
    updatedAt,
    archivedAt: archived ? updatedAt || createdAt : ""
  };
}

async function runBatches(db: D1DatabaseLike, statements: D1StatementLike[], size = 50) {
  for (let index = 0; index < statements.length; index += size) {
    await db.batch(statements.slice(index, index + size));
  }
}

export async function importD1Snapshot(db: D1DatabaseLike, snapshot: D1MigrationSnapshot) {
  await ensureD1Schema(db);
  const master = snapshot.master || {};
  const users = Array.isArray(master.Users) ? master.Users : [];
  const hotels = Array.isArray(master.Hotels) ? master.Hotels : [];
  if (!users.length || !hotels.length) throw new Error("MIGRATION_SNAPSHOT_INCOMPLETE");
  if (!users.some((user) => user.role === "superhost" && user.passwordHash && user.passwordSalt)) {
    throw new Error("MIGRATION_SUPERHOST_CREDENTIALS_MISSING");
  }
  if (users.some((user) => stringValue(user.status) === "active" && (!user.passwordHash || !user.passwordSalt))) {
    throw new Error("MIGRATION_USER_CREDENTIALS_MISSING");
  }
  const hotelSnapshots = Array.isArray(snapshot.hotels) ? snapshot.hotels : [];
  for (const hotel of hotels) {
    if (stringValue(hotel.status) !== "active" || !stringValue(hotel.dataSheetId)) continue;
    const hotelSnapshot = hotelSnapshots.find(
      (candidate) => stringValue(candidate.hotelId) === stringValue(hotel.hotelId)
    );
    if (!hotelSnapshot || hotelSnapshot.error) {
      throw new Error(`MIGRATION_HOTEL_SNAPSHOT_MISSING:${stringValue(hotel.hotelId)}`);
    }
  }

  await setMeta(db, "migration_status", "importing");
  await setMeta(db, "backend_mode", "apps_script");
  await db.exec(`
    DELETE FROM guest_star_records;
    DELETE FROM guest_star_requests;
    DELETE FROM guest_star_activity_runtime;
    DELETE FROM guest_star_rate_limits;
    DELETE FROM guest_star_outbox;
  `);

  const recordStatements: D1StatementLike[] = [];
  const skippedTables = new Set(["AuthSessions", "OneTimeLoginCodes"]);
  for (const [tableName, rows] of Object.entries(master)) {
    if (!Array.isArray(rows) || skippedTables.has(tableName)) continue;
    for (const input of rows) {
      const record = cleanRecord(input);
      if (tableName === "Devices") {
        record.deviceTokenHash = "";
        record.status = "revoked";
      }
      const id = recordIdFor(tableName, record);
      const now = nowIso();
      recordStatements.push(db.prepare(`
        INSERT INTO guest_star_records
          (scope, table_name, record_id, data_json, created_at, updated_at)
        VALUES ('master', ?, ?, ?, ?, ?)
      `).bind(
        tableName,
        id,
        JSON.stringify(record),
        stringValue(record.createdAt) || now,
        stringValue(record.updatedAt) || now
      ));
    }
  }
  await runBatches(db, recordStatements);

  let requestCount = 0;
  for (const hotelSnapshot of snapshot.hotels || []) {
    const hotelId = stringValue(hotelSnapshot.hotelId);
    if (!hotelId) continue;
    const hotel = hotels.find((candidate) => stringValue(candidate.hotelId) === hotelId);
    const defaultActivityId = stringValue(hotel?.activePublicActivityId);
    const defaultActivity = (master.Activities || []).find(
      (candidate) => stringValue(candidate.activityId) === defaultActivityId
    );
    const requestDefaults = {
      venueId: stringValue(defaultActivity?.venueId),
      activityId: defaultActivityId,
      cycleId: stringValue(defaultActivity?.currentCycleId)
    };
    const tables = hotelSnapshot.tables || {};
    for (const [tableName, rows] of Object.entries(tables)) {
      if (!Array.isArray(rows)) continue;
      if (tableName === "Solicitudes" || tableName === "Historial") {
        const archived = tableName === "Historial";
        for (let index = 0; index < rows.length; index++) {
          const item = sheetRequest(rows[index], hotelId, archived, index, requestDefaults);
          if (!item) continue;
          await upsertRequest(db, item);
          requestCount += 1;
        }
        continue;
      }
      if (!TABLE_ID_FIELDS[tableName]) continue;
      for (const row of rows) await upsertRecord(db, tableName, row, hotelId);
    }

    const activityId = stringValue(hotel?.activePublicActivityId);
    const activity = (master.Activities || []).find(
      (candidate) => stringValue(candidate.activityId) === activityId
    );
    if (activityId && activity) {
      const config = hotelSnapshot.legacyConfig || {};
      await upsertActivityRuntime(db, {
        activityId,
        hotelId,
        venueId: stringValue(activity.venueId),
        cycleId: stringValue(activity.currentCycleId),
        accepting: booleanValue(config.accepting) || String(activity.status) === "in_progress",
        running: booleanValue(config.activityRunning) || String(activity.status) === "in_progress",
        startedAt: stringValue(config.activityStartedAt),
        finishedAt: "",
        stateRevision: numberValue(config.stateRevision),
        lastAction: stringValue(config.lastAction) || "migration",
        lastSource: stringValue(config.lastSource) || "apps-script",
        updatedAt: stringValue(config.updatedAt) || nowIso()
      });
    }
  }

  const importedAt = nowIso();
  const [importedUsers, importedHotels, importedActivities, importedRequestRow] = await Promise.all([
    listRecords(db, "Users"),
    listRecords(db, "Hotels"),
    listRecords(db, "Activities"),
    db.prepare("SELECT COUNT(*) AS count FROM guest_star_requests").first<{ count: number }>()
  ]);
  const counts = {
    users: importedUsers.length,
    hotels: importedHotels.length,
    activities: importedActivities.length,
    requests: Number(importedRequestRow?.count) || 0
  };
  if (
    counts.users !== users.length ||
    counts.hotels !== hotels.length ||
    counts.activities !== (Array.isArray(master.Activities) ? master.Activities.length : 0) ||
    counts.requests !== requestCount
  ) throw new Error("MIGRATION_COUNT_VALIDATION_FAILED");
  await setMeta(db, "migration_counts", JSON.stringify(counts));
  await setMeta(db, "migration_source_version", stringValue(snapshot.schemaVersion || "unknown"));
  const defaultHotel = hotels.find((hotel) => stringValue(hotel.status) === "active") || hotels[0];
  if (defaultHotel) {
    await setMeta(db, "default_public_hotel_id", stringValue(defaultHotel.hotelId));
  }
  if (snapshot.backupSecret) {
    await setMeta(db, "sheets_backup_secret", stringValue(snapshot.backupSecret));
  }
  if (snapshot.youtubeApiKey) {
    await setMeta(db, "youtube_api_key", stringValue(snapshot.youtubeApiKey));
  }
  await setMeta(db, "migration_imported_at", importedAt);
  await setMeta(db, "migration_status", "ready");
  return { importedAt, counts, status: "ready" };
}

export async function d1Health(db: D1DatabaseLike) {
  await ensureD1Schema(db);
  const [mode, status, importedAt, counts, youtubeApiKey, backup] = await Promise.all([
    getMeta(db, "backend_mode"),
    getMeta(db, "migration_status"),
    getMeta(db, "migration_imported_at"),
    getMeta(db, "migration_counts"),
    getMeta(db, "youtube_api_key"),
    outboxCounts(db)
  ]);
  return {
    ok: true,
    backend: "cloudflare-d1",
    schemaVersion: D1_SCHEMA_VERSION,
    mode: mode || "apps_script",
    migrationStatus: status || "not_started",
    importedAt,
    counts: counts ? JSON.parse(counts) : null,
    youtubeConfigured: Boolean(youtubeApiKey),
    backup
  };
}
