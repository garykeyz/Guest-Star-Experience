import {createStereoMeter} from './stereo-meter.js';
import { reorderPlayerQueue } from './player-queue-ui.js';

const paths = {
  play: 'm8 5 11 7-11 7Z', pause: 'M8 5v14M16 5v14', restart: 'M4 9a8 8 0 1 1 0 7M4 3v6h6',
  skip: 'm5 5 10 7-10 7ZM19 5v14', return: 'm8 5-5 5 5 5M3 10h11a6 6 0 0 1 0 12',
  up: 'm5 14 7-7 7 7', down: 'm5 10 7 7 7-7', complete: 'm5 12 4 4L19 6',
  remove: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7M14 10v7',
  edit: 'm4 16 12-12 4 4-12 12-5 1ZM14 6l4 4', drag: 'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01'
};
export function bridgeIcon(name, doc = document) {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS(svg.namespaceURI, 'path'); path.setAttribute('d', paths[name] || paths.play);
  svg.append(path); return svg;
}

export function attachBridgeDrag(list, { move, enabled }) {
  let dragging = null;
  let frame = 0;
  const win = list.ownerDocument.defaultView;
  const rows = () => [...list.querySelectorAll('[data-bridge-row]')];
  function finish(commit = false) {
    if (!dragging) return;
    const drag = dragging; dragging = null; win.cancelAnimationFrame(frame);
    if (list.hasPointerCapture(drag.pointer)) list.releasePointerCapture(drag.pointer);
    rows().forEach(row => row.classList.remove('bridge-drag-source', 'bridge-drop-before'));
    list.classList.remove('bridge-drop-end');
    const rect = list.getBoundingClientRect();
    if (commit && drag.started && drag.x >= rect.left && drag.x <= rect.right && drag.y >= rect.top && drag.y <= rect.bottom && enabled()) {
      const order = rows().map(row => row.dataset.bridgeRow);
      const result = reorderPlayerQueue(order, drag.id, drag.before);
      if (result.moved) move(drag.id, drag.before);
    }
  }
  function paint() {
    if (!dragging?.started) return;
    const rect = list.getBoundingClientRect();
    const candidates = rows().filter(row => row.dataset.bridgeRow !== dragging.id);
    const target = candidates.find(row => dragging.y < row.getBoundingClientRect().top + row.offsetHeight / 2);
    dragging.before = target?.dataset.bridgeRow ?? null;
    rows().forEach(row => {
      row.classList.toggle('bridge-drag-source', row.dataset.bridgeRow === dragging.id);
      row.classList.toggle('bridge-drop-before', row === target);
    });
    list.classList.toggle('bridge-drop-end', !target);
    if (dragging.y < rect.top + 24) list.scrollTop -= 8;
    if (dragging.y > rect.bottom - 24) list.scrollTop += 8;
    frame = win.requestAnimationFrame(paint);
  }
  list.addEventListener('pointerdown', event => {
    const handle = event.target.closest('[data-bridge-drag]');
    if (!handle || event.button !== 0 || !event.isPrimary || !enabled()) return;
    const row = handle.closest('[data-bridge-row]');
    dragging = { id: row.dataset.bridgeRow, pointer: event.pointerId, x: event.clientX, y: event.clientY,
      startX: event.clientX, startY: event.clientY, before: null, started: false };
    list.setPointerCapture(event.pointerId); event.preventDefault();
  });
  list.addEventListener('pointermove', event => {
    if (!dragging || event.pointerId !== dragging.pointer) return;
    dragging.x = event.clientX; dragging.y = event.clientY;
    if (!dragging.started && Math.hypot(dragging.x - dragging.startX, dragging.y - dragging.startY) >= 5) {
      dragging.started = true; paint();
    }
  });
  list.addEventListener('pointerup', () => finish(true));
  list.addEventListener('pointercancel', () => finish());
  list.addEventListener('lostpointercapture', () => finish());
  win.addEventListener('keydown', event => { if (event.key === 'Escape') finish(); });
}

