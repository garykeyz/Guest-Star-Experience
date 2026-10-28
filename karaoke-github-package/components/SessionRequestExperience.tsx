"use client";

import { closureMessage } from "@/lib/guest-star/closure-message";

import type { CSSProperties } from "react";
import BrandLogos from "./BrandLogos";
import GameParticipation from "./GameParticipation";
import { brandingTheme } from "@/guest-star-bridge/public/shared/branding-theme";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Delete, Globe2, Mic2, QrCode, RefreshCcw, Sparkles } from "lucide-react";
import KaraokeExperienceClient from "@/components/KaraokeExperienceClient";
import type { ApiResponse } from "@/components/KaraokeExperience";
import { normalizeBrandImageUrl } from "@/lib/guest-star/media-url";
import { clearPublicActivityContext, guestDeviceId, readPublicActivityContext, storePublicActivityContext } from "@/lib/guest-star/public-device";
import { FUNNY_MESSAGES, GUEST_LANGUAGE_CODES, GUEST_LANGUAGES, GUEST_UI_COPY, KIOSK_ATTRACT_CTA, LANGUAGE_BY_CODE } from "@/guest-star-bridge/public/shared/guest-locales.js";

type UiLanguage = "es" | "en" | "fr" | "it" | "de" | "ru" | "pt" | "hi";
type AttractLanguage = UiLanguage;
type AttractMessage = { language: AttractLanguage | null; text: string };
type AttractPool = { languages: AttractLanguage[]; defaults: Partial<Record<AttractLanguage,readonly string[]>>; custom: string[] };
type AttractRotation = {
  last: AttractMessage | null; turn: number; seen: Partial<Record<AttractLanguage,number>>;
  bags: Partial<Record<AttractLanguage,string[]>>; customBag: string[];
};
type Phase = "loading" | "pin" | "activities" | "session" | "public";
type SessionResult = ApiResponse & {
  activitySessionToken?: string;
  sessionExpiresAt?: string;
  retryAfterSeconds?: number;
};
type SavedActivity = {
  key: string; token: string; activityName: string; hotelName: string; venueName: string;
  nextOccurrenceAt: string; status: string; expired: boolean; joinToken?: string;
};

const SESSION_STORAGE_KEY = "guest-star-activity-session-v1";
const REMEMBERED_STORAGE_KEY = "guest-star-remembered-activities-v1";
const KIOSK_SAVED_STORAGE_KEY = "guest-star-kiosk-saved-activities-v1";
const KIOSK_DEFAULT_STORAGE_KEY = "guest-star-kiosk-default-activity-v1";
const LANGUAGE_STORAGE_KEY = "guest-star-kiosk-language-v1";
const IDLE_TIMEOUT_MS = 60_000;
const ATTRACT_MESSAGE_INTERVAL_MS = 7_000;
const ATTRACT_LANGUAGES: readonly AttractLanguage[] = GUEST_LANGUAGE_CODES as readonly AttractLanguage[];

const ATTRACT_MESSAGES: Record<AttractLanguage, readonly string[]> = {
  en: [
    "Scan here to sing 🎤", "Your stage is waiting.", "Pick a song. Become the Guest Star.",
    "Someone has to sing first… 👀", "Don't be shy. We know you sing in the shower.",
    "Your next performance starts right here.", "The microphone is waiting for you.",
    "Think you can steal the show?", "Pick your song before someone else does.",
    "Tonight could be your main-character moment.", "Ready to become the Guest Star?", "Your audience is waiting."
  ],
  es: [
    "Escanea para cantar 🎤", "El escenario te está esperando.", "Elige tu canción y conviértete en Guest Star.",
    "Alguien tiene que cantar primero… 👀", "No seas tímido… sabemos que cantas en la ducha.",
    "Tu próxima presentación comienza aquí.", "El micrófono te está esperando.",
    "¿Crees que puedes robarte el show?", "Elige tu canción antes de que alguien se te adelante.",
    "Esta noche puede ser tu momento.", "¿Listo para convertirte en Guest Star?", "Tu público te está esperando."
  ],
  fr: [
    "Scannez pour chanter 🎤", "La scène vous attend.", "Choisissez votre chanson et devenez la Guest Star.",
    "Quelqu'un doit bien commencer… 👀", "Ne soyez pas timide… on sait que vous chantez sous la douche.",
    "Votre prochaine performance commence ici.", "Le micro vous attend.", "Prêt à voler la vedette ?",
    "Choisissez votre chanson avant quelqu'un d'autre.", "Ce soir pourrait être votre moment.",
    "Prêt à devenir la Guest Star ?", "Votre public vous attend."
  ],
  it: [
    "Scansiona qui per cantare 🎤", "Il palco ti aspetta.", "Scegli una canzone e diventa la Guest Star.",
    "Qualcuno dovrà pur iniziare… 👀", "Non essere timido… sappiamo che canti sotto la doccia.",
    "La tua prossima esibizione inizia qui.", "Il microfono ti aspetta.", "Pronto a rubare la scena?",
    "Scegli la tua canzone prima degli altri.", "Questa potrebbe essere la tua serata.",
    "Pronto a diventare la Guest Star?", "Il pubblico ti aspetta."
  ],
  de: [
    "Scannen und mitsingen 🎤", "Die Bühne wartet auf dich.", "Wähle deinen Song und werde zum Guest Star.",
    "Irgendjemand muss anfangen… 👀", "Keine Scheu… wir wissen, dass du unter der Dusche singst.",
    "Dein nächster Auftritt beginnt hier.", "Das Mikrofon wartet auf dich.",
    "Bereit, allen die Show zu stehlen?", "Such dir deinen Song aus, bevor es jemand anderes tut.",
    "Heute könnte dein großer Moment sein.", "Bereit, ein Guest Star zu werden?", "Dein Publikum wartet."
  ],
  pt: [
    "Escaneie para cantar 🎤", "O palco está esperando por você.", "Escolha sua música e torne-se uma Guest Star.",
    "Alguém precisa começar… 👀", "Não tenha vergonha… sabemos que você canta no banho.",
    "Sua próxima apresentação começa aqui.", "O microfone está esperando por você.",
    "Pronto para roubar a cena?", "Escolha sua música antes que outra pessoa escolha.",
    "Esta noite pode ser o seu momento.", "Pronto para se tornar uma Guest Star?", "Seu público está esperando."
  ],
  ru: [
    "Отсканируйте, чтобы спеть 🎤", "Сцена ждёт вас.", "Выберите песню и станьте Guest Star.",
    "Кто-то должен начать… 👀", "Не стесняйтесь… мы знаем, что вы поёте в душе.",
    "Ваше следующее выступление начинается здесь.", "Микрофон ждёт вас.", "Готовы затмить всех?",
    "Выберите песню, пока это не сделал кто-то другой.", "Сегодня может настать ваш звёздный час.",
    "Готовы стать Guest Star?", "Ваша публика ждёт вас."
  ],
  hi: ["गाने के लिए स्कैन करें 🎤", "मंच आपका इंतज़ार कर रहा है।"]
};

