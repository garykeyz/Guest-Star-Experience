import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir,setPriority} from 'node:os';
import {spawn} from 'node:child_process';
import {completeWordCoverage} from '../public/shared/lyric-word-coverage.js';
// Align only requested sections against the media's actual decoded audio.
export async function runForcedAlignment(file,{segments,language='auto',ffmpegPath,runnerPath,modelPath,signal}){
 const directory=await mkdtemp(join(tmpdir(),'gs-align-'));const result=[];
 try{for(let i=0;i<segments.length;i++){
  if(signal?.aborted)throw new Error('Cancelled');const segment=segments[i];
  if(segment.end-segment.start>30)throw new Error('Split long lines before word alignment');
  const text=join(directory,'text.txt');await writeFile(text,' '+segment.text);
  const decoder=spawn(ffmpegPath,['-v','error','-nostdin','-threads','1','-filter_threads','1','-ss',String(segment.start),'-i',file,'-vn','-t',String(segment.end-segment.start),'-ac','1','-ar','16000','-f','f32le','pipe:1'],{stdio:['ignore','pipe','ignore']});
  const runner=spawn(runnerPath,[modelPath,text,language||'auto'],{stdio:['pipe','pipe','ignore'],env:{...process.env,VECLIB_MAXIMUM_THREADS:'2'}});
  try{setPriority(runner.pid,15);setPriority(decoder.pid,15);}catch{}
  decoder.stdout.pipe(runner.stdin);runner.stdin.on('error',()=>{});let output='';runner.stdout.on('data',data=>{output+=data.toString();if(output.length>200000)runner.kill('SIGKILL');});
  const kill=()=>{decoder.kill('SIGKILL');runner.kill('SIGKILL');};const timer=setTimeout(kill,60000);timer.unref();signal?.addEventListener('abort',kill,{once:true});
  const finished=child=>new Promise((res,rej)=>{child.on('error',rej);child.on('close',code=>code===0?res():rej(new Error('Alignment failed')));});
  try{await Promise.all([finished(decoder),finished(runner)]);const aligned=JSON.parse(output);if(!aligned.words?.length)throw new Error('No acoustic alignment');
   const words=aligned.words.map(w=>({...w,start:segment.start+w.start,end:Math.min(segment.end,segment.start+w.end)})).filter(w=>w.end>w.start);
   result.push(completeWordCoverage({...segment,words}));
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',kill);kill();}
 }}finally{await rm(directory,{recursive:true,force:true});}
 return result;
}
