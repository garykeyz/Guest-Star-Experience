import {createNavigation,authorizedHotels,authorizedActivities,hasContext,operationalContext} from './shared/experience-navigation.js';
import {GAME_REGISTRY} from './shared/game-registry.js';
import {createConsoleThemeCache,safeLogo} from './shared/console-theme.js';
import {entryContextId} from './entry-flow.js';
import {currentHostActivityAccess} from './host-activity-access.js';

const paths={mic:'M9 3a3 3 0 0 1 6 0v8a3 3 0 0 1-6 0V3m-3 7v1a6 6 0 0 0 12 0v-1M12 17v4m-4 0h8',game:'M8 8h8c4 0 6 10 3 11-2 1-3-3-5-3h-4c-2 0-3 4-5 3C2 18 4 8 8 8m-1 3v4m-2-2h4m7-1h.01m2 2h.01',star:'m12 2 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6',music:'M9 18V5l11-2v13M9 5v4l11-2M9 18c0 3-6 3-6 0s6-3 6 0m11-2c0 3-6 3-6 0s6-3 6 0',hotel:'M4 21V3h16v18M8 7h2m4 0h2M8 11h2m4 0h2M10 21v-6h4v6',calendar:'M5 5h14v16H5V5m3-3v6m8-6v6M5 10h14m-10 4h2m3 0h2m-7 3h2',play:'m8 4 12 8-12 8V4',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8m-2-6h4l1 4 4 1 2 4-3 3 1 4-4 2-3-3-4 1-2-4 3-3-1-4 4-2 3 3',teams:'M9 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6m7 1a3 3 0 0 1 0 6M3 21v-3a6 6 0 0 1 12 0v3m3-6a5 5 0 0 1 3 5',lyrics:'M4 5h16M4 10h12M4 15h16M4 20h9',trivia:'M9 7a3 3 0 1 1 5 2c-2 1-2 2-2 4m0 4h.01M4 3h16v18H4V3',shuffle:'M3 5h3c5 0 7 14 12 14h3m-4-4 4 4-4 3M3 19h3c2 0 4-4 5-7m3-4c1-2 2-3 4-3h3m-4-3 4 3-4 4',wheel:'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m0 0v20M2 12h20M5 5l14 14M5 19 19 5'};
const icon=name=>{const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');const path=document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',paths[name]||paths.star);svg.append(path);return svg;};
function element(tag,className,text){const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}

