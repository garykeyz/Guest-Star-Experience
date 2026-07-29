/opt/homebrew/Library/Homebrew/cmd/shellenv.sh: line 27: /bin/ps: Operation not permitted
"use client";

import { FormEvent, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowRight, Check, ChevronDown, Headphones, LockKeyhole, MessageCircleMore,
  Mic2, Music2, Radio, RotateCcw, Send, Sparkles, UserRound, XCircle
} from "lucide-react";

type Lang = "es" | "en" | "fr" | "it" | "de" | "ru" | "pt";
type FieldKey = "name" | "song" | "artist" | "comment";
type Copy = {
  live: string; title: string; sub: string; desc: string; fields: Record<FieldKey, [string, string]>;
  error: string; submit: string; sending: string; success: string; stage: string;
  again: string; closed: string; closedText: string; steps: string[];
};

const ENDPOINT = "https://script.google.com/macros/s/AKfycbxtWSOtS9IuiHJk6eRGAwy-6GsbypLUU4-3hzrNHp4NYXPcsZexgHVkF0y4KlU3zMfA/exec";
const languages: [Lang, string, string][] = [
  ["es","🇪🇸","Español"],["en","🇺🇸","English"],["fr","🇫🇷","Français"],
  ["it","🇮🇹","Italiano"],["de","🇩🇪","Deutsch"],["ru","🇷🇺","Русский"],["pt","🇵🇹","Português"]
];
const common = (x: Partial<Copy>): Copy => ({
  live:"LIVE EXPERIENCE",title:"KARAOKE NIGHT",sub:"Ready to sing?",desc:"Request your favorite song and get ready to shine on stage.",
  fields:{name:["Your Name","What should we call you?"],song:["Song Title","What would you like to sing?"],artist:["Artist","Who performs it?"],comment:["Comment","Optional dedication or note..."]},
  error:"Please complete this field.",submit:"Submit Request",sending:"Sending...",
  success:"Your song request has been sent!",stage:"Get ready to take the stage!",again:"Submit another song",
  closed:"Requests are closed",closedText:"The host has temporarily closed song requests.",
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
    steps:["Completa el formulario","Espera tu turno","¡Canta y disfruta!"]
  }),
  fr: common({
    live:"EXPÉRIENCE EN DIRECT",title:"SOIRÉE KARAOKÉ",sub:"Prêt à chanter ?",
    desc:"Demandez votre chanson préférée et préparez-vous à briller sur scène.",
    fields:{name:["Votre nom","Comment souhaitez-vous être appelé ?"],song:["Titre de la chanson","Que souhaitez-vous chanter ?"],artist:["Artiste","Qui interprète cette chanson ?"],comment:["Commentaire","Dédicace ou remarque facultative..."]},
    error:"Veuillez remplir ce champ.",submit:"Envoyer la demande",sending:"Envoi en cours...",
    success:"Votre demande de chanson a bien été envoyée !",stage:"Préparez-vous à monter sur scène !",again:"Demander une autre chanson",
    closed:"Demandes fermées",closedText:"L’animateur a temporairement fermé les demandes de chansons.",
    steps:["Remplissez le formulaire","Attendez votre tour","Chantez et amusez-vous !"]
  }),
  it: common({
    live:"ESPERIENZA DAL VIVO",title:"SERATA KARAOKE",sub:"Pronto a cantare?",
    desc:"Richiedi la tua canzone preferita e preparati a brillare sul palco.",
    fields:{name:["Il tuo nome","Come vuoi che ti chiamiamo?"],song:["Titolo della canzone","Cosa vorresti cantare?"],artist:["Artista","Chi la interpreta?"],comment:["Commento","Dedica o nota facoltativa..."]},
    error:"Compila questo campo.",submit:"Invia richiesta",sending:"Invio in corso...",
    success:"La tua richiesta è stata inviata!",stage:"Preparati a salire sul palco!",again:"Richiedi un’altra canzone",
    closed:"Richieste chiuse",closedText:"Il presentatore ha temporaneamente chiuso le richieste di brani.",
    steps:["Compila il modulo","Aspetta il tuo turno","Canta e divertiti!"]
  }),
  de: common({
    live:"LIVE-ERLEBNIS",title:"KARAOKE-NACHT",sub:"Bereit zum Singen?",
    desc:"Wünsch dir deinen Lieblingssong und mach dich bereit, auf der Bühne zu glänzen.",
    fields:{name:["Dein Name","Wie dürfen wir dich nennen?"],song:["Songtitel","Was möchtest du singen?"],artist:["Interpret/in","Von wem ist der Song?"],comment:["Kommentar","Optionale Widmung oder Nachricht..."]},
    error:"Bitte fülle dieses Feld aus.",submit:"Songwunsch senden",sending:"Wird gesendet...",
    success:"Dein Songwunsch wurde gesendet!",stage:"Mach dich bereit für deinen Auftritt!",again:"Weiteren Song wünschen",
    closed:"Keine Songwünsche möglich",closedText:"Der Gastgeber nimmt vorübergehend keine Songwünsche an.",
    steps:["Formular ausfüllen","Warte, bis du dran bist","Singen und Spaß haben!"]
  }),
  ru: common({
    live:"ЖИВОЕ ШОУ",title:"ВЕЧЕР КАРАОКЕ",sub:"Готовы петь?",
    desc:"Закажите любимую песню и приготовьтесь блистать на сцене.",
    fields:{name:["Ваше имя","Как к вам обращаться?"],song:["Название песни","Что вы хотите спеть?"],artist:["Исполнитель","Кто исполняет эту песню?"],comment:["Комментарий","Посвящение или примечание — необязательно..."]},
    error:"Заполните это поле.",submit:"Отправить заявку",sending:"Отправка...",
    success:"Ваша заявка на песню отправлена!",stage:"Приготовьтесь выйти на сцену!",again:"Заказать ещё одну песню",
    closed:"Приём заявок закрыт",closedText:"Ведущий временно приостановил приём заявок на песни.",
    steps:["Заполните форму","Дождитесь своей очереди","Пойте и получайте удовольствие!"]
  }),
  pt: common({
    live:"EXPERIÊNCIA AO VIVO",title:"NOITE DE KARAOKE",sub:"Pronto para cantar?",
    desc:"Peça a sua música favorita e prepare-se para brilhar no palco.",
    fields:{name:["O seu nome","Como gostaria de ser chamado?"],song:["Título da música","O que gostaria de cantar?"],artist:["Artista","Quem interpreta esta música?"],comment:["Comentário","Dedicatória ou nota opcional..."]},
    error:"Preencha este campo.",submit:"Enviar pedido",sending:"A enviar...",
    success:"O seu pedido de música foi enviado!",stage:"Prepare-se para subir ao palco!",again:"Pedir outra música",
    closed:"Pedidos encerrados",closedText:"O anfitrião encerrou temporariamente os pedidos de músicas.",
    steps:["Preencha o formulário","Aguarde a sua vez","Cante e divirta-se!"]
  })
};
const icons = { name: UserRound, song: Music2, artist: Mic2, comment: MessageCircleMore };

