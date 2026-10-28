export function eligibleActivity(selection, activity) {
  return Boolean(activity && selection && activity.activityId===selection.activityId && activity.hotelId===selection.hotelId && activity.venueId===selection.venueId && !['finished','cancelled','canceled','archived','disabled','unavailable','deleted','inactive'].includes(String(activity.status || '').toLowerCase()));
}
export function rememberedActivity(state) {
  const remembered=state?.entryContext?.rememberedActivity;
  const activity=state?.account?.selection?.activities?.find(a=>eligibleActivity(remembered,a));
  const selection=state?.account?.selection;
  const available=item=>item?.active!==false && !['inactive','disabled','deleted','unavailable'].includes(String(item?.status || '').toLowerCase());
  const accessible=selection?.hotels?.some(h=>h.hotelId===remembered?.hotelId && available(h)) && selection?.venues?.some(v=>v.venueId===remembered?.venueId && v.hotelId===remembered?.hotelId && available(v));
  // The selected tenant has fresher lifecycle data than the cached identity list.
  const current=activity && state?.tenant?.activity?.activityId===activity.activityId ? {...activity,...state.tenant.activity} : activity;
  return activity && eligibleActivity(remembered,current) && accessible ? {...remembered,name:activity.name} : null;
}
export function entryContextId(state) {return state?.entryContext?.sessionType==='free' ? state.entryContext.sessionId : state?.account?.current?.activityId || '';}
