import {readFile,mkdir,writeFile,rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
export function validateAlignment(segments,duration){
 if(!Array.isArray(segments)||!segments.length||segments.length>2000)throw new Error('A timed lyric is required');
 let previous=-1;
 for(const s of segments){if(!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<0||s.end<=s.start||s.start<previous-1e-6||(duration>0&&s.end>duration+.1)||!String(s.text||'').trim())throw new Error('Invalid lyric timing');previous=s.end;
  let wordEnd=s.start;
  for(const w of s.words||[]){if(!Number.isFinite(w.start)||!Number.isFinite(w.end)||w.start<wordEnd-1e-6||w.end<=w.start||w.end>s.end+1e-6||w.start<s.start-1e-6||!String(w.text||'').trim())throw new Error('Invalid word timing');wordEnd=w.end;}
 }
 return true;
}
export function lyricQuality(v){const level={AUTOMATIC:0,EXTERNALLY_VALIDATED:1,PARTIALLY_HUMAN_REVIEWED:2,HUMAN_REVIEWED:3,HIGH_CONFIDENCE:4}[v.humanReviewLevel]||0;return level*100+Math.min(1,Number(v.reviewCoverage)||0)*20+Math.min(5,v.independentReviews||0)*5;}
export class LyricVersionStore {
 constructor(root){this.root=root;this.memory=new Map();this.locks=new Map();}
 path(key){if(!/^[a-f0-9]{64}$/.test(key))throw new Error('Invalid lyric key');return resolve(this.root||'.','versions',key+'.json');}
 async read(key){if(this.memory.has(key))return structuredClone(this.memory.get(key));try{const data=JSON.parse(await readFile(this.path(key),'utf8'));if(data.key===key&&Array.isArray(data.versions)){this.memory.set(key,data);return structuredClone(data);}}catch{}return {key,revision:0,selectedVersionId:'',versions:[]};}
 async readVersion(key,v){if(!v)return null;if(v.segments)return v;if(!this.root)return this.memory.get(key)?.contents?.[v.versionId]||null;return JSON.parse(await readFile(resolve(this.root,'versions',key,v.versionId+'.json'),'utf8'));}
 async write(key,data){if(this.root){
  await mkdir(resolve(this.root,'versions',key),{recursive:true});
  data.versions=await Promise.all(data.versions.map(async v=>{if(!v.segments)return v;const path=resolve(this.root,'versions',key,v.versionId+'.json');try{await writeFile(path,JSON.stringify(v),{flag:'wx'});}catch(e){if(e.code!=='EEXIST')throw e;}const {segments,lyricsText,lyricsAlignment,...meta}=v;return meta;}));
await mkdir(resolve(this.root,'versions'),{recursive:true});const path=this.path(key);await writeFile(path+'.tmp',JSON.stringify(data));await rename(path+'.tmp',path);}if(this.memory.size>64)this.memory.delete(this.memory.keys().next().value);this.memory.set(key,structuredClone(data));}
 async selected(key){const d=await this.read(key),v=d.versions.find(v=>v.versionId===d.selectedVersionId);return v?{...await this.readVersion(key,v),revision:d.revision,historyCount:d.versions.length}:null;}
 async history(key){const d=await this.read(key);return {revision:d.revision,selectedVersionId:d.selectedVersionId,versions:d.versions.map(({segments,lyricsText,lyricsAlignment,...v})=>v)};}
 async serial(key,fn){const old=this.locks.get(key)||Promise.resolve();const next=old.catch(()=>{}).then(fn);this.locks.set(key,next);try{return await next;}finally{if(this.locks.get(key)===next)this.locks.delete(key);}}
 async append(key,input,expectedRevision,explicit=false){return this.serial(key,async()=>{
  const d=await this.read(key);if(expectedRevision!==undefined&&Number(expectedRevision)!==d.revision){const error=new Error('Lyrics changed in another editor. Reload before saving.');error.status=409;throw error;}
  const segments=structuredClone(input.segments);validateAlignment(segments,input.recording?.durationSeconds);
  const contentHash=createHash('sha256').update(JSON.stringify(segments)).digest('hex');const prior=d.versions.find(v=>v.contentHash===contentHash&&v.humanReviewLevel===(input.humanReviewLevel||'AUTOMATIC'));
  if(prior && !explicit)return this.selected(key);
  const textLines=segments.map((s,i)=>({id:`line-${i}`,text:s.text,words:s.words?.map(w=>w.text)}));
  const lyricsText=JSON.stringify(input.lyricsText?.lines)===JSON.stringify(textLines)?input.lyricsText:{textVersionId:randomUUID(),lines:textLines};
  const lyricsAlignment={alignmentVersionId:randomUUID(),recording:input.recording,method:input.alignmentMethod||'line-timestamps',estimated:input.estimated!==false,lines:segments.map((s,i)=>({lineId:`line-${i}`,lineStart:s.start,lineEnd:s.end,words:s.words?.map(w=>({start:w.start,end:w.end}))}))};
  if(input.lyricsAlignment && JSON.stringify({...input.lyricsAlignment,alignmentVersionId:''})===JSON.stringify({...lyricsAlignment,alignmentVersionId:''}))lyricsAlignment.alignmentVersionId=input.lyricsAlignment.alignmentVersionId;
  const v={versionId:randomUUID(),parentVersionId:d.selectedVersionId,contentHash,createdAt:new Date().toISOString(),provider:input.provider||'local',validationEvidence:input.validationEvidence||[],humanReviewLevel:input.humanReviewLevel||'AUTOMATIC',reviewCoverage:input.reviewCoverage||0,independentReviews:input.independentReviews||0,language:input.language||'auto',recording:input.recording,alignmentMethod:lyricsAlignment.method,estimated:input.estimated!==false,segments,lyricsText,lyricsAlignment,readiness:'READY_FOR_KARAOKE'};
  const current=d.versions.find(v=>v.versionId===d.selectedVersionId);d.versions.push(v);d.revision++;
  if(explicit||!current||lyricQuality(v)>lyricQuality(current))d.selectedVersionId=v.versionId;
  await this.write(key,d);return this.selected(key);
 });}
 async restore(key,id,expected){return this.serial(key,async()=>{const d=await this.read(key);if(d.revision!==Number(expected)){const error=new Error('Lyrics revision conflict');error.status=409;throw error;}if(!d.versions.some(v=>v.versionId===id))throw new Error('Version not found');d.selectedVersionId=id;d.revision++;await this.write(key,d);return this.selected(key);});}
}