const ATTRACT_CTA: Record<AttractLanguage,string> = {
  en:"SCAN TO SING", es:"ESCANEA PARA CANTAR", fr:"SCANNEZ POUR CHANTER",
  it:"SCANSIONA PER CANTARE", de:"SCANNEN & SINGEN", pt:"ESCANEIE PARA CANTAR",
  ru:"СКАНИРУЙТЕ И ПОЙТЕ", hi:"गाने के लिए स्कैन करें"
};

const translations = {
  en: {
    enter:"Enter Activity PIN", hint:"Ask the host for the six-digit PIN for this activity.",
    joining:"Joining activity…", invalid:"That PIN is not correct.", expired:"That PIN has expired.",
    ended:"Tonight's show has ended.", changed:"Activity PIN has changed.",
    linkExpired:"This activity link has expired.", rate:"Too many attempts. Please wait a moment.",
    newPin:"Enter New Activity PIN", clear:"Clear", enterButton:"Join Activity", another:"Join another activity",
    yourActivities:"Your activities", savedActivities:"Saved Activities", save:"Save this activity", saved:"Saved", setDefault:"Set as default", default:"Default", switchActivity:"Switch Activity", forget:"Forget Activity", access:"Activity Access", share:"Share this activity", next:"Next show", compactNext:"Next", noDate:"No new date has been announced yet.", compactNoDate:"No new date announced", closed:"Requests open when the show begins.", expiredAccess:"Access expired. Enter the new Activity PIN to reconnect.", startsIn:"Starts in", showQr:"Show QR", closeQr:"Close QR",
    unavailable:"Connection unavailable. Try again in a moment.", scan:"Scan here to sing", touch:"Touch anywhere to request on this kiosk",
    phrases:["Scan here to sing 🎤","Your stage is waiting.","Don't be shy. We already heard your shower concerts.","Pick a song. Become the Guest Star.","Someone has to sing first… 👀"]
  },
  es: {
    enter:"Ingresa el PIN de la actividad", hint:"Pide al anfitrión el PIN de seis dígitos de esta actividad.",
    joining:"Conectando con la actividad…", invalid:"Ese PIN no es correcto.", expired:"Ese PIN ha expirado.",
    ended:"El show de hoy ha finalizado.", changed:"El PIN de la actividad ha cambiado.",
    linkExpired:"El enlace de esta actividad ha expirado.", rate:"Demasiados intentos. Espera un momento.",
    newPin:"Ingresar nuevo PIN de la actividad", clear:"Borrar", enterButton:"Entrar a la actividad", another:"Agregar otra actividad",
    yourActivities:"Tus actividades", savedActivities:"Actividades guardadas", save:"Guardar esta actividad", saved:"Guardada", setDefault:"Establecer como predeterminada", default:"Predeterminada", switchActivity:"Cambiar actividad", forget:"Olvidar actividad", access:"Acceso a la actividad", share:"Compartir esta actividad", next:"Próximo show", compactNext:"Próximo", noDate:"Todavía no hay nueva fecha anunciada.", compactNoDate:"Sin nueva fecha anunciada", closed:"Las solicitudes se abren al comenzar el show.", expiredAccess:"Acceso vencido. Ingresa el nuevo PIN de la actividad.", startsIn:"Comienza en", showQr:"Mostrar QR", closeQr:"Cerrar QR",
    unavailable:"No hay conexión. Inténtalo de nuevo en un momento.", scan:"Escanea para cantar", touch:"Toca la pantalla para solicitar aquí",
    phrases:["Escanea y súbete al show 🎤","El escenario te está esperando.","No seas tímido… sabemos que cantas en la ducha.","Elige tu canción y conviértete en Guest Star.","Alguien tiene que cantar primero… 👀"]
  },
  fr: {
    enter:"Saisissez le PIN de l'activité", hint:"Demandez à l’animateur le PIN à six chiffres de cette activité.",
    joining:"Connexion à l’activité…", invalid:"Ce PIN est incorrect.", expired:"Ce PIN a expiré.",
    ended:"Le spectacle de ce soir est terminé.", changed:"Le PIN de l'activité a changé.",
    linkExpired:"Le lien de cette activité a expiré.", rate:"Trop de tentatives. Veuillez patienter.",
    newPin:"Saisir le nouveau PIN", clear:"Effacer", enterButton:"Rejoindre l’activité", another:"Ajouter une autre activité",
    yourActivities:"Vos activités", savedActivities:"Activités enregistrées", save:"Enregistrer cette activité", saved:"Enregistrée", setDefault:"Définir par défaut", default:"Par défaut", switchActivity:"Changer d'activité", forget:"Oublier l'activité", access:"Accès à l'activité", share:"Partager cette activité", next:"Prochain spectacle", compactNext:"Prochain", noDate:"Aucune nouvelle date n'a encore été annoncée.", compactNoDate:"Aucune nouvelle date annoncée", closed:"Les demandes ouvrent au début du spectacle.", expiredAccess:"Accès expiré. Saisissez le nouveau PIN de l'activité.", startsIn:"Commence dans", showQr:"Afficher le QR", closeQr:"Fermer le QR",
    unavailable:"Connexion indisponible. Réessayez dans un instant.", scan:"Scannez ici pour chanter", touch:"Touchez l’écran pour faire une demande ici",
    phrases:["Scannez ici pour chanter 🎤","La scène vous attend.","Choisissez votre chanson.","Devenez la Guest Star."]
  }
} as const;

