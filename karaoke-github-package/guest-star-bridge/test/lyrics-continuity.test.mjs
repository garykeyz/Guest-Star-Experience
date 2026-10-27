import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,readFile,chmod,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {LyricsExtractor} from '../src/lyrics.mjs';
import {RecordingIdentity} from '../src/recording-identity.mjs';

const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const until=async predicate=>{const end=Date.now()+5000;while(Date.now()<end){if(await predicate())return;await new Promise(r=>setTimeout(r,5));}throw new Error('Fixture did not settle');};
async function fixture(t){const directory=await mkdtemp(join(tmpdir(),'gs-lyrics-continuity-'));t.after(()=>rm(directory,{recursive:true,force:true}));const file=join(directory,'fixture.mp3');await writeFile(file,'fixture');return {directory,file};}
async function executable(path,body){await writeFile(path,'#!/usr/bin/env node\n'+body);await chmod(path,0o755);return path;}

test('concurrent requests and identical recording aliases create one lookup and one analysis',async t=>{
 const {directory,file}=await fixture(t),alias=join(directory,'alias.mp3');await writeFile(alias,'fixture');
 const lookup=deferred(),entered=deferred(),analysis=deferred();let lookups=0,analyses=0;
 const service=new LyricsExtractor({sharedRequest:async()=>{lookups++;entered.resolve();await lookup.promise;return{};},transcribe:async()=>{analyses++;await analysis.promise;return {segments:[{start:0,end:1,text:'fixture'}]};}});t.after(()=>service.close());
 const calls=[service.request(file,{start:true}),service.request(file,{start:true}),service.request(alias,{start:true})];
 await entered.promise;lookup.resolve();const results=await Promise.all(calls);assert.equal(new Set(results.map(r=>r.sourceKey)).size,1);assert.equal(lookups,1);assert.equal(analyses,1);assert.equal(service.queue.length,0);
 analysis.resolve();await until(()=>!service.active);assert.equal(analyses,1);assert.equal(service.requests.size,0);
});

test('cache cannot mask active forced analysis; cancellation reaches its actual controller',async t=>{
 const {directory,file}=await fixture(t),sidecar=join(directory,'fixture.lrc');await writeFile(sidecar,'[00:00]cached\n');
 const analysis=deferred();const service=new LyricsExtractor({cacheRoot:join(directory,'cache'),transcribe:async()=>{await analysis.promise;return{segments:[{start:0,end:1,text:'new'}]};}});t.after(()=>service.close());
 const old=await service.request(file);await rm(sidecar);await service.request(file,{start:true,force:true});
 const poll=await service.request(file);assert.equal(poll.status,'transcribing');assert.notEqual(poll.versionId,old.versionId);
 const cancelled=await service.cancel(file);assert.equal(cancelled.status,'cancelled');assert.equal(service.active.controller.signal.aborted,true);analysis.resolve();await until(()=>!service.active);
 const saved=await service.request(file);assert.equal(saved.versionId,old.versionId);
});

test('cancel or shutdown during a shared lookup never launches the delayed analysis',async t=>{
 for(const shutdown of [false,true]){
  const {file}=await fixture(t),lookup=deferred(),entered=deferred();let analyses=0;
  const service=new LyricsExtractor({sharedRequest:async()=>{entered.resolve();await lookup.promise;return{};},transcribe:async()=>{analyses++;return{segments:[]};}});t.after(()=>service.close());
  const pending=service.request(file,{start:true});await entered.promise;if(shutdown)service.close();else await service.cancel(file);lookup.resolve();
  assert.equal((await pending).status,'cancelled');assert.equal(analyses,0);assert.equal(service.requests.size,0);
 }
});

test('a failed cache operation releases the request lock for a valid retry',async t=>{
 const {file}=await fixture(t);const service=new LyricsExtractor();t.after(()=>service.close());let fail=true;const selected=service.versionStore.selected.bind(service.versionStore);
 service.versionStore.selected=key=>{if(fail){fail=false;throw new Error('fixture cache error');}return selected(key);};
 await assert.rejects(service.request(file),/fixture cache error/);assert.equal(service.requests.size,0);assert.equal((await service.request(file)).status,'idle');
});

