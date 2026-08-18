import { downloadLocalQr, setLocalQrImage } from "./qr-ui.js";
import { initSuperhostPanel } from "./superhost.js";

const $ = (selector, root = document) => root.querySelector(selector);
const requestsEl = $("#requests");
const noticeEl = $("#notice");
const settingsDialog = $("#settingsDialog");
const successDialog = $("#successDialog");
const confirmDialog = $("#confirmDialog");
const loginDialog = $("#loginDialog");
const selectionDialog = $("#selectionDialog");
const passwordDialog = $("#passwordDialog");
const shareDialog = $("#shareDialog");
const moreDialog = $("#moreDialog");
const folderList = $("#folderList");
let state = null;
let folders = [];
let activityBusy = false;
let scanBusy = false;
let syncBusy = false;
let passwordChangeRequired = false;
let rotationItems = [];
const actionLocks = new Set();
const hitSearchLocks = new Set();
const expandedRequestIds = new Set();
let lastActivityRevision = null;
let lastInstantSyncAt = 0;
const superhostPanel = initSuperhostPanel({
  api,
  showNotice,
  copyLink,
  openExternal
});

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || data.code || "The action could not be completed.");
  }
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
  confirmLabel = "Confirm",
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
  return item ? `${item.singer} — ${item.song}` : "The song";
}

async function runAction(scope, progress, operation, successMessage) {
  if (actionLocks.has(scope)) {
    showNotice("This action is already being processed. Wait for confirmation.");
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
    showNotice(`The action could not be completed: ${error.message}`, true);
    return null;
  } finally {
    actionLocks.delete(scope);
    renderRequests();
  }
}

