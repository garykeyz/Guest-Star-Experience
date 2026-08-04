"use client";

import { FormEvent, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight, Check, ChevronDown, Clock3, Eye, EyeOff, Headphones, Hourglass,
  LockKeyhole, MessageCircleMore, Mic2, Music2, Radio, RotateCcw, Send,
  Sparkles, UserRound, UsersRound, XCircle
} from "lucide-react";

type Lang = "es" | "en" | "fr" | "it" | "de" | "ru" | "pt";
type FieldKey = "name" | "song" | "artist" | "comment";
type Copy = {
  live: string; title: string; sub: string; desc: string; fields: Record<FieldKey, [string, string]>;
  error: string; submit: string; sending: string; success: string; stage: string;
  again: string; closed: string; closedText: string; failed: string; steps: string[];
};

type ApiState = {
  accepting?: boolean;
  activityHours?: number;
  activityStartedAt?: string;
  activityRunning?: boolean;
  showPublicStatus?: boolean;
  queuePeopleCount?: number;
  stateRevision?: number;
  activityId?: string;
};
type ApiResponse = ApiState & {
  ok?: boolean;
  code?: string;
  error?: string;
  state?: ApiState;
  duplicates?: DuplicateWarning;
};
type DuplicateWarning = {
  repeatedSinger?: boolean;
  duplicateSong?: boolean;
  duplicateSongState?: "active" | "completed" | "";
};
type DuplicateCopy = {
  title: string;
  singer: string;
  active: string;
  completed: string;
  question: string;
  continue: string;
  cancel: string;
};
type ActivityCopy = {
  label: string;
  notStarted: string;
  running: string;
  finished: string;
  elapsed: string;
  remaining: string;
  queue: string;
};

