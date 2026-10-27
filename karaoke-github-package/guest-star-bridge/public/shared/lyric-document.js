// Plain-text editing is a view of one timed document. Equal word counts keep
// every boundary; structural edits only redistribute time inside affected lines.
export function plainLyrics(segments=[]){return segments.map(line=>line.words?.length?line.words.map(word=>word.text).join(' '):line.text||'').join('\n');}

export function wordTextRanges(segments=[]){
 const ranges=[];let cursor=0;
 segments.forEach((line,lineIndex)=>{
  (line.words||[]).forEach((word,wordIndex)=>{const start=cursor;cursor+=word.text.length;ranges.push({lineIndex,wordIndex,start,end:cursor});if(wordIndex<line.words.length-1)cursor++;});
  if(!line.words?.length)cursor+=(line.text||'').length;
  if(lineIndex<segments.length-1)cursor++;
 });
 return ranges;
}

function distribute(tokens,start,end){
 const length=Math.max(.02,end-start),step=length/tokens.length;
 return tokens.map((text,index)=>({text,start:+(start+index*step).toFixed(4),end:+(index===tokens.length-1?end:start+(index+1)*step).toFixed(4)}));
}

export function editPlainLyrics(segments,text,duration){
 const lines=String(text??'').replace(/\r\n?/g,'\n').split('\n');
 while(lines.length>1&&!lines.at(-1).trim())lines.pop();
 const source=structuredClone(segments||[]),changedStructure=lines.length!==source.length;
 const maximum=Math.max(Number(duration)||0,source.at(-1)?.end||0,1);
 const result=lines.map((raw,index)=>{
  const tokens=raw.match(/\S+/gu)||[];
  const previous=source[index];
  const start=changedStructure?maximum*index/lines.length:Math.max(0,Number(previous?.start)||0);
  const end=changedStructure?maximum*(index+1)/lines.length:Math.max(start+.02,Number(previous?.end)||maximum);
  const oldWords=previous?.words||[];
  const words=tokens.length===oldWords.length?oldWords.map((word,i)=>({...word,text:tokens[i]})):tokens.length?distribute(tokens,start,end):[];
  return {start,end,text:tokens.join(' '),words};
 }).filter(line=>line.text);
 return {segments:result,retimed:changedStructure||result.some((line,index)=>line.words.length!==(source[index]?.words||[]).length)};
}
