import test from 'node:test';
import assert from 'node:assert/strict';
import {rememberedActivity,entryContextId} from '../public/entry-flow.js';
import {activityPersistenceFixture} from './helpers/activity-persistence-fixture.mjs';
test('remembered entry requires current access and an eligible activity; free has its own context',()=>{
 const remembered={hotelId:'h',venueId:'v',activityId:'a'};
 const state={entryContext:{rememberedActivity:remembered},account:{current:remembered,selection:{hotels:[{hotelId:'h'}],venues:[{hotelId:'h',venueId:'v'}],activities:[{...remembered,name:'Future',status:'scheduled'}]}}};
 assert.equal(rememberedActivity(state).name,'Future');
 assert.equal(rememberedActivity({...state,entryContext:{rememberedActivity:null}}),null);
 state.tenant={activity:{activityId:'a',status:'finished'}};assert.equal(rememberedActivity(state),null);state.tenant=null;
 state.account.selection.hotels[0].status='inactive';assert.equal(rememberedActivity(state),null);state.account.selection.hotels[0].status='active';
 for(const status of ['finished','cancelled','unavailable','disabled','archived']){state.account.selection.activities[0].status=status;assert.equal(rememberedActivity(state),null);}
 state.account.selection.activities[0].status='scheduled';state.account.selection.hotels=[];assert.equal(rememberedActivity(state),null);
 state.entryContext={sessionType:'free',sessionId:'free:unique'};assert.equal(entryContextId(state),'free:unique');
});
test('A -> B -> free -> A isolates data and retains remembered future activity after restart',{timeout:60000},async t=>{
 const f=await activityPersistenceFixture();t.after(()=>f.close());
 const physical=JSON.stringify(f.physical),master=f.master();
 await f.post('/api/auth/selection',{...f.activities.B,rememberSelection:true});
 const remembered=(await f.get()).entryContext.rememberedActivity;
 for(let i=0;i<10;i++){
   const target=i%3===2?'free':i%3===0?'A':'B';
   const {status,data}=await f.post(target==='free'?'/api/entry/free':'/api/auth/selection',target==='free'?{}:{...f.activities[target],rememberSelection:false});
   assert.equal(status,200,JSON.stringify(data));assert.deepEqual(data.entryContext.rememberedActivity,remembered);
   if(target==='free'){
     assert.equal(data.entryContext.activeActivityId,null);assert.match(data.entryContext.sessionId,/^free:/);assert.equal(data.account.current.activityId,'');assert.equal(data.requests.length,0);assert.equal(data.tenant.kioskAccess,null);assert.equal(data.operations.externalHistory.length,0);assert.equal(data.operations.reserveIds.length,0);assert.equal(data.activity.activityStartedAt,'');
     assert.equal((await f.post('/api/activity/mode',{mode:'player'})).status,200);
     assert.equal((await f.post('/api/player/runtime',{queueOrder:[],playback:{scene:'idle'}})).status,200);
     assert.equal(data.tenant.permissions.canStartActivity,true);
     assert.equal((await f.post('/api/activity/start')).data.activity.activityRunning,true);
     assert.equal((await f.post('/api/activity/finish')).data.activity.activityRunning,false);
   }else{
     assert.ok(data.requests.every(r=>r.id.startsWith(target.toLowerCase()+'-')));assert.equal(data.operations.externalHistory.length,target==='A'?1:0);
     assert.equal((await f.post('/api/activity/mode',{mode:i%2?'player':'bridge'})).status,200);
   }
   await f.post('/api/entry/prepare');
 }
 assert.equal(JSON.stringify(f.physical),physical);assert.equal(f.master(),master);
 await f.stop();await f.start();const restarted=await f.get();assert.equal(restarted.account.current.activityId,'B');assert.deepEqual(restarted.entryContext.rememberedActivity,remembered);assert.equal(restarted.activity.activityRunning,false);
 assert.ok(!f.commands.some(c=>/browser_remove|karaoke_add|master_volume|deck 2/.test(c)),JSON.stringify(f.commands));
 assert.ok(!f.calls.some(c=>c.activityId?.startsWith('free:')),JSON.stringify(f.calls));
});
test('Superhost suspends a running free activity and resumes the same session after restart',{timeout:60000},async t=>{
 const f=await activityPersistenceFixture();t.after(()=>f.close());
 let result=await f.post('/api/entry/free');assert.equal(result.status,200);
 const sessionId=result.data.entryContext.sessionId;
 assert.match(sessionId,/^free:/);
 assert.equal((await f.post('/api/activity/mode',{mode:'player'})).status,200);
 assert.equal((await f.post('/api/activity/start')).data.activity.activityRunning,true);
 const track=await fetch(f.base+'/api/player/library?query=A').then(response=>response.json()).then(data=>data.tracks[0]);
 const created=await f.post('/api/player/local-requests',{trackId:track.id,singer:'Prueba'});
 assert.equal(created.status,200);
 const requestId=created.data.item.id;
 assert.equal((await f.post('/api/player/runtime',{queueOrder:[requestId],playback:{currentRequestId:requestId,currentTimeSeconds:42,scene:'karaoke',wasPlaying:false}})).status,200);
 result=await f.post('/api/auth/selection',f.activities.B);
 assert.equal(result.status,200,JSON.stringify(result.data));
 assert.equal(result.data.entryContext.resumableFreeSession.sessionId,sessionId);
 assert.equal(result.data.tenant.activity.activityId,'B');
 assert.equal((await f.post('/api/activity/mode',{mode:'player'})).status,200);
 const scheduled=await f.post('/api/player/local-requests',{trackId:track.id,singer:'Actividad programada'});
 assert.equal(scheduled.status,200);
 const scheduledRequestId=scheduled.data.item.id;
 result=await f.post('/api/entry/free/resume');
 assert.equal(result.status,200,JSON.stringify(result.data));
 await f.stop();await f.start();
 const restarted=await f.get();
 assert.equal(restarted.entryContext.resumableFreeSession.sessionId,sessionId);
 assert.equal(restarted.requests.some(item=>item.id===requestId),false,'una actividad programada no hereda la fila libre');
 assert.ok(restarted.requests.some(item=>item.id===scheduledRequestId),'la actividad programada recupera su propia fila');
 result=await f.post('/api/entry/free/resume');
 assert.equal(result.status,200,JSON.stringify(result.data));
 assert.equal(result.data.entryContext.sessionId,sessionId);
 assert.equal(result.data.activity.activityRunning,true);
 assert.equal(result.data.operatingMode.selected,'player');
 assert.equal(result.data.playerRuntime.playback.currentTimeSeconds,42);
 assert.deepEqual(result.data.playerRuntime.queueOrder,[requestId]);
 assert.ok(result.data.requests.some(item=>item.id===requestId));
});
test('Host cannot override a running free activity',{timeout:60000},async t=>{
 const f=await activityPersistenceFixture({role:'host'});t.after(()=>f.close());
 assert.equal((await f.post('/api/entry/free')).status,200);
 assert.equal((await f.post('/api/activity/mode',{mode:'player'})).status,200);
 assert.equal((await f.post('/api/activity/start')).status,200);
 assert.equal((await f.post('/api/auth/selection',f.activities.B)).status,400);
 assert.equal((await f.post('/api/activity/mode',{mode:'bridge'})).status,400);
 assert.equal((await f.post('/api/entry/free')).status,400);
 assert.equal((await f.post('/api/entry/free/resume')).status,400);
});
