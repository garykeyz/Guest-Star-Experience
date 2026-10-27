import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { type D1DatabaseLike, type D1StatementLike, ensureD1Schema, listRecords, upsertRecord } from "../lib/guest-star/d1-store";
import { handleD1HostAction, loginD1WithVerifiedGoogle } from "../lib/guest-star/d1-actions";

class Statement implements D1StatementLike {
  values: SQLInputValue[] = [];
  constructor(private sqlite: DatabaseSync, private query: string) {}
  bind(...values: unknown[]) { this.values = values as SQLInputValue[]; return this; }
  async all<T>() { return { success: true, results: this.sqlite.prepare(this.query).all(...this.values) as T[] }; }
  async first<T>(column?: string) { const row = this.sqlite.prepare(this.query).get(...this.values); return (row ? column ? row[column] : row : null) as T | null; }
  async run() { const result = this.sqlite.prepare(this.query).run(...this.values); return { success: true, meta: { changes: Number(result.changes) } }; }
}
class Database implements D1DatabaseLike {
  sqlite = new DatabaseSync(":memory:");
  prepare(query: string) { return new Statement(this.sqlite, query); }
  async batch<T>(statements: D1StatementLike[]) { const results = []; for (const statement of statements) results.push(await statement.run()); return results as T[]; }
  async exec(query: string) { this.sqlite.exec(query); return { success: true }; }
}
const db = new Database();
await ensureD1Schema(db);
const stamp = new Date().toISOString();
await upsertRecord(db, "Users", { userId: "owner", username: "owner", email: "owner@example.test", role: "superhost", status: "active", createdAt: stamp });
for (const hotelId of ["hotel-1", "hotel-2"]) await upsertRecord(db, "Hotels", { hotelId, name: hotelId, status: "active", timezone: "UTC", createdAt: stamp });
for (const [venueId, hotelId] of [["venue-1", "hotel-1"], ["venue-2", "hotel-1"], ["venue-3", "hotel-2"]]) await upsertRecord(db, "Venues", { venueId, hotelId, name: venueId, status: "active", createdAt: stamp });
const login = await loginD1WithVerifiedGoogle(db, "owner@example.test", { clientType: "web" });
assert.equal(login?.ok, true);
const authToken = login && "authToken" in login ? login.authToken : "";
const create = (name: string, venueId = "venue-1", hotelId = "hotel-1") => handleD1HostAction(db, { action: "createActivity", authToken, hotelId, venueId, name, allowedLanguages: ["es", "en"] });
const competing = await Promise.all(Array.from({ length: 12 }, () => create("Friday Night Live")));
assert.ok(competing.every(result => result?.ok));
assert.equal(new Set(competing.map(result => (result?.activity as Record<string, unknown>)?.activityId)).size, 1);
assert.equal(competing.filter(result => result?.deduplicated === false).length, 1);
assert.equal((await listRecords(db, "Activities")).length, 1);
assert.equal((await listRecords(db, "AuditLog")).filter(row => row.action === "activity.created").length, 1);
const original = competing[0]?.activity as Record<string, unknown>;
assert.equal((await create("  friday night live  "))?.deduplicated, true);
assert.equal((await create("Friday Night Live", "venue-2"))?.deduplicated, false);
assert.equal((await create("Friday Night Live", "venue-3", "hotel-2"))?.deduplicated, false);
assert.equal((await create("Latin Karaoke"))?.deduplicated, false);
assert.equal((await create(""))?.code, "ACTIVITY_NAME_REQUIRED");
assert.equal((await create("Missing venue", "missing"))?.ok, false);
const retry = await create("Friday Night Live");
assert.deepEqual(retry?.activity, original, "a repeated request must not overwrite the original settings or ID");
assert.equal((await handleD1HostAction(db, { action: "updateActivity", authToken, activityId: original.activityId, status: "inactive" }))?.recoverable, true);
const replacement = await create("Friday Night Live");
assert.equal(replacement?.deduplicated, false);
assert.notEqual((replacement?.activity as Record<string, unknown>).activityId, original.activityId);
console.log("Activity creation: 12 competing calls, retry, case/whitespace, venue/hotel separation, validation and recoverable deletion passed.");
