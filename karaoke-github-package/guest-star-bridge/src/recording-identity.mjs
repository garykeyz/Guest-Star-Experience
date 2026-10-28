import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {stat,readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {spawn} from 'node:child_process';
import {setPriority} from 'node:os';
// Full decoded PCM signature, not artist/title nor a few sampled file windows.
// Exact matching is intentionally conservative across lossy encodings.
export class RecordingIdentity {
 constructor({root,ffmpegPath}={}){this.root=root;this.ffmpegPath=ffmpegPath;this.pending=new Map();this.memo=new Map();this.tail=Promise.resolve();this.queued=0;this.child=null;this.closed=false;}
 async identify(file){
  if(this.closed)throw new Error('Recording identity closed');
  const info=await stat(file),key=createHash('sha256').update(`${file}|${info.size}|${info.mtimeMs}|${info.ctimeMs}`).digest('hex');
  if(this.memo.has(key))return this.memo.get(key);
  if(this.pending.has(key))return this.pending.get(key);
  const task=this.compute(file,key).finally(()=>this.pending.delete(key));this.pending.set(key,task);return task;
 }
 async compute(file,key){
  const path=this.root?resolve(this.root,'identities',key+'.json'):null;
  // The stat-derived index is checked before joining the decoder queue. Cached
  // lyrics remain available while another recording is being identified.
  if(path){try{const id=JSON.parse(await readFile(path,'utf8'));if(/^[a-f0-9]{64}$/.test(id.fingerprint)&&((id.type==='decoded-pcm-sha256-v1'&&id.samples>0)||(!this.ffmpegPath&&id.type==='file-sha256-fallback'&&id.samples===0))){this.remember(key,id);return id;}}catch{}}
  if(this.queued>=16)throw new Error('Recording identity queue full');
  this.queued++;
  const task=this.tail.catch(()=>{}).then(()=>this.decode(file));
  this.tail=task;
  let result;try{result=await task;}finally{this.queued--;}
  this.remember(key,result);
  if(path){await mkdir(resolve(this.root,'identities'),{recursive:true});await writeFile(path+'.tmp',JSON.stringify(result));await rename(path+'.tmp',path);}
  return result;
 }
 remember(key,result){if(this.memo.size>=128)this.memo.delete(this.memo.keys().next().value);this.memo.set(key,result);}
 async decode(file){
  if(this.closed)throw new Error('Recording identity closed');
  let result;
  if(!this.ffmpegPath){const hash=createHash('sha256');for await(const data of createReadStream(file,{highWaterMark:65536})){if(this.closed)throw new Error('Recording identity closed');hash.update(data);}result={type:'file-sha256-fallback',fingerprint:hash.digest('hex'),samples:0,durationSeconds:0};}
 else {
   const hash=createHash('sha256').update('GS-PCM-mono-16000-s16le-v1\0');let bytes=0;
   const peaks=[];let peak=0,peakSamples=0,odd=null;
   const child=spawn(this.ffmpegPath,['-v','error','-nostdin','-threads','1','-filter_threads','1','-i',file,'-vn','-ac','1','-ar','16000','-f','s16le','pipe:1'],{stdio:['ignore','pipe','ignore'],env:{...process.env,VECLIB_MAXIMUM_THREADS:'1',OMP_NUM_THREADS:'1'}});this.child=child;
   try{setPriority(child.pid,15);}catch{}
   child.stdout.on('data',data=>{bytes+=data.length;hash.update(data);if(!this.waveformRoot||peaks.length>=2_000_000)return;let offset=0;if(odd!==null&&data.length){const signed=(data[0]<<8)|odd;peak=Math.max(peak,Math.abs(signed&0x8000?signed-0x10000:signed));peakSamples++;offset=1;odd=null;if(peakSamples===200){peaks.push(Math.min(255,Math.round(peak/32768*255)));peak=0;peakSamples=0;}}for(;offset+1<data.length;offset+=2){peak=Math.max(peak,Math.abs(data.readInt16LE(offset)));peakSamples++;if(peakSamples===200){peaks.push(Math.min(255,Math.round(peak/32768*255)));peak=0;peakSamples=0;}}if(offset<data.length)odd=data[offset];});
   const timer=setTimeout(()=>child.kill('SIGKILL'),120000);timer.unref();
   try{await new Promise((res,rej)=>{child.on('error',rej);child.on('close',code=>code===0?res():rej(new Error('Audio fingerprint failed')));});}finally{clearTimeout(timer);if(this.child===child)this.child=null;}
   if(bytes<2||bytes%2)throw new Error('Invalid audio fingerprint');
   result={type:'decoded-pcm-sha256-v1',fingerprint:hash.digest('hex'),samples:bytes/2,durationSeconds:bytes/32000,sampleRate:16000};
   if(this.waveformRoot&&peaks.length<2_000_000){try{if(peakSamples)peaks.push(Math.min(255,Math.round(peak/32768*255)));const overview=new Uint8Array(Math.ceil(peaks.length/4));for(let i=0;i<peaks.length;i++)overview[Math.floor(i/4)]=Math.max(overview[Math.floor(i/4)],peaks[i]);const waveform={version:1,fingerprint:result.fingerprint,duration:result.durationSeconds,createdAt:new Date().toISOString(),levels:[{rate:20,bins:overview.length,peaks:Buffer.from(overview).toString('base64')},{rate:80,bins:peaks.length,peaks:Buffer.from(peaks).toString('base64')}]};const directory=resolve(this.waveformRoot,'waveforms');await mkdir(directory,{recursive:true});const path=resolve(directory,result.fingerprint+'.json');await writeFile(path+'.tmp',JSON.stringify(waveform));await rename(path+'.tmp',path);}catch{/* A cache failure cannot invalidate the audio identity. */}}
  }
  return result;
 }
 close(){this.closed=true;this.child?.kill('SIGKILL');}
}
