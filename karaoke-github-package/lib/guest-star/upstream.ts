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

export async function flushD1Backup(db: D1DatabaseLike) {
  const secret = await getMeta(db, "sheets_backup_secret");
  if (!secret) return { ok: false, code: "BACKUP_NOT_CONFIGURED" };
  const events = await pendingOutbox(db, 50);
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

export function scheduleD1Backup(db: D1DatabaseLike) {
  const operation = flushD1BackupFully(db, 4).catch(() => ({ ok: false }));
  try {
    getCloudflareContext().ctx.waitUntil(operation);
  } catch {
    void operation;
  }
}
