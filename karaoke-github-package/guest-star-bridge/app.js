import { downloadLocalQr, setLocalQrImage } from "./qr-ui.js";
import { currentHostActivityAccess } from "./host-activity-access.js";
import { initSuperhostPanel } from "./superhost.js";
import { createBridgeI18n } from "./bridge-i18n.js";
import { preserveBridgeScroll } from "./scroll-preserver.js";
import { createBridgeOperations } from './bridge-operations.js';
import { initPlayerBeta } from "./player-beta.js";
import { starScreenPreferences } from "./star-screen-presentation.js";
import { initDiagnostics } from "./diagnostics.js";
import { createQueueToast } from "./queue-toast.js";
import { createStoragePreferences } from "./storage-preferences.js";
import { automaticStarScreenDisplay } from "./native-display-routing.js";

const $ = (selector, root = document) => root.querySelector(selector);
const starScreenPreferencesChannel = new BroadcastChannel("guest-star-player");
let lastStarScreenPreferencesSignature = "";
window.addEventListener("beforeunload", () => starScreenPreferencesChannel.close(), { once: true });
const ACTIVITY_LANGUAGES = [
  ["es", "#activityLanguageEs"], ["en", "#activityLanguageEn"],
  ["fr", "#activityLanguageFr"], ["it", "#activityLanguageIt"],
  ["de", "#activityLanguageDe"], ["ru", "#activityLanguageRu"],
  ["pt", "#activityLanguagePt"]
];
const requestsEl = $("#requests");
const finishedRequestsEl = $("#finishedRequests");
const noticeEl = $("#notice");
const queueToast = createQueueToast(noticeEl);
document.body.append(noticeEl);
const preferencesDialog = $("#preferencesDialog");
const settingsDialog = $("#settingsDialog");
const successDialog = $("#successDialog");
const confirmDialog = $("#confirmDialog");
const loginDialog = $("#loginDialog");
const selectionDialog = $("#selectionDialog");
const playbackModeDialog = $("#playbackModeDialog");
const passwordDialog = $("#passwordDialog");
const shareDialog = $("#shareDialog");
const hostActivityQrDialog = $("#hostActivityQrDialog");
const moreDialog = $("#moreDialog");
const folderList = $("#folderList");
const bridgeI18n = createBridgeI18n({ language: "es" });
let state = null;
let folders = [];
let activityBusy = false;
let scanBusy = false;
let syncBusy = false;
let passwordChangeRequired = false;
let pendingActivityAction = "";
let pendingHostEntry = false;
let superhostInHostView = false;
let bridgeFinishedExpanded = false;
let autoOpenedHostActivityId = "";
const actionLocks = new Set();
const hitSearchLocks = new Set();
const expandedRequestIds = new Set();
let lastActivityRevision = null;
let lastInstantSyncAt = 0;
let autoRestoredPlayerActivityId = "";
let autoRestoredBridgeActivityId = "";
let nativeDisplays = [];
let automaticStarScreenDisplayId = "";
let playerPanel;
const diagnostics = initDiagnostics({
  api,
  getState: () => state,
  getPlayerSnapshot: () => playerPanel?.diagnosticSnapshot?.() || {},
  showNotice
});
const superhostPanel = initSuperhostPanel({
  api,
  showNotice,
  copyLink,
  openExternal
});
playerPanel = initPlayerBeta({
  api,
  showNotice,
  confirmAction,
  diagnostics,
  operations: {
    controlActivity: (action) => controlActivity(action),
    openShare: () => $("#shareButton").click(),
    openSettings: () => $("#settingsButton").click(),
    scanLibrary: () => scan()
  }
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

function showNotice(message, error = false, action = null) {
  queueToast(message, error, action);
}

const storagePreferences = createStoragePreferences({ request: api, dialog: preferencesDialog, i18n: bridgeI18n, notify: showNotice });
const bridgeOperations = createBridgeOperations({ request: api, getState: () => state, refresh, notify: showNotice, markOutcome, undoOutcome, i18n: bridgeI18n });

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

function guestDisplayName(item) {
  const singer = String(item?.singer || "").trim();
  const alias = String(item?.guestAlias || "").trim();
  return alias ? `${singer} ${alias}` : singer;
}

function renderGuestIdentity(element, item) {
  element.textContent = "";
  const name = document.createElement("span");
  name.className = "singer-name";
  name.textContent = item.singer;
  element.append(name);
  if (!item.guestAlias) return;
  const badge = document.createElement("span");
  const tone = Math.max(0, Number(item.guestTone) || 0) % 6;
  badge.className = `guest-alias-badge guest-tone-${tone}`;
  badge.textContent = item.guestAlias;
  badge.title = `Guest identifier ${item.guestAlias}`;
  badge.setAttribute("aria-label", `Guest ${item.guestAlias}`);
  element.append(badge);
}

function requestLabel(id) {
  const item = state?.requests?.find((entry) => entry.id === id);
  return item ? `${guestDisplayName(item)} — ${item.song}` : "The song";
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
    showNotice(success.detail, false, success.action);
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
  return parsed.toLocaleString(bridgeI18n.locale(), {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function clockTime(value) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleTimeString(bridgeI18n.locale(), {
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
  const elapsedSeconds = activityRunning
    ? Math.max(0, Math.floor((Date.now() - started) / 1000))
    : 0;
  summary.activityRunning = activityRunning;
  summary.elapsedSeconds = elapsedSeconds;
  summary.clockRemainingSeconds = activityRunning
    ? Math.max(0, targetSeconds - elapsedSeconds)
    : 0;
  summary.remainingActivitySeconds = summary.clockRemainingSeconds;
  summary.clockOverrunSeconds = activityRunning
    ? Math.max(0, elapsedSeconds - targetSeconds)
    : 0;
  summary.eventEndsAt = activityRunning && targetSeconds > 0
    ? new Date(started + targetSeconds * 1000).toISOString()
    : "";
  if (activityRunning && Number(summary.estimateAverageSongSeconds) > 0) {
    summary.estimatedRemainingSongs = Math.max(
      0,
      Math.floor(summary.clockRemainingSeconds / Number(summary.estimateAverageSongSeconds))
    );
  }
  return summary;
}

function playerActivityDisplaySummary(summary) {
  if (state?.operatingMode?.selected !== "player") return summary;
  const requests = Array.isArray(state?.requests) ? state.requests : [];
  const fallbackTransition = Math.max(0, Number(state?.activity?.transitionSeconds) || 0);
  const secondsFor = (item) =>
    (Math.max(0, Number(item?.durationSeconds) || 240) +
      Math.max(0, Number(item?.transitionSeconds) || fallbackTransition));
  const completed = [];
  const skipped = [];
  const active = [];
  for (const item of requests) {
    const outcome = String(item?.outcome || "").toLowerCase();
    const status = String(item?.status || "");
    if (outcome === "completed" || status === "Ya cantó") completed.push(item);
    else if (["skipped", "removed"].includes(outcome) || ["Saltado", "Retirada del Player"].includes(status)) skipped.push(item);
    else if (!item?.stem || item.stem.status === "ready") active.push(item);
  }
  const plannedSeconds = requests
    .filter((item) => !skipped.includes(item))
    .reduce((total, item) => total + secondsFor(item), 0);
  const completedSeconds = completed.reduce((total, item) => total + secondsFor(item), 0);
  const queued = active.filter((item) => item.localAvailable);
  const queuedSeconds = queued.reduce((total, item) => total + secondsFor(item), 0);
  const skippedSeconds = skipped.reduce((total, item) => total + secondsFor(item), 0);
  const targetSeconds = Math.max(0, Number(summary.targetSeconds) || 0);
  const confirmedSeconds = completedSeconds + queuedSeconds;
  const gapSeconds = Math.max(0, targetSeconds - confirmedSeconds);
  const overrunSeconds = Math.max(0, confirmedSeconds - targetSeconds);
  return {
    ...summary,
    plannedSeconds,
    completedSeconds,
    skippedSeconds,
    queuedSeconds,
    queueSongCount: queued.length,
    confirmedSeconds,
    gapSeconds,
    overrunSeconds,
    coveragePercent: targetSeconds ? Math.round((confirmedSeconds / targetSeconds) * 100) : 0,
    suggestClose: state?.activity?.accepting !== false && targetSeconds > 0 && confirmedSeconds >= targetSeconds,
    suggestHits: queued.length === 0 && gapSeconds > 0
  };
}

function updateTimeDashboard() {
  if (!state) return;
  const playerSelected = state.operatingMode?.selected === "player";
  const summary = playerActivityDisplaySummary(liveActivitySummary());
  const target = Number(summary.targetSeconds) || 0;
  const selectedActivity = state?.tenant?.activity || null;
  const scheduledStart = Date.parse(String(selectedActivity?.scheduledStartAt || ""));
  const scheduled = !summary.activityRunning &&
    String(selectedActivity?.status || "") === "scheduled" &&
    Number.isFinite(scheduledStart);
  const summaryRelevant = summary.activityRunning || scheduled;
  $("#elapsedTime").textContent = activityDuration(summary.activityRunning ? summary.elapsedSeconds : 0);
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
  $("#confirmedTime").textContent = activityDuration(summaryRelevant ? summary.confirmedSeconds : 0);
  const queueCount = Number(summary.queueSongCount) || 0;
  $("#confirmedDetail").textContent = playerSelected
    ? `${queueCount} active Player ${queueCount === 1 ? "request" : "requests"} · ` +
      `${activityDuration(summary.completedSeconds)} already performed`
    : `${queueCount} live VDJ ${queueCount === 1 ? "track" : "tracks"} · ` +
      `${activityDuration(summary.completedSeconds)} already performed`;
  $("#plannedTime").textContent = activityDuration(summaryRelevant ? summary.plannedSeconds : 0);
  $("#plannedDetail").textContent = summary.skippedSeconds
    ? `${activityDuration(summary.skippedSeconds)} excluded as skipped`
    : "Skipped songs are not included";

  if (summary.activityRunning && summary.eventEndsAt) {
    $("#eventEndTime").textContent = clockTime(summary.eventEndsAt);
    $("#eventEndDetail").textContent =
      `EMCEE: manage the rotation to finish by ${clockTime(summary.eventEndsAt)} and respect the event end time.`;
  } else if (scheduled && target > 0) {
    const scheduledEnd = new Date(scheduledStart + target * 1000).toISOString();
    $("#eventEndTime").textContent = clockTime(scheduledEnd);
    $("#eventEndDetail").textContent = `Scheduled end · the active countdown begins only when the activity starts.`;
  } else {
    $("#eventEndTime").textContent = "—";
    $("#eventEndDetail").textContent = "Start an activity to activate its end time.";
  }

  const card = $("#coverageCard");
  card.classList.remove("ok", "warning", "over");
  if (!summary.activityRunning) {
    $("#coverageTime").textContent = "—";
    $("#coverageDetail").textContent = scheduled
      ? "Programada · la cuenta regresiva todavía no ha comenzado"
      : "Sin actividad en curso";
  } else if (summary.clockOverrunSeconds) {
    card.classList.add("over");
    $("#coverageTime").textContent = `0:00:00 · ≈ 0 canciones`;
    $("#coverageDetail").textContent = `El horario terminó hace ${activityDuration(summary.clockOverrunSeconds)}`;
  } else {
    card.classList.add("warning");
    const estimate = Math.max(0, Number(summary.estimatedRemainingSongs) || 0);
    $("#coverageTime").textContent =
      `${activityDuration(summary.clockRemainingSeconds)} · ≈ ${estimate} ${estimate === 1 ? "canción" : "canciones"}`;
    $("#coverageDetail").textContent = summary.clockRemainingSeconds <= 3600
      ? "Proyección de última hora con la fila y duraciones disponibles"
      : "Tiempo real restante según el horario de la actividad";
  }

  const advice = $("#coverageAdvice");
  advice.innerHTML = "";
  if (summary.suggestClose) {
    const text = document.createElement("div");
    text.innerHTML = playerSelected
      ? "<strong>You have enough confirmed time.</strong><p>Completed songs and the active Player queue cover the activity duration.</p>"
      : "<strong>You have enough confirmed time.</strong><p>Completed songs and tracks actually present in VirtualDJ cover the activity duration.</p>";
    advice.append(
      text,
      button("Close Requests Now", "danger", () => controlActivity("close"))
    );
    advice.classList.remove("hidden");
  } else if (summary.suggestHits) {
    advice.innerHTML = playerSelected
      ? "<div><strong>The Player queue is empty.</strong><p>Open Player to use Plan B or add a singer.</p></div>"
      : "<div><strong>The VirtualDJ queue is empty.</strong><p>Use the hit suggestions below for the EMCEE or a random singer.</p></div>";
    advice.classList.remove("hidden");
  } else {
    advice.classList.add("hidden");
  }
  document.querySelectorAll(".operations-summary-strip .status-card, .operations-summary-strip .time-card, .operations-summary-strip .event-reminder")
    .forEach((summaryItem) => {
      const label = $("small", summaryItem)?.textContent?.trim();
      const value = $("strong", summaryItem)?.textContent?.trim();
      const detail = $("p", summaryItem)?.textContent?.trim();
      summaryItem.title = [label, value, detail].filter(Boolean).join(" · ");
    });
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
  card.title = [$('small', card)?.textContent?.trim(), title, detail].filter(Boolean).join(" · ");
}

function renderHostActivityQr(access) {
  const qr = $("#hostActivityQrImage");
  try {
    if (qr.dataset.qrText !== access.joinUrl) setLocalQrImage(qr, access.joinUrl, 900);
    $("#hostActivityQrTitle").textContent = state.tenant.activity.name || "Actividad";
    $("#hostActivityQrContext").textContent = [state.tenant.hotel.name, state.tenant.venue.name].filter(Boolean).join(" · ");
    $("#hostActivityQrPin").textContent = `PIN ${access.pin}`;
    return true;
  } catch (error) {
    if (hostActivityQrDialog.open) hostActivityQrDialog.close();
    showNotice(error.message, true);
    return false;
  }
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
    sheet.error ? "error" : state.config.signedIn ? "ok" : "",
    sheet.error ? "Disconnected" : `${state.requests.length} requests`,
    sheet.error || (state.config.signedIn
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
  const selectedMode = state.operatingMode?.selected || "";
  document.body.classList.toggle("player-selected-mode", selectedMode === "player");
  document.body.classList.toggle("player-activity-locked", running && selectedMode === "player");
  document.body.classList.toggle("bridge-activity-locked", running && selectedMode === "bridge");
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
  const isHostView = authenticated && (state.account?.user?.role === "host" ||
    (state.account?.user?.role === "superhost" && superhostInHostView && !superhostPanel.isOpen()));
  const access = currentHostActivityAccess(state, { superhostInHostView: isHostView });
  const hostSessionPin = $("#hostSessionPin");
  hostSessionPin.classList.toggle("hidden", !isHostView || !tenant.hotel || !selectedActivity || !tenant.venue);
  const roomName = [tenant.hotel?.name, selectedActivity?.name, tenant.venue?.name].filter(Boolean).join(" · ");
  $("#hostSessionHotel").textContent = roomName || "—";
  $("#hostSessionPinValue").textContent = access ? `PIN ${access.pin}` : "PIN —";
  $("#hostSessionQrButton").disabled = !access;
  hostSessionPin.title = access ? `${roomName} · PIN ${access.pin}` : `${roomName || "Actividad"} · PIN pendiente`;
  if (hostActivityQrDialog.open) {
    if (access) renderHostActivityQr(access);
    else hostActivityQrDialog.close();
  }
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
  primary.classList.toggle("is-loading", activityBusy);
  primary.setAttribute("aria-busy", activityBusy ? "true" : "false");
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
  const hostViewButton = $("#openHostPanel");
  hostViewButton.classList.toggle("hidden", !isSuperhost);
  hostViewButton.textContent = superhostPanel.isOpen() ? "Modo Host" : "Superhost";
  hostViewButton.setAttribute("aria-label", superhostPanel.isOpen()
    ? "Ir a la operación del Host"
    : "Volver al Panel Superhost");
  const modeStatus = $("#playbackModeStatus");
  modeStatus.classList.toggle("hidden", !authenticated || !selectedActivity || !selectedMode);
  modeStatus.textContent = selectedMode
    ? `Modo: ${selectedMode === "player" ? "Player" : "Bridge"}${running ? " · bloqueado" : ""}`
    : "";
  const modeLocked = state.operatingMode?.locked === true || state.activity?.activityRunning === true;
  for (const modeButton of [$("#bridgeChangeMode"), $("#playerChangeMode")]) {
    modeButton.classList.toggle("hidden", !authenticated || !selectedActivity);
    modeButton.disabled = modeLocked;
    modeButton.textContent = modeLocked
      ? "Modo bloqueado"
      : selectedMode
        ? "Cambiar modo"
        : "Elegir modo";
    modeButton.title = modeLocked
      ? "El modo queda bloqueado mientras la actividad está en curso."
      : "Puedes cambiar entre Player y Bridge hasta iniciar la actividad.";
  }
  $("#switchActivity").classList.toggle("hidden", running || !authenticated);
  $("#changePasswordButton").classList.toggle("hidden", !authenticated);
  $("#logoutButton").classList.toggle("hidden", !authenticated);
  $("#archiveQueue").disabled = !selectedActivity || !can("canArchiveQueue");
  const canOpenManagement = isSuperhost || can("canChangeSchedule") || can("canScheduleNextActivity") || can("canViewReviews");
  $("#viewPrevious").classList.toggle("hidden", !canOpenManagement);
  $("#playerManagement").classList.toggle("hidden", !canOpenManagement);
  $("#previewGuestPage").disabled = !tenant.share?.publicUrl;
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
  } catch (error) {
    // Clipboard permission failures must never stop a live Bridge session.
    // The link remains visible/selectable in the current panel.
    showNotice("Automatic copy failed. Select the visible link and press ⌘C.", true);
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

async function queue(id, filePath) {
  const label = requestLabel(id);
  await runAction(
    actionScope(id),
    `Sending ${label} to VirtualDJ…`,
    () => api(`/api/requests/${encodeURIComponent(id)}/queue`, {
      method: "POST",
      body: JSON.stringify({ filePath })
    }),
    (data) => ({
      title: data.restored
        ? "Song restored"
        : data.alreadyQueued
          ? "Already in VirtualDJ"
          : "Song added to VirtualDJ",
      detail:
        data.warning ||
        `${label} is confirmed in the VirtualDJ Karaoke queue.`
    })
  );
}

async function replaceQueueFile(id, candidate) {
  const label = requestLabel(id);
  await runAction(
    actionScope(id),
    `Changing the linked file for ${label}…`,
    () => api(`/api/requests/${encodeURIComponent(id)}/replace`, {
      method: "POST",
      body: JSON.stringify({ filePath: candidate.filePath })
    }),
    (data) => ({
      title: "VirtualDJ file changed",
      detail:
        data.warning ||
        `${label} now uses ${data.fileName} in position ${data.queuePosition}.`
    })
  );
}

async function linkLocalFile(id, candidate) {
  const label = requestLabel(id);
  await runAction(
    actionScope(id),
    `Linking ${candidate.fileName} to ${label}…`,
    () => api(`/api/requests/${encodeURIComponent(id)}/link`, {
      method: "POST",
      body: JSON.stringify({ filePath: candidate.filePath })
    }),
    (data) => ({
      title: "Local file linked",
      detail: data.warning || `${label} now uses ${data.fileName}. Manual selection is protected from rescans.`
    })
  );
}

async function unlinkLocalFile(id) {
  const label = requestLabel(id);
  await runAction(
    actionScope(id),
    `Clearing the local link for ${label}…`,
    () => api(`/api/requests/${encodeURIComponent(id)}/unlink`, {
      method: "POST",
      body: "{}"
    }),
    (data) => ({
      title: "Local link cleared",
      detail: data.warning || `${label} returned to normal matching without deleting the request.`
    })
  );
}

function confidenceLabel(candidate) {
  const tier = {
    "very-high": "very high",
    high: "high",
    medium: "medium",
    low: "low"
  }[candidate.confidenceTier] || "estimated";
  const notes = [];
  if (candidate.ambiguous) notes.push("ambiguous");
  if (candidate.youtubeCorroborated) notes.push("YouTube corroborated");
  if (candidate.artistConflict) notes.push("artist conflict");
  return `${candidate.confidencePercent ?? Math.round(candidate.score * 100)}% · ${tier} confidence${notes.length ? ` · ${notes.join(" · ")}` : ""}`;
}

async function removeFromQueue(id) {
  const label = requestLabel(id);
  await runAction(
    actionScope(id),
    `Removing ${label} from VirtualDJ…`,
    () => api(`/api/requests/${encodeURIComponent(id)}/remove`, {
      method: "POST",
      body: "{}"
    }),
    (data) => ({
      title: "Song removed from VirtualDJ",
      action: { label: "Deshacer", run: () => queue(id) },
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
  await runAction(
    actionScope(id),
    outcome === "completed"
      ? `Marking ${songLabel} as completed…`
      : outcome === 'removed' ? `Removing ${songLabel}…` : `Marking ${songLabel} as skipped…`,
    () => api(
      `/api/requests/${encodeURIComponent(id)}/outcome`,
      {
        method: "POST",
        body: JSON.stringify({ outcome, commandId: crypto.randomUUID() })
      }
    ),
    (data) => ({
      title: outcome === "completed" ? "Singer completed" : outcome === 'removed' ? 'Request removed' : "Song skipped",
      action: { label: "Deshacer", run: () => {
        const item = state?.requests?.find(entry => entry.id === id);
        return undoOutcome(id, item?.canRestoreToQueue ? (item.undoOriginalPosition ? "original" : "end") : "pending");
      } },
      detail:
        data.warning ||
        (outcome === "completed"
          ? `${songLabel} is marked as completed; it remains included in total time and was removed from VirtualDJ.`
          : outcome === 'removed' ? `${songLabel} was removed from the lineup. Undo is available.`
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
    if (item.localMatch) {
      const related = document.createElement("small");
      related.className = "youtube-local-match";
      related.textContent = `Related local file: ${item.localMatch.fileName} · ${item.localMatch.confidencePercent}%`;
      related.title = item.localMatch.fileName;
      info.append(related);
    }
    const actions = document.createElement("div");
    actions.className = "source-actions";
    actions.append(
      button("Copy This Link", "primary", () =>
        copyYoutubeOption(requestId, item.url)
      ),
      button("Open ↗", "youtube", () => openExternal(item.url))
    );
    if (item.localMatch) {
      actions.prepend(
        button("Link Local File", "ghost", () =>
          linkLocalFile(requestId, item.localMatch)
        )
      );
    }
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
  return preserveBridgeScroll(renderVdjQueueContents);
}

function renderVdjQueueContents() {
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
  const displayedSinger = (entry) => {
    const linked = state?.requests?.find(
      (item) => item.id === entry.linkedRequestId
    );
    return linked ? guestDisplayName(linked) : entry.singer;
  };
  summary.textContent =
    `${entries.length} ${entries.length === 1 ? "track" : "tracks"} · ` +
    `next: ${displayedSinger(next)} — ${next.song}` +
    (Number(state?.virtualDJ?.externalCount) > 0
      ? ` · ${state.virtualDJ.externalCount} external`
      : "");
  entries.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "vdj-live-row";
    row.dataset.vdjId =
      entry.virtualDJItemId ||
      entry.linkedRequestId ||
      [entry.singer, entry.song, entry.artist].filter(Boolean).join(" · ");
    const position = document.createElement("b");
    position.textContent = entry.position;
    const info = document.createElement("span");
    const song = document.createElement("strong");
    song.textContent = entry.song;
    const detail = document.createElement("small");
    detail.textContent = [
      entry.artist,
      `Singer: ${displayedSinger(entry)}`,
      entry.sourceType === "virtualdj_external"
        ? "Unmatched VirtualDJ item"
        : "Linked request"
    ]
      .filter(Boolean)
      .join(" · ");
    info.append(song, detail);
    const durationLabel = document.createElement("span");
    durationLabel.textContent = activityDuration(entry.durationSeconds);
    row.append(position, info, durationLabel);
    bridgeOperations.appendRowActions(row, entry, entries);
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
  return preserveBridgeScroll(renderRequestContents);
}

function renderRequestContents() {
  requestsEl.innerHTML = "";
  finishedRequestsEl.innerHTML = "";
  const template = $("#requestTemplate");
  const timelines = requestTimelines(state.requests);
  const groups = new Map();
  [
    ["active", "Active Requests", "Pending and linked, in arrival order", requestsEl],
    ["finished", "Completed / Skipped", "Only Undo can return them to the rotation", finishedRequestsEl]
  ].forEach(([key, title, detail, target]) => {
    const section = document.createElement(key === "finished" ? "details" : "section");
    section.className = `request-group ${key}`;
    if (key === "finished") section.open = bridgeFinishedExpanded;
    const header = document.createElement(key === "finished" ? "summary" : "header");
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
    target.append(section);
    if (key === "finished") {
      section.addEventListener("toggle", () => {
        bridgeFinishedExpanded = section.open;
      });
    }
    groups.set(key, { list, count, total: 0 });
  });
  const visibleRequests = state.operatingMode?.selected === 'bridge' ? [...state.requests].sort((a, b) =>
    (a.administrativePosition || Number.MAX_SAFE_INTEGER) - (b.administrativePosition || Number.MAX_SAFE_INTEGER)) : state.requests;
  visibleRequests.forEach((item, index) => {
    const fragment = template.content.cloneNode(true);
    const card = $(".request-card", fragment);
    card.dataset.requestId = item.id;
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
    renderGuestIdentity($(".singer", card), item);
    $(".song", card).textContent = item.song;
    $(".artist", card).textContent = item.artist || bridgeI18n.translate("Artist not provided");
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
    badge.textContent = item.outcome === 'removed' ? 'Removed · Undo available' : {
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
      item.localState === "completed" || item.localState === "skipped" || item.outcome === 'removed';
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
        : item.outcome === 'removed' ? '<div class="outcome-summary skipped"><strong>This request was removed.</strong><p>Undo returns this same request without a duplicate.</p></div>'
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
          ? item.manualLink
            ? '<p class="empty-match"><strong>Manual local link protected.</strong> Rescans and match percentages cannot replace it.</p>'
            : '<p class="empty-match">This request is in VirtualDJ. Move it directly in VirtualDJ and the Bridge will preserve it at its new position.</p>'
          : '<p class="empty-match missing-warning">The file previously linked to this request no longer exists in the local folder.</p>';
      const actions = document.createElement("div");
      actions.className = "queue-actions";
      actions.append(
        button("Remove from VirtualDJ", "danger", () => removeFromQueue(item.id))
      );
      if (item.linkedFilePath) {
        actions.prepend(
          button("Unlink Local File", "ghost", () => unlinkLocalFile(item.id))
        );
      }
      match.append(actions);
      const replacementCandidates = item.matches.filter(
        (candidate) => candidate.filePath !== (item.linkedFilePath || item.queuedFilePath)
      );
      const changePanel = document.createElement("details");
      changePanel.className = "change-link-panel";
      const changeSummary = document.createElement("summary");
      changeSummary.textContent = "Change linked file";
      const changeHelp = document.createElement("p");
      changeHelp.textContent = replacementCandidates.length
        ? "Choose another local file. The current row stays protected unless you confirm a replacement."
        : "No other local candidate is available. Scan the folder after adding the replacement file.";
      changePanel.append(changeSummary, changeHelp);
      if (replacementCandidates.length) {
        const candidates = document.createElement("div");
        candidates.className = "candidate-list";
        replacementCandidates.forEach((candidate) => {
          const option = document.createElement("div");
          option.className = "candidate";
          const infoOption = document.createElement("span");
          const name = document.createElement("strong");
          name.textContent = candidate.fileName;
          const score = document.createElement("small");
          score.textContent = confidenceLabel(candidate);
          infoOption.append(name, score);
          const optionActions = document.createElement("div");
          optionActions.className = "source-actions";
          optionActions.append(
            button("Link Only", "ghost", () => linkLocalFile(item.id, candidate))
          );
          if (candidate.filePath !== item.queuedFilePath) {
            optionActions.append(
              button("Replace VDJ Row", "primary", () => replaceQueueFile(item.id, candidate))
            );
          }
          option.append(
            infoOption,
            optionActions
          );
          candidates.append(option);
        });
        changePanel.append(candidates);
      } else {
        changePanel.append(
          button("Scan Folder Now", "ghost", scan)
        );
      }
      match.append(changePanel);
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
    } else if (item.linkedFilePath || item.matches.length) {
      const linkedMatch = item.matches.find((candidate) => candidate.filePath === item.linkedFilePath);
      const top = item.linkedFilePath
        ? linkedMatch || {
            filePath: item.linkedFilePath,
            fileName: item.linkedFileName,
            score: 1,
            confidencePercent: 100,
            confidenceTier: "very-high"
          }
        : item.matches[0];
      const row = document.createElement("div");
      row.className = "match-row";
      const info = document.createElement("div");
      info.className = "match-file";
      const strong = document.createElement("strong");
      strong.textContent = top.fileName;
      const small = document.createElement("small");
      small.textContent = item.linkedFilePath
        ? `${item.manualLink ? "Manual" : "Automatic"} local link · protected`
        : confidenceLabel(top);
      info.append(strong, small);
      const topActions = document.createElement("div");
      topActions.className = "source-actions";
      if (!item.linkedFilePath) {
        topActions.append(button("Link File", "ghost", () => linkLocalFile(item.id, top)));
      } else {
        topActions.append(button("Unlink", "ghost", () => unlinkLocalFile(item.id)));
      }
      if (!item.linkedFilePath || item.linkedFileAvailable) {
        topActions.append(button("Add to VirtualDJ", "primary", () => queue(item.id, top.filePath)));
      }
      row.append(info, topActions);
      match.append(row);
      const alternateMatches = item.matches.filter((candidate) => candidate.filePath !== top.filePath);
      if (alternateMatches.length) {
        const candidates = document.createElement("div");
        candidates.className = "candidate-list";
        alternateMatches.forEach((candidate) => {
          const option = document.createElement("div");
          option.className = "candidate";
          const infoOption = document.createElement("span");
          const name = document.createElement("strong");
          name.textContent = candidate.fileName;
          const score = document.createElement("small");
          score.textContent = confidenceLabel(candidate);
          infoOption.append(name, score);
          const optionActions = document.createElement("div");
          optionActions.className = "source-actions";
          optionActions.append(
            button("Link File", "ghost", () => linkLocalFile(item.id, candidate)),
            button("Add to VDJ", "primary", () => queue(item.id, candidate.filePath))
          );
          option.append(
            infoOption,
            optionActions
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
    if (state.operatingMode?.selected === 'bridge' && item.sourceType !== 'player_local') {
      $(".request-main", card).insertBefore(outcomePanel, details);
      bridgeOperations.appendRequestActions(outcomePanel, item);
    }
    if (requestPending) {
      card.classList.add("processing");
      badge.textContent = "Processing…";
      card.querySelectorAll("button").forEach((element) => {
        element.disabled = true;
      });
    }
    const groupKey = isTerminal ? "finished" : "active";
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

function audioOutputSupported(capability) {
  return capability === true || capability?.supported === true;
}

async function refreshAudioOutputs() {
  const select = $("#preferencesAudioOutput");
  const status = $("#preferencesAudioStatus");
  if (!select || !status) return;
  const saved = select.value || state?.config?.audioOutputDeviceId || "";
  try {
    const capability = await playerPanel.audioOutputCapability?.();
    if (!audioOutputSupported(capability)) {
      select.innerHTML = '<option value="">Salida predeterminada del sistema</option>';
      select.value = "";
      select.disabled = true;
      status.textContent = capability?.reason || "Esta versión de WebKit no permite seleccionar una salida por aplicación. Guest Star usará la salida predeterminada del sistema.";
      return;
    }
    const devices = await playerPanel.listAudioOutputs();
    const outputs = Array.isArray(devices) ? devices : [];
    select.innerHTML = '<option value="">Salida predeterminada del sistema</option>';
    const seen = new Set([""]);
    outputs.forEach((device, index) => {
      const id = String(device.deviceId || device.id || "");
      if (!id || seen.has(id)) return;
      seen.add(id);
      const option = document.createElement("option");
      option.value = id;
      option.textContent = device.label || `Salida de audio ${index + 1}`;
      select.append(option);
    });
    select.disabled = false;
    if (saved && seen.has(saved)) {
      select.value = saved;
      status.textContent = capability?.mode === "coreaudio"
        ? "La app instalada aplicará esta salida real al karaoke, la voz guía y la música de fondo. En este WebKit, el cambio corresponde a la salida del sistema macOS."
        : "La salida seleccionada se aplicará al karaoke, la voz guía y la música de fondo.";
    } else {
      select.value = "";
      status.textContent = saved
        ? "La salida configurada ya no está disponible. Se usará la salida predeterminada."
        : capability?.mode === "coreaudio"
          ? "CoreAudio usará la salida predeterminada actual de macOS para toda la mezcla de Guest Star."
          : "La salida predeterminada mantiene karaoke, voz guía y ambiente en la misma ruta.";
    }
  } catch (error) {
    select.innerHTML = '<option value="">Salida predeterminada del sistema</option>';
    select.value = "";
    select.disabled = true;
    status.textContent = `No se pudieron consultar las salidas: ${error.message}`;
  }
}

function renderNativeDisplays(displays = nativeDisplays) {
  const select = $("#preferencesStarScreenDisplay");
  const status = $("#preferencesDisplayStatus");
  if (!select || !status) return;
  const saved = select.value || state?.config?.starScreenDisplayId || "";
  select.innerHTML = '<option value="">Automática · preferir pantalla externa</option>';
  const ids = new Set([""]);
  displays.forEach((display, index) => {
    const id = String(display.displayId || display.uuid || "");
    if (!id || ids.has(id)) return;
    ids.add(id);
    const option = document.createElement("option");
    option.value = id;
    const width = Math.round(Number(display.frame?.width) || 0);
    const height = Math.round(Number(display.frame?.height) || 0);
    const resolution = width && height ? ` · ${width}×${height}` : "";
    option.textContent = `${display.localizedName || `Pantalla ${index + 1}`}${resolution}${display.primary ? " · Principal" : ""}`;
    select.append(option);
  });
  select.disabled = false;
  if (saved && ids.has(saved)) {
    select.value = saved;
    status.textContent = "Star Screen se abrirá o moverá a esta pantalla.";
  } else {
    select.value = "";
    const automatic = automaticStarScreenDisplay(displays, "");
    status.textContent = saved
      ? "La pantalla configurada ya no está disponible. Star Screen elegirá otra salida segura."
      : automatic.external
        ? "La pantalla externa se usará automáticamente como Star Screen."
        : "Conecta una pantalla externa para asignarla automáticamente a Star Screen.";
  }
}

function routeStarScreenToNativeDisplay(displays = nativeDisplays, { force = false } = {}) {
  const handler = window.webkit?.messageHandlers?.guestStarNative;
  if (!handler?.postMessage) return;
  const route = automaticStarScreenDisplay(displays, state?.config?.starScreenDisplayId || "");
  if (!force && route.displayId === automaticStarScreenDisplayId) return;
  const previous = automaticStarScreenDisplayId;
  automaticStarScreenDisplayId = route.displayId;
  handler.postMessage({ action: "setStarScreenDisplay", displayId: route.displayId });
  if (route.external && state?.tenant?.activity) {
    handler.postMessage({
      action: "openStarScreen",
      displayId: route.displayId,
      url: "/star-screen.html?display=1&visual=canonical-canvas-7",
      preview: false
    });
  } else if (previous && !route.displayId) {
    showNotice("La pantalla externa se desconectó. Star Screen quedó disponible en una salida segura.");
  }
}

function requestNativeDisplays() {
  const handler = window.webkit?.messageHandlers?.guestStarNative;
  if (!handler?.postMessage) {
    nativeDisplays = [];
    renderNativeDisplays();
    $("#preferencesStarScreenDisplay").disabled = true;
    $("#preferencesDisplayStatus").textContent = "La selección nativa de pantalla está disponible dentro de Guest Star.app.";
    return;
  }
  handler.postMessage({ action: "listDisplays" });
}

function applyInterfacePreferences(preferences = {}) {
  document.body.classList.toggle("preference-hide-star-preview", preferences.showStarScreenPreview === false);
  document.body.classList.toggle("preference-hide-waveform", preferences.showWaveform === false);
  document.body.classList.toggle("preference-current-song-background", preferences.showCurrentSongBackground === true);
  document.body.classList.toggle("preference-hide-eq", preferences.showEq === false);
  document.body.classList.toggle("preference-hide-advanced", preferences.showAdvancedControls === false);
  const publicPreferences = starScreenPreferences(preferences);
  const signature = JSON.stringify(publicPreferences);
  if (signature !== lastStarScreenPreferencesSignature) {
    lastStarScreenPreferencesSignature = signature;
    starScreenPreferencesChannel.postMessage({ type: "star-screen-preferences", preferences: publicPreferences, publishedAt: Date.now() });
    try {
      const snapshot = JSON.parse(localStorage.getItem("guest-star:player-state") || "null");
      if (snapshot) localStorage.setItem("guest-star:player-state", JSON.stringify({ ...snapshot, starScreenPreferences: publicPreferences }));
    } catch { /* The existing state stream remains authoritative. */ }
  }
}

// Save presentation controls without submitting audio/activity settings.
for (const selector of ["#preferenceShowWaveform", "#preferenceShowStarScreenNowPlaying", "#preferenceShowCurrentSongBackground", "#preferenceStarScreenSongSource", "#preferenceStarScreenLineupCount", "#preferenceShowActivityAccess"]) {
  $(selector).addEventListener("change", async () => {
    const controls = [$("#preferenceShowWaveform"), $("#preferenceShowStarScreenNowPlaying"), $("#preferenceShowCurrentSongBackground"), $("#preferenceStarScreenSongSource"), $("#preferenceStarScreenLineupCount"), $("#preferenceShowActivityAccess")];
    const next = {
      showWaveform: controls[0].checked,
      showStarScreenNowPlaying: controls[1].checked,
      showCurrentSongBackground: controls[2].checked,
      starScreenSongSource: controls[3].value,
      starScreenLineupCount: Number(controls[4].value),
      showActivityAccess: controls[5].checked
    };
    controls.forEach(control => { control.disabled = true; });
    try {
      const result = await api("/api/config", {
        method: "POST", body: JSON.stringify({ interfacePreferences: next })
      });
      const confirmed = result.config?.interfacePreferences;
      if (!confirmed || confirmed.showWaveform !== next.showWaveform ||
          confirmed.showStarScreenNowPlaying !== next.showStarScreenNowPlaying ||
          confirmed.showCurrentSongBackground !== next.showCurrentSongBackground ||
          confirmed.starScreenSongSource !== next.starScreenSongSource ||
          confirmed.starScreenLineupCount !== next.starScreenLineupCount ||
          confirmed.showActivityAccess !== next.showActivityAccess) {
        throw new Error("La preferencia visual no pudo confirmarse.");
      }
      state.config.interfacePreferences = confirmed;
      applyInterfacePreferences(confirmed);
      $("#starScreenPreferenceStatus").textContent = "Información de Star Screen guardada.";
    } catch (error) {
      const previous = state.config?.interfacePreferences || {};
      controls[0].checked = previous.showWaveform !== false;
      controls[1].checked = previous.showStarScreenNowPlaying !== false;
      controls[2].checked = previous.showCurrentSongBackground === true;
      controls[3].value = previous.starScreenSongSource === "local" ? "local" : "request";
      controls[4].value = String(previous.starScreenLineupCount || 5);
      controls[5].checked = previous.showActivityAccess === true;
      $("#starScreenPreferenceStatus").textContent = error.message;
      showNotice(error.message, true);
    } finally {
      controls.forEach(control => { control.disabled = false; });
    }
  });
}

function fillPreferences() {
  folders = [...state.config.libraryFolders];
  renderFolders();
  $("#rememberLibraryFolders").checked =
    state.config.rememberLibraryFolders !== false;
  $("#vdjPort").value = state.config.virtualDJ.port || 80;
  $("#vdjPassword").value = "";
  $("#vdjPassword").placeholder = state.config.virtualDJ.passwordConfigured
    ? "Password saved · leave blank to keep"
    : "No password";
  $("#autoQueueExact").checked = Boolean(state.config.autoQueueExact);
  $("#uiLanguageSelect").value = state.config.uiLanguage === "en" ? "en" : "es";
  $("#defaultStemEngine").value = ["auto", "spleeter", "demucs"].includes(state.config.defaultStemEngine)
    ? state.config.defaultStemEngine
    : "auto";
  const interfacePreferences = state.config.interfacePreferences || {};
  $("#preferenceShowPreview").checked = interfacePreferences.showStarScreenPreview !== false;
  $("#preferenceShowWaveform").checked = interfacePreferences.showWaveform !== false;
  $("#preferenceShowStarScreenNowPlaying").checked = interfacePreferences.showStarScreenNowPlaying !== false;
  $("#preferenceShowActivityAccess").checked = interfacePreferences.showActivityAccess === true;
  $("#preferenceShowCurrentSongBackground").checked = interfacePreferences.showCurrentSongBackground === true;
  $("#preferenceShowEq").checked = interfacePreferences.showEq !== false;
  $("#preferenceShowAdvanced").checked = interfacePreferences.showAdvancedControls !== false;
  $("#preferenceStarScreenSongSource").value = interfacePreferences.starScreenSongSource === "local" ? "local" : "request";
  $("#preferenceStarScreenLineupCount").value = String(interfacePreferences.starScreenLineupCount || 5);
  diagnostics.sync(state);
  void diagnostics.refresh();
  void refreshAudioOutputs();
  requestNativeDisplays();
}

function fillSettings() {
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
  $("#showStarScreenQueueCount").checked = activity.showStarScreenQueueCount !== false;
  let allowedLanguages = Array.isArray(definition.allowedLanguages)
    ? definition.allowedLanguages
    : [];
  if (!allowedLanguages.length && definition.allowedLanguagesJson) {
    try { allowedLanguages = JSON.parse(definition.allowedLanguagesJson); } catch { /* default below */ }
  }
  if (!Array.isArray(allowedLanguages) || !allowedLanguages.length) {
    allowedLanguages = ACTIVITY_LANGUAGES.map(([code]) => code);
  }
  ACTIVITY_LANGUAGES.forEach(([code, selector]) => {
    $(selector).checked = allowedLanguages.includes(code);
  });
  const activityPermissions = state.tenant?.permissions || {};
  const canManageActivityLanguages = state.account?.user?.role === "superhost" ||
    activityPermissions.all === true || activityPermissions.canChangeSchedule === true;
  $("#activityLanguageSettings").classList.toggle(
    "hidden",
    !canManageActivityLanguages
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

function preferencesPayload() {
  return {
    uiLanguage: bridgeI18n.getLanguage(),
    libraryFolders: folders.map((item) => item.trim()).filter(Boolean),
    rememberLibraryFolders: $("#rememberLibraryFolders").checked,
    virtualDJ: {
      port: Number($("#vdjPort").value) || 80,
      password: $("#vdjPassword").value
    },
    autoQueueExact: $("#autoQueueExact").checked,
    audioOutputDeviceId: $("#preferencesAudioOutput").value,
    starScreenDisplayId: $("#preferencesStarScreenDisplay").value,
    defaultStemEngine: ["auto", "spleeter", "demucs"].includes($("#defaultStemEngine").value)
      ? $("#defaultStemEngine").value
      : "auto",
    interfacePreferences: {
      showStarScreenPreview: $("#preferenceShowPreview").checked,
      showWaveform: $("#preferenceShowWaveform").checked,
      showStarScreenNowPlaying: $("#preferenceShowStarScreenNowPlaying").checked,
      showActivityAccess: $("#preferenceShowActivityAccess").checked,
      showCurrentSongBackground: $("#preferenceShowCurrentSongBackground").checked,
      starScreenSongSource: $("#preferenceStarScreenSongSource").value,
      starScreenLineupCount: Number($("#preferenceStarScreenLineupCount").value),
      showEq: $("#preferenceShowEq").checked,
      showAdvancedControls: $("#preferenceShowAdvanced").checked
    }
  };
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
    showPublicStatus: $("#showPublicStatus").checked,
    showStarScreenQueueCount: $("#showStarScreenQueueCount").checked
  };
  const activityPermissions = state.tenant?.permissions || {};
  if (state.account?.user?.role === "superhost" || activityPermissions.all === true || activityPermissions.canChangeSchedule === true) {
    payload.allowedLanguages = ACTIVITY_LANGUAGES.map(([code, selector]) => $(selector).checked ? code : "")
      .filter(Boolean);
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
  // Cloud state arrives through the Bridge's authenticated realtime channel.
  // A focus change only recovers the local UI snapshot; it must not create an
  // extra D1 refresh while realtime is healthy.
  void refresh();
}

function showHostForSelectedMode({ resetBridgeHistory = true } = {}) {
  const selectedMode = state?.operatingMode?.selected || "";
  const activityId = String(state?.account?.current?.activityId || state?.activity?.activityId || "");
  if (selectedMode === "player" || selectedMode === "bridge") {
    superhostInHostView = state?.account?.user?.role === "superhost";
  }
  if (selectedMode === "player") {
    if (state?.activity?.activityRunning) autoRestoredPlayerActivityId = activityId;
    superhostPanel.close();
    playerPanel.open();
  } else if (selectedMode === "bridge") {
    if (state?.activity?.activityRunning) autoRestoredBridgeActivityId = activityId;
    if (resetBridgeHistory) bridgeFinishedExpanded = false;
    superhostPanel.close();
    playerPanel.close({ force: true });
    renderRequests();
  }
  updateStatus();
}

function requestHostEntry() {
  if (!state?.tenant?.activity || !state?.account?.current?.activityId) {
    pendingHostEntry = true;
    fillSelection();
    if (!selectionDialog.open) selectionDialog.showModal();
    showNotice("Selecciona una actividad para entrar al modo Host.", true);
    return;
  }
  if (!state?.operatingMode?.selected) {
    pendingHostEntry = true;
    openPlaybackModeDialog();
    return;
  }
  pendingHostEntry = false;
  showHostForSelectedMode();
}

function openSuperhostView() {
  if (state?.account?.user?.role !== "superhost") return;
  pendingHostEntry = false;
  superhostInHostView = false;
  const activityId = String(state?.account?.current?.activityId || state?.activity?.activityId || "");
  if (state?.activity?.activityRunning && state?.operatingMode?.selected === "player") {
    autoRestoredPlayerActivityId = activityId;
  }
  if (state?.activity?.activityRunning && state?.operatingMode?.selected === "bridge") {
    autoRestoredBridgeActivityId = activityId;
  }
  playerPanel.close({ force: true });
  superhostPanel.open();
  updateStatus();
}

function openPlaybackModeDialog(action = "") {
  if (!state?.tenant?.activity || !state?.account?.current?.activityId) {
    showNotice("Selecciona el hotel, venue y actividad antes de elegir el modo.", true);
    return;
  }
  if (state?.operatingMode?.locked && state?.operatingMode?.selected) {
    showNotice("El modo de reproducción está bloqueado hasta finalizar la actividad.", true);
    return;
  }
  pendingActivityAction = action;
  playbackModeDialog.querySelectorAll("[data-playback-mode]").forEach((button) => {
    button.classList.toggle("selected", button.dataset.playbackMode === state?.operatingMode?.selected);
  });
  if (!playbackModeDialog.open) playbackModeDialog.showModal();
}

async function selectPlaybackMode(mode) {
  try {
    const next = await api("/api/activity/mode", {
      method: "POST",
      body: JSON.stringify({ mode })
    });
    applyState(next);
    if (playbackModeDialog.open) playbackModeDialog.close();
    const action = pendingActivityAction;
    const shouldEnterHost = pendingHostEntry || !superhostPanel.isOpen();
    pendingActivityAction = "";
    pendingHostEntry = false;
    if (shouldEnterHost) showHostForSelectedMode();
    showNotice(mode === "player"
      ? "Player interno seleccionado. Puedes cambiarlo hasta iniciar la actividad."
      : "Bridge con VirtualDJ seleccionado. Puedes cambiarlo hasta iniciar la actividad.");
    if (action) await controlActivity(action);
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function controlActivity(action) {
  if (activityBusy) {
    showNotice("An activity change is already in progress.");
    return;
  }
  if (["start", "start-new"].includes(action) && !state?.operatingMode?.selected) {
    openPlaybackModeDialog(action);
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
  const activityId = String(state.account?.current?.activityId || "");
  if (!activityId && state.account?.user?.role !== "superhost" && !passwordDialog.open) {
    fillSelection();
    if (!selectionDialog.open) selectionDialog.showModal();
    return;
  }
  if (
    activityId &&
    !state.operatingMode?.selected &&
    !passwordDialog.open
  ) {
    pendingHostEntry = true;
    openPlaybackModeDialog();
    return;
  }
  if (state.account?.user?.role === "superhost") return;
  if (activityId && autoOpenedHostActivityId !== activityId && !passwordDialog.open) {
    autoOpenedHostActivityId = activityId;
    requestHostEntry();
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

$("#googleLoginButton").addEventListener("click", async () => {
  const error = $("#loginError");
  error.classList.add("hidden");
  try {
    await openExternal(`${window.location.origin}/google-sign-in`);
  } catch (googleError) {
    error.textContent = googleError instanceof Error ? googleError.message : String(googleError);
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
  if (preferencesDialog.open) preferencesDialog.close();
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
    if (pendingHostEntry || state.account?.user?.role !== "superhost") requestHostEntry();
  } catch (selectionError) {
    error.textContent = selectionError.message;
    error.classList.remove("hidden");
  }
});

$("#closeSelection").addEventListener("click", () => {
  if (state.account?.current?.activityId) selectionDialog.close();
});
$("#closePlaybackMode").addEventListener("click", () => {
  pendingActivityAction = "";
  pendingHostEntry = false;
  if (playbackModeDialog.open) playbackModeDialog.close();
});
playbackModeDialog.querySelectorAll("[data-playback-mode]").forEach((button) => {
  button.addEventListener("click", () => void selectPlaybackMode(button.dataset.playbackMode));
});
$("#switchActivity").addEventListener("click", () => {
  if (state?.activity?.activityRunning) {
    showNotice("Finaliza la actividad antes de cambiar hotel, actividad o modo.", true);
    return;
  }
  fillSelection();
  selectionDialog.showModal();
});

async function logout() {
  if (moreDialog.open) moreDialog.close();
  if (preferencesDialog.open) preferencesDialog.close();
  if (!(await confirmAction({
    title: "Log out of this Bridge?",
    detail: "The saved session will be revoked. Local library settings will remain on this Mac.",
    confirmLabel: "Log Out"
  }))) return;
  await api("/api/auth/logout", { method: "POST", body: "{}" });
  await refresh();
}

$("#logoutButton").addEventListener("click", logout);
$("#openHostPanel").addEventListener("click", () => {
  if (superhostPanel.isOpen()) requestHostEntry();
  else openSuperhostView();
});
$("#bridgeChangeMode").addEventListener("click", () => openPlaybackModeDialog());
$("#playerChangeMode").addEventListener("click", () => openPlaybackModeDialog());
window.addEventListener("gueststar:open-host", requestHostEntry);
window.addEventListener("gueststar:open-superhost", openSuperhostView);
window.addEventListener("gueststar:management-close", requestHostEntry);

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

$("#hostSessionQrButton").addEventListener("click", () => {
  const access = currentHostActivityAccess(state, {
    superhostInHostView: superhostInHostView && !superhostPanel.isOpen()
  });
  if (access && renderHostActivityQr(access)) hostActivityQrDialog.showModal();
});
$("#closeHostActivityQr").addEventListener("click", () => hostActivityQrDialog.close());

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
$("#previewGuestPage").addEventListener("click", async () => {
  moreDialog.close();
  const url = state.tenant?.share?.publicUrl;
  if (url) await openExternal(url);
  else showNotice("The public hotel page is not available yet.", true);
});
$("#viewPrevious").addEventListener("click", () => {
  moreDialog.close();
  if (["host", "superhost"].includes(String(state.account?.user?.role || ""))) {
    superhostInHostView = false;
    superhostPanel.openTab("operation");
    updateStatus();
  } else {
    showNotice("La gestión no está disponible para esta cuenta.", true);
  }
});
$("#playerManagement").addEventListener("click", () => {
  if (!["host", "superhost"].includes(String(state.account?.user?.role || ""))) return;
  playerPanel.close({ force: true });
  superhostInHostView = false;
  superhostPanel.openTab("operation");
  updateStatus();
});

$("#scanButton").addEventListener("click", scan);
$("#syncButton").addEventListener("click", syncRequests);
$("#settingsButton").addEventListener("click", () => {
  fillSettings();
  settingsDialog.showModal();
});
function openPreferences() {
  if (!state?.config) return;
  fillPreferences();
  if (!preferencesDialog.open) preferencesDialog.showModal();
  void storagePreferences.refresh();
}
$("#preferencesButton").addEventListener("click", openPreferences);
$("#closePreferences").addEventListener("click", () => preferencesDialog.close());
$("#preferencesAudioRefresh").addEventListener("click", () => void refreshAudioOutputs());
$("#preferencesDisplayRefresh").addEventListener("click", requestNativeDisplays);
window.addEventListener("gueststar:open-preferences", openPreferences);
window.addEventListener("gueststar:native-displays", (event) => {
  nativeDisplays = Array.isArray(event.detail?.displays) ? event.detail.displays : [];
  renderNativeDisplays();
  routeStarScreenToNativeDisplay();
});
window.addEventListener("gueststar:native-star-screen-result", (event) => {
  const result = event.detail || {};
  if (result.fallback) showNotice(result.error || "La pantalla configurada no está disponible; se usó la principal.");
  else if (result.ok) showNotice(result.reused ? "Star Screen volvió al frente." : "Star Screen abierta en la pantalla elegida.");
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
    fillPreferences();
  } catch (error) {
    showNotice(error.message, true);
  }
});
$("#settingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const selectedActivitySettings = state.config.signedIn && state.tenant?.activity
      ? activitySettingsPayload()
      : null;
    if (selectedActivitySettings?.allowedLanguages?.length === 0) {
      showNotice("Select at least one guest language for this activity.", true);
      return;
    }
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
$("#preferencesForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    const payload = preferencesPayload();
    const appliedOutput = await playerPanel.applyAudioOutput?.(payload.audioOutputDeviceId);
    if (appliedOutput?.ok === false) {
      throw new Error(appliedOutput.error || "La salida de audio seleccionada no pudo aplicarse.");
    }
    const result = await api("/api/config", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    if (result.config) state.config = result.config;
    window.webkit?.messageHandlers?.guestStarNative?.postMessage?.({
      action: "setStarScreenDisplay",
      displayId: payload.starScreenDisplayId || ""
    });
    routeStarScreenToNativeDisplay(nativeDisplays, { force: true });
    applyInterfacePreferences(payload.interfacePreferences);
    diagnostics.sync(state);
    preferencesDialog.close();
    showNotice("Preferencias guardadas.");
    await refresh();
  } catch (error) {
    showNotice(error.message, true);
  }
});
$("#testSheet").addEventListener("click", async () => {
  try {
    const data = await api("/api/apps-script/test", {
      method: "POST",
      body: JSON.stringify(preferencesPayload())
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
      body: JSON.stringify(preferencesPayload())
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
  bridgeOperations.captureFocus();
  storagePreferences.observeState(nextState);
  preserveBridgeScroll(() => {
    state = nextState;
    if (state.account?.authenticated !== true || state.account?.user?.role !== "superhost") {
      superhostInHostView = false;
    }
    bridgeI18n.setLanguage(state.config?.uiLanguage || "es");
    const versionLabel = $("#bridgeVersion");
    if (versionLabel) versionLabel.textContent = `v${state.version || "unknown"}`;
    updateStatus();
    renderVdjQueue();
    renderRequests();
    renderHitSuggestions();
    updateAuthUi();
    bridgeOperations.render();
    superhostPanel.sync(state);
    playerPanel.sync(state);
    diagnostics.sync(state);
    applyInterfacePreferences(state.config?.interfacePreferences || {});
    const activePlayerActivityId = state.account?.authenticated === true &&
      state.activity?.activityRunning === true &&
      state.operatingMode?.selected === "player"
        ? String(state.account?.current?.activityId || state.activity?.activityId || "")
        : "";
    if (activePlayerActivityId && autoRestoredPlayerActivityId !== activePlayerActivityId) {
      autoRestoredPlayerActivityId = activePlayerActivityId;
      superhostInHostView = state.account?.user?.role === "superhost";
      superhostPanel.close();
      playerPanel.open();
    } else if (
      state.activity?.activityRunning === true &&
      state.operatingMode?.selected === "bridge" &&
      autoRestoredBridgeActivityId !== String(state.account?.current?.activityId || state.activity?.activityId || "")
    ) {
      autoRestoredBridgeActivityId = String(state.account?.current?.activityId || state.activity?.activityId || "");
      superhostInHostView = state.account?.user?.role === "superhost";
      superhostPanel.close();
      playerPanel.close({ force: true });
      autoRestoredPlayerActivityId = "";
    } else if (!activePlayerActivityId) {
      autoRestoredPlayerActivityId = "";
      if (state.activity?.activityRunning !== true || state.operatingMode?.selected !== "bridge") {
        autoRestoredBridgeActivityId = "";
      }
    }
    updateStatus();
    bridgeI18n.refresh();
    // The local server can answer before its remote activity hydration ends.
    // Keep the incomplete Superhost/Host shell hidden until the selected
    // activity is resolved and the mode dialog or active mode is ready.
    const waitingForSelectedActivity = state.account?.authenticated === true &&
      Boolean(state.account?.current?.activityId) && !state.tenant?.activity;
    if (!waitingForSelectedActivity) document.body.classList.remove("app-bootstrap-pending");
  });
  bridgeOperations.restoreFocus();
}

$("#uiLanguageSelect").addEventListener("change", async (event) => {
  const language = event.target.value === "en" ? "en" : "es";
  preserveBridgeScroll(() => {
    bridgeI18n.setLanguage(language);
    storagePreferences.renderLanguage();
    updateStatus();
    renderVdjQueue();
    renderRequests();
    renderHitSuggestions();
    bridgeI18n.refresh();
  });
});

function connectRealtime() {
  const source = new EventSource("/api/events");
  let fallbackTimer;
  let closed = false;
  const clearFallback = () => {
    if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer);
    fallbackTimer = undefined;
  };
  const scheduleFallback = () => {
    if (closed || source.readyState === EventSource.OPEN || fallbackTimer !== undefined) return;
    fallbackTimer = window.setTimeout(async () => {
      fallbackTimer = undefined;
      if (closed || source.readyState === EventSource.OPEN) return;
      await refresh();
      scheduleFallback();
    }, 30000);
  };
  source.addEventListener("open", clearFallback);
  source.addEventListener("error", scheduleFallback);
  source.addEventListener("state", (event) => {
    try {
      applyState(JSON.parse(event.data));
    } catch {
      // EventSource reconnects automatically; fallback is only active offline.
    }
  });
  source.addEventListener("interface-preferences", (event) => {
    try {
      const preferences = JSON.parse(event.data);
      state.config.interfacePreferences = preferences;
      applyInterfacePreferences(preferences);
    } catch { /* A later existing state refresh restores confirmed preferences. */ }
  });
  return {
    close() {
      closed = true;
      clearFallback();
      source.close();
    }
  };
}

await refresh();
requestNativeDisplays();
const realtimeSource = connectRealtime();
window.addEventListener("beforeunload", () => realtimeSource.close());
window.addEventListener("gueststar:native-audio-result", (event) => {
  if (["nativeAudioLoad", "nativeAudioStop"].includes(event.detail?.action)) storagePreferences.changed();
});
window.addEventListener("focus", syncWhenActive);
window.addEventListener("focus", () => storagePreferences.changed());
document.addEventListener("visibilitychange", syncWhenActive);
window.setInterval(updateTimeDashboard, 1000);
