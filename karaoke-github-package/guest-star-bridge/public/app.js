const $ = (selector, root = document) => root.querySelector(selector);
const requestsEl = $("#requests");
const noticeEl = $("#notice");
const settingsDialog = $("#settingsDialog");
const successDialog = $("#successDialog");
const confirmDialog = $("#confirmDialog");
const folderList = $("#folderList");
let state = null;
let folders = [];
let activityBusy = false;
let scanBusy = false;
let syncBusy = false;
const actionLocks = new Set();
const hitSearchLocks = new Set();
const expandedRequestIds = new Set();
let lastActivityRevision = null;
let lastInstantSyncAt = 0;

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) throw new Error(data.error || "No se pudo completar.");
  return data;
}

function showNotice(message, error = false) {
  noticeEl.textContent = message;
  noticeEl.classList.remove("hidden", "error");
  if (error) noticeEl.classList.add("error");
  window.clearTimeout(showNotice.timer);
  showNotice.timer = window.setTimeout(() => noticeEl.classList.add("hidden"), 6500);
}

function showSuccess(title, detail) {
  $("#successTitle").textContent = title;
  $("#successDetail").textContent = detail;
  if (successDialog.open) successDialog.close();
  successDialog.showModal();
}

function confirmAction({
  title,
  detail,
  confirmLabel = "Confirmar",
  danger = true
}) {
  return new Promise((resolve) => {
    const accept = $("#acceptConfirm");
    const cancel = $("#cancelConfirm");
    $("#confirmTitle").textContent = title;
    $("#confirmDetail").textContent = detail;
    accept.textContent = confirmLabel;
    accept.className = `button ${danger ? "danger" : "primary"}`;

    let settled = false;
    const finish = (confirmed) => {
      if (settled) return;
      settled = true;
      accept.removeEventListener("click", acceptAction);
      cancel.removeEventListener("click", cancelAction);
      confirmDialog.removeEventListener("cancel", cancelDialog);
      if (confirmDialog.open) confirmDialog.close();
      resolve(confirmed);
    };
    const acceptAction = () => finish(true);
    const cancelAction = () => finish(false);
    const cancelDialog = (event) => {
      event.preventDefault();
      finish(false);
    };

    accept.addEventListener("click", acceptAction);
    cancel.addEventListener("click", cancelAction);
    confirmDialog.addEventListener("cancel", cancelDialog);
    if (confirmDialog.open) confirmDialog.close();
    confirmDialog.showModal();
  });
}

function actionScope(id) {
  return `request:${id}`;
}

function requestLabel(id) {
  const item = state?.requests?.find((entry) => entry.id === id);
  return item ? `${item.singer} — ${item.song}` : "La canción";
}

async function runAction(scope, progress, operation, successMessage) {
  if (actionLocks.has(scope)) {
    showNotice("Esta acción ya se está procesando. Espera la confirmación.");
    return null;
  }
  actionLocks.add(scope);
  showNotice(progress);
  renderRequests();
  try {
    const data = await operation();
    await refresh();
    const success = successMessage(data);
    showNotice(success.detail);
    showSuccess(success.title, success.detail);
    return data;
  } catch (error) {
    showNotice(`No se pudo completar la acción: ${error.message}`, true);
    return null;
  } finally {
    actionLocks.delete(scope);
    renderRequests();
  }
}

function timeAgo(value) {
  if (!value) return "Todavía no";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 5) return "Ahora mismo";
  if (seconds < 60) return `Hace ${seconds} s`;
  return `Hace ${Math.floor(seconds / 60)} min`;
}

function duration(seconds) {
  if (!seconds) return "";
  const min = Math.floor(seconds / 60);
  const sec = String(seconds % 60).padStart(2, "0");
  return `${min}:${sec}`;
}

function activityDuration(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = String(Math.floor((safe % 3600) / 60)).padStart(2, "0");
  const remaining = String(Math.floor(safe % 60)).padStart(2, "0");
  return `${hours}:${minutes}:${remaining}`;
}

