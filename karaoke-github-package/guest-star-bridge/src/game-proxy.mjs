/** Isolated cloud adapter: no transport, queue, activity or scheduler commands. */
export function createGameProxy({getConfig,getState,fetcher=fetch}){
 let cached=null,scope='',clockOffset=0;
 const context=s=>[s.account?.current?.hotelId,s.account?.current?.venueId,s.account?.current?.activityId,s.tenant?.session?.runId || s.tenant?.activity?.currentCycleId || ''].join('|');
 return {
  presentation(){if(!getState().account?.authenticated || context(getState())!==scope){cached=null;scope=context(getState());}return {ok:true,presentation:cached?{...cached,...(cached.game?{game:{...cached.game,serverNow:Date.now()+clockOffset}}:{}),...(cached.show?{show:{...cached.show,serverNow:Date.now()+clockOffset}}:{})}:null};},
  async request(body){
   const config=getConfig(),s=getState(),current=s.account?.current;
   if(!s.account?.authenticated || !config.authToken || !config.deviceToken)throw Error('UNAUTHORIZED');
   if(!current?.hotelId || !current?.venueId || !current?.activityId)throw Error('ACTIVITY_REQUIRED');
   const key=context(s);if(scope!==key){scope=key;cached=null;}
   const type=body.command?.type;
   if(['presentation.acquire','show.presentation.acquire'].includes(type)){
    // Fail closed when the selected source cannot confirm an idle output.
    if(s.operatingMode?.selected==='bridge' && s.virtualDJ?.playback?.connected!==true)throw Error('MEDIA_STATE_UNAVAILABLE');
    if(s.operations?.currentPlayback?.playing || s.virtualDJ?.playback?.decks?.some(d=>d.playing))throw Error('KARAOKE_PLAYBACK_ACTIVE');
   }
   const target=new URL('/api/games',config.appsScriptUrl);
   const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
   try {
    const requestedAt=Date.now();
    const upstream=await fetcher(target,{method:'POST',headers:{'Content-Type':'application/json'},signal:controller.signal,body:JSON.stringify({...Object.fromEntries(['action','gameId','showId','command','templateId','commandId','expectedVersion','config','sourceHotelId','sourceTemplateId','sourceVersion','formats','activityOnly'].filter(k=>body[k]!==undefined).map(k=>[k,body[k]])),hotelId:current.hotelId,venueId:current.venueId,activityId:current.activityId,authToken:config.authToken,deviceToken:config.deviceToken})});
    const data=await upstream.json();
    if(Number.isFinite(data.serverNow))clockOffset=data.serverNow-(requestedAt+Date.now())/2;
    if(data.ok!==true)throw Error(data.code || 'GAME_ENGINE_UNAVAILABLE');
    if(context(getState())!==key)throw Error('ACTIVITY_CONTEXT_CHANGED');
    if(body.action==='ticket'){const url=new URL('/api/games',target);url.protocol=url.protocol==='https:'?'wss:':'ws:';url.searchParams.set('room',data.room);url.searchParams.set('ticket',data.ticket);data.websocketUrl=url.href;}
    if(Object.hasOwn(data,'presentation')){
     const show=data.shows?.find(v=>v.id===data.presentation?.showId) || (data.show?.id===data.presentation?.showId?data.show:null);
     const game=data.games?.find(g=>g.id===data.presentation?.gameId) || (data.game?.id===data.presentation?.gameId?data.game:null);
     if(!data.presentation)cached=null;
     else if(show){const active=show.segments.find(s=>s.id===show.activeSegmentId),activeGame=(!data.presentation.scene||data.presentation.scene==='auto')?data.games?.find(g=>g.id===active?.gameId):null;cached={lease:data.presentation,show:{id:show.id,title:show.title,mode:show.mode,status:show.status,revision:show.revision,serverNow:show.serverNow,registrationOpen:show.registrationOpen,categories:show.categories,participantCount:show.participantCount,segments:show.segments.map(s=>({id:s.id,title:s.title,status:s.status})),activeSegmentId:show.activeSegmentId,leaderboard:show.leaderboard,cohorts:show.cohorts,awards:show.awards,results:show.results},game:activeGame?{...activeGame,config:undefined,participants:activeGame.participants?.map(p=>({id:p.id,name:p.name})),round:activeGame.round?{...activeGame.round,scene:activeGame.round.scene}:null}:null};}
     else if(game)cached={lease:data.presentation,game:{protocol:game.protocol,id:game.id,scope:game.scope,definition:game.definition,status:game.status,revision:game.revision,serverNow:game.serverNow,participants:game.participants,teams:game.teams,round:game.round?{id:game.round.id,index:game.round.index,status:game.round.status,scene:game.round.scene,startedAt:game.round.startedAt,deadline:game.round.deadline,remainingMs:game.round.remainingMs,evaluation:game.round.evaluation,choiceResults:game.round.choiceResults,winner:game.round.winner}:null,leaderboard:game.leaderboard,results:game.results}};
    }
    return data;
   }finally{clearTimeout(timeout);}
  }
 };
}
