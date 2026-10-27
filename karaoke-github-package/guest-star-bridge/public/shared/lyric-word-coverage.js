// The aligner can omit rapid words without removing them from the transcription.
// Retain acoustic anchors where possible; mark inferred intervals as estimates.
const MIN_WORD=.015;
const key=text=>String(text||'').normalize('NFKD').replace(/\p{M}/gu,'').replace(/[^\p{L}\p{N}]/gu,'').toLowerCase();

function matches(tokens,words){
  const n=tokens.length,m=words.length;
  if(n*m>100_000)return [];
  const table=Array.from({length:n+1},()=>new Uint16Array(m+1));
  for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)
    table[i][j]=key(tokens[i])===key(words[j].text)?table[i+1][j+1]+1:Math.max(table[i+1][j],table[i][j+1]);
  const pairs=[];let i=0,j=0;
  while(i<n&&j<m){
    if(key(tokens[i])===key(words[j].text)){pairs.push([i,j]);i++;j++;}
    else if(table[i+1][j]>=table[i][j+1])i++;else j++;
  }
  return pairs;
}

function distribute(tokens,start,end){
  const weights=tokens.map(token=>Math.max(1,key(token).length)**.35);
  const total=weights.reduce((sum,value)=>sum+value,0);
  let cursor=start;
  return tokens.map((text,index)=>{
    const next=index===tokens.length-1?end:cursor+(end-start)*weights[index]/total;
    const word={text,start:cursor,end:next};cursor=next;return word;
  });
}

export function completeWordCoverage(segment){
  const original=Array.isArray(segment?.words)?segment.words:[];
  if(!original.length)return segment;
  const tokens=String(segment.text||'').trim().split(/\s+/u).filter(Boolean);
  if(!tokens.length)return segment;
  if(tokens.length===original.length&&tokens.every((token,i)=>key(token)===key(original[i].text)))return segment;
  const pairs=matches(tokens,original);
  const first=Math.max(Number(segment.start)||0,Number(original[0]?.start)||0);
  const last=Math.min(Number(segment.end)||first,Number(original.at(-1)?.end)||first);
  if(last<=first)return segment;
  if(last-first<tokens.length*.08||original.length<tokens.length*.25)
    return {...segment,words:distribute(tokens,Number(segment.start),Number(segment.end)),timingEstimated:true};
  if(!pairs.length)return {...segment,words:distribute(tokens,first,last),timingEstimated:true};
  const words=Array(tokens.length);
  for(const [i,j] of pairs)words[i]={...original[j],text:tokens[i]};
  const boundaries=[[-1,-1],...pairs,[tokens.length,original.length]];
  for(let p=1;p<boundaries.length;p++){
    const [left]=boundaries[p-1],[right]=boundaries[p];
    const count=right-left-1;if(!count)continue;
    const leftWord=left>=0?words[left]:null,rightWord=right<tokens.length?words[right]:null;
    let from=leftWord?leftWord.end:Math.max(Number(segment.start)||0,rightWord.start-Math.min(1.2,count*.34));
    let to=rightWord?rightWord.start:Math.min(Number(segment.end)||last,leftWord.end+Math.min(1.2,count*.34));
    if(to-from<count*MIN_WORD){
      if(leftWord&&rightWord){
        from=leftWord.start+(leftWord.end-leftWord.start)*.5;
        to=rightWord.end-(rightWord.end-rightWord.start)*.5;
        leftWord.end=from;rightWord.start=to;
      }else if(rightWord){from=Math.max(Number(segment.start)||0,rightWord.start-Math.max(.2,count*.12));to=rightWord.start;}
      else{to=Math.min(Number(segment.end)||last,leftWord.end+Math.max(.2,count*.12));from=leftWord.end;}
    }
    if(to-from<count*MIN_WORD)return {...segment,words:distribute(tokens,first,last),timingEstimated:true};
    distribute(tokens.slice(left+1,right),from,to).forEach((word,index)=>{words[left+1+index]=word;});
  }
  if(words.some((word,i)=>!word||word.end<=word.start||(i&&word.start<words[i-1].end-1e-6)))
    return {...segment,words:distribute(tokens,first,last),timingEstimated:true};
  return {...segment,words,timingEstimated:true};
}

export function completeLyricsWordCoverage(segments){
  return Array.isArray(segments)?segments.map(completeWordCoverage):[];
}
