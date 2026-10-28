import {invariant,integer,cleanText,normalizeAnswer,answerPoints} from './competition.mjs';
const common=config=>({roundSeconds:integer(config.roundSeconds ?? 30,5,600),maxParticipants:integer(config.maxParticipants ?? 250,2,250),points:integer(config.points ?? 100,0,10000),penalty:integer(config.penalty ?? 0,0,10000),speedBonus:integer(config.speedBonus ?? 0,0,10000),mode:['individual','team','head-to-head','tournament'].includes(config.mode)?config.mode:'individual',podium:integer(config.podium ?? 3,1,3)});
function questionConfig(input,{media=false,clues=false}={}){
 const c=common(input);invariant(Array.isArray(input.questions)&&input.questions.length>=1&&input.questions.length<=20,'QUESTIONS_REQUIRED');
 c.questions=input.questions.map(q=>{
  const prompt=cleanText(q.prompt,1000),options=Array.isArray(q.options)?q.options.map(o=>cleanText(o,240)):[];
  invariant(options.length===0 || options.length>=2&&options.length<=6,'INVALID_OPTIONS');invariant(new Set(options.map(normalizeAnswer)).size===options.length,'DUPLICATE_OPTIONS');
  const answer=options.length?integer(q.correctIndex ?? q.answer,0,options.length-1):cleanText(q.answer,240);
  const result={prompt,options,answer,...(options.length?{correctIndex:answer}:{})};
  if(media){invariant(q.media && q.media.authorized===true && typeof q.media.id==='string','AUTHORIZED_MEDIA_REQUIRED');result.media={id:cleanText(q.media.id),startSeconds:integer(q.media.startSeconds ?? 0,0,86400),durationSeconds:integer(q.media.durationSeconds ?? 15,1,120),authorized:true};}
  if(clues){invariant(Array.isArray(q.clues)&&q.clues.length>0&&q.clues.length<=6,'CLUES_REQUIRED');result.clues=q.clues.map(v=>cleanText(v,500));}
  return result;
 });
 return c;
}
const questionRules={
 prepare(session,index){const q=session.config.questions[index];return {prompt:q.prompt,options:q.options,clues:q.clues?[q.clues[0]]:undefined,media:q.media || null};},
 evaluate(session,round,answer,now){const q=session.config.questions[round.index];if(q.options.length)integer(answer.option,0,q.options.length-1,'INVALID_ANSWER');else cleanText(answer.text,240);const correct=q.options.length?answer.option===q.answer:normalizeAnswer(answer.text)===normalizeAnswer(q.answer);const elapsed=now-round.startedAt;return {correct,value:answerPoints(correct,elapsed,round.durationMs,session.config),responseMs:elapsed,reason:correct?'answer.correct':'answer.incorrect'};},
 rounds:config=>config.questions.length,
 reveal:(session,index)=>session.config.questions[index].answer
};
function questionGame(id,name,options={}){return {id,version:'1.0.0',name,description:name,capabilities:options.media?['media.fragment']:[],kind:'question',configSchema:{type:'object',required:['questions'],properties:{questions:{type:'array',minItems:1,maxItems:20},roundSeconds:{type:'integer',minimum:5,maximum:600},mode:{enum:['individual','team','head-to-head','tournament']}}},validate:config=>{const result=questionConfig(config,options);if(options.team)result.mode='team';return result;},...questionRules};}
function performanceConfig(input){
 const c=common(input);c.finalScoring=input.finalScoring==='cumulative'?'cumulative':'final-only';c.avoidRepeatedPairs=input.avoidRepeatedPairs!==false;c.roundCount=integer(input.roundCount ?? 2,1,10);c.finalists=integer(input.finalists ?? 3,1,20);c.weights=input.weights || {audience:100};
 invariant(Object.keys(c.weights).every(k=>['audience','jury','applause'].includes(k))&&Object.values(c.weights).every(w=>Number.isFinite(w)&&w>=0)&&Object.values(c.weights).reduce((a,b)=>a+b,0)===100,'INVALID_WEIGHTS');
 c.votingScale=integer(input.votingScale ?? 5,2,10);c.excludeContestantsFromVoting=true;c.elimination=input.elimination===true;c.totalMinutes=integer(input.totalMinutes ?? 120,15,240);c.registrationLeadMinutes=integer(input.registrationLeadMinutes ?? 30,0,120);
 c.songs=(input.songs || []).map(s=>cleanText(s));invariant(new Set(c.songs).size===c.songs.length,'DUPLICATE_SONGS');c.excludedPairs=(input.excludedPairs || []).map(pair=>{invariant(Array.isArray(pair)&&pair.length===2&&pair[0]!==pair[1],'INVALID_PAIR_RESTRICTION');return pair.map(v=>cleanText(v));});return c;
}
const performanceRules={rounds:c=>c.roundCount,prepare:(session,index)=>({prompt:`${session.definition.name} · ${index+1}`,options:[],performers:session.participants.filter(p=>p.status==='active'&&(!session.finalists || session.finalists.includes(session.config.mode==='team'?p.teamId:p.id))).map(p=>({id:p.id,name:p.name})),order:session.performanceOrder || []}),evaluate(){throw Error('PERFORMANCE_REQUIRES_EVALUATION');},reveal:()=>null};
const performanceGame=(id,name,extra={})=>({id,version:'1.0.0',name,description:name,kind:'performance',capabilities:['media.performance'],configSchema:{type:'object',properties:{roundCount:{type:'integer',minimum:1,maximum:10},weights:{type:'object'},votingScale:{type:'integer',minimum:2,maximum:10}}},validate:performanceConfig,...performanceRules,...extra});
const modules=[
 questionGame('music-trivia','Music Trivia'),questionGame('guess-song','Guess the Song',{media:true}),questionGame('team-battle','Team Battle',{team:true}),questionGame('finish-lyrics','Finish the Lyrics'),questionGame('mystery-singer','Mystery Singer',{clues:true}),
 performanceGame('karaoke-battle','Karaoke Battle'),performanceGame('random-song','Random Song Challenge',{capabilities:['media.performance','random.song']}),performanceGame('duet-roulette','Duet Roulette',{capabilities:['media.performance','random.duet']}),
 {id:'audience-choice',version:'1.0.0',name:'Audience Choice / Spin the Wheel',description:'Votación o sorteo verificado.',kind:'choice',capabilities:[],configSchema:{type:'object',required:['options']},validate(input){const c=common(input);invariant(Array.isArray(input.options)&&input.options.length>=2&&input.options.length<=50,'OPTIONS_REQUIRED');c.options=input.options.map(o=>cleanText(o));invariant(new Set(c.options).size===c.options.length,'DUPLICATE_OPTIONS');c.selection=input.selection==='random'?'random':'vote';c.tieBreak='server-draw';return c;},rounds:()=>1,prepare:s=>({prompt:s.definition.name,options:s.config.options}),evaluate(){throw Error('USE_VOTING');},reveal:()=>null},
 performanceGame('star-moment','Star Moment',{validate:input=>({...performanceConfig(input),roundCount:2,elimination:true})}),performanceGame('star-voice','Star Voice',{validate:input=>({...performanceConfig(input),roundCount:2,elimination:true})})
];
// Formats are configurations of shared mechanics, never separate scoring engines.
for(const [id,name] of [['star-talent','Star Talent'],['star-lip-sync','Star Lip Sync'],['star-dance-battle','Star Dance Battle'],['star-impersonator','Star Impersonator'],['comedy-star','Comedy Star'],['star-charades','Star Charades'],['star-hot-seat','Star Hot Seat']])modules.push(performanceGame(id,name));
for(const [id,name] of [['battle-of-sexes','Battle of the Sexes'],['generation-clash','Generation Clash'],['nations-battle','Nations Battle'],['guest-vs-staff','Guest vs Staff'],['family-faceoff','Family Faceoff']])modules.push(questionGame(id,name,{team:true}));
modules.push(questionGame('music-time-machine','Music Time Machine'));
modules.push(questionGame('mystery-star','Mystery Star',{clues:true}));
modules.push(questionGame('star-buzzer','Star ID / Star Buzzer',{media:true}));
modules.at(-1).capabilities.push('buzzer');
export function createRegistry(entries=modules){const registry=new Map();for(const m of entries){invariant(m.id&&!registry.has(m.id)&&typeof m.validate==='function'&&typeof m.prepare==='function'&&typeof m.evaluate==='function'&&typeof m.rounds==='function','INVALID_GAME_PLUGIN');registry.set(m.id,Object.freeze(m));}return registry;}
export const gameRegistry=createRegistry();
export const gameDefinitions=()=>[...[...gameRegistry.values()].map(({id,version,name,description,capabilities,kind,configSchema})=>({id,version,name,description,capabilities,kind,configSchema,availability:'implemented'})),{id:'star-pitch',version:'0.0.0',name:'Star Pitch',description:'Requiere medición técnica de afinación validada.',capabilities:['analysis.pitch'],kind:'performance',configSchema:{},availability:'unavailable'}];
