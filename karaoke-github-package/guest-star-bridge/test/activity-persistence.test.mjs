import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {activityContextKey,createActivityContextStore} from '../src/activity-context.mjs';
import {activityPersistenceFixture} from './helpers/activity-persistence-fixture.mjs';
test('activity data archive isolates hotel, venue, activity and occurrence; survives a fresh store',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'gs-context-'));t.after(()=>rm(dir,{recursive:true,force:true}));
 const store=createActivityContextStore(dir),key=activityContextKey({hotelId:'H',venueId:'V',activityId:'A'},'start');
 await store.save(key,{activityId:'A',entries:[{id:'a',filePath:'/a',singer:'A'}],operationsState:{context:'A:start',reserveIds:['a'],externalHistory:[{song:'past',outcome:'completed'}]}});
 for(const selection of [{hotelId:'B',venueId:'V',activityId:'A'},{hotelId:'H',venueId:'B',activityId:'A'},{hotelId:'H',venueId:'V',activityId:'B'}])assert.equal((await store.load(activityContextKey(selection,'start'))).entries.length,0);
 assert.equal((await store.load(activityContextKey({hotelId:'H',venueId:'V',activityId:'A'},'new'))).operationsState.externalHistory.length,0);
 assert.deepEqual((await createActivityContextStore(dir).load(key)).operationsState.reserveIds,['a']);
});
test('A -> B -> A ten times, connected VDJ and restart preserve separate activity data without physical commands', {timeout:60000},async t=>{
 const f=await activityPersistenceFixture();t.after(()=>f.close());
 const a=await f.get();assert.equal(a.requests.length,3);assert.equal(a.operations.externalHistory.length,1);
 const original=JSON.stringify(f.physical),master=f.master();
 for(let i=0;i<10;i++){
  const target=i%2?'A':'B',res=await f.post('/api/auth/selection',f.activities[target]);assert.equal(res.status,200,JSON.stringify(res.data));const s=res.data;
  assert.equal(s.tenant.hotel.hotelId,'hotel-'+target);assert.equal(s.tenant.venue.venueId,'venue-'+target);assert.equal(s.tenant.kioskAccess.pin,target==='A'?'111111':'222222');
  assert.ok(s.requests.every(r=>r.id.startsWith(target.toLowerCase()+'-')));
  assert.equal(s.activity.activityHours,target==='A'?2:3);assert.equal(s.activity.activityStartedAt,target==='A'?'2026-10-05T18:00:00.000Z':'');
  assert.equal(s.operations.externalHistory.length,target==='A'?1:0);assert.deepEqual(s.operations.reserveIds,target==='A'?['a-pending']:[]);
  if(target==='B')assert.ok(s.requests.every(r=>r.phase==='PENDING'));
  assert.equal(s.operatingMode.selected,'');
  const mode=await f.post('/api/activity/mode',{mode:'bridge'});assert.equal(mode.status,200);
  await f.post('/api/requests/sync');assert.equal(JSON.stringify(f.physical),original);assert.equal(f.master(),master);
 }
 await f.stop();await f.start();const restored=await f.get();assert.equal(restored.tenant.activity.activityId,'A');assert.equal(restored.operations.externalHistory.length,1);
 assert.equal(JSON.stringify(f.physical),original);assert.equal(f.master(),master);
 assert.ok(!f.commands.some(c=>/browser_remove|karaoke_add|master_volume|deck 2/.test(c)),JSON.stringify(f.commands));
 assert.ok(!f.calls.some(c=>c.action==='bridgeRequestUpdate'&&c.id?.startsWith('a-')&&c.activityId==='B'));
});
