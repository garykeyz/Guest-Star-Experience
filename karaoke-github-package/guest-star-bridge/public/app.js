const $ = (selector, root = document) => root.querySelector(selector);
const requestsEl = $("#requests");
const noticeEl = $("#notice");
const settingsDialog = $("#settingsDialog");
const successDialog = $("#successDialog");
const folderList = $("#folderList");
let state = null;
let folders = [];
let busy = false;
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

function liveActivitySummary() {
  const summary = { ...(state?.activitySummary || {}) };
  const targetSeconds = Math.max(0, Number(summary.targetSeconds) || 0);
  const started = Date.parse(String(state?.activity?.activityStartedAt || ""));
  const elapsedSeconds = Number.isFinite(started)
    ? Math.max(0, Math.floor((Date.now() - started) / 1000))
    : Math.max(0, Number(summary.elapsedSeconds) || 0);
  summary.elapsedSeconds = elapsedSeconds;
  summary.clockRemainingSeconds = Math.max(0, targetSeconds - elapsedSeconds);
  summary.clockOverrunSeconds = Math.max(0, elapsedSeconds - targetSeconds);
  return summary;
}

function updateTimeDashboard() {
  if (!state) return;
  const summary = liveActivitySummary();
  const target = Number(summary.targetSeconds) || 0;
  $("#elapsedTime").textContent = activityDuration(summary.elapsedSeconds);
  $("#elapsedDetail").textContent = summary.clockOverrunSeconds
    ? `La actividad superó su duración por ${activityDuration(summary.clockOverrunSeconds)}`
    : `Quedan ${activityDuration(summary.clockRemainingSeconds)} de reloj`;
  $("#confirmedTime").textContent = activityDuration(summary.confirmedSeconds);
  $("#confirmedDetail").textContent =
    `${summary.queueSongCount || 0} en cola · ` +
    `${activityDuration(summary.completedSeconds)} ya cantado`;
  $("#plannedTime").textContent = activityDuration(summary.plannedSeconds);
  $("#plannedDetail").textContent = summary.skippedSeconds
    ? `${activityDuration(summary.skippedSeconds)} restado como saltado`
    : "Las canciones saltadas no se incluyen";

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
  setStatus(
    "#activityStatus",
    accepting ? "ok" : "error",
    accepting ? "Solicitudes abiertas" : "Solicitudes cerradas",
    `Transcurrido: ${activityDuration(summary.elapsedSeconds)}`
  );
  $("#openRequests").disabled = busy || accepting;
  $("#closeRequests").disabled = busy || !accepting;
  $("#resetRequests").disabled = busy;
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
  if (busy) return;
  busy = true;
  try {
    const data = await api(`/api/requests/${encodeURIComponent(id)}/queue`, {
      method: "POST",
      body: JSON.stringify({ filePath, requeue })
    });
    showNotice(
      data.warning ||
      (data.restored
        ? "Canción colocada nuevamente al final de la rotación."
        : data.requeued
          ? "Canción reenviada al final de la rotación de VirtualDJ."
          : "Canción agregada a la cola Karaoke de VirtualDJ.")
    );
    await refresh();
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    busy = false;
  }
}

async function removeFromQueue(id) {
  if (busy) return;
  if (!window.confirm("¿Retirar esta canción de la rotación de VirtualDJ?")) return;
  busy = true;
  try {
    const data = await api(`/api/requests/${encodeURIComponent(id)}/remove`, {
      method: "POST",
      body: "{}"
    });
    showNotice(data.warning || "Canción retirada de la rotación de VirtualDJ.");
    await refresh();
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    busy = false;
  }
}

async function dismissRequeue(id) {
  if (busy) return;
  busy = true;
  try {
    const data = await api(
      `/api/requests/${encodeURIComponent(id)}/dismiss-requeue`,
      { method: "POST", body: "{}" }
    );
    showNotice(data.warning || "La canción permanecerá fuera de la rotación.");
    await refresh();
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    busy = false;
  }
}