export function createBridgeOperations({ request, getState, refresh, notify, markOutcome, undoOutcome, i18n, redrawRequests = () => {}, doc = document }) {
  const root = doc.getElementById('bridgeOperations');
  const list = doc.getElementById('vdjQueueList');
  const drafts = new Map();
  let busy = false;
  let chosenDeck = null;
  let pendingVolume = null;
  let volumeWorking = false;
  let volumeTimer;
  let focusSnapshot;
  const text = (en, es) => i18n.getLanguage() === 'en' ? en : es;
  const post = (url, body) => request(url, { method: 'POST', body: JSON.stringify(body) });
  const playback = () => getState()?.virtualDJ?.playback || {};
  const bridgeMode = () => getState()?.operatingMode?.selected === 'bridge';
  const target = () => playback().decks?.find(deck => deck.deck === 1);
  const latestTerminal = () => [...(getState()?.requests || [])].filter(item => item.outcome && item.sourceType !== 'player_local')
    .sort((a, b) => String(b.outcomeMarkedAt || b.timestamp).localeCompare(String(a.outcomeMarkedAt || a.timestamp)))[0];

  function actionButton(name, label, handler) {
    const button = doc.createElement('button'); button.type = 'button'; button.className = 'button ghost bridge-icon-action';
    button.dataset.noI18n = ''; button.title = label; button.setAttribute('aria-label', label);
    button.append(bridgeIcon(name, doc));
    const span = doc.createElement('span'); span.textContent = label; button.append(span);
    button.addEventListener('click', handler); return button;
  }
  const status = doc.createElement('div'); status.className = 'bridge-operation-status'; status.setAttribute('role', 'status');
  const controls = doc.createElement('div'); controls.className = 'bridge-transport-actions';
  const deckSelect = doc.createElement('select'); deckSelect.id = 'bridgeDeck';
  deckSelect.setAttribute('aria-label', 'VirtualDJ deck');
  deckSelect.addEventListener('change', () => { chosenDeck = Number(deckSelect.value); render(); });
  const play = actionButton('play', 'Play', () => command(target()?.playing ? 'pause' : 'play'));
  const restart = actionButton('restart', 'Restart', () => command('restart'));
  const skip = actionButton('skip', 'Skip / Next', () => command('skip'));
  const returnButton = actionButton('return', 'Return', () => {
    const item = latestTerminal();
    if (item) undoOutcome(item.id, playback().connected && item.canRestoreToQueue ? (item.undoOriginalPosition ? 'original' : 'end') : 'pending');
  });
  deckSelect.hidden=true;
  const deckName=doc.createElement('strong');deckName.textContent='Deck 1';
  controls.append(deckName, play, restart, skip, returnButton);
  const master = doc.createElement('section'); master.className = 'player-master-output bridge-master-output';
  master.setAttribute('aria-label', 'Volumen master de salida');
  const masterLabel = doc.createElement('label'); masterLabel.htmlFor = 'bridgeMasterVolume';
  const masterText = doc.createElement('span'); masterText.textContent = 'MASTER';
  const slider = doc.createElement('input'); slider.id = 'bridgeMasterVolume'; slider.type = 'range'; slider.min = '-60'; slider.max = '0'; slider.step = '0.5';
  slider.setAttribute('aria-label', 'Master Volume VirtualDJ');
  const level = doc.createElement('output'); level.setAttribute('for', slider.id);
  masterLabel.append(masterText, slider, level); master.append(masterLabel);
  doc.getElementById('masterDock')?.append(master);
  const meterRoot = doc.createElement('div');master.prepend(meterRoot);
  const meter = createStereoMeter(meterRoot,{label:'VirtualDJ Master L/R'});
  let meterTimer=0, meterStopped=false;
  async function meterLoop() {
    if(meterStopped)return;
    const active=bridgeMode() && playback().connected && !doc.hidden;
    if(active){try{meter.update(await request('/api/virtualdj/meter'));}catch{meter.update({available:false});}}
    else meter.update({available:false});
    meterTimer=setTimeout(meterLoop,active && playback().decks?.some(d=>d.playing) ? 100 : 1000);
  }
  void meterLoop();
  doc.defaultView.addEventListener('pagehide',()=>{meterStopped=true;clearTimeout(meterTimer);meter.stop();},{once:true});
  root.append(status, controls);

  async function command(action) {
    if (busy || volumeWorking) return;
    const deck = target();
    if (!deck?.filePath || !playback().connected || !bridgeMode()) return;
    busy = true; render();
    try {
      const result = await post('/api/virtualdj/control', { action, deck: deck.deck, filePath: deck.filePath, commandId: crypto.randomUUID(),...(action==='skip'?{origin:'HOST_SKIP_VDJ_NEXT',userInitiated:true}:{}) });
      if (result.outcome?.warning) notify(result.outcome.warning, true);
      await refresh();
    } catch (error) { notify(error.message, true); }
    finally { busy = false; render(); }
  }

  async function sendVolume() {
    if (volumeWorking || pendingVolume === null) return;
    if (!bridgeMode() || !playback().connected) { pendingVolume = null; return; }
    volumeWorking = true;
    const volume = pendingVolume; pendingVolume = null;
    try {
      const result = await post('/api/virtualdj/control', { action: 'volume', volume, commandId: crypto.randomUUID() });
      // Render the confirmed VDJ readback returned by the local Bridge. This is
      // not an optimistic write and does not dispatch another input event.
      if (result.playback && getState()?.virtualDJ) getState().virtualDJ.playback = result.playback;
    }
    catch (error) { pendingVolume = null; notify(error.message, true); }
    finally {
      volumeWorking = false;
      if (pendingVolume !== null) volumeTimer = setTimeout(sendVolume, 100);
      else render();
    }
  }
  slider.addEventListener('input', () => {
    pendingVolume = 10 ** (Number(slider.value) / 20);
    level.textContent = Number(slider.value) <= -59.5 ? '−∞' : `${Number(slider.value).toFixed(1)} dB`;
    clearTimeout(volumeTimer); volumeTimer = setTimeout(sendVolume, 100);
  });
  slider.addEventListener('change', () => { clearTimeout(volumeTimer); void sendVolume(); });

  function labelButton(button, name, label) {
    button.title = label; button.setAttribute('aria-label', label);
    button.querySelector('span').textContent = label;
    const icon = button.querySelector('svg'); if (icon.dataset.icon !== name) {
      const next = bridgeIcon(name, doc); next.dataset.icon = name; icon.replaceWith(next);
    }
  }
  function render() {
    const state = getState(); const value = playback(); const deck = target();
    const requestState = state?.requests?.find(item => item.queuedFilePath === deck?.filePath && item.sourceType !== 'player_local');
    status.textContent = !bridgeMode() ? text('Select Bridge mode · VDJ controls locked', 'Selecciona modo Bridge · controles VDJ bloqueados')
      : !value.connected ? text('VDJ disconnected · Guest Star queue remains editable', 'VDJ desconectado · solicitudes Guest Star administrables')
        : `VDJ · ${deck?.title ? `${deck.title}${deck.artist ? ` · ${deck.artist}` : ''} · ` : ''}${deck?.durationSeconds ? `${Math.floor(deck.currentTimeSeconds || 0)} / ${Math.round(deck.durationSeconds)} s · ` : ''}${deck?.loaded ? (deck.playing ? text('Playing', 'Reproduciendo') : text('Paused', 'Pausado')) : text('No loaded track', 'Sin canción cargada')} · Guest Star: ${requestState?.outcome || requestState?.status || text('No linked request', 'Sin solicitud vinculada')}`;
    status.title = value.error || status.textContent;
    root.classList.toggle('is-connected', value.connected === true && bridgeMode());
    const signature = JSON.stringify(value.decks?.map(item => item.deck) || []);
    if (deckSelect.dataset.options !== signature) {
      deckSelect.textContent = '';
      for (const item of value.decks || []) {
        const option = doc.createElement('option'); option.value = item.deck; option.textContent = `Deck ${item.deck}`; deckSelect.append(option);
      }
      if (!(value.decks || []).some(item => item.deck === chosenDeck)) chosenDeck = null;
      deckSelect.dataset.options = signature;
    }
    deckSelect.value = String(chosenDeck || value.selectedDeck || 1);
    deckSelect.disabled = busy || !value.connected || !bridgeMode();
    labelButton(play, deck?.playing ? 'pause' : 'play', deck?.playing ? text('Pause VDJ', 'Pausar VDJ') : text('Play VDJ', 'Reproducir VDJ'));
    labelButton(restart, 'restart', text('Restart · selected Cue or start', 'Reiniciar · Cue seleccionado o inicio'));
    labelButton(skip, 'skip', text('Skip / Next VDJ', 'Saltar / Siguiente VDJ'));
    labelButton(returnButton, 'return', text('Return last request', 'Devolver última solicitud'));
    for (const button of [play, restart, skip]) button.disabled = busy || volumeWorking || !bridgeMode() || !value.connected || !deck?.loaded || !deck?.filePath;
    returnButton.disabled = busy || !bridgeMode() || !latestTerminal();
    slider.disabled = busy || !bridgeMode() || !value.connected || value.masterVolume == null;
    if (!volumeWorking && pendingVolume === null && doc.activeElement !== slider) {
      const db = value.masterVolume > 0 ? Math.max(-60, Math.min(0, 20 * Math.log10(value.masterVolume))) : -60;
      slider.value = String(Math.round(db * 2) / 2);
      level.textContent = value.masterVolume == null ? '—' : db <= -59.5 ? '−∞' : `${db.toFixed(1)} dB`;
    }
  }

  async function move(sourceId, beforeId) {
    if (busy || !bridgeMode()) return;
    busy = true; render(); notify(text('Moving the queue item…', 'Moviendo la canción…'));
    try {
      const administrative = sourceId.startsWith('admin:');
      const item = getState().requests.find(value => value.id === sourceId.slice(6));
      const result = await post(administrative ? `/api/requests/${encodeURIComponent(item.id)}/move` : '/api/virtualdj/queue/move',
        administrative ? { beforeId: beforeId?.slice(6) ?? null, expectedRevision: item.stateRevision, commandId: crypto.randomUUID() }
          : { sourceId, beforeId, commandId: crypto.randomUUID() });
      if (result.warning) notify(result.warning);
      await refresh();
    }
    catch (error) { notify(error.message, true); }
    finally { busy = false; render(); }
  }
  attachBridgeDrag(list, { move, enabled: () => bridgeMode() && !busy && playback().connected });
  const requests = doc.getElementById('requests');
  // Pending cards are intake only; physical queue owns all ordering controls.

  function appendRowActions(row, entry, entries) {
    for (const element of row.querySelectorAll('strong, small')) {
      if (element.textContent?.trim()) element.title = element.textContent.trim();
    }
    const id = entry.linkedRequestId ? `request:${entry.linkedRequestId}` : `vdj:${entry.virtualDJItemId}`;
    row.dataset.bridgeRow = id;
    const actions = doc.createElement('div'); actions.className = 'bridge-row-actions'; actions.dataset.noI18n = '';
    const ids = entries.map(value => value.linkedRequestId ? `request:${value.linkedRequestId}` : `vdj:${value.virtualDJItemId}`);
    const index = ids.indexOf(id);
    const handle = actionButton('drag', text('Drag to reorder', 'Arrastrar para reordenar'), () => {});
    handle.dataset.bridgeDrag = ''; handle.classList.add('bridge-drag-handle');
    const up = actionButton('up', text('Move up', 'Mover arriba'), () => move(id, ids[index - 1]));
    const down = actionButton('down', text('Move down', 'Mover abajo'), () => move(id, ids[index + 2] ?? null));
    handle.disabled = !bridgeMode() || !playback().connected;
    up.disabled = handle.disabled || index <= 0; down.disabled = handle.disabled || index >= ids.length - 1;
    actions.append(handle, up, down);
    const item = getState()?.requests?.find(value => value.id === entry.linkedRequestId);
    const operate=async action=>{
      if (entry.linkedRequestId && ['completed','skipped','removed'].includes(action)) return markOutcome(entry.linkedRequestId, action);
      if(busy)return;busy=true;render();notify(text('Applying the queue action…','Aplicando acción en la cola…'));
      try{const result=await post('/api/virtualdj/queue/action',{sourceId:id,action,commandId:crypto.randomUUID(),...(action==='load'?{origin:'HOST_PREPARE_VDJ_DECK',userInitiated:true}:{})});if(result.warning)notify(result.warning,true);await refresh();}
      catch(error){notify(error.message,true);}finally{busy=false;render();}
    };
    for(const [name,label,action] of [['play',text('Prepare in Deck 1','Preparar en Deck 1'),'load'],['complete',text('Completed','Completada'),'completed'],['skip',text('Skipped','Omitida'),'skipped'],['remove',text('Remove from queue','Eliminar de cola'),'removed']]){
      const actionControl=actionButton(name,label,()=>operate(action));
      actionControl.disabled=!bridgeMode()||!playback().connected||busy;actions.append(actionControl);
    }
    row.append(actions);
  }

  function appendRequestActions(panel, item) {
    if (!bridgeMode() || item.sourceType === 'player_local') return;
    for (const element of panel.closest('.request-card')?.querySelectorAll('.singer-name, .song, .artist') || []) {
      if (element.textContent?.trim()) element.title = element.textContent.trim();
    }
    panel.dataset.noI18n = '';
    [...panel.querySelectorAll('button')].forEach((button, index) => {
      const label = i18n.translate(button.textContent);
      button.textContent = ''; button.classList.add('bridge-icon-action');
      button.title = label; button.setAttribute('aria-label', label);
      button.append(bridgeIcon(item.outcome ? 'return' : index === 0 ? 'complete' : 'skip', doc));
      const span = doc.createElement('span'); span.textContent = label; button.append(span);
    });
    const actions = doc.createElement('div'); actions.className = 'bridge-request-actions';
    const edit = actionButton('edit', text('Edit visible metadata', 'Editar metadata visible'), () => {
      drafts.set(item.id, { singer: item.singer, song: item.song, artist: item.artist, revision: item.stateRevision });
      redrawRequests();
    });
    actions.append(edit);

    panel.append(actions);
    const draft = drafts.get(item.id); if (!draft) return;
    const form = doc.createElement('form'); form.className = 'bridge-metadata-form';
    for (const [key, label] of [['singer', text('Participant', 'Participante')], ['song', text('Title', 'Título')], ['artist', text('Artist', 'Artista')]]) {
      const wrapper = doc.createElement('label'); wrapper.textContent = label;
      const input = doc.createElement('input'); input.value = draft[key] || ''; input.maxLength = key === 'singer' ? 120 : 180;
      input.required = key !== 'artist'; input.dataset.bridgeField = key; input.dataset.bridgeRequest = item.id;
      input.addEventListener('input', () => { draft[key] = input.value; }); wrapper.append(input); form.append(wrapper);
    }
    const save = doc.createElement('button'); save.className = 'button primary'; save.textContent = text('Save', 'Guardar');
    const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.className = 'button ghost'; cancel.textContent = text('Cancel', 'Cancelar');
    cancel.addEventListener('click', () => { drafts.delete(item.id); form.remove(); });
    form.append(save, cancel); panel.append(form);
    form.addEventListener('submit', async event => {
      event.preventDefault(); save.disabled = true;
      try {
        await post(`/api/requests/${encodeURIComponent(item.id)}/metadata`, { singer: draft.singer, song: draft.song, artist: draft.artist, expectedRevision: draft.revision });
        drafts.delete(item.id); notify(text('Visible metadata saved.', 'Metadata visible guardada.')); await refresh();
      } catch (error) { notify(error.message, true); save.disabled = false; }
    });
  }

  function captureFocus() {
    const element = doc.activeElement;
    focusSnapshot = element?.dataset.bridgeField ? { id: element.dataset.bridgeRequest, field: element.dataset.bridgeField,
      start: element.selectionStart, end: element.selectionEnd } : null;
  }
  function restoreFocus() {
    if (!focusSnapshot) return;
    const input = [...doc.querySelectorAll('[data-bridge-field]')].find(value => value.dataset.bridgeRequest === focusSnapshot.id && value.dataset.bridgeField === focusSnapshot.field);
    if (input) { input.focus({ preventScroll: true }); input.setSelectionRange(focusSnapshot.start, focusSnapshot.end); }
    focusSnapshot = null;
  }
  render();
  return { render, appendRowActions, appendRequestActions, captureFocus, restoreFocus,
    resetActivityContext() { drafts.clear(); focusSnapshot=null; pendingVolume=null; clearTimeout(volumeTimer); } };
}