/** A modal presentation layer; opening/closing it never controls playback or activity lifecycle. */
export function initExperienceConsole({getState,api,applyState,getMountedMode,readBrand,selectEngine,openPreferences,openPreparation,openParticipants,openStarScreen,openPreview,notify}) {
 const runtimeRegistry=[],theme=createConsoleThemeCache(),nav=createNavigation({getState,registry:runtimeRegistry});
 let showDirector=null,childScope='',gameHost=null,gameError='',gameLoaded=false;
 async function showGameCatalog(){move('GAME_SELECT',{experience:'game'});try{if(!gameHost){const {createGameHost}=await import('./game-host.js');gameHost=createGameHost({getState,notify});}const definitions=await gameHost.definitions();runtimeRegistry.splice(0,runtimeRegistry.length,...definitions.map(d=>({...d,status:d.available===false?'pending':'available',configure:()=>gameHost.open(d.id),start:()=>gameHost.open(d.id)})));gameLoaded=true;gameError='';}catch(error){gameLoaded=false;gameError=error.message;}render(true);}
 async function openDirector(){if(!gameHost){const {createGameHost}=await import('./game-host.js');gameHost=createGameHost({getState,notify});}if(!showDirector){const {createShowDirector}=await import('./show-director.js');showDirector=createShowDirector({getState,gameHost,notify});}close();await showDirector.open();}
 async function openRegisteredGame(game){if(!move('GAME_CONFIG',{gameId:game.id}))return;close();await gameHost.open(game.id);}
 const dialog=element('dialog','experience-console');dialog.id='experienceConsole';dialog.setAttribute('aria-labelledby','experienceConsoleTitle');dialog.dataset.noI18n='';document.body.append(dialog);
 const launcher=element('button','button ghost','Experiencias');launcher.id='experienceQuickMenu';launcher.type='button';launcher.hidden=true;launcher.setAttribute('aria-haspopup','dialog');document.querySelector('.topbar-actions').prepend(launcher);
 const entry=document.getElementById('entryShell');
 const entryHome=element('button','button','Abrir Home');entryHome.type='button';entry?.prepend(entryHome);
 let signature='',busy=false,opener=null,scope='',activeHotel='',lastUser='';
 const tr=(es,en)=>getState()?.config?.uiLanguage==='en'?en:es;
 const storageKey='guest-star:experience-navigation:v1';
 const remember=()=>{try{sessionStorage.setItem(storageKey,JSON.stringify(nav.serialize()));}catch{}};
 const currentHotel=()=>getState()?.account?.current?.hotelId || '';
 const contextHotel=()=>nav.context.hotelId || currentHotel();
 const brandFor=id=>theme.resolve(getState(),id,readBrand);
 function move(target,patch={},options={}){if(!nav.move(target,patch,options))return false;signature='';remember();render(true);return true;}
 function action(label,callback,{primary=false,disabled=false}={}){const b=element('button',primary?'console-action is-primary':'console-action',label);b.type='button';b.disabled=disabled;b.onclick=async()=>{if(busy)return;try{await callback();}catch(error){notify(error.message,true);}};return b;}
 function card(title,description,symbol,callback,{disabled=false,badge='',primary=false,selected=false}={}){
  const b=action('',callback,{disabled});b.className=`console-card${primary?' console-featured':''}`;b.setAttribute('aria-pressed',String(selected));
  const ornament=element('span','console-card-icon');ornament.append(icon(symbol));const content=element('span','console-card-copy');content.append(element('strong','',title),element('span','',description));
  b.append(ornament,content);if(badge)b.append(element('small','console-badge',badge));return b;
 }
 function close(){if(dialog.open)dialog.close();signature='';opener?.focus?.();}
 function enterControl({prepare=false}={}) {
  const state=getState(),mode=state.operatingMode?.selected;
  if(!hasContext(state) || !['player','bridge'].includes(mode))return;
  remember();
  if(getMountedMode()){if(prepare)move('PREPARE_EXPERIENCE',{}, {reset:true});else {nav.move('LIVE_SHOW',{}, {reset:true});close();}}
  else location.assign('/operate?mode='+encodeURIComponent(mode)+'&context='+encodeURIComponent(entryContextId(state))+(prepare?'&prepare=1':''));
 }
 function karaoke(){
  const s=getState();
  if(['player','bridge'].includes(s.operatingMode?.selected))move('PREPARE_EXPERIENCE',{experience:'karaoke'});
  else move('KARAOKE_ENGINE_SELECT',{experience:'karaoke'});
 }
 async function selectActivity(row){
  if(getState()?.activity?.activityRunning)throw Error(tr('Continúa el show actual antes de cambiar de actividad.','Continue the current show before changing activity.'));
  busy=true;render(true);
  try {
   const next=await api('/api/auth/selection',{method:'POST',body:JSON.stringify({hotelId:row.hotelId,venueId:row.venueId,activityId:row.activityId,rememberSelection:true})});
   applyState(next);
   if(!hasContext(next) || next.account.current.activityId!==row.activityId)throw Error('El servidor no confirmó la actividad.');
   scope=operationalContext(next);activeHotel=row.hotelId;
   move(next.activity?.activityRunning && next.operatingMode?.selected?'LIVE_SHOW':'EXPERIENCE_SELECT',{hotelId:row.hotelId},{reset:true});
   if(next.activity?.activityRunning && next.operatingMode?.selected)enterControl();
  }finally{busy=false;render(true);}
 }
 async function freeMode(){
  if(getState()?.activity?.activityRunning)throw Error(tr('Hay un show activo. Continúalo desde Home.','A show is active. Continue it from Home.'));
  busy=true;
  try{const next=await api('/api/entry/free',{method:'POST',body:'{}'});applyState(next);scope=operationalContext(next);activeHotel='';move('EXPERIENCE_SELECT',{hotelId:''},{reset:true});}finally{busy=false;render(true);}
 }
 function activities(){const hotels=authorizedHotels(getState());const selected=hotels.find(h=>h.hotelId===currentHotel());if(selected || hotels.length===1)move('ACTIVITY_SELECT',{hotelId:(selected||hotels[0]).hotelId});else move('HOTEL_SELECT');}
 function open(screen='HOME') {
  const s=getState();if(!s?.account?.authenticated || s.account.user?.mustChangePassword)return false;
  // Opening a menu never leaves the mounted workspace or calls entry/prepare.
  opener=document.activeElement;scope=operationalContext(s);activeHotel=currentHotel();
  if(!nav.move(screen,{hotelId:currentHotel()},{reset:true}))nav.move('HOME',{}, {reset:true});
  if(!dialog.open)dialog.showModal();signature='';render(true);remember();return true;
 }
 function detail(list,label,value){const row=element('div','console-detail');row.append(element('dt','',label),element('dd','',String(value || '—')));list.append(row);}
 function render(force=false){
  const s=getState(),nextChildScope=(s?.account?.authenticated?s.account.user?.userId || s.account.user?.id:'')+'|'+operationalContext(s);if(childScope&&childScope!==nextChildScope){gameHost?.dispose();showDirector?.dispose();gameHost=null;showDirector=null;gameLoaded=false;gameError='';}childScope=nextChildScope;launcher.hidden=!s?.account?.authenticated || Boolean(s.account.user?.mustChangePassword);entryHome.hidden=launcher.hidden;
  launcher.textContent=tr('Experiencias','Experiences');entryHome.textContent=tr('Abrir Home','Open Home');
  if(!s?.account?.authenticated){theme.resolve(s,'');lastUser='';close();try{sessionStorage.removeItem(storageKey);}catch{}return;}
  const user=s.account.user?.userId || s.account.user?.id || '';
  if(lastUser && user!==lastUser){close();nav.move('HOME',{}, {reset:true});}lastUser=user;
  if(!dialog.open)return;
  if(scope!==operationalContext(s)){scope=operationalContext(s);activeHotel=currentHotel();nav.move(s.activity?.activityRunning && s.operatingMode?.selected?'LIVE_SHOW':'HOME',{hotelId:currentHotel()},{reset:true});signature='';}
  if(!['HOME','HOTEL_SELECT'].includes(nav.screen) && !nav.move(nav.screen))nav.move('HOME',{}, {reset:true});
  const hotelId=contextHotel(),hotel=authorizedHotels(s).find(h=>h.hotelId===hotelId),brand=brandFor(hotelId);
  const stamp=JSON.stringify([nav.screen,nav.context,s.account.current,s.account.selection,[s.tenant?.hotel,s.tenant?.activity,s.tenant?.upcomingActivities,s.tenant?.kioskAccess],s.activity?.activityRunning,s.activity?.accepting,s.operatingMode,s.virtualDJ?.playback?.connected,s.config?.uiLanguage,brand,busy]);
  if(!force && signature===stamp)return;signature=stamp;
  const focusKey=document.activeElement?.dataset?.consoleFocus;
  theme.apply(dialog,brand);dialog.dataset.screen=nav.screen;dialog.setAttribute('aria-busy',String(busy));
  const top=element('header','console-top'),identity=element('div','console-identity');
  const product=element('img','console-product');product.src='/branding/brand-horizontal.png';product.alt='Guest Star Experience';identity.append(product);
  const url=safeLogo(brand.hotelLogoUrl || hotel?.logoUrl);
  if(url){const logo=element('img','console-hotel-logo');logo.alt=hotel?.name || tr('Hotel','Hotel');logo.referrerPolicy='no-referrer';logo.src=url;logo.onerror=()=>logo.remove();identity.append(logo);}
  top.append(identity,action(tr('Cerrar','Close'),close));
  const breadcrumbs=element('nav','console-breadcrumbs');breadcrumbs.setAttribute('aria-label',tr('Navegación de experiencias','Experience navigation'));breadcrumbs.append(action('Home',()=>move('HOME',{}, {reset:true})));
  if(nav.screen!=='HOME')breadcrumbs.append(action(tr('Atrás','Back'),()=>{nav.back();render(true);remember();}));
  breadcrumbs.append(element('span','', [hotel?.name,s.tenant?.activity?.name && hasContext(s) && hotelId===currentHotel()?s.tenant.activity.name:''].filter(Boolean).join(' / ') || 'Guest Star Experience'));
  const names={HOME:tr('Tu próximo gran momento.','Your next great moment.'),HOTEL_SELECT:tr('Elige el escenario.','Choose your venue.'),ACTIVITY_SELECT:tr('Cada actividad, su experiencia.','Every activity, its experience.'),EXPERIENCE_SELECT:tr('¿Qué vamos a vivir hoy?','What will we experience today?'),KARAOKE_ENGINE_SELECT:tr('Tu karaoke. Tu motor.','Your karaoke. Your engine.'),GAME_SELECT:'Game Arena',GAME_CONFIG:tr('Configurar juego','Configure game'),SHOW_DIRECTOR:'Show Director',PREPARE_EXPERIENCE:tr('Todo listo para el show.','Ready for the show.'),LIVE_SHOW:tr('Tu show sigue aquí.','Your show is right here.')};
  const hero=element('section','console-hero');hero.append(element('p','console-eyebrow',nav.screen.replaceAll('_',' ')));
  const title=element('h2','',names[nav.screen]);title.id='experienceConsoleTitle';title.tabIndex=-1;hero.append(title);
  hero.append(element('p','console-description',nav.screen==='SHOW_DIRECTOR'?tr('Una actividad. Todas tus experiencias.','One activity. All your experiences.'):tr('Elige, prepara y vuelve al escenario.','Choose, prepare, and return to the stage.')));
  const grid=element('div','console-grid');
  if(nav.screen==='HOME') {
   if(s.activity?.activityRunning && hasContext(s) && s.operatingMode?.selected)grid.append(card(tr('CONTINUAR SHOW','CONTINUE SHOW'),s.tenant?.activity?.name || tr('Sesión activa','Active session'),'play',()=>enterControl(),{primary:true,badge:tr('En curso','Live')}));
   if(s.entryContext?.resumableFreeSession && s.account.user?.role==='superhost')grid.append(card(tr('Continuar sesión libre','Resume free session'),tr('Recuperar sesión guardada','Recover saved session'),'play',async()=>{const next=await api('/api/entry/free/resume',{method:'POST',body:'{}'});applyState(next);enterControl();}));
   const upcoming=[...(s.tenant?.upcomingActivities || [])].filter(r=>authorizedActivities(s,r.hotelId).some(a=>a.activityId===r.activityId)).filter(r=>Number.isFinite(Date.parse(r.scheduledStartAt || r.startsAt))).sort((a,b)=>Date.parse(a.scheduledStartAt||a.startsAt)-Date.parse(b.scheduledStartAt||b.startsAt))[0];
   const upcomingActivity=upcoming && authorizedActivities(s,upcoming.hotelId).find(a=>a.activityId===upcoming.activityId);
   if(upcomingActivity)grid.append(card(tr('Próxima actividad','Next activity'),[upcomingActivity.name,authorizedHotels(s).find(h=>h.hotelId===upcoming.hotelId)?.name,formatDate(upcoming.scheduledStartAt||upcoming.startsAt,s,upcoming.timezone),upcoming.status].filter(Boolean).join(' · '),'calendar',()=>selectActivity(upcomingActivity),{disabled:s.activity?.activityRunning}));
   grid.append(card(tr('Agenda','Agenda'),tr('Tus actividades autorizadas.','Your authorized activities.'),'calendar',activities,{disabled:s.activity?.activityRunning}),card(tr('Modo libre','Free mode'),tr('Una sesión independiente de la agenda.','A session outside the schedule.'),'star',freeMode,{disabled:s.activity?.activityRunning}),card(tr('Configuración','Settings'),tr('Preferencias de este Host.','Preferences for this Host.'),'settings',()=>{close();openPreferences();}));
   if(hasContext(s))grid.append(card(tr('Experiencias','Experiences'),s.tenant?.activity?.name || 'Guest Star','game',()=>move('EXPERIENCE_SELECT')));
  }
  if(nav.screen==='HOTEL_SELECT')for(const h of authorizedHotels(s)){
   const b=brandFor(h.hotelId),c=card(h.name,tr('Seleccionar hotel','Select hotel'),'hotel',()=>move('ACTIVITY_SELECT',{hotelId:h.hotelId}),{selected:h.hotelId===hotelId});theme.apply(c,b);
   const logoUrl=safeLogo(b.hotelLogoUrl || h.logoUrl);if(logoUrl){const image=element('img','console-choice-logo');image.src=logoUrl;image.alt=h.name;image.onerror=()=>image.remove();c.prepend(image);}grid.append(c);
  }
  if(nav.screen==='ACTIVITY_SELECT') {
   if(authorizedHotels(s).length>1)grid.append(card(tr('Cambiar hotel','Change hotel'),hotel?.name || '','hotel',()=>move('HOTEL_SELECT')));
   for(const row of authorizedActivities(s,hotelId)){
    const schedule=(s.tenant?.upcomingActivities || []).find(a=>a.hotelId===row.hotelId && a.activityId===row.activityId);
    const venue=s.account.selection.venues.find(v=>v.venueId===row.venueId && v.hotelId===row.hotelId);
    grid.append(card(row.name,[venue?.name,schedule?formatDate(schedule.scheduledStartAt||schedule.startsAt,s,schedule.timezone):'',row.status,row.defaultExperience].filter(Boolean).join(' · '),'calendar',()=>selectActivity(row),{badge:tr('Preparar','Prepare'),selected:row.activityId===s.account.current?.activityId}));
   }
   if(!authorizedActivities(s,hotelId).length)grid.append(element('p','console-empty',tr('No hay actividades disponibles para este hotel.','No activities are available for this hotel.')));
  }
  if(nav.screen==='EXPERIENCE_SELECT')grid.append(
   card('Karaoke',tr('Karaoke tradicional — solicitudes, cantantes y reproducción.','Traditional karaoke — requests, singers and playback.'),'mic',karaoke,{primary:true}),
   card('Game Arena',tr('Juegos interactivos, desafíos musicales y competencias.','Interactive games, music challenges and competitions.'),'game',showGameCatalog),
   card(tr('Show Mixto','Mixed Show'),tr('Karaoke y juegos dentro de una misma actividad.','Karaoke and games in one activity.'),'star',()=>move('SHOW_DIRECTOR',{experience:'mixed'})));
  if(nav.screen==='KARAOKE_ENGINE_SELECT') {
   const mode=s.operatingMode?.selected,locked=Boolean(getMountedMode()) || s.activity?.activityRunning || s.operatingMode?.locked;
   grid.append(card('VirtualDJ Bridge',tr('Conserva la cola real de VirtualDJ.','Preserves the real VirtualDJ queue.'),'music',()=>getMountedMode()?move('PREPARE_EXPERIENCE'):selectEngine('bridge'),{selected:mode==='bridge',disabled:locked && mode!=='bridge',badge:bridgeStatus(s)}),card('Guest Star Player',tr('Audio y vídeo con el motor nativo existente.','Audio and video with the existing native engine.'),'mic',()=>getMountedMode()?move('PREPARE_EXPERIENCE'):selectEngine('player'),{selected:mode==='player',disabled:locked && mode!=='player',badge:tr('Motor nativo','Native engine')}));
  }
  if(nav.screen==='GAME_SELECT'){
   if(gameError)grid.append(element('p','console-note',tr('Motor de juegos no disponible: ','Game engine unavailable: ')+gameError));
   if(gameLoaded)grid.append(card(tr('Mis partidas','My games'),tr('Recuperar partidas de esta actividad.','Recover games in this activity.'),'play',()=>{close();return gameHost.open();}));
   for(const game of gameLoaded?runtimeRegistry:[]){const meta=GAME_REGISTRY.find(g=>g.id===game.id);grid.append(card(game.name,meta?.description || game.description,meta?.icon || (game.kind==='performance'?'star':'game'),()=>openRegisteredGame(game),{disabled:game.status!=='available',badge:game.status==='available'?tr('Motor conectado','Engine connected'):game.availability==='unavailable'?tr('Pendiente de validación','Awaiting validation'):tr('Requiere integración audiovisual','Requires media integration')}));}if(gameLoaded&&!runtimeRegistry.length)grid.append(element('p','console-note',tr('No hay formatos habilitados para esta actividad.','No formats are enabled for this activity.')));
  }
  if(nav.screen==='SHOW_DIRECTOR'){
   grid.append(card('Show Composer',tr('Programas mixtos, noche abierta, plantillas y decisiones del público.','Mixed programs, open nights, templates and audience decisions.'),'star',openDirector,{primary:true}));
   grid.append(card(tr('Karaoke','Karaoke'),s.operatingMode?.selected==='bridge'?'VirtualDJ Bridge':s.operatingMode?.selected==='player'?'Guest Star Player':tr('Seleccionar motor','Select engine'),'mic',karaoke,{badge:s.activity?.activityRunning?tr('En curso','Live'):tr('Preparar','Prepare')}),card('Game Arena',tr('Preparar otra experiencia sin interrumpir el show.','Prepare another experience while the show continues.'),'game',showGameCatalog));
   grid.append(element('p','console-note',tr('El programa coordina karaoke, juegos, clasificaciones y decisiones del público dentro de la misma actividad.','The program coordinates karaoke, games, standings and audience decisions within the same activity.')));
  }
  if(nav.screen==='PREPARE_EXPERIENCE'){
   const list=element('dl','console-details'),access=currentHostActivityAccess(s,{superhostInHostView:true});
   detail(list,tr('Hotel / actividad','Hotel / activity'),[s.tenant?.hotel?.name,s.tenant?.activity?.name].filter(Boolean).join(' / '));
   detail(list,tr('Motor','Engine'),s.operatingMode?.selected==='bridge'?'VirtualDJ Bridge':s.operatingMode?.selected==='player'?'Guest Star Player':tr('Sin seleccionar','Not selected'));
   detail(list,tr('Conexión','Connection'),s.operatingMode?.selected==='bridge'?bridgeStatus(s):tr('Player nativo · control de audio en Live Show','Native player · audio controls in Live Show'));
   detail(list,tr('Solicitudes','Requests'),s.activity?.accepting?tr('Abiertas','Open'):tr('Cerradas','Closed'));
   detail(list,'PIN',access?.pin || access?.activityPin || tr('Consultar acceso en el control del show','See access in show controls'));
   detail(list,tr('Cola','Queue'),tr('Cola y controles existentes en Live Show','Existing queue and controls in Live Show'));
   grid.append(list);
   const controls=element('div','console-prepare-actions');
   controls.append(action(tr('Entrar al control del show','Enter show controls'),()=>enterControl(),{primary:true,disabled:!s.operatingMode?.selected}));
   if(getMountedMode())controls.append(action(tr('Programación y solicitudes','Schedule and requests'),()=>{close();openPreparation();}));
   if(getMountedMode()==='player')controls.append(action('Star Screen',()=>{close();openStarScreen();}),action(tr('Vista previa','Preview'),()=>{close();openPreview();}));
   controls.append(action(tr('Preferencias de audio y vídeo','Audio and video preferences'),()=>{close();openPreferences();}));
   if(!s.activity?.activityRunning)controls.append(action(tr('Elegir motor','Choose engine'),()=>move('KARAOKE_ENGINE_SELECT')));
   grid.append(controls);
  }
  if(nav.screen==='LIVE_SHOW')grid.append(card(tr('Continuar show','Continue show'),s.tenant?.activity?.name || '','play',()=>enterControl(),{primary:true}),card('Karaoke',tr('Preparación y motor actual','Preparation and current engine'),'mic',karaoke),card('Game Arena',tr('Catálogo de juegos','Game catalog'),'game',showGameCatalog),card('Show Director',tr('Preparar la próxima experiencia','Prepare the next experience'),'star',()=>move('SHOW_DIRECTOR')));
  const footer=element('footer','console-footer');footer.append(element('span','',s.activity?.activityRunning?tr('Show en curso · navegación sin interrupciones','Show live · uninterrupted navigation'):tr('Guest Star Experience · prepara tu escenario','Guest Star Experience · prepare your stage')));
  if(getMountedMode())footer.append(action(tr('Participantes','Participants'),()=>{close();openParticipants();}),action(tr('Volver al show','Back to show'),()=>enterControl(),{primary:true}));
  dialog.replaceChildren(top,breadcrumbs,hero,grid,footer);
  const buttons=[...dialog.querySelectorAll('button')];buttons.forEach((b,i)=>b.dataset.consoleFocus=String(i));
  if(focusKey)buttons.find(b=>b.dataset.consoleFocus===focusKey && !b.disabled)?.focus({preventScroll:true});
 }
 function formatDate(value,s,zone){try{return new Intl.DateTimeFormat(s.config?.uiLanguage || 'es',{dateStyle:'medium',timeStyle:'short',timeZone:zone || s.tenant?.hotel?.timezone || 'UTC'}).format(new Date(value));}catch{return '';}}
 function bridgeStatus(s){return s.virtualDJ?.playback?.connected===true?tr('Conectado','Connected'):tr('Sin conexión confirmada','No confirmed connection');}
 launcher.onclick=()=>open(getMountedMode()?'LIVE_SHOW':'HOME');entryHome.onclick=()=>open();
 dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 dialog.addEventListener('keydown',event=>{
  if(!['ArrowRight','ArrowLeft','ArrowDown','ArrowUp'].includes(event.key) || !event.target.matches('.console-card'))return;
  const cards=[...dialog.querySelectorAll('.console-card:not(:disabled)')],index=cards.indexOf(event.target),direction=['ArrowRight','ArrowDown'].includes(event.key)?1:-1;cards[(index+direction+cards.length)%cards.length]?.focus();event.preventDefault();
 });
 return {open,close,render,openExperiences:()=>open('EXPERIENCE_SELECT'),restore(){try{const saved=JSON.parse(sessionStorage.getItem(storageKey));if(nav.restore(saved)){scope=operationalContext(getState());opener=document.activeElement;dialog.showModal();render(true);return true;}}catch{}return false;},navigation:nav};
}
