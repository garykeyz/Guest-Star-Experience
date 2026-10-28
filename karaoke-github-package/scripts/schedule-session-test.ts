import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type D1DatabaseLike, type D1StatementLike, ensureD1Schema, listRecords, upsertRecord, getRecord, activeRequests, upsertRequest, type GuestStarRequest } from "../lib/guest-star/d1-store";
import { handleD1HostAction, handleD1PublicGet, handleD1PublicPost, loginD1WithVerifiedGoogle } from "../lib/guest-star/d1-actions";

class Statement implements D1StatementLike {
  values: SQLInputValue[] = [];
  constructor(private sqlite: DatabaseSync, private query: string) {}
  bind(...values: unknown[]) { this.values = values as SQLInputValue[]; return this; }
  async all<T>() { return { success: true, results: this.sqlite.prepare(this.query).all(...this.values) as T[] }; }
  async first<T>(column?: string) { const row = this.sqlite.prepare(this.query).get(...this.values); return (row ? column ? row[column] : row : null) as T | null; }
  runSync() { const result = this.sqlite.prepare(this.query).run(...this.values); return { success: true, meta: { changes: Number(result.changes) } }; }
  async run() { return this.runSync(); }
}
class Database implements D1DatabaseLike {
  sqlite: DatabaseSync;
  constructor(path = ":memory:") { this.sqlite = new DatabaseSync(path); }
  prepare(query: string) { return new Statement(this.sqlite, query); }
  async batch<T>(statements: D1StatementLike[]) { this.sqlite.exec("BEGIN"); const results = []; try {for (const statement of statements) results.push((statement as Statement).runSync()); this.sqlite.exec("COMMIT"); return results as T[];} catch(error){this.sqlite.exec("ROLLBACK");throw error;} }
  async exec(query: string) { this.sqlite.exec(query); return { success: true }; }
}