function dateTime(value) {
  if (!value) return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString("es", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function clockTime(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleTimeString("es", {
    hour: "numeric",
    minute: "2-digit"
  });
}

function liveActivitySummary() {
  const summary = { ...(state?.activitySummary || {}) };
  const targetSeconds = Math.max(0, Number(summary.targetSeconds) || 0);
  const started = Date.parse(String(state?.activity?.activityStartedAt || ""));
  const activityRunning = Number.isFinite(started);
  const elapsedSeconds = activityRunning
    ? Math.max(0, Math.floor((Date.now() - started) / 1000))
    : 0;
  summary.activityRunning = activityRunning;
  summary.elapsedSeconds = elapsedSeconds;
  summary.clockRemainingSeconds = Math.max(0, targetSeconds - elapsedSeconds);
  summary.clockOverrunSeconds = Math.max(0, elapsedSeconds - targetSeconds);
  summary.eventEndsAt = activityRunning && targetSeconds > 0
    ? new Date(started + targetSeconds * 1000).toISOString()
    : "";
  return summary;
}

function updateTimeDashboard() {
  if (!state) return;
  const summary = liveActivitySummary();
  const target = Number(summary.targetSeconds) || 0;
  $("#elapsedTime").textContent = activityDuration(summary.elapsedSeconds);
  const activityDetail = $("#activityStatus p");
  if (activityDetail) {
    activityDetail.textContent = summary.activityRunning
      ? `Transcurrido: ${activityDuration(summary.elapsedSeconds)}`
      : "El reloj está en 0:00:00";
  }
  $("#elapsedDetail").textContent = !summary.activityRunning
    ? "Pulsa Iniciar actividad para activar el reloj"
    : summary.clockOverrunSeconds
      ? `La actividad superó su duración por ${activityDuration(summary.clockOverrunSeconds)}`
      : `Quedan ${activityDuration(summary.clockRemainingSeconds)} de reloj`;
  $("#confirmedTime").textContent = activityDuration(summary.confirmedSeconds);
  const queueCount = Number(summary.queueSongCount) || 0;
  $("#confirmedDetail").textContent =
    `${queueCount} ${queueCount === 1 ? "pista real" : "pistas reales"} de VDJ · ` +
    `${activityDuration(summary.completedSeconds)} ya cantado`;
  $("#plannedTime").textContent = activityDuration(summary.plannedSeconds);
  $("#plannedDetail").textContent = summary.skippedSeconds
    ? `${activityDuration(summary.skippedSeconds)} restado como saltado`
    : "Las canciones saltadas no se incluyen";

  if (summary.activityRunning && summary.eventEndsAt) {
    $("#eventEndTime").textContent = clockTime(summary.eventEndsAt);
    $("#eventEndDetail").textContent =
      `EMCEE: organiza los turnos para terminar a las ${clockTime(summary.eventEndsAt)} y no sobrepasar el evento.`;
  } else {
    $("#eventEndTime").textContent = "Pulsa Iniciar actividad";
    $("#eventEndDetail").textContent =
      "El reloj y la hora final comenzarán cuando el host inicie la actividad.";
  }

  const card = $("#coverageCard");
  card.classList.remove("ok", "warning", "over");
  if (summary.overrunSeconds) {
    card.classList.add("over");
    $("#coverageTime").textContent =
      `Se pasa ${activityDuration(summary.overrunSeconds)}`;
    $("#coverageDetail").textContent =
      `${summary.coveragePercent || 0}% cubierto frente a ${activityDuration(target)}`;
  } else if (!summary.gapSeconds) {
    card.classList.add("ok");
    $("#coverageTime").textContent = "Tiempo cubierto";
    $("#coverageDetail").textContent =
      `${summary.coveragePercent || 100}% · la rotación alcanza la actividad`;
  } else {
    card.classList.add("warning");
    $("#coverageTime").textContent =
      `Faltan ${activityDuration(summary.gapSeconds)}`;
    $("#coverageDetail").textContent =
      `${summary.coveragePercent || 0}% cubierto con lo ya cantado y la cola real`;
  }

  const advice = $("#coverageAdvice");
  advice.innerHTML = "";
  if (summary.suggestClose) {
    const text = document.createElement("div");
    text.innerHTML =
      "<strong>Ya tienes suficiente tiempo confirmado.</strong><p>Las canciones ya cantadas y las que están realmente en VirtualDJ cubren la duración de la actividad.</p>";
    advice.append(
      text,
      button("Cerrar solicitudes ahora", "danger", () => controlActivity("close"))
    );
    advice.classList.remove("hidden");
  } else if (summary.suggestHits) {
    advice.innerHTML =
      "<div><strong>La cola de VirtualDJ está vacía.</strong><p>Abajo tienes temas hit para el EMCEE o para elegir una persona al azar.</p></div>";
    advice.classList.remove("hidden");
  } else {
    advice.classList.add("hidden");
  }
}

function activityMessage(activity) {
  const action = {
    start: "La actividad fue iniciada",
    open: "Las solicitudes fueron abiertas",
    close: "Las solicitudes fueron cerradas",
    reset: "La actividad fue reiniciada"
  }[activity.lastAction];
  if (!action) return "";
  const source = {
    web: "desde el control web",
    sheet: "desde Google Sheets",
    bridge: "desde este panel"
  }[activity.lastSource] || "desde el control del host";
  return `${action} ${source}.`;
}

function setStatus(id, mode, title, detail) {
  const card = $(id);
  card.classList.remove("ok", "error");
  if (mode) card.classList.add(mode);
  $("strong", card).textContent = title;
  $("p", card).textContent = detail;
}

function updateStatus() {
  if (!state) return;
  const library = state.library;
  setStatus(
    "#libraryStatus",
    library.error ? "error" : library.count ? "ok" : "",
    library.error ? "Error al escanear" : `${library.count} pistas`,
    library.error ||
      (library.scanning
        ? "Buscando cambios en la carpeta…"
        : library.realtime
          ? `En tiempo real · actualizado ${timeAgo(library.lastScanAt).toLowerCase()}`
          : `Última búsqueda: ${timeAgo(library.lastScanAt)}`)
  );
  const sheet = state.sheet;
  setStatus(
    "#sheetStatus",
    sheet.error ? "error" : state.config.hostPinConfigured ? "ok" : "",
    sheet.error ? "Sin conexión" : `${state.requests.length} solicitudes`,
    sheet.error || (state.config.hostPinConfigured ? `Sincronizado: ${timeAgo(sheet.lastSyncAt)}` : "Configura el PIN")
  );
  const virtualDJ = state.virtualDJ || {};
  if (virtualDJ.error) {
    setStatus("#vdjStatus", "error", "Revisar conexión", virtualDJ.error);
  } else if (virtualDJ.lastQueueCheckAt) {
    setStatus(
      "#vdjStatus",
      "ok",
      `${virtualDJ.queueCount} en cola`,
      virtualDJ.checkingQueue
        ? "Comprobando la rotación…"
        : `Cola verificada: ${timeAgo(virtualDJ.lastQueueCheckAt)}`
    );
  } else {
    setStatus(
      "#vdjStatus",
      "",
      "Cola sin verificar",
      virtualDJ.checkingQueue
        ? "Comprobando la rotación…"
        : "Pulsa Sincronizar para comprobar la cola real."
    );
  }
  const activity = state.activity || {};
  const accepting = activity.accepting !== false;
  const summary = liveActivitySummary();
  const running = summary.activityRunning;
  setStatus(
    "#activityStatus",
    running ? "ok" : accepting ? "" : "error",
    running
      ? `En curso · solicitudes ${accepting ? "abiertas" : "cerradas"}`
      : "Lista para iniciar",
    running
      ? `Transcurrido: ${activityDuration(summary.elapsedSeconds)}`
      : "El reloj está en 0:00:00"
  );
  $("#openRequests").disabled = activityBusy || accepting;
  $("#closeRequests").disabled = activityBusy || !accepting;
  $("#startRequests").disabled = activityBusy || running;
  $("#startRequests").textContent = running
    ? "✓ Actividad iniciada"
    : "▶ Iniciar actividad";
  $("#resetRequests").disabled = activityBusy;
  const revision = Number(activity.stateRevision) || 0;
  if (
    lastActivityRevision !== null &&
    revision !== lastActivityRevision &&
    activity.lastSource !== "bridge"
  ) {
    const message = activityMessage(activity);
    if (message) showNotice(message);
  }
  lastActivityRevision = revision;
  updateTimeDashboard();
}

function button(label, className, handler) {
  const element = document.createElement("button");
  element.className = `button ${className}`;
  element.type = "button";
  element.textContent = label;
  element.addEventListener("click", handler);
  return element;
}

async function copyLink(url, message = "Enlace copiado.") {
  try {
    await navigator.clipboard.writeText(url);
    showNotice(message);
  } catch {
    window.prompt("Copia este enlace:", url);
  }
}

async function openExternal(url) {
  try {
    await api("/api/external/open", {
      method: "POST",
      body: JSON.stringify({ url })
    });
  } catch (error) {
    showNotice(
      `${error.message} Puedes usar “Copiar enlace” mientras lo revisamos.`,
      true
    );
  }
}

function renderSourceLink(panel, url) {
  if (!/^https?:\/\//i.test(url || "")) return;
  panel.classList.remove("hidden");
  const info = document.createElement("div");
  const label = document.createElement("small");
  label.textContent = "ENLACE DE GOOGLE SHEETS";
  const link = document.createElement("a");
  link.href = "#";
  link.textContent = url;
  link.addEventListener("click", (event) => {
    event.preventDefault();
    openExternal(url);
  });
  info.append(label, link);
  const actions = document.createElement("div");
  actions.className = "source-actions";
  actions.append(
    button("Copiar enlace", "primary", () =>
      copyLink(url, "Enlace de Google Sheets copiado.")
    ),
    button("Abrir ↗", "youtube", () => openExternal(url))
  );
  panel.append(info, actions);
}

async function queue(id, filePath, requeue = false) {
  const label = requestLabel(id);
  await runAction(
    actionScope(id),
    `Enviando ${label} a VirtualDJ…`,
    () => api(`/api/requests/${encodeURIComponent(id)}/queue`, {
      method: "POST",
      body: JSON.stringify({ filePath, requeue })
    }),
    (data) => ({
      title: data.restored
        ? "Canción colocada nuevamente"
        : data.requeued
          ? "Canción reenviada"
          : "Canción agregada a VirtualDJ",
      detail:
        data.warning ||
        `${label} quedó confirmada en la cola Karaoke de VirtualDJ.`
    })
  );
}

async function removeFromQueue(id) {
  const label = requestLabel(id);
  const confirmed = await confirmAction({
    title: "Retirar de VirtualDJ",
    detail: `¿Quieres retirar ${label} de la rotación de VirtualDJ?`,
    confirmLabel: "Sí, retirar"
  });
  if (!confirmed) return;
  await runAction(
    actionScope(id),
    `Retirando ${label} de VirtualDJ…`,
    () => api(`/api/requests/${encodeURIComponent(id)}/remove`, {
      method: "POST",
      body: "{}"
    }),
    (data) => ({
      title: "Canción retirada de VirtualDJ",
      detail:
        data.warning ||
        `${label} fue retirada y la cola real de VirtualDJ confirmó el cambio.`
    })
  );
}

async function dismissRequeue(id) {
  const label = requestLabel(id);
  await runAction(
    actionScope(id),
    `Guardando ${label} fuera de la rotación…`,
    () => api(
      `/api/requests/${encodeURIComponent(id)}/dismiss-requeue`,
      { method: "POST", body: "{}" }
    ),
    (data) => ({
      title: "Canción fuera de la rotación",
      detail:
        data.warning ||
        `${label} permanecerá fuera de VirtualDJ.`
    })
  );
}

async function markOutcome(id, outcome) {
  const songLabel = requestLabel(id);
  const label = outcome === "completed" ? "Ya cantó" : "Saltado";
  if (
    outcome === "skipped" &&
    !(await confirmAction({
      title: "Marcar como saltado",
      detail: `¿Marcar ${songLabel} como saltado, retirarlo de VirtualDJ y restarlo del tiempo total?`,
      confirmLabel: "Sí, marcar saltado"
    }))
  ) {
    return;
  }
  await runAction(
    actionScope(id),
    outcome === "completed"
      ? `Marcando ${songLabel} como ya cantado…`
      : `Marcando ${songLabel} como saltado…`,
    () => api(
      `/api/requests/${encodeURIComponent(id)}/outcome`,
      {
        method: "POST",
        body: JSON.stringify({ outcome })
      }
    ),
    (data) => ({
      title: outcome === "completed" ? "Cantante completado" : "Canción saltada",
      detail:
        data.warning ||
        (outcome === "completed"
          ? `${songLabel} quedó marcado como “Ya cantó”; permanece contado en el tiempo total y fue retirado de VirtualDJ.`
          : `${songLabel} quedó marcado como “Saltado”; fue retirado de VirtualDJ y restado del tiempo total.`)
    })
  );
}

async function undoOutcome(id, placement) {
  const songLabel = requestLabel(id);
  const actionText = {
    original: "restaurando su turno anterior",
    end: "enviándola al final de la rotación",
    pending: "deshaciendo el estado sin agregarla a la cola"
  }[placement];
  await runAction(
    actionScope(id),
    `${songLabel}: ${actionText}…`,
    () => api(
      `/api/requests/${encodeURIComponent(id)}/undo-outcome`,
      {
        method: "POST",
        body: JSON.stringify({ placement })
      }
    ),
    (data) => ({
      title: "Acción deshecha",
      detail: data.restoredToVirtualDJ
        ? `${songLabel} volvió a VirtualDJ${
            data.queuePosition ? ` en el turno ${data.queuePosition}` : ""
          }.`
        : `${songLabel} dejó de estar marcada como cantada o saltada y permanece fuera de la cola.`
    })
  );
}

async function queueSuggestion(item, singerMode) {
  const scope = `suggestion:${item.song}:${item.artist}`;
  await runAction(
    scope,
    `Agregando ${item.song} a VirtualDJ…`,
    () => api("/api/suggestions/queue", {
      method: "POST",
      body: JSON.stringify({
        song: item.song,
        artist: item.artist,
        singerMode
      })
    }),
    (data) => ({
      title: "Tema agregado a VirtualDJ",
      detail: `${data.song} fue agregada a VirtualDJ para ${data.singer}.`
    })
  );
}

async function youtube(id, panel) {
  panel.classList.remove("hidden");
  panel.innerHTML = "<p>Buscando versiones karaoke/lyrics…</p>";
  try {
    const data = await api(`/api/requests/${encodeURIComponent(id)}/youtube`, {
      method: "POST",
      body: "{}"
    });
    renderYoutube(panel, data.items || [], id);
  } catch (error) {
    panel.innerHTML = `<p>${error.message}</p>`;
  }
}

async function copyYoutubeOption(id, url) {
  try {
    const data = await api(`/api/requests/${encodeURIComponent(id)}/youtube/copy`, {
      method: "POST",
      body: JSON.stringify({ url })
    });
    const detail = data.sheetUpdated
      ? "El enlace elegido fue copiado y quedó como el único enlace de esa solicitud en Google Sheets."
      : "El enlace elegido fue copiado al portapapeles.";
    showNotice(detail);
    showSuccess("Enlace karaoke seleccionado", detail);
  } catch (error) {
    showNotice(error.message, true);
  }
}

function renderYoutube(panel, items, requestId, clipboard = {}) {
  panel.innerHTML = "";
  const title = document.createElement("h4");
  const text = document.createElement("p");
  if (!items?.length) {
    title.textContent = "Buscando un video con letras";
    text.textContent =
      clipboard.error ||
      "Todavía no encontramos un enlace suficientemente confiable. El Bridge seguirá buscando cuando sincronice.";
    panel.append(title, text);
    return;
  }

  title.textContent = "Elige la versión que prefieras";
  text.textContent =
    `Encontramos ${items.length} opcion${items.length === 1 ? "" : "es"}. ` +
    "El Bridge no copiará nada automáticamente; pulsa Copiar en la que quieras usar.";
  panel.append(title, text);

  const list = document.createElement("div");
  list.className = "youtube-list";
  items.forEach((item, index) => {
    const isKaraoke = item.resultType === "karaoke";
    const row = document.createElement("div");
    row.className = "youtube-item";
    const info = document.createElement("span");
    const optionLabel = document.createElement("small");
    optionLabel.className = "youtube-option-label";
    optionLabel.textContent = `OPCIÓN ${index + 1}`;
    const strong = document.createElement("strong");
    strong.textContent = item.title || "YouTube";
    const small = document.createElement("small");
    small.textContent = [
      isKaraoke ? "Karaoke con letras" : "Lyrics con voces",
      item.channel,
      duration(item.durationSeconds)
    ].filter(Boolean).join(" · ");
    info.append(optionLabel, strong, small);
    const actions = document.createElement("div");
    actions.className = "source-actions";
    actions.append(
      button("Copiar este enlace", "primary", () =>
        copyYoutubeOption(requestId, item.url)
      ),
      button("Abrir ↗", "youtube", () => openExternal(item.url))
    );
    row.append(info, actions);
    list.append(row);
  });
  panel.append(list);
}

function renderYoutubeForItem(item, panel) {
  if (item.youtube?.length) {
    panel.classList.remove("hidden");
    renderYoutube(panel, item.youtube, item.id);
  } else if (item.youtubeSearching) {
    panel.classList.remove("hidden");
    panel.innerHTML =
      "<h4>Buscando versiones Karaoke/Lyrics…</h4><p>Las opciones aparecerán aquí automáticamente.</p>";
  } else if (item.youtubeSearched) {
    panel.classList.remove("hidden");
    renderYoutube(
      panel,
      [],
      item.id,
      state.clipboard?.requestId === item.id ? state.clipboard : {}
    );
  }
}

function appendMissingActions(item, match, youtubePanel, message) {
  const empty = document.createElement("p");
  empty.className = "empty-match";
  empty.textContent = message;
  match.append(
    empty,
    button("Buscar opciones en YouTube", "youtube", () =>
      youtube(item.id, youtubePanel)
    ),
    document.createTextNode(" "),
    button("Escanear carpeta ahora", "ghost", scan)
  );
  renderYoutubeForItem(item, youtubePanel);
}

function renderVdjQueue() {
  const entries = Array.isArray(state?.virtualDJ?.entries)
    ? state.virtualDJ.entries
    : [];
  const summary = $("#vdjQueueSummary");
  const list = $("#vdjQueueList");
  list.innerHTML = "";
  if (!entries.length) {
    summary.textContent = state?.virtualDJ?.queueVerified
      ? "0 pistas · cola vacía"
      : "esperando confirmación";
    list.innerHTML =
      '<p class="empty-match">La cola Karaoke está vacía o todavía no se ha podido verificar.</p>';
    return;
  }
  const next = entries[0];
  summary.textContent =
    `${entries.length} pista${entries.length === 1 ? "" : "s"} · ` +
    `siguiente: ${next.singer} — ${next.song}`;
  entries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "vdj-live-row";
    const position = document.createElement("b");
    position.textContent = entry.position;
    const info = document.createElement("span");
    const song = document.createElement("strong");
    song.textContent = entry.song;
    const detail = document.createElement("small");
    detail.textContent = [entry.artist, `Cantante: ${entry.singer}`]
      .filter(Boolean)
      .join(" · ");
    info.append(song, detail);
    const durationLabel = document.createElement("span");
    durationLabel.textContent = entry.localAvailable
      ? activityDuration(entry.durationSeconds)
      : `⚠ ${activityDuration(entry.durationSeconds)} · archivo no accesible`;
    if (!entry.localAvailable) durationLabel.className = "missing-file";
    row.append(position, info, durationLabel);
    list.append(row);
  });
}

function requestTimelines(items) {
  const arrival = new Map();
  let requestedSeconds = 0;
  items.forEach((item, index) => {
    const planned =
      Math.max(0, Number(item.durationSeconds) || 240) +
      Math.max(0, Number(item.transitionSeconds) || 0);
    if (item.outcome !== "skipped") requestedSeconds += planned;
    arrival.set(item.id, {
      number: index + 1,
      cumulativeSeconds: requestedSeconds
    });
  });

  const queue = new Map();
  let queueSeconds = 0;
  [...items]
    .filter((item) => item.queued === true)
    .sort(
      (left, right) =>
        (Number(left.queuePosition) || Number.MAX_SAFE_INTEGER) -
        (Number(right.queuePosition) || Number.MAX_SAFE_INTEGER)
    )
    .forEach((item) => {
      const planned =
        Math.max(0, Number(item.durationSeconds) || 240) +
        Math.max(0, Number(item.transitionSeconds) || 0);
      queue.set(item.id, {
        estimatedStartAt: Date.now() + queueSeconds * 1000,
        cumulativeSeconds: queueSeconds + planned
      });
      queueSeconds += planned;
    });
  return { arrival, queue };
}

function renderRequests() {
  requestsEl.innerHTML = "";
  if (!state.requests.length) {
    requestsEl.innerHTML =
      '<div class="empty-state"><span>🎤</span><strong>No hay solicitudes activas.</strong><p>Cuando un huésped envíe una canción aparecerá aquí.</p></div>';
    return;
  }
  const template = $("#requestTemplate");
  const timelines = requestTimelines(state.requests);
  const groups = new Map();
  [
    ["pending", "Pendientes de entrar a la cola", "En orden de llegada"],
    ["queued", "En la cola de VirtualDJ", "Verificada en tiempo real"],
    ["finished", "Ya cantaron / finalizadas", "Se pueden deshacer y restaurar"]
  ].forEach(([key, title, detail]) => {
    const section = document.createElement("section");
    section.className = `request-group ${key}`;
    const header = document.createElement("header");
    header.className = "request-group-head";
    const copy = document.createElement("div");
    const heading = document.createElement("h3");
    heading.textContent = title;
    const description = document.createElement("p");
    description.textContent = detail;
    copy.append(heading, description);
    const count = document.createElement("span");
    count.className = "request-group-count";
    count.textContent = "0";
    header.append(copy, count);
    const list = document.createElement("div");
    list.className = "request-list";
    section.append(header, list);
    requestsEl.append(section);
    groups.set(key, { list, count, total: 0 });
  });
  state.requests.forEach((item, index) => {
    const fragment = template.content.cloneNode(true);
    const card = $(".request-card", fragment);
    const requestPending = actionLocks.has(actionScope(item.id));
    const arrival = timelines.arrival.get(item.id) || {
      number: index + 1,
      cumulativeSeconds: 0
    };
    const requestNumber = $(".request-number", card);
    requestNumber.textContent = `#${arrival.number}`;
    requestNumber.title = item.sheetRow
      ? `Solicitud ${arrival.number} · fila ${item.sheetRow} de Google Sheets`
      : `Solicitud ${arrival.number} por orden de llegada`;
    $(".singer", card).textContent = item.singer;
    $(".song", card).textContent = item.song;
    $(".artist", card).textContent = item.artist || "Artista no indicado";
    const songSeconds = Number(item.durationSeconds) || 240;
    const transitionSeconds = Math.max(
      0,
      Number(item.transitionSeconds) || 0
    );
    const plannedSeconds = songSeconds + transitionSeconds;
    const queueTimeline = timelines.queue.get(item.id);
    const rowLabel = item.sheetRow ? ` · fila ${item.sheetRow}` : "";
    $(".request-meta", card).textContent = queueTimeline
      ? `Llegada #${arrival.number}${rowLabel} · cola acumulada ${activityDuration(queueTimeline.cumulativeSeconds)} · turno aprox. ${clockTime(queueTimeline.estimatedStartAt)}`
      : `Llegada #${arrival.number}${rowLabel} · total solicitado al llegar ${activityDuration(arrival.cumulativeSeconds)}`;
    $(".request-language", card).textContent =
      `${item.language ? `Idioma: ${item.language}` : "Idioma no indicado"} · ` +
      `Pista ${activityDuration(songSeconds)} + ` +
      `transición ${activityDuration(transitionSeconds)} = ` +
      `${activityDuration(plannedSeconds)}`;
    const badge = $(".state-badge", card);
    badge.classList.add(item.localState);
    badge.textContent = {
      exact: "✓ Local encontrada",
      possible: "Coincidencia posible",
      missing: "No está local",
      queued: item.queuePosition
        ? `✓ Turno ${item.queuePosition} en VirtualDJ`
        : "✓ En VirtualDJ",
      "queued-missing": item.queuePosition
        ? `⚠ Turno ${item.queuePosition} · falta local`
        : "⚠ En VDJ · falta local",
      unverified: "? Cola de VDJ sin verificar",
      "unverified-missing": "? VDJ sin verificar · falta local",
      removed: "↻ Fuera de la cola",
      "removed-missing": "↻ Fuera · falta local",
      completed: "✓ Ya cantó",
      skipped: "− Saltado"
    }[item.localState];

    const match = $(".match-panel", card);
    renderSourceLink($(".source-panel", card), item.sourceUrl);
    const youtubePanel = $(".youtube-panel", card);
    const isQueued =
      item.localState === "queued" || item.localState === "queued-missing";
    const isUnverified =
      item.localState === "unverified" ||
      item.localState === "unverified-missing";
    const wasRemoved =
      item.localState === "removed" ||
      item.localState === "removed-missing";
    const isTerminal =
      item.localState === "completed" || item.localState === "skipped";
    const details = $(".request-details", card);
    const detailsLabel = $("summary span", details);
    details.open = expandedRequestIds.has(item.id);
    detailsLabel.textContent = details.open
      ? "Ocultar opciones y acciones"
      : "Ver opciones y acciones";
    details.addEventListener("toggle", () => {
      if (details.open) expandedRequestIds.add(item.id);
      else expandedRequestIds.delete(item.id);
      detailsLabel.textContent = details.open
        ? "Ocultar opciones y acciones"
        : "Ver opciones y acciones";
    });
    if (isTerminal) {
      match.innerHTML = item.localState === "completed"
        ? '<div class="outcome-summary completed"><strong>Esta persona ya cantó.</strong><p>Su duración permanece incluida en el total de la actividad.</p></div>'
        : '<div class="outcome-summary skipped"><strong>Esta canción fue saltada.</strong><p>Su duración fue restada del total de la actividad y no se reenviará a VirtualDJ.</p></div>';
    } else if (isUnverified) {
      match.innerHTML =
        '<div class="requeue-prompt"><strong>Google Sheets dice que esta canción fue enviada, pero la cola real de VirtualDJ todavía no pudo verificarse.</strong><p>Comprueba la cola para confirmar si sigue ahí o mostrar la opción de volver a agregarla.</p></div>';
      const actions = document.createElement("div");
      actions.className = "queue-actions";
      actions.append(
        button("Comprobar cola ahora", "primary", syncRequests)
      );
      match.append(actions);
      if (!item.localAvailable) {
        const recovery = document.createElement("div");
        recovery.className = "missing-recovery";
        appendMissingActions(
          item,
          recovery,
          youtubePanel,
          "El archivo tampoco está localmente. El Bridge volvió a buscar versiones Karaoke/Lyrics para que elijas cuál copiar."
        );
        match.append(recovery);
      }
    } else if (wasRemoved) {
      match.innerHTML =
        '<div class="requeue-prompt"><strong>Esta canción ya no aparece en la cola de VirtualDJ.</strong><p>¿Quieres volver a colocarla al final de la rotación?</p></div>';
      const actions = document.createElement("div");
      actions.className = "queue-actions";
      if (item.localAvailable) {
        actions.append(
          button("Sí, volver a agregar al final", "primary", () =>
            queue(
              item.id,
              item.matches.find((candidate) => candidate.exact)?.filePath ||
                item.queuedFilePath,
              false
            )
          )
        );
      }
      actions.append(
        button("No, dejarla fuera", "ghost", () => dismissRequeue(item.id))
      );
      match.append(actions);
      if (!item.localAvailable) {
        const recovery = document.createElement("div");
        recovery.className = "missing-recovery";
        appendMissingActions(
          item,
          recovery,
          youtubePanel,
          "Además, el archivo ya no está localmente. El Bridge volvió a buscar opciones Karaoke/Lyrics para que elijas cuál copiar."
        );
        match.append(recovery);
      }
    } else if (isQueued) {
      match.innerHTML =
        item.localState === "queued"
          ? '<p class="empty-match">Esta solicitud está marcada como enviada. Puedes moverla nuevamente al final de la rotación o retirarla.</p>'
          : '<p class="empty-match missing-warning">El archivo que estaba asociado a esta solicitud ya no existe en la carpeta local.</p>';
      const actions = document.createElement("div");
      actions.className = "queue-actions";
      if (item.localAvailable) {
        actions.append(
          button("Reenviar al final de la rotación", "primary", () =>
            queue(item.id, item.queuedFilePath, true)
          )
        );
      }
      actions.append(
        button("Retirar de VirtualDJ", "danger", () => removeFromQueue(item.id))
      );
      match.append(actions);
      if (item.localState === "queued-missing") {
        const recovery = document.createElement("div");
        recovery.className = "missing-recovery";
        appendMissingActions(
          item,
          recovery,
          youtubePanel,
          "El Bridge volvió a buscar versiones con letras. Elige una opción para copiar o devuelve el archivo a la carpeta y aparecerá aquí en tiempo real."
        );
        match.append(recovery);
      }
    } else if (item.matches.length) {
      const top = item.matches[0];
      const row = document.createElement("div");
      row.className = "match-row";
      const info = document.createElement("div");
      info.className = "match-file";
      const strong = document.createElement("strong");
      strong.textContent = top.fileName;
      const small = document.createElement("small");
      small.textContent = `${Math.round(top.score * 100)}% de coincidencia`;
      info.append(strong, small);
      row.append(info, button("Agregar a VirtualDJ", "primary", () => queue(item.id, top.filePath)));
      match.append(row);
      if (item.matches.length > 1) {
        const candidates = document.createElement("div");
        candidates.className = "candidate-list";
        item.matches.slice(1).forEach((candidate) => {
          const option = document.createElement("div");
          option.className = "candidate";
          const infoOption = document.createElement("span");
          const name = document.createElement("strong");
          name.textContent = candidate.fileName;
          const score = document.createElement("small");
          score.textContent = `${Math.round(candidate.score * 100)}% de coincidencia`;
          infoOption.append(name, score);
          option.append(
            infoOption,
            button("Usar esta", "ghost", () => queue(item.id, candidate.filePath))
          );
          candidates.append(option);
        });
        match.append(candidates);
      }
      if (!item.localAvailable) {
        const recovery = document.createElement("div");
        recovery.className = "missing-recovery";
        appendMissingActions(
          item,
          recovery,
          youtubePanel,
          "No hay una coincidencia local exacta. Puedes revisar la pista posible o elegir uno de los enlaces que volvió a buscar el Bridge."
        );
        match.append(recovery);
      }
    } else {
      appendMissingActions(
        item,
        match,
        youtubePanel,
        "No está local. El Bridge busca un video con letras y vigila la carpeta en tiempo real."
      );
    }
    const outcomePanel = $(".outcome-panel", card);
    if (!isTerminal) {
      outcomePanel.append(
        button("✓ Ya cantó", "success", () =>
          markOutcome(item.id, "completed")
        ),
        button("Saltado", "danger", () =>
          markOutcome(item.id, "skipped")
        )
      );
    } else {
      if (item.canRestoreToQueue && item.undoOriginalPosition) {
        outcomePanel.append(
          button(
            `Deshacer y volver al turno ${item.undoOriginalPosition}`,
            "primary",
            () => undoOutcome(item.id, "original")
          )
        );
      }
      if (item.canRestoreToQueue) {
        outcomePanel.append(
          button("Deshacer y enviar al final", "ghost", () =>
            undoOutcome(item.id, "end")
          )
        );
      }
      outcomePanel.append(
        button("Solo deshacer · dejar fuera", "danger", () =>
          undoOutcome(item.id, "pending")
        )
      );
    }
    if (requestPending) {
      card.classList.add("processing");
      badge.textContent = "Procesando…";
      card.querySelectorAll("button").forEach((element) => {
        element.disabled = true;
      });
    }
    const groupKey = isTerminal ? "finished" : item.queued === true ? "queued" : "pending";
    const group = groups.get(groupKey);
    group.total += 1;
    group.count.textContent = group.total;
    group.list.append(fragment);
  });
  groups.forEach((group) => {
    if (group.total) return;
    const empty = document.createElement("p");
    empty.className = "group-empty";
    empty.textContent = "No hay canciones en esta sección.";
    group.list.append(empty);
  });
}

function renderHitSuggestions() {
  const panel = $("#hitSuggestions");
  panel.innerHTML = "";
  const items = state?.hitSuggestions || [];
  if (!items.length) {
    panel.classList.add("hidden");
    return;
  }
  panel.classList.remove("hidden");
  const header = document.createElement("div");
  header.className = "hit-header";
  header.innerHTML =
    "<div><p class=\"eyebrow\">PLAN B PARA LA ROTACIÓN</p><h2>Temas hit equilibrados en español e inglés</h2><p>Usa una pista local para el EMCEE o busca el mejor enlace Karaoke cuando aún no esté en el disco.</p></div>";
  const grid = document.createElement("div");
  grid.className = "hit-grid";
  items.forEach((item) => {
    const card = document.createElement("article");
    card.className = "hit-card";
    const info = document.createElement("div");
    const language = document.createElement("small");
    language.textContent = item.language;
    const song = document.createElement("strong");
    song.textContent = item.song;
    const artist = document.createElement("p");
    artist.textContent = item.artist;
    const availability = document.createElement("em");
    availability.textContent = item.localAvailable
      ? `Local: ${item.fileName}`
      : "No está local";
    info.append(language, song, artist, availability);
    const actions = document.createElement("div");
    actions.className = "queue-actions";
    if (item.localAvailable) {
      actions.append(
        button("Agregar para EMCEE", "primary", () =>
          queueSuggestion(item, "emcee")
        ),
        button("Cantante al azar", "ghost", () =>
          queueSuggestion(item, "random")
        )
      );
    } else {
      actions.append(
        button("Buscar carpeta", "ghost", scan)
      );
      const key = `${item.language}:${item.artist}:${item.song}`;
      if (item.youtube?.[0]) {
        const selected = item.youtube[0];
        actions.append(
          button("Copiar enlace Karaoke", "primary", () =>
            copyLink(selected.url, `Enlace Karaoke de ${item.song} copiado.`)
          ),
          button("Abrir ↗", "youtube", () => openExternal(selected.url))
        );
        const link = document.createElement("a");
        link.className = "hit-youtube-link";
        link.href = selected.url;
        link.textContent = selected.title || selected.url;
        link.addEventListener("click", (event) => {
          event.preventDefault();
          openExternal(selected.url);
        });
        info.append(link);
      } else if (item.youtubeSearched) {
        const unavailable = document.createElement("span");
        unavailable.className = "hit-youtube-empty";
        unavailable.textContent = "No se encontró una versión Karaoke confiable todavía.";
        info.append(unavailable);
        actions.append(
          button("Reintentar enlace Karaoke", "youtube", () =>
            searchHitYoutube(item, key)
          )
        );
      } else {
        const searchButton = button(
          hitSearchLocks.has(key) ? "Buscando Karaoke…" : "Buscar enlace Karaoke",
          "youtube",
          () => searchHitYoutube(item, key)
        );
        searchButton.disabled = hitSearchLocks.has(key);
        actions.append(searchButton);
      }
    }
    card.append(info, actions);
    grid.append(card);
  });
  panel.append(header, grid);
}

async function searchHitYoutube(item, key) {
  if (hitSearchLocks.has(key)) return;
  hitSearchLocks.add(key);
  renderHitSuggestions();
  showNotice(`Buscando la mejor versión Karaoke de ${item.song}…`);
  try {
    const data = await api("/api/suggestions/youtube", {
      method: "POST",
      body: JSON.stringify({
        song: item.song,
        artist: item.artist,
        language: item.language,
        force: true
      })
    });
    await refresh();
    showNotice(data.items?.length
      ? "Enlace Karaoke encontrado; ya puedes copiarlo."
      : "No se encontró todavía una versión Karaoke confiable.");
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    hitSearchLocks.delete(key);
    renderHitSuggestions();
  }
}

function renderFolders() {
  folderList.innerHTML = "";
  if (!folders.length) {
    const note = document.createElement("p");
    note.className = "empty-match";
    note.textContent = "Todavía no has elegido una carpeta.";
    folderList.append(note);
    return;
  }
  folders.forEach((folder, index) => {
    const row = document.createElement("div");
    row.className = "folder-row";
    const input = document.createElement("input");
    input.value = folder;
    input.addEventListener("input", () => { folders[index] = input.value; });
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "×";
    remove.setAttribute("aria-label", "Quitar carpeta");
    remove.addEventListener("click", () => {
      folders.splice(index, 1);
      renderFolders();
    });
    row.append(input, remove);
    folderList.append(row);
  });
}

function fillSettings() {
  folders = [...state.config.libraryFolders];
  renderFolders();
  $("#rememberLibraryFolders").checked =
    state.config.rememberLibraryFolders !== false;
  $("#appsScriptUrl").value = state.config.appsScriptUrl || "";
  $("#hostPin").value = "";
  $("#hostPin").placeholder = state.config.hostPinConfigured
    ? "PIN guardado · dejar vacío para conservar"
    : "PIN privado";
  $("#rememberHostPin").checked = state.config.rememberHostPin !== false;
  $("#vdjPort").value = state.config.virtualDJ.port || 80;
  $("#vdjPassword").value = "";
  $("#vdjPassword").placeholder = state.config.virtualDJ.passwordConfigured
    ? "Contraseña guardada · dejar vacío para conservar"
    : "Sin contraseña";
  $("#autoQueueExact").checked = Boolean(state.config.autoQueueExact);
  const activity = state.activity || {};
  $("#activityHours").value = Number(activity.activityHours) || 2;
  $("#transitionSeconds").value =
    Math.max(0, Number(activity.transitionSeconds) || 0);
  $("#acceptingRequests").checked = activity.accepting !== false;
  $("#settingsStartedAt").textContent = dateTime(activity.activityStartedAt);
  $("#settingsAccumulated").textContent =
    activityDuration(activity.accumulatedSeconds);
  $("#settingsRemaining").textContent =
    activityDuration(activity.remainingSeconds);
  $("#settingsActivityId").textContent = activity.activityId || "—";
  $("#settingsRevision").textContent =
    String(activity.stateRevision ?? "—");
  $("#settingsUpdatedAt").textContent = dateTime(activity.updatedAt);
  $("#settingsLastAction").textContent = activity.lastAction || "—";
  $("#settingsLastSource").textContent = activity.lastSource || "—";
}

function settingsPayload() {
  return {
    libraryFolders: folders.map((item) => item.trim()).filter(Boolean),
    rememberLibraryFolders: $("#rememberLibraryFolders").checked,
    appsScriptUrl: $("#appsScriptUrl").value.trim(),
    hostPin: $("#hostPin").value.trim(),
    rememberHostPin: $("#rememberHostPin").checked,
    virtualDJ: {
      port: Number($("#vdjPort").value) || 80,
      password: $("#vdjPassword").value
    },
    autoQueueExact: $("#autoQueueExact").checked,
    sheetConfig: {
      activityHours: Number($("#activityHours").value) || 2,
      transitionSeconds: Math.max(
        0,
        Number($("#transitionSeconds").value) || 0
      ),
      accepting: $("#acceptingRequests").checked
    }
  };
}

async function refresh() {
  try {
    applyState(await api("/api/state"));
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function scan() {
  if (scanBusy) {
    showNotice("La biblioteca ya se está actualizando.");
    return;
  }
  scanBusy = true;
  try {
    applyState(await api("/api/library/scan", { method: "POST", body: "{}" }));
    showNotice(`Biblioteca actualizada: ${state.library.count} pistas encontradas.`);
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    scanBusy = false;
  }
}

async function syncRequests({ quiet = false } = {}) {
  if (syncBusy) {
    if (!quiet) showNotice("La sincronización ya está en curso.");
    return;
  }
  syncBusy = true;
  updateStatus();
  try {
    applyState(
      await api("/api/requests/sync", { method: "POST", body: "{}" })
    );
    if (!quiet) {
      showNotice("Solicitudes y cola real de VirtualDJ sincronizadas.");
    }
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    syncBusy = false;
    updateStatus();
  }
}

function syncWhenActive() {
  if (document.visibilityState === "hidden") return;
  const now = Date.now();
  if (now - lastInstantSyncAt < 1500) return;
  lastInstantSyncAt = now;
  void syncRequests({ quiet: true });
}

async function controlActivity(action) {
  if (activityBusy) {
    showNotice("Ya se está procesando un cambio de actividad.");
    return;
  }
  if (
    action === "reset" &&
    !(await confirmAction({
      title: "Reiniciar actividad",
      detail: "¿Archivar todas las solicitudes y comenzar una actividad nueva?",
      confirmLabel: "Sí, reiniciar"
    }))
  ) {
    return;
  }
  activityBusy = true;
  updateStatus();
  try {
    applyState(
      await api(`/api/activity/${action}`, { method: "POST", body: "{}" })
    );
    showNotice({
      start: "Actividad iniciada. El reloj y la hora final ya están corriendo.",
      open: "Solicitudes abiertas en la web y en el Bridge.",
      close: "Solicitudes cerradas en la web y en el Bridge.",
      reset: "Actividad reiniciada y cola local sincronizada."
    }[action]);
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    activityBusy = false;
    updateStatus();
  }
}

$("#scanButton").addEventListener("click", scan);
$("#startRequests").addEventListener("click", () => controlActivity("start"));
$("#openRequests").addEventListener("click", () => controlActivity("open"));
$("#closeRequests").addEventListener("click", () => controlActivity("close"));
$("#resetRequests").addEventListener("click", () => controlActivity("reset"));
$("#syncButton").addEventListener("click", syncRequests);
$("#settingsButton").addEventListener("click", () => {
  fillSettings();
  settingsDialog.showModal();
});
$("#closeSettings").addEventListener("click", () => settingsDialog.close());
$("#closeSuccess").addEventListener("click", () => successDialog.close());
$("#addFolder").addEventListener("click", () => {
  folders.push("");
  renderFolders();
  folderList.lastElementChild?.querySelector("input")?.focus();
});
$("#chooseFolder").addEventListener("click", async () => {
  try {
    const data = await api("/api/library/choose-folder", { method: "POST", body: "{}" });
    if (!folders.includes(data.folder)) folders.push(data.folder);
    renderFolders();
  } catch (error) {
    showNotice(error.message, true);
  }
});
$("#forgetHostPin").addEventListener("click", async () => {
  if (!(await confirmAction({
    title: "Olvidar PIN",
    detail: "¿Olvidar el PIN guardado en este Mac?",
    confirmLabel: "Sí, olvidar"
  }))) return;
  try {
    await api("/api/config", {
      method: "POST",
      body: JSON.stringify({ clearHostPin: true })
    });
    showNotice("El PIN guardado fue retirado de la app.");
    await refresh();
    fillSettings();
  } catch (error) {
    showNotice(error.message, true);
  }
});
$("#forgetVdjPassword").addEventListener("click", async () => {
  if (!(await confirmAction({
    title: "Quitar contraseña",
    detail: "¿Quitar la contraseña guardada de VirtualDJ?",
    confirmLabel: "Sí, quitar"
  }))) return;
  try {
    await api("/api/config", {
      method: "POST",
      body: JSON.stringify({ clearVdjPassword: true })
    });
    showNotice("La contraseña guardada de VirtualDJ fue retirada.");
    await refresh();
    fillSettings();
  } catch (error) {
    showNotice(error.message, true);
  }
});
$("#settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = settingsPayload();
    await api("/api/config", { method: "POST", body: JSON.stringify(payload) });
    settingsDialog.close();
    showNotice("Configuración guardada.");
    await refresh();
  } catch (error) {
    showNotice(error.message, true);
  }
});
$("#testSheet").addEventListener("click", async () => {
  try {
    const data = await api("/api/apps-script/test", {
      method: "POST",
      body: JSON.stringify(settingsPayload())
    });
    showSuccess(
      "Google Sheets está conectado",
      `Todo está correcto. Code.gs ${data.codeVersion} respondió con ${data.requestCount} solicitudes activas.`
    );
  } catch (error) {
    showNotice(error.message, true);
  }
});
$("#testVdj").addEventListener("click", async () => {
  try {
    const data = await api("/api/virtualdj/test", {
      method: "POST",
      body: JSON.stringify(settingsPayload())
    });
    setStatus(
      "#vdjStatus",
      "ok",
      `${data.queueCount} en cola`,
      `Cola Karaoke verificada · hora ${data.clock || "disponible"}`
    );
    showSuccess(
      "VirtualDJ y su cola están conectados",
      `Todo está correcto. La cola Karaoke respondió con ${data.queueCount} canción${data.queueCount === 1 ? "" : "es"}${data.clock ? ` y VirtualDJ reportó la hora ${data.clock}` : ""}.`
    );
  } catch (error) {
    setStatus("#vdjStatus", "error", "Sin conexión", error.message);
    showNotice(error.message, true);
  }
});

function applyState(nextState) {
  state = nextState;
  updateStatus();
  renderVdjQueue();
  renderRequests();
  renderHitSuggestions();
}

function connectRealtime() {
  const source = new EventSource("/api/events");
  source.addEventListener("state", (event) => {
    try {
      applyState(JSON.parse(event.data));
    } catch {
      // EventSource reconnects automatically; the fallback refresh remains active.
    }
  });
  return source;
}

await refresh();
const realtimeSource = connectRealtime();
window.addEventListener("beforeunload", () => realtimeSource.close());
window.addEventListener("focus", syncWhenActive);
document.addEventListener("visibilitychange", syncWhenActive);
window.setInterval(updateTimeDashboard, 1000);
window.setInterval(refresh, 30000);
