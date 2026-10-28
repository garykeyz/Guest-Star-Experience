import {gameRegistry} from './plugins.mjs';
import {invariant,integer,cleanText,rankScores,hybridScore,secureRandom,drawWithoutReplacement,bracketEntrants} from './competition.mjs';
export const GAME_PROTOCOL=1;
export const GAME_STATES=Object.freeze(['CREATED','CONFIGURING','REGISTRATION_OPEN','READY','INTRO','ROUND_PREPARING','ROUND_ACTIVE','ROUND_LOCKED','ROUND_RESULTS','FINAL_RESULTS','COMPLETED','PAUSED','INTERRUPTED','CANCELLED']);
const terminal=new Set(['COMPLETED','CANCELLED']);
export function createGame({id,scope,definitionId,config,hostId,now},registry=gameRegistry){
 invariant(/^[\w-]{8,80}$/.test(id),'INVALID_GAME_ID');invariant(scope.hotelId&&scope.venueId&&scope.activityId&&scope.runId,'ACTIVITY_RUN_REQUIRED');
 const plugin=registry.get(definitionId);invariant(plugin,'UNKNOWN_GAME');
 return {protocol:1,id,scope:{...scope},definition:{id:plugin.id,version:plugin.version,name:plugin.name,kind:plugin.kind},config:plugin.validate(config),status:'CONFIGURING',revision:1,createdAt:now,updatedAt:now,hostId,participants:[],teams:[],rounds:[],scoreEvents:[],judges:[],finalists:null,results:null,events:[{id:`${id}:1`,type:'game.created',sequence:1,gameId:id,scope:{...scope},protocol:1,roundId:null,actorId:hostId,at:now,data:{definitionId:plugin.id,version:plugin.version}}]};
}
function emit(s,type,actor,now,data={}){s.revision++;s.updatedAt=now;s.events.push({protocol:1,id:`${s.id}:${s.revision}`,type,sequence:s.revision,scope:{...s.scope},gameId:s.id,roundId:s.rounds.at(-1)?.id || null,actorId:actor.id,at:now,data});}
const currentRound=s=>s.rounds.at(-1);
const contestants=s=>s.participants.filter(p=>p.status==='active');
const subjectFor=(s,id)=>s.config.mode==='team'?s.participants.find(p=>p.id===id)?.teamId:id;
function score(s,{subjectId,value,reason,rule,sourceId,responseMs=0},actor,now){
 invariant(!terminal.has(s.status)&&!s.results,'RESULTS_LOCKED');invariant(Number.isFinite(value)&&Math.abs(value)<=100000,'INVALID_SCORE');
 invariant(!s.scoreEvents.some(e=>e.sourceId===sourceId&&e.subjectId===subjectId),'DUPLICATE_SCORE');
 const event={id:`${s.id}:score:${s.scoreEvents.length+1}`,gameId:s.id,roundId:currentRound(s)?.id || null,subjectId,value,reason,rule,sourceId,actorId:actor.id,at:now,responseMs};s.scoreEvents.push(event);emit(s,'score.updated',actor,now,event);
}
export function leaderboard(s){
 let subjects=s.config.mode==='team'?s.teams:contestants(s),events=s.scoreEvents;
 if(s.config.mode==='tournament'){
  subjects=s.participants.filter(p=>!['withdrawn','expelled'].includes(p.status));const rows=rankScores(subjects,events),reached=id=>s.tournamentWinner===id?100:(s.eliminations || []).find(e=>e.id===id)?.round ?? s.rounds.length;
  rows.sort((a,b)=>reached(b.id)-reached(a.id)||b.score-a.score||b.correct-a.correct||a.responseMs-b.responseMs||a.id.localeCompare(b.id));let rank=0,previous;return rows.map((row,index)=>{const tied=previous&&reached(previous.id)===reached(row.id)&&previous.score===row.score&&previous.correct===row.correct&&previous.responseMs===row.responseMs;if(!tied)rank=index+1;previous=row;return {...row,rank,tied:Boolean(tied)};});
 }
 if(s.finalists&&s.rounds.length>1){subjects=subjects.filter(p=>s.finalists.includes(p.id));if(s.config.finalScoring==='final-only')events=events.filter(e=>e.roundId===currentRound(s)?.id);}
 return rankScores(subjects,events);
}

