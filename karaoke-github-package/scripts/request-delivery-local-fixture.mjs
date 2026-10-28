import assert from 'node:assert/strict';
import {mkdtemp,cp,mkdir,writeFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// Called only with an isolated Miniflare instance and its local test database.
export async function verifyLocalRequestDelivery({miniflare,db,packageRoot,context,sessionHash,request}) {
 const root=await mkdtemp(join(tmpdir(),'gs-worker-local-delivery-'));let child,output='';
 const {hotelId,venueId,activityId,cycleId,publicCode}=context;
 const token='local-delivery-auth-token',deviceToken='local-delivery-device-token',deviceId='local-delivery-device';
 const stamp=new Date().toISOString();
 async function record(table,id,value){await db.prepare('INSERT INTO guest_star_records (scope,table_name,record_id,data_json,created_at,updated_at) VALUES (?,?,?,?,?,?)').bind('master',table,id,JSON.stringify(value),stamp,stamp).run();}
 await record('Users','local-delivery-user',{userId:'local-delivery-user',role:'superhost',status:'active'});
 await record('Devices',deviceId,{deviceId,userId:'local-delivery-user',status:'active',deviceTokenHash:sessionHash(deviceToken),hotelId,venueId,activityId});
 await record('AuthSessions','local-delivery-session',{authSessionId:'local-delivery-session',userId:'local-delivery-user',deviceId,sessionTokenHash:sessionHash(token),expiresAt:new Date(Date.now()+3600000).toISOString(),lastUsedAt:stamp,revokedAt:''});
 const before=await db.prepare("SELECT request_id FROM guest_star_requests WHERE hotel_id=? AND activity_id=? AND cycle_id=? AND archived_at='' ").bind(hotelId,activityId,cycleId).all();
 const acceptedIds=new Set(before.results.map(row=>row.request_id));const latencies=[];
 try {
  await Promise.all(['src','public'].map(d=>cp(join(packageRoot,'guest-star-bridge',d),join(root,d),{recursive:true})));
  for(const d of ['data','stem-engine'])await mkdir(join(root,d));
  await writeFile(join(root,'package.json'),'{"type":"module"}');await writeFile(join(root,'stem-engine/package.json'),'{}');
  const reserve=createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
  const cloudBase=await miniflare.ready;
  await writeFile(join(root,'data/config.json'),JSON.stringify({configVersion:15,bridgePort:port,authToken:token,deviceToken,deviceId,lastHotelId:hotelId,lastVenueId:venueId,lastActivityId:activityId,appsScriptUrl:new URL('/api/bridge',cloudBase).href,virtualDJ:{host:'127.0.0.1',port:9,timeoutMs:100},autoQueueExact:false,scanIntervalSeconds:3600}));
  const get=()=>fetch(`http://127.0.0.1:${port}/api/state`).then(r=>r.json());
  async function until(fn,timeout=20000){const end=Date.now()+timeout;while(Date.now()<end){try{if(await fn())return;}catch(error){if(error.message!=='fetch failed')throw error;}if(child?.exitCode!==null)throw Error('Runtime exited '+output.slice(-1500));await sleep(25);}throw Error('Local delivery timeout: '+output.slice(-1500));}
  const start=async()=>{child=spawn(process.execPath,[join(root,'src/server.mjs')],{cwd:root,stdio:['ignore','pipe','pipe']});child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);await until(async()=>{const s=await get();return s.sheet?.delivery?.realtimeReady&&s.requests?.length===acceptedIds.size;});};
  const stop=async()=>{if(child?.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}};
  async function submit(index){const result=await request('/api/karaoke',{method:'POST',headers:{'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.10'},body:JSON.stringify({publicCode,guestDeviceId:`delivery-http-device-${index.toString().padStart(6,'0')}`,name:`Delivery Guest ${index}`,song:`Delivery Song ${index}`,artist:`Delivery Artist ${index}`,language:'Español',languageCode:'es'})});const body=await result.json();assert.equal(result.status,200);assert.equal(body.ok,true,JSON.stringify(body));acceptedIds.add(body.id);return body.id;}
  await start();
  for(let i=0;i<100;i++){const at=performance.now(),id=await submit(i);await until(async()=>(await get()).requests.some(r=>r.id===id));latencies.push(performance.now()-at);}
  await Promise.all(Array.from({length:50},(_,i)=>submit(100+i)));
  await until(async()=>(await get()).requests.length===acceptedIds.size);
  await stop();const duringRestart=await submit(150);await start();
  const final=await get();const localIds=new Set(final.requests.map(r=>r.id));
  assert.equal(localIds.size,acceptedIds.size);for(const id of acceptedIds)assert.ok(localIds.has(id));assert.ok(localIds.has(duringRestart));
  const persisted=await db.prepare("SELECT request_id FROM guest_star_requests WHERE hotel_id=? AND activity_id=? AND cycle_id=? AND archived_at='' ").bind(hotelId,activityId,cycleId).all();assert.equal(persisted.results.length,acceptedIds.size);
  latencies.sort((a,b)=>a-b);
  console.log('Actual Worker + D1 + authenticated WebSocket + local Host delivery passed',{persisted:acceptedIds.size,visible:localIds.size,sequential:100,concurrent:50,restart:1,sharedPublicIP:true,p95Ms:Number(latencies[Math.floor(latencies.length*.95)].toFixed(1)),maxMs:Number(latencies.at(-1).toFixed(1))});
  await stop();
 } finally {
  if(child?.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}
  await rm(root,{recursive:true,force:true});
 }
}
