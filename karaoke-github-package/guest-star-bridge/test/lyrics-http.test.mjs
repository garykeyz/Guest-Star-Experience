import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn} from 'node:child_process';
import {cp,mkdir,mkdtemp,writeFile,readFile,chmod,symlink,rm,readdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const token=file=>Buffer.from(file).toString('base64url');
async function listen(server){await new Promise(r=>server.listen(0,'127.0.0.1',r));return server.address().port;}
async function freePort(){const s=createServer();const port=await listen(s);await new Promise(r=>s.close(r));return port;}
async function until(fn,predicate,ms=10000){const end=Date.now()+ms;let last;while(Date.now()<end){try{last=await fn();if(predicate(last))return last;}catch{}await pause(30);}throw new Error('Timeout: '+JSON.stringify(last));}

async function fixture(t,{signedIn=true}={}){
  const temp=await mkdtemp(join(tmpdir(),'guest-star-lyrics-http-'));
  const bridge=join(temp,'bridge'),library=join(temp,'library'),outside=join(temp,'outside');
  await mkdir(bridge);await cp(join(ROOT,'src'),join(bridge,'src'),{recursive:true});
  await cp(join(ROOT,'package.json'),join(bridge,'package.json'));await mkdir(join(bridge,'public'));await cp(join(ROOT,'public','shared'),join(bridge,'public','shared'),{recursive:true});
  // No production data, dependencies, model, native binary or secrets copied.
  for(const dir of ['data','stem-engine','lyrics-engine','test-fixtures'])await mkdir(join(bridge,dir));
  await mkdir(library);await mkdir(outside);await mkdir(library+'-other');await writeFile(join(library+'-other','Sibling.mp3'),Buffer.alloc(128,9));
  const song=join(library,'Fixture - Plain.mp3'),lrcSong=join(library,'Fixture - Timed.mp3'),escape=join(outside,'Forbidden.mp3');
  for(const [index,file] of [song,lrcSong,escape].entries())await writeFile(file,Buffer.alloc(128,index+3));
  await writeFile(join(library,'Fixture - Timed.lrc'),'[00:01.25]First fixture line\n[00:03.00]Second fixture line\n');
  const escapeLink=join(library,'Escape.mp3');await symlink(escape,escapeLink);
  await writeFile(join(outside,'Forbidden.lrc'),'[00:00.00]OUTSIDE SECRET\n');
  const sidecarSong=join(library,'Fixture - Sidecar escape.mp3');await writeFile(sidecarSong,Buffer.alloc(128,8));
  await symlink(join(outside,'Forbidden.lrc'),join(library,'Fixture - Sidecar escape.lrc'));
  await writeFile(join(bridge,'stem-engine','package.json'),'{}');
  // Explicit protocol fixtures, not an ASR quality test: only isolated paths.
  const ffmpeg=join(bridge,'test-fixtures','ffmpeg');
  await writeFile(ffmpeg,'#!/usr/bin/env node\nimport fs from "node:fs";const file=process.argv[process.argv.indexOf("-i")+1];const b=fs.readFileSync(file);process.stdout.write(Buffer.alloc(32000*12,b[0]));\n');await chmod(ffmpeg,0o755);
  const runner=join(bridge,'lyrics-engine','gs-lyrics');
  await writeFile(runner,'#!/usr/bin/env node\nprocess.stdin.resume();process.stdin.on("end",()=>setTimeout(()=>{console.log(JSON.stringify({type:"segment",start:1.5,end:3,text:"Protocol fixture cue",language:"en"}));},500));\n');await chmod(runner,0o755);
  await writeFile(join(bridge,'lyrics-engine','gs-lyrics-align'),'#!/usr/bin/env node\nprocess.stdin.resume();process.stdin.on("end",()=>console.log(JSON.stringify({words:[{start:0,end:1.5,text:"Protocol fixture cue"}]})));\n');await chmod(join(bridge,'lyrics-engine','gs-lyrics-align'),0o755);
  await writeFile(join(bridge,'lyrics-engine','ggml-tiny.bin'),'test-fixture-not-a-model');
  // homedir import is redirected only in this child; no HOME override or real Support writes.
  const preload=join(bridge,'test-fixtures','isolate-home.mjs');
  await writeFile(preload,"import os from 'node:os';import {syncBuiltinESMExports} from 'node:module';os.homedir=()=>process.env.GUEST_STAR_TEST_HOME;syncBuiltinESMExports();\n");
  const actions=[];const sheet=createServer(async(req,res)=>{const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks).toString()||'{}');actions.push(body.action);
    let payload={ok:true};if(body.action==='me')payload={ok:true,user:{id:'fixture-user'},selection:{hotels:[],venues:[],activities:[]}};
    else if(body.action==='activityState')payload={ok:true,state:{activityId:'',activityRunning:false},requests:[]};
    res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(payload));});
  const sheetPort=await listen(sheet),port=await freePort(),url=`http://127.0.0.1:${port}`;
  const configPath=join(bridge,'data','config.json'),queuePath=join(bridge,'data','queue-state.json');
  const config={configVersion:15,bridgePort:port,authToken:signedIn?'fixture-auth':'',deviceToken:signedIn?'fixture-device':'',deviceId:signedIn?'fixture-only-device':'',secretsInKeychain:false,libraryFolders:[library],appsScriptUrl:`http://127.0.0.1:${sheetPort}/exec`,autoQueueExact:false,scanIntervalSeconds:3600,rememberLibraryFolders:true,diagnostics:{autoSendTechnicalErrors:false,testerMode:false},virtualDJ:{host:'127.0.0.1',port:sheetPort,password:'',timeoutMs:100}};
  await writeFile(configPath,JSON.stringify(config));
  await writeFile(queuePath,JSON.stringify({playerRequests:[{id:'fixture-request',filePath:song,singer:'Fixture singer',song:'Plain',artist:'Fixture'}],playerOrder:['fixture-request']}));
  let child,stderr='';
  async function start(){child=spawn(process.execPath,['--import',preload,'src/server.mjs'],{cwd:bridge,env:{...process.env,GUEST_STAR_PORT:String(port),GUEST_STAR_FFMPEG:ffmpeg,GUEST_STAR_TEST_HOME:join(temp,'isolated-home')},stdio:['ignore','ignore','pipe']});child.stderr.on('data',b=>{stderr+=b.toString();});try{await until(()=>fetch(url+'/api/state').then(r=>r.json()),s=>s.account?.authenticated===signedIn);}catch(e){throw new Error(e.message+'; child stderr: '+stderr);}await pause(150);}
  async function stop(){if(!child||child.exitCode!==null)return;const ended=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await Promise.race([ended,pause(2000)]);if(child.exitCode===null){child.kill('SIGKILL');await ended;}}
  t.after(async()=>{await stop();await new Promise(r=>sheet.close(r));await rm(temp,{recursive:true,force:true});});
  await start();
  async function api(path,method='GET',body,headers={}){const response=await fetch(url+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});return {status:response.status,headers:response.headers,text:await response.text()};}
  async function json(path,method='GET',body,headers={}){const r=await api(path,method,body,headers);return {...r,data:JSON.parse(r.text)};}
  return {bridge,library,outside,song,lrcSong,sidecarSong,escape,escapeLink,url,api,json,actions,configPath,queuePath,start,stop,get stderr(){return stderr;}};
}