async function markOutcome(id, outcome) {
  if (busy) return;
  const label = outcome === "completed" ? "Ya cantó" : "Saltado";
  if (
    outcome === "skipped" &&
    !window.confirm("¿Marcar esta canción como saltada y restarla del tiempo total?")
  ) {
    return;
  }
  busy = true;
  try {
    const data = await api(
      `/api/requests/${encodeURIComponent(id)}/outcome`,
      {
        method: "POST",
        body: JSON.stringify({ outcome })
      }
    );
    showNotice(
      data.warning ||
      `${label}: el tiempo y la cola de VirtualDJ fueron actualizados.`
    );
    await refresh();
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    busy = false;
  }
}

async function queueSuggestion(item, singerMode) {
  if (busy) return;
  busy = true;
  try {
    const data = await api("/api/suggestions/queue", {
      method: "POST",
      body: JSON.stringify({
        song: item.song,
        artist: item.artist,
        singerMode
      })
    });
    showNotice(
      `${data.song} fue agregada a VirtualDJ para ${data.singer}.`
    );
    await refresh();
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    busy = false;
  }
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
    await api(`/api/requests/${encodeURIComponent(id)}/youtube/copy`, {
      method: "POST",
      body: JSON.stringify({ url })
    });
    showNotice("Enlace elegido copiado al portapapeles.");
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

function renderRequests() {
  requestsEl.innerHTML = "";
  if (!state.requests.length) {
    requestsEl.innerHTML =
      '<div class="empty-state"><span>🎤</span><strong>No hay solicitudes activas.</strong><p>Cuando un huésped envíe una canción aparecerá aquí.</p></div>';
    return;
  }
  const template = $("#requestTemplate");
  state.requests.forEach((item, index) => {
    const fragment = template.content.cloneNode(true);
    const card = $(".request-card", fragment);
    $(".request-number", card).textContent = index + 1;
    $(".singer", card).textContent = item.singer;
    $(".song", card).textContent = item.song;
    $(".artist", card).textContent = item.artist || "Artista no indicado";
    const plannedSeconds =
      (Number(item.durationSeconds) || 240) +
      Math.max(0, Number(item.transitionSeconds) || 0);
    $(".request-language", card).textContent =
      `${item.language ? `Idioma: ${item.language}` : "Idioma no indicado"} · ` +
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
    }
    requestsEl.append(fragment);
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
    "<div><p class=\"eyebrow\">PLAN B PARA LA ROTACIÓN</p><h2>Temas hit para mantener el karaoke activo</h2><p>Usa un tema disponible para el EMCEE o deja que el Bridge elija una persona registrada al azar.</p></div>";
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
    }
    card.append(info, actions);
    grid.append(card);
  });
  panel.append(header, grid);
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
  if (busy) return;
  busy = true;
  try {
    applyState(await api("/api/library/scan", { method: "POST", body: "{}" }));
    showNotice(`Biblioteca actualizada: ${state.library.count} pistas encontradas.`);
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    busy = false;
  }
}

async function syncRequests({ quiet = false } = {}) {
  if (busy) return;
  busy = true;
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
    busy = false;
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
  if (busy) return;
  if (
    action === "reset" &&
    !window.confirm("¿Archivar todas las solicitudes y comenzar una actividad nueva?")
  ) {
    return;
  }
  busy = true;
  updateStatus();
  try {
    applyState(
      await api(`/api/activity/${action}`, { method: "POST", body: "{}" })
    );
    showNotice({
      open: "Solicitudes abiertas en la web y en el Bridge.",
      close: "Solicitudes cerradas en la web y en el Bridge.",
      reset: "Actividad reiniciada y cola local sincronizada."
    }[action]);
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    busy = false;
    updateStatus();
  }
}

$("#scanButton").addEventListener("click", scan);
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
  if (!window.confirm("¿Olvidar el PIN guardado en este Mac?")) return;
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
  if (!window.confirm("¿Quitar la contraseña guardada de VirtualDJ?")) return;
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
