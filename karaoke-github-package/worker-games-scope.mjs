import {handleShowTemplates,materializeShowTemplate,showOffers} from './lib/guest-star/games/show-templates.mjs';
import {authorizeGameActor} from './lib/guest-star/d1-actions.ts';
export {GuestStarGames} from './lib/guest-star/games/cloudflare-room.mjs';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
const roomName=scope=>JSON.stringify([scope.hotelId,scope.venueId,scope.activityId,scope.runId]);
/** Additive route; all existing requests delegate unchanged to the production Worker. */
export function createGamesWorker(base){return {async fetch(request,env,ctx){
 const url=new URL(request.url);if(url.pathname!=='/api/games')return base.fetch(request,env,ctx);
 if(!env.GUEST_STAR_GAMES || !env.GUEST_STAR_DB)return json({ok:false,code:'GAME_ENGINE_UNAVAILABLE'},503);
 if(request.headers.get('Upgrade')?.toLowerCase()==='websocket'){
  const room=url.searchParams.get('room') || '',ticket=url.searchParams.get('ticket') || '';
  if(room.length>700||!ticket)return json({ok:false,code:'INVALID_TICKET'},403);
  let scope;try{scope=JSON.parse(room);}catch{return json({ok:false,code:'INVALID_ROOM'},400);}
  if(!Array.isArray(scope)||scope.length!==4||!scope.every(v=>typeof v==='string'&&/^[\w.:-]{1,160}$/.test(v)))return json({ok:false,code:'INVALID_ROOM'},400);
  const stub=env.GUEST_STAR_GAMES.get(env.GUEST_STAR_GAMES.idFromName(room));
  const headers=new Headers(request.headers);headers.delete('Cookie');headers.delete('Authorization');
  return stub.fetch(new Request('https://games.internal/connect?ticket='+encodeURIComponent(ticket),{headers}));
 }
 if(request.method!=='POST')return json({ok:false,code:'METHOD_NOT_ALLOWED'},405);
 const origin=request.headers.get('Origin');if(origin&&origin!==url.origin)return json({ok:false,code:'ORIGIN_DENIED'},403);
 const raw=await request.text();if(new TextEncoder().encode(raw).length>65536)return json({ok:false,code:'REQUEST_TOO_LARGE'},413);
 let body;try{body=JSON.parse(raw);}catch{return json({ok:false,code:'INVALID_JSON'},400);}
 if(!['list','snapshot','command','ticket','templates.list','templates.save','templates.clone','offers.save'].includes(body.action))return json({ok:false,code:'INVALID_ACTION'},400);
 if(!body.activitySessionToken){const token=String(request.headers.get('Cookie') || '').split(';').map(v=>v.trim()).find(v=>v.startsWith('guest_star_activity_session='));if(token)body.activitySessionToken=decodeURIComponent(token.slice(token.indexOf('=')+1));}
 try{
  const actor=await authorizeGameActor(env.GUEST_STAR_DB,body),room=roomName(actor.scope);
  if(body.action.startsWith('templates.')||body.action==='offers.save')return json(await handleShowTemplates(env.GUEST_STAR_DB,body,actor));
  if(body.command?.type==='show.create'&&body.command.payload?.template){body.command.payload.config=await materializeShowTemplate(env.GUEST_STAR_DB,body.command.payload.template,actor,body.command.payload.overrides || {});}
  if(body.command?.type==='game.create'||body.command?.type==='show.create'||body.command?.type==='show.segment.insert'){const allowed=await showOffers(env.GUEST_STAR_DB,actor.scope.hotelId,actor.scope.activityId),requested=body.command.type==='game.create'?[body.command.payload?.definitionId]:body.command.type==='show.segment.insert'?[body.command.payload?.segment?.definitionId]:(body.command.payload?.config?.segments || []).map(s=>s.definitionId);if(allowed&&!requested.every(id=>allowed.includes(id)))return json({ok:false,code:'HOTEL_FORMAT_NOT_ENABLED'},403);}
  const stub=env.GUEST_STAR_GAMES.get(env.GUEST_STAR_GAMES.idFromName(room));
  const upstream=await stub.fetch(new Request('https://games.internal/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({actor,action:body.action,gameId:body.gameId,showId:body.showId,command:body.command})}));
  if(body.action==='ticket'&&upstream.ok){const result=await upstream.json();const websocketUrl=new URL('/api/games',request.url);websocketUrl.protocol=websocketUrl.protocol==='https:'?'wss:':'ws:';websocketUrl.searchParams.set('room',room);websocketUrl.searchParams.set('ticket',result.ticket);return json({...result,room,websocketUrl:websocketUrl.href});}if(body.action==='list'&&upstream.ok){const result=await upstream.json(),allowed=await showOffers(env.GUEST_STAR_DB,actor.scope.hotelId,actor.scope.activityId);if(allowed)result.definitions=result.definitions.filter(d=>allowed.includes(d.id));return json(result);}return upstream;
 }catch(error){return json({ok:false,code:error.message},['FORBIDDEN','UNAUTHORIZED','SESSION_REQUIRED','SESSION_EXPIRED','SESSION_DEVICE_MISMATCH'].includes(error.message)?403:409);}
}};}
