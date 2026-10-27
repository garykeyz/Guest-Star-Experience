import {secondsToX} from './lyric-timeline.js';
export function decodeWaveform(data){
 if(data?.status!=='ready')return null;
 return {duration:data.duration,fingerprint:data.fingerprint,levels:data.levels.map(level=>({rate:level.rate,peaks:Uint8Array.from(atob(level.peaks),c=>c.charCodeAt(0))}))};
}
export function paintWaveform(canvas,waveform,{offset=0,span=waveform?.duration||1,playhead=0,words=[],selected=-1,active=-1}={}){
 const ctx=canvas?.getContext('2d');if(!ctx)return;
 const width=canvas.width,height=canvas.height;ctx.clearRect(0,0,width,height);ctx.fillStyle='#101928';ctx.fillRect(0,0,width,height);
 if(waveform){
  const targetRate=width/span,level=waveform.levels.find(l=>l.rate>=targetRate)||waveform.levels.at(-1);
  const bins=level?.peaks||[];ctx.fillStyle='#44bbcf';
  for(let x=0;x<width;x++){const t=offset+x*span/width;const index=Math.floor(t*level.rate);const amplitude=(bins[index]||0)/255;const h=Math.max(1,amplitude*height*.42);ctx.fillRect(x,height*.5-h,1,h*2);}
 }
 if(words.length){const scale={offset,secondsPerPixel:span/width};for(let i=0;i<words.length;i++){const word=words[i];if(word.end<offset||word.start>offset+span)continue;const left=secondsToX(word.start,scale),right=secondsToX(word.end,scale);ctx.fillStyle=i===selected?'rgba(255,205,69,.85)':i===active?'rgba(111,226,238,.9)':'rgba(255,255,255,.68)';ctx.fillRect(left,0,Math.max(2,right-left),29);ctx.fillStyle='#101928';ctx.font='15px system-ui';ctx.fillText(word.text,left+3,20,Math.max(0,right-left-6));}}
 const x=(playhead-offset)*width/span;if(x>=0&&x<=width){ctx.fillStyle='#ff5679';ctx.fillRect(Math.round(x),0,2,height);}
}
