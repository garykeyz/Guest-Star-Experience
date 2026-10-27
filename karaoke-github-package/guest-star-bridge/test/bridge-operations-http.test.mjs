import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
async function listen(server) { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return server.address().port; }
test('Bridge HTTP: metadata CAS, offline admin, reorder, dedup, Skip/Next and VDJ Played events', { timeout: 60000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'guest-star-bridge-operations-'));
  await Promise.all([cp(new URL('../src', import.meta.url), join(root, 'src'), { recursive: true }),
    cp(new URL('../public', import.meta.url), join(root, 'public'), { recursive: true }),
    mkdir(join(root, 'data')), mkdir(join(root, 'stem-engine')), mkdir(join(root, 'library'))]);
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  await writeFile(join(root, 'stem-engine', 'package.json'), '{}');
  const paths = [1,2,3,4,5,6,7].map(id => join(root, 'library', `Artist - Title ${id}.wav`));
  for (const path of paths) await writeFile(path, Buffer.alloc(44));
  const rows = paths.slice(0,4).map((path, index) => ({ id: `request-${index + 1}`, singer: `Participant ${index + 1}`,
    song: `Title ${index + 1}`, artist: 'Artist', sourceType: 'public_request', status: 'Agregada a VirtualDJ',
    fileName: path, stateRevision: 1, queuePosition: index + 1, durationSeconds: 120, timestamp: `2026-09-18T01:0${index}:00Z` }));
  const remoteCalls = [];
  let accepting=true;
  const activityState=()=>({activityId:"fixture-activity",activityRunning:true,activityStartedAt:"2026-09-18T01:00:00Z",playbackMode:"bridge",lastSource:"bridge",accepting});
  const cloud = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); remoteCalls.push(body.action);
    let result = { ok: true, user: { role: 'superhost' } };
    if (body.action === 'activityState') result = { ok: true, codeVersion: '4.2.0',
      bridgeFeatures: { versionedMetadata: true, playedCompareAndSet: true, administrativeReorder: true },
      state:activityState(), requests:rows, hotel:{hotelId:"fixture-hotel"},venue:{venueId:"fixture-venue"},activity:{activityId:"fixture-activity",hotelId:"fixture-hotel",venueId:"fixture-venue",status:"in_progress"} };
    if(body.action==='toggleRequests'){accepting=body.open;result={ok:true,state:activityState(),requests:rows};}
    if (body.action === 'bridgeRequestUpdate') {
      const item = rows.find(value => value.id === body.id);
      if (!item) result = { ok: false, code: 'REQUEST_NOT_FOUND' };
      else if (body.expectedRevision !== undefined && body.expectedRevision !== item.stateRevision) result = { ok: false, code: 'REQUEST_REVISION_CONFLICT' };
      else {
        if (body.beforeRequestId !== undefined) {
          if (!rows.some(value => value.id === 'request-new')) rows.push({ ...rows[0], id: 'request-new', singer: 'New Participant', queuePosition: 4, fileName: '' });
          const order = rows.filter(value => value !== item).sort((a,b) => a.queuePosition - b.queuePosition);
          order.splice(body.beforeRequestId === null ? order.length : order.findIndex(value => value.id === body.beforeRequestId), 0, item);
          order.forEach((value, index) => { value.queuePosition = index + 1; value.stateRevision++; });
        } else {
          for (const field of ['singer','song','artist','status','durationSeconds']) if (body[field] !== undefined) item[field] = body[field];
          item.stateRevision++;
        }
        result = { ok: true, request: { ...item, name: item.singer } };
      }
    }
    response.setHeader('Content-Type','application/json'); response.end(JSON.stringify(result));
  });
  const cloudPort = await listen(cloud);
  let online = true, selection = 0, playing = false, played = false, master = .75, loadedPath = paths[0], position=0, realDuration=12;
  const physical = rows.map((item,index) => ({ filepath: paths[index], singer: item.singer, title: item.song, artist: item.artist, length: '2:00' }));
  physical.splice(1, 0, physical.pop()); // request-4 has a confirmed next row for the Skip/Next test.
  const scripts = [];
  const vdj = createServer(async (request,response) => {
    const chunks=[]; for await(const chunk of request) chunks.push(chunk); const script=Buffer.concat(chunks).toString();
    if (!online) { response.writeHead(503); response.end('offline'); return; }
    if (request.url === '/execute') {
      scripts.push(script);
      if (script.includes('browser_scroll "top"')) selection = 0;
      selection += (script.match(/browser_scroll \+1/g) || []).length;
      if (script.includes('browser_remove')) physical.splice(selection,1);
      const added=script.match(/karaoke_add "([^"]+)"/);if(added){const row=rows.find(r=>r.fileName===added[1]);physical.push({filepath:added[1],singer:row?.singer || 'Reserve',title:row?.song || 'Reserve',artist:'Artist',length:'2:00'});}
      const move = script.match(/browser_move ([+-]\d+)/);
      if (move) { const [row] = physical.splice(selection,1); selection += Number(move[1]); physical.splice(selection,0,row); }
      if (/deck 1 play$/.test(script)) playing = true;
      if (/deck 1 pause$/.test(script)) playing = false;
      const load = script.match(/deck 1 load "([^"]+)"/); if (load) loadedPath = load[1];
      const volume = script.match(/master_volume ([\d.]+)%/); if (volume) master = Number(volume[1])/100;
      response.end('true'); return;
    }
    if (script.includes('`get_decks`')) response.end(`1|1|${master}`);
    else if(script.includes('get_vu_meter_left'))response.end('.1|.4|.2|.8');
    else if (script.includes('get_songlength')) response.end(`${position}|${realDuration}|Real duration fixture|Artist|${loadedPath}`);
    else if (script.includes('get_text')) response.end(`${loadedPath}|on|${playing?'on':'off'}|${playing?'on':'off'}|0|${played?'yes':'no'}|${loadedPath}`);
    else if (script === 'file_count karaoke') response.end(String(physical.length));
    else if (script === 'get_clock') response.end('01:00');
    else if (script.includes('get_filepath')) response.end(loadedPath);
    else {
      const match = script.match(/^get_next_karaoke_song "([^"]+)"(?: (\d+))?$/);
      response.end(match ? physical[Number(match[2] || 0)]?.[match[1] === 'fullpath' ? 'filepath' : match[1]] || '' : 'off');
    }
  });
  const vdjPort = await listen(vdj); const reserve=createServer(); const port=await listen(reserve); await new Promise(resolve=>reserve.close(resolve));
  await writeFile(join(root,'data','config.json'),JSON.stringify({ configVersion:15,bridgePort:port,authToken:'fixture-auth',deviceToken:'fixture-device',deviceId:'fixture-device-id',lastHotelId:'fixture-hotel',lastVenueId:'fixture-venue',lastActivityId:'fixture-activity',libraryFolders:[join(root,'library')],appsScriptUrl:`http://127.0.0.1:${cloudPort}/api/bridge`,virtualDJ:{host:'127.0.0.1',port:vdjPort,timeoutMs:200},autoQueueExact:false }));
  let child=spawn(process.execPath,[join(root,'src','server.mjs')],{cwd:root,stdio:['ignore','pipe','pipe']}); let output='';
  child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  t.after(async()=>{if(child.exitCode===null){const exited=once(child,'exit');child.kill('SIGTERM');await exited;}for(const server of [cloud,vdj]){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await rm(root,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${port}`;
  const get=()=>fetch(base+'/api/state').then(response=>response.json());
  const post=async(path,body,extra={})=>{const response=await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...extra},body:JSON.stringify(body)});return{status:response.status,body:await response.json()};};
  let ready;
  for(let attempt=0;attempt<100;attempt++){try{ready=await get();if(ready.requests?.length===4&&ready.operatingMode.selected==='bridge')break;}catch{}if(child.exitCode!==null)throw Error(output);await new Promise(resolve=>setTimeout(resolve,50));}
  assert.equal(ready.requests.length,4,output);
  const selectedMode=await post("/api/activity/mode",{mode:"bridge"});
  assert.equal(selectedMode.status,200,JSON.stringify(selectedMode));
  await post("/api/requests/sync",{});
  const forbidden=await post('/api/virtualdj/control',{action:'volume',volume:.4,commandId:'forbidden-command'},{Origin:'https://unrelated.invalid'}); assert.equal(forbidden.status,403);
  const play={action:'play',deck:1,filePath:paths[0],commandId:'dedup-play-command'};
  const replies=await Promise.all([post('/api/virtualdj/control',play),post('/api/virtualdj/control',play)]);
  assert.ok(replies.every(value=>value.body.ok),JSON.stringify(replies));assert.equal(scripts.filter(value=>value==='deck 1 play').length,1);
  await new Promise(resolve=>setTimeout(resolve,350));
  loadedPath=paths[3]; playing=true;
  const skip={origin:'HOST_SKIP_VDJ_NEXT',userInitiated:true,action:'skip',deck:1,filePath:paths[3],commandId:'dedup-skip-command'};
  const skipReplies=await Promise.all([post('/api/virtualdj/control',skip),post('/api/virtualdj/control',skip)]);
  assert.ok(skipReplies.every(value=>value.body.ok),JSON.stringify(skipReplies));
  assert.equal(scripts.filter(value=>value==='deck 1 pause').length,1,'double Skip pauses exactly once');
  assert.equal(scripts.filter(value=>value.includes(`deck 1 load "${paths[1]}"`)).length,1,'Skip loads exactly the confirmed next row');
  assert.equal((await get()).requests.find(value=>value.id==='request-4').outcome,'skipped');
  const revision=(await get()).requests.find(value=>value.id==='request-1').stateRevision;
  const edit=await post('/api/requests/request-1/metadata',{singer:'Edited Singer',song:'Edited Title',artist:'Edited Artist',expectedRevision:revision});
  assert.equal(edit.body.ok,true,JSON.stringify(edit));assert.equal(rows[0].singer,'Edited Singer');assert.equal(physical[0].singer,'Participant 1','no physical rename/retag');
  const stale=await post('/api/requests/request-1/metadata',{singer:'Stale',expectedRevision:revision});assert.equal(stale.body.ok,false);
  online=false;
  const current=(await get()).requests.find(value=>value.id==='request-3');
  const reorder=await post('/api/requests/request-3/move',{beforeId:'request-1',expectedRevision:current.stateRevision,commandId:'offline-reorder-command'});
  assert.equal(reorder.body.ok,true,JSON.stringify(reorder));assert.equal(rows.length,5,'arrival survives reorder');assert.equal(rows.find(value=>value.id==='request-3').queuePosition,1);
  const manual=await post('/api/requests/request-1/outcome',{outcome:'completed',commandId:'manual-complete-command'});
  assert.equal(manual.body.ok,true,JSON.stringify(manual));assert.equal((await get()).requests.find(value=>value.id==='request-1').outcome,'completed');
  const removed=await post('/api/requests/request-2/outcome',{outcome:'removed',commandId:'manual-remove-command'});
  assert.equal(removed.body.ok,true);assert.equal((await get()).requests.find(value=>value.id==='request-2').outcome,'removed');
  const undo=await post('/api/requests/request-2/undo-outcome',{placement:'pending',commandId:'manual-return-command'});
  assert.equal(undo.body.ok,false,'offline return cannot leave the same song active and physically queued');
  assert.equal((await get()).requests.find(value=>value.id==='request-2').outcome,'removed');
  online=true;
  const verifiedReturn=await post('/api/requests/request-2/undo-outcome',{placement:'pending',commandId:'verified-return-command'});
  assert.equal(verifiedReturn.body.ok,true,JSON.stringify(verifiedReturn));assert.equal((await get()).requests.filter(value=>value.id==='request-2').length,1);
  const beforeReconnect=scripts.length;online=true;
  await post('/api/virtualdj/control',{action:'volume',volume:.4,commandId:'reconnect-volume-command'});
  assert.equal(scripts.length,beforeReconnect+1,'reconnect never replays offline move/remove commands');
  const eventController=new AbortController();
  const eventResponse=await fetch(base+'/api/events',{signal:eventController.signal});
  t.after(()=>eventController.abort()); assert.equal(eventResponse.status,200);
  loadedPath=paths[2]; played=false; playing=true;
  let externalState;
  for(let attempt=0;attempt<40;attempt++){
    externalState=await get();
    const deck=externalState.virtualDJ?.playback?.decks?.[0];
    if(deck?.playing===true&&deck.filePath===paths[2])break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  await new Promise(r=>setTimeout(r,1200));externalState=await get();
  assert.equal(externalState.requests.find(r=>r.id==='request-3').stateRevision,rows.find(r=>r.id==='request-3').stateRevision,'duration reconciliation retains its returned remote revision');
  assert.deepEqual({playing:externalState.virtualDJ.playback.decks[0].playing,filePath:externalState.virtualDJ.playback.decks[0].filePath},
    {playing:true,filePath:paths[2]},'VDJ-originated Play and song identity reach Bridge over local events');
  played=true;
  await new Promise(resolve=>setTimeout(resolve,1100));
  assert.notEqual((await get()).requests.find(i=>i.id==='request-3').outcome,'completed','an early Played flag never completes');
  for(let second=1;second<=12;second++){position=second/12;await new Promise(resolve=>setTimeout(resolve,1000));}
  playing=false;
  for(let attempt=0;attempt<40;attempt++){
    externalState=await get();
    if(externalState.requests.find(value=>value.id==='request-3')?.outcome==='completed')break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(externalState.virtualDJ.playback.decks[0].playing,false,'VDJ-originated end reaches Bridge');
  assert.equal(externalState.requests.find(value=>value.id==='request-3').outcome,'completed','observed playback to a natural end completes the linked request');
  const meterResponse=await fetch(base+'/api/virtualdj/meter').then(r=>r.json());assert.equal(meterResponse.rmsL,.1);assert.equal(meterResponse.rmsR,.4);
  for(let index=4;index<7;index++)rows.push({id:`request-${index+1}`,singer:`Participant ${index+1}`,song:`Title ${index+1}`,artist:'Artist',sourceType:'public_request',status:'Pendiente',fileName:paths[index],stateRevision:1,durationSeconds:120,timestamp:`2026-09-18T01:0${index}:00Z`});
  await post('/api/requests/sync',{});
  for(let attempt=0;attempt<50;attempt++){if((await get()).requests.some(i=>i.id==='request-7'))break;await new Promise(r=>setTimeout(r,100));}
  for(let index=4;index<7;index++){const linked=await post(`/api/requests/request-${index+1}/link`,{filePath:paths[index]});assert.equal(linked.body.ok,true,JSON.stringify(linked));}
  let beforeClose=await get();assert.equal(beforeClose.requests.filter(i=>!i.queued&&!i.outcome&&i.id.startsWith('request-')&&Number(i.id.slice(8))>=5).length,3);
  const closed=await post('/api/activity/close',{});assert.equal(closed.body.activity.accepting,false,JSON.stringify(closed));assert.deepEqual(closed.body.operations.reserveIds,['request-5','request-6','request-7']);
  assert.equal(closed.body.activitySummary.reserveCount,3);assert.equal(closed.body.activitySummary.pendingSeconds,beforeClose.activitySummary.pendingSeconds-450);
  const reserveSong=closed.body.requests.find(i=>i.id==='request-5');assert.equal(reserveSong.standby,true);assert.equal(reserveSong.queued,false);
  await new Promise(r=>setTimeout(r,600));
  const activeQueue=(await get()).virtualDJ.entries.find(e=>e.linkedRequestId==='request-2');
  if(activeQueue){const skip=await post('/api/virtualdj/queue/action',{sourceId:'request:request-2',action:'skipped',commandId:'reserve-skip-command'});assert.equal(skip.body.ok,true,JSON.stringify(skip));}
  else {const external=closed.body.virtualDJ.entries[0];assert.ok(external);const skip=await post('/api/virtualdj/queue/action',{sourceId:`vdj:${external.virtualDJItemId}`,action:'skipped',commandId:'reserve-skip-command'});assert.equal(skip.body.ok,true,JSON.stringify(skip));}
  let promoted=await get();assert.equal(promoted.operations.reserveIds.length,3,JSON.stringify(promoted.operations));assert.equal(promoted.requests.find(i=>i.id==='request-5').queued,false,'Skip cannot automatically enqueue a standby song');
  const refused=await post('/api/operations/clear',{commandId:'clear-unconfirmed'});assert.equal(refused.body.ok,false,'no accidental single-click clear');
  const historicalIds=promoted.requests.filter(i=>['completed','skipped'].includes(i.outcome)).map(i=>i.id);
  const cleared=await post('/api/operations/clear',{confirm:'CLEAR_SESSION_QUEUE_AND_HISTORY',commandId:'clear-confirmed-command'});assert.equal(cleared.body.ok,true,JSON.stringify(cleared));
  const final=await get();assert.equal(final.virtualDJ.entries.length,0);assert.equal(final.operations.reserveIds.length,0);assert.equal(final.requests.length,0,'clear removes all requests and history');assert.equal(final.activitySummary.completedCount,0);assert.equal(final.activitySummary.skippedCount,0);
  // Reinserting an external performance creates a new occurrence, while a
  // refresh/reorder of the same physical row retains its identity.
  const externalPath=join(root,'library','External reference.wav');await writeFile(externalPath,Buffer.alloc(44));
  const externalRow={filepath:externalPath,singer:'External performer',title:'External reference',artist:'Fixture',length:'2:00'};
  physical.push({...externalRow});await post('/api/requests/sync',{});
  let external=(await get()).virtualDJ.entries.find(entry=>entry.song===externalRow.title);assert.ok(external);const firstExternalId=external.virtualDJItemId;
  const retired=await post('/api/virtualdj/queue/action',{sourceId:`vdj:${firstExternalId}`,action:'skipped',commandId:'retire-external-first'});assert.equal(retired.body.ok,true,JSON.stringify(retired));
  await post('/api/requests/sync',{});physical.push({...externalRow});await post('/api/requests/sync',{});
  external=(await get()).virtualDJ.entries.find(entry=>entry.song===externalRow.title);assert.ok(external);assert.notEqual(external.virtualDJItemId,firstExternalId,'new performance must not inherit the retired outcome');
  const secondExternalId=external.virtualDJItemId;await post('/api/requests/sync',{});assert.equal((await get()).virtualDJ.entries.find(entry=>entry.song===externalRow.title).virtualDJItemId,secondExternalId,'same occurrence remains stable');
  eventController.abort();const firstExit=once(child,'exit');child.kill('SIGTERM');await firstExit;
  child=spawn(process.execPath,[join(root,'src','server.mjs')],{cwd:root,stdio:['ignore','pipe','pipe']});child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  for(let attempt=0;attempt<100;attempt++){try{const restored=await get();if(restored.requests?.length===rows.length&&restored.operatingMode.selected==='bridge')break;}catch{}await new Promise(r=>setTimeout(r,50));}
  await post('/api/requests/sync',{});const restored=await get();
  assert.equal(restored.virtualDJ.entries.find(entry=>entry.song===externalRow.title).virtualDJItemId,secondExternalId,'external identity survives a local server restart');
  assert.equal(restored.operations.externalHistory.filter(entry=>entry.song===externalRow.title).length,1,'history survives initial cloud synchronization');
  const secondRetired=await post('/api/virtualdj/queue/action',{sourceId:`vdj:${secondExternalId}`,action:'skipped',commandId:'retire-external-second'});assert.equal(secondRetired.body.ok,true,JSON.stringify(secondRetired));
  assert.equal((await get()).operations.externalHistory.filter(entry=>entry.song===externalRow.title).length,2);
  assert.ok(!remoteCalls.includes('playerRuntimeUpdate')); assert.doesNotMatch(output,/ReferenceError|SyntaxError|TypeError/);
});