test('lyrics HTTP isolated: allowed resolution, cache/export, jobs and origin',{timeout:25000},async t=>{
  const f=await fixture(t),plain='/api/player/library-lyrics/'+token(f.song),timed='/api/player/library-lyrics/'+token(f.lrcSong),request='/api/player/lyrics/fixture-request';
  const configBefore=await readFile(f.configPath,'utf8'),queueBefore=await readFile(f.queuePath,'utf8');
  await t.test('GET idle and request id resolve the same source; client path cannot redirect',async()=>{
    const idle=await f.json(plain);assert.equal(idle.status,200);assert.equal(idle.data.status,'idle');
    const byId=await f.json(request+'?path='+encodeURIComponent(f.escape));assert.equal(byId.status,200);assert.equal(byId.data.sourceKey,idle.data.sourceKey);
    assert.equal((await f.api(request+'/lrc')).status,404);
    assert.equal((await f.api('/api/player/lyrics/missing-request')).status,400);
  });
  await t.test('sidecar and LRC export ready, sanitized headers; force retains authorized sidecar',async()=>{
    const ready=await f.json(timed);assert.equal(ready.status,200);assert.equal(ready.data.status,'ready');assert.equal(ready.data.provider,'local-lrc');assert.equal(ready.data.estimated,false);assert.equal(ready.data.segments[0].start,1.25);
    const lrc=await f.api(timed+'/lrc');assert.equal(lrc.status,200);assert.match(lrc.headers.get('content-type'),/^text\/plain/);assert.match(lrc.headers.get('content-disposition'),/attachment/);assert.match(lrc.text,/\[00:01.25\]First fixture line/);
    const forced=await f.json(timed,'POST',{language:'auto',force:true});assert.equal(forced.data.status,'ready');assert.equal(forced.data.provider,'local-lrc');
    assert.equal((await f.api(timed+'/lrc','POST',{language:'auto'})).status,404);
    await writeFile(f.lrcSong.replace(/\.mp3$/,'.lrc'),'[00:02.00]Updated sidecar fixture\n');
    const updated=await f.json(timed);assert.equal(updated.data.status,'ready');assert.equal(updated.data.sourceKey,ready.data.sourceKey);assert.notEqual(updated.data.versionId,ready.data.versionId);assert.equal(updated.data.segments[0].text,'Updated sidecar fixture');
  });
  await t.test('outside paths, sibling prefix, directory and symlink escape rejected; sidecar escape ignored',async()=>{
    for(const file of [f.escape,f.escapeLink,f.library,join(f.library+'-other','Sibling.mp3')]){const r=await f.json('/api/player/library-lyrics/'+token(file));assert.equal(r.status,400);assert.equal(r.data.ok,false);}
    const escaped=await f.json('/api/player/library-lyrics/'+token(f.sidecarSong));assert.equal(escaped.status,200);assert.equal(escaped.data.status,'idle');assert.equal(escaped.data.segments.length,0);assert.equal(escaped.text.includes('OUTSIDE SECRET'),false);
  });
  await t.test('Origin mismatch rejected for GET/POST/DELETE including LRC; same origin accepted',async()=>{
    for(const method of ['GET','POST','DELETE']){const denied=await f.json(timed,method,method==='POST'?{}:undefined,{Origin:'https://foreign.invalid'});assert.equal(denied.status,403);}
    assert.equal((await f.api(timed+'/lrc','GET',undefined,{Origin:'https://foreign.invalid'})).status,403);
    assert.equal((await f.json(timed,'GET',undefined,{Origin:f.url})).status,200);
  });
  await t.test('POST validated language, asynchronous native protocol fixture, DELETE cancellation and force retry',async()=>{
    assert.equal((await f.json(plain,'POST',{language:'../../bad'})).status,400);
    const active=await f.json(request,'POST',{language:'auto',path:f.escape});assert.equal(active.status,200);assert.ok(['preparing','transcribing'].includes(active.data.status));
    const cancelled=await f.json(plain,'DELETE');assert.equal(cancelled.status,200);assert.equal(cancelled.data.status,'cancelled');
    assert.equal((await f.json(request)).data.status,'cancelled');
    await pause(100);const retry=await f.json(plain,'POST',{language:'auto',force:true});assert.equal(retry.status,200);
    const ready=await until(()=>f.json(request),r=>r.data.status==='ready');assert.equal(ready.data.provider,'whisper-tiny-local');assert.equal(ready.data.estimated,true);assert.equal(ready.data.segments[0].text,'Protocol fixture cue');assert.ok(ready.data.segments[0].words.length);
    const exported=(await f.api(request+'/lrc')).text;assert.match(exported,/<00:02\.06>/,'enhanced LRC preserves word timing');assert.match(exported.replace(/<\d\d:\d\d\.\d\d>/g,''),/\[00:01.50\]Protocol fixture cue/);
  });
  await t.test('lyrics operations preserve queue/config and do not issue cloud mutations',async()=>{
    assert.equal(await readFile(f.configPath,'utf8'),configBefore);assert.equal(await readFile(f.queuePath,'utf8'),queueBefore);
    const forbidden=['bridgeRequestUpdate','bridgeExternalSync','archiveClearQueue','selectActivity','toggleRequests','updateBridgeConfig'];assert.equal(f.actions.some(a=>forbidden.includes(a)),false);
  });
  await t.test('restart reads persisted native-result cache without requesting inference again',async()=>{
    assert.ok((await readdir(join(f.bridge,'data','lyrics-cache'))).some(n=>n.endsWith('.json')));
    const before=(await f.json(plain)).data;await f.stop();await f.start();const after=(await f.json(plain)).data;
    assert.equal(after.status,'ready');assert.equal(after.sourceKey,before.sourceKey);assert.deepEqual(after.segments,before.segments);
  });
});