function timeAgo(value) {
  if (!value) return "Not yet";
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 5) return "Just now";
  if (seconds < 60) return `${seconds} sec ago`;
  return `${Math.floor(seconds / 60)} min ago`;
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
  return parsed.toLocaleString("en", {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function clockTime(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleTimeString("en", {
    hour: "numeric",
    minute: "2-digit"
  });
}

function liveActivitySummary() {
  const summary = { ...(state?.activitySummary || {}) };
  const targetSeconds = Math.max(0, Number(summary.targetSeconds) || 0);
  const started = Date.parse(String(state?.activity?.activityStartedAt || ""));
  const finished = Date.parse(String(state?.activity?.activityFinishedAt || ""));
  const hasStarted = Number.isFinite(started);
  const activityRunning = hasStarted &&
    state?.activity?.activityRunning !== false &&
    !Number.isFinite(finished);
  const elapsedSeconds = hasStarted
    ? Math.max(0, Math.floor(((Number.isFinite(finished) ? finished : Date.now()) - started) / 1000))
    : 0;
  summary.activityRunning = activityRunning;
  summary.elapsedSeconds = elapsedSeconds;
  summary.clockRemainingSeconds = Math.max(0, targetSeconds - elapsedSeconds);
  summary.clockOverrunSeconds = Math.max(0, elapsedSeconds - targetSeconds);
  summary.eventEndsAt = hasStarted && targetSeconds > 0
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
      ? `Elapsed: ${activityDuration(summary.elapsedSeconds)}`
      : "The clock is at 0:00:00";
  }
  $("#elapsedDetail").textContent = !summary.activityRunning
    ? "Select Start Activity to activate the clock"
    : summary.clockOverrunSeconds
      ? `The activity is over its duration by ${activityDuration(summary.clockOverrunSeconds)}`
      : `${activityDuration(summary.clockRemainingSeconds)} remaining`;
  $("#confirmedTime").textContent = activityDuration(summary.confirmedSeconds);
  const queueCount = Number(summary.queueSongCount) || 0;
  $("#confirmedDetail").textContent =
    `${queueCount} live VDJ ${queueCount === 1 ? "track" : "tracks"} · ` +
    `${activityDuration(summary.completedSeconds)} already performed`;
  $("#plannedTime").textContent = activityDuration(summary.plannedSeconds);
  $("#plannedDetail").textContent = summary.skippedSeconds
    ? `${activityDuration(summary.skippedSeconds)} excluded as skipped`
    : "Skipped songs are not included";

  if (summary.activityRunning && summary.eventEndsAt) {
    $("#eventEndTime").textContent = clockTime(summary.eventEndsAt);
    $("#eventEndDetail").textContent =
      `EMCEE: manage the rotation to finish by ${clockTime(summary.eventEndsAt)} and respect the event end time.`;
  } else {
    $("#eventEndTime").textContent = "Select Start Activity";
    $("#eventEndDetail").textContent =
      "The clock and end time will begin when the host starts the activity.";
  }

  const card = $("#coverageCard");
  card.classList.remove("ok", "warning", "over");
  if (summary.overrunSeconds) {
    card.classList.add("over");
    $("#coverageTime").textContent =
      `Over by ${activityDuration(summary.overrunSeconds)}`;
    $("#coverageDetail").textContent =
      `${summary.coveragePercent || 0}% covered against ${activityDuration(target)}`;
  } else if (!summary.gapSeconds) {
    card.classList.add("ok");
    $("#coverageTime").textContent = "Time covered";
    $("#coverageDetail").textContent =
      `${summary.coveragePercent || 100}% · the rotation covers the activity`;
  } else {
    card.classList.add("warning");
    $("#coverageTime").textContent =
      `${activityDuration(summary.gapSeconds)} missing`;
    $("#coverageDetail").textContent =
      `${summary.coveragePercent || 0}% covered by completed songs and the live queue`;
  }

  const advice = $("#coverageAdvice");
  advice.innerHTML = "";
  if (summary.suggestClose) {
    const text = document.createElement("div");
    text.innerHTML =
      "<strong>You have enough confirmed time.</strong><p>Completed songs and tracks actually present in VirtualDJ cover the activity duration.</p>";
    advice.append(
      text,
      button("Close Requests Now", "danger", () => controlActivity("close"))
    );
    advice.classList.remove("hidden");
  } else if (summary.suggestHits) {
    advice.innerHTML =
      "<div><strong>The VirtualDJ queue is empty.</strong><p>Use the hit suggestions below for the EMCEE or a random singer.</p></div>";
    advice.classList.remove("hidden");
  } else {
    advice.classList.add("hidden");
  }
}

function activityMessage(activity) {
  const action = {
    start: "The activity was started",
    open: "Requests were opened",
    close: "Requests were closed",
    reset: "The activity was reset"
  }[activity.lastAction];
  if (!action) return "";
  const source = {
    web: "from the web controls",
    sheet: "from Guest Star",
    bridge: "from this panel"
  }[activity.lastSource] || "from the host controls";
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
    library.error ? "Scan error" : `${library.count} tracks`,
    library.error ||
      (library.scanning
        ? "Scanning folder changes…"
        : library.realtime
          ? `Live · updated ${timeAgo(library.lastScanAt).toLowerCase()}`
          : `Last scan: ${timeAgo(library.lastScanAt)}`)
  );
  const sheet = state.sheet;
  setStatus(
    "#sheetStatus",
    sheet.error ? "error" : state.config.hostPinConfigured ? "ok" : "",
    sheet.error ? "Disconnected" : `${state.requests.length} requests`,
    sheet.error || (state.config.signedIn || state.config.hostPinConfigured
      ? `Synced: ${timeAgo(sheet.lastSyncAt)}`
      : "Sign in to Guest Star")
  );
  const virtualDJ = state.virtualDJ || {};
  if (virtualDJ.error) {
    setStatus("#vdjStatus", "error", "Check connection", virtualDJ.error);
  } else if (virtualDJ.lastQueueCheckAt) {
    setStatus(
      "#vdjStatus",
      "ok",
      `${virtualDJ.queueCount} in queue`,
      virtualDJ.checkingQueue
        ? "Checking rotation…"
        : `Queue verified: ${timeAgo(virtualDJ.lastQueueCheckAt)}`
    );
  } else {
    setStatus(
      "#vdjStatus",
      "",
      "Queue not verified",
      virtualDJ.checkingQueue
        ? "Checking rotation…"
        : "Select Synchronize to check the live queue."
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
      ? `In progress · requests ${accepting ? "open" : "closed"}`
      : "Ready to start",
    running
      ? `Elapsed: ${activityDuration(summary.elapsedSeconds)}`
      : "The clock is at 0:00:00"
  );
  const authenticated = state.account?.authenticated === true;
  const tenant = state.tenant || {};
  const selectedActivity = tenant.activity || null;
  const permissions = tenant.permissions || {};
  const status = selectedActivity?.status || (running ? "in_progress" : "ready");
  const can = (permission) => permissions.all === true || permissions[permission] === true;
  $("#tenantPath").textContent = tenant.hotel
    ? `${tenant.hotel.name} • ${tenant.venue?.name || "Venue"}`
    : "SELECT AN ACTIVITY";
  $("#selectedActivityName").textContent = selectedActivity?.name || "Guest Star Activity";
  $("#activityHeadline").textContent = !authenticated
    ? "Sign in to use this Bridge."
    : !selectedActivity
      ? "Choose the hotel, venue and activity assigned to this computer."
      : status === "in_progress"
        ? `Activity in progress · started ${clockTime(activity.activityStartedAt)}`
        : status === "scheduled"
          ? `Scheduled for ${dateTime(selectedActivity.scheduledStartAt)}`
          : status === "finished"
            ? "Activity finished · queue preserved"
            : "Ready to start";
  const requestsToggle = $("#requestsToggle");
  requestsToggle.checked = accepting;
  requestsToggle.disabled = activityBusy || !selectedActivity || !can("canOpenCloseRequests");
  $("#requestsToggleLabel").textContent = accepting ? "Open" : "Closed";
  const primary = $("#primaryActivity");
  primary.textContent = status === "in_progress"
    ? "Finish Activity"
    : status === "finished"
      ? "Start New Activity"
      : "Start Activity";
  primary.dataset.action = status === "in_progress"
    ? "finish"
    : status === "finished"
      ? "start-new"
      : "start";
  primary.disabled = activityBusy || !selectedActivity || !(
    status === "in_progress"
      ? can("canFinishActivity")
      : status === "finished"
        ? can("canStartNewActivity")
        : can("canStartActivity")
  );
  $("#shareButton").disabled = !tenant.share?.publicUrl;
  $("#settingsButton").disabled = !selectedActivity;
  const isSuperhost = authenticated && state.account?.user?.role === "superhost";
  $("#openHostPanel").classList.toggle("hidden", !isSuperhost || superhostPanel.isOpen());
  $("#liveEventButton").classList.toggle("hidden", !isSuperhost || !superhostPanel.isOpen());
  $("#switchActivity").classList.toggle("hidden", !authenticated);
  $("#changePasswordButton").classList.toggle("hidden", !authenticated);
  $("#logoutButton").classList.toggle("hidden", !authenticated);
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

async function copyLink(url, message = "Link copied.") {
  try {
    await navigator.clipboard.writeText(url);
    showNotice(message);
  } catch {
    window.prompt("Copy this link:", url);
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
      `${error.message} You can use “Copy Link” in the meantime.`,
      true
    );
  }
}

function renderSourceLink(panel, url) {
  if (!/^https?:\/\//i.test(url || "")) return;
  panel.classList.remove("hidden");
  const info = document.createElement("div");
  const label = document.createElement("small");
  label.textContent = "SAVED SOURCE LINK";
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
    button("Copy Link", "primary", () =>
      copyLink(url, "Saved link copied.")
    ),
    button("Open ↗", "youtube", () => openExternal(url))
  );
  panel.append(info, actions);
}

async function queue(id, filePath, requeue = false) {
  const label = requestLabel(id);
  await runAction(
    actionScope(id),
    `Sending ${label} to VirtualDJ…`,
    () => api(`/api/requests/${encodeURIComponent(id)}/queue`, {
      method: "POST",
      body: JSON.stringify({ filePath, requeue })
    }),
    (data) => ({
      title: data.restored
        ? "Song restored"
        : data.requeued
          ? "Song requeued"
          : "Song added to VirtualDJ",
      detail:
        data.warning ||
        `${label} is confirmed in the VirtualDJ Karaoke queue.`
    })
  );
}

async function removeFromQueue(id) {
  const label = requestLabel(id);
  const confirmed = await confirmAction({
    title: "Remove from VirtualDJ",
    detail: `Remove ${label} from the VirtualDJ rotation?`,
    confirmLabel: "Remove"
  });
  if (!confirmed) return;
  await runAction(
    actionScope(id),
    `Removing ${label} from VirtualDJ…`,
    () => api(`/api/requests/${encodeURIComponent(id)}/remove`, {
      method: "POST",
      body: "{}"
    }),
    (data) => ({
      title: "Song removed from VirtualDJ",
      detail:
        data.warning ||
        `${label} was removed and the live VirtualDJ queue confirmed the change.`
    })
  );
}

async function dismissRequeue(id) {
  const label = requestLabel(id);
  await runAction(
    actionScope(id),
    `Keeping ${label} outside the rotation…`,
    () => api(
      `/api/requests/${encodeURIComponent(id)}/dismiss-requeue`,
      { method: "POST", body: "{}" }
    ),
    (data) => ({
      title: "Song outside the rotation",
      detail:
        data.warning ||
        `${label} will remain outside VirtualDJ.`
    })
  );
}

async function markOutcome(id, outcome) {
  const songLabel = requestLabel(id);
  if (
    outcome === "skipped" &&
    !(await confirmAction({
      title: "Mark as Skipped",
      detail: `Mark ${songLabel} as skipped, remove it from VirtualDJ and exclude it from the total time?`,
      confirmLabel: "Mark Skipped"
    }))
  ) {
    return;
  }
  await runAction(
    actionScope(id),
    outcome === "completed"
      ? `Marking ${songLabel} as completed…`
      : `Marking ${songLabel} as skipped…`,
    () => api(
      `/api/requests/${encodeURIComponent(id)}/outcome`,
      {
        method: "POST",
        body: JSON.stringify({ outcome })
      }
    ),
    (data) => ({
      title: outcome === "completed" ? "Singer completed" : "Song skipped",
      detail:
        data.warning ||
        (outcome === "completed"
          ? `${songLabel} is marked as completed; it remains included in total time and was removed from VirtualDJ.`
          : `${songLabel} is marked as skipped; it was removed from VirtualDJ and excluded from total time.`)
    })
  );
}

async function undoOutcome(id, placement) {
  const songLabel = requestLabel(id);
  const actionText = {
    original: "restoring its previous position",
    end: "sending it to the end of the rotation",
    pending: "undoing the status without adding it to the queue"
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
      title: "Action undone",
      detail: data.restoredToVirtualDJ
        ? `${songLabel} returned to VirtualDJ${
            data.queuePosition ? ` in position ${data.queuePosition}` : ""
          }.`
        : `${songLabel} is no longer marked completed or skipped and remains outside the queue.`
    })
  );
}

