import {buildActivitySummary} from './shared/activity-coverage.js';
export function initOperationsDashboard({getState, api, applyState, closeRequests, notify, language}) {
  const dock=document.getElementById('operationsDock'), copy=document.getElementById('liveCoverage');
  copy.dataset.noI18n='';
  const es=()=>language()!=='en', text=(en,spanish)=>es()?spanish:en;
  const time=s=>{s=Math.max(0,Math.round(Number(s)||0));return `${Math.floor(s/3600)}:${String(Math.floor(s/60)%60).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;};
  const clock=iso=>iso?new Date(iso).toLocaleTimeString(es()?'es-DO':'en-US',{hour:'numeric',minute:'2-digit',timeZone:getState()?.tenant?.hotel?.timezone || 'America/Santo_Domingo'}):'—';
  const close=document.getElementById('coverageCloseRequests');
  close.addEventListener('click',()=>closeRequests());
  const clear=document.getElementById('clearPendingQueue'), dialog=document.getElementById('clearQueueDialog');
  clear.addEventListener('click',()=>{dialog.showModal();document.getElementById('cancelClearQueue').focus();});
  document.getElementById('cancelClearQueue').addEventListener('click',()=>dialog.close());
  document.getElementById('confirmClearQueue').addEventListener('click',async event=>{
    const button=event.currentTarget;button.disabled=true;
    try{const result=await api('/api/operations/clear',{method:'POST',body:JSON.stringify({confirm:'CLEAR_SESSION_QUEUE_AND_HISTORY',commandId:crypto.randomUUID()})});applyState(result.state);dialog.close();notify(text('All session requests, queue and history cleared. The current VirtualDJ song continues.','Solicitudes, cola e historial de la sesión limpiados. La canción en curso de VirtualDJ continúa.'));}
    catch(error){notify(error.message,true);}finally{button.disabled=false;}
  });
  let signature='';
  function render() {
    const state=getState();dock.hidden=!state?.account?.authenticated || !(state?.account?.current?.activityId || state?.entryContext?.sessionId);
    if(dock.hidden)return;
    const admin=document.getElementById('queueAdministrativeActions');
    const playerSlot=document.getElementById('playerQueueAdministrativeSlot');
    if(state.operatingMode?.selected==='player') {if(admin.parentElement!==playerSlot)playerSlot.append(admin);}
    else if(admin.parentElement!==document.querySelector('main'))document.querySelector('.live-queue-workspace').before(admin);
    const summary=buildActivitySummary(state.activity,state.requests.concat(state.operations?.externalHistory || []),Date.now(),state.operations?.coverageQueue || null,{currentPlayback:state.operations?.currentPlayback,reserveIds:state.operations?.reserveIds});
    const fields=[
      [text('Planned','Duración'),time(summary.targetSeconds)], [text('Started','Inicio'),clock(summary.startedAt)],
      [text('End','Final'),clock(summary.eventEndsAt)], [text('Elapsed','Transcurrido'),time(summary.elapsedSeconds)],
      [text('Remaining','Restante'),time(summary.clockRemainingSeconds)],
      [text('Completed / skipped','Cantadas / omitidas'),`${summary.completedCount} / ${summary.skippedCount}`],
      [text('Queue','Cola'),`${summary.queueSongCount} · ${time(summary.queuedSeconds)}`],
      [text('Pending','Pendientes'),`${summary.pendingCount} · ${time(summary.pendingSeconds)}`],
      [text('Coverage','Cobertura'),`${summary.coveragePercent}%`], [text('Covered until','Cubiertos hasta'),clock(summary.coveredUntil)],
      [text('Uncovered','Sin cubrir'),`${time(summary.uncoveredSeconds)} · ${text('approx.','aprox.')} ${summary.estimatedSongsNeeded} ${text('songs','canciones')}`],
      [text('Standby','Reserva'),String(summary.reserveCount)]
    ];
    const next=JSON.stringify(fields);
    if(next!==signature){signature=next;copy.replaceChildren(...fields.map(([label,value])=>{const item=document.createElement('span'),small=document.createElement('small'),strong=document.createElement('strong');small.textContent=label;strong.textContent=value;item.append(small,strong);return item;}));}
    dock.dataset.coverage=summary.coverageAlert;
    close.hidden=!summary.suggestClose;close.textContent=text('Enough coverage · Close requests?','Cobertura suficiente · ¿Cerrar solicitudes?');
    dialog.querySelector('p').textContent=text('All requests and history from the current session, including Completed and Skipped, and waiting VirtualDJ tracks will be removed. The current song continues. Activity settings and schedule are preserved.','Se eliminarán todas las solicitudes y el historial de la sesión actual, incluidas Completadas y Omitidas, además de las pistas en espera de VirtualDJ. La canción en curso continuará. La actividad y su programación se conservan.');
    clear.textContent=text('Clear queue','Limpiar cola');
    clear.disabled=!state?.operatingMode?.selected;
  }
  // app.js owns the single summary clock for both modes.
  return {render};
}
