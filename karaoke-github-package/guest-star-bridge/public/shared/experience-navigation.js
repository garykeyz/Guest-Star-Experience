/** Presentation only: operational truth always comes from the existing server snapshot. */
export const SCREENS = Object.freeze(['HOME','HOTEL_SELECT','ACTIVITY_SELECT','EXPERIENCE_SELECT','KARAOKE_ENGINE_SELECT','GAME_SELECT','GAME_CONFIG','SHOW_DIRECTOR','PREPARE_EXPERIENCE','LIVE_SHOW']);
const edges = {
 HOME:['HOTEL_SELECT','ACTIVITY_SELECT','EXPERIENCE_SELECT','LIVE_SHOW'],
 HOTEL_SELECT:['HOME','ACTIVITY_SELECT'], ACTIVITY_SELECT:['HOME','HOTEL_SELECT','EXPERIENCE_SELECT','LIVE_SHOW'],
 EXPERIENCE_SELECT:['HOME','ACTIVITY_SELECT','KARAOKE_ENGINE_SELECT','PREPARE_EXPERIENCE','GAME_SELECT','SHOW_DIRECTOR','LIVE_SHOW'],
 KARAOKE_ENGINE_SELECT:['EXPERIENCE_SELECT','PREPARE_EXPERIENCE','LIVE_SHOW'],
 GAME_SELECT:['EXPERIENCE_SELECT','SHOW_DIRECTOR','GAME_CONFIG','LIVE_SHOW'],
 GAME_CONFIG:['GAME_SELECT','PREPARE_EXPERIENCE'],
 SHOW_DIRECTOR:['EXPERIENCE_SELECT','GAME_SELECT','KARAOKE_ENGINE_SELECT','PREPARE_EXPERIENCE','LIVE_SHOW'],
 PREPARE_EXPERIENCE:['EXPERIENCE_SELECT','KARAOKE_ENGINE_SELECT','SHOW_DIRECTOR','LIVE_SHOW'],
 LIVE_SHOW:['HOME','EXPERIENCE_SELECT','GAME_SELECT','SHOW_DIRECTOR','PREPARE_EXPERIENCE']
};
const unavailable = new Set(['finished','cancelled','canceled','archived','disabled','unavailable','deleted','inactive']);
export const available = row => Boolean(row && row.active !== false && !unavailable.has(String(row.status || '').toLowerCase()));
export function authorizedHotels(state) {
 return (state?.account?.authenticated ? state.account.selection?.hotels || [] : []).filter(available);
}
export function authorizedActivities(state,hotelId) {
 const venues=state?.account?.selection?.venues || [];
 return (state?.account?.selection?.activities || []).filter(row => row.hotelId===hotelId && authorizedHotels(state).some(h=>h.hotelId===hotelId) && venues.some(v=>v.hotelId===hotelId && v.venueId===row.venueId && available(v)) && available(row) && !(state.tenant?.activity?.activityId===row.activityId && !available(state.tenant.activity)));
}
export function operationalContext(state) {
 const current=state?.account?.current || {};
 return [current.hotelId || '',current.venueId || '',state?.entryContext?.sessionType==='free' ? state.entryContext.sessionId : current.activityId || '',state?.tenant?.session?.runId || state?.activity?.activityStartedAt || ''].join('|');
}
export function hasContext(state) {
 if(!state?.account?.authenticated)return false;
 if(state.entryContext?.sessionType==='free')return Boolean(state.entryContext.sessionId && state.tenant?.activity);
 const c=state.account.current;
 return Boolean(c?.activityId && authorizedActivities(state,c.hotelId).some(a=>a.activityId===c.activityId && a.venueId===c.venueId));
}
export function canVisit(screen,state,{hotelId,gameId}={},registry=[]) {
 if(!SCREENS.includes(screen) || !state?.account?.authenticated || state.account.user?.mustChangePassword)return false;
 if(screen==='HOME')return true;
 if(screen==='HOTEL_SELECT' || screen==='ACTIVITY_SELECT')return !state.activity?.activityRunning && (screen==='HOTEL_SELECT' || authorizedHotels(state).some(h=>h.hotelId===hotelId));
 if(!hasContext(state))return false;
 if(screen==='GAME_CONFIG')return registry.some(g=>g.id===gameId && g.status==='available' && typeof g.configure==='function' && typeof g.start==='function');
 if(screen==='LIVE_SHOW')return ['player','bridge'].includes(state.operatingMode?.selected);
 return true;
}
export function createNavigation({getState,registry=[]}) {
 let screen='HOME',context={},history=[];
 return {
  get screen(){return screen;}, get context(){return {...context};},
  move(target,patch={}, {reset=false}={}) {
   const next={...context,...patch};
   if(!canVisit(target,getState(),next,registry) || (!reset && target!==screen && !edges[screen]?.includes(target)))return false;
   if(!reset && target!==screen)history.push({screen,context});
   if(reset)history=[];
   screen=target;context=next;return true;
  },
  back(){while(history.length){const previous=history.pop();if(canVisit(previous.screen,getState(),previous.context,registry)){screen=previous.screen;context=previous.context;return true;}}return this.move('HOME',{}, {reset:true});},
  serialize(){const s=getState();return {version:1,userId:s?.account?.user?.userId || s?.account?.user?.id || '',scope:operationalContext(s),screen,context:{hotelId:context.hotelId,experience:context.experience,gameId:context.gameId}};},
  restore(saved){const s=getState();if(saved?.version!==1 || saved.userId!==(s?.account?.user?.userId || s?.account?.user?.id || '') || saved.scope!==operationalContext(s))return false;return this.move(saved.screen,saved.context || {},{reset:true});}
 };
}