async function queueSuggestion(item, singerMode) {
  const scope = `suggestion:${item.song}:${item.artist}`;
  await runAction(
    scope,
    `Adding ${item.song} to VirtualDJ…`,
    () => api("/api/suggestions/queue", {
      method: "POST",
      body: JSON.stringify({
        song: item.song,
        artist: item.artist,
        language: item.language,
        list: item.list,
        singerMode
      })
    }),
    (data) => ({
      title: "Song added to VirtualDJ",
      detail: `${data.song} was added to VirtualDJ for ${data.singer}.`
    })
  );
}

function rotationCard(item) {
  const card = document.createElement("article");
  card.className = "hit-card";
  const info = document.createElement("div");
  const language = document.createElement("small");
  language.textContent = item.list === "favorites"
    ? `★ ${item.language}`
    : item.language;
  const song = document.createElement("strong");
  song.textContent = item.song;
  const artist = document.createElement("p");
  artist.textContent = item.artist;
  const availability = document.createElement("em");
  availability.textContent = item.localAvailable
    ? `Local: ${item.fileName}`
    : "No disponible localmente";
  info.append(language, song, artist, availability);
  const actions = document.createElement("div");
  actions.className = "queue-actions";
  if (item.localAvailable) {
    actions.append(
      button("Agregar para EMCEE", "primary", () => queueSuggestion(item, "emcee")),
      button("Cantante aleatorio", "ghost", () => queueSuggestion(item, "random"))
    );
  } else {
    const key = `${item.language}:${item.artist}:${item.song}`;
    if (item.youtube?.[0]) {
      const selected = item.youtube[0];
      actions.append(
        button("Copiar karaoke", "primary", () =>
          copyLink(selected.url, `Enlace de ${item.song} copiado.`)
        ),
        button("Abrir ↗", "youtube", () => openExternal(selected.url))
      );
    } else {
      const search = button(
        hitSearchLocks.has(key) ? "Buscando…" : "Buscar karaoke",
        "youtube",
        () => searchHitYoutube(item, key)
      );
      search.disabled = hitSearchLocks.has(key);
      actions.append(search);
    }
  }
  card.append(info, actions);
  return card;
}

function renderRandomRotation() {
  const panel = $("#randomRotation");
  const authenticated = state?.account?.authenticated === true;
  const selected = Boolean(state?.tenant?.activity);
  panel.classList.toggle("hidden", !authenticated || !selected);
  const grid = $("#rotationGrid");
  grid.innerHTML = "";
  rotationItems.forEach((item) => grid.append(rotationCard(item)));
  $("#rotationEmpty").classList.toggle("hidden", rotationItems.length > 0);
  if (!state?.rotation?.counts?.favorites) {
    $("#randomFavorites").title =
      "El Superhost todavía no ha agregado favoritos para este hotel.";
  } else {
    $("#randomFavorites").removeAttribute("title");
  }
}