test('identity decoding is single flight with bounded concurrency and persistent cache survives restart',async t=>{
 const {directory,file}=await fixture(t),events=join(directory,'events.jsonl');
 const decoder=await executable(join(directory,'decoder'),`import fs from 'node:fs';const file=process.argv[process.argv.indexOf('-i')+1];fs.appendFileSync(${JSON.stringify(events)},JSON.stringify({type:'start',pid:process.pid,args:process.argv.slice(2)})+'\\n');setTimeout(()=>{process.stdout.write(Buffer.alloc(32000,2));fs.appendFileSync(${JSON.stringify(events)},JSON.stringify({type:'end',pid:process.pid})+'\\n');},30);`);
 const files=[file];for(let i=0;i<3;i++){const next=join(directory,`file-${i}.mp3`);await writeFile(next,'fixture'+i);files.push(next);}
 const identity=new RecordingIdentity({root:join(directory,'cache'),ffmpegPath:decoder});t.after(()=>identity.close());await Promise.all([...files,file].map(f=>identity.identify(f)));
 const rows=(await readFile(events,'utf8')).trim().split('\n').map(JSON.parse);let active=0,peak=0;for(const row of rows){active+=row.type==='start'?1:-1;peak=Math.max(peak,active);}assert.equal(peak,1);assert.equal(rows.filter(r=>r.type==='start').length,4);
 assert.deepEqual(rows[0].args.slice(3,7),['-threads','1','-filter_threads','1']);
 const restarted=new RecordingIdentity({root:join(directory,'cache'),ffmpegPath:decoder});t.after(()=>restarted.close());await Promise.all(files.map(f=>restarted.identify(f)));assert.equal((await readFile(events,'utf8')).trim().split('\n').length,8);
});

test('a persisted identity cache hit bypasses an unrelated active decoder',async t=>{
 const {directory,file}=await fixture(t),events=join(directory,'events'),slow=join(directory,'slow.mp3');await writeFile(slow,'slow fixture');
 const decoder=await executable(join(directory,'decoder'),`import fs from 'node:fs';const file=process.argv[process.argv.indexOf('-i')+1];fs.appendFileSync(${JSON.stringify(events)},file+'\\n');setTimeout(()=>process.stdout.write(Buffer.alloc(32000,2)),file.includes('slow.mp3')?250:1);`);
 const options={root:join(directory,'cache'),ffmpegPath:decoder},original=new RecordingIdentity(options);await original.identify(file);original.close();
 const restarted=new RecordingIdentity(options);t.after(()=>restarted.close());let slowDone=false;const pending=restarted.identify(slow).then(()=>slowDone=true);await until(async()=>(await readFile(events,'utf8')).includes('slow.mp3'));
 const cached=await restarted.identify(file);assert.equal(cached.samples,16000);assert.equal(slowDone,false);await pending;
});

test('fallback hashes media incrementally with the same identity and invalidates after source changes',async t=>{
 const {directory,file}=await fixture(t),bytes=Buffer.alloc(1024*1024,37);await writeFile(file,bytes);
 const first=new RecordingIdentity({root:join(directory,'cache')});t.after(()=>first.close());const identity=await first.identify(file);assert.equal(identity.fingerprint,createHash('sha256').update(bytes).digest('hex'));assert.equal(identity.type,'file-sha256-fallback');
 const reopened=new RecordingIdentity({root:join(directory,'cache')});t.after(()=>reopened.close());assert.deepEqual(await reopened.identify(file),identity);await writeFile(file,'changed recording');assert.notEqual((await reopened.identify(file)).fingerprint,identity.fingerprint);
});

