"use client";

import { useRef } from "react";
import { clearPublicActivityContext, readPublicActivityContext } from "@/lib/guest-star/public-device";

/** Exit this browser's current activity without affecting other saved activities. */
export default function WrongActivityExit({token="",activityKey="",language="en",disabled=false}: {
  token?:string;activityKey?:string;language?:string;disabled?:boolean;
}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const spanish=language==="es";
  function leave() {
    const context=readPublicActivityContext();
    const currentKey=activityKey||(context?`${context.hotelId}|${context.activityId}|${context.venueId}`:"");
    try {
      window.localStorage.removeItem("guest-star-activity-session-v1");
      for(const key of ["guest-star-remembered-activities-v1","guest-star-kiosk-saved-activities-v1"]) {
        const saved=JSON.parse(window.localStorage.getItem(key)||"[]");
        if(Array.isArray(saved)) {
          const removed=saved.filter(entry=>entry&&((token&&entry.token===token)||(currentKey&&entry.key===currentKey)));
          window.localStorage.setItem(key,JSON.stringify(saved.filter(entry=>!removed.includes(entry))));
          const defaultKey=window.localStorage.getItem("guest-star-kiosk-default-activity-v1");
          if(removed.some(entry=>entry.key===defaultKey))window.localStorage.removeItem("guest-star-kiosk-default-activity-v1");
        }
      }
    } catch { /* Navigation also bypasses cached sessions when storage is unavailable. */ }
    clearPublicActivityContext();
    // A fresh document closes realtime subscriptions and discards the previous form.
    window.location.replace("/?enterCode=1");
  }
  return <div className="wrongActivityControl">
    <button type="button" disabled={disabled} onClick={()=>dialog.current?.showModal()}>{spanish?"¿Actividad incorrecta?":"Wrong activity?"}</button>
    <dialog ref={dialog} className="wrongActivityDialog" aria-labelledby="wrong-activity-title">
      <h2 id="wrong-activity-title">{spanish?"¿Quieres ingresar nuevamente el código de actividad?":"Do you want to enter the activity code again?"}</h2>
      <p>{spanish?"Por seguridad, saldrás de la sesión activa actual.":"For security, this will exit the current active session."}</p>
      <div><button type="button" onClick={()=>dialog.current?.close()}>{spanish?"Cancelar":"Cancel"}</button><button type="button" className="primaryAction" onClick={leave}>{spanish?"Salir e ingresar código":"Exit and enter code"}</button></div>
    </dialog>
  </div>;
}
