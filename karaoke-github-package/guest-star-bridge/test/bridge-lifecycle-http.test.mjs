import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
async function listen(server) { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return server.address().port; }
test('Bridge lifecycle: all thirteen regression scenarios with real HTTP, persistence and stale observations', { timeout: 60000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'guest-star-bridge-operations-'));
  await Promise.all([cp(new URL('../src', import.meta.url), join(root, 'src'), { recursive: true }),
    cp(new URL('../public', import.meta.url), join(root, 'public'), { recursive: true }),
    mkdir(join(root, 'data')), mkdir(join(root, 'stem-engine')), mkdir(join(root, 'library'))]);
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  await writeFile(join(root, 'stem-engine', 'package.json'), '{}');
  const paths = [1,2,3,4,5,6,7].map(id => join(root, 'library', `Artist - Title ${id}.wav`));
  for (const path of paths) await writeFile(path, Buffer.alloc(44));
  const rows = paths.slice(0,4).map((path, index) => ({ id: `request-${index + 1}`, singer: `Participant ${index + 1}`,
    song: `Title ${index + 1}`, artist: 'Artist', sourceType: 'public_request', status: 'Pendiente',
    fileName: path, stateRevision: 1, queuePosition: index + 1, durationSeconds: 120, timestamp: `2026-09-18T01:0${index}:00Z` }));
  const remoteCalls = [];
  let accepting=true, youtubeCalls=0;
  const activityState=()=>({activityId:"fixture-activity",activityRunning:true,activityStartedAt:"2026-09-18T01:00:00Z",playbackMode:"bridge",lastSource:"bridge",accepting});
  const cloud = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); remoteCalls.push(body.action);
    let result = { ok: true, user: { role: 'superhost' } };
    if (body.action === 'activityState') result = { ok: true, codeVersion: '4.2.0',
      bridgeFeatures: { versionedMetadata: true, playedCompareAndSet: true, administrativeReorder: true },
      state:activityState(), requests:rows, hotel:{hotelId:"fixture-hotel"},venue:{venueId:"fixture-venue"},activity:{activityId:"fixture-activity",hotelId:"fixture-hotel",venueId:"fixture-venue",status:"in_progress"} };
    if(body.action==='youtubeSearchV4'){if(body.song==='Title 3')youtubeCalls++;result={ok:true,items:Array.from({length:24},(_,index)=>({url:`https://www.youtube.com/watch?v=video${index}`,title:`Karaoke ${index}`,resultType:'karaoke',recommended:true,durationSeconds:120,qualityScore:100-index}))};}
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
  const physical = []; // request-4 has a confirmed next row for the Skip/Next test.
  const scripts = [];
  const vdj = createServer(async (request,response) => {
    const chunks=[]; for await(const chunk of request) chunks.push(chunk); const script=Buffer.concat(chunks).toString();
    if (!online) { response.writeHead(503); response.end('offline'); return; }
    if (request.url === '/execute') {
      scripts.push(script);
      if (script.includes('browser_scroll "top"')) selection = 0;
      selection += (script.match(/browser_scroll \+1/g) || []).length;
      if (script.includes('browser_remove')) physical.splice(selection,1);
      const added=script.match(/karaoke_add "([^"]+)"/);if(added){const row=rows.find(r=>added[1].endsWith(r.fileName.split('/').pop()));physical.push({filepath:added[1],singer:row?.singer || 'Reserve',title:row?.song || 'Reserve',artist:'Artist',length:'2:00'});}
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

  const view = async id => (await get()).requests.find(row => row.id === id);
  const sync = () => post('/api/requests/sync', {});
  // 1. ACTIVE -> WAITING, stable while physically queued, including reorder.
  assert.equal((await view('request-1')).sentToVirtualDJ, false);
  const sent = await post('/api/requests/request-1/queue', {filePath:paths[0],origin:'HOST_SEND_TO_VDJ',userInitiated:true,commandId:'manual-send-request-1'});
  assert.equal(sent.body.ok,true,JSON.stringify(sent));
  await sync();assert.equal((await view('request-1')).sentToVirtualDJ,true);
  assert.equal((await view('request-1')).queued,true);
  await post('/api/requests/request-2/queue',{filePath:paths[1],origin:'HOST_SEND_TO_VDJ',userInitiated:true,commandId:'manual-send-request-2'});physical.reverse();await sync();
  assert.equal((await view('request-1')).sentToVirtualDJ,true);
  // 2, 9, 11. Clearing VDJ never returns a sent request or infers an outcome.
  const firstPhysical={...physical.find(row=>row.filepath.endsWith('Title 1.wav'))};
  physical.length=0;
  for(let repeat=0;repeat<5;repeat++)await sync();
  for(const id of ['request-1','request-2']) {
    const row=await view(id);assert.equal(row.sentToVirtualDJ,true);assert.equal(row.pendingResolution,true);assert.equal(row.outcome,'');
  }
  // 3, 4, 12. Rapid duplicate decisions produce exactly one remote mutation.
  const before=remoteCalls.filter(action=>action==='bridgeRequestUpdate').length;
  const complete={outcome:'completed',commandId:'same-complete-command'};
  const duplicate=await Promise.all([post('/api/requests/request-1/outcome',complete),post('/api/requests/request-1/outcome',complete)]);
  assert.ok(duplicate.every(result=>result.body.ok));
  assert.equal(remoteCalls.filter(action=>action==='bridgeRequestUpdate').length,before+1);
  assert.equal((await view('request-1')).outcome,'completed');
  await post('/api/requests/request-2/outcome',{outcome:'skipped',commandId:'same-skipped-command'});
  assert.equal((await view('request-2')).outcome,'skipped');
  // 5, 6, 10. Old cloud/VDJ snapshots, reorder and reconnect cannot change terminals.
  rows[0].status='Agregada a VirtualDJ';rows[0].stateRevision=1;
  rows[1].status='Agregada a VirtualDJ';rows[1].stateRevision=1;
  physical.push(firstPhysical);
  await sync();online=false;await sync();online=true;await sync();
  assert.equal((await view('request-1')).outcome,'completed');assert.equal((await view('request-2')).outcome,'skipped');
  // Restart proves that recovery state and missing-send evidence survive reload.
  const exited=once(child,'exit');child.kill('SIGTERM');await exited;
  child=spawn(process.execPath,[join(root,'src','server.mjs')],{cwd:root,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  for(let attempt=0;attempt<100;attempt++){try{if((await get()).requests?.length===4)break;}catch{}await new Promise(resolve=>setTimeout(resolve,50));}
  await post('/api/activity/mode',{mode:'bridge'});await sync();
  assert.equal((await view('request-1')).outcome,'completed');assert.equal((await view('request-2')).outcome,'skipped');
  // 7, 8. Deliberate return clears terminal state exactly once.
  const savedRecovery=JSON.parse(await readFile(join(root,'data','queue-state.json'),'utf8')).recoveries;
  const returned=await post('/api/requests/request-1/undo-outcome',{placement:'pending',commandId:'same-return-command'});
  assert.equal(returned.body.ok,true,JSON.stringify(returned));
  assert.equal(physical.length,0,JSON.stringify({returned,physical,savedRecovery,scripts,state:(await get()).virtualDJ.entries}));
  await post('/api/requests/request-2/undo-outcome',{placement:'pending',commandId:'return-skipped-command'});
  await sync();
  for(const id of ['request-1','request-2']){const row=await view(id);assert.equal(row.outcome,'');assert.equal(row.sentToVirtualDJ,false);assert.equal((await get()).requests.filter(item=>item.id===id).length,1);}
  // A stale terminal response following manual return cannot re-complete it.
  rows[0].status='Ya cantó';rows[0].stateRevision=1;await sync();assert.equal((await view('request-1')).outcome,'');
  // 13. Repeating a query reuses 24 cached options; the UI renders pages of six.
  const searchesBefore=youtubeCalls;
  const videos=await post('/api/requests/request-3/youtube',{});
  assert.equal(videos.body.items.length,24);await post('/api/requests/request-3/youtube',{});
  assert.ok(youtubeCalls-searchesBefore<=1);
  const unclassified=await post('/api/requests/request-3/dismiss-requeue',{});assert.equal(unclassified.body.ok,false);
  assert.ok(!remoteCalls.includes('playerRuntimeUpdate'));assert.doesNotMatch(output,/ReferenceError|SyntaxError|TypeError/);
});