async function drawRandomRotation(list) {
  try {
    const data = await api("/api/rotation/draw", {
      method: "POST",
      body: JSON.stringify({ list, count: 6 })
    });
    rotationItems = data.items || [];
    renderRandomRotation();
    showNotice(rotationItems.length
      ? "Nueva ronda aleatoria lista; no se repetirá un tema antes de completar la vuelta."
      : "Esta lista todavía no tiene temas. Agrega favoritos desde Superhost.");
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function youtube(id, panel) {
  panel.classList.remove("hidden");
  panel.innerHTML = "<p>Searching for Karaoke/Lyrics versions…</p>";
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
      ? "The selected link was copied and saved with the request."
      : "The selected link was copied to the clipboard.";
    showNotice(detail);
    showSuccess("Karaoke link selected", detail);
  } catch (error) {
    showNotice(error.message, true);
  }
}

function renderYoutube(panel, items, requestId, clipboard = {}) {
  panel.innerHTML = "";
  const title = document.createElement("h4");
  const text = document.createElement("p");
  if (!items?.length) {
    title.textContent = "Searching for a video with lyrics";
    text.textContent =
      clipboard.error ||
      "No sufficiently reliable link was found yet. The Bridge will search again during synchronization.";
    panel.append(title, text);
    return;
  }

  title.textContent = "Choose the version you prefer";
  text.textContent =
    `We found ${items.length} ${items.length === 1 ? "option" : "options"}. ` +
    "The Bridge will not copy anything automatically; select Copy on the version you want.";
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
    optionLabel.textContent = `OPTION ${index + 1}`;
    const strong = document.createElement("strong");
    strong.textContent = item.title || "YouTube";
    const small = document.createElement("small");
    small.textContent = [
      isKaraoke ? "Karaoke with lyrics" : "Lyrics with vocals",
      item.channel,
      duration(item.durationSeconds)
    ].filter(Boolean).join(" · ");
    info.append(optionLabel, strong, small);
    const actions = document.createElement("div");
    actions.className = "source-actions";
    actions.append(
      button("Copy This Link", "primary", () =>
        copyYoutubeOption(requestId, item.url)
      ),
      button("Open ↗", "youtube", () => openExternal(item.url))
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
      "<h4>Searching for Karaoke/Lyrics versions…</h4><p>Options will appear here automatically.</p>";
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
    button("Search YouTube Options", "youtube", () =>
      youtube(item.id, youtubePanel)
    ),
    document.createTextNode(" "),
    button("Scan Folder Now", "ghost", scan)
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
      ? "0 tracks · empty queue"
      : "awaiting confirmation";
    list.innerHTML =
      '<p class="empty-match">The Karaoke queue is empty or has not been verified yet.</p>';
    return;
  }
  const next = entries[0];
  summary.textContent =
    `${entries.length} ${entries.length === 1 ? "track" : "tracks"} · ` +
    `next: ${next.singer} — ${next.song}` +
    (Number(state?.virtualDJ?.externalCount) > 0
      ? ` · ${state.virtualDJ.externalCount} external`
      : "");
  entries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "vdj-live-row";
    const position = document.createElement("b");
    position.textContent = entry.position;
    const info = document.createElement("span");
    const song = document.createElement("strong");
    song.textContent = entry.song;
    const detail = document.createElement("small");
    detail.textContent = [
      entry.artist,
      `Singer: ${entry.singer}`,
      entry.sourceType === "virtualdj_external"
        ? "Unmatched VirtualDJ item"
        : "Linked request"
    ]
      .filter(Boolean)
      .join(" · ");
    info.append(song, detail);
    const durationLabel = document.createElement("span");
    durationLabel.textContent = entry.localAvailable
      ? activityDuration(entry.durationSeconds)
      : `⚠ ${activityDuration(entry.durationSeconds)} · file unavailable`;
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
      '<div class="empty-state"><span>🎤</span><strong>No active requests.</strong><p>Guest song requests will appear here.</p></div>';
    return;
  }
  const template = $("#requestTemplate");
  const timelines = requestTimelines(state.requests);
  const groups = new Map();
  [
    ["pending", "Waiting to Enter the Queue", "In arrival order"],
    ["queued", "In the VirtualDJ Queue", "Verified in real time"],
    ["finished", "Completed / Finished", "Actions can be undone and restored"]
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
      ? `Request ${arrival.number} · record ${item.sheetRow}`
      : `Request ${arrival.number} by arrival order`;
    $(".singer", card).textContent = item.singer;
    $(".song", card).textContent = item.song;
    $(".artist", card).textContent = item.artist || "Artist not provided";
    const requestComment = String(item.comment || "").trim();
    const requestCommentEl = $(".request-comment", card);
    if (requestComment) {
      requestCommentEl.textContent = `💬 ${requestComment}`;
      requestCommentEl.title = requestComment;
      requestCommentEl.classList.remove("hidden");
    }
    const songSeconds = Number(item.durationSeconds) || 240;
    const transitionSeconds = Math.max(
      0,
      Number(item.transitionSeconds) || 0
    );
    const plannedSeconds = songSeconds + transitionSeconds;
    const queueTimeline = timelines.queue.get(item.id);
    const rowLabel = item.sheetRow ? ` · row ${item.sheetRow}` : "";
    $(".request-meta", card).textContent = queueTimeline
      ? `Arrival #${arrival.number}${rowLabel} · cumulative queue ${activityDuration(queueTimeline.cumulativeSeconds)} · estimated turn ${clockTime(queueTimeline.estimatedStartAt)}`
      : `Arrival #${arrival.number}${rowLabel} · requested total at arrival ${activityDuration(arrival.cumulativeSeconds)}`;
    $(".request-language", card).textContent =
      `${item.language ? `Language: ${item.language}` : "Language not provided"} · ` +
      `Track ${activityDuration(songSeconds)} + ` +
      `transition ${activityDuration(transitionSeconds)} = ` +
      `${activityDuration(plannedSeconds)}`;
    const badge = $(".state-badge", card);
    badge.classList.add(item.localState);
    badge.textContent = {
      exact: "✓ Local file found",
      possible: "Possible match",
      missing: "Not available locally",
      queued: item.queuePosition
        ? `✓ Position ${item.queuePosition} in VirtualDJ`
        : "✓ In VirtualDJ",
      "queued-missing": item.queuePosition
        ? `⚠ Position ${item.queuePosition} · local file missing`
        : "⚠ In VDJ · local file missing",
      unverified: "? VDJ queue not verified",
      "unverified-missing": "? VDJ not verified · local file missing",
      adding: "Adding to VirtualDJ…",
      confirming: "Confirming in VirtualDJ…",
      removed: "↻ Outside the queue",
      "removed-missing": "↻ Outside · local file missing",
      completed: "✓ Completed",
      skipped: "− Skipped"
    }[item.localState];

    const match = $(".match-panel", card);
    renderSourceLink($(".source-panel", card), item.sourceUrl);
    const youtubePanel = $(".youtube-panel", card);
    const isQueued =
      item.localState === "queued" || item.localState === "queued-missing";
    const isUnverified =
      item.localState === "adding" ||
      item.localState === "confirming" ||
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
      ? "Hide Options and Actions"
      : "View Options and Actions";
    details.addEventListener("toggle", () => {
      if (details.open) expandedRequestIds.add(item.id);
      else expandedRequestIds.delete(item.id);
      detailsLabel.textContent = details.open
        ? "Hide Options and Actions"
        : "View Options and Actions";
    });
    if (isTerminal) {
      match.innerHTML = item.localState === "completed"
        ? '<div class="outcome-summary completed"><strong>This person has performed.</strong><p>The song duration remains included in the activity total.</p></div>'
        : '<div class="outcome-summary skipped"><strong>This song was skipped.</strong><p>Its duration was excluded from the activity total and it will not be resent to VirtualDJ.</p></div>';
    } else if (isUnverified) {
      match.innerHTML =
        item.localState === "adding" || item.localState === "confirming"
          ? '<div class="requeue-prompt"><strong>Guest Star is confirming the insertion against the live VirtualDJ queue.</strong><p>The song will not return to Pending or duplicate during this synchronization window.</p></div>'
          : '<div class="requeue-prompt"><strong>The song did not appear in one temporary VirtualDJ scan.</strong><p>Guest Star keeps it linked while confirming its absence across consecutive scans.</p></div>';
      const actions = document.createElement("div");
      actions.className = "queue-actions";
      actions.append(
        button("Check Queue Now", "primary", syncRequests)
      );
      match.append(actions);
      if (!item.localAvailable) {
        const recovery = document.createElement("div");
        recovery.className = "missing-recovery";
        appendMissingActions(
          item,
          recovery,
          youtubePanel,
          "The file is also unavailable locally. The Bridge searched for Karaoke/Lyrics versions so you can choose which link to copy."
        );
        match.append(recovery);
      }
    } else if (wasRemoved) {
      match.innerHTML =
        '<div class="requeue-prompt"><strong>This song is no longer in the VirtualDJ queue.</strong><p>Did you remove it intentionally?</p></div>';
      const actions = document.createElement("div");
      actions.className = "queue-actions";
      if (item.localAvailable) {
        actions.append(
          button("No — Re-add at the End", "primary", () =>
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
        button("Yes — Keep It Outside", "ghost", () => dismissRequeue(item.id))
      );
      match.append(actions);
      if (!item.localAvailable) {
        const recovery = document.createElement("div");
        recovery.className = "missing-recovery";
        appendMissingActions(
          item,
          recovery,
          youtubePanel,
          "The file is also no longer available locally. The Bridge searched again for Karaoke/Lyrics options so you can choose which link to copy."
        );
        match.append(recovery);
      }
    } else if (isQueued) {
      match.innerHTML =
        item.localState === "queued"
          ? '<p class="empty-match">This request is marked as sent. You can move it to the end of the rotation or remove it.</p>'
          : '<p class="empty-match missing-warning">The file previously linked to this request no longer exists in the local folder.</p>';
      const actions = document.createElement("div");
      actions.className = "queue-actions";
      if (item.localAvailable) {
        actions.append(
          button("Resend to the End", "primary", () =>
            queue(item.id, item.queuedFilePath, true)
          )
        );
      }
      actions.append(
        button("Remove from VirtualDJ", "danger", () => removeFromQueue(item.id))
      );
      match.append(actions);
      if (item.localState === "queued-missing") {
        const recovery = document.createElement("div");
        recovery.className = "missing-recovery";
        appendMissingActions(
          item,
          recovery,
          youtubePanel,
          "The Bridge searched again for versions with lyrics. Choose a link to copy, or restore the file to the folder and it will appear here in real time."
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
      small.textContent = `${Math.round(top.score * 100)}% match`;
      info.append(strong, small);
      row.append(info, button("Add to VirtualDJ", "primary", () => queue(item.id, top.filePath)));
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
          score.textContent = `${Math.round(candidate.score * 100)}% match`;
          infoOption.append(name, score);
          option.append(
            infoOption,
            button("Use This File", "ghost", () => queue(item.id, candidate.filePath))
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
          "There is no exact local match. Review the possible file or choose one of the links found by the Bridge."
        );
        match.append(recovery);
      }
    } else {
      appendMissingActions(
        item,
        match,
        youtubePanel,
        "Not available locally. The Bridge searches for a video with lyrics and monitors the folder in real time."
      );
    }
    const outcomePanel = $(".outcome-panel", card);
    if (!isTerminal) {
      outcomePanel.append(
        button("✓ Completed", "success", () =>
          markOutcome(item.id, "completed")
        ),
        button("Skipped", "danger", () =>
          markOutcome(item.id, "skipped")
        )
      );
    } else {
      if (item.canRestoreToQueue && item.undoOriginalPosition) {
        outcomePanel.append(
          button(
            `Undo and Restore Position ${item.undoOriginalPosition}`,
            "primary",
            () => undoOutcome(item.id, "original")
          )
        );
      }
      if (item.canRestoreToQueue) {
        outcomePanel.append(
          button("Undo and Send to End", "ghost", () =>
            undoOutcome(item.id, "end")
          )
        );
      }
      outcomePanel.append(
        button("Undo Only · Keep Outside", "danger", () =>
          undoOutcome(item.id, "pending")
        )
      );
    }
    if (requestPending) {
      card.classList.add("processing");
      badge.textContent = "Processing…";
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
    empty.textContent = "No songs in this section.";
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
    "<div><p class=\"eyebrow\">ROTATION PLAN B</p><h2>Balanced Spanish and English Hits</h2><p>Use a local track for the EMCEE or find the best Karaoke link when it is not on disk.</p></div>";
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
      : "Not available locally";
    info.append(language, song, artist, availability);
    const actions = document.createElement("div");
    actions.className = "queue-actions";
    if (item.localAvailable) {
      actions.append(
        button("Add for EMCEE", "primary", () =>
          queueSuggestion(item, "emcee")
        ),
        button("Random Singer", "ghost", () =>
          queueSuggestion(item, "random")
        )
      );
    } else {
      actions.append(
        button("Scan Folder", "ghost", scan)
      );
      const key = `${item.language}:${item.artist}:${item.song}`;
      if (item.youtube?.[0]) {
        const selected = item.youtube[0];
        actions.append(
          button("Copy Karaoke Link", "primary", () =>
            copyLink(selected.url, `Karaoke link for ${item.song} copied.`)
          ),
          button("Open ↗", "youtube", () => openExternal(selected.url))
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
        unavailable.textContent = "No reliable Karaoke version was found yet.";
        info.append(unavailable);
        actions.append(
          button("Retry Karaoke Link", "youtube", () =>
            searchHitYoutube(item, key)
          )
        );
      } else {
        const searchButton = button(
          hitSearchLocks.has(key) ? "Searching Karaoke…" : "Find Karaoke Link",
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
  showNotice(`Searching for the best Karaoke version of ${item.song}…`);
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
    item.youtube = data.items || [];
    item.youtubeSearched = true;
    await refresh();
    showNotice(data.items?.length
      ? "Karaoke link found; you can copy it now."
      : "No reliable Karaoke version was found yet.");
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    hitSearchLocks.delete(key);
    renderHitSuggestions();
    renderRandomRotation();
  }
}

function renderFolders() {
  folderList.innerHTML = "";
  if (!folders.length) {
    const note = document.createElement("p");
    note.className = "empty-match";
    note.textContent = "No folder has been selected yet.";
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
    remove.setAttribute("aria-label", "Remove folder");
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
    ? "PIN saved · leave blank to keep"
    : "Private PIN";
  $("#rememberHostPin").checked = state.config.rememberHostPin !== false;
  $("#legacyConnection").classList.toggle(
    "hidden",
    state.account?.user?.role !== "superhost"
  );
  $("#vdjPort").value = state.config.virtualDJ.port || 80;
  $("#vdjPassword").value = "";
  $("#vdjPassword").placeholder = state.config.virtualDJ.passwordConfigured
    ? "Password saved · leave blank to keep"
    : "No password";
  $("#autoQueueExact").checked = Boolean(state.config.autoQueueExact);
  const activity = state.activity || {};
  $("#activityHours").value = Number(activity.activityHours) || 2;
  $("#transitionSeconds").value =
    Math.max(0, Number(activity.transitionSeconds) || 0);
  const definition = state.tenant?.activity || {};
  const scheduled = definition.scheduledStartAt
    ? new Date(definition.scheduledStartAt)
    : null;
  $("#scheduledStartAt").value = scheduled && !Number.isNaN(scheduled.getTime())
    ? new Date(scheduled.getTime() - scheduled.getTimezoneOffset() * 60000)
      .toISOString().slice(0, 16)
    : "";
  $("#acceptEarlyRequests").checked = definition.acceptEarlyRequests === true;
  $("#showCountdown").checked = definition.showCountdown !== false;
  $("#autoStartEnabled").checked = definition.autoStartEnabled === true;
  $("#showPublicStatus").checked = Boolean(activity.showPublicStatus);
  let allowedLanguages = Array.isArray(definition.allowedLanguages)
    ? definition.allowedLanguages
    : [];
  if (!allowedLanguages.length && definition.allowedLanguagesJson) {
    try { allowedLanguages = JSON.parse(definition.allowedLanguagesJson); } catch { /* default below */ }
  }
  if (!Array.isArray(allowedLanguages) || !allowedLanguages.length) {
    allowedLanguages = ["es", "en"];
  }
  $("#activityLanguageEs").checked = allowedLanguages.includes("es");
  $("#activityLanguageEn").checked = allowedLanguages.includes("en");
  $("#activityLanguageSettings").classList.toggle(
    "hidden",
    state.account?.user?.role !== "superhost"
  );
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
  const payload = {
    libraryFolders: folders.map((item) => item.trim()).filter(Boolean),
    rememberLibraryFolders: $("#rememberLibraryFolders").checked,
    appsScriptUrl: $("#appsScriptUrl").value.trim(),
    hostPin: $("#hostPin").value.trim(),
    rememberHostPin: $("#rememberHostPin").checked,
    virtualDJ: {
      port: Number($("#vdjPort").value) || 80,
      password: $("#vdjPassword").value
    },
    autoQueueExact: $("#autoQueueExact").checked
  };
  if (!state.config.signedIn) {
    payload.sheetConfig = {
      activityHours: Number($("#activityHours").value) || 2,
      transitionSeconds: Math.max(
        0,
        Number($("#transitionSeconds").value) || 0
      )
    };
  }
  return payload;
}

function activitySettingsPayload() {
  const localStart = $("#scheduledStartAt").value;
  const payload = {
    scheduledStartAt: localStart ? new Date(localStart).toISOString() : "",
    defaultDurationSeconds: Math.round((Number($("#activityHours").value) || 2) * 3600),
    defaultTransitionSeconds: Math.max(0, Number($("#transitionSeconds").value) || 0),
    acceptEarlyRequests: $("#acceptEarlyRequests").checked,
    showCountdown: $("#showCountdown").checked,
    autoStartEnabled: $("#autoStartEnabled").checked,
    showPublicStatus: $("#showPublicStatus").checked
  };
  if (state.account?.user?.role === "superhost") {
    payload.allowedLanguages = [
      $("#activityLanguageEs").checked ? "es" : "",
      $("#activityLanguageEn").checked ? "en" : ""
    ].filter(Boolean);
  }
  return payload;
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
    showNotice("The library is already being updated.");
    return;
  }
  scanBusy = true;
  try {
    applyState(await api("/api/library/scan", { method: "POST", body: "{}" }));
    showNotice(`Library updated: ${state.library.count} tracks found.`);
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    scanBusy = false;
  }
}

async function syncRequests({ quiet = false } = {}) {
  if (syncBusy) {
    if (!quiet) showNotice("Synchronization is already in progress.");
    return;
  }
  syncBusy = true;
  updateStatus();
  try {
    applyState(
      await api("/api/requests/sync", { method: "POST", body: "{}" })
    );
    if (!quiet) {
      showNotice("Requests and the live VirtualDJ queue are synchronized.");
    }
  } catch (error) {
    if (/QUICK_SETUP_REQUIRED|quick setup/i.test(error.message)) {
      fillSettings();
      if (!settingsDialog.open) settingsDialog.showModal();
      showNotice("Complete the activity duration and transition settings before starting.", true);
      return;
    }
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
    showNotice("An activity change is already in progress.");
    return;
  }
  if (
    ["reset", "archive", "finish", "start-new"].includes(action) &&
    !(await confirmAction({
      title: action === "finish"
        ? "Finish this activity?"
        : action === "start-new"
          ? "Start a new activity?"
          : "Archive and clear the current queue?",
      detail: action === "finish"
        ? "New requests will close, but the current queue and history will be preserved."
        : action === "start-new"
          ? "The previous queue will be archived and the activity will start with an empty queue."
          : "All current requests will move to history. The permanent link and QR will not change.",
      confirmLabel: action === "finish"
        ? "Finish"
        : action === "start-new"
          ? "Start New"
          : "Archive and Clear"
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
      start: "Activity started. The timer and end time are now running.",
      open: "Requests are now open.",
      close: "Requests are now closed.",
      reset: "Activity archived and local queue synchronized.",
      archive: "Queue archived and cleared. The permanent link and QR did not change.",
      finish: "Activity finished. The current queue and history were preserved.",
      "start-new": "A new activity started with an empty active queue."
    }[action]);
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    activityBusy = false;
    updateStatus();
  }
}

function option(select, value, label) {
  const element = document.createElement("option");
  element.value = value;
  element.textContent = label;
  select.append(element);
}

function fillSelection() {
  const available = state.account?.selection || { hotels: [], venues: [], activities: [] };
  const current = state.account?.current || {};
  const hotelSelect = $("#hotelSelect");
  hotelSelect.innerHTML = "";
  option(hotelSelect, "", "Select Hotel");
  (available.hotels || []).forEach((hotel) => option(hotelSelect, hotel.hotelId, hotel.name));
  hotelSelect.value = current.hotelId || hotelSelect.options[1]?.value || "";

  const refreshVenues = () => {
    const venueSelect = $("#venueSelect");
    venueSelect.innerHTML = "";
    option(venueSelect, "", "Select Venue");
    (available.venues || [])
      .filter((venue) => venue.hotelId === hotelSelect.value)
      .forEach((venue) => option(venueSelect, venue.venueId, venue.name));
    venueSelect.value = current.venueId && [...venueSelect.options]
      .some((entry) => entry.value === current.venueId)
      ? current.venueId
      : venueSelect.options[1]?.value || "";
    refreshActivities();
  };
  const refreshActivities = () => {
    const activitySelect = $("#activitySelect");
    activitySelect.innerHTML = "";
    option(activitySelect, "", "Select Activity");
    (available.activities || [])
      .filter((activity) =>
        activity.hotelId === hotelSelect.value &&
        activity.venueId === $("#venueSelect").value
      )
      .forEach((activity) => option(activitySelect, activity.activityId, activity.name));
    activitySelect.value = current.activityId && [...activitySelect.options]
      .some((entry) => entry.value === current.activityId)
      ? current.activityId
      : activitySelect.options[1]?.value || "";
  };
  hotelSelect.onchange = refreshVenues;
  $("#venueSelect").onchange = refreshActivities;
  refreshVenues();
}

function openPasswordDialog(required = false) {
  passwordChangeRequired = required;
  $("#passwordDialogTitle").textContent = required
    ? "Choose a permanent password"
    : "Change your password";
  $("#passwordDialogHelp").textContent = required
    ? "Set a permanent password before operating an event."
    : "Enter your current password and choose a new permanent password.";
  $("#closePassword").classList.toggle("hidden", required);
  if (!passwordDialog.open) passwordDialog.showModal();
}

function updateAuthUi() {
  if (!state) return;
  const authenticated = state.account?.authenticated === true;
  if (!authenticated) {
    if (!loginDialog.open) {
      // Seed the remembered account only when the dialog first opens. Realtime
      // state updates must never replace text while somebody is signing in.
      $("#loginUsername").value = state.config.lastUsername || "";
      loginDialog.showModal();
    }
    return;
  }
  if (loginDialog.open) loginDialog.close();
  if (state.account?.user?.mustChangePassword === true) {
    openPasswordDialog(true);
    return;
  }
  if (state.account?.user?.role === "superhost") return;
  if (!state.account?.current?.activityId && !passwordDialog.open) {
    fillSelection();
    if (!selectionDialog.open) selectionDialog.showModal();
  }
}

$("#loginForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $("#loginError");
  error.classList.add("hidden");
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: $("#loginUsername").value.trim(),
        password: $("#loginPassword").value,
        rememberLogin: $("#rememberLogin").checked
      })
    });
    $("#loginPassword").value = "";
    if (loginDialog.open) loginDialog.close();
    await refresh();
    if (data.mustChangePassword) {
      openPasswordDialog(true);
    } else if (data.user?.role !== "superhost") {
      fillSelection();
      if (!selectionDialog.open) selectionDialog.showModal();
    }
  } catch (loginError) {
    error.textContent = loginError.message;
    error.classList.remove("hidden");
  }
});

loginDialog.addEventListener("cancel", (event) => event.preventDefault());
passwordDialog.addEventListener("cancel", (event) => {
  if (passwordChangeRequired) event.preventDefault();
});

$("#closePassword").addEventListener("click", () => {
  if (!passwordChangeRequired) passwordDialog.close();
});

$("#changePasswordButton").addEventListener("click", () => {
  $("#passwordForm").reset();
  $("#passwordError").classList.add("hidden");
  openPasswordDialog(false);
});

$("#passwordForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $("#passwordError");
  error.classList.add("hidden");
  if ($("#newPassword").value !== $("#confirmPassword").value) {
    error.textContent = "The new passwords do not match.";
    error.classList.remove("hidden");
    return;
  }
  try {
    const wasRequired = passwordChangeRequired;
    await api("/api/auth/change-password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: $("#currentPassword").value,
        newPassword: $("#newPassword").value
      })
    });
    $("#passwordForm").reset();
    passwordChangeRequired = false;
    passwordDialog.close();
    await refresh();
    showNotice("Your password was changed.");
    if (wasRequired && state.account?.user?.role !== "superhost" && !state.account?.current?.activityId) {
      fillSelection();
      selectionDialog.showModal();
    }
  } catch (passwordError) {
    error.textContent = passwordError.message;
    error.classList.remove("hidden");
  }
});

