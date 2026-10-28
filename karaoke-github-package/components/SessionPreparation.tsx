"use client";
import { useState, type FormEvent } from "react";

type Entity = Record<string, unknown>;
export default function SessionPreparation({selected, source, busy, onCancel, onOpen}: {
  selected: Entity; source:string; busy:boolean; onCancel:()=>void;
  onOpen:(settings:Entity)=>Promise<boolean>;
}) {
  const next = (selected.upcomingActivities as Entity[] | undefined)?.find(item=>item.hotelId===(selected.hotel as Entity)?.hotelId && item.activityId===(selected.activity as Entity)?.activityId && item.venueId===(selected.venue as Entity)?.venueId);
  const activity = selected.activity as Entity;
  const state = selected.state as Entity;
  const hotel = selected.hotel as Entity;
  const [mode,setMode] = useState(next?"scheduled":"free");
  const [start,setStart] = useState(next?"specific":"now");
  const [queue,setQueue] = useState("");
  const [settings,setSettings] = useState<Entity|null>(null);
  const [submitting,setSubmitting] = useState(false);
  const current=selected.session as Entity|undefined;
  const pending = Number(selected.previousQueueCount)||0;
  let localStart="";
  if(next?.scheduledStartAt) {
    const parts=new Intl.DateTimeFormat("sv-SE",{timeZone:String(hotel.timezone||"UTC"),year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(String(next.scheduledStartAt)));
    localStart=parts.replace(" ","T");
  }
  const open = async(data:Entity)=>{
    if(submitting)return;
    setSubmitting(true);
    try { if(await onOpen({...data,queueChoice:data.queueChoice||queue||undefined}))onCancel(); }
    finally {setSubmitting(false);}
  };
  const submit=(event:FormEvent<HTMLFormElement>)=>{
    event.preventDefault(); const form=new FormData(event.currentTarget);
    const data={sessionMode:mode,scheduleId:mode==="scheduled"?next?.scheduleId:undefined,
      startsAt:start==="now"?new Date().toISOString():undefined,
      startsLocal:start==="specific"?String(form.get("startsLocal")||""):undefined,
      durationSeconds:Number(form.get("minutes"))*60, autoStart:form.get("autoStart")==="on",
      finalMessage:String(form.get("finalMessage")||""),source,expectedRevision:state?.stateRevision||0};
    if(pending&&!queue){setSettings(data);return;}
    void open(data);
  };
  if(current&&["scheduled","in_progress"].includes(String(current.status))) return <div className="duplicateBackdrop"><section className="duplicateDialog" role="dialog" aria-modal="true"><h2>Sesión actual</h2><p>{Number(current.durationSeconds)/60} minutos</p><button onClick={onCancel}>Cancelar</button><button disabled={busy||submitting} onClick={()=>void open({runId:current.runId,source})}>Reabrir solicitudes</button></section></div>;
  return <div className="duplicateBackdrop"><section className="duplicateDialog" role="dialog" aria-modal="true" aria-labelledby="prepare-session-title">
    <h2 id="prepare-session-title">Preparar sesión</h2>
    {settings?<><p>Hay solicitudes de la actividad anterior. ¿Deseas limpiar la cola antes de abrir nuevas solicitudes?</p>
      <button disabled={busy||submitting} onClick={()=>{setQueue("clear");void open({...settings,queueChoice:"clear"});}}>Limpiar y abrir</button>
      <button disabled={busy||submitting} onClick={()=>{setQueue("keep");void open({...settings,queueChoice:"keep"});}}>Conservar y abrir</button>
      <button onClick={onCancel}>Cancelar</button></>:<form onSubmit={submit}>
      {next&&<p>Próxima programación<br/><strong>{new Date(String(next.scheduledStartAt)).toLocaleString("es-DO",{timeZone:String(hotel.timezone||"UTC")})}</strong></p>}
      <label>Sesión<select value={mode} onChange={e=>setMode(e.target.value)}>{next&&<option value="scheduled">Usar programación</option>}<option value="free">Modo libre</option></select></label>
      <label>Inicio<select value={start} onChange={e=>setStart(e.target.value)}><option value="now">Ahora</option><option value="specific">Hora específica</option></select></label>
      {start==="specific"&&<label>Fecha y hora · {String(hotel.timezone||"UTC")}<input type="datetime-local" name="startsLocal" required defaultValue={localStart}/></label>}
      <label>Duración (minutos)<input type="number" name="minutes" min="15" max="10080" required defaultValue={Number(next?.durationSeconds||activity.defaultDurationSeconds||7200)/60}/></label>
      <label><input type="checkbox" name="autoStart" disabled={!source}/> Iniciar automáticamente a la hora configurada</label>
      <label>Mensaje final (opcional)<textarea name="finalMessage" maxLength={2000}/></label>
      <div><button type="button" onClick={onCancel}>Cancelar</button><button disabled={busy||submitting}>Abrir solicitudes</button></div>
    </form>}
  </section></div>;
}
