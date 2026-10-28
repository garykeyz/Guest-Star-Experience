import {createShow,executeShow,showView} from './show-composer.mjs';
import {createShowStorage} from './show-storage.mjs';
import {createGame,executeGame,expireGame,gameView} from './core.mjs';
import {gameDefinitions} from './plugins.mjs';
import {invariant} from './competition.mjs';
const response=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store'}});
const canonical=value=>{if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';return JSON.stringify(value);};
/** One serialized authority per hotel/venue/activity occurrence, independent of karaoke lifecycle. */
export class GameRoom {
 constructor(state,env){
  this.state=state;this.env=env;this.sql=state.storage.sql;this.queue=Promise.resolve();
  this.sql.exec(`CREATE TABLE IF NOT EXISTS games (id TEXT PRIMARY KEY, data TEXT NOT NULL, dirty INTEGER NOT NULL DEFAULT 1,synced INTEGER NOT NULL DEFAULT 0)`);
  this.sql.exec(`CREATE TABLE IF NOT EXISTS game_chunks(game_id TEXT NOT NULL,ordinal INTEGER NOT NULL,content TEXT NOT NULL,PRIMARY KEY(game_id,ordinal))`);
  this.sql.exec(`CREATE TABLE IF NOT EXISTS game_events(game_id TEXT NOT NULL,sequence INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(game_id,sequence))`);
  this.sql.exec(`CREATE TABLE IF NOT EXISTS commands (actor TEXT NOT NULL,id TEXT NOT NULL,fingerprint TEXT NOT NULL,result TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(actor,id))`);
  this.sql.exec(`CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY,expires_at INTEGER NOT NULL,role TEXT NOT NULL)`);
  this.sql.exec(`CREATE TABLE IF NOT EXISTS room (id INTEGER PRIMARY KEY CHECK(id=1),scope TEXT NOT NULL,presentation TEXT)`);
  this.shows=createShowStorage({sql:this.sql,atomic:fn=>this.atomic(fn),db:env.GUEST_STAR_DB});
 }
 atomic(fn){if(this.inTransaction)return fn();return this.state.storage.transactionSync(()=>{this.inTransaction=true;try{return fn();}finally{this.inTransaction=false;}});}
 serial(fn){const next=this.queue.then(fn,fn);this.queue=next.catch(()=>{});return next;}
 read(id){const row=this.sql.exec('SELECT data FROM games WHERE id=?',id).toArray()[0];if(!row)return null;const header=JSON.parse(row.data);if(!header.chunked)return header;const raw=this.sql.exec('SELECT content FROM game_chunks WHERE game_id=? ORDER BY ordinal',id).toArray().map(r=>r.content).join('');const game=JSON.parse(raw);game.events=[];return game;}
 save(s){
  const events=s.events || [],snapshot={...s,events:[]},raw=JSON.stringify(snapshot),size=30000;
  const write=()=>{for(const event of events)this.sql.exec('INSERT OR IGNORE INTO game_events(game_id,sequence,data) VALUES(?,?,?)',s.id,event.sequence,JSON.stringify(event));this.sql.exec('DELETE FROM game_chunks WHERE game_id=?',s.id);for(let i=0;i<raw.length;i+=size)this.sql.exec('INSERT INTO game_chunks(game_id,ordinal,content) VALUES(?,?,?)',s.id,i/size,raw.slice(i,i+size));this.sql.exec('INSERT INTO games(id,data,dirty) VALUES(?,?,1) ON CONFLICT(id) DO UPDATE SET data=excluded.data,dirty=1',s.id,JSON.stringify({id:s.id,revision:s.revision,status:s.status,chunked:true,deadline:s.rounds.at(-1)?.deadline}));};
  // Command callers are already inside the enclosing atomic transaction.
  this.atomic(write);
 }

 verifyScope(actor){const value=canonical(actor.scope),row=this.sql.exec('SELECT scope FROM room WHERE id=1').toArray()[0];if(row)invariant(row.scope===value,'TENANT_CONTEXT_MISMATCH');else this.sql.exec('INSERT INTO room(id,scope) VALUES(1,?)',value);}
 async fetch(request){
  const receivedAt=Date.now(),url=new URL(request.url);
  if(url.pathname==='/connect')return this.serial(()=>this.connect(request));
  let body;try{body=await request.json();}catch{return response({ok:false,code:'INVALID_JSON'},400);}
  return this.serial(async()=>{
   try {
    const {actor,command}=body;invariant(actor?.id&&actor?.scope&&['host','superhost','guest'].includes(actor.role),'UNAUTHORIZED');
    this.verifyScope(actor);
    if(body.action==='ticket'){
     invariant(this.state.getWebSockets().length<300,'ROOM_CAPACITY');const ticket=crypto.randomUUID()+crypto.randomUUID();this.sql.exec('INSERT INTO tickets(id,expires_at,role) VALUES(?,?,?)',ticket,receivedAt+30000,actor.role);await this.schedule();return response({ok:true,ticket});
    }
    if(body.action==='list'){
     const games=this.sql.exec('SELECT data FROM games ORDER BY id').toArray().map(r=>this.read(JSON.parse(r.data).id));
     let changed=false;for(const g of games){if(expireGame(g,receivedAt)){this.save(g);this.broadcast(g);changed=true;}}
     if(changed)await this.schedule();return response({ok:true,serverNow:receivedAt,definitions:gameDefinitions(),games:games.map(g=>gameView(g,actor,receivedAt)),shows:this.shows.list().map(show=>showView(show,actor,receivedAt)),presentation:this.presentation()});
    }
    if(body.action==='snapshot'&&body.showId){const show=this.shows.read(body.showId);invariant(show,'SHOW_NOT_FOUND');return response({ok:true,show:showView(show,actor,receivedAt),serverNow:receivedAt,presentation:this.presentation()});}
    if(body.action==='snapshot'){
     const game=this.read(body.gameId);invariant(game,'GAME_NOT_FOUND');if(expireGame(game,receivedAt)){this.save(game);this.broadcast(game);await this.schedule();}
     return response({ok:true,game:gameView(game,actor,receivedAt),serverNow:receivedAt,presentation:this.presentation()});
    }
    invariant(command?.protocol===1&&/^[\w:-]{8,120}$/.test(command.id),'INVALID_COMMAND_ID');
    const fingerprint=canonical(command),prior=this.sql.exec('SELECT fingerprint,result FROM commands WHERE actor=? AND id=?',actor.id,command.id).toArray()[0];
    if(prior){invariant(prior.fingerprint===fingerprint,'COMMAND_ID_CONFLICT');const saved=JSON.parse(prior.result),game=saved.gameId?this.read(saved.gameId):null,show=saved.showId?this.shows.read(saved.showId):null;return response({...saved,show:show?showView(show,actor,receivedAt):undefined,game:game?gameView(game,actor,receivedAt):null,presentation:this.presentation(),serverNow:receivedAt,replayed:true});}
    if(command.type.startsWith('show.')){
     let show;this.atomic(()=>{if(command.type==='show.create'){invariant(['host','superhost'].includes(actor.role),'FORBIDDEN');invariant(!this.shows.read(command.showId),'SHOW_ALREADY_EXISTS');invariant(this.shows.list().length<16,'SHOW_CAPACITY');show=createShow({id:command.showId,scope:actor.scope,hostId:actor.id,config:command.payload.config,now:receivedAt});}else{show=this.shows.read(command.showId);invariant(show,'SHOW_NOT_FOUND');if(command.type.startsWith('show.presentation.')){invariant(['host','superhost'].includes(actor.role)&&actor.deviceId,'LOCAL_HOST_REQUIRED');invariant(command.expectedRevision===show.revision,'STALE_REVISION');invariant(command.payload?.confirmTransition===true,'EXPLICIT_TRANSITION_REQUIRED');invariant(command.type!=='show.presentation.acquire'||show.status!=='CANCELLED','SHOW_CLOSED');invariant(['auto','leaderboard','qualifiers','awards','welcome'].includes(command.payload.scene || 'auto'),'INVALID_SHOW_SCENE');const lease=command.type==='show.presentation.acquire'?{showId:show.id,scene:command.payload.scene || 'auto',at:receivedAt,actorId:actor.id}:null;this.sql.exec('UPDATE room SET presentation=? WHERE id=1',lease?JSON.stringify(lease):null);}else executeShow(show,command,actor,receivedAt,{getGame:id=>this.read(id),saveGame:game=>this.save(game),newId:()=>crypto.randomUUID(),commandId:command.id});}if(show.status==='CANCELLED'&&(this.presentation()?.showId===show.id||this.read(this.presentation()?.gameId || '')?.parentShowId===show.id))this.sql.exec('UPDATE room SET presentation=NULL WHERE id=1');this.shows.save(show);this.sql.exec('INSERT INTO commands(actor,id,fingerprint,result,created_at) VALUES(?,?,?,?,?)',actor.id,command.id,fingerprint,JSON.stringify({ok:true,accepted:true,showId:show.id,commandId:command.id}),receivedAt);});this.broadcastShow(show);await this.schedule();return response({ok:true,accepted:true,show:showView(show,actor,receivedAt),serverNow:receivedAt,presentation:this.presentation()});
    }
    const existing=command.type!=='game.create'?this.read(command.gameId):null;
    if(existing && expireGame(existing,receivedAt)){this.save(existing);this.broadcast(existing);}
    let result,game;
    this.atomic(()=>{
     if(command.type==='game.create'){
      invariant(['host','superhost'].includes(actor.role),'FORBIDDEN');invariant(!this.read(command.gameId),'GAME_ALREADY_EXISTS');
      invariant(this.sql.exec('SELECT count(*) AS n FROM games').toArray()[0].n<32,'ACTIVITY_GAME_LIMIT');
      game=createGame({id:command.gameId,scope:actor.scope,definitionId:command.payload.definitionId,config:command.payload.config,hostId:actor.id,now:receivedAt});this.save(game);
     } else if(['presentation.acquire','presentation.release'].includes(command.type)){
      invariant(['host','superhost'].includes(actor.role)&&actor.deviceId,'LOCAL_HOST_REQUIRED');
      invariant(command.payload?.confirmTransition===true,'EXPLICIT_TRANSITION_REQUIRED');
      game=this.read(command.gameId);invariant(game,'GAME_NOT_FOUND');invariant(command.expectedRevision===game.revision,'STALE_REVISION');
      const presentation=command.type==='presentation.acquire'?{gameId:game.id,at:receivedAt,actorId:actor.id}:null;
      this.sql.exec('UPDATE room SET presentation=? WHERE id=1',presentation?JSON.stringify(presentation):null);
     } else {
      game=this.read(command.gameId);invariant(game,'GAME_NOT_FOUND');
      if(game.parentShowId&&game.segmentId){const parent=this.shows.read(game.parentShowId),segment=parent?.segments.find(s=>s.id===game.segmentId);invariant(segment,'PARENT_SHOW_CONTEXT_REQUIRED');invariant(!['COMPLETED','CANCELLED'].includes(parent.status),'SHOW_CLOSED');invariant(!['COMPLETED','SKIPPED','CANCELLED'].includes(segment.status),'SEGMENT_CLOSED');if(['game.start','round.start'].includes(command.type))invariant(parent.activeSegmentId===segment.id&&segment.status==='ACTIVE','SEGMENT_NOT_ACTIVE');if(command.type==='participant.join')invariant(game.participants.some(p=>p.id===actor.id),'JOIN_THROUGH_SHOW');}
      const updated=structuredClone(game);executeGame(updated,command,actor,receivedAt);game=updated;this.save(game);if(game.parentShowId&&game.segmentId&&['round.pause','round.resume','round.close','game.cancel'].includes(command.type)){const parent=this.shows.read(game.parentShowId),segment=parent.segments.find(s=>s.id===game.segmentId);const nextStatus=game.status==='CANCELLED'?'CANCELLED':game.status==='PAUSED'?'PAUSED':'ACTIVE';if(segment.status!==nextStatus){segment.status=nextStatus;if(game.status==='CANCELLED'&&parent.activeSegmentId===segment.id)parent.activeSegmentId=null;parent.revision++;parent.updatedAt=receivedAt;parent.events.push({protocol:1,id:parent.id+':'+parent.revision,sequence:parent.revision,showId:parent.id,scope:parent.scope,type:'show.segment.state.changed',actorId:actor.id,at:receivedAt,data:{segmentId:segment.id,status:segment.status}});this.shows.save(parent);this.broadcastShow(parent);}}
      if(['COMPLETED','CANCELLED'].includes(game.status)&&this.presentation()?.gameId===game.id)this.sql.exec('UPDATE room SET presentation=NULL WHERE id=1');
     }
     result={ok:true,accepted:true,commandId:command.id,game:gameView(game,actor,receivedAt),presentation:this.presentation(),serverNow:receivedAt};
     this.sql.exec('INSERT INTO commands(actor,id,fingerprint,result,created_at) VALUES(?,?,?,?,?)',actor.id,command.id,fingerprint,JSON.stringify({ok:true,accepted:true,commandId:command.id,gameId:game.id,revision:game.revision}),receivedAt);
    });
    // Storage output gates confirm the transaction before responses leave the object.
    this.broadcast(game);await this.schedule();return response(result);
   } catch(error){await this.schedule();return response({ok:false,accepted:false,code:error.message,serverNow:receivedAt},['FORBIDDEN','UNAUTHORIZED','TENANT_CONTEXT_MISMATCH'].includes(error.message)?403:409);}
  });
 }
 broadcastShow(show){for(const socket of this.state.getWebSockets()){try{socket.send(JSON.stringify({protocol:1,type:'game.changed',showId:show.id,scope:show.scope,sequence:show.revision}));}catch{}}}
 presentation(){const row=this.sql.exec('SELECT presentation FROM room WHERE id=1').toArray()[0];return row?.presentation?JSON.parse(row.presentation):null;}
 broadcast(game){const privateUpdate=['answer.accepted','vote.accepted','jury.accepted','score.updated'].includes(game.events.at(-1)?.type);for(const socket of this.state.getWebSockets()){if(privateUpdate&&!['host','superhost'].includes(socket.deserializeAttachment()?.role))continue;try{socket.send(JSON.stringify({protocol:1,type:'game.changed',gameId:game.id,scope:game.scope,sequence:game.revision,presentation:this.presentation()}));}catch{try{socket.close(1011,'Reconnect');}catch{}}}}
 connect(request){
  const token=new URL(request.url).searchParams.get('ticket') || '',ticket=this.sql.exec('SELECT expires_at,role FROM tickets WHERE id=?',token).toArray()[0];
  if(!ticket || ticket.expires_at<Date.now() || request.headers.get('Upgrade')?.toLowerCase()!=='websocket')return response({ok:false,code:'INVALID_TICKET'},403);
  this.sql.exec('DELETE FROM tickets WHERE id=?',token);const pair=new WebSocketPair();this.state.acceptWebSocket(pair[1]);pair[1].serializeAttachment({expiresAt:Date.now()+60000,role:ticket.role});void this.schedule();return new Response(null,{status:101,webSocket:pair[0]});
 }
 webSocketMessage(socket,message){if(message==='ping')socket.send('pong');else socket.close(1008,'Commands require authenticated HTTP');}
 webSocketClose(socket,code,reason){socket.close(code,reason);}
 webSocketError(socket){try{socket.close(1011,'Reconnect');}catch{}}
 async schedule(){
  const now=Date.now(),deadlines=[];
  for(const r of this.sql.exec('SELECT data,dirty FROM games').toArray()){const g=JSON.parse(r.data);if(g.status==='ROUND_ACTIVE')deadlines.push(g.deadline);if(r.dirty)deadlines.push(now+2000);}
  if(this.shows.dirty())deadlines.push(now+2000);
  for(const s of this.state.getWebSockets())deadlines.push(s.deserializeAttachment()?.expiresAt || now);
  for(const t of this.sql.exec('SELECT min(expires_at) AS deadline FROM tickets').toArray())if(t.deadline)deadlines.push(t.deadline);
  if(deadlines.length){const proposed=Math.max(now+100,Math.min(...deadlines)),existing=await this.state.storage.getAlarm?.();await this.state.storage.setAlarm(existing&&existing>now?Math.min(existing,proposed):proposed);}else await this.state.storage.deleteAlarm();
 }
 async alarm(){return this.serial(async()=>{
  const now=Date.now();for(const s of this.state.getWebSockets())if((s.deserializeAttachment()?.expiresAt || 0)<=now)s.close(1000,'Renew authorization');
  this.sql.exec('DELETE FROM tickets WHERE expires_at<=?',now);
  for(const r of this.sql.exec('SELECT data FROM games').toArray()){const g=this.read(JSON.parse(r.data).id);if(expireGame(g,now)){this.save(g);this.broadcast(g);}}
  try{await this.flush();}finally{await this.schedule();}
 });}
 async flush(){
  await this.shows.flush();
  for(const row of this.sql.exec('SELECT data,synced FROM games WHERE dirty=1').toArray()){
   const g=this.read(JSON.parse(row.data).id),scope=g.scope,recordId=canonical(scope)+'|'+g.id;
   const raw=JSON.stringify(g),chunks=[];for(let i=0;i<raw.length;i+=30000)chunks.push(raw.slice(i,i+30000));
   const summary={...gameView(g,{role:'host',id:g.hostId},Date.now()),archive:{revision:g.revision,parts:chunks.length}};
   await this.env.GUEST_STAR_DB.prepare(`INSERT OR IGNORE INTO guest_star_game_sessions(game_id,hotel_id,venue_id,activity_id,run_id,definition_id,rules_version,revision,status,snapshot_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(recordId,scope.hotelId,scope.venueId,scope.activityId,scope.runId,g.definition.id,g.definition.version,1,'RECOVERING','{}',g.createdAt,g.updatedAt).run();
   const events=this.sql.exec('SELECT data FROM game_events WHERE game_id=? AND sequence>? ORDER BY sequence',g.id,row.synced).toArray().map(r=>JSON.parse(r.data));
   for(let i=0;i<events.length;i+=50)await this.env.GUEST_STAR_DB.batch(events.slice(i,i+50).map(e=>this.env.GUEST_STAR_DB.prepare('INSERT OR IGNORE INTO guest_star_game_event_log(game_id,sequence,event_id,event_type,event_json,created_at) VALUES(?,?,?,?,?,?)').bind(recordId,e.sequence,recordId+':'+e.sequence,e.type,JSON.stringify(e),e.at)));
   for(let i=0;i<chunks.length;i+=50)await this.env.GUEST_STAR_DB.batch(chunks.slice(i,i+50).map((content,j)=>this.env.GUEST_STAR_DB.prepare('INSERT OR REPLACE INTO guest_star_game_state_chunks(game_id,revision,ordinal,content) VALUES(?,?,?,?)').bind(recordId,g.revision,i+j,content)));
   await this.env.GUEST_STAR_DB.prepare('UPDATE guest_star_game_sessions SET revision=?,status=?,snapshot_json=?,updated_at=? WHERE game_id=? AND revision<=?').bind(g.revision,g.status,JSON.stringify(summary),g.updatedAt,recordId,g.revision).run();
   await this.env.GUEST_STAR_DB.prepare('DELETE FROM guest_star_game_state_chunks WHERE game_id=? AND revision<?').bind(recordId,g.revision).run();
   this.sql.exec('UPDATE games SET dirty=0,synced=? WHERE id=? AND json_extract(data,\'$.revision\')=?',g.revision,g.id,g.revision);
  }
 }
}
