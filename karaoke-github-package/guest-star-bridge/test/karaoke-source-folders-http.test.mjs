import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { cp, mkdir, mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
async function listen(server) { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return server.address().port; }
test('Protected karaoke folders: save, watch, link, remove and restart', { timeout: 60000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'guest-star-bridge-operations-'));
  await Promise.all([cp(new URL('../src', import.meta.url), join(root, 'src'), { recursive: true }),
    cp(new URL('../public', import.meta.url), join(root, 'public'), { recursive: true }),
    mkdir(join(root, 'data')), mkdir(join(root, 'stem-engine')), mkdir(join(root, 'library')), mkdir(join(root, 'background'))]);
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  await writeFile(join(root, 'stem-engine', 'package.json'), '{}');
  await writeFile(join(root,'background','Artist - Background.wav'),Buffer.alloc(44));
  const paths = [1,2,3,4,5,6,7].map(id => join(root, 'library', `Artist - ${['Moonlight','Sunshine','Rainbow','Thunder','Waterfall','Mountain','River'][id-1]}.wav`));
  for (const path of paths) await writeFile(path, Buffer.alloc(44));
  const rows = paths.slice(0,4).map((path, index) => ({ id: `request-${index + 1}`, singer: `Participant ${index + 1}`,
    song: ['Moonlight','Sunshine','Rainbow','Thunder'][index], artist: 'Artist', sourceType: 'public_request', status: 'Pendiente',
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
  await writeFile(join(root,'data','config.json'),JSON.stringify({ configVersion:15,bridgePort:port,authToken:'fixture-auth',deviceToken:'fixture-device',deviceId:'fixture-device-id',lastHotelId:'fixture-hotel',lastVenueId:'fixture-venue',lastActivityId:'fixture-activity',libraryFolders:[],backgroundMusicSources:[join(root,'background')],appsScriptUrl:`http://127.0.0.1:${cloudPort}/api/bridge`,virtualDJ:{host:'127.0.0.1',port:vdjPort,timeoutMs:200},autoQueueExact:false }));
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

  assert.equal((await get()).library.count,0);
  const waitCount=async count=>{let state;for(let n=0;n<100;n++){try{state=await get();if(state.library.count===count)return state;}catch{}await new Promise(r=>setTimeout(r,60));}assert.fail(JSON.stringify(state.library));};
  const preferences={audioFolders:[join(root,'library')],videoFolders:[],priority:'auto'};
  const saved=await post('/api/player/media-preferences',preferences);assert.equal(saved.status,200,JSON.stringify(saved));
  let state=await waitCount(7);assert.equal(state.library.realtime,true);assert.equal(state.requests[0].localAvailable,true);
  let persisted=JSON.parse(await readFile(join(root,'data/queue-state.json'),'utf8'));
  assert.equal(persisted.requestFileLinks.find(r=>r.id==='request-1').filePath,paths[0]);
  assert.equal(persisted.entries.length,0);
  const added=join(root,'library','Artist - Added.wav');await writeFile(added,Buffer.alloc(44));await waitCount(8);
  await rm(added);await waitCount(7);
  
  const originalConfig=JSON.parse(await readFile(join(root,'data/config.json'),'utf8'));
  assert.deepEqual(originalConfig.libraryFolders,[]);assert.deepEqual(originalConfig.backgroundMusicSources,[join(root,'background')]);
  await post('/api/player/media-preferences',{audioFolders:[],videoFolders:[],priority:'auto'});
  state=await waitCount(0);assert.equal(state.requests[0].localAvailable,false);
  // Dedicated video roots also feed request matching and automatic file links.
  const video=join(root,'video');await mkdir(video);const movie=join(video,'Artist - Moonlight.mp4');await writeFile(movie,Buffer.alloc(44));
  await post('/api/player/media-preferences',{audioFolders:[],videoFolders:[video],priority:'auto'});
  state=await waitCount(1);assert.equal(state.requests[0].localAvailable,true);
  persisted=JSON.parse(await readFile(join(root,'data/queue-state.json'),'utf8'));
  assert.equal(persisted.requestFileLinks.find(r=>r.id==='request-1').filePath,movie);
  const exited=once(child,'exit');child.kill('SIGTERM');await exited;
  child=spawn(process.execPath,[join(root,'src','server.mjs')],{cwd:root,stdio:['ignore','pipe','pipe']});child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  state=await waitCount(1);assert.equal(state.library.realtime,true);
  assert.deepEqual(JSON.parse(await readFile(join(root,'data/config.json'),'utf8')).libraryFolders,[]);
  assert.doesNotMatch(output,/ReferenceError|SyntaxError|TypeError/);
});