function shuffled<T>(values: readonly T[]) {
  const result=[...values];
  for(let index=result.length-1;index>0;index-=1){
    const swap=Math.floor(Math.random()*(index+1));
    [result[index],result[swap]]=[result[swap],result[index]];
  }
  return result;
}

function enabledAttractLanguages(values: readonly string[] | undefined): AttractLanguage[] {
  const enabled=Array.from(new Set((values||[]).filter((value):value is AttractLanguage=>ATTRACT_LANGUAGES.includes(value as AttractLanguage))));
  return enabled.length?enabled:[...ATTRACT_LANGUAGES];
}

function buildAttractMessages(
  languages: readonly AttractLanguage[],
  customMessages: readonly string[],
  defaultMessagesEnabled: boolean
) : AttractPool {
  const defaults:AttractPool["defaults"]={};
  if(defaultMessagesEnabled)languages.forEach(language=>{defaults[language]=FUNNY_MESSAGES[language].kioskIdle;});
  const defaultTexts=new Set(Object.values(defaults).flat());
  const custom=Array.from(new Set(customMessages.map(message=>message.trim()).filter(Boolean)))
    .filter(text=>!defaultTexts.has(text));
  if(!Object.keys(defaults).length&&!custom.length)defaults[languages[0]||"en"]=[FUNNY_MESSAGES[languages[0]||"en"].kioskIdle[0]];
  return {languages:[...languages],defaults,custom};
}

function nextAttractMessage(pool:AttractPool, rotation:AttractRotation):AttractMessage {
  const alternatives=pool.languages.length>1
    ?pool.languages.filter(language=>language!==rotation.last?.language)
    :pool.languages;
  const unseen=alternatives.filter(language=>rotation.seen[language]===undefined);
  const oldest=Math.max(...alternatives.map(language=>rotation.turn-(rotation.seen[language]??rotation.turn)));
  const overdue=oldest>=pool.languages.length*2
    ?alternatives.filter(language=>rotation.turn-(rotation.seen[language]??rotation.turn)===oldest)
    :[];
  const candidates=unseen.length?unseen:overdue.length?overdue:alternatives;
  let roll=Math.random()*candidates.reduce((sum,language)=>sum+((language==="en"||language==="es")?2:1),0);
  let language=candidates[candidates.length-1];
  for(const candidate of candidates){
    roll-=(candidate==="en"||candidate==="es")?2:1;
    if(roll<0){language=candidate;break;}
  }
  const defaults=pool.defaults[language]||[];
  const useCustom=pool.custom.length>0&&(!defaults.length||Math.random()<1/(pool.languages.length+1));
  let bag=useCustom?rotation.customBag:rotation.bags[language]||[];
  if(!bag.length){
    bag=shuffled(useCustom?pool.custom:defaults);
    if(bag.length>1&&bag[0]===rotation.last?.text){
      const swap=bag.findIndex(text=>text!==rotation.last?.text);
      [bag[0],bag[swap]]=[bag[swap],bag[0]];
    }
    if(useCustom)rotation.customBag=bag;
    else rotation.bags[language]=bag;
  }
  const text=bag.shift()||FUNNY_MESSAGES[language].kioskIdle[0];
  const next={language,text};
  rotation.last=next;
  rotation.seen[language]=rotation.turn;
  rotation.turn+=1;
  return next;
}

function savedSessionToken() {
  try { return window.localStorage.getItem(SESSION_STORAGE_KEY) || ""; } catch { return ""; }
}

function storeSessionToken(token: string) {
  try {
    if (token) window.localStorage.setItem(SESSION_STORAGE_KEY, token);
    else window.localStorage.removeItem(SESSION_STORAGE_KEY);
  } catch { /* HttpOnly cookie remains the recovery path. */ }
}

function savedKey(kioskMode: boolean) {
  return kioskMode ? KIOSK_SAVED_STORAGE_KEY : REMEMBERED_STORAGE_KEY;
}

function readActivities(kioskMode: boolean): SavedActivity[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(savedKey(kioskMode)) || "[]");
    return Array.isArray(value) ? value.filter((entry) => entry && typeof entry.key === "string" && typeof entry.token === "string").slice(0, 30) : [];
  } catch { return []; }
}

function writeActivities(kioskMode: boolean, activities: SavedActivity[]) {
  try { window.localStorage.setItem(savedKey(kioskMode), JSON.stringify(activities.slice(0, 30))); }
  catch { /* Browser storage can be disabled. */ }
}