export function expireGame(s,now){const round=currentRound(s);if(s.status==='ROUND_ACTIVE'&&round?.deadline<=now){round.closedAt=round.deadline;round.status='ROUND_LOCKED';s.status='ROUND_LOCKED';emit(s,'round.closed',{id:'server'},now,{reason:'deadline'});return true;}return false;}
/** Mutates a detached snapshot. The caller commits it atomically with command idempotency. */
export function executeGame(s,command,actor,now,{registry=gameRegistry,random=secureRandom}={}) {
 invariant(command.protocol===GAME_PROTOCOL,'PROTOCOL_MISMATCH');invariant(command.gameId===s.id,'GAME_CONTEXT_MISMATCH');
 invariant(actor.scope&&Object.keys(s.scope).every(k=>s.scope[k]===actor.scope[k]),'TENANT_CONTEXT_MISMATCH');
 invariant(!terminal.has(s.status),'GAME_CLOSED');
 const plugin=registry.get(s.definition.id);invariant(plugin&&plugin.version===s.definition.version,'RULE_VERSION_UNAVAILABLE');
 const type=command.type,p=command.payload || {},host=actor.role==='host'||actor.role==='superhost';
 const publicActions=new Set(['participant.join','participant.leave','participant.team','answer.submit','vote.submit','jury.submit','judge.request','buzzer.press']);
 invariant(host || publicActions.has(type),'FORBIDDEN');
 if(host)invariant(command.expectedRevision===s.revision,'STALE_REVISION');
 const round=currentRound(s);
 const requireStatus=(...statuses)=>invariant(statuses.includes(s.status),'INVALID_GAME_STATE');
 const participant=s.participants.find(v=>v.id===actor.id);
 if(type==='game.configure'){requireStatus('CONFIGURING');s.config=plugin.validate(p.config);emit(s,'game.configured',actor,now);}
 else if(type==='registration.open'){requireStatus('CONFIGURING','READY');s.status='REGISTRATION_OPEN';emit(s,'game.registration.opened',actor,now);}
 else if(type==='registration.close'){requireStatus('REGISTRATION_OPEN');invariant(plugin.kind==='choice'||contestants(s).length>0,'PARTICIPANTS_REQUIRED');s.status='READY';emit(s,'game.registration.closed',actor,now);}
 else if(type==='participant.join'){
  requireStatus('REGISTRATION_OPEN');invariant(!host,'HOST_CANNOT_COMPETE');invariant(!s.judges.includes(actor.id),'JUDGE_CANNOT_COMPETE');
  if(participant){invariant(participant.status!=='expelled','PARTICIPANT_EXPELLED');invariant(participant.status==='active','REGISTRATION_ALREADY_USED');return {accepted:true,participantId:actor.id};}
  const capacity=s.config.maxParticipants,teamId=p.teamId || null;
  if(s.config.mode==='team')invariant(s.teams.some(t=>t.id===teamId),'TEAM_REQUIRED');
  const member={id:actor.id,name:cleanText(p.name,80),teamId,status:contestants(s).length>=capacity?'waiting':'active',joinedAt:now};s.participants.push(member);emit(s,'participant.joined',actor,now,{participantId:member.id,status:member.status});
 }
 else if(type==='participant.team'){requireStatus('REGISTRATION_OPEN');invariant(participant?.status==='active'&&s.config.mode==='team'&&s.teams.some(t=>t.id===p.teamId),'INVALID_TEAM_MEMBER');participant.teamId=p.teamId;emit(s,'team.member.assigned',actor,now,{participantId:actor.id,teamId:p.teamId});}
 else if(type==='participant.leave'){invariant(participant,'PARTICIPANT_NOT_FOUND');participant.status='withdrawn';emit(s,'participant.left',actor,now,{participantId:actor.id});}
 else if(type==='participant.expel'){invariant(!terminal.has(s.status),'GAME_CLOSED');const row=s.participants.find(v=>v.id===p.participantId);invariant(row,'PARTICIPANT_NOT_FOUND');row.status='expelled';emit(s,'participant.expelled',actor,now,{participantId:row.id,reason:cleanText(p.reason,240)});}
 else if(type==='participant.promote'){requireStatus('REGISTRATION_OPEN','READY');const row=s.participants.find(v=>v.id===p.participantId&&v.status==='waiting');invariant(row&&contestants(s).length<s.config.maxParticipants,'NO_REGISTRATION_CAPACITY');row.status='active';emit(s,'participant.promoted',actor,now,{participantId:row.id});}
 else if(type==='team.create'){requireStatus('CONFIGURING','REGISTRATION_OPEN');invariant(s.teams.length<20&&!s.teams.some(t=>t.id===p.id),'INVALID_TEAM');s.teams.push({id:cleanText(p.id,80),name:cleanText(p.name,80)});emit(s,'team.created',actor,now,{teamId:p.id});}
 else if(type==='team.assign'){requireStatus('REGISTRATION_OPEN','READY');const row=s.participants.find(v=>v.id===p.participantId);invariant(row&&s.teams.some(t=>t.id===p.teamId),'INVALID_TEAM_MEMBER');row.teamId=p.teamId;emit(s,'team.member.assigned',actor,now,{participantId:row.id,teamId:p.teamId});}
 else if(type==='judge.request'){requireStatus('REGISTRATION_OPEN','READY');invariant(!participant,'CONTESTANT_CANNOT_JUDGE');s.judgeApplicants ||= [];if(!s.judgeApplicants.some(v=>v.id===actor.id))s.judgeApplicants.push({id:actor.id,name:cleanText(p.name,80)});emit(s,'judge.requested',actor,now,{actorId:actor.id});}
 else if(type==='judge.assign'){requireStatus('CONFIGURING','REGISTRATION_OPEN','READY');invariant(typeof p.actorId==='string'&&!s.participants.some(v=>v.id===p.actorId),'CONTESTANT_CANNOT_JUDGE');if(!s.judges.includes(p.actorId))s.judges.push(p.actorId);emit(s,'judge.assigned',actor,now,{actorId:p.actorId});}
 else if(type==='game.start'){
  requireStatus('READY');invariant(plugin.kind==='choice'||contestants(s).length>=1,'PARTICIPANTS_REQUIRED');if(s.config.mode==='team')invariant(s.teams.length>=2&&contestants(s).every(v=>v.teamId),'TEAMS_REQUIRED');
  if(s.config.mode==='head-to-head')invariant(contestants(s).length===2,'TWO_COMPETITORS_REQUIRED');
  if(s.config.mode==='tournament'){invariant(plugin.rounds(s.config)>=Math.ceil(Math.log2(contestants(s).length))&&contestants(s).length>=2,'TOURNAMENT_ROUNDS_REQUIRED');s.bracket=bracketEntrants(contestants(s).map(p=>p.id),random);s.eliminations=[];s.bracketHistory=[];}
  if(plugin.kind==='performance')s.performanceOrder=drawWithoutReplacement(contestants(s).map(v=>v.id),contestants(s).length,random);
  s.status='INTRO';emit(s,'game.started',actor,now,{order:s.performanceOrder || null,bracket:s.bracket || null});
 }
 else if(type==='round.prepare'){
  requireStatus('INTRO','ROUND_RESULTS');invariant(s.rounds.length<plugin.rounds(s.config),'NO_MORE_ROUNDS');
  const index=s.rounds.length,id=`${s.id}:round:${index+1}`;
  invariant(!s.tournamentWinner,'TOURNAMENT_COMPLETE');
  const next={id,index,status:'ROUND_PREPARING',durationMs:s.config.roundSeconds*1000,startedAt:null,deadline:null,answers:{},votes:{},jury:{},applause:{},evaluation:null,scene:plugin.prepare(s,index)};
  if(plugin.capabilities.includes('random.song')){invariant(s.config.songs.length>0,'SONGS_REQUIRED');const eligible=s.config.songs.filter(id=>!(s.songHistory || []).includes(id));invariant(eligible.length,'ELIGIBLE_SONGS_EXHAUSTED');next.scene.song=drawWithoutReplacement(eligible,1,random)[0];s.songHistory=[...(s.songHistory || []),next.scene.song];}
  if(plugin.capabilities.includes('random.duet')){const ids=contestants(s).map(v=>v.id);invariant(ids.length>=2,'DUET_REQUIRES_TWO');const pairs=[];for(let i=0;i<ids.length;i++)for(let j=i+1;j<ids.length;j++){const pair=[ids[i],ids[j]].sort(),key=pair.join('|');if(s.config.excludedPairs.some(p=>[...p].sort().join('|')===key))continue;if(s.config.avoidRepeatedPairs&&(s.duetHistory || []).includes(key))continue;pairs.push(pair);}invariant(pairs.length,'NO_ELIGIBLE_DUET');next.scene.pair=pairs[random(pairs.length)];s.duetHistory=[...(s.duetHistory || []),next.scene.pair.join('|')];}
  if(s.config.mode==='tournament')next.scene.matchups=structuredClone(s.bracket);
  s.rounds.push(next);s.status='ROUND_PREPARING';emit(s,'round.prepared',actor,now,{roundId:id,scene:next.scene});
 }
 else if(type==='round.start'){requireStatus('ROUND_PREPARING');round.startedAt=now;round.deadline=now+round.durationMs;round.status='ROUND_ACTIVE';s.status='ROUND_ACTIVE';emit(s,'round.started',actor,now,{deadline:round.deadline,startedAt:now});}
 else if(type==='round.pause'){requireStatus('ROUND_ACTIVE');round.remainingMs=Math.max(0,round.deadline-now);s.status='PAUSED';emit(s,'game.paused',actor,now,{remainingMs:round.remainingMs});}
 else if(type==='round.resume'){requireStatus('PAUSED');round.startedAt+=now-(round.deadline-round.remainingMs);round.deadline=now+round.remainingMs;s.status='ROUND_ACTIVE';emit(s,'game.resumed',actor,now,{deadline:round.deadline});}
 else if(type==='round.extend'){requireStatus('ROUND_ACTIVE','PAUSED');const ms=integer(p.seconds,1,300)*1000;if(s.status==='PAUSED')round.remainingMs+=ms;else round.deadline+=ms;round.durationMs+=ms;emit(s,'round.extended',actor,now,{seconds:p.seconds});}
 else if(type==='round.close'){requireStatus('ROUND_ACTIVE','PAUSED');round.closedAt=now;round.status='ROUND_LOCKED';s.status='ROUND_LOCKED';emit(s,'round.closed',actor,now,{reason:'host'});}
 else if(type==='answer.submit'){
  requireStatus('ROUND_ACTIVE');invariant(command.roundId===round.id,'STALE_ROUND');invariant(now<round.deadline,'ROUND_DEADLINE_EXCEEDED');invariant(participant?.status==='active'&&(!s.finalists||s.finalists.includes(actor.id)),'NOT_A_COMPETITOR');invariant(!round.answers[actor.id],'ANSWER_ALREADY_SUBMITTED');
  if(plugin.capabilities.includes('buzzer'))invariant(round.buzzerWinner===actor.id,'BUZZER_TURN_REQUIRED');
  const evaluation=plugin.evaluate(s,round,p,now);round.answers[actor.id]={receivedAt:now,submission:structuredClone(p),evaluation};
  const subjectId=subjectFor(s,actor.id);invariant(subjectId,'TEAM_REQUIRED');score(s,{...evaluation,subjectId,rule:`${plugin.id}@${plugin.version}`,sourceId:`${round.id}:answer:${actor.id}`},actor,now);emit(s,'answer.accepted',actor,now,{participantId:actor.id});
 }
 else if(type==='buzzer.press'){requireStatus('ROUND_ACTIVE');invariant(plugin.capabilities.includes('buzzer')&&participant?.status==='active'&&command.roundId===round.id&&now<round.deadline,'BUZZER_UNAVAILABLE');invariant(!round.buzzerWinner,'BUZZER_ALREADY_CLAIMED');round.buzzerWinner=actor.id;round.buzzedAt=now;emit(s,'buzzer.claimed',actor,now,{participantId:actor.id,receivedAt:now});}
 else if(type==='buzzer.reset'){requireStatus('ROUND_ACTIVE');invariant(plugin.capabilities.includes('buzzer')&&round.buzzerWinner,'BUZZER_UNAVAILABLE');invariant(round.answers[round.buzzerWinner]?.evaluation.correct===false,'BUZZER_RESET_REQUIRES_INCORRECT_ANSWER');round.buzzerWinner=null;emit(s,'buzzer.reopened',actor,now);}
 else if(type==='vote.submit'||type==='jury.submit'){
  requireStatus('ROUND_ACTIVE');invariant(command.roundId===round.id&&now<round.deadline,'VOTING_CLOSED');invariant(plugin.kind!=='question'&&!(plugin.kind==='choice'&&s.config.selection==='random'),'VOTING_UNAVAILABLE');
  invariant(!s.participants.some(v=>v.id===actor.id)&&!(s.ineligibleVoterIds || []).includes(actor.id),'CONTESTANT_CANNOT_VOTE');invariant(!host,'HOST_CANNOT_PUBLIC_VOTE');
  const jury=type==='jury.submit';invariant(jury?s.judges.includes(actor.id):!s.judges.includes(actor.id),'INELIGIBLE_VOTER');
  const votes=jury?round.jury:round.votes;invariant(!votes[actor.id],'VOTE_ALREADY_ACCEPTED');
  const targets=plugin.kind==='choice'?s.config.options.map((_,i)=>String(i)):round.scene.performers.map(v=>v.id);
  invariant(Array.isArray(p.ratings)&&p.ratings.length>0&&p.ratings.length<=targets.length,'INVALID_BALLOT');
  invariant(new Set(p.ratings.map(v=>v.targetId)).size===p.ratings.length,'DUPLICATE_BALLOT_TARGET');
  if(plugin.kind==='choice')invariant(p.ratings.length===1,'ONE_CHOICE_REQUIRED');
  const ratings=p.ratings.map(v=>{invariant(targets.includes(v.targetId),'INVALID_VOTE_TARGET');return {targetId:v.targetId,value:plugin.kind==='choice'?1:integer(v.value,1,s.config.votingScale,'INVALID_RATING')};});
  votes[actor.id]={ratings,receivedAt:now};emit(s,jury?'jury.accepted':'vote.accepted',actor,now,{ballotId:`${round.id}:${actor.id}`});
 }
 else if(type==='applause.submit'){
  requireStatus('ROUND_ACTIVE','ROUND_LOCKED');invariant(s.config.weights?.applause>0,'APPLAUSE_NOT_ENABLED');invariant(round.scene.performers.some(v=>v.id===p.targetId),'INVALID_TARGET');
  const m=p.measurement;invariant(m&&m.calibrationId&&m.deviceId&&m.method==='ambient-rms-transient-brightness-v1'&&m.valid===true&&m.confidence>=0.65&&m.clippedFraction<0.01&&m.durationMs>=3000&&m.durationMs<=15000&&Number.isFinite(m.score)&&m.score>=0&&m.score<=100&&typeof m.id==='string','INVALID_APPLAUSE_MEASUREMENT');
  invariant(!round.applause[p.targetId],'MEASUREMENT_ALREADY_ACCEPTED');round.applause[p.targetId]={...m,actorId:actor.id,at:now};emit(s,'applause.accepted',actor,now,{targetId:p.targetId,measurement:m});
 }
 else if(type==='clue.reveal'){requireStatus('ROUND_ACTIVE');const q=s.config.questions?.[round.index];invariant(q?.clues&&round.scene.clues.length<q.clues.length,'NO_MORE_CLUES');round.scene.clues.push(q.clues[round.scene.clues.length]);emit(s,'clue.revealed',actor,now,{clue:round.scene.clues.at(-1)});}
 else if(type==='score.adjust'){invariant(actor.canAdjustScores===true||actor.role==='superhost','FORBIDDEN');invariant(p.exceptional===true,'EXCEPTIONAL_CORRECTION_CONFIRMATION_REQUIRED');invariant(s.status==='ROUND_LOCKED','SCORE_ADJUSTMENT_UNAVAILABLE');invariant([...s.participants,...s.teams].some(v=>v.id===p.subjectId),'INVALID_TARGET');score(s,{subjectId:p.subjectId,value:p.value,reason:cleanText(p.reason,240),rule:'host.adjustment@1',sourceId:cleanText(command.id)},actor,now);}
 else if(type==='round.evaluate'){
  requireStatus('ROUND_LOCKED');invariant(!round.evaluation,'ROUND_ALREADY_EVALUATED');
  if(plugin.kind==='performance'){
   const average=(ballots,target)=>{const values=Object.values(ballots).flatMap(b=>b.ratings).filter(v=>v.targetId===target).map(v=>v.value);invariant(values.length>0,'MISSING_VOTES');return values.reduce((a,b)=>a+b,0)/values.length/s.config.votingScale*100;};
   for(const performer of round.scene.performers){const components={};for(const [key,w] of Object.entries(s.config.weights)){if(w===0){components[key]=0;continue;}if(key==='audience')components[key]=average(round.votes,performer.id);if(key==='jury')components[key]=average(round.jury,performer.id);if(key==='applause'){invariant(round.applause[performer.id]?.valid,'MISSING_MEASUREMENT');components[key]=round.applause[performer.id].score;}}score(s,{subjectId:subjectFor(s,performer.id),value:hybridScore(components,s.config.weights),reason:'performance.evaluated',rule:`${plugin.id}@${plugin.version}`,sourceId:`${round.id}:performance:${performer.id}`},actor,now);}
  }
  if(plugin.kind==='choice'){
   const counts=s.config.options.map((name,i)=>({id:String(i),name,count:Object.values(round.votes).flatMap(v=>v.ratings).filter(v=>v.targetId===String(i)).length}));
   const chosen=s.config.selection==='random'?drawWithoutReplacement(counts.map(v=>v.id),1,random)[0]:null;
   round.choiceResults=counts.sort((a,b)=>b.count-a.count||a.id.localeCompare(b.id));round.winner=chosen || round.choiceResults[0]?.id;
   if(s.config.selection==='vote'){invariant(round.choiceResults[0]?.count>0,'NO_CONFIRMED_VOTES');const tied=round.choiceResults.filter(v=>v.count===round.choiceResults[0].count);if(tied.length>1){round.winner=tied[random(tied.length)].id;round.tieBreak={rule:s.config.tieBreak,eligible:tied.map(v=>v.id),chosen:round.winner};}}
  }
  if(s.config.mode==='tournament'){
   const roundScores=s.scoreEvents.filter(e=>e.roundId===round.id),winners=[];
   for(const match of s.bracket){let winner=match.winner;if(!winner){const board=rankScores(match.entrants.map(id=>({id})),roundScores);invariant(board[0].rank!==board[1].rank,'TIE_REQUIRES_HOST_DECISION');winner=board[0].id;}match.winner=winner;winners.push(winner);for(const loser of match.entrants.filter(id=>id!==winner)){s.eliminations.push({id:loser,round:round.index});const participant=s.participants.find(p=>p.id===loser);if(participant)participant.status='eliminated';}}
   s.bracketHistory.push(structuredClone(s.bracket));s.finalists=winners;
   if(winners.length===1)s.tournamentWinner=winners[0];else {s.bracket=[];for(let i=0;i<winners.length;i+=2)s.bracket.push({id:`round-${round.index+2}-match-${i/2+1}`,entrants:winners.slice(i,i+2),winner:winners[i+1]?null:winners[i],bye:!winners[i+1]});}
  }
  round.evaluation={at:now,leaderboard:leaderboard(s),roundLeaderboard:rankScores(leaderboard(s).map(({id,name})=>({id,name})),s.scoreEvents.filter(e=>e.roundId===round.id)),answer:plugin.reveal(s,round.index)};round.status='ROUND_RESULTS';s.status='ROUND_RESULTS';
  if(s.config.elimination&&s.rounds.length===1){const board=round.evaluation.leaderboard,n=Math.min(s.config.finalists,board.length);invariant(!board[n]||board[n-1].rank!==board[n].rank,'TIE_REQUIRES_HOST_DECISION');s.finalists=board.slice(0,n).map(p=>p.id);}
  emit(s,'round.completed',actor,now,{evaluation:round.evaluation,finalists:s.finalists});
 }
 else if(type==='game.finalize'){requireStatus('ROUND_RESULTS');invariant(s.tournamentWinner||s.rounds.length===plugin.rounds(s.config),'ROUNDS_REMAIN');const finalBoard=leaderboard(s),cut=Math.min(s.config.podium,finalBoard.length);invariant(!finalBoard[cut]||finalBoard[cut-1].rank!==finalBoard[cut].rank,'TIE_REQUIRES_HOST_DECISION');s.status='FINAL_RESULTS';s.results={at:now,definition:s.definition,leaderboard:leaderboard(s),podium:leaderboard(s).filter(p=>p.rank<=s.config.podium),choice:round.choiceResults || null,winner:round.winner ?? null};emit(s,'game.final.results',actor,now,{results:s.results});}
 else if(type==='game.complete'){requireStatus('FINAL_RESULTS');s.status='COMPLETED';emit(s,'game.completed',actor,now,{results:s.results});}
 else if(type==='game.cancel'){s.status='CANCELLED';emit(s,'game.cancelled',actor,now,{reason:cleanText(p.reason,240)});}
 else throw Error('UNKNOWN_GAME_COMMAND');
 return {accepted:true,revision:s.revision};
}
export function gameView(s,actor,now){
 const host=['host','superhost'].includes(actor.role),round=currentRound(s),participant=s.participants.find(p=>p.id===actor.id);
 const view={protocol:1,id:s.id,scope:s.scope,definition:s.definition,status:s.status,revision:s.revision,serverNow:now,canAdjustScores:actor.canAdjustScores===true||actor.role==='superhost',isJudge:s.judges.includes(actor.id),participant:participant?{id:participant.id,name:participant.name,status:participant.status,teamId:participant.teamId}:null,participants:contestants(s).map(({id,name,teamId})=>({id,name,teamId})),teams:s.teams,leaderboard:['ROUND_RESULTS','FINAL_RESULTS','COMPLETED'].includes(s.status)?leaderboard(s):[],results:s.results,config:{mode:s.config.mode,roundCount:s.config.questions?.length || s.config.roundCount || 1,roundSeconds:s.config.roundSeconds,maxParticipants:s.config.maxParticipants,votingScale:s.config.votingScale || 5,selection:s.config.selection || '',tieBreak:s.config.tieBreak || ''},round:round?{id:round.id,index:round.index,status:round.status,scene:host?round.scene:{...round.scene,media:round.scene.media?{available:true}:null},startedAt:round.startedAt,deadline:s.status==='PAUSED'?null:round.deadline,remainingMs:s.status==='PAUSED'?round.remainingMs:null,evaluation:round.evaluation,choiceResults:round.choiceResults || null,winner:round.winner ?? null,answered:Boolean(round.answers[actor.id]),voted:Boolean(round.votes[actor.id]),judged:Boolean(round.jury[actor.id]),buzzerWinner:round.buzzerWinner || null}:null};
 if(host){view.config={...structuredClone(s.config),roundCount:s.config.questions?.length || s.config.roundCount || 1};view.waiting=s.participants.filter(p=>p.status==='waiting');view.judges=s.judges;view.judgeApplicants=s.judgeApplicants || [];view.confirmedAnswers=Object.keys(round?.answers || {}).length;view.confirmedVotes=Object.keys(round?.votes || {}).length;}
 return view;
}
