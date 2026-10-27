const TABLES=`CREATE TABLE IF NOT EXISTS guest_star_lyric_versions(version_id TEXT PRIMARY KEY,recording_id TEXT NOT NULL,duration REAL NOT NULL,author_id TEXT NOT NULL,data_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS guest_star_lyric_recording ON guest_star_lyric_versions(recording_id,duration);
CREATE TABLE IF NOT EXISTS guest_star_lyric_reviews(version_id TEXT NOT NULL,reviewer_id TEXT NOT NULL,approved INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(version_id,reviewer_id));`;
function checkRecording(r){if(!r||r.type!=='decoded-pcm-sha256-v1'||!/^[a-f0-9]{64}$/.test(r.fingerprint)||!Number.isFinite(r.durationSeconds)||r.durationSeconds<=0||r.durationSeconds>1800)throw new Error('INVALID_RECORDING');return {type:r.type,fingerprint:r.fingerprint,durationSeconds:r.durationSeconds,samples:r.samples,sampleRate:16000,...(/^[a-f0-9]{64}$/.test(r.workKey||'')?{workKey:r.workKey}:{})};}
export function validateSharedSegments(segments,duration){
 if(!Array.isArray(segments)||!segments.length||segments.length>2000)throw new Error('INVALID_TIMED_LYRICS');let prior=-1,total=0;
 return segments.map(s=>{if(!Number.isFinite(s.start)||!Number.isFinite(s.end)||s.start<prior||s.start<0||s.end<=s.start||s.end>duration+.03)throw new Error('INVALID_ALIGNMENT');prior=s.start;
 const text=String(s.text||'').trim();total+=text.length;if(!text||text.length>1000||total>80000)throw new Error('LYRICS_TOO_LARGE');let end=s.start;
 const words=(s.words||[]).map(w=>{if(!Number.isFinite(w.start)||!Number.isFinite(w.end)||w.start<end-.02||w.start<s.start-.02||w.end>s.end+.02||w.end<=w.start)throw new Error('INVALID_WORD_ALIGNMENT');end=w.end;return {text:String(w.text||'').slice(0,100),start:w.start,end:w.end};});
 return {start:s.start,end:s.end,text,...(words.length?{words}:{})};});
}
export function sharedLyricScore(v,reviews=[]){
 // An edit count has no role. A self-declared extensive review is useful,
 // but only independent agreement can promote it to high confidence.
 const levels={AUTOMATIC:0,EXTERNALLY_VALIDATED:1,PARTIALLY_HUMAN_REVIEWED:2,HUMAN_REVIEWED:3,HIGH_CONFIDENCE:3};
 const approved=reviews.filter(r=>r.approved===1&&r.reviewer_id!==v.authorId).length;
 const rejected=reviews.filter(r=>r.approved===0&&r.reviewer_id!==v.authorId).length;
 return (levels[v.humanReviewLevel]||0)*100+Math.min(1,v.reviewCoverage||0)*20+Math.min(3,approved)*25-Math.min(5,rejected)*50;
}
async function hash(text){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');}
export async function handleSharedLyrics(db,action,body,userId){
 await db.exec(TABLES);const author=await hash('Guest-Star-lyrics-user:'+String(userId)),recording=checkRecording(body.recording),now=new Date().toISOString();
 if(action==='lyricsLookup'){
  const rows=(await db.prepare('SELECT data_json,author_id,version_id FROM guest_star_lyric_versions WHERE recording_id=? AND ABS(duration-?)<0.02 ORDER BY created_at DESC LIMIT 40').bind(recording.fingerprint,recording.durationSeconds).all()).results||[];
  const ranked=[];for(const row of rows){try{const v=JSON.parse(row.data_json);validateSharedSegments(v.segments,recording.durationSeconds);const reviews=(await db.prepare('SELECT reviewer_id,approved FROM guest_star_lyric_reviews WHERE version_id=?').bind(row.version_id).all()).results||[];ranked.push({version:v,score:sharedLyricScore({...v,authorId:row.author_id},reviews)});}catch{}}
  ranked.sort((a,b)=>b.score-a.score);let textCandidate=null;
  if(!ranked.length&&recording.workKey){const alternatives=(await db.prepare("SELECT data_json FROM guest_star_lyric_versions WHERE json_extract(data_json,'$.recording.workKey')=? ORDER BY created_at DESC LIMIT 10").bind(recording.workKey).all()).results||[];
    const versions=alternatives.map(row=>JSON.parse(row.data_json)).filter(v=>['HUMAN_REVIEWED','PARTIALLY_HUMAN_REVIEWED'].includes(v.humanReviewLevel)).sort((a,b)=>sharedLyricScore(b)-sharedLyricScore(a));
    if(versions.length){const v=versions[0];textCandidate={versionId:v.versionId,text:v.segments.map(s=>s.text).join('\n'),sourceDuration:v.recording.durationSeconds,humanReviewLevel:v.humanReviewLevel,requiresHostReview:true,alignmentCompatible:false};}
  }
  return {ok:true,version:ranked[0]?.version||null,compatible:!!ranked.length,textCandidate};
 }
 if(action==='lyricsPublish'){
  if(!body.rights?.allow||!['own','public-domain','licensed'].includes(body.rights.kind)||!String(body.rights.basis||'').trim())throw new Error('SHARING_RIGHTS_REQUIRED');
  const segments=validateSharedSegments(body.segments,recording.durationSeconds),id=crypto.randomUUID();
  const level=['AUTOMATIC','EXTERNALLY_VALIDATED','PARTIALLY_HUMAN_REVIEWED','HUMAN_REVIEWED'].includes(body.humanReviewLevel)?body.humanReviewLevel:'AUTOMATIC';
  const version={versionId:id,recording,segments,provider:'guest-star-shared',language:/^[a-z]{2,3}$/.test(body.language||'')?body.language:'auto',createdAt:now,humanReviewLevel:level,reviewCoverage:Math.max(0,Math.min(1,Number(body.reviewCoverage)||0)),alignmentMethod:String(body.alignmentMethod||'line-timestamps').slice(0,100),estimated:true,rights:{kind:body.rights.kind,basis:String(body.rights.basis).slice(0,500),allow:true},readiness:'READY_FOR_KARAOKE'};
  await db.prepare('INSERT INTO guest_star_lyric_versions VALUES(?,?,?,?,?,?)').bind(id,recording.fingerprint,recording.durationSeconds,author,JSON.stringify(version),now).run();return {ok:true,versionId:id};
 }
 if(action==='lyricsReview'){
  const id=String(body.versionId||'');const existing=await db.prepare('SELECT version_id FROM guest_star_lyric_versions WHERE version_id=? AND recording_id=?').bind(id,recording.fingerprint).first();if(!existing)throw new Error('VERSION_NOT_FOUND');
  await db.prepare('INSERT INTO guest_star_lyric_reviews VALUES(?,?,?,?) ON CONFLICT(version_id,reviewer_id) DO UPDATE SET approved=excluded.approved,created_at=excluded.created_at').bind(id,author,body.approved===true?1:0,now).run();return {ok:true};
 }
 throw new Error('INVALID_LYRICS_ACTION');
}
