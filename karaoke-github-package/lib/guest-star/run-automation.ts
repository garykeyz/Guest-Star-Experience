import {processD1ActivitySchedules,handleD1HostAction} from './d1-actions';
import {ensureD1Schema,type D1DatabaseLike,type JsonObject} from './d1-store';
import {activityRunEndAt} from './activity-run';
import {realtimeResponseHeaders} from './realtime-event';

export async function nextHotelAutomationWake(db:D1DatabaseLike,hotelId:string,now=Date.now()) {
 const [runs,schedules]=await Promise.all([
  db.prepare(`SELECT r.data_json,r.status FROM guest_star_activity_runs r JOIN guest_star_records a
    ON a.scope='master' AND a.table_name='Activities' AND a.record_id=r.activity_id
    AND json_extract(a.data_json,'$.hotelId')=r.hotel_id AND json_extract(a.data_json,'$.venueId')=r.venue_id
    AND json_extract(a.data_json,'$.currentCycleId')=r.run_id
    WHERE r.hotel_id=? AND r.status IN ('scheduled','in_progress')`).bind(hotelId).all<{data_json:string;status:string}>(),
  db.prepare(`SELECT data_json FROM guest_star_records WHERE scope='master' AND table_name='ActivitySchedules'
   AND json_extract(data_json,'$.hotelId')=? AND json_extract(data_json,'$.status')='active'`).bind(hotelId).all<{data_json:string}>()
 ]);
 const times:number[]=[],occupied=new Set<string>();
 for(const row of runs.results||[]){const run={...JSON.parse(row.data_json),status:row.status};occupied.add(run.activityId+':'+run.venueId);if(run.status==='scheduled'){if(run.autoOpenRequests&&!run.requestOpenedAt&&run.requestOpeningAt)times.push(Date.parse(run.requestOpeningAt));if(run.autoStart)times.push(Date.parse(run.startsAt));}if(run.status==='in_progress'&&run.autoFinish&&!run.autoFinishCancelledAt)times.push(run.endCountdown?Date.parse(run.endCountdown.deadlineAt):activityRunEndAt(run));}
 for(const row of schedules.results||[]){const schedule=JSON.parse(row.data_json);if(occupied.has(schedule.activityId+':'+schedule.venueId))continue;if(schedule.autoOpenRequests||schedule.autoStartActivity){const start=Date.parse(schedule.scheduledStartAt),opening=Date.parse(schedule.requestOpeningAt||schedule.scheduledStartAt);times.push(schedule.autoStartActivity ? (opening<=now ? (start>now?start:now+5000) : opening) : opening>now ? opening : start>now ? start : start+Number(schedule.durationSeconds||7200)*1000);}}
 const valid=times.filter(Number.isFinite);return valid.length?Math.max(now+250,Math.min(...valid)):null;
}
export async function processHotelAutomation(db:D1DatabaseLike,hotelId:string){await ensureD1Schema(db);const changes=await processD1ActivitySchedules(db,hotelId);return {changes,nextAt:await nextHotelAutomationWake(db,hotelId)};}
export {handleD1HostAction,realtimeResponseHeaders};