import { readFileSync } from "node:fs";
import { nextScheduleOccurrence, processD1ActivitySchedules } from "../lib/guest-star/d1-actions";
import { activityRun, processDueActivityRuns } from "../lib/guest-star/activity-run";
const testDirectory = mkdtempSync(join(tmpdir(), "guest-star-session-"));
const databasePath = join(testDirectory, "sessions.sqlite");
const db = new Database(databasePath);
await ensureD1Schema(db);
const stamp = new Date().toISOString();
await upsertRecord(db,"Users",{userId:"owner",username:"owner",email:"owner@example.test",role:"superhost",status:"active",createdAt:stamp});
const login = await loginD1WithVerifiedGoogle(db,"owner@example.test",{clientType:"web"});
const authToken = login && "authToken" in login ? login.authToken : "";
for(const id of ["a","b","c"]) {
  await upsertRecord(db,"Hotels",{hotelId:`hotel-${id}`,name:`Hotel ${id}`,status:"active",timezone:"America/Santo_Domingo",publicCode:`public-hotel-${id}`,publicUrl:`https://request.gstarxp.com/h/public-hotel-${id}`,activePublicActivityId:`activity-${id}`,createdAt:stamp});
  await upsertRecord(db,"Venues",{venueId:`venue-${id}`,hotelId:`hotel-${id}`,name:"Lobby",status:"active",createdAt:stamp});
  await upsertRecord(db,"Activities",{activityId:`activity-${id}`,hotelId:`hotel-${id}`,venueId:`venue-${id}`,name:"Karaoke Night",status:"ready",currentCycleId:"",defaultDurationSeconds:7200,createdAt:stamp});
}
const action=(action:string,id="a",extra:Record<string,unknown>={})=>handleD1HostAction(db,{action,authToken,hotelId:`hotel-${id}`,venueId:`venue-${id}`,activityId:`activity-${id}`,source:"player",...extra});
const nextA = new Date(Date.now()+86400000).toISOString();
const nextB = new Date(Date.now()+172800000).toISOString();
const schedA=await action("scheduleActivity","a",{scheduledStartAt:nextA,durationSeconds:7200});
const schedB=await action("scheduleActivity","b",{scheduledStartAt:nextB,durationSeconds:7200});
assert.equal(schedA?.ok,true); assert.equal(schedB?.ok,true);
const scheduleId=String((schedA?.schedule as Record<string,unknown>).scheduleId);
const original=await getRecord(db,"ActivitySchedules",scheduleId);
await upsertRecord(db,"ActivitySchedules",{scheduleId:"ambiguous",hotelId:"hotel-a",activityId:"activity-b",venueId:"venue-b",status:"active",scheduledStartAt:new Date(Date.now()+30000).toISOString()});
await upsertRecord(db,"Venues",{venueId:"venue-a-other",hotelId:"hotel-a",name:"Lobby",status:"active"});
await upsertRecord(db,"Activities",{activityId:"activity-a-other",hotelId:"hotel-a",venueId:"venue-a-other",name:"Karaoke Night",status:"ready"});
await upsertRecord(db,"ActivitySchedules",{scheduleId:"other-activity",hotelId:"hotel-a",activityId:"activity-a-other",venueId:"venue-a-other",status:"active",scheduledStartAt:nextB});
await upsertRecord(db,"ActivitySchedules",{scheduleId:"wrong-venue",hotelId:"hotel-a",activityId:"activity-a",venueId:"venue-a-other",status:"active",scheduledStartAt:nextB});
assert.equal((await action("updateSchedule","a",{scheduleId:(schedB?.schedule as any).scheduleId,scheduledStartAt:nextA}))?.code,"SCHEDULE_CONTEXT_MISMATCH");
assert.equal((await action("cancelSchedule","a",{scheduleId:(schedB?.schedule as any).scheduleId}))?.code,"SCHEDULE_CONTEXT_MISMATCH");
const prepared=await action("prepareSession","a",{sessionMode:"free",durationSeconds:3600,finalMessage:"Hasta la próxima",autoStart:false});
assert.equal(prepared?.ok,true,JSON.stringify(prepared));
assert.equal((prepared?.session as Record<string,unknown>).scheduleId,null);
assert.equal((prepared?.state as any).activityRunning,false,"auto-start OFF keeps manual control even when time is now");
assert.equal(prepared?.previousQueueCount,0);
assert.equal((prepared?.state as Record<string,unknown>).activityHours,1);
assert.deepEqual(await getRecord(db,"ActivitySchedules",scheduleId),original);
assert.equal((await action("startActivityV4"))?.ok,true);
assert.equal((await action("finishActivityV4"))?.ok,true);
const final=await handleD1PublicGet(db,new URLSearchParams({action:"publicBootstrap",hotel:"public-hotel-a"}));
assert.equal(final.accepting,false);
assert.equal((final.finalExperience as any).message,"Hasta la próxima");
assert.equal((final.finalExperience as any).nextActivity.scheduledStartAt,nextA);
assert.equal((final.finalExperience as any).nextActivity.hotelId,"hotel-a");
assert.equal((final.upcomingActivities as any[]).length,1);
assert.deepEqual(await getRecord(db,"ActivitySchedules",scheduleId),original,"free finish leaves future schedule byte-for-byte intact");
const restored=await action("selectActivity");
assert.equal((restored?.finalExperience as any).nextActivity.scheduledStartAt,nextA,"refresh restores authoritative final state");
db.sqlite.close();
const restartedDb=new Database(databasePath);db.sqlite=restartedDb.sqlite;
const afterRestart=await handleD1HostAction(restartedDb,{action:"selectActivity",authToken,hotelId:"hotel-a",venueId:"venue-a",activityId:"activity-a"});
assert.equal((afterRestart?.finalExperience as any).nextActivity.scheduledStartAt,nextA,"fresh backend instance retains free-session final state");
const oldRunId=(restored?.session as any).runId;
assert.equal((await action("prepareSession","a",{sessionMode:"free",expectedRevision:-1}))?.code,"SESSION_STATE_CHANGED");
assert.equal((await action("toggleRequests","a",{open:true}))?.code,"SESSION_PREPARATION_REQUIRED");
// Explicit prior-queue consent and context-only cleanup.
const queue=(id:string,hotelId="hotel-a",activityId="activity-a",venueId="venue-a")=>upsertRequest(db,{rowId:id,requestId:id,hotelId,activityId,venueId,cycleId:"old-cycle",singer:id,song:"Song",artist:"Artist",status:"Pendiente",comment:"",language:"English",languageCode:"en",durationSeconds:180,transitionSeconds:30,accumulatedSeconds:0,remainingSeconds:7200,sourceUrl:"",fileName:"",sourceType:"guest_request",virtualDJItemId:"",queuePosition:1,syncState:"",lastSeenAt:"",stateRevision:1,createdAt:stamp,updatedAt:stamp,archivedAt:""} as GuestStarRequest);
await queue("old-a");await queue("old-b","hotel-b","activity-b","venue-b");
assert.equal((await action("prepareSession","a",{sessionMode:"free"}))?.code,"PREVIOUS_QUEUE_CHOICE_REQUIRED");
const keep=await action("prepareSession","a",{sessionMode:"free",queueChoice:"keep"});
assert.equal(keep?.ok,true,JSON.stringify(keep));
assert.equal((await action("finishActivityV4","a",{runId:oldRunId}))?.code,"SESSION_STATE_CHANGED","stale Host cannot finish the new session");
assert.equal((await activeRequests(db,"hotel-a","activity-a")).length,1);
await action("finishActivityV4");
const cleared=await action("prepareSession","a",{sessionMode:"free",queueChoice:"clear"});
assert.equal(cleared?.ok,true);
assert.equal((await activeRequests(db,"hotel-a","activity-a")).length,0);
assert.equal((await activeRequests(db,"hotel-b","activity-b")).length,1);
await action("finishActivityV4");
// Competing hosts and idempotent automatic start.
const opens=await Promise.all([action("prepareSession","a",{sessionMode:"free",startsAt:new Date(Date.now()+100000).toISOString(),autoStart:true}),action("prepareSession","a",{sessionMode:"free",startsAt:new Date(Date.now()+100000).toISOString(),autoStart:true})]);
assert.equal(db.sqlite.prepare("SELECT count(*) AS n FROM guest_star_activity_runs WHERE hotel_id='hotel-a' AND status='scheduled'").get()?.n,1);
assert.ok(opens.some(value=>value?.ok));
db.sqlite.prepare("UPDATE guest_star_activity_runs SET starts_at=?, data_json=json_set(data_json,'$.startsAt',?) WHERE status='scheduled' AND hotel_id='hotel-a'").run(stamp,stamp);
const beforeAuto=await action("selectActivity");
await Promise.all([processDueActivityRuns(db,"hotel-a"),processDueActivityRuns(db,"hotel-a")]);
const afterAuto=await action("selectActivity");
assert.equal((afterAuto?.state as any).activityRunning,true);
const startStamp=(afterAuto?.state as any).activityStartedAt;
const revision=(afterAuto?.state as any).stateRevision;
assert.equal(await processDueActivityRuns(db,"hotel-a"),false);
const duplicate=await action("selectActivity");
assert.equal((duplicate?.state as any).stateRevision,revision);
assert.equal((duplicate?.state as any).activityStartedAt,startStamp);
await action("finishActivityV4");
// Forged linkage never consumes or shows another hotel's schedule.
assert.equal((await action("prepareSession","a",{sessionMode:"scheduled",scheduleId:(schedB?.schedule as any).scheduleId}))?.code,"SCHEDULE_CONTEXT_MISMATCH");
const scheduled=await action("prepareSession","a",{sessionMode:"scheduled",scheduleId});
assert.equal(scheduled?.ok,true);
await action("finishActivityV4");
const noDate=await handleD1PublicGet(db,new URLSearchParams({action:"publicBootstrap",hotel:"public-hotel-a"}));
assert.equal((noDate.finalExperience as any).nextActivity,null);
assert.equal((await getRecord(db,"Activities","activity-a"))?.status,"finished");
db.sqlite.exec(readFileSync("migrations/0007_activity_runs.sql","utf8"));
db.sqlite.exec(readFileSync("migrations/0007_activity_runs.sql","utf8"));
assert.equal((await getRecord(db,"ActivitySchedules",String((schedB?.schedule as any).scheduleId)))?.scheduledStartAt,nextB,"migration is additive and idempotent");
assert.equal(nextScheduleOccurrence({scheduledStartAt:"2026-03-07T01:00:00.000Z",recurrenceType:"daily",recurrenceInterval:1},"America/New_York"),"2026-03-08T01:00:00.000Z");
assert.equal(nextScheduleOccurrence({scheduledStartAt:"2026-03-08T01:00:00.000Z",recurrenceType:"daily",recurrenceInterval:1},"America/New_York"),"2026-03-09T00:00:00.000Z","DST keeps property-local 20:00");
// Even an elapsed occurrence cannot be advanced by a free session's refresh.
const elapsed=new Date(Date.now()-3600000).toISOString();
await upsertRecord(db,"ActivitySchedules",{scheduleId:"elapsed-a",hotelId:"hotel-a",activityId:"activity-a",venueId:"venue-a",createdByUserId:"owner",status:"active",scheduledStartAt:elapsed,recurrenceType:"daily",recurrenceInterval:1,durationSeconds:7200,autoOpenRequests:false});
const elapsedOriginal=await getRecord(db,"ActivitySchedules","elapsed-a");
assert.equal((await action("prepareSession","a",{sessionMode:"free"}))?.ok,true);
await processD1ActivitySchedules(db,"hotel-a");
await action("finishActivityV4");
await processD1ActivitySchedules(db,"hotel-a");
assert.deepEqual(await getRecord(db,"ActivitySchedules","elapsed-a"),elapsedOriginal);
const projected=await action("prepareSession","a",{sessionMode:"scheduled",scheduleId:"elapsed-a"});
assert.equal(projected?.ok,true);
const projectedOccurrence=(projected?.session as any).scheduleOccurrenceAt;
assert.ok(Date.parse(projectedOccurrence)>Date.now());
await action("finishActivityV4");
assert.equal((await getRecord(db,"ActivitySchedules","elapsed-a"))?.scheduledStartAt,nextScheduleOccurrence({...elapsedOriginal,scheduledStartAt:projectedOccurrence},"America/Santo_Domingo"));
// Existing automatic request opening now reserves one persistent session.
await action("scheduleActivity","c",{scheduledStartAt:new Date(Date.now()+30000).toISOString(),durationSeconds:7200,autoOpenRequests:true,requestOpeningLeadSeconds:60});
await processD1ActivitySchedules(db,"hotel-c");
const legacyOpened=await action("selectActivity","c");
assert.equal((legacyOpened?.session as any)?.mode,"scheduled");
const legacyRunId=(legacyOpened?.session as any).runId;
await processD1ActivitySchedules(db,"hotel-c");
assert.equal(((await action("selectActivity","c"))?.session as any)?.runId,legacyRunId);
console.log("PASS A/B/C/D/E/F/H/I/J: hotel/activity/venue isolation, free run, keep/clear consent, competing Host windows, idempotent automatic start, final persistence and no invented date.");
db.sqlite.close();
rmSync(testDirectory, {recursive:true,force:true});