function status(callback: (open: boolean) => void) {
  const name = `karaokeStatus${Date.now()}`;
  const w = window as unknown as Record<string, unknown>;
  const script = document.createElement("script");
  const clean = () => { delete w[name]; script.remove(); };
  w[name] = (data: { accepting?: boolean }) => { callback(data.accepting !== false); clean(); };
  script.src = `${ENDPOINT}?action=status&callback=${name}&t=${Date.now()}`;
  script.onerror = clean;
  document.body.appendChild(script);
}

function verifyHostPin(pin: string, callback: (valid: boolean) => void) {
  const name = `karaokeHost${Date.now()}`;
  const w = window as unknown as Record<string, unknown>;
  const script = document.createElement("script");
  const clean = () => { delete w[name]; script.remove(); };
  w[name] = (data: { ok?: boolean }) => { callback(data.ok === true); clean(); };
  script.src = `${ENDPOINT}?action=verifyHost&pin=${encodeURIComponent(pin)}&callback=${name}&t=${Date.now()}`;
  script.onerror = () => { callback(false); clean(); };
  document.body.appendChild(script);
}

export default function KaraokeExperience() {
  const [lang,setLang]=useState<Lang>("en");
  const [menu,setMenu]=useState(false);
  const [values,setValues]=useState<Record<FieldKey,string>>({name:"",song:"",artist:"",comment:""});
  const [touched,setTouched]=useState<Partial<Record<FieldKey,boolean>>>({});
  const [loading,setLoading]=useState(false);
  const [done,setDone]=useState(false);
  const [accepting,setAccepting]=useState(true);
  const [host,setHost]=useState(false);
  const [pin,setPin]=useState("");
  const [hostAuthenticated,setHostAuthenticated]=useState(false);
  const [newPin,setNewPin]=useState("");
  const [hostBusy,setHostBusy]=useState(false);
  const [message,setMessage]=useState("");
  const text=copy[lang];
  const active=languages.find(x=>x[0]===lang)!;
  const complete=Boolean(values.name.trim()&&values.song.trim()&&values.artist.trim());

  useEffect(()=>{ status(setAccepting); const id=window.setInterval(()=>status(setAccepting),15000); return()=>clearInterval(id); },[]);

  const submit=async(e:FormEvent)=>{
    e.preventDefault(); setTouched({name:true,song:true,artist:true});
    if(!complete||!accepting)return;
    setLoading(true);
    try{
      await fetch(ENDPOINT,{method:"POST",mode:"no-cors",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({...values,language:active[2]})});
      setDone(true);
    }finally{setLoading(false);}
  };
  const hostAction=async(action:"open"|"close"|"reset")=>{
    if(!hostAuthenticated){setMessage("Primero valida el PIN.");return;}
    if(action==="reset"&&!window.confirm("¿Archivar y reiniciar la actividad?"))return;
    setHostBusy(true);setMessage("Procesando...");
    await fetch(ENDPOINT,{method:"POST",mode:"no-cors",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action,pin:pin.trim()})});
    window.setTimeout(()=>status(open=>{setAccepting(open);setMessage(action==="open"?"Solicitudes abiertas.":action==="close"?"Solicitudes cerradas.":"Actividad reiniciada.");setHostBusy(false);}),1200);
  };
  const loginHost=()=>{
    if(!pin.trim()){setMessage("Introduce el PIN.");return;}
    setHostBusy(true);setMessage("Verificando...");
    verifyHostPin(pin.trim(),valid=>{
      setHostAuthenticated(valid);
      setMessage(valid?"Acceso autorizado.":"PIN incorrecto.");
      setHostBusy(false);
    });
  };
  const changeHostPin=async()=>{
    if(!hostAuthenticated)return;
    if(!/^\d{6,12}$/.test(newPin)){setMessage("El PIN nuevo debe tener entre 6 y 12 números.");return;}
    setHostBusy(true);setMessage("Actualizando PIN...");
    await fetch(ENDPOINT,{method:"POST",mode:"no-cors",headers:{"Content-Type":"text/plain;charset=utf-8"},body:JSON.stringify({action:"changePin",pin:pin.trim(),newPin})});
    window.setTimeout(()=>verifyHostPin(newPin,valid=>{
      if(valid){setPin(newPin);setNewPin("");setMessage("PIN actualizado correctamente.");}
      else setMessage("No se pudo actualizar el PIN.");
      setHostBusy(false);
    }),1200);
  };
  const reset=()=>{setValues({name:"",song:"",artist:"",comment:""});setTouched({});setDone(false);};

  return <main className="page">
    <div className="ambient" aria-hidden="true"><i className="orb pink"/><i className="orb blue"/>{["♪","♫","✦","♬"].map((n,i)=><motion.span className={`note n${i}`} key={i} animate={{y:[0,-18,0],rotate:[-7,7,-7]}} transition={{duration:4+i,repeat:Infinity}}>{n}</motion.span>)}<Headphones className="ghost headphones"/><Mic2 className="ghost microphone"/></div>
    <div className="brand">✦ GUEST STAR EXPERIENCE</div>
    <div className="selector"><button type="button" onClick={()=>setMenu(!menu)} aria-expanded={menu}>{active[1]} <span>{active[2]}</span><ChevronDown size={16}/></button>
      <AnimatePresence>{menu&&<motion.div className="menu" initial={{opacity:0,y:-8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-8}}>{languages.map(x=><button type="button" key={x[0]} onClick={()=>{setLang(x[0]);setMenu(false)}}>{x[1]} <span>{x[2]}</span>{x[0]===lang&&<Check size={15}/>}</button>)}</motion.div>}</AnimatePresence>
    </div>
    <button className="hostToggle" type="button" onClick={()=>setHost(!host)}><LockKeyhole size={15}/> HOST</button>
    <AnimatePresence>{host&&<motion.aside className="hostPanel" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} exit={{opacity:0,y:12}}>
      <strong><Radio size={17}/> Control del anfitrión</strong>
      {!hostAuthenticated?<><input type="password" inputMode="numeric" placeholder="PIN privado" value={pin} onChange={e=>setPin(e.target.value.replace(/\D/g,"").slice(0,12))}/>
      <div><button disabled={hostBusy} onClick={loginHost}>Entrar</button></div></>:<>
      <div><button disabled={hostBusy} onClick={()=>hostAction("open")}>Abrir</button><button disabled={hostBusy} onClick={()=>hostAction("close")}>Cerrar</button><button disabled={hostBusy} onClick={()=>hostAction("reset")}>Reiniciar</button></div>
      <input type="password" inputMode="numeric" placeholder="PIN nuevo (6–12 números)" value={newPin} onChange={e=>setNewPin(e.target.value.replace(/\D/g,"").slice(0,12))}/>
      <div><button disabled={hostBusy||!newPin} onClick={changeHostPin}>Actualizar PIN</button><button onClick={()=>{setHostAuthenticated(false);setPin("");setNewPin("");setMessage("");}}>Salir</button></div>
      </>}
      <p>{message||(accepting?"● Solicitudes abiertas":"● Solicitudes cerradas")}</p>
    </motion.aside>}</AnimatePresence>
    <motion.div className="card" initial={{opacity:0,y:24}} animate={{opacity:1,y:0}}>
      {!done?<><header><div className="badge"><Mic2 size={31}/></div><p className="eyebrow"><Sparkles size={14}/> {text.live}</p><h1>{text.title}</h1><h2>{text.sub}</h2><p className="desc">{text.desc}</p></header>
      {accepting?<form onSubmit={submit}>{(["name","song","artist","comment"] as FieldKey[]).map(k=>{const Icon=icons[k],required=k!=="comment",bad=required&&touched[k]&&!values[k].trim();return <div className="field" key={k}><label htmlFor={k}>{text.fields[k][0]} {required&&<b>*</b>}</label><div className={`input ${bad?"bad":""}`}><Icon size={20}/>{k==="comment"?<textarea id={k} value={values[k]} placeholder={text.fields[k][1]} onChange={e=>setValues(v=>({...v,[k]:e.target.value}))}/>:<input id={k} required value={values[k]} placeholder={text.fields[k][1]} onBlur={()=>setTouched(t=>({...t,[k]:true}))} onChange={e=>setValues(v=>({...v,[k]:e.target.value}))}/>}</div>{bad&&<p>{text.error}</p>}</div>})}
        <button className="submit" disabled={!complete||loading}>{loading?<><i className="loader"/>{text.sending}</>:<><Mic2 size={21}/>{text.submit}<Send className="send" size={17}/></>}</button>
      </form>:<section className="closedState"><span><XCircle size={45}/></span><h3>{text.closed}</h3><p>{text.closedText}</p></section>}</>:<section className="success"><motion.div className="successMic" animate={{y:[0,-10,0],rotate:[-5,5,-5]}} transition={{duration:2,repeat:Infinity}}><Mic2 size={55}/></motion.div><span className="check"><Check size={31}/></span><h2>🎉 {text.success}</h2><p>{text.stage}</p><button className="submit secondary" onClick={reset}><RotateCcw size={19}/>{text.again}</button></section>}
    </motion.div>
    <footer>{text.steps.map((x,i)=><div className="stepWrap" key={x}><div className="step">{i===0?<MessageCircleMore/>:i===1?<Music2/>:<Mic2/>}<span>{x}</span></div>{i<2&&<ArrowRight className="arrow" size={16}/>}</div>)}</footer>
  </main>;
}