$("#selectionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const error = $("#selectionError");
  error.classList.add("hidden");
  try {
    applyState(await api("/api/auth/selection", {
      method: "POST",
      body: JSON.stringify({
        hotelId: $("#hotelSelect").value,
        venueId: $("#venueSelect").value,
        activityId: $("#activitySelect").value,
        rememberSelection: $("#rememberSelection").checked
      })
    }));
    selectionDialog.close();
    showNotice("This Bridge is ready for the selected activity.");
  } catch (selectionError) {
    error.textContent = selectionError.message;
    error.classList.remove("hidden");
  }
});

$("#closeSelection").addEventListener("click", () => {
  if (state.account?.current?.activityId) selectionDialog.close();
});
$("#switchActivity").addEventListener("click", () => {
  fillSelection();
  selectionDialog.showModal();
});

async function logout() {
  if (!(await confirmAction({
    title: "Log out of this Bridge?",
    detail: "The saved session will be revoked. Local library settings will remain on this Mac.",
    confirmLabel: "Log Out"
  }))) return;
  await api("/api/auth/logout", { method: "POST", body: "{}" });
  if (moreDialog.open) moreDialog.close();
  await refresh();
}

$("#logoutButton").addEventListener("click", logout);
$("#menuLogout").addEventListener("click", logout);
$("#openHostPanel").addEventListener("click", () => {
  superhostPanel.open();
  updateStatus();
});
$("#liveEventButton").addEventListener("click", () => {
  superhostPanel.close();
  updateStatus();
});

