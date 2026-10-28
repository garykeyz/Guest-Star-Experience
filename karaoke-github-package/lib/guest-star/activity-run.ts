import { type D1DatabaseLike, type JsonObject } from "./d1-store";

export const ACTIVITY_RUN_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS guest_star_activity_runs (
    run_id TEXT PRIMARY KEY, hotel_id TEXT NOT NULL, activity_id TEXT NOT NULL,
    venue_id TEXT NOT NULL, schedule_id TEXT, starts_at TEXT NOT NULL,
    status TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS guest_star_one_open_run
    ON guest_star_activity_runs(hotel_id, activity_id, venue_id)
    WHERE status IN ('scheduled', 'in_progress')`,
  `CREATE INDEX IF NOT EXISTS guest_star_due_runs
    ON guest_star_activity_runs(hotel_id, status, starts_at)`
];

const str = (value: unknown) => String(value || "");

export async function activityRun(db: D1DatabaseLike, activity: JsonObject) {
  const row = await db.prepare(`SELECT data_json, status FROM guest_star_activity_runs
    WHERE run_id = ? AND hotel_id = ? AND activity_id = ? AND venue_id = ?`)
    .bind(str(activity.currentCycleId), str(activity.hotelId), str(activity.activityId), str(activity.venueId))
    .first<{ data_json: string; status: string }>();
  return row ? { ...JSON.parse(row.data_json), status: row.status } as JsonObject : null;
}

// The reservation, current-cycle pointer, optional queue cleanup and request
// state commit together. A stale Host cannot create or clear a second run.
export async function reserveActivityRun(db: D1DatabaseLike, run: JsonObject, revision: number, clear: boolean) {
  const stamp = str(run.createdAt);
  const runId = str(run.runId);
  const hotelId = str(run.hotelId);
  const activityId = str(run.activityId);
  const venueId = str(run.venueId);
  const owns = `EXISTS (SELECT 1 FROM guest_star_activity_runs WHERE run_id = '${runId.replaceAll("'", "''")}')`;
  const cycle = { ...run, cycleId: runId, status: "scheduled", startedAt: "", finishedAt: "" };
  const results = await db.batch([
    db.prepare(`INSERT OR IGNORE INTO guest_star_activity_runs
      (run_id, hotel_id, activity_id, venue_id, schedule_id, starts_at, status, data_json, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?
      WHERE COALESCE((SELECT state_revision FROM guest_star_activity_runtime
        WHERE activity_id = ? AND hotel_id = ? AND venue_id = ?), 0) = ?`)
      .bind(runId, hotelId, activityId, venueId, run.scheduleId || null, run.startsAt,
        JSON.stringify(run), stamp, stamp, activityId, hotelId, venueId, revision),
    db.prepare(`UPDATE guest_star_records SET data_json = json_set(data_json,
      '$.currentCycleId', ?, '$.status', 'scheduled', '$.acceptEarlyRequests', json('true'),
      '$.updatedAt', ?), updated_at = ? WHERE scope = 'master' AND table_name = 'Activities'
      AND record_id = ? AND json_extract(data_json, '$.hotelId') = ?
      AND json_extract(data_json, '$.venueId') = ? AND ${owns}`)
      .bind(runId, stamp, stamp, activityId, hotelId, venueId),
    db.prepare(`INSERT INTO guest_star_records(scope, table_name, record_id, data_json, created_at, updated_at)
      SELECT ?, 'ActivityCycles', ?, ?, ?, ? WHERE ${owns}`)
      .bind(hotelId, runId, JSON.stringify(cycle), stamp, stamp),
    db.prepare(`INSERT INTO guest_star_activity_runtime
      (activity_id, hotel_id, venue_id, cycle_id, accepting, running, started_at, finished_at,
       state_revision, last_action, last_source, updated_at)
      SELECT ?, ?, ?, ?, ?, 0, '', '', ?, 'requests.open', ?, ? WHERE ${owns}
      ON CONFLICT(activity_id) DO UPDATE SET cycle_id = excluded.cycle_id,
      accepting = excluded.accepting, running = 0, started_at = '', finished_at = '',
      state_revision = excluded.state_revision, last_action = excluded.last_action,
      last_source = excluded.last_source, updated_at = excluded.updated_at
      WHERE guest_star_activity_runtime.hotel_id = excluded.hotel_id
      AND guest_star_activity_runtime.venue_id = excluded.venue_id`)
      .bind(activityId, hotelId, venueId, runId, run.openBeforeStart === false ? 0 : 1, revision + 1, run.playbackSource, stamp),
    db.prepare(`UPDATE guest_star_requests SET archived_at = ?, updated_at = ?
      WHERE hotel_id = ? AND activity_id = ? AND (venue_id = ? OR venue_id = '') AND archived_at = ''
      AND ? = 1 AND ${owns}`).bind(stamp, stamp, hotelId, activityId, venueId, clear ? 1 : 0),
    db.prepare(`UPDATE guest_star_requests SET cycle_id = ?
      WHERE hotel_id = ? AND activity_id = ? AND (venue_id = ? OR venue_id = '') AND archived_at = ''
      AND ? = 0 AND status NOT IN ('Ya cantó','Saltado','Retirada del Player','Fuera de VirtualDJ','Eliminada','Cancelada') AND ${owns}`).bind(runId, hotelId, activityId, venueId, clear ? 1 : 0)
  ]);
  return Number((results[0] as { meta?: { changes?: number } }).meta?.changes) === 1;
}

export async function startActivityRun(db: D1DatabaseLike, run: JsonObject, automatic = false, source = str(run.playbackSource)) {
  const stamp = automatic ? str(run.startsAt) : new Date().toISOString();
  const observedNow = new Date().toISOString();
  const runId = str(run.runId);
  const results = await db.batch([
    db.prepare(`UPDATE guest_star_activity_runs SET status = 'in_progress',
      data_json = json_set(data_json, '$.startedAt', ?), updated_at = ?
      WHERE run_id = ? AND hotel_id = ? AND activity_id = ? AND venue_id = ?
      AND status = 'scheduled' AND (? = 0 OR (starts_at <= ? AND json_extract(data_json, '$.autoStart') = 1))
      AND EXISTS (SELECT 1 FROM guest_star_records WHERE scope='master' AND table_name='Activities'
        AND record_id=guest_star_activity_runs.activity_id
        AND json_extract(data_json,'$.hotelId')=guest_star_activity_runs.hotel_id
        AND json_extract(data_json,'$.venueId')=guest_star_activity_runs.venue_id
        AND json_extract(data_json,'$.currentCycleId')=guest_star_activity_runs.run_id
        AND json_extract(data_json,'$.status') <> 'inactive')`)
      .bind(stamp, stamp, runId, run.hotelId, run.activityId, run.venueId, automatic ? 1 : 0, observedNow),
    db.prepare(`UPDATE guest_star_activity_runtime SET running = 1, accepting = CASE WHEN (SELECT json_extract(data_json, '$.autoOpenRequests') FROM guest_star_activity_runs WHERE run_id = ?) = 0 THEN accepting ELSE 1 END,
      started_at = (SELECT json_extract(data_json, '$.startedAt') FROM guest_star_activity_runs WHERE run_id = ?),
      finished_at = '', state_revision = state_revision + 1, last_action = 'activity.start', last_source = ?, updated_at = ?
      WHERE activity_id = ? AND hotel_id = ? AND venue_id = ? AND cycle_id = ? AND running = 0
      AND EXISTS (SELECT 1 FROM guest_star_activity_runs WHERE run_id = ? AND status = 'in_progress')`)
      .bind(runId, runId, source, observedNow, run.activityId, run.hotelId, run.venueId, runId, runId),
    db.prepare(`UPDATE guest_star_records SET data_json = json_set(data_json, '$.status', 'in_progress'), updated_at = ?
      WHERE table_name IN ('Activities', 'ActivityCycles') AND record_id IN (?, ?)
      AND json_extract(data_json, '$.hotelId') = ? AND json_extract(data_json, '$.activityId') = ?
      AND EXISTS (SELECT 1 FROM guest_star_activity_runs WHERE run_id = ? AND status = 'in_progress')`)
      .bind(stamp, run.activityId, runId, run.hotelId, run.activityId, runId)
  ]);
  return Number((results[0] as { meta?: { changes?: number } }).meta?.changes) === 1;
}

// The opening deadline and successful occurrence marker are persistent.
export async function processRunOpenings(db:D1DatabaseLike,hotelId:string,now=Date.now()) {
  const stamp=new Date(now).toISOString();
  const rows=await db.prepare(`SELECT r.data_json FROM guest_star_activity_runs r JOIN guest_star_records a
    ON a.scope='master' AND a.table_name='Activities' AND a.record_id=r.activity_id
    AND json_extract(a.data_json,'$.currentCycleId')=r.run_id
    AND json_extract(a.data_json,'$.hotelId')=r.hotel_id AND json_extract(a.data_json,'$.venueId')=r.venue_id
    AND json_extract(a.data_json,'$.status')<>'inactive'
    WHERE r.hotel_id=? AND r.status='scheduled' AND json_extract(r.data_json,'$.autoOpenRequests')=1
    AND julianday(json_extract(r.data_json,'$.requestOpeningAt'))<=julianday(?) AND json_extract(r.data_json,'$.requestOpenedAt') IS NULL`).bind(hotelId,stamp).all<{data_json:string}>();
  const changes:JsonObject[]=[];
  for(const row of rows.results||[]){const run=JSON.parse(row.data_json);const end=Date.parse(run.startsAt)+Number(run.durationSeconds)*1000;if(!Number.isFinite(end)||now>end)continue;
    const result=await db.batch([
      db.prepare(`UPDATE guest_star_activity_runs SET data_json=json_set(data_json,'$.requestOpenedAt',?),updated_at=? WHERE run_id=? AND hotel_id=? AND activity_id=? AND venue_id=? AND status='scheduled' AND json_extract(data_json,'$.requestOpenedAt') IS NULL`).bind(stamp,stamp,run.runId,run.hotelId,run.activityId,run.venueId),
      db.prepare(`UPDATE guest_star_activity_runtime SET accepting=1,state_revision=state_revision+1,last_action='schedule.open',updated_at=? WHERE activity_id=? AND hotel_id=? AND venue_id=? AND cycle_id=? AND accepting=0 AND EXISTS(SELECT 1 FROM guest_star_activity_runs WHERE run_id=? AND status='scheduled' AND json_extract(data_json,'$.requestOpenedAt')=?)`).bind(stamp,run.activityId,run.hotelId,run.venueId,run.runId,run.runId,stamp)
    ]);
    if(Number((result[0] as {meta?:{changes?:number}}).meta?.changes)===1)changes.push({hotelId,activityId:run.activityId,action:'opened'});
  }
  return changes;
}

export async function processDueActivityRuns(db: D1DatabaseLike, hotelId: string) {
  const due = await db.prepare(`SELECT data_json FROM guest_star_activity_runs
    WHERE hotel_id = ? AND status = 'scheduled' AND starts_at <= ?
    AND json_extract(data_json, '$.autoStart') = 1`)
    .bind(hotelId, new Date().toISOString()).all<{ data_json: string }>();
  let changed = false;
  for (const row of due.results || []) changed = await startActivityRun(db, JSON.parse(row.data_json), true) || changed;
  return changed;
}

export async function finishActivityRun(db: D1DatabaseLike, run: JsonObject, nextOccurrence: string | null, automatic = false) {
  nextOccurrence=nextOccurrence||null;
  const stamp = new Date().toISOString();
  const results = await db.batch([
    db.prepare(`UPDATE guest_star_activity_runs SET status = 'finished', updated_at = ?
      WHERE run_id = ? AND hotel_id = ? AND activity_id = ? AND venue_id = ?
      AND status IN ('scheduled','in_progress')
      AND (?=0 OR (status='in_progress' AND json_extract(data_json,'$.autoFinishCancelledAt') IS NULL AND json_extract(data_json,'$.endCountdown.deadlineAt') <= ?))`)
      .bind(stamp, run.runId, run.hotelId, run.activityId, run.venueId,automatic?1:0,stamp),
    db.prepare(`UPDATE guest_star_activity_runtime SET accepting = 0, running = 0, finished_at = ?,
      state_revision = state_revision + 1, last_action = 'activity.finish', updated_at = ?
      WHERE activity_id = ? AND hotel_id = ? AND venue_id = ? AND cycle_id = ? AND finished_at = '' AND EXISTS (SELECT 1 FROM guest_star_activity_runs WHERE run_id=? AND status='finished')`)
      .bind(stamp, stamp, run.activityId, run.hotelId, run.venueId, run.runId,run.runId),
    db.prepare(`UPDATE guest_star_records SET data_json = json_set(data_json, '$.status', 'finished',
      '$.lastCompletedScheduleId', ?, '$.lastCompletedScheduleOccurrenceAt', ?, '$.updatedAt', ?), updated_at = ?
      WHERE scope = 'master' AND table_name = 'Activities' AND record_id = ?
      AND json_extract(data_json, '$.hotelId') = ? AND json_extract(data_json, '$.venueId') = ?
      AND json_extract(data_json, '$.currentCycleId') = ? AND EXISTS(SELECT 1 FROM guest_star_activity_runs WHERE run_id=? AND status='finished')`)
      .bind(run.scheduleId || '', run.scheduleOccurrenceAt || '', stamp, stamp, run.activityId, run.hotelId, run.venueId, run.runId,run.runId),
    db.prepare(`UPDATE guest_star_records SET data_json = json_set(data_json, '$.status', 'finished', '$.finishedAt', ?), updated_at = ?
      WHERE scope = ? AND table_name = 'ActivityCycles' AND record_id = ?
      AND json_extract(data_json, '$.activityId') = ? AND json_extract(data_json, '$.venueId') = ? AND EXISTS(SELECT 1 FROM guest_star_activity_runs WHERE run_id=? AND status='finished')`)
      .bind(stamp, stamp, run.hotelId, run.runId, run.activityId, run.venueId,run.runId),
    db.prepare(`UPDATE guest_star_records SET data_json = json_set(data_json, '$.scheduledStartAt',
      CASE WHEN ? IS NULL THEN json_extract(data_json, '$.scheduledStartAt') ELSE ? END,
      '$.status', CASE WHEN ? IS NULL THEN 'completed' ELSE 'active' END,
      '$.lastOccurrenceAt', ?, '$.updatedAt', ?), updated_at = ?
      WHERE scope = 'master' AND table_name = 'ActivitySchedules' AND record_id = ?
      AND json_extract(data_json, '$.hotelId') = ? AND json_extract(data_json, '$.activityId') = ?
      AND json_extract(data_json, '$.venueId') = ? AND julianday(json_extract(data_json, '$.scheduledStartAt')) <= julianday(?)
      AND json_extract(data_json, '$.status') = 'active' AND ? = 'scheduled' AND EXISTS(SELECT 1 FROM guest_star_activity_runs WHERE run_id=? AND status='finished')`)
      .bind(nextOccurrence, nextOccurrence, nextOccurrence, run.scheduleOccurrenceAt || '', stamp, stamp,
        run.scheduleId || '', run.hotelId, run.activityId, run.venueId, run.scheduleOccurrenceAt || '', run.mode,run.runId)
  ]);
  return Number((results[0] as { meta?: { changes?: number } }).meta?.changes) === 1;
}


// The deadline and cancellation live in D1, never only in a browser timer.
export function activityRunEndAt(run: JsonObject) {
  const start = Date.parse(str(run.startedAt || run.startsAt));
  return Number.isFinite(start) ? start + Math.max(0, Number(run.durationSeconds) || 0) * 1000 : NaN;
}

export async function beginRunEndCountdown(db: D1DatabaseLike, run: JsonObject, now = Date.now()) {
  const end = activityRunEndAt(run);
  if (run.autoFinish !== true || run.autoFinishCancelledAt || !Number.isFinite(end) || end > now) return false;
  const countdown = { startedAt: new Date(end).toISOString(), deadlineAt: new Date(end + 60000).toISOString() };
  const stamp = new Date(now).toISOString();
  const result = await db.batch([
    db.prepare(`UPDATE guest_star_activity_runs SET data_json=json_set(data_json,
      '$.endCountdown',json(?), '$.acceptingBeforeCountdown',
      COALESCE((SELECT accepting FROM guest_star_activity_runtime WHERE activity_id=? AND hotel_id=? AND venue_id=? AND cycle_id=?),0)), updated_at=?
      WHERE run_id=? AND hotel_id=? AND activity_id=? AND venue_id=? AND status='in_progress'
      AND json_extract(data_json,'$.autoFinish')=1 AND json_extract(data_json,'$.endCountdown') IS NULL
      AND json_extract(data_json,'$.autoFinishCancelledAt') IS NULL`)
      .bind(JSON.stringify(countdown),run.activityId,run.hotelId,run.venueId,run.runId,stamp,run.runId,run.hotelId,run.activityId,run.venueId),
    db.prepare(`UPDATE guest_star_activity_runtime SET accepting=0,state_revision=state_revision+1,
      last_action='activity.endCountdown',last_source='schedule',updated_at=?
      WHERE activity_id=? AND hotel_id=? AND venue_id=? AND cycle_id=? AND running=1
      AND last_action<>'activity.endCountdown' AND EXISTS(SELECT 1 FROM guest_star_activity_runs
        WHERE run_id=? AND status='in_progress' AND json_extract(data_json,'$.endCountdown') IS NOT NULL
        AND json_extract(data_json,'$.autoFinishCancelledAt') IS NULL)`)
      .bind(stamp,run.activityId,run.hotelId,run.venueId,run.runId,run.runId)
  ]);
  return Number((result[0] as {meta?:{changes?:number}}).meta?.changes) === 1;
}

export async function cancelRunEndCountdown(db: D1DatabaseLike, run: JsonObject, now = Date.now()) {
  const stamp = new Date(now).toISOString();
  const result=await db.batch([
    db.prepare(`UPDATE guest_star_activity_runs SET data_json=json_set(data_json,'$.autoFinishCancelledAt',?),updated_at=?
      WHERE run_id=? AND hotel_id=? AND activity_id=? AND venue_id=? AND status='in_progress'
      AND json_extract(data_json,'$.endCountdown') IS NOT NULL
      AND json_extract(data_json,'$.autoFinishCancelledAt') IS NULL
      AND json_extract(data_json,'$.endCountdown.deadlineAt') > ?`)
      .bind(stamp,stamp,run.runId,run.hotelId,run.activityId,run.venueId,stamp),
    db.prepare(`UPDATE guest_star_activity_runtime SET accepting=COALESCE((SELECT json_extract(data_json,'$.acceptingBeforeCountdown') FROM guest_star_activity_runs WHERE run_id=?),1),
      state_revision=state_revision+1,last_action='activity.endCancelled',last_source='host',updated_at=?
      WHERE activity_id=? AND hotel_id=? AND venue_id=? AND cycle_id=? AND running=1
      AND last_action<>'activity.endCancelled' AND EXISTS(SELECT 1 FROM guest_star_activity_runs
        WHERE run_id=? AND status='in_progress' AND json_extract(data_json,'$.autoFinishCancelledAt')=?)`)
      .bind(run.runId,stamp,run.activityId,run.hotelId,run.venueId,run.runId,run.runId,stamp)
  ]);
  return Number((result[0] as {meta?:{changes?:number}}).meta?.changes) === 1;
}

export async function processRunEndings(db: D1DatabaseLike, hotelId: string, finish: (run:JsonObject)=>Promise<boolean>, now=Date.now()) {
  const rows=await db.prepare(`SELECT data_json,status FROM guest_star_activity_runs WHERE hotel_id=? AND status='in_progress'
    AND json_extract(data_json,'$.autoFinish')=1 AND json_extract(data_json,'$.autoFinishCancelledAt') IS NULL`)
    .bind(hotelId).all<{data_json:string;status:string}>();
  const changes:JsonObject[]=[];
  for(const row of rows.results||[]) {
    let run={...JSON.parse(row.data_json),status:row.status} as JsonObject;
    if(activityRunEndAt(run)>now)continue;
    if(await beginRunEndCountdown(db,run,now))changes.push({hotelId,activityId:run.activityId,venueId:run.venueId,runId:run.runId,action:'countdown'});
    const current=await db.prepare('SELECT data_json,status FROM guest_star_activity_runs WHERE run_id=? AND hotel_id=?').bind(run.runId,hotelId).first<{data_json:string;status:string}>();
    if(!current)continue;
    run={...JSON.parse(current.data_json),status:current.status};
    const countdown=run.endCountdown as JsonObject|undefined;
    if(run.status==='in_progress' && !run.autoFinishCancelledAt && countdown && Date.parse(str(countdown.deadlineAt))<=now && await finish(run))
      changes.push({hotelId,activityId:run.activityId,venueId:run.venueId,runId:run.runId,action:'finished'});
  }
  return changes;
}