const ENDPOINT = "/api/karaoke";
const languages: [Lang, string, string][] = [
  ["es","🇪🇸","Español"],["en","🇺🇸","English"],["fr","🇫🇷","Français"],
  ["it","🇮🇹","Italiano"],["de","🇩🇪","Deutsch"],["ru","🇷🇺","Русский"],["pt","🇵🇹","Português"]
];
const duplicateCopy: Record<Lang, DuplicateCopy> = {
  en: {title:"Please confirm",singer:"You already have another request in this activity.",active:"This song has already been requested and is still active.",completed:"This song has already been sung during this activity.",question:"Do you still want to submit it?",continue:"Yes, continue",cancel:"Go back"},
  es: {title:"Confirma antes de continuar",singer:"Ya tienes otra solicitud en esta actividad.",active:"Esta canción ya fue solicitada y sigue activa.",completed:"Esta canción ya fue cantada durante esta actividad.",question:"¿Aun así quieres enviarla?",continue:"Sí, continuar",cancel:"Volver"},
  fr: {title:"Veuillez confirmer",singer:"Vous avez déjà une autre demande pour cette activité.",active:"Cette chanson a déjà été demandée et reste active.",completed:"Cette chanson a déjà été chantée pendant cette activité.",question:"Voulez-vous quand même l’envoyer ?",continue:"Oui, continuer",cancel:"Revenir"},
  it: {title:"Conferma prima di continuare",singer:"Hai già un’altra richiesta in questa attività.",active:"Questo brano è già stato richiesto ed è ancora attivo.",completed:"Questo brano è già stato cantato durante questa attività.",question:"Vuoi inviarlo comunque?",continue:"Sì, continua",cancel:"Indietro"},
  de: {title:"Bitte bestätigen",singer:"Du hast bereits einen weiteren Wunsch für diese Veranstaltung.",active:"Dieser Song wurde bereits gewünscht und ist noch aktiv.",completed:"Dieser Song wurde während dieser Veranstaltung bereits gesungen.",question:"Möchtest du ihn trotzdem senden?",continue:"Ja, fortfahren",cancel:"Zurück"},
  ru: {title:"Подтвердите отправку",singer:"У вас уже есть другая заявка в этом мероприятии.",active:"Эта песня уже заказана и ещё активна.",completed:"Эту песню уже исполняли во время этого мероприятия.",question:"Всё равно отправить заявку?",continue:"Да, продолжить",cancel:"Назад"},
  pt: {title:"Confirme antes de continuar",singer:"Já tem outro pedido nesta atividade.",active:"Esta música já foi pedida e continua ativa.",completed:"Esta música já foi cantada durante esta atividade.",question:"Deseja enviá-la mesmo assim?",continue:"Sim, continuar",cancel:"Voltar"}
};
const activityCopy: Record<Lang, ActivityCopy> = {
  en: {label:"ACTIVITY STATUS",notStarted:"The activity has not started",running:"Activity in progress",finished:"Scheduled time completed",elapsed:"Elapsed",remaining:"Remaining",queue:"People in queue"},
  es: {label:"ESTADO DE LA ACTIVIDAD",notStarted:"La actividad aún no ha iniciado",running:"Actividad en curso",finished:"Tiempo programado finalizado",elapsed:"Transcurrido",remaining:"Faltante",queue:"Personas en cola"},
  fr: {label:"ÉTAT DE L’ACTIVITÉ",notStarted:"L’activité n’a pas encore commencé",running:"Activité en cours",finished:"Temps prévu terminé",elapsed:"Écoulé",remaining:"Restant",queue:"Personnes en attente"},
  it: {label:"STATO DELL’ATTIVITÀ",notStarted:"L’attività non è ancora iniziata",running:"Attività in corso",finished:"Tempo previsto terminato",elapsed:"Trascorso",remaining:"Rimanente",queue:"Persone in coda"},
  de: {label:"AKTIVITÄTSSTATUS",notStarted:"Die Aktivität hat noch nicht begonnen",running:"Aktivität läuft",finished:"Geplante Zeit beendet",elapsed:"Vergangen",remaining:"Verbleibend",queue:"Personen in der Warteschlange"},
  ru: {label:"СТАТУС МЕРОПРИЯТИЯ",notStarted:"Мероприятие ещё не началось",running:"Мероприятие идёт",finished:"Запланированное время завершено",elapsed:"Прошло",remaining:"Осталось",queue:"Людей в очереди"},
  pt: {label:"ESTADO DA ATIVIDADE",notStarted:"A atividade ainda não começou",running:"Atividade em curso",finished:"Tempo programado concluído",elapsed:"Decorrido",remaining:"Restante",queue:"Pessoas na fila"}
};
const common = (x: Partial<Copy>): Copy => ({
  live:"LIVE EXPERIENCE",title:"KARAOKE NIGHT",sub:"Ready to sing?",desc:"Request your favorite song and get ready to shine on stage.",
  fields:{name:["Your Name","What should we call you?"],song:["Song Title","What would you like to sing?"],artist:["Artist","Who performs it?"],comment:["Comment","Optional dedication or note..."]},
  error:"Please complete this field.",submit:"Submit Request",sending:"Sending...",
  success:"Your song request has been sent!",stage:"Get ready to take the stage!",again:"Submit another song",
  closed:"Requests are closed",closedText:"The host has temporarily closed song requests.",
  failed:"We couldn't send your request. Please try again.",
  steps:["Fill the form","Wait for your turn","Sing and enjoy!"],...x
});
const copy: Record<Lang, Copy> = {
  en: common({}),
  es: common({
    live:"EXPERIENCIA EN VIVO",title:"NOCHE DE KARAOKE",sub:"¿Listo para cantar?",
    desc:"Pide tu canción favorita y prepárate para brillar en el escenario.",
    fields:{name:["Tu nombre","¿Cómo quieres que te llamemos?"],song:["Título de la canción","¿Qué te gustaría cantar?"],artist:["Artista","¿Quién la interpreta?"],comment:["Comentario","Dedicatoria o nota opcional..."]},
    error:"Completa este campo.",submit:"Enviar solicitud",sending:"Enviando...",
    success:"¡Tu solicitud de canción ha sido enviada!",stage:"¡Prepárate para subir al escenario!",again:"Pedir otra canción",
    closed:"Solicitudes cerradas",closedText:"El anfitrión ha cerrado temporalmente las solicitudes de canciones.",
    failed:"No pudimos enviar la solicitud. Inténtalo de nuevo.",
    steps:["Completa el formulario","Espera tu turno","¡Canta y disfruta!"]
  }),
  fr: common({
    live:"EXPÉRIENCE EN DIRECT",title:"SOIRÉE KARAOKÉ",sub:"Prêt à chanter ?",
    desc:"Demandez votre chanson préférée et préparez-vous à briller sur scène.",
    fields:{name:["Votre nom","Comment souhaitez-vous être appelé ?"],song:["Titre de la chanson","Que souhaitez-vous chanter ?"],artist:["Artiste","Qui interprète cette chanson ?"],comment:["Commentaire","Dédicace ou remarque facultative..."]},
    error:"Veuillez remplir ce champ.",submit:"Envoyer la demande",sending:"Envoi en cours...",
    success:"Votre demande de chanson a bien été envoyée !",stage:"Préparez-vous à monter sur scène !",again:"Demander une autre chanson",
    closed:"Demandes fermées",closedText:"L’animateur a temporairement fermé les demandes de chansons.",
    failed:"Impossible d’envoyer votre demande. Veuillez réessayer.",
    steps:["Remplissez le formulaire","Attendez votre tour","Chantez et amusez-vous !"]
  }),
  it: common({
    live:"ESPERIENZA DAL VIVO",title:"SERATA KARAOKE",sub:"Pronto a cantare?",
    desc:"Richiedi la tua canzone preferita e preparati a brillare sul palco.",
    fields:{name:["Il tuo nome","Come vuoi che ti chiamiamo?"],song:["Titolo della canzone","Cosa vorresti cantare?"],artist:["Artista","Chi la interpreta?"],comment:["Commento","Dedica o nota facoltativa..."]},
    error:"Compila questo campo.",submit:"Invia richiesta",sending:"Invio in corso...",
    success:"La tua richiesta è stata inviata!",stage:"Preparati a salire sul palco!",again:"Richiedi un’altra canzone",
    closed:"Richieste chiuse",closedText:"Il presentatore ha temporaneamente chiuso le richieste di brani.",
    failed:"Non è stato possibile inviare la richiesta. Riprova.",
    steps:["Compila il modulo","Aspetta il tuo turno","Canta e divertiti!"]
  }),
  de: common({
    live:"LIVE-ERLEBNIS",title:"KARAOKE-NACHT",sub:"Bereit zum Singen?",
    desc:"Wünsch dir deinen Lieblingssong und mach dich bereit, auf der Bühne zu glänzen.",
    fields:{name:["Dein Name","Wie dürfen wir dich nennen?"],song:["Songtitel","Was möchtest du singen?"],artist:["Interpret/in","Von wem ist der Song?"],comment:["Kommentar","Optionale Widmung oder Nachricht..."]},
    error:"Bitte fülle dieses Feld aus.",submit:"Songwunsch senden",sending:"Wird gesendet...",
    success:"Dein Songwunsch wurde gesendet!",stage:"Mach dich bereit für deinen Auftritt!",again:"Weiteren Song wünschen",
    closed:"Keine Songwünsche möglich",closedText:"Der Gastgeber nimmt vorübergehend keine Songwünsche an.",
    failed:"Dein Songwunsch konnte nicht gesendet werden. Bitte versuche es erneut.",
    steps:["Formular ausfüllen","Warte, bis du dran bist","Singen und Spaß haben!"]
  }),
  ru: common({
    live:"ЖИВОЕ ШОУ",title:"ВЕЧЕР КАРАОКЕ",sub:"Готовы петь?",
    desc:"Закажите любимую песню и приготовьтесь блистать на сцене.",
    fields:{name:["Ваше имя","Как к вам обращаться?"],song:["Название песни","Что вы хотите спеть?"],artist:["Исполнитель","Кто исполняет эту песню?"],comment:["Комментарий","Посвящение или примечание — необязательно..."]},
    error:"Заполните это поле.",submit:"Отправить заявку",sending:"Отправка...",
    success:"Ваша заявка на песню отправлена!",stage:"Приготовьтесь выйти на сцену!",again:"Заказать ещё одну песню",
    closed:"Приём заявок закрыт",closedText:"Ведущий временно приостановил приём заявок на песни.",
    failed:"Не удалось отправить заявку. Попробуйте ещё раз.",
    steps:["Заполните форму","Дождитесь своей очереди","Пойте и получайте удовольствие!"]
  }),
  pt: common({
    live:"EXPERIÊNCIA AO VIVO",title:"NOITE DE KARAOKE",sub:"Pronto para cantar?",
    desc:"Peça a sua música favorita e prepare-se para brilhar no palco.",
    fields:{name:["O seu nome","Como gostaria de ser chamado?"],song:["Título da música","O que gostaria de cantar?"],artist:["Artista","Quem interpreta esta música?"],comment:["Comentário","Dedicatória ou nota opcional..."]},
    error:"Preencha este campo.",submit:"Enviar pedido",sending:"A enviar...",
    success:"O seu pedido de música foi enviado!",stage:"Prepare-se para subir ao palco!",again:"Pedir outra música",
    closed:"Pedidos encerrados",closedText:"O anfitrião encerrou temporariamente os pedidos de músicas.",
    failed:"Não foi possível enviar o pedido. Tente novamente.",
    steps:["Preencha o formulário","Aguarde a sua vez","Cante e divirta-se!"]
  })
};
const icons = { name: UserRound, song: Music2, artist: Mic2, comment: MessageCircleMore };

