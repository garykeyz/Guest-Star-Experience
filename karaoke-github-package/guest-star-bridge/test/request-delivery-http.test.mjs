import assert from 'node:assert/strict';
import test from 'node:test';
import {createServer} from 'node:http';
import {WebSocketServer} from 'ws';
import {cp,mkdir,mkdtemp,readFile,writeFile,appendFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const soak=Number(process.env.GUEST_STAR_DELIVERY_SOAK_MS)||0;
// These are isolated HTTP/WS fixtures, not production or a substitute for D1 tests.
// Accelerate only the copied runtime's transport timers unless running a real-time soak.
test('persisted requests survive lost invalidations, silent sockets, command stalls, outages and restart', {timeout:soak+300000},async t=>{
 const root=await mkdtemp(join(tmpdir(),'gs-request-delivery-'));
 let child,output='',offline=false,dropPongs=false,holdCommands=false,delay=0,connections=0;
 const rows=[],latencies=[],sockets=new Set();let reads=0;
 const listen=s=>new Promise((r,j)=>{s.once('error',j);s.listen(0,'127.0.0.1',()=>r(s.address().port));});
 const state=()=>({ok:true,codeVersion:'4.6',bridgeFeatures:{versionedMetadata:true,playedCompareAndSet:true,administrativeReorder:true},
  user:{id:'fixture',role:'host'},hotel:{hotelId:'delivery-hotel'},venue:{venueId:'delivery-venue'},
  activity:{activityId:'delivery-activity',hotelId:'delivery-hotel',venueId:'delivery-venue',status:'in_progress'},
  state:{activityId:'delivery-activity',activityRunning:true,activityStartedAt:'2026-10-27T00:00:00Z',playbackMode:'bridge',accepting:true},requests:rows});
 const cloud=createServer(async(req,res)=>{
  try{
   const chunks=[];for await(const c of req)chunks.push(c);const b=JSON.parse(Buffer.concat(chunks).toString()||'{}');
   if(offline){res.writeHead(503);res.end('offline');return;}
   if(delay)await sleep(delay);
   let result={ok:true};
   if(b.action==='activityState'){reads++;result=state();}
   if(b.action==='me')result={ok:true,user:{id:'fixture',role:'host'},selection:{hotels:[state().hotel],venues:[state().venue],activities:[state().activity]}};
   if(b.action==='pollBridgeCommands'){if(holdCommands)return;result={ok:true,commands:[]};}
   if(b.action==='bridgeRequestUpdate')result={ok:true,request:rows.find(r=>r.id===b.id)};
   res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));
  }catch{res.destroy();}
 });
 const wss=new WebSocketServer({server:cloud});
 wss.on('connection',ws=>{connections++;sockets.add(ws);ws.on('close',()=>sockets.delete(ws));ws.on('message',raw=>{
  const b=JSON.parse(raw.toString());if(b.type==='auth')ws.send(JSON.stringify({type:'realtime.ready'}));
  if(b.type==='ping'&&!dropPongs)ws.send(JSON.stringify({type:'pong'}));
 });});
 const publish=type=>{for(const ws of sockets)if(ws.readyState===1)ws.send(JSON.stringify({type}));};
 const stop=async()=>{const stopping=child;if(stopping?.exitCode===null&&!stopping.signalCode){const done=once(stopping,'exit');stopping.kill('SIGTERM');const timer=setTimeout(()=>{if(stopping.exitCode===null&&!stopping.signalCode)stopping.kill('SIGKILL');},2000);try{await done;}finally{clearTimeout(timer);}}};
 t.after(async()=>{await stop();for(const ws of sockets)ws.terminate();await new Promise(r=>wss.close(r));cloud.closeAllConnections();await new Promise(r=>cloud.close(r));await rm(root,{recursive:true,force:true});});
 await Promise.all(['src','public'].map(d=>cp(new URL('../'+d,import.meta.url),join(root,d),{recursive:true})));
 for(const d of ['data','stem-engine','library'])await mkdir(join(root,d));
 await writeFile(join(root,'package.json'),'{"type":"module"}');await writeFile(join(root,'stem-engine/package.json'),'{}');
 if(!soak){const path=join(root,'src/server.mjs');let source=await readFile(path,'utf8');for(const [a,b]of [['60_000','600'],['45_000','450'],['20_000','200']])source=source.replaceAll(a,b);await writeFile(path,source);}
 const cloudPort=await listen(cloud),reserve=createServer(),port=await listen(reserve);await new Promise(r=>reserve.close(r));
 await writeFile(join(root,'data/config.json'),JSON.stringify({configVersion:15,bridgePort:port,authToken:'fixture-auth',deviceToken:'fixture-device',deviceId:'fixture-device-id',lastHotelId:'delivery-hotel',lastVenueId:'delivery-venue',lastActivityId:'delivery-activity',appsScriptUrl:`http://127.0.0.1:${cloudPort}/api/bridge`,virtualDJ:{host:'127.0.0.1',port:9,timeoutMs:100},autoQueueExact:false,scanIntervalSeconds:3600}));
 const get=()=>fetch(`http://127.0.0.1:${port}/api/state`).then(r=>r.json());
 async function until(fn,timeout=5000){const end=Date.now()+timeout;while(Date.now()<end){try{if(await fn())return;}catch(error){if(error.message!=='fetch failed')throw error;}if(child&&(child.exitCode!==null||child.signalCode))throw Error('Runtime exited: '+output.slice(-4000));await sleep(25);}const snapshot=await get();const diagnostic={sheet:snapshot.sheet,mode:snapshot.operatingMode,activity:snapshot.activity,localTail:snapshot.requests.slice(-5).map(r=>r.id),remoteTail:rows.slice(-5).map(r=>r.id),sockets:sockets.size,connections,reads,output:output.slice(-5000)};if(process.env.GUEST_STAR_DELIVERY_DIAGNOSTICS)await writeFile(process.env.GUEST_STAR_DELIVERY_DIAGNOSTICS,JSON.stringify(diagnostic,null,2));throw Error('Condition timed out: '+JSON.stringify(diagnostic));}
 const start=async()=>{child=spawn(process.execPath,[join(root,'src/server.mjs')],{cwd:root,stdio:['ignore','pipe','pipe']});child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);await until(async()=>{try{return (await get()).sheet?.delivery?.realtimeReady;}catch{return false;}});};
 async function accepted(id,notify=true){if(!rows.some(r=>r.id===id)){rows.push({id,singer:id,song:'Song '+id,artist:'Artist',status:'Pendiente',sourceType:'public_request',stateRevision:1,timestamp:new Date().toISOString()});await appendFile(join(root,'cloud-persisted.jsonl'),JSON.stringify(rows.at(-1))+'\n');}if(notify)publish('public.request.created');}
 async function received(id,timeout=soak?100000:5000){const at=performance.now();await until(async()=>(await get()).requests.some(r=>r.id===id),timeout);latencies.push(performance.now()-at);}
 await start();
 for(let i=1;i<=3;i++){await accepted('consecutive-'+i);await received('consecutive-'+i);}
 const before=reads;
 await accepted('lost-fourth',false);
 await received('lost-fourth',soak?100000:2500);
 assert.ok(reads>before,'a healthy-looking socket still needs durable reconciliation');
 t.diagnostic('lost fourth recovered');
 // More than 100 consecutive accepted requests; milestones 3/10/50/100/120.
 for(let i=4;i<=120;i++){await accepted('consecutive-'+i);await received('consecutive-'+i);}
 await Promise.all(Array.from({length:100},(_,i)=>accepted('concurrent-'+i)));
 await received('concurrent-99');await until(async()=>(await get()).requests.length===221);
 assert.equal(new Set((await get()).requests.map(r=>r.id)).size,221);
 await Promise.all(Array.from({length:10},()=>accepted('concurrent-0')));
 assert.equal(rows.length,221);
 holdCommands=true;publish('bridge.command.queued');await sleep(100);
 await accepted('while-command-stalled');await received('while-command-stalled',2000);holdCommands=false;
 dropPongs=true;const oldConnections=connections;
 await accepted('silent-socket',false);await received('silent-socket');
 await until(()=>connections>oldConnections,soak?100000:5000);dropPongs=false;
 offline=true;for(const ws of sockets)ws.close();await accepted('during-outage',false);await sleep(soak?1000:750);
 offline=false;delay=150;await received('during-outage',15000);delay=0;
 // Persisted terminal states must remain terminal across read/reconnect/restart.
 rows[0].status='Ya cantó';rows[0].stateRevision++;rows[1].status='Omitida';rows[1].stateRevision++;
 publish('request.changed');await until(async()=>(await get()).requests.find(r=>r.id===rows[0].id)?.outcome==='completed');
 await stop();await accepted('during-restart',false);await start();await received('during-restart');
 const restored=await get();assert.equal(restored.requests.find(r=>r.id===rows[0].id).outcome,'completed');assert.equal(restored.requests.find(r=>r.id===rows[1].id).outcome,'skipped');
 const soakAt=Date.now();let soakCount=0;
 while(Date.now()-soakAt<soak){await accepted('soak-'+soakCount,soakCount%3!==0);if(soakCount%3!==0)await received('soak-'+soakCount);soakCount++;await sleep(1000);}
 if(soakCount)await received('soak-'+(soakCount-1));
 const final=await get();assert.equal(final.requests.length,rows.length);assert.equal(new Set(final.requests.map(r=>r.id)).size,rows.length);
 assert.doesNotMatch(output,/ReferenceError|SyntaxError|UnhandledPromiseRejection/);
 latencies.sort((a,b)=>a-b);t.diagnostic(JSON.stringify({accepted:rows.length,received:final.requests.length,reads,connections,soakMs:Date.now()-soakAt,soakCount,p95Ms:latencies[Math.floor(latencies.length*.95)],maxMs:latencies.at(-1),acceleratedTimers:!soak}));
});
