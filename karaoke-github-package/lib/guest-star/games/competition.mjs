export function invariant(condition,code){if(!condition)throw Error(code);}
export function integer(value,min,max,code='INVALID_NUMBER'){invariant(Number.isSafeInteger(value)&&value>=min&&value<=max,code);return value;}
export function cleanText(value,max=160){invariant(typeof value==='string'&&value.trim().length>0&&value.length<=max,'INVALID_TEXT');return value.trim();}
export function normalizeAnswer(value){return String(value).normalize('NFKD').replace(/\p{M}/gu,'').toLocaleLowerCase('en').replace(/[^\p{L}\p{N}]+/gu,' ').trim();}
export function rankScores(subjects,events){
 const scores=new Map(subjects.map(subject=>[subject.id,{...subject,score:0,correct:0,responseMs:0}]));
 for(const e of events){const row=scores.get(e.subjectId);if(!row)continue;row.score+=e.value;if(e.reason==='answer.correct'){row.correct++;row.responseMs+=e.responseMs || 0;}}
 const sorted=[...scores.values()].sort((a,b)=>b.score-a.score || b.correct-a.correct || a.responseMs-b.responseMs || a.id.localeCompare(b.id));
 let rank=0,previous;return sorted.map((row,index)=>{const tie=previous&&previous.score===row.score&&previous.correct===row.correct&&previous.responseMs===row.responseMs;if(!tie)rank=index+1;previous=row;return {...row,rank,tied:Boolean(tie || sorted[index+1]&&sorted[index+1].score===row.score&&sorted[index+1].correct===row.correct&&sorted[index+1].responseMs===row.responseMs)};});
}
export function hybridScore(components,weights){
 invariant(Object.keys(weights).length>0&&Object.values(weights).every(v=>Number.isFinite(v)&&v>=0)&&Math.abs(Object.values(weights).reduce((a,b)=>a+b,0)-100)<1e-8,'INVALID_WEIGHTS');
 invariant(Object.keys(weights).every(k=>Number.isFinite(components[k])&&components[k]>=0&&components[k]<=100),'MISSING_MEASUREMENT');
 return Math.round(Object.entries(weights).reduce((sum,[k,w])=>sum+components[k]*w/100,0)*1000)/1000;
}
export function drawWithoutReplacement(values,count,random){
 invariant(values.length>=count&&new Set(values).size===values.length,'INSUFFICIENT_CANDIDATES');const remaining=[...values],draw=[];
 for(let i=0;i<count;i++){const index=random(remaining.length);integer(index,0,remaining.length-1,'INVALID_RANDOM');draw.push(remaining.splice(index,1)[0]);}return draw;
}
/** Unbiased random index supplied only by the authoritative runtime. */
export function secureRandom(max){integer(max,1,1000000);const ceiling=Math.floor(0x100000000/max)*max,array=new Uint32Array(1);do crypto.getRandomValues(array);while(array[0]>=ceiling);return array[0]%max;}
export function bracketEntrants(ids,random=secureRandom){const order=drawWithoutReplacement(ids,ids.length,random);const matches=[];for(let i=0;i<order.length;i+=2)matches.push({id:`match-${i/2+1}`,entrants:order.slice(i,i+2),winner:order[i+1]?null:order[i],bye:!order[i+1]});return matches;}
export function advanceBracket(matches){invariant(matches.every(m=>m.winner&&m.entrants.includes(m.winner)),'UNRESOLVED_MATCH');return matches.map(m=>m.winner);}
export function answerPoints(correct,elapsed,duration,config){return correct?config.points+Math.floor(config.speedBonus*Math.max(0,1-elapsed/duration)):-config.penalty;}