$("#primaryActivity").addEventListener("click", () =>
  controlActivity($("#primaryActivity").dataset.action || "start")
);
$("#requestsToggle").addEventListener("change", async (event) => {
  const nextOpen = event.target.checked;
  await controlActivity(nextOpen ? "open" : "close");
});
$("#archiveQueue").addEventListener("click", async () => {
  moreDialog.close();
  await controlActivity("archive");
});

$("#shareButton").addEventListener("click", () => {
  const share = state.tenant?.share || {};
  const publicUrl = share.publicUrl || "";
  $("#shareUrl").value = publicUrl;
  $("#downloadShareQr").disabled = !publicUrl;
  try {
    setLocalQrImage($("#shareQr"), publicUrl);
    $("#shareQrStatus").textContent = "QR verified and generated on this Mac.";
  } catch (error) {
    $("#shareQr").removeAttribute("src");
    $("#shareQrStatus").textContent = error.message;
  }
  shareDialog.showModal();
});
$("#closeShare").addEventListener("click", () => shareDialog.close());
$("#copyShareLink").addEventListener("click", () =>
  copyLink(state.tenant?.share?.publicUrl || "", "Permanent hotel link copied.")
);
$("#downloadShareQr").addEventListener("click", () => {
  const url = state.tenant?.share?.publicUrl;
  if (url) downloadLocalQr(url, "Guest-Star-QR.png");
});
$("#printShareQr").addEventListener("click", () => window.print());
window.addEventListener("guest-star:show-qr", (event) => {
  const url = event.detail?.url || "";
  $("#shareUrl").value = url;
  $("#downloadShareQr").disabled = !url;
  try {
    setLocalQrImage($("#shareQr"), url);
    $("#shareQrStatus").textContent = "QR verified and generated on this Mac.";
  } catch (error) {
    $("#shareQr").removeAttribute("src");
    $("#shareQrStatus").textContent = error.message;
  }
  shareDialog.showModal();
});
$("#moreButton").addEventListener("click", () => moreDialog.showModal());
$("#closeMore").addEventListener("click", () => moreDialog.close());
$("#previewGuestPage").addEventListener("click", () => {
  const url = state.tenant?.share?.publicUrl;
  if (url) openExternal(url);
});
$("#viewPrevious").addEventListener("click", () => {
  showNotice("Previous activity details are available from the administration view.");
});