test('shutdown kills an active identity decoder and queued work cannot create another process',async t=>{
 const {directory,file}=await fixture(t),marker=join(directory,'pid'),other=join(directory,'other.mp3');await writeFile(other,'other');
 const decoder=await executable(join(directory,'decoder'),`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);`);
 const identity=new RecordingIdentity({ffmpegPath:decoder});t.after(()=>identity.close());const work=Promise.allSettled([identity.identify(file),identity.identify(other)]);await until(async()=>{try{return Boolean(await readFile(marker,'utf8'));}catch{return false;}});
 const pid=Number(await readFile(marker,'utf8'));identity.close();const results=await work;assert.equal(results.every(r=>r.status==='rejected'),true);assert.throws(()=>process.kill(pid,0),error=>error.code==='ESRCH');assert.equal(identity.pending.size,0);assert.equal(identity.queued,0);
});

test('an ASR subprocess error kills the paired decoder instead of leaving a worker behind',async t=>{
 const {directory,file}=await fixture(t),marker=join(directory,'decoder-pid');
 const decoder=await executable(join(directory,'decoder'),`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},String(process.pid));setInterval(()=>{},1000);`);
 const runner=await executable(join(directory,'runner'),`setTimeout(()=>process.exit(1),150);`),model=join(directory,'model');await writeFile(model,'fixture');
 const service=new LyricsExtractor({ffmpegPath:decoder,runnerPath:runner,modelPath:model});t.after(()=>service.close());await assert.rejects(service.runNative(file,{language:'auto',signal:new AbortController().signal}),/Worker failed/);
 const pid=Number(await readFile(marker,'utf8'));assert.throws(()=>process.kill(pid,0),error=>error.code==='ESRCH');
});

test('sidecar timing and word corrections invalidate only the imported cache without analysis',async t=>{
 const {directory,file}=await fixture(t),sidecar=join(directory,'fixture.lrc');let analyses=0;
 const service=new LyricsExtractor({cacheRoot:join(directory,'cache'),transcribe:()=>{analyses++;throw new Error('Imported lyrics must not analyze');}});t.after(()=>service.close());
 await writeFile(sidecar,'[00:01]<00:01>same <00:02>text\n[00:03]next\n');const first=await service.request(file);
 await writeFile(sidecar,'[00:02]<00:02>same <00:02.50>text\n[00:04]next\n');const corrected=await service.request(file);assert.equal(corrected.segments[0].start,2);assert.equal(corrected.segments[0].words[1].start,2.5);assert.notEqual(corrected.versionId,first.versionId);assert.equal(analyses,0);
 const edited=await service.edit(file,{lrc:'[00:02]manual text\n[00:04]next\n',expectedRevision:corrected.revision,reviewedAll:true});await writeFile(sidecar,'[00:05]same text\n[00:07]next\n');const selected=await service.request(file);assert.equal(selected.versionId,edited.versionId);assert.equal(selected.segments[0].start,2);assert.equal(analyses,0);
});

test('manual words, CAS, history, restore and cached reuse remain intact',async t=>{
 const {directory,file}=await fixture(t);let analyses=0;
 const service=new LyricsExtractor({cacheRoot:join(directory,'cache'),transcribe:async()=>{analyses++;return {segments:[{start:0,end:6,text:'your going',words:[{start:0,end:2,text:'your'},{start:2,end:6,text:'going'}]}]};}});t.after(()=>service.close());
 await service.request(file,{start:true});await until(()=>!service.active);const first=await service.request(file);
 const edited=await service.edit(file,{lrc:"[00:00]you're going",expectedRevision:first.revision,reviewedAll:true});assert.equal(edited.segments[0].words[0].text,"you're");assert.equal(edited.segments[0].words[0].end,2);assert.equal(analyses,1);
 await assert.rejects(service.edit(file,{lrc:'[00:00]stale',expectedRevision:first.revision}),/changed/);await service.request(file,{start:true,force:true});await until(()=>!service.active);assert.equal((await service.request(file)).versionId,edited.versionId);assert.equal(analyses,2);
 const history=await service.versions(file),restored=await service.restore(file,{versionId:first.versionId,expectedRevision:history.revision});assert.equal(restored.segments[0].text,'your going');assert.equal((await service.versions(file)).versions.length,2);
 const reopened=new LyricsExtractor({cacheRoot:join(directory,'cache'),transcribe:()=>{throw new Error('Cached media must not analyze');}});t.after(()=>reopened.close());assert.equal((await reopened.request(file,{start:true})).versionId,first.versionId);
});
