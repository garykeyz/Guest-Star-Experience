// Only the final overlay reads this authoritative payload. Normal presentation
// and all media transports remain under their existing controllers.
export function renderSessionFinale(next, root=document) {
  const final = next.finalExperience;
  let panel = root.querySelector('#sessionFinale');
  if(!panel) {
    panel=root.createElement('section');panel.id='sessionFinale';panel.setAttribute('aria-live','polite');
    panel.style.cssText='position:absolute;z-index:8;inset:30% 12% auto;padding:4%;text-align:center;background:rgba(24,24,24,.96);border:1px solid var(--gs-accent,#d5af35);border-radius:24px;color:white;font-size:28px';
    panel.innerHTML='<small>GUEST STAR EXPERIENCE</small><h2></h2><p></p><div><small></small><h3></h3><p></p></div>';
    root.querySelector('#starScreenCanvas').append(panel);
  }
  panel.hidden=final?.finished!==true || final.hotelId!==next.hotelId || final.activityId!==next.activityId || final.venueId!==next.venueId;
  const welcome=root.querySelector('#starScreenWelcome');
  if(welcome)welcome.hidden=!panel.hidden;
  if(panel.hidden)return;
  const language=next.starScreenLanguage||next.finalLanguage||next.guestLanguage||'en';
  const copy=language==='es'?['GRACIAS POR ACOMPAÑARNOS','Nos vemos la próxima vez.','VOLVEREMOS']:language==='fr'?['MERCI D’AVOIR ÉTÉ AVEC NOUS','À la prochaine.','NOUS REVIENDRONS']:['THANK YOU FOR JOINING US','See you next time.','WE’LL BE BACK'];
  const branding=final.branding||{};
  let localized={};try{const messages=typeof branding.localizedMessagesJson==='object'?branding.localizedMessagesJson:JSON.parse(branding.localizedMessagesJson||'{}');localized=messages?.[language]||{};}catch{}
  panel.querySelector('h2').textContent=localized.activityFinishedTitle||branding.activityFinishedTitle||copy[0];
  panel.querySelector('p').textContent=final.message||localized.activityFinishedMessage||localized.activityEndingMessage||branding.activityFinishedMessage||branding.activityEndingMessage||copy[1];
  const upcoming=final.nextActivity;
  const section=panel.querySelector('div');section.hidden=!upcoming?.scheduledStartAt;
  if(section.hidden)return;
  section.querySelector('small').textContent=copy[2];
  section.querySelector('h3').textContent=new Date(upcoming.scheduledStartAt).toLocaleString(language,{timeZone:upcoming.timezone||next.hotelTimeZone||'UTC',weekday:'long',month:'long',day:'numeric',hour:'numeric',minute:'2-digit'});
  section.querySelector('p').textContent=[upcoming.hotelName,upcoming.venueName,upcoming.activityName].filter(Boolean).join(' · ');
}
