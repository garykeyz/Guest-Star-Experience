import {timelineWords,activeWordIndex,adjustWordWithNeighbors,xToSeconds,MIN_WORD} from './shared/lyric-timeline.js';
import {plainLyrics,wordTextRanges,editPlainLyrics} from './shared/lyric-document.js';
import {decodeWaveform,paintWaveform} from './shared/waveform-view.js';

// One timed draft drives both the plain-text editor and the word blocks.
export function createVisualLyricEditor({document,request,getTime,isPlaying,onTogglePlay,onSeek,onChange,onSelect,status}){
 const $=selector=>document.querySelector(selector);
 const detail=$('#lyricVisualCanvas'),overview=$('#lyricOverviewCanvas'),zoom=$('#lyricVisualZoom'),scroll=$('#lyricVisualScroll'),follow=$('#lyricVisualFollow');
 let id='',draft=[],flat=[],duration=1,waveform=null,selected=-1,active=-1,drag=null,frame=0,lastTick=-Infinity,revision=0,generation=0,dirty=false,followHoldUntil=0;
 const span=()=>Math.max(.5,duration/Number(zoom.value||1));
 const offset=()=>Math.max(0,Math.min(Math.max(0,duration-span()),Number(scroll.value)||0));
 const scale=()=>({offset:offset(),secondsPerPixel:span()/detail.width});
 const markDirty=()=>{dirty=true;status('Cambios pendientes · pulsa Guardar.');};
 function paint(){
  paintWaveform(overview,waveform,{span:duration,playhead:-1});
  paintWaveform(detail,waveform,{offset:offset(),span:span(),playhead:-1,words:flat,selected,active});
  const window=$('#lyricOverviewWindow');window.style.left=`${offset()/duration*100}%`;window.style.width=`${Math.min(100,span()/duration*100)}%`;
 }
 function refresh(){flat=timelineWords(draft);active=activeWordIndex(flat,getTime());paint();}
 function updateScroll(){scroll.max=String(Math.max(0,duration-span()));scroll.value=String(Math.min(Number(scroll.value)||0,Number(scroll.max)));}
 function tick(now=performance.now()){
  if(!id)return;frame=requestAnimationFrame(tick);if(now-lastTick<50)return;lastTick=now;
  const time=Math.max(0,Number(getTime())||0),nextActive=activeWordIndex(flat,time);
  if(follow.checked&&!drag&&now>followHoldUntil&&isPlaying()&&span()<duration){
   const x=(time-offset())/span();
   if(x>.74||x<0){const target=Math.max(0,Math.min(duration-span(),time-span()*.28));scroll.value=String(offset()+(target-offset())*.18);paint();}
  }
  if(nextActive!==active){active=nextActive;paint();}
  $('#lyricOverviewPlayhead').style.left=`${Math.max(0,Math.min(100,time/duration*100))}%`;
  const detailX=(time-offset())/span()*100,playhead=$('#lyricDetailPlayhead');playhead.hidden=detailX<0||detailX>100;playhead.style.left=`${detailX}%`;
  $('#lyricVisualTime').textContent=`${Math.floor(time/60)}:${String(Math.floor(time%60)).padStart(2,'0')}`;
  $('#lyricEditorPlayPause').textContent=isPlaying()?'⏸ Pausar':'▶ Reproducir';
  $('#lyricEditorNow').textContent=active>=0?`Sonando: ${flat[active].text}`:'Escucha y corrige mientras suena';
  $('#lyricEditorNext').textContent=flat[active+1]?`Sigue: ${flat[active+1].text}`:'';
 }
 async function loadWaveform(trackId,token){
  for(let attempt=0;attempt<180&&token===generation;attempt++){
   try{const result=await request(`/api/player/waveform/${encodeURIComponent(trackId)}`);if(token!==generation)return;
    if(result.status==='ready'){waveform=decodeWaveform(result);paint();return;}
    if(result.status==='error'){status('La forma de onda no está disponible; la letra sigue editable.');return;}
   }catch{status('La forma de onda no está disponible; la letra sigue editable.');return;}
   await new Promise(done=>setTimeout(done,500));
  }
 }
 function start(trackId,lyrics){
  generation++;id=trackId;draft=structuredClone(lyrics.segments||[]).map(line=>({...line,words:line.words||[]}));
  revision=lyrics.revision||0;duration=Number(lyrics.recording?.durationSeconds)||Math.max(1,...draft.map(line=>line.end));
  waveform=null;selected=-1;drag=null;dirty=false;zoom.value='12';scroll.value='0';follow.checked=true;followHoldUntil=0;updateScroll();
  const first=timelineWords(draft)[0];if(first)scroll.value=String(Math.max(0,Math.min(duration-span(),first.start-span()*.15)));
  cancelAnimationFrame(frame);lastTick=-Infinity;refresh();tick();void loadWaveform(trackId,generation);
 }
 function close(){generation++;cancelAnimationFrame(frame);id='';drag=null;}
 function select(index,{fromText=false}={}){
  selected=index;const word=flat[index];
  if(word){followHoldUntil=performance.now()+10000;
   if(word.start<offset()||word.end>offset()+span()){scroll.value=String(Math.max(0,Math.min(duration-span(),word.start-span()*.35)));paint();}
   if(!fromText){const range=wordTextRanges(draft).find(item=>item.lineIndex===word.lineIndex&&item.wordIndex===word.wordIndex);if(range)onSelect(range);}
  }paint();
 }
 function selectAtText(position){
  const ranges=wordTextRanges(draft),range=ranges.find(item=>position>=item.start&&position<=item.end)||ranges.find(item=>item.start>position)||ranges.at(-1);
  if(range)select(flat.findIndex(word=>word.lineIndex===range.lineIndex&&word.wordIndex===range.wordIndex),{fromText:true});
 }
 function updateWord(index,word){const old=flat[index];if(!old)return;const line=draft[old.lineIndex];line.words[old.wordIndex]={text:word.text,start:word.start,end:word.end};line.text=line.words.map(item=>item.text).join(' ');refresh();}
 function changeText(text){const result=editPlainLyrics(draft,text,duration);draft=result.segments;selected=-1;refresh();markDirty();if(result.retimed)status('Texto actualizado. Revisa visualmente las palabras cuyo número cambió y pulsa Guardar.');}
 function syncText(){refresh();onChange(plainLyrics(draft));markDirty();}
 function hit(x){const time=xToSeconds(x,scale());let lo=0,hi=flat.length;while(lo<hi){const mid=(lo+hi)>>>1;if(flat[mid].start<=time)lo=mid+1;else hi=mid;}const index=lo-1,word=flat[index];if(!word||time>word.end)return null;const edge=Math.min(.15,span()*8/detail.width);return {index,mode:Math.abs(time-word.start)<edge?'start':Math.abs(time-word.end)<edge?'end':'move',time};}
 detail.addEventListener('pointerdown',event=>{
  if(!id)return;const rect=detail.getBoundingClientRect(),x=(event.clientX-rect.left)*detail.width/rect.width,found=hit(x);
  if(!found){select(-1);followHoldUntil=performance.now()+8000;void onSeek(xToSeconds(x,scale()));return;}
  select(found.index);drag={...found,original:{...flat[found.index]},reference:flat.map(word=>({...word})),changed:false};detail.setPointerCapture(event.pointerId);
 });
 detail.addEventListener('pointermove',event=>{
  if(!drag)return;const rect=detail.getBoundingClientRect(),x=(event.clientX-rect.left)*detail.width/rect.width,delta=xToSeconds(x,scale())-drag.time;
  const current=flat[drag.index],line=draft[drag.original.lineIndex];if(!current||!line)return;
  const change=adjustWordWithNeighbors(drag.reference,drag.index,drag.mode,delta,{min:line.start,max:line.end});if(!change)return;
  const {word,previous,next}=change;
  if(word.start!==current.start||word.end!==current.end){
   for(const item of [previous,word,next])if(item)draft[item.lineIndex].words[item.wordIndex]={text:item.text,start:item.start,end:item.end};
   refresh();drag.changed=true;
  }
 });
 const endDrag=()=>{if(!drag)return;const changed=drag.changed;drag=null;if(changed)markDirty();};
 detail.addEventListener('pointerup',endDrag);detail.addEventListener('pointercancel',endDrag);
 overview.addEventListener('pointerdown',event=>{if(!id)return;const rect=overview.getBoundingClientRect(),time=Math.max(0,Math.min(duration,(event.clientX-rect.left)/rect.width*duration));scroll.value=String(Math.max(0,Math.min(duration-span(),time-span()*.35)));followHoldUntil=performance.now()+8000;paint();void onSeek(time);});
 zoom.addEventListener('input',()=>{updateScroll();followHoldUntil=performance.now()+8000;paint();});
 scroll.addEventListener('input',()=>{followHoldUntil=performance.now()+10000;paint();});
 $('#lyricEditorPlayPause').addEventListener('click',()=>{void onTogglePlay();});
 $('#lyricVisualDelete').addEventListener('click',()=>{const word=flat[selected];if(!word)return;const line=draft[word.lineIndex];line.words.splice(word.wordIndex,1);line.text=line.words.map(item=>item.text).join(' ');if(!line.words.length)draft.splice(word.lineIndex,1);selected=-1;syncText();});
 $('#lyricVisualAdd').addEventListener('click',()=>{if(!id)return;const time=Math.min(duration-.2,Math.max(0,getTime())),at=flat.findIndex(word=>word.start>time),next=at<0?null:flat[at],previous=at<=0?null:flat[at-1],start=Math.max(previous?.end||0,time),end=Math.min(next?.start||duration,start+.4);if(end-start<MIN_WORD){status('No hay espacio para una palabra aquí.');return;}const lineIndex=previous?.lineIndex??next?.lineIndex??0;if(!draft.length)draft.push({start:0,end:duration,text:'',words:[]});const line=draft[lineIndex];line.words.push({text:'Nueva',start,end});line.words.sort((a,b)=>a.start-b.start);line.text=line.words.map(word=>word.text).join(' ');line.start=Math.min(line.start,start);line.end=Math.max(line.end,end);syncText();selected=flat.findIndex(word=>word.start===start&&word.text==='Nueva');paint();});
 $('#lyricVisualSplit').addEventListener('click',()=>{const word=flat[selected];if(!word||word.end-word.start<MIN_WORD*2)return;const mid=(word.start+word.end)/2,line=draft[word.lineIndex],point=Math.ceil(word.text.length/2),a=word.text.slice(0,point),b=word.text.slice(point);if(!b)return;line.words.splice(word.wordIndex,1,{text:a,start:word.start,end:mid},{text:b,start:mid,end:word.end});line.text=line.words.map(item=>item.text).join(' ');syncText();});
 $('#lyricVisualMerge').addEventListener('click',()=>{const word=flat[selected],next=flat[selected+1];if(!word||!next||word.lineIndex!==next.lineIndex)return;const line=draft[word.lineIndex];line.words.splice(word.wordIndex,2,{text:`${word.text} ${next.text}`,start:word.start,end:next.end});line.text=line.words.map(item=>item.text).join(' ');syncText();});
 $('#lyricVisualSplitLine').addEventListener('click',()=>{const word=flat[selected];if(!word||word.wordIndex===0)return;const line=draft[word.lineIndex],before=line.words.slice(0,word.wordIndex),after=line.words.slice(word.wordIndex);draft.splice(word.lineIndex,1,{start:line.start,end:before.at(-1).end,text:before.map(item=>item.text).join(' '),words:before},{start:after[0].start,end:line.end,text:after.map(item=>item.text).join(' '),words:after});syncText();});
 $('#lyricVisualMergeLine').addEventListener('click',()=>{const word=flat[selected];if(!word||word.lineIndex+1>=draft.length)return;const line=draft[word.lineIndex],next=draft[word.lineIndex+1],joined=[...line.words,...(next.words||[])];draft.splice(word.lineIndex,2,{start:line.start,end:next.end,text:joined.map(item=>item.text).join(' '),words:joined});syncText();});
 async function save(){if(!id)throw new Error('Selecciona una pista.');return await request(`/api/player/lyrics/${encodeURIComponent(id)}/edit`,{method:'POST',body:JSON.stringify({segments:structuredClone(draft),expectedRevision:revision,reviewedAll:$('#lyricEditorReviewed').checked})});}
 function acceptSaved(result){revision=result.revision||revision;draft=structuredClone(result.segments||draft);dirty=false;refresh();}
 return {start,close,save,acceptSaved,changeText,selectAtText,get draft(){return draft;},get dirty(){return dirty;},get text(){return plainLyrics(draft);}};
}