function activityEntry(data: SessionResult, token: string): SavedActivity | null {
  const access = data.kioskAccess;
  const hotelId = access?.hotelId || data.hotel?.hotelId || "";
  const activityId = access?.activityId || data.activity?.activityId || "";
  const venueId = access?.venueId || data.venue?.venueId || "";
  if (!hotelId || !activityId || !venueId || !token) return null;
  return {
    key: `${hotelId}|${activityId}|${venueId}`, token,
    joinToken: access?.joinUrl?.match(/\/join\/([^/?#]+)/)?.[1] || "",
    activityName: data.activity?.name || "Guest Star Activity",
    hotelName: data.hotel?.name || "Hotel", venueName: data.venue?.name || "Venue",
    nextOccurrenceAt: data.nextOccurrenceAt || "",
    status: data.accessState || "no_date", expired: false
  };
}

function publicCodeFromState(data: SessionResult) {
  for(const candidate of [data.hotel?.publicUrl,data.kioskAccess?.joinUrl]){
    try{
      const url=new URL(String(candidate||""),window.location.origin);
      const matched=url.pathname.match(/\/h\/([^/?#]+)/);
      if(matched?.[1])return decodeURIComponent(matched[1]);
    }catch{/* Ignore incomplete optional URLs. */}
  }
  return "";
}

function sortActivities(entries: SavedActivity[]) {
  const rank = (entry: SavedActivity) => entry.expired ? 4 : entry.status === "live" ? 0 : entry.nextOccurrenceAt ? 1 : entry.status === "upcoming" ? 2 : 3;
  return [...entries].sort((a,b) => rank(a)-rank(b) || (Date.parse(a.nextOccurrenceAt)||Infinity)-(Date.parse(b.nextOccurrenceAt)||Infinity));
}

function ActivityCountdown({ at, language, compact=false }: { at: string; language: UiLanguage; compact?: boolean }) {
  const [now,setNow]=useState(()=>Date.now());
  useEffect(()=>{if(!at)return;const id=window.setInterval(()=>setNow(Date.now()),1000);return()=>window.clearInterval(id);},[at]);
  const left=Math.max(0,Date.parse(at)-now);
  if(!at || !Number.isFinite(left) || left<=0)return compact?<div className="activityCountdown compact"><small>{GUEST_UI_COPY[language].startsIn}</small><strong>—</strong></div>:null;
  const seconds=Math.floor(left/1000);
  const days=Math.floor(seconds/86400);
  const hours=Math.floor(seconds%86400/3600);
  const minutes=Math.floor(seconds%3600/60);
  const remaining=seconds%60;
  const value=compact
    ? `${String(days).padStart(2,"0")}d ${String(hours).padStart(2,"0")}h ${String(minutes).padStart(2,"0")}m`
    : `${String(days).padStart(2,"0")}d : ${String(hours).padStart(2,"0")}h : ${String(minutes).padStart(2,"0")}m : ${String(remaining).padStart(2,"0")}s`;
  return <div className={compact?"activityCountdown compact":"activityCountdown"}><small>{GUEST_UI_COPY[language].startsIn}</small><strong>{value}</strong></div>;
}

function nextDate(at: string, language: UiLanguage, timezone = "UTC") {
  const date=new Date(at);
  return Number.isFinite(date.getTime()) ? date.toLocaleString(LANGUAGE_BY_CODE[language].locale,{dateStyle:"full",timeStyle:"short",timeZone:timezone}) : "";
}

function compactNextDate(at: string, language: UiLanguage, timezone = "UTC") {
  const date=new Date(at);
  if(!Number.isFinite(date.getTime()))return GUEST_UI_COPY[language].compactNoDate;
  const locale=LANGUAGE_BY_CODE[language].locale;
  const day=date.toLocaleDateString(locale,{month:"short",day:"numeric",timeZone:timezone});
  const time=date.toLocaleTimeString(locale,{hour:"numeric",minute:"2-digit",timeZone:timezone});
  return `${day} · ${time}`;
}

function errorMessage(language: UiLanguage, code: string) {
  const copy = GUEST_UI_COPY[language];
  if (code === "REQUEST_FAILED" || !code) return copy.unavailable;
  if (code === "ACTIVITY_ENDED") return copy.ended;
  if (["PIN_EXPIRED","SESSION_EXPIRED","ACCESS_EXPIRED"].includes(code)) return copy.expiredAccess;
  if (code === "SESSION_PIN_CHANGED") return copy.changed;
  if (["JOIN_LINK_EXPIRED","JOIN_LINK_INVALID"].includes(code)) return copy.linkExpired;
  if (["PIN_BACKOFF","RATE_LIMITED"].includes(code)) return copy.rate;
  return copy.invalid;
}

function accessIsInvalid(code: string) {
  return ["SESSION_EXPIRED", "ACCESS_EXPIRED", "SESSION_PIN_CHANGED", "SESSION_DEVICE_MISMATCH", "SESSION_REQUIRED"].includes(code);
}

async function resumeSavedActivity(entry: SavedActivity, deviceId: string, kioskMode: boolean) {
  try {
    return await sessionApi({action:"resumeSession",activitySessionToken:entry.token,guestDeviceId:deviceId});
  } catch (caught) {
    const code=String((caught as {code?:string}).code||"");
    if(kioskMode&&["SESSION_EXPIRED","SESSION_REQUIRED"].includes(code)&&entry.joinToken) {
      return await sessionApi({action:"joinByToken",joinToken:entry.joinToken,guestDeviceId:deviceId});
    }
    throw caught;
  }
}

async function sessionApi(payload: Record<string, unknown>): Promise<SessionResult> {
  const response = await fetch("/api/karaoke", {
    method:"POST", cache:"no-store", headers:{"Content-Type":"application/json"},
    body:JSON.stringify(payload)
  });
  const data = await response.json().catch(()=>({})) as SessionResult;
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || data.code || "REQUEST_FAILED");
    Object.assign(error, data);
    throw error;
  }
  return data;
}

function LanguagePicker({ language, onChange }: { language: UiLanguage; onChange: (value: UiLanguage) => void }) {
  return <div className="sessionLanguage" aria-label="Language">
    <Globe2/><select value={language} onChange={event=>onChange(event.target.value as UiLanguage)}>{GUEST_LANGUAGES.map(item=><option key={item.code} value={item.code}>{item.flag} {item.nativeName}</option>)}</select>
  </div>;
}

function KioskScreensaver({ state, language, manualSignal }: { state: SessionResult; language: UiLanguage; manualSignal: number }) {
  const [visible,setVisible]=useState(false);
  const [message,setMessage]=useState<AttractMessage|null>(null);
  const timer=useRef<number|undefined>(undefined);
  const rotation=useRef<AttractRotation>({last:null,turn:0,seen:{},bags:{},customBag:[]});
  const access=state.kioskAccess||{};
  const branding=state.branding||{};
  const hotelLogoUrl=branding.showHotelLogo!==false
    ?normalizeBrandImageUrl(String(branding.hotelLogoUrl||""))
    :"";
  const copy=GUEST_UI_COPY[language];
  const languageKey=(state.activity?.allowedLanguages||[]).join(",");
  const customMessageKey=JSON.stringify(access.customMessages||[]);
  const messagePool=useMemo(()=>buildAttractMessages(
    enabledAttractLanguages(state.activity?.allowedLanguages),
    Array.isArray(access.customMessages)?access.customMessages:[],
    access.defaultMessagesEnabled!==false
  ),[access.defaultMessagesEnabled,customMessageKey,languageKey]);
  const drawNext=useCallback(()=>{
    setMessage(nextAttractMessage(messagePool,rotation.current));
  },[messagePool]);
  const show=useCallback(()=>{drawNext();setVisible(true);},[drawNext]);
  const arm=useCallback(()=>{
    if(timer.current!==undefined)window.clearTimeout(timer.current);
    timer.current=window.setTimeout(()=>{timer.current=undefined;show();},IDLE_TIMEOUT_MS);
  },[show]);
  useEffect(()=>{
    rotation.current={last:null,turn:0,seen:{},bags:{},customBag:[]};
    setMessage(null);
  },[messagePool]);
  useEffect(()=>{
    const interact=(event:Event)=>{
      if((event.target as Element)?.closest?.(".sessionQrButton"))return;
      setVisible(false);arm();
    };
    const events=["pointerdown","touchstart","click","keydown"] as const;
    events.forEach(name=>window.addEventListener(name,interact,{passive:true}));
    arm();
    return()=>{events.forEach(name=>window.removeEventListener(name,interact));if(timer.current!==undefined)window.clearTimeout(timer.current);};
  },[arm]);
  useEffect(()=>{
    if(!manualSignal)return;
    if(timer.current!==undefined){window.clearTimeout(timer.current);timer.current=undefined;}
    show();
  },[manualSignal,show]);
  useEffect(()=>{
    if(!visible)return;
    if(Object.values(messagePool.defaults).reduce((count,group)=>count+group.length,0)+messagePool.custom.length<2)return;
    const interval=window.setInterval(drawNext,ATTRACT_MESSAGE_INTERVAL_MS);
    return()=>window.clearInterval(interval);
  },[drawNext,messagePool,visible]);
  const cta=message?.language?KIOSK_ATTRACT_CTA[message.language]:copy.scan;
  const phrase=message?.text||FUNNY_MESSAGES[enabledAttractLanguages(state.activity?.allowedLanguages)[0]].kioskIdle[0];
  return <AnimatePresence>{visible&&<motion.section className="kioskScreensaver" style={brandingTheme(branding) as CSSProperties} role="dialog" aria-label={cta} initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}>
    <div className="kioskAttractGlow" aria-hidden="true"/>
    <button type="button" className="kioskRefresh" aria-label="Refresh page" title="Refresh page" onClick={()=>window.location.reload()}><RefreshCcw/></button>
    <div className="kioskAttractContent">
      <div className="kioskHotelBrand">
        <BrandLogos hotelLogo={hotelLogoUrl} teamLogo={branding.teamLogoUrl}/>
        <small>GUEST STAR EXPERIENCE</small>
      </div>
      <div className="kioskQrFrame">{access.qrViewUrl&&<img src={access.qrViewUrl} alt={cta}/>}<QrCode/></div>
      <div className="kioskAttractCopy">
        <p><Sparkles/> {cta}</p>
        <motion.h1 key={`${message?.language||"custom"}-${phrase}`} initial={{opacity:0,y:14}} animate={{opacity:1,y:0}}>{phrase}</motion.h1>
        <div className="kioskAttractMeta">{state.nextOccurrenceAt?<><span>{copy.next}: {nextDate(state.nextOccurrenceAt,language,state.hotel?.timezone||"UTC")}</span><ActivityCountdown at={state.nextOccurrenceAt} language={language}/></>:<span>{copy.noDate}</span>}<strong>{copy.access}: {access.pin}</strong><span>{copy.touch}</span></div>
      </div>
    </div>
  </motion.section>}</AnimatePresence>;
}

export default function SessionRequestExperience({
  kioskMode=false,
  joinToken=""
}: {
  kioskMode?: boolean;
  joinToken?: string;
}) {
  const [phase,setPhase]=useState<Phase>("loading");
  const [language,setLanguage]=useState<UiLanguage>("en");
  const [pin,setPin]=useState("");
  const [errorCode,setErrorCode]=useState("");
  const [busy,setBusy]=useState(false);
  const [retryAfter,setRetryAfter]=useState(0);
  const [sessionToken,setSessionToken]=useState("");
  const [initialState,setInitialState]=useState<SessionResult|null>(null);
  const [savedActivities,setSavedActivities]=useState<SavedActivity[]>([]);
  const [defaultKey,setDefaultKey]=useState("");
  const [qrOpen,setQrOpen]=useState(false);
  const [manualAttractSignal,setManualAttractSignal]=useState(0);
  const [publicCode,setPublicCode]=useState("");
  const copy=GUEST_UI_COPY[language];

  const chooseLanguage=(next:UiLanguage)=>{
    setLanguage(next);
    try{window.localStorage.setItem(LANGUAGE_STORAGE_KEY,next);}catch{/* optional preference */}
  };

  const saveActivity=useCallback((data:SessionResult, token:string, force=false)=>{
    const entry=activityEntry(data,token);
    if(!entry)return;
    const previous=readActivities(kioskMode);
    const index=previous.findIndex(item=>item.key===entry.key);
    if(index<0&&!force)return;
    if(index>=0&&JSON.stringify(previous[index])===JSON.stringify(entry))return;
    const next=sortActivities(index>=0?previous.map(item=>item.key===entry.key?entry:item):[...previous,entry]);
    writeActivities(kioskMode,next);
    setSavedActivities(next);
  },[kioskMode]);

  const acceptSession=useCallback((data:SessionResult, fallbackToken="")=>{
    const location=new URL(window.location.href);
    if(location.searchParams.has("enterCode")){location.searchParams.delete("enterCode");window.history.replaceState(null,"",location.pathname+location.search+location.hash);}
    const token=String(data.activitySessionToken||fallbackToken||"");
    if(token){storeSessionToken(token);setSessionToken(token);}
    saveActivity(data,token);
    const directCode=publicCodeFromState(data);
    if(directCode)storePublicActivityContext({
      publicCode:directCode,hotelId:data.hotel?.hotelId,hotelName:data.hotel?.name,
      venueId:data.venue?.venueId,venueName:data.venue?.name,
      activityId:data.activity?.activityId,activityName:data.activity?.name,
      pin:data.kioskAccess?.pin,joinToken:data.kioskAccess?.joinUrl?.match(/\/join\/([^/?#]+)/)?.[1],updatedAt:Date.now()
    });
    setInitialState(data);setErrorCode("");setPin("");setPhase("session");
  },[saveActivity]);

  const rejectSession=useCallback((code:string,retry=0)=>{
    storeSessionToken("");setSessionToken("");setInitialState(null);setErrorCode(code);setRetryAfter(Math.max(0,Math.ceil(retry)));
    setPhase(readActivities(kioskMode).length?"activities":"pin");
  },[kioskMode]);

  const markExpired=useCallback((key:string)=>{
    const next=readActivities(kioskMode).map(entry=>entry.key===key?{...entry,expired:true}:entry);
    writeActivities(kioskMode,next);setSavedActivities(sortActivities(next));
  },[kioskMode]);

  useEffect(()=>{
    try{
      const saved=window.localStorage.getItem(LANGUAGE_STORAGE_KEY) as UiLanguage|null;
      const browser=navigator.language.split("-")[0].toLowerCase() as UiLanguage;
      if(saved&&GUEST_LANGUAGE_CODES.includes(saved))setLanguage(saved);
      else if(GUEST_LANGUAGE_CODES.includes(browser))setLanguage(browser);
    }catch{/* English remains the safe default. */}
    let active=true;
    if(new URLSearchParams(window.location.search).get("enterCode")==="1"){setPhase("pin");return;}
    const deviceId=guestDeviceId();
    const saved=savedSessionToken();
    const activities=readActivities(kioskMode);
    setSavedActivities(sortActivities(activities));
    let storedDefault="";
    try{storedDefault=window.localStorage.getItem(KIOSK_DEFAULT_STORAGE_KEY)||"";}catch{/* optional */}
    setDefaultKey(storedDefault);
    (async()=>{
      try{
        if(joinToken){const joined=await sessionApi({action:"joinByToken",joinToken,guestDeviceId:deviceId});if(active)acceptSession(joined);return;}
        if(activities.length){
          const states=new Map<string,SessionResult>();
          const checked=await Promise.all(activities.map(async entry=>{
            try{
              const state=await resumeSavedActivity(entry,deviceId,kioskMode);
              states.set(entry.key,state);
              return activityEntry(state,state.activitySessionToken||entry.token)||entry;
            }catch(caught){
              const code=String((caught as {code?:string}).code||"");
              return accessIsInvalid(code)?{...entry,expired:true}:entry;
            }
          }));
          if(!active)return;
          const sorted=sortActivities(checked);
          writeActivities(kioskMode,sorted);setSavedActivities(sorted);
          const valid=sorted.filter(entry=>!entry.expired);
          const selected=kioskMode?(valid.find(entry=>entry.key===storedDefault)|| (valid.length===1?valid[0]:null)):null;
          if(selected){
            const state=states.get(selected.key);
            if(state&&active)acceptSession(state,selected.token);
            else setPhase("activities");
          }else setPhase("activities");
          return;
        }
        if(!saved){
          const context=!kioskMode?readPublicActivityContext():null;
          if(context?.publicCode){setPublicCode(context.publicCode);setPhase("public");return;}
          setPhase("pin");return;
        }
        const resumed=await sessionApi({action:"resumeSession",activitySessionToken:saved,guestDeviceId:deviceId});
        if(active)acceptSession(resumed,saved);
      }catch(caught){
        if(!active)return;
        const detail=caught as Error&{code?:string;retryAfterSeconds?:number};
        storeSessionToken("");
        if(joinToken)rejectSession(String(detail.code||"JOIN_LINK_INVALID"),Number(detail.retryAfterSeconds)||0);
        else {
          const code=String(detail.code||"");
          rejectSession(code==="SESSION_REQUIRED"?"":code,Number(detail.retryAfterSeconds)||0);
        }
      }
    })();
    return()=>{active=false;};
  },[acceptSession,joinToken,kioskMode,rejectSession]);

  useEffect(()=>{
    if(retryAfter<=0)return;
    const id=window.setInterval(()=>setRetryAfter(value=>Math.max(0,value-1)),1000);
    return()=>window.clearInterval(id);
  },[retryAfter]);

  const joinByPin=async()=>{
    if(pin.length!==6||busy||retryAfter>0)return;
    setBusy(true);setErrorCode("");
    try{acceptSession(await sessionApi({action:"joinByPin",pin,guestDeviceId:guestDeviceId()}));}
    catch(caught){const detail=caught as Error&{code?:string;retryAfterSeconds?:number};setErrorCode(String(detail.code||"INVALID_PIN"));setRetryAfter(Math.max(0,Number(detail.retryAfterSeconds)||0));setPin("");}
    finally{setBusy(false);}
  };

  const selectActivity=async(entry:SavedActivity)=>{
    if(busy)return;
    setBusy(true);setErrorCode("");
    try{acceptSession(await resumeSavedActivity(entry,guestDeviceId(),kioskMode),entry.token);}
    catch(caught){
      const code=String((caught as {code?:string}).code||"");
      if(accessIsInvalid(code))markExpired(entry.key);
      setErrorCode(code||"REQUEST_FAILED");
    }
    finally{setBusy(false);}
  };

  const forgetActivity=(key:string)=>{
    const next=readActivities(kioskMode).filter(entry=>entry.key!==key);
    writeActivities(kioskMode,next);setSavedActivities(next);
    if(defaultKey===key){try{window.localStorage.removeItem(KIOSK_DEFAULT_STORAGE_KEY);}catch{/* optional */}setDefaultKey("");}
    if(!next.length)setPhase("pin");
  };

  const setDefault=(key:string)=>{
    try{window.localStorage.setItem(KIOSK_DEFAULT_STORAGE_KEY,key);}catch{/* optional */}
    setDefaultKey(key);
  };

  if(phase==="public"&&publicCode)return <div className="sessionRequestShell"><KaraokeExperienceClient hotelCode={publicCode}
    uiLanguage={language} onUiLanguageChange={chooseLanguage}
    onPublicUnavailable={()=>{clearPublicActivityContext();setPublicCode("");setPhase("pin");}}/></div>;

  if(phase==="loading")return <main className="sessionGatePage"><div className="sessionGateBrand"><img className="gs-product-logo" src="/branding/brand-horizontal.png" width="300" height="100" alt="Guest Star Experience" /></div><div className="sessionLoading"><i className="loader"/>{copy.joining}</div></main>;
  if(phase==="session"&&initialState){
    const access=initialState.kioskAccess;
    const entry=activityEntry(initialState,sessionToken);
    const isSaved=Boolean(entry&&savedActivities.some(item=>item.key===entry.key));
    const ended=initialState.activity?.status==="finished";
    return <div className={kioskMode?"sessionRequestShell kioskMode":"sessionRequestShell"} style={brandingTheme(initialState.branding||{}) as CSSProperties}>
      {kioskMode&&<aside className="sessionActivityBar" aria-label={copy.access}>
        <div className="sessionActivityIdentity"><strong>{initialState.activity?.name||"Guest Star Activity"}</strong><span>{initialState.hotel?.name} · {initialState.venue?.name}</span><small>{initialState.accepting?"LIVE":ended?copy.ended:initialState.nextOccurrenceAt?"UPCOMING":"REQUESTS CLOSED"}</small></div>
        {!ended&&<div className="sessionActivityEssentials">
          <div className="sessionEssentialNext"><small>{copy.compactNext}</small><strong>{initialState.nextOccurrenceAt?compactNextDate(initialState.nextOccurrenceAt,language,initialState.hotel?.timezone||"UTC"):copy.compactNoDate}</strong></div>
          <ActivityCountdown at={initialState.nextOccurrenceAt||""} language={language} compact/>
          <div className="sessionEssentialPin"><small>PIN</small><strong>{access?.pin||"— — — — — —"}</strong></div>
          <button type="button" className="sessionQrButton" aria-haspopup="dialog" disabled={!access?.qrViewUrl} onClick={()=>setManualAttractSignal(value=>value+1)}><QrCode/>Attract Mode</button>
        </div>}
        <div className="sessionActivityActions">
          {kioskMode&&!isSaved&&<button type="button" onClick={()=>saveActivity(initialState,sessionToken,true)}>{copy.save}</button>}
          {kioskMode&&isSaved&&<span>{copy.saved}</span>}
          <button type="button" onClick={()=>setPhase(savedActivities.length?"activities":"pin")}>{copy.switchActivity}</button>
          <button type="button" onClick={()=>{setErrorCode("");setPhase("pin");}}>{copy.another}</button>
        </div>
        {!initialState.accepting&&<div className="sessionActivityNotice">{ended?copy.ended:initialState.activityRunning?closureMessage(initialState,language):copy.closed}</div>}
      </aside>}
      <AnimatePresence>{!kioskMode&&qrOpen&&access?.qrViewUrl&&<motion.div className="sessionQrBackdrop" role="presentation" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onClick={()=>setQrOpen(false)}>
        <motion.section id="sessionActivityQr" className="sessionQrDialog" role="dialog" aria-modal="true" aria-label={copy.access} initial={{opacity:0,y:18,scale:.97}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:12,scale:.98}} onClick={event=>event.stopPropagation()}>
          <button type="button" className="sessionQrClose" onClick={()=>setQrOpen(false)} aria-label={copy.closeQr}>×</button><span>{copy.access}</span><img src={access.qrViewUrl} alt={copy.share}/><strong>PIN {access.pin}</strong><small>{initialState.activity?.name} · {initialState.venue?.name}</small><a href={access.joinUrl} target="_blank" rel="noreferrer">{copy.share}</a>
        </motion.section>
      </motion.div>}</AnimatePresence>
      <GameParticipation activitySessionToken={sessionToken} kioskMode={kioskMode} language={language}/>
      <KaraokeExperienceClient activitySessionToken={sessionToken} initialState={initialState}
        uiLanguage={language} onUiLanguageChange={chooseLanguage}
        onSessionInvalid={code=>{if(entry)markExpired(entry.key);rejectSession(code);}}
        onStateChange={state=>{setInitialState(state as SessionResult);saveActivity(state as SessionResult,sessionToken);}}
        onRequestConfirmed={()=>saveActivity(initialState,sessionToken,true)}/>
      {kioskMode&&!ended&&<KioskScreensaver state={initialState} language={language} manualSignal={manualAttractSignal}/>}</div>;
  }

  if(phase==="activities")return <main className={kioskMode?"sessionGatePage kioskMode":"sessionGatePage"}>
    <div className="sessionGateAmbient" aria-hidden="true"><i/><i/></div><div className="sessionGateBrand"><img className="gs-product-logo" src="/branding/brand-horizontal.png" width="300" height="100" alt="Guest Star Experience" /></div>
    <LanguagePicker language={language} onChange={chooseLanguage}/>
    <section className="sessionSavedCard"><h1>{kioskMode?copy.savedActivities:copy.yourActivities}</h1>
      {errorCode&&<div className="sessionError" role="alert">{errorMessage(language,errorCode)}</div>}
      <div className="sessionSavedList">{savedActivities.map(entry=><article key={entry.key} className={entry.expired?"expired":""}>
        <button type="button" className="sessionSavedSelect" disabled={busy||entry.expired} onClick={()=>void selectActivity(entry)}><strong>{entry.activityName}</strong><span>{entry.hotelName} · {entry.venueName}</span><small>{entry.expired?copy.expiredAccess:entry.status==="live"?"LIVE":entry.nextOccurrenceAt?`${copy.next}: ${nextDate(entry.nextOccurrenceAt,language)}`:copy.noDate}</small>{!entry.expired&&entry.nextOccurrenceAt&&<ActivityCountdown at={entry.nextOccurrenceAt} language={language}/>}</button>
        <div className="sessionSavedTools">{kioskMode&&<button type="button" onClick={()=>setDefault(entry.key)}>{defaultKey===entry.key?copy.default:copy.setDefault}</button>}<button type="button" onClick={()=>forgetActivity(entry.key)}>{copy.forget}</button></div>
      </article>)}</div>
      <button type="button" className="sessionJoinButton" onClick={()=>{setErrorCode("");setPhase("pin");}}>{copy.another}</button>
    </section>
  </main>;

  return <main className={kioskMode?"sessionGatePage kioskMode":"sessionGatePage"}>
    <div className="sessionGateAmbient" aria-hidden="true"><i/><i/></div>
    <div className="sessionGateBrand"><img className="gs-product-logo" src="/branding/brand-horizontal.png" width="300" height="100" alt="Guest Star Experience" /></div>
    <LanguagePicker language={language} onChange={chooseLanguage}/>
    <motion.section className="sessionGateCard" initial={{opacity:0,y:24,scale:.98}} animate={{opacity:1,y:0,scale:1}}>
      <div className="sessionGateMic"><Mic2/></div><p><Sparkles/> GUEST STAR REQUEST</p><h1>{copy.enter}</h1><span>{copy.hint}</span>
      <div className="pinSlots" aria-label={copy.enter}>{Array.from({length:6},(_,index)=><i key={index} className={index<pin.length?"filled":""}>{index<pin.length?"•":""}</i>)}</div>
      {errorCode&&<div className="sessionError" role="alert">{errorMessage(language,errorCode)}{retryAfter>0&&` (${retryAfter}s)`}</div>}
      <div className="pinKeypad">{[1,2,3,4,5,6,7,8,9].map(number=><button type="button" key={number} disabled={busy||retryAfter>0} onClick={()=>setPin(value=>(value+number).slice(0,6))}>{number}</button>)}<button type="button" className="pinClear" aria-label={copy.clear} disabled={busy||!pin} onClick={()=>setPin("")}><span>{copy.clear}</span></button><button type="button" disabled={busy||retryAfter>0} onClick={()=>setPin(value=>(value+"0").slice(0,6))}>0</button><button type="button" className="pinDelete" aria-label={copy.clear} disabled={busy||!pin} onClick={()=>setPin(value=>value.slice(0,-1))}><Delete/></button></div>
      <button type="button" className="sessionJoinButton" disabled={busy||pin.length!==6||retryAfter>0} onClick={()=>void joinByPin()}>{busy?<><i className="loader"/>{copy.joining}</>:<><Mic2/>{errorCode==="ACTIVITY_ENDED"?copy.newPin:copy.enterButton}</>}</button>
      {savedActivities.length>0&&<button type="button" className="sessionReturnActivities" onClick={()=>setPhase("activities")}>{kioskMode?copy.savedActivities:copy.yourActivities}</button>}
    </motion.section>
  </main>;
}
