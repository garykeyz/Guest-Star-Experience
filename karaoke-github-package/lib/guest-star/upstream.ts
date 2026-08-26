import {
  type D1DatabaseLike,
  type JsonObject,
  getMeta,
  markOutboxFailed,
  markOutboxProcessed,
  outboxCounts,
  pendingOutbox
} from "./d1-store";
import { getCloudflareContext } from "@opennextjs/cloudflare";

export const APPS_SCRIPT_ENDPOINT =
  process.env.KARAOKE_APPS_SCRIPT_URL ||
  "https://script.google.com/macros/s/AKfycbxpUugPQJ1N3yb8uezB6fpd84CELAKtbuB2maE3HberOBGo5ObABGtN3ZfCI3UvKbLkzg/exec";

export async function callAppsScript(
  payload: JsonObject,
  timeoutMs = 30_000
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(APPS_SCRIPT_ENDPOINT, {
      method: "POST",
      cache: "no-store",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Guest Star returned ${response.status}.`);
    try {
      return JSON.parse(text) as JsonObject;
    } catch {
      throw new Error("Guest Star returned an invalid response.");
    }
  } finally {
    clearTimeout(timeout);
  }
}

export async function flushD1Backup(db: D1DatabaseLike, limit = 20) {
  const secret = await getMeta(db, "sheets_backup_secret");
  if (!secret) return { ok: false, code: "BACKUP_NOT_CONFIGURED" };
  const events = await pendingOutbox(db, Math.max(1, Math.min(20, Math.round(limit))));
  if (!events.length) return { ok: true, delivered: 0 };
  const ids = events.map((event) => event.eventId);
  try {
    const result = await callAppsScript({
      action: "ingestD1Backup",
      backupSecret: secret,
      events
    }, 60_000);
    if (result.ok !== true) {
      throw new Error(String(result.code || result.error || "BACKUP_REJECTED"));
    }
    await markOutboxProcessed(db, ids);
    return { ok: true, delivered: ids.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markOutboxFailed(db, ids, message);
    return { ok: false, code: "BACKUP_DELIVERY_FAILED", error: message };
  }
}

export async function flushD1BackupFully(db: D1DatabaseLike, maxBatches = 10) {
  let delivered = 0;
  for (let batch = 0; batch < Math.max(1, maxBatches); batch += 1) {
    const result = await flushD1Backup(db);
    if (result.ok !== true) return { ...result, delivered };
    delivered += Number(result.delivered) || 0;
    const counts = await outboxCounts(db);
    if (!counts.pending) return { ok: true, delivered, pending: 0 };
    if (!result.delivered) break;
  }
  const counts = await outboxCounts(db);
  return counts.pending
    ? { ok: false, code: "BACKUP_PENDING", delivered, pending: counts.pending }
    : { ok: true, delivered, pending: 0 };
}

const scheduledBackups = new WeakMap<object, Promise<unknown>>();
const BACKUP_LEASE_KEY = "sheets_backup_delivery_lease";
const BACKUP_LEASE_MS = 90_000;

async function acquireD1BackupLease(db: D1DatabaseLike) {
  const token = crypto.randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + BACKUP_LEASE_MS).toISOString();
  const result = await db.prepare(`
    INSERT INTO guest_star_meta (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
    WHERE guest_star_meta.updated_at <= ?
  `).bind(BACKUP_LEASE_KEY, token, expiresAt, now.toISOString()).run();
  const changes = Number(result.meta?.changes);
  if (Number.isFinite(changes)) return changes > 0;
  const row = await db.prepare(
    "SELECT value FROM guest_star_meta WHERE key = ? LIMIT 1"
  ).bind(BACKUP_LEASE_KEY).first<{ value: string }>();
  return row?.value === token;
}

async function flushLeasedD1Backup(db: D1DatabaseLike) {
  if (!await acquireD1BackupLease(db)) {
    return { ok: true, delivered: 0, deferred: true };
  }
  // The D1 lease remains until its expiry. Besides protecting concurrent
  // isolates, this creates a short global cooldown for the slow Sheets mirror.
  return flushD1Backup(db, 20);
}

export function scheduleD1Backup(db: D1DatabaseLike) {
  const key = db as object;
  let operation = scheduledBackups.get(key);
  if (!operation) {
    // A normal request only drains one small batch. Read-only polling never
    // calls this function, and concurrent mutations in the same isolate share
    // the same operation instead of multiplying Apps Script/D1 work.
    operation = flushLeasedD1Backup(db)
      .catch(() => ({ ok: false }))
      .finally(() => scheduledBackups.delete(key));
    scheduledBackups.set(key, operation);
  }
  try {
    getCloudflareContext().ctx.waitUntil(operation);
  } catch {
    void operation;
  }
}
