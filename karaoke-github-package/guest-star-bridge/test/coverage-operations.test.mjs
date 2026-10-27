import test from 'node:test';
import assert from 'node:assert/strict';
import {buildActivitySummary,robustDuration} from '../src/activity-summary.mjs';
import {normalizeQueueState} from '../src/queue-state.mjs';
import {readVdjMeter,readVdjQueueSignature,completedPlayback} from '../src/virtualdj-operations.mjs';
const now=Date.parse('2026-10-05T20:00:00Z');
const activity={activityHours:2,activityStartedAt:'2026-10-05T19:00:00Z',activityRunning:true,transitionSeconds:0,accepting:true};
test('2-hour activity: 42 minutes future covers until 8:42, leaving 18 minutes',()=>{
 const s=buildActivitySummary(activity,[],now,[{durationSeconds:2520}]);
 assert.equal(s.elapsedSeconds,3600);assert.equal(s.clockRemainingSeconds,3600);assert.equal(s.futureContentSeconds,2520);assert.equal(s.uncoveredSeconds,1080);assert.equal(s.coveredUntil,'2026-10-05T20:42:00.000Z');assert.equal(s.coveragePercent,85);assert.equal(s.estimatedSongsNeeded,1);
});
test('pending/queued overlap, current progress, skipped and standby never inflate coverage',()=>{
 const req=[{id:'q',durationSeconds:240,queued:true,localAvailable:true},{id:'p',durationSeconds:240,localAvailable:true},{id:'s',durationSeconds:500,outcome:'skipped'},{id:'r',durationSeconds:800,localAvailable:true,standby:true}];
 const s=buildActivitySummary(activity,req,now,[{id:'q',durationSeconds:240}],{currentPlayback:{currentRequestId:'q',currentTimeSeconds:180}});
 assert.equal(s.queuedSeconds,60);assert.equal(s.pendingSeconds,240);assert.equal(s.futureContentSeconds,300);assert.equal(s.reserveCount,1);assert.equal(s.skippedCount,1);
});
test('unknown duration uses completed median before queue, robust against a long outlier',()=>{
 const r=[200,240,260,4000].map(durationSeconds=>({durationSeconds,outcome:'completed'}));r.push({id:'unknown',localAvailable:true});
 const s=buildActivitySummary(activity,r,now,[{id:'q',durationSeconds:500}]);assert.equal(s.estimateAverageSongSeconds,250);assert.equal(s.pendingSeconds,250);assert.equal(robustDuration([240,245,250,9999]),247.5);
});
test('coverage warning boundaries and host consent, never automatic closure',()=>{
 for(const [missing,alert] of [[1801,'normal'],[1800,'notice'],[900,'warning'],[300,'critical'],[0,'covered']]){
 const s=buildActivitySummary(activity,[],now,[{durationSeconds:3600-missing}]);assert.equal(s.coverageAlert,alert);assert.equal(s.suggestClose,missing===0);
 }assert.equal(activity.accepting,true);
});
test('free/finished/overrun clocks stay bounded; no false prompt after end',()=>{
 const free=buildActivitySummary({...activity,activityHours:0},[],now,[]);assert.equal(free.coverageAlert,'inactive');assert.equal(free.suggestClose,false);
 const done=buildActivitySummary(activity,[],now+7200e3,[{durationSeconds:300}]);assert.equal(done.clockRemainingSeconds,0);assert.equal(done.suggestClose,false);assert.equal(done.coveragePercent,100);
});
test('reserve promotion adds the next existing identity without increasing reserve beyond 3',()=>{
 const req=[{id:'r',durationSeconds:240,localAvailable:true,standby:true}];
 const before=buildActivitySummary(activity,req,now,[]);req[0].standby=false;
 const after=buildActivitySummary(activity,req,now,[{id:'r',durationSeconds:240}]);assert.equal(after.futureContentSeconds-before.futureContentSeconds,240);
 const disk=normalizeQueueState({operationsState:{reserveIds:['a','b','c','d'],externalHistory:[{virtualDJItemId:'x',outcome:'completed'}]}});assert.deepEqual(disk.operationsState.reserveIds,['a','b','c']);assert.equal(disk.operationsState.externalHistory.length,1);
});
test('meter reads genuinely independent L/R post-master values',async()=>{
 const result=await readVdjMeter({},async(_,script)=>{assert.match(script,/get_vu_meter_left/);assert.match(script,/get_vu_meter_right/);return '.1|.4|.2|.8';});assert.equal(result.rmsL,.1);assert.equal(result.rmsR,.4);assert.equal(result.peakR,.8);
});

test('short real clip tolerates a final sample at 97%, but a seek is never sufficient',()=>{
 const observation={sawAudible:true,playedSeconds:11,durationSeconds:12,lastPosition:.97};
 assert.equal(completedPlayback(observation),true);
 assert.equal(completedPlayback({...observation,playedSeconds:1}),false);
 assert.equal(completedPlayback({...observation,lastPosition:.4}),false);
});
test('light queue signature uses one query and caps large snapshots',async()=>{
 let calls=0;
 await readVdjQueueSignature({},10000,async(_,script)=>{calls++;assert.match(script,/file_count karaoke/);assert.match(script,/fullpath' 255/);assert.doesNotMatch(script,/fullpath' 256/);return 'signature';});assert.equal(calls,1);
});

test('disk retains the new external occurrence ID and excludes unusable identities',()=>{
 const state=normalizeQueueState({operationsState:{context:'activity:start',queueIdentities:[{index:3,virtualDJItemId:'vdj-new-occurrence',filePath:'/music/reference.wav',singer:''},{virtualDJItemId:'bad'}],externalHistory:[{virtualDJItemId:'vdj-old-occurrence',outcome:'completed'}]}});
 assert.equal(state.operationsState.queueIdentities.length,1);assert.equal(state.operationsState.queueIdentities[0].virtualDJItemId,'vdj-new-occurrence');assert.equal(state.operationsState.externalHistory[0].outcome,'completed');
});

test('external performance history is preserved beyond 500 rows',()=>{
 const history=Array.from({length:501},(_,i)=>({virtualDJItemId:`performance-${i}`,outcome:'completed'}));
 const state=normalizeQueueState({operationsState:{externalHistory:history}});
 assert.equal(state.operationsState.externalHistory.length,501);assert.equal(state.operationsState.externalHistory[0].virtualDJItemId,'performance-0');
});

test('unavailable physical row retains queue count without inflating useful future coverage',()=>{
 const summary=buildActivitySummary(activity,[],now,[{id:'valid',durationSeconds:240},{id:'missing',durationSeconds:3600,coverageEligible:false}]);
 assert.equal(summary.queueSongCount,2);assert.equal(summary.futureContentSeconds,240);assert.equal(summary.estimateAverageSongSeconds,240);
});
