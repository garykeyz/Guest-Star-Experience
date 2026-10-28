export const MIN_WORD = 0.02;
export function secondsToX(seconds,{offset=0,secondsPerPixel=0.02}={}){return (seconds-offset)/secondsPerPixel;}
export function xToSeconds(x,{offset=0,secondsPerPixel=0.02}={}){return Math.max(0,offset+x*secondsPerPixel);}
export function timelineWords(segments=[]){return segments.flatMap((line,lineIndex)=>(line.words||[]).map((word,wordIndex)=>({...word,lineIndex,wordIndex}))).sort((a,b)=>a.start-b.start);}
export function activeWordIndex(words,time){let lo=0,hi=words.length;while(lo<hi){const mid=(lo+hi)>>>1;if(words[mid].start<=time)lo=mid+1;else hi=mid;}const i=lo-1;return i>=0&&time<words[i].end?i:-1;}
export function constrainWord(words,index,mode,delta,duration,{min=0,max=duration}={}){
 const w=words[index];if(!w)return null;
 const lower=Math.max(min,index?words[index-1].end:0),upper=Math.min(max,index+1<words.length?words[index+1].start:duration);
 if(upper-lower<MIN_WORD)return {...w};
 let start=w.start,end=w.end;
 if(mode==='start')start=Math.min(end-MIN_WORD,Math.max(lower,start+delta));
 else if(mode==='end')end=Math.max(start+MIN_WORD,Math.min(upper,end+delta));
 else{const length=end-start;start=Math.max(lower,Math.min(upper-length,start+delta));end=start+length;}
 return {...w,start,end};
}
export function adjustWordWithNeighbors(words,index,mode,delta,{min=0,max=Infinity}={}){
 const word=words[index];if(!word)return null;
 const previous=words[index-1]?.lineIndex===word.lineIndex?words[index-1]:null;
 const next=words[index+1]?.lineIndex===word.lineIndex?words[index+1]:null;
 let start=word.start,end=word.end,prior=null,after=null;
 if(mode==='start'){
  start=Math.max(min,previous?previous.start+MIN_WORD:min,Math.min(end-MIN_WORD,start+delta));
  if(previous&&start<previous.end)prior={...previous,end:start};
 }else if(mode==='end'){
  end=Math.min(max,next?next.end-MIN_WORD:max,Math.max(start+MIN_WORD,end+delta));
  if(next&&end>next.start)after={...next,start:end};
 }else{
  const length=end-start;
  if(delta>=0){const upper=Math.max(start,Math.min(max-length,next?next.end-MIN_WORD-length:max-length));start=Math.min(upper,start+delta);end=start+length;if(next&&end>next.start)after={...next,start:end};}
  else{start=Math.max(min,previous?previous.start+MIN_WORD:min,start+delta);end=start+length;if(previous&&start<previous.end)prior={...previous,end:start};}
 }
 return {word:{...word,start,end},previous:prior,next:after};
}
export function normalizeWordIntervals(words,start,end){
 const sorted=(words||[]).map(w=>({text:String(w.text||'').trim(),start:Number(w.start),end:Number(w.end)})).filter(w=>w.text&&Number.isFinite(w.start)&&Number.isFinite(w.end)).sort((a,b)=>a.start-b.start);
 let cursor=Math.max(0,start);
 return sorted.map(w=>{let s=Math.max(cursor,Math.max(0,w.start)),e=Math.max(s+MIN_WORD,w.end);e=Math.min(end,e);if(e-s<MIN_WORD-1e-6)return null;cursor=e;return {text:w.text,start:s,end:e};}).filter(Boolean);
}
