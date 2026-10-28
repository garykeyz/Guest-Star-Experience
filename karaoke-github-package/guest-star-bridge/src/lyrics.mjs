import { createHash } from 'node:crypto';
import { readFile, open, stat, mkdir, writeFile, rename, mkdtemp, rm } from 'node:fs/promises';
import { resolve, extname, join, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { setPriority, tmpdir } from 'node:os';

export const LYRICS_VERSION = 'whisper-tiny-1.9.5-gs2';
import {RecordingIdentity} from './recording-identity.mjs';
import {LyricVersionStore,validateAlignment} from './lyric-version-store.mjs';
import {runForcedAlignment} from './lyrics-alignment.mjs';
import {completeLyricsWordCoverage} from '../public/shared/lyric-word-coverage.js';
const LIMIT_LINES=2000, LIMIT_TEXT=400000, LIMIT_SIDECAR=1024*1024;
export function cleanText(value) { return String(value||'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/<\d+:\d+(?:[.:]\d+)?>/g,'').trim().slice(0,1000); }
export function normalizeSegments(values=[]) {
  let remaining=80000;
  return values.slice(0,LIMIT_LINES).map(s=>{const text=cleanText(s.text).slice(0,remaining);remaining-=text.length;return {start:Math.max(0,Number(s.start)),end:Number(s.end),text,...(Array.isArray(s.words)?{words:s.words.map(w=>({start:Math.max(0,Number(w.start)),end:Number(w.end),text:cleanText(w.text)})).filter(w=>Number.isFinite(w.start)&&Number.isFinite(w.end)&&w.end>w.start)}:{})};})
    .filter(s=>Number.isFinite(s.start)&&Number.isFinite(s.end)&&s.end>s.start&&s.text)
    .sort((a,b)=>a.start-b.start);
}
export function normalizeGeneratedSegments(values=[],duration=0){
  let cursor=0;const output=[];
  for(const segment of normalizeSegments(values)){
    const start=Math.max(cursor,segment.start),end=duration>0?Math.min(duration,segment.end):segment.end;
    if(end-start<.02)continue;
    let wordCursor=start;const words=[];
    for(const word of segment.words||[]){const from=Math.max(wordCursor,word.start,start),to=Math.min(end,word.end);if(to-from<.01)continue;words.push({...word,start:from,end:to});wordCursor=to;}
    output.push({...segment,start,end,...(segment.words?{words}:{})});cursor=end;
  }
  return output;
}
export function parseLRC(text) {
  if(Buffer.byteLength(String(text))>LIMIT_SIDECAR)throw new Error('LRC too large');
  const offset=Number(String(text).match(/\[offset:\s*([+-]?\d+)\]/i)?.[1]||0)/1000;
  const lines=[];
  for(const line of String(text).split(/\r?\n/)) {
    const tags=[...line.matchAll(/\[(\d{1,4}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const raw=line.replace(/\[[^\]]*\]/g,'');
    const wordTags=[...raw.matchAll(/<(\d{1,4}):(\d{2})(?:[.:](\d{1,3}))?>([^<]*)/g)];
    const words=cleanText(raw);
    if(!words)continue;
    for(const tag of tags) {
      if(Number(tag[2])>=60)continue;
      const start=Number(tag[1])*60+Number(tag[2])+Number(`0.${tag[3]||0}`)+offset;
      if(start>=0)lines.push({start,text:words,...(wordTags.length?{words:wordTags.map(t=>({start:Number(t[1])*60+Number(t[2])+Number(`0.${t[3]||0}`)+offset,text:cleanText(t[4])})).filter(w=>w.text)}:{})});
      if(lines.length>LIMIT_LINES)throw new Error('Too many LRC lines');
    }
  }
  lines.sort((a,b)=>a.start-b.start);
  // Same-time tags may describe two lines, retain both as one cue.
  const unique=[];
  for(const line of lines){const last=unique.at(-1);if(last?.start===line.start){if(last.text!==line.text)last.text=cleanText(`${last.text} / ${line.text}`);}else unique.push({...line});}
  return unique.map((s,i)=>{const end=unique[i+1]?.start??s.start+8;return {...s,end,...(s.words?{words:s.words.map((w,j)=>({...w,end:s.words[j+1]?.start??end}))}:{})};}).filter(s=>s.end>s.start);
}
export function toLRC(segments) {
  return normalizeSegments(segments).map(s=>{const cs=Math.round(s.start*100);const tag=(time)=>{const v=Math.round(time*100);return `${String(Math.floor(v/6000)).padStart(2,'0')}:${String(Math.floor(v/100)%60).padStart(2,'0')}.${String(v%100).padStart(2,'0')}`;};return `[${tag(s.start)}]${s.words?.length?s.words.map(w=>`<${tag(w.start)}>${w.text} `).join('').trim():s.text}`;}).join('\n')+'\n';
}
function importedSidecarSegments(identity){
  const duration=identity.recording.durationSeconds;
  return parseLRC(identity.sidecar.text).map(s=>({...s,end:duration>0?Math.min(s.end,duration):s.end,...(s.words?{words:s.words.map(w=>({...w,end:duration>0?Math.min(w.end,duration):w.end}))}:{})})).filter(s=>s.end>s.start);
}
async function fingerprint(file) {
  const info=await stat(file);if(!info.isFile())throw new Error('Not a media file');
  const hash=createHash('sha256').update(`${file}|${info.size}|${info.mtimeMs}`);
  const fd=await open(file,'r');try{for(const at of [0,Math.max(0,Math.floor(info.size/2)-32768),Math.max(0,info.size-65536)]){const data=Buffer.alloc(65536);const {bytesRead}=await fd.read(data,0,data.length,at);hash.update(data.subarray(0,bytesRead));}}finally{await fd.close();}
  return hash.digest('hex');
}
export class LyricsExtractor {
  constructor({cacheRoot,ffmpegPath,runnerPath,modelPath,authorize=async p=>p,timeoutMs=900000,transcribe}={}) {
    Object.assign(this,{cacheRoot,ffmpegPath,runnerPath,modelPath,authorize,timeoutMs});
    this.jobs=new Map();this.queue=[];this.active=null;this.requests=new Map();this.cancelEpochs=new Map();this.closed=false;this.transcribe=transcribe||((file,o)=>this.runNative(file,o));
    this.identityStore=new RecordingIdentity({root:cacheRoot,ffmpegPath});
    this.versionStore=new LyricVersionStore(cacheRoot);
    this.sharedRequest=arguments[0]?.sharedRequest;this.align=arguments[0]?.align;this.alignerPath=arguments[0]?.alignerPath;
  }
  view(job) { const {sourceKey,status,provider,language,segments,processedSeconds,error}=job;const {lyricsText,lyricsAlignment,...compact}=job;return {...compact,controller:undefined,file:undefined,lyricsTextVersionId:lyricsText?.textVersionId,alignmentVersionId:lyricsAlignment?.alignmentVersionId,sourceKey,status,provider,language,segments:completeLyricsWordCoverage(segments),processedSeconds:processedSeconds||0,error:error||'',estimated:job.estimated ?? provider==='whisper-tiny-local',version:LYRICS_VERSION}; }
  async identity(file,language='auto') {
    file=await this.authorize(file);
    language=String(language||'auto').toLowerCase();if(!/^[a-z]{2,3}$/.test(language)&&language!=='auto')throw new Error('Invalid language');
    let sidecar=null;
    try{const path=await this.authorize(file.slice(0,-extname(file).length)+'.lrc');const info=await stat(path);if(info.size>LIMIT_SIDECAR)throw new Error('LRC too large');sidecar={path,text:await readFile(path,'utf8')};}catch(e){if(e.message==='LRC too large')throw e;}
    this.identityStore.ffmpegPath=this.ffmpegPath;
    const recording={...await this.identityStore.identify(file)};
    const label=basename(file,extname(file)).normalize('NFKC').toLowerCase().replace(/\b(live|remix|radio|edit|extended|album|karaoke|lyrics|video|audio|version|official)\b/g,'').replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    recording.workKey=createHash('sha256').update(label).digest('hex');
    const sourceKey=createHash('sha256').update(`${recording.fingerprint}|${recording.samples}|${language}`).digest('hex');
    return {file,language,sidecar,sourceKey,recording};
  }
  async request(file,{language='auto',start=false,force=false}={}) {
    if(this.closed)throw new Error('Lyrics extractor closed');
    const identity=await this.identity(file,language);const key=identity.sourceKey;
    // Identity already single-flights each unchanged file. Serialize registration
    // by decoded recording too, including alternate files with identical PCM.
    const previous=this.requests.get(key)||Promise.resolve();
    const cancelEpoch=this.cancelEpochs.get(key)||0;
    const task=previous.catch(()=>{}).then(()=>this.requestIdentity(identity,{language,start,force,cancelEpoch}));
    this.requests.set(key,task);
    try{return await task;}finally{if(this.requests.get(key)===task){this.requests.delete(key);this.cancelEpochs.delete(key);}}
  }
  async requestIdentity(identity,{language,start,force,cancelEpoch}) {
    if(this.closed)throw new Error('Lyrics extractor closed');
    const key=identity.sourceKey;
    let job=this.jobs.get(key);
    const cancelled=()=>this.closed||cancelEpoch!==(this.cancelEpochs.get(key)||0);
    if(start&&cancelled())return {sourceKey:key,status:'cancelled',segments:[]};
    // A saved version must not hide or replace a live reanalysis controller.
    if(job && ['preparing','transcribing','aligning'].includes(job.status))return this.view(job);
    const saved=await this.versionStore.selected(key);
    if(!saved&&!job&&!force&&this.cacheRoot){try{const pending=JSON.parse(await readFile(resolve(this.cacheRoot,key+'.text.json'),'utf8'));if(pending.recording?.fingerprint===identity.recording.fingerprint&&pending.status==='needs_alignment'){this.jobs.set(key,pending);job=pending;}}catch{}}
    let imported;
    if(saved && identity.sidecar && saved.provider==='local-lrc'){
      imported=importedSidecarSegments(identity);
      // Timing and supplied word intervals are corrections too, even when the
      // line text is unchanged. A human-edited selected version remains protected.
      if(JSON.stringify(saved.segments)!==JSON.stringify(imported))force=true;
    }
    if(saved && !force){job={...saved,sourceKey:key,status:'ready',recording:identity.recording};this.jobs.set(key,job);return this.view(job);}
    if(job && (!force||['preparing','transcribing','aligning'].includes(job.status)) && !(start&&job.status==='idle'))return this.view(job);
    if(!force && this.cacheRoot) {
      try{const path=resolve(this.cacheRoot,key+'.json');if((await stat(path)).size>LIMIT_TEXT)throw new Error();const cache=JSON.parse(await readFile(path,'utf8'));if(cache.sourceKey===key&&cache.status==='ready'&&Array.isArray(cache.segments)){cache.segments=normalizeSegments(cache.segments);if(cache.segments.length){this.jobs.set(key,cache);return this.view(cache);}}}catch{}
    }
    job={sourceKey:key,status:'idle',provider:'',language,segments:[],processedSeconds:0,recording:identity.recording};
    if(identity.sidecar){job.segments=imported||importedSidecarSegments(identity);job.status=job.segments.length?'ready':'unavailable';job.provider='local-lrc';job.estimated=false;job.alignmentMethod='imported-lrc-line';}
    else if(start && this.sharedRequest && !force){
      try{const result=await this.sharedRequest('lyricsLookup',{recording:identity.recording});
      const candidate=result?.version;if(candidate && candidate.recording?.fingerprint===identity.recording.fingerprint && Math.abs(candidate.recording.durationSeconds-identity.recording.durationSeconds)<.02){
        validateAlignment(candidate.segments,identity.recording.durationSeconds);Object.assign(job,candidate,{sourceKey:key,recording:identity.recording,status:'ready',provider:'guest-star-shared'});
      }else if(result?.textCandidate){job.status='needs_alignment';job.provider='guest-star-shared-text';job.textCandidate=result.textCandidate;}}catch{}
    }
    if(start&&cancelled()){job.status='cancelled';this.jobs.set(key,job);return this.view(job);}
    if(start && job.status==='idle'){job.status='preparing';job.provider='whisper-tiny-local';job.controller=new AbortController();job.file=identity.file;}
    if(this.jobs.size>=64){const old=[...this.jobs].find(([,v])=>!['preparing','transcribing','aligning'].includes(v.status));if(old)this.jobs.delete(old[0]);else throw new Error('Lyrics queue full');}
    this.jobs.set(key,job);
    if(job.status==='needs_alignment'&&this.cacheRoot){await mkdir(this.cacheRoot,{recursive:true});await writeFile(resolve(this.cacheRoot,key+'.text.json'),JSON.stringify(this.view(job)));}
    if(job.status==='ready')await this.save(job);
    if(job.status==='preparing'&&!force&&this.cacheRoot){
      try{const legacyKey=createHash('sha256').update(`${await fingerprint(identity.file)}|whisper-tiny-1.9.5-gs1|${language}|${identity.sidecar?.text||''}`).digest('hex');const old=JSON.parse(await readFile(resolve(this.cacheRoot,legacyKey+'.json'),'utf8'));if(old.status==='ready'&&old.segments?.length){job.reuseText={segments:old.segments,language:old.language};job.provider='local-cache-realigned';}}catch{}
    }
    if(job.status==='preparing'){if(this.queue.length>=8){job.status='error';job.error='La cola de letras está ocupada.';}else{this.queue.push(job);this.pump();}}
    return this.view(job);
  }
  async cancel(file,{language='auto'}={}) {
    const {sourceKey}=await this.identity(file,language);const job=this.jobs.get(sourceKey);
    if(this.requests.has(sourceKey))this.cancelEpochs.set(sourceKey,(this.cancelEpochs.get(sourceKey)||0)+1);
    if(job && ['preparing','transcribing','aligning'].includes(job.status)){job.status='cancelled';job.controller.abort();this.queue=this.queue.filter(j=>j!==job);}
    return job?this.view(job):{sourceKey,status:'cancelled',segments:[]};
  }
  async save(job) {
    if(!this.cacheRoot)return;
    const current=await this.versionStore.selected(job.sourceKey);
    const replaceSidecar=job.provider==='local-lrc'&&current?.provider==='local-lrc';
    const version=await this.versionStore.append(job.sourceKey,this.view(job),undefined,replaceSidecar);Object.assign(job,version);
    await mkdir(this.cacheRoot,{recursive:true});const path=resolve(this.cacheRoot,job.sourceKey+'.json'),temp=path+'.tmp';
    await writeFile(temp,JSON.stringify({...this.view(job),status:'ready'}));await rename(temp,path);
  }
  async pump() {
    if(this.closed||this.active)return;
    const job=this.queue.shift();if(!job)return;
    this.active=job;job.status='transcribing';
    try {
      if(job.recording?.durationSeconds>1800)throw new Error('Batch lyrics support recordings up to 30 minutes.');
      const result=job.reuseText || await this.transcribe(job.file,{language:job.language,signal:job.controller.signal,progress:n=>job.processedSeconds=n});delete job.reuseText;
      if(result.segments?.length && (this.alignerPath || this.align)){
        job.status='aligning';const aligned=await (this.align || runForcedAlignment)(job.file,{segments:result.segments,language:result.language||job.language,ffmpegPath:this.ffmpegPath,modelPath:this.modelPath,runnerPath:this.alignerPath,signal:job.controller.signal});
        result.segments=aligned;job.alignmentMethod='forced-text-cross-attention-dtw';
      }else job.alignmentMethod='asr-segment-estimate';
      if(!job.controller.signal.aborted){job.segments=normalizeGeneratedSegments(result.segments,job.recording.durationSeconds);if(job.recording.type==='decoded-pcm-sha256-v1')validateAlignment(job.segments,job.recording.durationSeconds);job.language=result.language||job.language;const completedStatus=job.segments.length?'ready':'unavailable';if(completedStatus==='ready')await this.save(job);job.status=completedStatus;}
    } catch {if(!job.controller.signal.aborted){job.status='error';job.error='No se pudo analizar la letra localmente. Puedes reintentar o usar un archivo LRC.';}}
    finally{delete job.file;delete job.controller;this.active=null;this.pump();}
  }
  async runNative(file,{language,signal,progress}) {
    await Promise.all([stat(this.ffmpegPath),stat(this.runnerPath),stat(this.modelPath)]);
    if(signal.aborted)throw new Error('Cancelled');
    const env={...process.env,VECLIB_MAXIMUM_THREADS:'2',OMP_NUM_THREADS:'2'};
    const decoder=spawn(this.ffmpegPath,['-v','error','-nostdin','-threads','1','-filter_threads','1','-i',file,'-vn','-t','1800','-ac','1','-ar','16000','-f','f32le','pipe:1'],{stdio:['ignore','pipe','pipe'],env});
    const runner=spawn(this.runnerPath,[this.modelPath,language,'2'],{stdio:['pipe','pipe','pipe'],env});
    try{setPriority(decoder.pid,10);setPriority(runner.pid,10);}catch{}
    decoder.stdout.pipe(runner.stdin);runner.stdin.on('error',()=>{});
    // Drain logs with bounded retention; paths/logs are never exposed in API.
    let errors='';for(const child of [decoder,runner])child.stderr.on('data',b=>{errors=(errors+b.toString()).slice(-8192);});
    const segments=[];let languageResult=language,protocolError=false;
    const lines=createInterface({input:runner.stdout});lines.on('line',line=>{try{if(line.length>12000)throw new Error();const msg=JSON.parse(line);if(msg.type==='progress')progress?.(msg.processedSeconds);if(msg.type==='segment'){if(segments.length>=LIMIT_LINES)throw new Error();segments.push(msg);languageResult=msg.language||languageResult;}}catch{protocolError=true;}});
    let hardTimer;const cancel=()=>{decoder.kill('SIGTERM');runner.kill('SIGTERM');hardTimer=setTimeout(()=>{decoder.kill('SIGKILL');runner.kill('SIGKILL');},2000);hardTimer.unref();};
    signal.addEventListener('abort',cancel,{once:true});const timeout=setTimeout(cancel,this.timeoutMs);timeout.unref();
    const exit=child=>new Promise((res,rej)=>{child.once('error',rej);child.once('close',(code)=>code===0?res():rej(new Error('Worker failed')));});
    const children=[exit(decoder),exit(runner)];
    try{await Promise.all(children);if(signal.aborted||protocolError)throw new Error('Cancelled or invalid result');return {segments,language:languageResult};}
    finally{clearTimeout(timeout);signal.removeEventListener('abort',cancel);lines.close();if(hardTimer)clearTimeout(hardTimer);decoder.kill('SIGKILL');runner.kill('SIGKILL');await Promise.allSettled(children);}
  }
  async versions(file,options={}){const id=await this.identity(file,options.language);return this.versionStore.history(id.sourceKey);}
  async edit(file,{lrc,segments:editedSegments,expectedRevision,reviewedAll=false}={}){
    const id=await this.identity(file);const direct=Array.isArray(editedSegments);
    if(direct && (editedSegments.length>LIMIT_LINES || editedSegments.some(s=>!Array.isArray(s.words)||s.words.length>1000)))throw new Error('Invalid lyric document');
    const segments=direct?normalizeSegments(editedSegments):parseLRC(lrc).map(s=>({...s,end:id.recording.durationSeconds>0?Math.min(s.end,id.recording.durationSeconds):s.end}));
    if(direct && (segments.length!==editedSegments.length || segments.some((s,i)=>s.words.length!==editedSegments[i].words.length)))throw new Error('Invalid lyric document');
    const old=await this.versionStore.selected(id.sourceKey);if(!old)throw new Error('No lyrics to edit');
    const unchangedTiming=segments.length===old.segments.length && segments.every((s,i)=>Math.abs(s.start-old.segments[i].start)<.02);
    if(!direct&&unchangedTiming)segments.forEach((s,i)=>{if(Math.round(s.start*100)===Math.round(old.segments[i].start*100))s.start=old.segments[i].start;s.end=old.segments[i].end;if(s.words)s.words=s.words.map((w,j)=>({...w,...(Math.round(w.start*100)===Math.round((old.segments[i].words?.[j]?.start??-100)*100)?{start:old.segments[i].words[j].start,end:old.segments[i].words[j].end}:{end:Math.min(w.end,s.end)})}));if(!s.words&&old.segments[i].words){const tokens=s.text.split(/\s+/);if(tokens.length===old.segments[i].words.length)s.words=old.segments[i].words.map((w,j)=>({...w,text:tokens[j]}));}});
    validateAlignment(segments,id.recording.durationSeconds);
    const version=await this.versionStore.append(id.sourceKey,{...old,segments,provider:'host-edited',humanReviewLevel:reviewedAll?'HUMAN_REVIEWED':'PARTIALLY_HUMAN_REVIEWED',reviewCoverage:reviewedAll?1:.25,estimated:old.estimated,recording:id.recording,alignmentMethod:unchangedTiming?old.alignmentMethod:'host-timing-correction'},expectedRevision,true);
    const job={...version,status:'ready',sourceKey:id.sourceKey};this.jobs.set(id.sourceKey,job);return this.view(job);
  }
  async restore(file,{versionId,expectedRevision}={}){const id=await this.identity(file);const version=await this.versionStore.restore(id.sourceKey,versionId,expectedRevision);const job={...version,status:'ready',sourceKey:id.sourceKey};this.jobs.set(id.sourceKey,job);return this.view(job);}
  async realign(file,{lrc,expectedRevision,start=0,end}={}){
    const id=await this.identity(file),old=await this.versionStore.selected(id.sourceKey);if(!old&&!String(lrc||'').trim())throw new Error('No lyric text to align');
    if(this.active)throw new Error('Another lyric analysis is running. Retry when it finishes.');
    if(old&&Number(expectedRevision)!==old.revision){const error=new Error('Lyrics revision conflict');error.status=409;throw error;}
    const controller=new AbortController();this.active={sourceKey:id.sourceKey,controller};
    try{
    let selected=lrc?parseLRC(lrc):old.segments;
    if(!selected.length&&String(lrc||'').trim()){if(id.recording.durationSeconds>30)throw new Error('Add rough line timestamps in sections of 30 seconds or less; the aligner refines them against the actual audio without transcription.');selected=[{start:0,end:id.recording.durationSeconds,text:String(lrc).replace(/\s+/g,' ').trim()}];}
    selected=selected.map(s=>({...s,end:Math.min(s.end,id.recording.durationSeconds)}));const chosen=selected.filter(s=>s.end>start&&s.start<(end??id.recording.durationSeconds));
    const words=await (this.align||runForcedAlignment)(id.file,{segments:chosen,language:old?.language||'auto',ffmpegPath:this.ffmpegPath,modelPath:this.modelPath,runnerPath:this.alignerPath,signal:controller.signal});
    const segments=[...selected.filter(s=>!chosen.includes(s)),...words].sort((a,b)=>a.start-b.start);validateAlignment(segments,id.recording.durationSeconds);
    const version=await this.versionStore.append(id.sourceKey,{...old,segments,recording:id.recording,provider:old?.provider||'host-text-aligned',humanReviewLevel:old?.humanReviewLevel||'PARTIALLY_HUMAN_REVIEWED',alignmentMethod:'forced-text-cross-attention-dtw',estimated:true},old?expectedRevision:undefined,true);const job={...version,sourceKey:id.sourceKey,status:'ready'};this.jobs.set(id.sourceKey,job);return this.view(job);
    }finally{this.active=null;this.pump();}
  }
  async reference(file,{text,url,rights}={}){
    if(!rights?.allow||!['own','public-domain','licensed'].includes(rights.kind)||!String(rights.basis||'').trim())throw new Error('Reference rights are required');
    const parsed=new URL(url);if(parsed.protocol!=='https:')throw new Error('A HTTPS reference is required');
    const id=await this.identity(file),old=await this.versionStore.selected(id.sourceKey);if(!old)throw new Error('Prepare lyrics first');
    const normalize=s=>String(s).normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
    const actual=normalize(old.segments.map(s=>s.text).join(' ')).split(' '),external=normalize(String(text).slice(0,80000)).split(' ');
    const evidence={origin:parsed.origin,referenceUrl:(parsed.origin+parsed.pathname).slice(0,1000),checkedAt:new Date().toISOString(),exactTextMatch:actual.join(' ')===external.join(' '),scope:'text-only',rights:{kind:rights.kind,basis:String(rights.basis).slice(0,500)}};
    const version=await this.versionStore.append(id.sourceKey,{...old,validationEvidence:[...(old.validationEvidence||[]),evidence].slice(-30),humanReviewLevel:old.humanReviewLevel==='AUTOMATIC'&&evidence.exactTextMatch?'EXTERNALLY_VALIDATED':old.humanReviewLevel},old.revision,true);const job={...version,status:'ready',sourceKey:id.sourceKey};this.jobs.set(id.sourceKey,job);
    return {ok:true,lyrics:this.view(job),evidence,conflict:!evidence.exactTextMatch,suggestions:actual.map((word,index)=>word!==external[index]?{index,audioText:word,referenceText:external[index]||''}:null).filter(Boolean).slice(0,100),protectedHumanVersion:old.humanReviewLevel!=='AUTOMATIC',unchanged:true};
  }
  async share(file,{rights}={}){const id=await this.identity(file);const version=await this.versionStore.selected(id.sourceKey);if(!version||!this.sharedRequest)throw new Error('Shared lyrics unavailable');if(!rights?.allow||!['own','public-domain','licensed'].includes(rights.kind)||!String(rights.basis||'').trim())throw new Error('Sharing rights required');return this.sharedRequest('lyricsPublish',{recording:id.recording,segments:version.segments,lyricsText:version.lyricsText,lyricsAlignment:version.lyricsAlignment,language:version.language,humanReviewLevel:version.humanReviewLevel,reviewCoverage:version.reviewCoverage,alignmentMethod:version.alignmentMethod,rights:{kind:rights.kind,basis:String(rights.basis).slice(0,500),allow:true}});}
  close(){this.closed=true;this.active?.controller?.abort();for(const job of this.jobs.values())job.controller?.abort();this.queue=[];this.identityStore.close();}
}