test('lyrics HTTP isolated: no signed-in session rejects mutations but permits authorized local GET',{timeout:15000},async t=>{
  const f=await fixture(t,{signedIn:false}),path='/api/player/library-lyrics/'+token(f.song);
  assert.equal((await f.json(path)).data.status,'idle');
  for(const method of ['POST','DELETE']){const r=await f.json(path,method,method==='POST'?{language:'auto'}:undefined);assert.equal(r.status,400);assert.match(r.data.error,/Sign in to Guest Star first/);}
  assert.equal((await f.json('/api/player/library-lyrics/'+token(f.escape))).status,400);
});


test('Player media preferences persist; priority applies on load, active source stays latched and manual override wins',{timeout:20000},async t=>{
 const f=await fixture(t);const video=f.song.replace('.mp3','.mp4');await writeFile(video,Buffer.alloc(128,4));
 const audio=join(f.outside,'Audio'),videos=join(f.outside,'Video');await mkdir(audio);await mkdir(videos);
 await writeFile(join(audio,'New audio.mp3'),Buffer.alloc(128,3));await writeFile(join(audio,'Wrong video.mp4'),Buffer.alloc(128,3));await writeFile(join(videos,'New video.mp4'),Buffer.alloc(128,3));
 let preferences=await f.json('/api/player/media-preferences','POST',{audioFolders:[audio],videoFolders:[videos],priority:'video'});assert.equal(preferences.status,200);assert.equal(preferences.data.priority,'video');
 await f.json('/api/library/scan','POST',{});
 const choices=await f.json('/api/player/source/fixture-request?prepare=1');assert.equal(choices.status,200);assert.ok(Buffer.from(choices.data.selectedToken,'base64url').toString().endsWith('.mp4'));assert.equal(choices.data.candidates.length,2);
 await f.json('/api/player/media-preferences','POST',{audioFolders:[audio],videoFolders:[videos],priority:'audio'});
 const latched=await f.json('/api/player/source/fixture-request');assert.equal(latched.data.selectedToken,choices.data.selectedToken);
 const next=await f.json('/api/player/source/fixture-request?prepare=1');assert.ok(Buffer.from(next.data.selectedToken,'base64url').toString().endsWith('.mp3'));
 const manual=await f.json('/api/player/source/fixture-request','POST',{token:choices.data.selectedToken});assert.equal(manual.status,200);assert.equal(manual.data.mediaType,'video');
 assert.equal((await f.json('/api/player/source/fixture-request?prepare=1')).data.selectedToken,choices.data.selectedToken);
 assert.equal((await f.json('/api/player/source/fixture-request','POST',{token:token(f.escape)})).status,400);
 const listing=await f.json('/api/player/library?all=1');assert.ok(listing.data.tracks.some(x=>x.song==='New audio'));assert.ok(listing.data.tracks.some(x=>x.song==='New video'));assert.ok(!listing.data.tracks.some(x=>x.song==='Wrong video'));
 await f.stop();await f.start();assert.equal((await f.json('/api/player/media-preferences')).data.priority,'audio');assert.equal((await f.json('/api/player/source/fixture-request')).data.selectedToken,choices.data.selectedToken);
});