async function api(url = ENDPOINT, init?: RequestInit): Promise<ApiResponse> {
  const response = await fetch(url, {
    ...init,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers || {})
    }
  });
  const data = await response.json().catch(() => ({})) as ApiResponse;
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || data.code || "REQUEST_FAILED");
    Object.assign(error, data);
    throw error;
  }
  return data;
}

function post(data: Record<string, unknown>) {
  return api(ENDPOINT, { method: "POST", body: JSON.stringify(data) });
}

function acceptingFrom(data: ApiResponse) {
  return (data.state?.accepting ?? data.accepting) !== false;
}

function stateFrom(data: ApiResponse): ApiState {
  return data.state || data;
}

function activityDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const remainder = safe % 60;
  return `${hours}:${String(minutes).padStart(2,"0")}:${String(remainder).padStart(2,"0")}`;
}

export default function KaraokeExperience() {
  const [lang,setLang]=useState<Lang|null>(null);
  const [menu,setMenu]=useState(false);
  const [values,setValues]=useState<Record<FieldKey,string>>({name:"",song:"",artist:"",comment:""});
  const [touched,setTouched]=useState<Partial<Record<FieldKey,boolean>>>({});
  const [loading,setLoading]=useState(false);
  const [done,setDone]=useState(false);
  const [accepting,setAccepting]=useState(true);
  const [activity,setActivity]=useState<ApiState>({});
  const [clockNow,setClockNow]=useState(()=>Date.now());
  const [host,setHost]=useState(false);
  const [pin,setPin]=useState("");
  const [hostAuthenticated,setHostAuthenticated]=useState(false);
  const [newPin,setNewPin]=useState("");
  const [hostBusy,setHostBusy]=useState(false);
  const [message,setMessage]=useState("");
  const [submitError,setSubmitError]=useState("");
  const [duplicateWarning,setDuplicateWarning]=useState<DuplicateWarning|null>(null);
  const text=copy[lang||"en"];
  const warningText=duplicateCopy[lang||"en"];
  const statusText=activityCopy[lang||"en"];
  const active=languages.find(x=>x[0]===lang)||languages[0];
  const complete=Boolean(values.name.trim()&&values.song.trim()&&values.artist.trim());
  const targetSeconds=Math.max(0,Math.round((Number(activity.activityHours)||0)*3600));
  const startedAt=Date.parse(String(activity.activityStartedAt||""));
  const activityRunning=Number.isFinite(startedAt)&&activity.activityRunning!==false;
  const elapsedSeconds=activityRunning?Math.max(0,Math.floor((clockNow-startedAt)/1000)):0;
  const remainingSeconds=Math.max(0,targetSeconds-elapsedSeconds);
  const activityFinished=activityRunning&&targetSeconds>0&&remainingSeconds===0;
  const queuePeopleCount=Math.max(0,Math.floor(Number(activity.queuePeopleCount)||0));

  useEffect(()=>{
    let mounted=true;
    const refreshStatus=async()=>{
      try{
        const data=await api(`${ENDPOINT}?action=status&t=${Date.now()}`);
        if(mounted){setAccepting(acceptingFrom(data));setActivity(stateFrom(data));}
      }catch{
        // Conserva el último estado conocido mientras se recupera la conexión.
      }
    };
    refreshStatus();
    const id=window.setInterval(refreshStatus,5000);
    return()=>{mounted=false;clearInterval(id);};
  },[]);

  useEffect(()=>{
    const id=window.setInterval(()=>setClockNow(Date.now()),1000);
    return()=>clearInterval(id);
  },[]);

  const sendRequest=async(confirmDuplicate=false)=>{
    if(!complete||!accepting)return;
    setLoading(true);setSubmitError("");
    try{
      const data=await post({...values,language:active[2],confirmDuplicate});
      setAccepting(acceptingFrom(data));
      setActivity(stateFrom(data));
      setDuplicateWarning(null);
      setDone(true);
    }catch(error){
      const detail=error as Error & {code?:string;duplicates?:DuplicateWarning};
      const code=detail.code;
      if(code==="CLOSED")setAccepting(false);
      if(code==="DUPLICATE_CONFIRMATION_REQUIRED"&&detail.duplicates){
        setDuplicateWarning(detail.duplicates);
      }else{
        setSubmitError(code==="CLOSED"?text.closedText:text.failed);
      }
    }finally{setLoading(false);}
  };
  const submit=(e:FormEvent)=>{
    e.preventDefault();setTouched({name:true,song:true,artist:true});
    void sendRequest(false);
  };
  const hostAction=async(action:"start"|"open"|"close"|"reset")=>{
    if(!hostAuthenticated){setMessage("Primero valida el PIN.");return;}
    if(action==="reset"&&!window.confirm("¿Archivar y reiniciar la actividad?"))return;
    setHostBusy(true);setMessage("Procesando...");
    try{
      const data=await post({action,pin:pin.trim(),source:"web"});
      setAccepting(acceptingFrom(data));
      setActivity(stateFrom(data));
      setMessage(action==="start"?"Actividad iniciada; el reloj ya está corriendo.":action==="open"?"Solicitudes abiertas.":action==="close"?"Solicitudes cerradas.":"Actividad reiniciada.");
    }catch(error){
      const code=(error as Error & {code?:string}).code;
      if(code==="INVALID_PIN")setHostAuthenticated(false);
      setMessage(code==="INVALID_PIN"?"El PIN ya no es válido.":"No se pudo completar la acción.");
    }finally{setHostBusy(false);}
  };
  const togglePublicStatus=async()=>{
    if(!hostAuthenticated){setMessage("Primero valida el PIN.");return;}
    const show=!activity.showPublicStatus;
    setHostBusy(true);setMessage(show?"Mostrando estado público...":"Ocultando estado público...");
    try{
      const data=await post({action:"publicStatusVisibility",pin:pin.trim(),show,source:"web"});
      setAccepting(acceptingFrom(data));
      setActivity(stateFrom(data));
      setMessage(show?"El estado de la actividad ya es visible para los huéspedes.":"El estado de la actividad quedó oculto.");
    }catch(error){
      const code=(error as Error & {code?:string}).code;
      if(code==="INVALID_PIN")setHostAuthenticated(false);
      setMessage(code==="INVALID_PIN"?"El PIN ya no es válido.":"No se pudo cambiar la visualización.");
    }finally{setHostBusy(false);}
  };
  const loginHost=async()=>{
    if(!pin.trim()){setMessage("Introduce el PIN.");return;}
    setHostBusy(true);setMessage("Verificando...");
    try{
      const data=await api(`${ENDPOINT}?action=verifyHost&pin=${encodeURIComponent(pin.trim())}&t=${Date.now()}`);
      const valid=data.ok===true;
      setHostAuthenticated(valid);
      setMessage(valid?"Acceso autorizado.":"PIN incorrecto.");
    }catch{
      setHostAuthenticated(false);setMessage("PIN incorrecto.");
    }finally{setHostBusy(false);}
  };
  const changeHostPin=async()=>{
    if(!hostAuthenticated)return;
    if(!/^\d{6,12}$/.test(newPin)){setMessage("El PIN nuevo debe tener entre 6 y 12 números.");return;}
    setHostBusy(true);setMessage("Actualizando PIN...");
    try{
      await post({action:"changePin",pin:pin.trim(),newPin,source:"web"});
      setPin(newPin);setNewPin("");setMessage("PIN actualizado correctamente.");
    }catch{
      setMessage("No se pudo actualizar el PIN.");
    }finally{setHostBusy(false);}
  };
  const reset=()=>{setValues({name:"",song:"",artist:"",comment:""});setTouched({});setSubmitError("");setDuplicateWarning(null);setDone(false);};

  return <main className="page">
    <div className="ambient" aria-hidden="true"><i className="orb pink"/><i className="orb blue"/>{["♪","♫","✦","♬"].map((n,i)=><motion.span className={`note n${i}`} key={i} animate={{y:[0,-18,0],rotate:[-7,7,-7]}} transition={{duration:4+i,repeat:Infinity}}>{n}</motion.span>)}<Headphones className="ghost headphones"/><Mic2 className="ghost microphone"/></div>
    <div className="brand">✦ GUEST STAR EXPERIENCE</div>
    <AnimatePresence>{duplicateWarning&&<motion.div className="duplicateBackdrop" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}>
      <motion.section className="duplicateDialog" role="alertdialog" aria-modal="true" aria-labelledby="duplicate-title" initial={{opacity:0,scale:.94,y:14}} animate={{opacity:1,scale:1,y:0}} exit={{opacity:0,scale:.96,y:10}}>
        <span className="duplicateIcon">!</span><h2 id="duplicate-title">{warningText.title}</h2>
        {duplicateWarning.repeatedSinger&&<p>{warningText.singer}</p>}
        {duplicateWarning.duplicateSong&&<p>{duplicateWarning.duplicateSongState==="completed"?warningText.completed:warningText.active}</p>}
        <strong>{warningText.question}</strong>
        <div><button type="button" onClick={()=>setDuplicateWarning(null)}>{warningText.cancel}</button><button type="button" className="continue" disabled={loading} onClick={()=>void sendRequest(true)}>{loading?text.sending:warningText.continue}</button></div>
      </motion.section>
    </motion.div>}</AnimatePresence>
    {!lang?<motion.section className="card languageGate" initial={{opacity:0,y:24}} animate={{opacity:1,y:0}}>
      <div className="badge"><Mic2 size={31}/></div>
      <p className="eyebrow"><Sparkles size={14}/> IDIOMA DE LA CANCIÓN</p>
      <h1>¿En qué idioma vas a cantar?</h1>
      <p>Debes elegir un idioma antes de llenar la solicitud. Así buscaremos la mejor versión de karaoke y el anfitrión sabrá cuál elegiste.</p>
      <div className="languageGrid">{languages.map(x=><button type="button" key={x[0]} onClick={()=>setLang(x[0])}><span>{x[1]}</span><strong>{x[2]}</strong><Check size={18}/></button>)}</div>
    </motion.section>:<>
    <div className="selector"><button type="button" onClick={()=>setMenu(!menu)} aria-expanded={menu}>{active[1]} <span>{active[2]}</span><ChevronDown size={16}/></button>
      <AnimatePresence>{menu&&<motion.div className="menu" initial={{opacity:0,y:-8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}}>{languages.map(x=><button type="button" key={x[0]} onClick={()=>{setLang(x[0]);setMenu(false)}}>{x[1]} <span>{x[2]}</span>{x[0]===lang&&<Check size={15}/>}</button>)}</motion.div>}</AnimatePresence>
    </div>
    <button className="hostToggle" type="button" onClick={()=>setHost(!host)}><LockKeyhole size={15}/> HOST</button>
    <AnimatePresence>{host&&<motion.aside className="hostPanel" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} exit={{opacity:0,y:12}}>
      <strong><Radio size={17}/> Control del anfitrión</strong>
      {!hostAuthenticated?<><input type="password" inputMode="numeric" placeholder="PIN privado" value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,"").slice(0,12))}/>
      <div><button disabled={hostBusy} onClick={loginHost}>Entrar</button></div></>:<>
      <div><button disabled={hostBusy} onClick={()=>hostAction("start")}>Iniciar</button><button disabled={hostBusy} onClick={()=>hostAction("open")}>Abrir</button><button disabled={hostBusy} onClick={()=>hostAction("close")}>Cerrar</button><button disabled={hostBusy} onClick={()=>hostAction("reset")}>Reiniciar</button></div>
      <div className="hostStatusControl"><button disabled={hostBusy} onClick={togglePublicStatus}>{activity.showPublicStatus?<><EyeOff size={16}/> Ocultar estado al público</>:<><Eye size={16}/> Mostrar estado al público</>}</button></div>
      <input type="password" inputMode="numeric" placeholder="PIN nuevo (6–12 números)" value={newPin} onChange={e=>setNewPin(e.target.value.replace(/\D/g,"").slice(0,12))}/>
      <div><button disabled={hostBusy||!newPin} onClick={changeHostPin}>Actualizar PIN</button><button onClick={()=>{setHostAuthenticated(false);setPin("");setNewPin("");setMessage("");}}>Salir</button></div>
      </>}
      <p>{message||(accepting?"● Solicitudes abiertas":"● Solicitudes cerradas")}</p>
    </motion.aside>}</AnimatePresence>
    <AnimatePresence>{activity.showPublicStatus&&<motion.section className="publicActivityStatus" role="status" initial={{opacity:0,y:-10}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-10}}>
      <div className="publicActivityHead"><span className={`activityPulse ${activityFinished?"finished":activityRunning?"running":"waiting"}`}/><div><small>{statusText.label}</small><strong>{activityFinished?statusText.finished:activityRunning?statusText.running:statusText.notStarted}</strong></div></div>
      <div className="publicActivityMetrics"><div><Clock3 size={17}/><span><small>{statusText.elapsed}</small><strong>{activityDuration(elapsedSeconds)}</strong></span></div><div><Hourglass size={17}/><span><small>{statusText.remaining}</small><strong>{activityDuration(remainingSeconds)}</strong></span></div><div><UsersRound size={18}/><span><small>{statusText.queue}</small><strong>{queuePeopleCount}</strong></span></div></div>
    </motion.section>}</AnimatePresence>
    <motion.div className="card" initial={{opacity:0,y:24}} animate={{opacity:1,y:0}}>
      {!done?<><header><div className="badge"><Mic2 size={31}/></div><p className="eyebrow"><Sparkles size={14}/> {text.live}</p><h1>{text.title}</h1><h2>{text.sub}</h2><p className="desc">{text.desc}</p></header>
      {accepting?<form onSubmit={submit}>{(["name","song","artist","comment"] as FieldKey[]).map(k=>{const Icon=icons[k],required=k!=="comment",bad=required&&touched[k]&&!values[k].trim();return <div className="field" key={k}><label htmlFor={k}>{text.fields[k][0]} {required&&<b>*</b>}</label><div className={`input ${bad?"bad":""}`}><Icon size={20}/>{k==="comment"?<textarea id={k} value={values[k]} placeholder={text.fields[k][1]} onChange={e=>setValues(v=>({...v,[k]:e.target.value}))}/>:<input id={k} required value={values[k]} placeholder={text.fields[k][1]} onBlur={()=>setTouched(t=>({...t,[k]:true}))} onChange={e=>setValues(v=>({...v,[k]:e.target.value}))}/>}</div>{bad&&<p>{text.error}</p>}</div>})}
        <button className="submit" disabled={!complete||loading}>{loading?<><i className="loader"/>{text.sending}</>:<><Mic2 size={21}/>{text.submit}<Send className="send" size={17}/></>}</button>{submitError&&<p className="submitError" role="alert">{submitError}</p>}
      </form>:<section className="closedState"><span><XCircle size={45}/></span><h3>{text.closed}</h3><p>{text.closedText}</p></section>}</>:<section className="success"><motion.div className="successMic" animate={{y:[0,-10,0],rotate:[-5,5,-5]}} transition={{duration:2,repeat:Infinity}}><Mic2 size={55}/></motion.div><span className="check"><Check size={31}/></span><h2>🎉 {text.success}</h2><p>{text.stage}</p><button className="submit secondary" onClick={reset}><RotateCcw size={19}/>{text.again}</button></section>}
    </motion.div>
    <footer>{text.steps.map((x,i)=><div className="stepWrap" key={x}><div className="step">{i===0?<MessageCircleMore/>:i===1?<Music2/>:<Mic2/>}<span>{x}</span></div>{i<2&&<ArrowRight className="arrow" size={16}/>}</div>)}</footer>
    </>}
  </main>;
}
