import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,copyFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {RecordingIdentity} from '../src/recording-identity.mjs';
import {PlayerWaveformCache} from '../src/player-waveform.mjs';
import {LyricsExtractor,normalizeSegments,normalizeGeneratedSegments} from '../src/lyrics.mjs';
import {validateAlignment} from '../src/lyric-version-store.mjs';
import {activeWordIndex,constrainWord,normalizeWordIntervals,secondsToX,xToSeconds} from '../public/shared/lyric-timeline.js';
import {timedLyricsLines} from '../public/shared/timed-lyrics.js';

const ffmpeg=process.env.GUEST_STAR_TEST_FFMPEG || '/Applications/Guest Star Experience.app/Contents/Resources/bridge/stem-engine/node_modules/ffmpeg-static/ffmpeg';
const fixture=async fn=>{const root=await mkdtemp(join(tmpdir(),'gs-lyric-wave-'));try{await fn(root);}finally{await rm(root,{recursive:true,force:true});}};

test('timeline seeks forward/backward among thousands of words without accumulated clock state',()=>{
 const words=Array.from({length:5000},(_,i)=>({text:`w${i}`,start:i*.1,end:i*.1+.08}));
 assert.equal(activeWordIndex(words,400.03),4000);assert.equal(activeWordIndex(words,2.03),20);assert.equal(activeWordIndex(words,1000),-1);
 const cue=[{start:0,end:500,text:'long',words}];
 assert.equal(timedLyricsLines(cue,400.03).currentWord,'w4000');
 assert.equal(timedLyricsLines(cue,2.03).currentWord,'w20');
 assert.equal(timedLyricsLines(cue,2.03).words[21].state,'upcoming');
});
test('one word, gaps, pause, tempo and repeated seek use supplied playback time',()=>{
 const cue=[{start:0,end:4,text:'hola',words:[{text:'hola',start:1,end:2}]}];
 assert.equal(timedLyricsLines(cue,1.5).currentWord,'hola');
 assert.equal(timedLyricsLines(cue,1.5).words[0].progress,.5);
 assert.equal(timedLyricsLines(cue,1.5).currentWord,'hola');
 assert.equal(timedLyricsLines(cue,3).currentWord,'');
 assert.equal(timedLyricsLines(cue,.1).words[0].state,'upcoming');
});
test('drag start/end/whole word respects neighbors and inverse zoom mapping',()=>{
 const words=[{text:'a',start:0,end:1},{text:'b',start:1.2,end:2},{text:'c',start:2.4,end:3}];
 assert.equal(constrainWord(words,1,'start',-5,4).start,1);
 assert.equal(constrainWord(words,1,'end',5,4).end,2.4);
 assert.ok(Math.abs(constrainWord(words,1,'move',5,4).start-1.6)<1e-9);
 assert.equal(constrainWord(words,1,'move',5,4).end,2.4);
 for(const zoom of [.01,.1,1]){const scale={offset:12,secondsPerPixel:zoom};assert.ok(Math.abs(xToSeconds(secondsToX(25,scale),scale)-25)<1e-9);}
});
test('slightly negative timing normalizes at zero and impossible word intervals are omitted',()=>{
 assert.equal(normalizeSegments([{start:-.06,end:1,text:'sí'}])[0].start,0);
 assert.deepEqual(normalizeWordIntervals([{text:'a',start:-.04,end:.1},{text:'b',start:.05,end:.2}],0,.3).map(w=>[w.start,w.end]),[[0,.1],[.1,.2]]);
});
test('overlapping analysis words are repaired, while overlapping manual intervals are rejected',()=>{
 const generated=normalizeGeneratedSegments([{start:-.04,end:2,text:'a b',words:[{text:'a',start:-.04,end:1},{text:'b',start:.9,end:1.5}]}],2);
 assert.deepEqual(generated[0].words.map(w=>w.start),[0,1]);assert.equal(validateAlignment(generated,2),true);
 assert.throws(()=>validateAlignment([{start:0,end:2,text:'a b',words:[{text:'a',start:0,end:1},{text:'b',start:.9,end:1.5}]}],2),/Invalid word timing/);
});
test('manual word edit persists over reload and ordinary request does not transcribe again',async()=>fixture(async root=>{
 const file=join(root,'song.mp3');await writeFile(file,'authorized fixture');await writeFile(join(root,'song.lrc'),'[00:00.00]<00:00.00>hola <00:01.00>mundo\n');
 let transcribed=0;const settings={cacheRoot:join(root,'cache'),authorize:async p=>p,transcribe:async()=>{transcribed++;return {segments:[]};}};
 const engine=new LyricsExtractor(settings);const original=await engine.request(file);assert.equal(original.status,'ready');
 const edited=await engine.edit(file,{segments:[{start:0,end:8,text:'hola tierra',words:[{text:'hola',start:0,end:1},{text:'tierra',start:1,end:8}]}],expectedRevision:original.revision});assert.equal(edited.segments[0].words[1].text,'tierra');engine.close();
 const reopened=new LyricsExtractor(settings);const result=await reopened.request(file,{start:true});assert.equal(result.segments[0].words[1].text,'tierra');assert.equal(transcribed,0);reopened.close();
}));
test('audio and video use a persistent waveform by decoded recording, including a renamed audio file', {skip:spawnSync(ffmpeg,['-version'],{stdio:'ignore'}).status!==0},async()=>fixture(async root=>{
 const audio=join(root,'tone.wav'),renamed=join(root,'renamed.wav'),video=join(root,'tone.mp4');
 for(const [file,args] of [[audio,['-f','lavfi','-i','sine=frequency=440:duration=2','-ac','1','-ar','16000','-y',audio]],[video,['-f','lavfi','-i','color=c=black:s=160x90:d=2','-f','lavfi','-i','sine=frequency=440:duration=2','-c:v','mpeg4','-c:a','aac','-shortest','-y',video]]])assert.equal(spawnSync(ffmpeg,['-v','error',...args],{stdio:'ignore'}).status,0,file);
 await copyFile(audio,renamed);
 const identity=new RecordingIdentity({root:join(root,'lyrics'),ffmpegPath:ffmpeg}),wave=new PlayerWaveformCache({root:join(root,'waves'),ffmpegPath:ffmpeg,identityStore:identity});
 for(const file of [audio,video]){const first=await wave.request(file);assert.equal(first.status,'preparing');await wave.wait(first.fingerprint);const cached=await wave.request(file);assert.equal(cached.status,'ready');assert.equal(cached.levels.length,2);assert.ok(cached.levels[1].bins>100);}
 const renamedResult=await wave.request(renamed);assert.equal(renamedResult.status,'ready');assert.equal(renamedResult.cacheHit,true);
 const restarted=new PlayerWaveformCache({root:join(root,'waves'),ffmpegPath:ffmpeg,identityStore:identity});assert.equal((await restarted.request(audio)).status,'ready');identity.close();
}));
test('first fingerprint decode also writes waveform, avoiding a second complete audio pass', {skip:spawnSync(ffmpeg,['-version'],{stdio:'ignore'}).status!==0},async()=>fixture(async root=>{
 const audio=join(root,'one.wav');assert.equal(spawnSync(ffmpeg,['-v','error','-f','lavfi','-i','sine=frequency=200:duration=1','-y',audio],{stdio:'ignore'}).status,0);
 const identity=new RecordingIdentity({root:join(root,'ids'),ffmpegPath:ffmpeg});identity.waveformRoot=join(root,'waves');
 const signature=await identity.identify(audio);const wave=new PlayerWaveformCache({root:identity.waveformRoot,ffmpegPath:ffmpeg,identityStore:identity});
 assert.equal((await wave.request(audio)).status,'ready');assert.ok((await wave.read(signature.fingerprint)).levels[1].bins>0);identity.close();
}));
test('long recording overview remains compact while detailed zoom keeps 80 bins per second', {skip:spawnSync(ffmpeg,['-version'],{stdio:'ignore'}).status!==0},async()=>fixture(async root=>{
 const audio=join(root,'long.wav');assert.equal(spawnSync(ffmpeg,['-v','error','-f','lavfi','-i','sine=frequency=120:duration=61','-ac','1','-ar','16000','-y',audio],{stdio:'ignore'}).status,0);
 const identity=new RecordingIdentity({root:join(root,'ids'),ffmpegPath:ffmpeg});identity.waveformRoot=join(root,'waves');const sig=await identity.identify(audio);
 const waveform=await new PlayerWaveformCache({root:identity.waveformRoot,ffmpegPath:ffmpeg,identityStore:identity}).read(sig.fingerprint);
 assert.ok(waveform.levels[0].bins>=1200&&waveform.levels[0].bins<1300);assert.ok(waveform.levels[1].bins>=4800&&waveform.levels[1].bins<5000);
 identity.close();
}));