$("#scanButton").addEventListener("click", scan);
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
    title: "Forget PIN",
    detail: "Forget the PIN saved on this Mac?",
    confirmLabel: "Forget"
  }))) return;
  try {
    await api("/api/config", {
      method: "POST",
      body: JSON.stringify({ clearHostPin: true })
    });
    showNotice("The saved PIN was removed from the app.");
    await refresh();
    fillSettings();
  } catch (error) {
    showNotice(error.message, true);
  }
});
$("#forgetVdjPassword").addEventListener("click", async () => {
  if (!(await confirmAction({
    title: "Remove Password",
    detail: "Remove the saved VirtualDJ password?",
    confirmLabel: "Remove"
  }))) return;
  try {
    await api("/api/config", {
      method: "POST",
      body: JSON.stringify({ clearVdjPassword: true })
    });
    showNotice("The saved VirtualDJ password was removed.");
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
    const selectedActivitySettings = state.config.signedIn && state.tenant?.activity
      ? activitySettingsPayload()
      : null;
    if (selectedActivitySettings?.allowedLanguages?.length === 0) {
      showNotice("Select Español, English, or both for this activity.", true);
      return;
    }
    await api("/api/config", { method: "POST", body: JSON.stringify(payload) });
    if (selectedActivitySettings) {
      await api("/api/activity/settings", {
        method: "POST",
        body: JSON.stringify(selectedActivitySettings)
      });
    }
    settingsDialog.close();
    showNotice("Settings saved.");
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
      "Guest Star Is Connected",
      `Everything is working. Service ${data.codeVersion} returned ${data.requestCount} active requests.`
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
      `${data.queueCount} in queue`,
      `Karaoke queue verified · time ${data.clock || "available"}`
    );
    showSuccess(
      "VirtualDJ and Its Queue Are Connected",
      `Everything is working. The Karaoke queue returned ${data.queueCount} ${data.queueCount === 1 ? "song" : "songs"}${data.clock ? ` and VirtualDJ reported ${data.clock}` : ""}.`
    );
  } catch (error) {
    setStatus("#vdjStatus", "error", "Disconnected", error.message);
    showNotice(error.message, true);
  }
});

function applyState(nextState) {
  state = nextState;
  const versionLabel = $("#bridgeVersion");
  if (versionLabel) versionLabel.textContent = `v${state.version || "unknown"}`;
  updateStatus();
  renderVdjQueue();
  renderRequests();
  renderHitSuggestions();
  renderRandomRotation();
  updateAuthUi();
  superhostPanel.sync(state);
  updateStatus();
}

$("#randomSpanish").addEventListener("click", () => drawRandomRotation("spanish"));
$("#randomEnglish").addEventListener("click", () => drawRandomRotation("english"));
$("#randomFavorites").addEventListener("click", () => drawRandomRotation("favorites"));
$("#randomBoth").addEventListener("click", () => drawRandomRotation("both"));

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
