import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {activityPersistenceFixture} from './helpers/activity-persistence-fixture.mjs';
import {clearConfirmedFutureQueue} from '../src/virtualdj-finish.mjs';
const confirm='CLEAR_SESSION_QUEUE_AND_HISTORY';
const empty=state=>{assert.deepEqual(state.requests,[]);assert.equal(state.virtualDJ.queueCount,0);assert.equal(state.operations.externalHistory.length,0);assert.equal(state.operations.reserveIds.length,0);assert.equal(state.activitySummary.completedCount,0);assert.equal(state.activitySummary.skippedCount,0);assert.deepEqual(state.playerRuntime.queueOrder,[]);};
test('Bridge clears pending/active/completed/skipped, VDJ waits and disk; playing deck remains untouched across sync and restart',{timeout:60000},async t=>{
 const f=await activityPersistenceFixture({playing:true});t.after(()=>f.close());
 f.rows.A.push({id:'a-skipped',singer:'Skipped A',song:'Skipped',status:'Saltado',stateRevision:1});
 assert.equal((await f.post('/api/activity/mode',{mode:'bridge'})).status,200);await f.post('/api/requests/sync');
 const before=await f.get(),original=JSON.stringify(before.tenant.activity),master=f.master(),playingPath=f.physical[0].filepath;
 const commandStart=f.commands.length;
 const refused=await f.post('/api/operations/clear',{confirm:'CLEAR_PENDING_AND_QUEUE',commandId:'obsolete-confirmation'});assert.equal(refused.data.ok,false);
 const cleared=await f.post('/api/operations/clear',{confirm,commandId:'complete-clear-command'});assert.equal(cleared.status,200,JSON.stringify(cleared));assert.equal(cleared.data.ok,true);empty(cleared.data.state);
 assert.ok(f.rows.A.every(row=>row.status==='Cancelada'));assert.equal(f.rows.B[0].status,'Pendiente');assert.equal(JSON.stringify(cleared.data.state.tenant.activity),original);assert.equal(f.master(),master);
 assert.equal(f.physical.length,1);assert.equal(f.physical[0].filepath,playingPath);assert.equal(cleared.data.state.virtualDJ.playback.decks[0].playing,true);
 const commandsAfterClear=f.commands.length;const repeated=await f.post('/api/operations/clear',{confirm,commandId:'complete-clear-command'});assert.equal(repeated.data.ok,true);assert.equal(f.commands.length,commandsAfterClear,'same command does not replay effects');
 await f.post('/api/requests/sync');empty(await f.get());
 const disk=JSON.parse(await readFile(join(f.root,'data/queue-state.json'),'utf8'));
 for(const field of ['entries','recoveries','playerRequests','playerOrder','playerStemJobs','requestFileLinks'])assert.equal(disk[field].length,0,field);
 assert.equal(disk.operationsState.pendingClearIds.length,0);assert.equal(disk.operationsState.externalHistory.length,0);assert.equal(disk.operationsState.clearedVdjEntries.length,1);
 await f.stop();await f.start();await f.post('/api/activity/mode',{mode:'bridge'});await f.post('/api/requests/sync');empty(await f.get());assert.equal(f.physical.length,1);
 for(const command of f.commands.slice(commandStart))assert.doesNotMatch(command,/\b(stop|pause|unload|seek|restart|load|play|volume|gain|reset|karaoke_add)\b/);
 const retired=f.physical.shift();await f.post('/api/requests/sync');assert.equal((await f.get()).operations.clearedVdjEntries.length,0);
 f.physical.push(retired);await f.post('/api/requests/sync');assert.equal((await f.get()).virtualDJ.queueCount,1,'a later physical request for the same song is not permanently hidden');
});
test('Player clears local/public rows and history without any VirtualDJ mutation',{timeout:60000},async t=>{
 const f=await activityPersistenceFixture();t.after(()=>f.close());await f.stop();
 const disk=JSON.parse(await readFile(join(f.root,'data/queue-state.json'),'utf8'));disk.playerRequests=[{id:'local-a',filePath:join(f.root,'library/A.wav'),singer:'Local',song:'Local A',outcome:'completed'},{id:'local-b',filePath:join(f.root,'library/B.wav'),singer:'Local',song:'Local B'}];disk.playerOrder=['local-a','local-b'];disk.playerQueueVisibility={'local-b':false};await writeFile(join(f.root,'data/queue-state.json'),JSON.stringify(disk));await f.start();await f.post('/api/activity/mode',{mode:'player'});
 const physical=JSON.stringify(f.physical);const before=await f.get();
 const result=await f.post('/api/operations/clear',{confirm,commandId:'player-complete-clear'});assert.equal(result.data.ok,true,JSON.stringify(result));empty(result.data.state);assert.deepEqual(result.data.state.tenant.activity,before.tenant.activity);assert.equal(JSON.stringify(f.physical),physical);assert.equal(f.commands.length,0);
 const stale=await f.post('/api/player/runtime',{queueOrder:['local-b'],queueVisibility:{'local-b':true},playback:{currentRequestId:'local-b',currentTimeSeconds:30,scene:'karaoke',wasPlaying:true}});
 assert.equal(stale.data.ok,true,JSON.stringify(stale));const guarded=await f.get();empty(guarded);assert.deepEqual(guarded.playerRuntime.queueVisibility,{});assert.equal(guarded.playerRuntime.playback.currentRequestId,'');assert.equal(guarded.playerRuntime.playback.wasPlaying,false);assert.equal(guarded.playerRuntime.playback.scene,'lobby');
 await f.stop();await f.start();await f.post('/api/activity/mode',{mode:'player'});await f.post('/api/requests/sync');empty(await f.get());
});
test('VDJ cleanup handles duplicate waiting copies and empty singers with guarded queue-only removals',async()=>{
 let rows=[{id:'a',filePath:'/a.wav',singer:'A'},{id:'b1',filePath:'/b.wav',singer:''},{id:'b2',filePath:'/b.wav',singer:''}],effects=[];
 const result=await clearConfirmedFutureQueue({config:{},entries:[...rows],allowDuplicateRows:true,readQueue:async()=>rows.map((r,index)=>({...r,index})),readPlayback:async()=>({connected:true,decks:[{loaded:true,playing:true,filePath:'/a.wav'}]}),execute:async(_,script)=>{effects.push(script);const index=(script.match(/browser_scroll \+1/g)||[]).length;rows.splice(index,1);}});
 assert.deepEqual(result.preserved,['a']);assert.deepEqual(result.removed,['b1','b2']);assert.deepEqual(result.uncertain,[]);assert.equal(rows.length,1);assert.equal(effects.length,2);effects.forEach(s=>assert.doesNotMatch(s,/\b(stop|play|load|pause|unload|volume|seek)\b/));
});
test('cloud rejection never reports clear success; retry confirms all records and persists empty state',{timeout:60000},async t=>{
 const f=await activityPersistenceFixture({playing:true});t.after(()=>f.close());await f.post('/api/activity/mode',{mode:'bridge'});f.setCloudFailure('a-finished');
 const failed=await f.post('/api/operations/clear',{confirm,commandId:'rejected-complete-clear'});assert.equal(failed.data.ok,false);assert.equal(f.physical.length,2,'unconfirmed cloud update cannot claim physical cleanup');
 const disk=JSON.parse(await readFile(join(f.root,'data/queue-state.json'),'utf8'));assert.ok(disk.operationsState.pendingClearIds.includes('a-finished'));
 f.setCloudFailure('');await f.post('/api/requests/sync');assert.ok(f.rows.A.every(row=>row.status==='Cancelada'));
 const retry=await f.post('/api/operations/clear',{confirm,commandId:'retry-complete-clear'});assert.equal(retry.data.ok,true,JSON.stringify(retry));empty(retry.data.state);assert.equal(f.physical.length,1);
});
test('disk does not truncate cleared IDs, including large histories; keeps an empty singer for preserved VDJ identity',async()=>{
 const {normalizeQueueState}=await import('../src/queue-state.mjs');const ids=Array.from({length:2100},(_,i)=>'removed-'+i);const state=normalizeQueueState({operationsState:{clearedIds:ids,pendingClearIds:['retry'],clearedVdjEntries:[{id:'loaded',filePath:'/a.wav',singer:''}]}});
 assert.deepEqual(state.operationsState.clearedIds,ids);assert.deepEqual(state.operationsState.pendingClearIds,['retry']);assert.equal(state.operationsState.clearedVdjEntries[0].singer,'');
});
