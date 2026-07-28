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
  title: string; sub: string; desc: string; fields: Record<FieldKey, [string, string]>;
  error: string; submit: string; sending: string; success: string; stage: string;
  again: string; closed: string; closedText: string; steps: string[];
};

const ENDPOINT = "https://script.google.com/macros/s/AKfycbxtWSOtS9IuiHJk6eRGAwy-6GsbypLUU4-3hzrNHp4NYXPcsZexgHVkF0y4KlU3zMfA/exec";
const languages: [Lang, string, string][] = [
  ["es","🇪🇸","Español"],["en","🇺🇸","English"],["fr","🇫🇷","Français"],
  ["it","🇮🇹","Italiano"],["de","🇩🇪","Deutsch"],["ru","🇷🇺","Русский"],["pt","🇵🇹","Português"]
];
const common = (x: Partial<Copy>): Copy => ({
  title:"KARAOKE NIGHT",sub:"Ready to Sing?",desc:"Request your favorite song and get ready to shine on stage.",
  fields:{name:["Your Name","What should we call you?"],song:["Song Title","What would you like to sing?"],artist:["Artist","Who performs it?"],comment:["Comment","Optional dedication or note..."]},
  error:"Please complete this field.",submit:"Submit Request",sending:"Sending...",
  success:"Your song request has been sent!",stage:"Get ready to take the stage!",again:"Submit another song",
  closed:"Requests are closed",closedText:"The host has temporarily closed song requests.",
  steps:["Fill the form","Wait for your turn","Sing and enjoy!"],...x
});
const copy: Record<Lang, Copy> = {
  en: common({}),
  es: common({title:"NOCHE DE KARAOKE",sub:"¿Listo para cantar?",desc:"Pide tu canción favorita y prepárate para brillar en el escenario.",fields:{name:["Tu nombre","¿Cómo te llamas?"],song:["Título de la canción","¿Qué quieres cantar?"],artist:["Artista","¿Quién la interpreta?"],comment:["Comentario","Dedicatoria o nota opcional..."]},error:"Completa este campo.",submit:"Enviar solicitud",sending:"Enviando...",success:"¡Tu canción ha sido enviada!",stage:"¡Prepárate para subir al escenario!",again:"Pedir otra canción",closed:"Solicitudes cerradas",closedText:"El anfitrión cerró temporalmente las solicitudes.",steps:["Completa el formulario","Espera tu turno","¡Canta y disfruta!"]}),
  fr: common({title:"SOIRÉE KARAOKÉ",sub:"Prêt à chanter ?",closed:"Demandes fermées",closedText:"L’animateur a temporairement fermé les demandes.",submit:"Envoyer la demande"}),
  it: common({title:"SERATA KARAOKE",sub:"Pronto a cantare?",closed:"Richieste chiuse",closedText:"L’host ha temporaneamente chiuso le richieste.",submit:"Invia richiesta"}),
  de: common({title:"KARAOKE-NACHT",sub:"Bereit zum Singen?",closed:"Anfragen geschlossen",closedText:"Der Gastgeber hat die Songwünsche geschlossen.",submit:"Anfrage senden"}),
  ru: common({title:"ВЕЧЕР КАРАОКЕ",sub:"Готовы петь?",closed:"Приём заявок закрыт",closedText:"Ведущий временно закрыл приём заявок.",submit:"Отправить заявку"}),
  pt: common({title:"NOITE DE KARAOKÊ",sub:"Pronto para cantar?",closed:"Pedidos encerrados",closedText:"O anfitrião encerrou temporariamente os pedidos.",submit:"Enviar pedido"})
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
      {!done?<><header><div className="badge"><Mic2 size={31}/></div><p className="eyebrow"><Sparkles size={14}/> LIVE EXPERIENCE</p><h1>{text.title}</h1><h2>{text.sub}</h2><p className="desc">{text.desc}</p></header>
      {accepting?<form onSubmit={submit}>{(["name","song","artist","comment"] as FieldKey[]).map(k=>{const Icon=icons[k],required=k!=="comment",bad=required&&touched[k]&&!values[k].trim();return <div className="field" key={k}><label htmlFor={k}>{text.fields[k][0]} {required&&<b>*</b>}</label><div className={`input ${bad?"bad":""}`}><Icon size={20}/>{k==="comment"?<textarea id={k} value={values[k]} placeholder={text.fields[k][1]} onChange={e=>setValues(v=>({...v,[k]:e.target.value}))}/>:<input id={k} required value={values[k]} placeholder={text.fields[k][1]} onBlur={()=>setTouched(t=>({...t,[k]:true}))} onChange={e=>setValues(v=>({...v,[k]:e.target.value}))}/>}</div>{bad&&<p>{text.error}</p>}</div>})}
        <button className="submit" disabled={!complete||loading}>{loading?<><i className="loader"/>{text.sending}</>:<><Mic2 size={21}/>{text.submit}<Send className="send" size={17}/></>}</button>
      </form>:<section className="closedState"><span><XCircle size={45}/></span><h3>{text.closed}</h3><p>{text.closedText}</p></section>}</>:<section className="success"><motion.div className="successMic" animate={{y:[0,-10,0],rotate:[-5,5,-5]}} transition={{duration:2,repeat:Infinity}}><Mic2 size={55}/></motion.div><span className="check"><Check size={31}/></span><h2>🎉 {text.success}</h2><p>{text.stage}</p><button className="submit secondary" onClick={reset}><RotateCcw size={19}/>{text.again}</button></section>}
    </motion.div>
    <footer>{text.steps.map((x,i)=><div className="stepWrap" key={x}><div className="step">{i===0?<MessageCircleMore/>:i===1?<Music2/>:<Mic2/>}<span>{x}</span></div>{i<2&&<ArrowRight className="arrow" size={16}/>}</div>)}</footer>
  </main>;
}
