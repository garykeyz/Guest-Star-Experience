import { createDiagnosticPreferences, verifyDiagnosticIdentity, testerRoles, diagnosticError, diagnosticServiceRequest } from './diagnostic-preferences.mjs';
import { constants as fsConstants, createReadStream, existsSync, watch } from "node:fs";
import { access, mkdir, mkdtemp, open, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { basename, dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { arch, availableParallelism, freemem, homedir, loadavg, platform, release, setPriority, tmpdir, totalmem, uptime } from "node:os";
import { promisify } from "node:util";
import {
  bridgeRealtimeConnection,
  completeBridgeCommand,
  controlActivity,
  fetchBridgeQueue,
  fetchBridgeIdentity,
  fetchGoogleLoginConfig,
  hasV4Session,
  pollBridgeCommands,
  searchKaraokeYouTube,
  selectBridgeActivity,
  signInBridge,
  signInBridgeWithGoogle,
  signOutBridge,
  syncExternalVirtualDjEntries,
  updateBridgeConfig,
  updateBridgeRequest,
  v4AppsScriptAction
} from "./apps-script.mjs";
import {
  buildActivitySummary,
  requestOutcome,
  safeTransitionSeconds
} from "./activity-summary.mjs";
import { assignGuestAliases, virtualDjSingerLabel } from "./guest-alias.mjs";
import { loadConfig, publicConfig, ROOT, sanitizeConfig, saveConfig } from "./config.mjs";
import { clearBridgeSecrets } from "./keychain.mjs";
import { selectHitSuggestions } from "./hit-suggestions.mjs";
import {
  drawInfiniteRotation,
  isKnownRotationSong,
  normalizeFavoriteSongs,
  ROTATION_CATALOGS,
  rotationSongKey
} from "./random-rotation.mjs";
import { reconcileLocalAvailability } from "./local-availability.mjs";
import { findMatches, normalizeText, scanLibrary } from "./matcher.mjs";
import { queryIndexedLibrary } from "./local-library-view.mjs";
import {
  queueMetadataMatches,
  reconcileTrackedQueue,
  stabilizeVirtualDjEntries
} from "./queue-reconcile.mjs";
import { reconcileQueuePresence } from "./queue-presence.mjs";
import { loadQueueState, saveQueueState } from "./queue-state.mjs";
import { DiagnosticStore, sanitizeDiagnosticValue, technicalReportText } from "./diagnostics.mjs";
import {
  STEM_MODEL_VERSIONS,
  StemResourceController,
  demucsExecutionBudget,
  estimateTurnSeconds,
  normalizeStemEngine,
  prioritizeStemJobs,
  spleeterExecutionBudget,
  stemSourceForIntent,
  stemJobKey
} from "./stem-auto.mjs";
import {
  fingerprintStemTrack,
  gsxStemCachePaths,
  inspectStemCache
} from "./stem-cache.mjs";
import {
  GSX_DEFAULT_PROFILE,
  inspectGSXStems,
  streamGSXStem,
  writeGSXStems
} from "./gsx-stems.mjs";
import { inspectSongStorage, revealSongStorageLocation } from "./storage-usage.mjs";
import { LoudnessAnalysisStore } from "./loudness-normalization.mjs";
import { createVirtualDjOperations } from './virtualdj-operations.mjs';
import { orderRequestViews } from "./request-order.mjs";
import { isOnlineGuestRequest } from "./request-source.mjs";
import {
  buildKaraokeScript,
  executeVdj,
  insertKaraokeEntry,
  listKaraokeEntries,
  moveKaraokeEntry,
  normalizeVdjPath,
  normalizeVdjSinger,
  queryVdj,
  removeKaraokeEntry,
  vdjLocalPathCandidates,
  visibleVdjSinger
} from "./virtualdj.mjs";
import {
  copyMacClipboard,
  openMacUrl,
  selectYoutubeOptions
} from "./youtube.mjs";

const execFileAsync = promisify(execFile);
const PUBLIC_DIR = resolve(ROOT, "public");
const STEM_DATA_ROOT = process.platform === "darwin"
  ? resolve(homedir(), "Library", "Application Support", "Guest Star")
  : resolve(ROOT, "data");
const INSTALLED_STEM_ENGINE_ROOT = resolve(STEM_DATA_ROOT, "stem-engine");
const BUNDLED_STEM_ENGINE_ROOT = resolve(ROOT, "stem-engine");
// The bundled engine is the only copy built, signed and tested with this app.
// A legacy user-level copy remains a development/legacy fallback only when the
// app has no bundled engine; it must never shadow a complete current release.
const STEM_ENGINE_ROOT = existsSync(resolve(BUNDLED_STEM_ENGINE_ROOT, "package.json"))
  ? BUNDLED_STEM_ENGINE_ROOT
  : INSTALLED_STEM_ENGINE_ROOT;
const STEM_ENGINE_SOURCE = STEM_ENGINE_ROOT === BUNDLED_STEM_ENGINE_ROOT ? "bundled" : "legacy";
const STEM_ENGINE_SMOKE_SCRIPT = resolve(ROOT, "scripts", "stems-engine-smoke.mjs");
const STEM_ENGINE_VERIFICATION_PATH = resolve(STEM_DATA_ROOT, "data", "stem-engine-verification.json");
const DEMUCS_ENGINE_CLI = process.env.GUEST_STAR_DEMUCS_CLI ||
  resolve(STEM_ENGINE_ROOT, "node_modules", "demucs", "dist", "cli.js");
const stemEngineRequire = createRequire(resolve(STEM_ENGINE_ROOT, "package.json"));
const BRIDGE_VERSION = "4.5";
const BRIDGE_PROTOCOL_VERSION = "4.2.0";
const requestedPort = Number(process.env.GUEST_STAR_PORT || 0);
const WEB_BETA = process.env.GUEST_STAR_WEB_BETA === "1";
const JSON_LIMIT = 256 * 1024;
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".mp4": "video/mp4",
  ".m4v": "video/x-m4v",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".aac": "audio/aac",
  ".flac": "audio/flac"
};
const BACKGROUND_AUDIO_EXTENSIONS = new Set([".mp3", ".m4a", ".wav", ".ogg", ".aac", ".flac"]);

let diagnosticTesterFailure = "";

async function verifyDiagnosticDelivery(session) {
  const timestamp = new Date().toISOString();
  await diagnosticServiceRequest(session, "submitDiagnosticReport", {
    report: {
      reportId: `GS-DIAGNOSTIC-CHECK-${randomUUID()}`,
      automatic: false,
      deliveryProbe: true,
      createdAt: timestamp,
      firstSeenAt: timestamp,
      lastSeenAt: timestamp,
      status: "Nuevo",
      deliveryStatus: "queued",
      severity: "INFO",
      modules: ["Preferences"],
      summary: "Validación de entrega de reportes técnicos",
      description: "Comprobación autorizada al activar el envío automático.",
      userAction: "Activación de Reportes y salud técnica",
      version: BRIDGE_VERSION,
      build: bundleBuild,
      source: {},
      stack: "",
      lastError: "",
      snapshot: {},
      recentEvents: [],
      health: {}
    }
  });
}

let config = await loadConfig();
const diagnosticPreferences = await createDiagnosticPreferences({
  path: resolve(ROOT, 'data', 'diagnostic-preferences.json'),
  initial: config.diagnostics,
  getConfig: () => config,
  verify: async (session, tester) => {
    const user = await verifyDiagnosticIdentity(session, tester);
    if (!tester) await verifyDiagnosticDelivery(session);
    if (tester) diagnosticTesterFailure = "";
    if (session.authToken === config.authToken && session.deviceToken === config.deviceToken) {
      identityState = { ...identityState, authenticated: true, user };
    }
    return user;
  }
});
function diagnosticPreferencesView() {
  const saved = diagnosticPreferences.view();
  return { ...saved, testerMode: saved.testerMode && !diagnosticTesterFailure && identityState.authenticated && hasV4Session(config) && testerRoles.includes(identityState.user?.role), error: diagnosticTesterFailure };
}
async function requireDiagnosticTester() {
  if (!diagnosticPreferences.view().testerMode) throw diagnosticError('Activa primero el Modo Tester.', 'TESTER_DISABLED', 403);
  const session = config;
  try {
    await verifyDiagnosticIdentity(session, true);
    if (session.authToken !== config.authToken || session.deviceToken !== config.deviceToken) {
      throw diagnosticError('La sesión cambió durante la validación.', 'SESSION_CHANGED', 401);
    }
  } catch (error) {
    diagnosticTesterFailure = `Modo Tester no disponible: ${errorMessage(error)}`;
    broadcastState();
    throw error;
  }
}
const bundleBuild = await readFile(resolve(ROOT, ".bundle-build"), "utf8")
  .then((value) => String(value).trim().slice(0, 64))
  .catch(() => process.env.GUEST_STAR_BUILD || "development");
const diagnostics = await new DiagnosticStore({
  storagePath: resolve(ROOT, "data", "diagnostics.json"),
  version: BRIDGE_VERSION,
  build: bundleBuild
}).load();
const DIAGNOSTIC_DELIVERY_COOLDOWN_MS = 30000;
let diagnosticDeliveryInFlight = false;
let lastDiagnosticDeliveryAttemptAt = 0;
diagnostics.setHealth("Application", "OK");
diagnostics.setHealth("Local Server", "OK");
diagnostics.record({
  module: "Application / Runtime",
  severity: "INFO",
  event: "APPLICATION_START",
  summary: "Guest Star local runtime started",
  context: { version: BRIDGE_VERSION, build: bundleBuild, architecture: arch() }
}, { createIncident: false });
const runtimePort = Number.isInteger(requestedPort) && requestedPort >= 1024 && requestedPort <= 65535
  ? requestedPort
  : config.bridgePort;
let identityState = {
  user: null,
  selection: { hotels: [], venues: [], activities: [] },
  authenticated: false
};
let tenantState = {
  hotel: null,
  branding: null,
  venue: null,
  activity: null,
  kioskAccess: null,
  schedules: [],
  permissions: {},
  share: null,
  upcomingActivities: []
};
const storedQueueState = await loadQueueState();
let lastSelectedMode = storedQueueState.lastSelectedMode || "";
const persistedActiveActivityState = { ...storedQueueState.activeActivityState };
// A remembered screen/mode never proves that an activity is still active.
// Startup remains neutral until resumeRunningActivity confirms in_progress.
let operatingMode = "";
let libraryFiles = [];
let backgroundMusicFiles = [];
let backgroundMusicError = "";
const playerLocalRequests = new Map(
  storedQueueState.playerRequests.map((entry) => [entry.id, entry])
);
const playerStemJobs = new Map(
  storedQueueState.playerStemJobs.map((entry) => [entry.id, entry])
);
let playerOrder = [...storedQueueState.playerOrder];
let playerQueueVisibility = new Map(
  Object.entries(storedQueueState.playerQueueVisibility || {})
);
let playerPlayback = { ...storedQueueState.playerPlayback };
let remotePlayerRuntime = null;
let playerRuntimeDirty = false;
let stemEngineAvailable = false;
let stemFfmpegPath = "";
let stemFfprobePath = "";
let loudnessAnalysisStore = null;
let stemCapabilities = {
  spleeter: { available: false, status: "not_installed", message: "", cli: "", vocalsModel: "", accompanimentModel: "" },
  demucs: { available: false, status: "not_installed", message: "", cli: DEMUCS_ENGINE_CLI }
};
let stemEngineStatus = {
  status: "checking",
  message: "Verificando los motores IA incluidos…",
  source: STEM_ENGINE_SOURCE
};
let stemEngineVerificationFingerprint = "";
let stemEngineVerificationRunning = false;
let activeStemVerificationChild = null;
let activeStemChild = null;
let activeStemJobId = "";
let activeStemEngine = "";
let activeStemInterrupt = "";
let stemWorkerRunning = false;
let stemWorkerPaused = false;
let activeStemPlaybackLock = null;
const stemPlaybackLocks = new Map();
let playerHealthState = {
  updatedAt: "",
  karaokeActive: false,
  videoActive: false,
  audioContextState: "unknown",
  mediaState: "idle",
  audioRecovering: false,
  audioOutputLost: false,
  backgroundActive: false,
  starScreenConnected: false,
  starScreenExpected: false,
  videoFrames: 0,
  videoDroppedFrames: 0,
  videoCorruptedFrames: 0,
  videoFrameRate: 0,
  videoHardResyncs: 0,
  videoRateWrites: 0,
  videoDriftSeconds: 0,
  videoReadyState: 0,
  videoPaused: false
};
const stemResourceController = new StemResourceController();
let stemResourceState = "IDLE";
let systemMemoryFreePercent = null;
let systemMemoryPressure = false;
let systemMemoryPressureRefresh = null;
let requests = [];
let scanning = false;
let syncing = false;
let syncAgain = false;
let syncMaintenanceRunning = false;
let syncMaintenanceAgain = false;
let lastScanAt = null;
let lastSyncAt = null;
let libraryError = "";
let sheetError = "";
let vdjError = "";
let activityState = {
  accepting: true,
  activityHours: 2,
  transitionSeconds: 30,
  accumulatedSeconds: 0,
  remainingSeconds: 7200,
  activityStartedAt: "",
  activityFinishedAt: "",
  activityRunning: false,
  stateRevision: 0,
  activityId: storedQueueState.activityId || "",
  updatedAt: "",
  lastAction: "",
  lastSource: "",
  playbackMode: "",
  showStarScreenQueueCount: true
};
let queueActivityId = storedQueueState.activityId;
const queuedEntries = new Map(
  storedQueueState.entries.map((entry) => [entry.id, entry])
);
const requestFileLinks = new Map(
  storedQueueState.requestFileLinks.map((entry) => [entry.id, entry])
);
const queuedIds = new Set();
const suppressedQueueIds = new Set(storedQueueState.suppressedIds);
const outcomeRecoveries = new Map(
  storedQueueState.recoveries.map((recovery) => [recovery.id, recovery])
);
const removedExternallyIds = new Set(storedQueueState.removedIds);
const queueLocks = new Set();
const pendingInsertions = new Map();
let queuePresenceMisses = new Map();
let transientQueueMissingIds = new Set();
let externalQueueEntries = [];
const knownExternalEntries = new Map();
const externalQueueMisses = new Map();
const reconciliationDiagnostics = [];
const youtubeCache = new Map();
const youtubeSearchAt = new Map();
const youtubeSearches = new Map();
const hitYoutubeCache = new Map();
const clipboardHandledIds = new Set();
const rotationStates = new Map();
const reportedStatuses = new Map();
const reportedDuplicateIds = new Set();
const eventClients = new Set();
let bridgeFeatures = {};
let localAvailability = new Map();
let libraryWatchers = [];
let libraryWatchTimer = null;
let scanAgain = false;
let vdjQueuePositions = new Map();
let vdjQueueCheckPromise = null;
let vdjQueueHasSnapshot = false;
let vdjQueueCount = 0;
let lastVdjQueueAt = null;
let vdjQueueEntries = [];
let vdjQueueConsecutiveFailures = 0;
let vdjAvailablePaths = new Set();
let vdjRequestFilePaths = new Map();
let lastExternalSyncSignature = "";
let clipboardState = {
  requestId: "",
  url: "",
  resultType: "",
  notice: "",
  copiedAt: "",
  error: ""
};

function requireSignedInBridge() {
  if (!identityState.authenticated || !hasV4Session(config)) {
    throw new Error("Sign in to Guest Star first.");
  }
}

function effectiveRequestOutcome(item) {
  const id = String(item?.id || "").trim();
  return outcomeRecoveries.get(id)?.outcome || requestOutcome(item?.status) ||
    (operatingMode === 'bridge' && normalizeText(item?.status) === 'eliminada' ? 'removed' : '');
}

const vdjOperations = createVirtualDjOperations({
  getConfig: () => config.virtualDJ,
  enabled: () => operatingMode === 'bridge',
  changed: () => broadcastState(),
  identify: (filePath) => {
    if (vdjQueueEntries.filter(entry => normalizeVdjPath(entry.filePath) === normalizeVdjPath(filePath)).length > 1) return null;
    const matches = [...queuedEntries.values()].filter(entry => normalizeVdjPath(entry.filePath) === normalizeVdjPath(filePath));
    if (matches.length !== 1) return null;
    const item = requests.find(entry => entry.id === matches[0].id);
    if (!item || effectiveRequestOutcome(item) || suppressedQueueIds.has(item.id)) return null;
    return { id: item.id, version: Number(item.stateRevision) || 0 };
  },
  played: async event => {
    const item = requests.find(entry => entry.id === event.requestId);
    if (!item || effectiveRequestOutcome(item) || queueLocks.has(item.id)) return;
    // Old services without request revisions cannot guarantee remote manual
    // precedence: automation stays off instead of guessing.
    if (bridgeFeatures.playedCompareAndSet !== true || !Number.isInteger(item.stateRevision) || item.stateRevision <= 0) return;
    await setRequestOutcome(item.id, 'completed', { origin: 'VDJ_EVENT', version: event.version, removeVDJ: false });
  }
});

let vdjQueueOperationBusy = false;
const vdjQueueCommands = new Map();
const administrativeCommands = new Map();
const outcomeOperations = new Map();
async function runAdministrativeCommand(body, operation) {
  const id = String(body.commandId || '');
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) throw new Error('A stable command ID is required.');
  const signature = JSON.stringify(body);
  const prior = administrativeCommands.get(id);
  if (prior) {
    if (prior.signature !== signature) throw new Error('Command ID was reused.');
    return prior.promise;
  }
  if (administrativeCommands.size >= 256) administrativeCommands.delete(administrativeCommands.keys().next().value);
  const promise = Promise.resolve().then(operation);
  administrativeCommands.set(id, { signature, promise });
  promise.catch(() => {});
  return promise;
}
async function runVdjQueueOperation(body, operation) {
  const id = String(body.commandId || '');
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(id)) throw new Error('A stable command ID is required.');
  const signature = JSON.stringify(body);
  const prior = vdjQueueCommands.get(id);
  if (prior) {
    if (prior.signature !== signature) throw new Error('Command ID was reused.');
    return prior.promise;
  }
  if (vdjQueueOperationBusy || queueLocks.size) throw new Error('The queue is already being updated.');
  vdjQueueOperationBusy = true;
  if (vdjQueueCommands.size >= 256) vdjQueueCommands.delete(vdjQueueCommands.keys().next().value);
  const promise = Promise.resolve().then(operation).finally(async () => {
    vdjQueueOperationBusy = false;
    await reconcileVirtualDjQueue(true);
    broadcastState();
  });
  vdjQueueCommands.set(id, { signature, promise });
  promise.catch(() => {});
  return promise;
}

function sheetMarksOutsideVirtualDj(item) {
  const status = normalizeText(item?.status);
  return status.includes("fuera") || status.includes("retirada");
}

function requireLocalSuperhost() {
  requireSignedInBridge();
  if (identityState.user?.role !== "superhost") {
    throw new Error("Only the Superhost can use this option.");
  }
}

function requireLocalManagement() {
  requireSignedInBridge();
  if (!["host", "superhost"].includes(String(identityState.user?.role || ""))) {
    throw new Error("This account cannot manage activities.");
  }
  if (identityState.user?.role === "host") {
    const assigned = (identityState.selection?.hotels || []).some((item) =>
      String(item.hotelId || "") === String(config.lastHotelId || "")
    );
    if (!assigned) throw new Error("Select an assigned hotel before opening Host management.");
  }
}

function scopedManagementState(data = {}) {
  if (identityState.user?.role === "superhost") return { ...data, scope: "superhost" };
  const selection = identityState.selection || {};
  const hotelIds = new Set([String(config.lastHotelId || "")]);
  const venueIds = new Set((selection.venues || [])
    .filter((item) => hotelIds.has(String(item.hotelId || "")))
    .map((item) => String(item.venueId || "")));
  const activityIds = new Set((selection.activities || [])
    .filter((item) => hotelIds.has(String(item.hotelId || "")) && venueIds.has(String(item.venueId || "")))
    .map((item) => String(item.activityId || "")));
  const sourceHotels = Array.isArray(data.hotels) && data.hotels.length ? data.hotels : selection.hotels || [];
  const sourceVenues = Array.isArray(data.venues) && data.venues.length ? data.venues : selection.venues || [];
  const sourceActivities = Array.isArray(data.activities) && data.activities.length ? data.activities : selection.activities || [];
  const sourceSchedules = Array.isArray(data.schedules) && data.schedules.length ? data.schedules : tenantState.schedules || [];
  const sourceBranding = Array.isArray(data.branding) && data.branding.length
    ? data.branding
    : tenantState.branding && config.lastHotelId
      ? [{ ...tenantState.branding, hotelId: config.lastHotelId }]
      : [];
  return {
    ...data,
    scope: "host",
    permissions: tenantState.permissions || {},
    hotels: sourceHotels.filter((item) => hotelIds.has(String(item.hotelId || ""))),
    venues: sourceVenues.filter((item) => venueIds.has(String(item.venueId || ""))),
    activities: sourceActivities.filter((item) => activityIds.has(String(item.activityId || ""))),
    schedules: sourceSchedules.filter((item) =>
      hotelIds.has(String(item.hotelId || "")) &&
      venueIds.has(String(item.venueId || "")) &&
      activityIds.has(String(item.activityId || ""))
    ),
    branding: sourceBranding.filter((item) => hotelIds.has(String(item.hotelId || ""))),
    users: [], assignments: [], devices: [], auditLog: []
  };
}

function assertHostManagementScope(action, body, admin) {
  if (identityState.user?.role === "superhost") return;
  const scoped = scopedManagementState(admin);
  const permissions = tenantState.permissions || {};
  const can = (key) => permissions.all === true || permissions[key] === true;
  const scheduling = ["scheduleActivity", "updateSchedule", "cancelSchedule"].includes(action);
  if (scheduling && !can("canChangeSchedule") && !can("canScheduleNextActivity")) {
    throw new Error("This Host cannot manage schedules.");
  }
  if (action === "listReviews" && !can("canViewReviews")) {
    throw new Error("This Host cannot view reviews.");
  }
  if (action === "updateHotelBranding" && !can("canCustomizeGuestMessages") && !can("canManageHotelBranding")) {
    throw new Error("This Host cannot edit guest messages.");
  }
  const hotels = new Set((scoped.hotels || []).map((item) => String(item.hotelId || "")));
  const venues = new Set((scoped.venues || []).map((item) => String(item.venueId || "")));
  const activities = new Set((scoped.activities || []).map((item) => String(item.activityId || "")));
  const schedules = new Set((scoped.schedules || []).map((item) => String(item.scheduleId || "")));
  if (body.hotelId && !hotels.has(String(body.hotelId))) throw new Error("Hotel outside this Host's scope.");
  if (body.venueId && !venues.has(String(body.venueId))) throw new Error("Venue outside this Host's scope.");
  if (body.activityId && !activities.has(String(body.activityId))) throw new Error("Activity outside this Host's scope.");
  if (body.activityId) {
    const activity = (scoped.activities || []).find((item) => String(item.activityId || "") === String(body.activityId));
    if (body.hotelId && String(activity?.hotelId || "") !== String(body.hotelId)) {
      throw new Error("Activity does not belong to this hotel.");
    }
    if (body.venueId && String(activity?.venueId || "") !== String(body.venueId)) {
      throw new Error("Activity does not belong to this venue.");
    }
  }
  if (["updateSchedule", "cancelSchedule"].includes(action) && !schedules.has(String(body.scheduleId || ""))) {
    throw new Error("Schedule outside this Host's scope.");
  }
}

function currentHotelId() {
  const hotelId = String(config.lastHotelId || "");
  if (!hotelId) throw new Error("Select a hotel first.");
  return hotelId;
}

function favoritesForHotel(hotelId = currentHotelId()) {
  return normalizeFavoriteSongs(config.favoriteSongsByHotel?.[hotelId] || []);
}

function rotationCatalog(list) {
  if (list === "spanish") return ROTATION_CATALOGS.spanish;
  if (list === "english") return ROTATION_CATALOGS.english;
  if (list === "favorites") return favoritesForHotel();
  throw new Error("Choose Spanish, English, Favorites, or Both.");
}

function rotationItemView(item, list) {
  const match = findMatches(
    libraryFiles,
    item.song,
    item.artist,
    item.language,
    1
  )[0];
  const key = hitSuggestionKey(item);
  return {
    ...item,
    list,
    localAvailable: Boolean(match?.exact),
    trackId: match?.exact ? Buffer.from(match.filePath).toString("base64url") : "",
    filePath: match?.exact ? match.filePath : "",
    fileName: match?.exact ? match.fileName : "",
    youtube: hitYoutubeCache.get(key) || [],
    youtubeSearched: hitYoutubeCache.has(key)
  };
}

function drawRotationList(list, count) {
  const catalog = rotationCatalog(list);
  if (!catalog.length || Number(count) <= 0) return [];
  const stateKey = `${currentHotelId()}:${list}`;
  const result = drawInfiniteRotation(
    catalog,
    rotationStates.get(stateKey) || {},
    Math.min(Math.floor(Number(count) || 1), catalog.length)
  );
  rotationStates.set(stateKey, result.state);
  return result.items.map((item) => rotationItemView(item, list));
}

function drawRotation(list, count) {
  const target = Math.max(1, Math.min(12, Math.floor(Number(count) || 6)));
  if (list !== "both") return drawRotationList(list, target);
  const spanishCount = Math.ceil(target / 2);
  const englishCount = target - spanishCount;
  const spanish = drawRotationList("spanish", spanishCount);
  const english = drawRotationList("english", englishCount);
  const result = [];
  for (let index = 0; result.length < target; index++) {
    if (spanish[index]) result.push(spanish[index]);
    if (english[index]) result.push(english[index]);
  }
  return result;
}

async function updateFavorite(body = {}) {
  requireLocalSuperhost();
  const hotelId = String(body.hotelId || currentHotelId()).trim();
  if (!hotelId) throw new Error("Select a hotel first.");
  const favorites = favoritesForHotel(hotelId);
  const operation = String(body.operation || "add");
  const favoriteId = String(body.favoriteId || "");
  let next = favorites;
  if (operation === "delete") {
    next = favorites.filter((item) => item.favoriteId !== favoriteId);
  } else {
    const candidate = normalizeFavoriteSongs([{
      favoriteId: favoriteId || randomUUID(),
      song: body.song,
      artist: body.artist,
      language: body.language
    }])[0];
    if (!candidate) throw new Error("Enter the song and artist.");
    if (operation === "update") {
      if (!favoriteId || !favorites.some((item) => item.favoriteId === favoriteId)) {
        throw new Error("That favorite is no longer available.");
      }
      next = favorites.map((item) =>
        item.favoriteId === favoriteId ? candidate : item
      );
    } else if (!favorites.some((item) => rotationSongKey(item) === rotationSongKey(candidate))) {
      next = [...favorites, candidate];
    }
  }
  config = await saveConfig(sanitizeConfig({
    ...config,
    favoriteSongsByHotel: {
      ...config.favoriteSongsByHotel,
      [hotelId]: next
    }
  }, config));
  rotationStates.delete(`${hotelId}:favorites`);
  return { ok: true, favorites: favoritesForHotel(hotelId) };
}

function guestStarConfigured() {
  return Boolean(config.appsScriptUrl && hasV4Session(config));
}

function json(response, status, data) {
  const body = JSON.stringify(data);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  response.end(body);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function diagnosticSystemView() {
  const cores = availableParallelism();
  return {
    os: `${platform()} ${release()}`,
    architecture: arch(),
    logicalCores: cores,
    uptimeSeconds: Math.round(uptime()),
    processUptimeSeconds: Math.round(process.uptime()),
    memoryAvailablePercent: systemMemoryFreePercent,
    memoryPressure: systemMemoryPressure,
    loadRatio: cores > 0 ? Number((loadavg()[0] / cores).toFixed(3)) : null
  };
}

function diagnosticReference(value) {
  const normalized = String(value || "");
  return normalized
    ? createHash("sha256").update(normalized).digest("hex").slice(0, 16)
    : "";
}

function serverDiagnosticSnapshot(clientSnapshot = {}) {
  const requestViews = [
    ...requests.map(requestView),
    ...[...playerLocalRequests.values()].map(playerLocalRequestView)
  ];
  const currentId = String(playerPlayback.currentRequestId || "");
  const current = requestViews.find((item) => String(item.id) === currentId);
  return sanitizeDiagnosticValue({
    timestamp: new Date().toISOString(),
    version: BRIDGE_VERSION,
    build: bundleBuild,
    system: diagnosticSystemView(),
    currentState: {
      installationRef: diagnosticReference(config.deviceId),
      hotelRef: diagnosticReference(config.lastHotelId),
      activityRef: diagnosticReference(config.lastActivityId || activityState.activityId),
      activityRunning: activityState.activityRunning,
      mode: operatingMode,
      currentTrackRef: diagnosticReference(currentId),
      currentTime: playerPlayback.currentTimeSeconds,
      duration: Number(current?.durationSeconds) || 0,
      playing: playerPlayback.wasPlaying,
      queueLength: requestViews.filter((item) => !item.outcome).length,
      backgroundActive: playerHealthState.backgroundActive
    },
    audio: {
      ...playerHealthState,
      contextState: String(clientSnapshot?.audio?.contextState || "").slice(0, 40),
      graphConnected: clientSnapshot?.audio?.graphConnected === true,
      requestedOutput: clientSnapshot?.audio?.requestedOutput === "selected-device" ? "selected-device" : "default",
      activeOutput: clientSnapshot?.audio?.activeOutput === "selected-device" ? "selected-device" : "default",
      outputLost: clientSnapshot?.audio?.outputLost === true,
      mediaReadyState: Math.max(0, Math.min(4, Number(clientSnapshot?.audio?.mediaReadyState) || 0)),
      mediaNetworkState: Math.max(0, Math.min(3, Number(clientSnapshot?.audio?.mediaNetworkState) || 0)),
      currentTime: Math.max(0, Number(clientSnapshot?.audio?.currentTime) || 0),
      duration: Math.max(0, Number(clientSnapshot?.audio?.duration) || 0),
      backgroundReadyState: Math.max(0, Math.min(4, Number(clientSnapshot?.audio?.backgroundReadyState) || 0))
    },
    stems: {
      defaultMode: config.defaultStemEngine,
      source: ["spleeter", "demucs", "original"].includes(clientSnapshot?.stems?.source)
        ? clientSnapshot.stems.source
        : "",
      resourceState: stemResourceState,
      activeRequestRef: diagnosticReference(playerStemJobs.get(activeStemJobId)?.requestId),
      activeEngine: playerStemJobs.get(activeStemJobId)?.engine || "",
      budget: demucsExecutionBudget(availableParallelism(), stemResourceState)
    },
    activeJobs: [...playerStemJobs.values()].filter((job) =>
      ["queued", "processing"].includes(job.status)
    ).map((job) => ({
      jobId: job.jobId || job.id,
      requestRef: diagnosticReference(job.requestId || job.id),
      engine: job.engine || "demucs",
      status: job.status,
      progress: job.progress,
      phase: job.phase,
      elapsedMs: job.startedAt ? Math.max(0, Date.now() - Date.parse(job.startedAt)) : 0
    })),
    health: diagnostics.health
  });
}

function recordBackendDiagnostic(error, details = {}) {
  return diagnostics.record({
    module: details.module || "Application / Runtime",
    severity: details.severity || "ERROR",
    event: details.event || "BACKEND_ERROR",
    name: error?.name || "Error",
    message: errorMessage(error),
    summary: details.summary || errorMessage(error),
    stack: error instanceof Error ? error.stack || "" : "",
    jobId: details.jobId || "",
    engine: details.engine || "",
    elapsedMs: details.elapsedMs || 0,
    context: details.context || {}
  });
}

async function deliverDiagnosticReport(report, { force = false } = {}) {
  if (!report) throw new Error("Diagnostic report is unavailable.");
  const now = Date.now();
  if (diagnosticDeliveryInFlight ||
      (!force && now - lastDiagnosticDeliveryAttemptAt < DIAGNOSTIC_DELIVERY_COOLDOWN_MS)) {
    return false;
  }
  diagnosticDeliveryInFlight = true;
  lastDiagnosticDeliveryAttemptAt = now;
  try {
    if (!hasV4Session(config)) {
      diagnostics.updateReport(report.reportId, {
        deliveryStatus: "queued",
        deliveryError: "Guest Star is offline or not signed in."
      });
      return false;
    }
    await verifyDiagnosticIdentity(config);
    const safeReport = sanitizeDiagnosticValue({
      ...report,
      recentEvents: (report.recentEvents || []).slice(-50),
      snapshot: report.snapshot || serverDiagnosticSnapshot()
    });
    const result = await diagnosticServiceRequest(config, "submitDiagnosticReport", {
      report: safeReport
    });
    if (result?.ok === false) throw new Error(result.code || "Superhost did not accept the report.");
    diagnostics.updateReport(report.reportId, { deliveryStatus: "sent", deliveryError: "" });
    return true;
  } catch (error) {
    diagnostics.updateReport(report.reportId, {
      deliveryStatus: "queued",
      deliveryError: errorMessage(error)
    });
    return false;
  } finally {
    diagnosticDeliveryInFlight = false;
  }
}

function recordReconciliation(details = {}) {
  const entry = {
    at: new Date().toISOString(),
    requestId: String(details.requestId || ""),
    virtualDJItemId: String(details.virtualDJItemId || ""),
    confidence: Math.max(0, Number(details.confidence) || 0),
    matchFields: Array.isArray(details.matchFields)
      ? details.matchFields.map(String).slice(0, 8)
      : [],
    previousStatus: String(details.previousStatus || ""),
    newStatus: String(details.newStatus || ""),
    reason: String(details.reason || "").slice(0, 240)
  };
  reconciliationDiagnostics.push(entry);
  if (reconciliationDiagnostics.length > 100) reconciliationDiagnostics.shift();
  console.info(JSON.stringify({ event: "queue_reconciliation", ...entry }));
  return entry;
}

async function readJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > JSON_LIMIT) throw new Error("The request is too large.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("The received content is not valid JSON.");
  }
}

function localLibraryPathIndex(files) {
  const byPath = new Map();
  const byName = new Map();
  for (const filePath of files) {
    const normalizedPath = normalizeVdjPath(filePath);
    if (normalizedPath) byPath.set(normalizedPath, filePath);
    const name = normalizeText(basename(filePath));
    if (!name) continue;
    const matches = byName.get(name) || [];
    matches.push(filePath);
    byName.set(name, matches);
  }
  return { byPath, byName };
}

async function resolveVirtualDjLocalFile(entry, libraryIndex) {
  const candidates = vdjLocalPathCandidates(entry?.filePath);
  for (const candidate of candidates) {
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // VirtualDJ can return a URI, encoded path or a different Unicode form.
    }
  }
  for (const candidate of candidates) {
    const indexed = libraryIndex.byPath.get(normalizeVdjPath(candidate));
    if (indexed) return indexed;
  }
  for (const candidate of candidates) {
    const named = libraryIndex.byName.get(normalizeText(basename(candidate))) || [];
    if (named.length === 1) return named[0];
  }
  return "";
}

function playerStemJobView(id) {
  const requestId = String(id || "");
  const jobs = [...playerStemJobs.values()].filter((entry) =>
    String(entry.requestId || entry.id) === requestId
  );
  if (!jobs.length) return null;
  const latestIntentJob = [...jobs].sort((left, right) =>
    Date.parse(right.intentUpdatedAt || right.requestedAt || "") -
    Date.parse(left.intentUpdatedAt || left.requestedAt || "")
  )[0];
  const intent = normalizeStemEngine(latestIntentJob?.intent, latestIntentJob?.engine || "auto");
  const byEngine = Object.fromEntries(jobs.map((entry) => [entry.engine, entry]));
  const cache = {
    spleeter: byEngine.spleeter?.status === "ready" &&
      Boolean(byEngine.spleeter.gsxPath || (byEngine.spleeter.instrumentalPath && byEngine.spleeter.vocalsPath)),
    demucs: byEngine.demucs?.status === "ready" &&
      Boolean(byEngine.demucs.gsxPath || (byEngine.demucs.instrumentalPath && byEngine.demucs.vocalsPath))
  };
  const source = stemSourceForIntent({ intent, cache });
  const selectedJob = source === "original" ? null : byEngine[source];
  const requiredJob = intent === "auto" ? byEngine.spleeter : byEngine[intent];
  const improvementJob = intent === "auto" ? byEngine.demucs : null;
  const ready = source !== "original";
  const failed = !ready && requiredJob?.status === "failed";
  const working = requiredJob && ["queued", "processing"].includes(requiredJob.status);
  const improving = ready && improvementJob && ["queued", "processing"].includes(improvementJob.status);
  const representative = improving ? improvementJob : requiredJob || selectedJob || latestIntentJob;
  let phase = String(representative?.phase || "");
  if (intent === "auto") {
    if (source === "demucs") phase = "AUTO · Demucs listo";
    else if (source === "spleeter" && improving) {
      phase = stemResourceState === "PRESSURE"
        ? "AUTO · Mejora pausada para proteger audio"
        : "AUTO · Mejorando calidad…";
    } else if (source === "spleeter") phase = "AUTO · Spleeter listo";
    else if (!failed) phase = "AUTO · Preparando rápido…";
  }
  const lockedSource = activeStemPlaybackLock?.requestId === requestId
    ? activeStemPlaybackLock.source
    : "";
  return {
    intent,
    source,
    lockedSource,
    engine: lockedSource || source,
    format: selectedJob?.cacheFormat || "legacy",
    status: ready ? "ready" : failed ? "failed" : working ? requiredJob.status : "queued",
    progress: ready && !improving
      ? 100
      : Math.max(0, Math.min(100, Number(representative?.progress) || 0)),
    phase,
    error: String(requiredJob?.error || improvementJob?.error || ""),
    improvementError: ready ? String(improvementJob?.error || "") : "",
    ready,
    improving: Boolean(improving),
    resourceState: stemResourceState,
    estimatedTurnSeconds: Number.isFinite(Number(representative?.estimatedTurnSeconds))
      ? Number(representative.estimatedTurnSeconds)
      : null,
    etaSeconds: Math.max(0, Number(representative?.etaSeconds) || 0),
    engines: Object.fromEntries(Object.entries(byEngine).map(([engine, job]) => [engine, {
      status: job.status,
      progress: Math.max(0, Math.min(100, Number(job.progress) || 0)),
      phase: String(job.phase || ""),
      cacheHit: job.cacheHit === true,
      modelVersion: String(job.modelVersion || ""),
      actualThreads: Number.isInteger(job.actualThreads) ? job.actualThreads : null,
      resourceState: String(job.resourceState || stemResourceState),
      error: String(job.error || "")
    }])),
    updatedAt: String(representative?.updatedAt || "")
  };
}

function matchesForRequest(item, youtubeResults = youtubeCache.get(item.id) || [], limit = 3) {
  return findMatches(
    libraryFiles,
    item.song,
    item.artist,
    item.languageCode || item.language,
    limit,
    {
      youtubeResults,
      durationSeconds: item.durationSeconds
    }
  );
}

function youtubeOptionsForRequest(item, matches) {
  return (youtubeCache.get(item.id) || []).map((option) => {
    const related = findMatches(
      libraryFiles,
      item.song,
      item.artist,
      item.languageCode || item.language,
      1,
      { youtubeResults: [option], durationSeconds: option.durationSeconds || item.durationSeconds }
    )[0];
    return {
      ...option,
      cleanedMetadata: {
        song: String(item.song || "").trim(),
        artist: String(item.artist || "").trim(),
        durationSeconds: Math.max(0, Number(option.durationSeconds) || 0)
      },
      localMatch: related && related.score >= 0.62
        ? {
            filePath: related.filePath,
            fileName: related.fileName,
            confidencePercent: related.confidencePercent,
            confidenceTier: related.confidenceTier,
            reasons: related.reasons
          }
        : null
    };
  });
}

function requestView(item) {
  const matches = matchesForRequest(item);
  const top = matches[0];
  const queuedEntry = queuedEntries.get(item.id);
  const fileLink = requestFileLinks.get(item.id);
  const linkedFilePath = fileLink?.filePath || "";
  const linkedFileAvailable = Boolean(linkedFilePath && libraryFiles.some((candidate) =>
    normalizeVdjPath(candidate) === normalizeVdjPath(linkedFilePath)
  ));
  const verifiedQueuePath =
    vdjRequestFilePaths.get(item.id) || queuedEntry?.filePath || "";
  const localAvailable = Boolean(
    linkedFileAvailable ||
    top?.exact ||
    (verifiedQueuePath &&
      vdjAvailablePaths.has(normalizeVdjPath(verifiedQueuePath)))
  );
  const pendingInsertion = pendingInsertions.get(item.id) || null;
  const transientMissing = transientQueueMissingIds.has(item.id);
  const isQueued =
    !suppressedQueueIds.has(item.id) && queuedIds.has(item.id);
  const removedExternally =
    !suppressedQueueIds.has(item.id) && removedExternallyIds.has(item.id);
  const queueUnverified =
    !suppressedQueueIds.has(item.id) &&
    !removedExternally &&
    (Boolean(pendingInsertion) ||
      transientMissing ||
      (!vdjQueueHasSnapshot &&
        (queuedEntries.has(item.id) || sheetMarksVirtualDj(item))));
  const queueIndex = vdjQueuePositions.get(item.id);
  const outcome = effectiveRequestOutcome(item);
  if (outcome) {
    const recovery = outcomeRecoveries.get(item.id);
    const recoveryEntry = recovery?.entry || queuedEntry;
    return {
      ...item,
      outcome,
      queued: false,
      removedExternally: false,
      queueUnverified: false,
      localAvailable,
      manualLink: fileLink?.source === "manual",
      linkedFilePath,
      linkedFileName: linkedFilePath ? basename(linkedFilePath) : "",
      linkedFileAvailable,
      linkSource: fileLink?.source || "",
      localState: outcome,
      matches,
      queuedFilePath:
        recoveryEntry?.filePath || verifiedQueuePath || queuedEntry?.filePath || "",
      queuePosition: null,
      canUndo: true,
      outcomeMarkedAt: recovery?.markedAt || '',
      canRestoreToQueue: Boolean(recoveryEntry || localAvailable),
      undoOriginalPosition: Number.isInteger(recovery?.originalPosition)
        ? recovery.originalPosition + 1
        : null,
      youtube: youtubeOptionsForRequest(item, matches),
      youtubeSearched: youtubeCache.has(item.id),
      youtubeSearching: youtubeSearches.has(item.id),
      queueSyncState: "",
      stem: playerStemJobView(item.id),
      clipboardCopied: false
    };
  }
  return {
    ...item,
    outcome: "",
    queued: isQueued,
    removedExternally,
    queueUnverified,
    localAvailable,
    manualLink: fileLink?.source === "manual",
    linkedFilePath,
    linkedFileName: linkedFilePath ? basename(linkedFilePath) : "",
    linkedFileAvailable,
    linkSource: fileLink?.source || "",
    queueSyncState: pendingInsertion?.phase || (transientMissing ? "confirming" : ""),
    localState: pendingInsertion
      ? pendingInsertion.phase === "adding"
        ? "adding"
        : "confirming"
      : queueUnverified
      ? localAvailable
        ? "unverified"
        : "unverified-missing"
      : removedExternally
      ? localAvailable
        ? "removed"
        : "removed-missing"
      : isQueued
        ? "queued"
        : localAvailable
          ? "exact"
          : top
            ? "possible"
            : "missing",
    matches,
    queuedFilePath:
      verifiedQueuePath || (isQueued && top?.exact ? top.filePath : ""),
    queuePosition: Number.isInteger(queueIndex) ? queueIndex + 1 : null,
    youtube: youtubeOptionsForRequest(item, matches),
    youtubeSearched: youtubeCache.has(item.id),
    youtubeSearching: youtubeSearches.has(item.id),
    stem: playerStemJobView(item.id),
    clipboardCopied:
      clipboardState.requestId === item.id &&
      Boolean(clipboardState.copiedAt) &&
      !clipboardState.error
  };
}

function mediaMetadata(filePath) {
  const label = basename(filePath, extname(filePath))
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const parts = label.split(/\s+[\-–—]\s+/).map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 2) {
    return { artist: parts.shift(), song: parts.join(" - ") };
  }
  return { artist: "", song: label || "Pista local" };
}

function playerLocalRequestView(item) {
  const outcome = ["completed", "skipped", "removed"].includes(item.outcome)
    ? item.outcome
    : requestOutcome(item.status);
  return {
    ...item,
    sourceType: "player_local",
    localAvailable: true,
    localState: outcome || "exact",
    queued: false,
    queuePosition: null,
    removedExternally: false,
    queueUnverified: false,
    manualLink: true,
    outcome: outcome || "",
    matches: [{
      exact: true,
      score: 1,
      filePath: item.filePath,
      fileName: basename(item.filePath)
    }],
    queuedFilePath: item.filePath,
    canUndo: Boolean(outcome),
    canRestoreToQueue: true,
    youtube: [],
    youtubeSearched: false,
    youtubeSearching: false,
    stem: playerStemJobView(item.id),
    clipboardCopied: false
  };
}

function numberOr(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizedActivity(data = {}) {
  const source = data?.state && typeof data.state === "object" ? data.state : data;
  const activityId = String(source.activityId ?? activityState.activityId ?? "");
  const hasSuppliedStart = Object.prototype.hasOwnProperty.call(
    source,
    "activityStartedAt"
  );
  const suppliedStartedAt = String(source.activityStartedAt || "");
  const suppliedStartedAtMs = Date.parse(suppliedStartedAt);
  const sameActivity = activityId
    ? activityId === String(activityState.activityId || "")
    : !activityState.activityId;
  const savedStartedAt = sameActivity
    ? String(activityState.activityStartedAt || "")
    : "";
  const savedStartedAtMs = Date.parse(savedStartedAt);
  const activityStartedAt = hasSuppliedStart
    ? Number.isFinite(suppliedStartedAtMs)
      ? new Date(suppliedStartedAtMs).toISOString()
      : ""
    : Number.isFinite(savedStartedAtMs)
      ? new Date(savedStartedAtMs).toISOString()
      : "";
  const hasSuppliedFinish = Object.prototype.hasOwnProperty.call(
    source,
    "activityFinishedAt"
  );
  const suppliedFinishedAtMs = Date.parse(String(source.activityFinishedAt || ""));
  const savedFinishedAtMs = sameActivity
    ? Date.parse(String(activityState.activityFinishedAt || ""))
    : NaN;
  const activityFinishedAt = hasSuppliedFinish
    ? Number.isFinite(suppliedFinishedAtMs)
      ? new Date(suppliedFinishedAtMs).toISOString()
      : ""
    : Number.isFinite(savedFinishedAtMs)
      ? new Date(savedFinishedAtMs).toISOString()
      : "";
  return {
    accepting:
      source.accepting === undefined
        ? activityState.accepting
        : source.accepting !== false,
    activityHours: numberOr(source.activityHours, activityState.activityHours),
    transitionSeconds: safeTransitionSeconds(
      source.transitionSeconds,
      activityState.transitionSeconds
    ),
    accumulatedSeconds: Math.max(
      0,
      numberOr(source.accumulatedSeconds, activityState.accumulatedSeconds)
    ),
    remainingSeconds: Math.max(
      0,
      numberOr(source.remainingSeconds, activityState.remainingSeconds)
    ),
    activityStartedAt,
    activityFinishedAt,
    activityRunning:
      source.activityRunning === undefined
        ? Boolean(activityStartedAt) && !activityFinishedAt
        : source.activityRunning !== false && Boolean(activityStartedAt) && !activityFinishedAt,
    stateRevision: Math.max(
      0,
      numberOr(source.stateRevision, activityState.stateRevision)
    ),
    activityId,
    updatedAt: String(source.updatedAt ?? activityState.updatedAt ?? ""),
    lastAction: String(source.lastAction ?? activityState.lastAction ?? ""),
    lastSource: String(source.lastSource ?? activityState.lastSource ?? ""),
    playbackMode: ["player", "bridge"].includes(String(source.playbackMode || "").toLowerCase())
      ? String(source.playbackMode).toLowerCase()
      : ["player", "bridge"].includes(String(source.lastSource || "").toLowerCase())
        ? String(source.lastSource).toLowerCase()
        : sameActivity
          ? String(activityState.playbackMode || "")
          : "",
    showStarScreenQueueCount: source.showStarScreenQueueCount === undefined
      ? activityState.showStarScreenQueueCount !== false
      : source.showStarScreenQueueCount !== false
  };
}

function clearTransientCaches() {
  queueLocks.clear();
  pendingInsertions.clear();
  queuePresenceMisses = new Map();
  transientQueueMissingIds = new Set();
  externalQueueEntries = [];
  knownExternalEntries.clear();
  externalQueueMisses.clear();
  lastExternalSyncSignature = "";
  queuedIds.clear();
  youtubeCache.clear();
  youtubeSearchAt.clear();
  clipboardHandledIds.clear();
  reportedStatuses.clear();
  reportedDuplicateIds.clear();
  localAvailability.clear();
  removedExternallyIds.clear();
  vdjQueuePositions.clear();
  vdjQueueHasSnapshot = false;
  vdjQueueCount = 0;
  lastVdjQueueAt = null;
  vdjQueueEntries = [];
  vdjQueueConsecutiveFailures = 0;
  vdjAvailablePaths = new Set();
  vdjRequestFilePaths = new Map();
  clipboardState = {
    requestId: "",
    url: "",
    resultType: "",
    notice: "",
    copiedAt: "",
    error: ""
  };
}

function applyActivityState(data) {
  const wasRunning = activityState.activityRunning;
  const next = normalizedActivity(data);
  if (data?.activity?.showStarScreenQueueCount !== undefined) {
    next.showStarScreenQueueCount = data.activity.showStarScreenQueueCount !== false;
  }
  activityState = next;
  if (activityState.activityRunning) {
    const persistedMode =
      String(persistedActiveActivityState.activityId || "") === String(activityState.activityId || "")
        ? String(persistedActiveActivityState.playbackMode || "")
        : "";
    // The remote activity is authoritative. A persisted active-session mode
    // may fill an older remote record, but lastSelectedMode never may.
    operatingMode = activityState.playbackMode || persistedMode || operatingMode || "";
    activityState.playbackMode = operatingMode;
  } else if (wasRunning) {
    operatingMode = "";
  }
  if (data && typeof data === "object") {
    if (data.playerRuntime && typeof data.playerRuntime === "object" && !playerRuntimeDirty) {
      remotePlayerRuntime = data.playerRuntime;
      if (Array.isArray(data.playerRuntime.queueOrder)) {
        playerOrder = [...new Set(data.playerRuntime.queueOrder.map(String).filter(Boolean))];
      }
      if (
        data.playerRuntime.queueVisibility &&
        typeof data.playerRuntime.queueVisibility === "object" &&
        !Array.isArray(data.playerRuntime.queueVisibility)
      ) {
        playerQueueVisibility = new Map(
          Object.entries(data.playerRuntime.queueVisibility)
            .slice(0, 1000)
            .map(([id, visible]) => [String(id).trim().slice(0, 160), visible !== false])
            .filter(([id]) => id)
        );
      }
      const remotePlayback = data.playerRuntime.playback;
      if (remotePlayback && typeof remotePlayback === "object") {
        playerPlayback = {
          currentRequestId: String(remotePlayback.currentRequestId || ""),
          currentTimeSeconds: Math.max(0, Number(remotePlayback.currentTimeSeconds) || 0),
          scene: remotePlayback.scene === "karaoke" ? "karaoke" : "lobby",
          wasPlaying: remotePlayback.wasPlaying === true,
          updatedAt: String(remotePlayback.updatedAt || data.playerRuntime.updatedAt || "")
        };
      }
    }
    tenantState = {
      hotel: data.hotel || tenantState.hotel,
      branding: data.branding || tenantState.branding,
      venue: data.venue || tenantState.venue,
      activity: data.activity || tenantState.activity,
      kioskAccess: data.kioskAccess || null,
      schedules: Array.isArray(data.schedules) ? data.schedules : tenantState.schedules,
      permissions: data.permissions || tenantState.permissions || {},
      share: data.share || tenantState.share,
      upcomingActivities: Array.isArray(data.upcomingActivities)
        ? data.upcomingActivities
        : tenantState.upcomingActivities
    };
  }
}

function bridgeRequests(data = {}) {
  if (data.bridgeFeatures) bridgeFeatures = data.bridgeFeatures;
  const mapped = (Array.isArray(data.requests) ? data.requests : [])
    .map((item) => ({
      id: String(item.id || ""),
      sheetRow: Math.max(0, Math.floor(numberOr(item.sheetRow, 0))),
      timestamp: item.timestamp || "",
      singer: String(item.singer || item.name || "").trim(),
      stateRevision: Number.isInteger(Number(item.stateRevision)) ? Number(item.stateRevision) : null,
      song: String(item.song || "").trim(),
      artist: String(item.artist || "").trim(),
      comment: String(item.comment || "").trim(),
      language: String(item.language || "").trim(),
      languageCode: String(item.languageCode || "").trim(),
      sourceUrl: String(item.sourceUrl || "").trim(),
      sourceType: String(item.sourceType || "").trim(),
      playerQueuePosition: Math.max(0, Math.floor(numberOr(item.queuePosition, 0))),
      administrativePosition: Math.max(0, numberOr(item.queuePosition, 0)),
      guestIdentity: String(item.guestIdentity || "").trim(),
      guestCode: String(item.guestCode || "").trim(),
      status: String(item.status || "Pendiente"),
      fileName: String(item.fileName || "").trim(),
      durationSeconds: Math.max(0, numberOr(item.durationSeconds, 240)),
      transitionSeconds: safeTransitionSeconds(
        item.transitionSeconds,
        activityState.transitionSeconds
      ),
      updatedAt: String(item.updatedAt || "")
    }))
    .filter((item) =>
      item.id && item.singer && item.song &&
      isOnlineGuestRequest(item) &&
      (!['eliminada', 'cancelada'].includes(normalizeText(item.status)) ||
        ((operatingMode === 'bridge' || data.state?.playbackMode === 'bridge') && normalizeText(item.status) === 'eliminada'))
    );
  const canonicalByIdentity = new Map();
  return assignGuestAliases(mapped).map((item) => {
    const metadata = [normalizeText(item.song), normalizeText(item.artist)]
      .filter(Boolean)
      .sort()
      .join("|");
    const guest = item.guestIdentity
      ? `device:${item.guestIdentity}`
      : `legacy:${normalizeText(item.singer)}`;
    const key = `${guest}|${metadata}`;
    const duplicateOf = canonicalByIdentity.get(key) || "";
    if (!duplicateOf) canonicalByIdentity.set(key, item.id);
    return { ...item, duplicateOf };
  });
}

function seedKnownExternalEntries(data = {}) {
  const rows = Array.isArray(data.requests) ? data.requests : [];
  for (const item of rows) {
    if (String(item?.sourceType || "").trim().toLowerCase() !== "virtualdj_external") {
      continue;
    }
    if (sheetMarksOutsideVirtualDj(item)) continue;
    const virtualDJItemId = String(item?.virtualDJItemId || "").trim();
    if (!virtualDJItemId || knownExternalEntries.has(virtualDJItemId)) continue;
    knownExternalEntries.set(virtualDJItemId, {
      virtualDJItemId,
      filePath: String(item.fileName || "").trim(),
      singer: String(item.singer || item.name || "VirtualDJ").trim(),
      song: String(item.song || "").trim(),
      artist: String(item.artist || "").trim(),
      durationSeconds: Math.max(0, numberOr(item.durationSeconds, 0)),
      sourceType: "virtualdj_external"
    });
  }
}

function vdjSingerForRequest(item) {
  return virtualDjSingerLabel(item);
}

function queuedEntryFromRequest(item, preferredPath = "", actualEntry = null) {
  if (!item?.id || !item?.singer) return null;
  let filePath = String(actualEntry?.filePath || preferredPath || "").trim();
  if (!filePath && item.fileName) {
    const expected = String(item.fileName).trim().toLowerCase();
    const named = libraryFiles.filter(
      (candidate) => basename(candidate).trim().toLowerCase() === expected
    );
    if (named.length === 1) filePath = named[0];
  }
  if (!filePath) {
    const exact = findMatches(
      libraryFiles,
      item.song,
      item.artist,
      item.languageCode || item.language,
      1
    )[0];
    if (exact?.exact) filePath = exact.filePath;
  }
  if (!filePath) return null;
  return {
    id: item.id,
    filePath,
    singer: String(actualEntry?.singer || vdjSingerForRequest(item)).trim(),
    song: String(actualEntry?.song || item.song).trim(),
    artist: String(actualEntry?.artist || item.artist).trim(),
    durationSeconds:
      Math.max(0, Number(actualEntry?.durationSeconds) || 0) ||
      Math.max(0, Number(item.durationSeconds) || 0),
    virtualDJItemId: String(actualEntry?.virtualDJItemId || ""),
    fingerprint: String(actualEntry?.fingerprint || ""),
    manualLink: requestFileLinks.get(item.id)?.source === "manual",
    insertedAt:
      String(queuedEntries.get(item.id)?.insertedAt || "") ||
      new Date().toISOString(),
    lastSeenAt: actualEntry ? new Date().toISOString() : ""
  };
}

function trackingEntryFromRequest(item) {
  return queuedEntries.get(item.id) || queuedEntryFromRequest(item) || {
    id: item.id,
    filePath: "",
    singer: vdjSingerForRequest(item),
    song: item.song,
    artist: item.artist,
    durationSeconds: Math.max(0, Number(item.durationSeconds) || 0),
    virtualDJItemId: "",
    fingerprint: "",
    insertedAt: "",
    lastSeenAt: ""
  };
}

async function persistQueuedEntries(activityId = activityState.activityId) {
  queueActivityId = String(activityId || queueActivityId || "");
  await saveQueueState(
    queueActivityId,
    queuedEntries.values(),
    suppressedQueueIds.values(),
    outcomeRecoveries.values(),
    activityState.activityStartedAt,
    removedExternallyIds.values(),
    operatingMode,
    playerLocalRequests.values(),
    playerOrder,
    playerPlayback,
    playerStemJobs.values(),
    Object.fromEntries(playerQueueVisibility),
    requestFileLinks.values(),
    lastSelectedMode,
    activityState.activityRunning && operatingMode
      ? {
          activityId: activityState.activityId,
          activityStartedAt: activityState.activityStartedAt,
          playbackMode: operatingMode
        }
      : {}
  );
}

function cleanPlayerRuntimeUpdate(body = {}) {
  const requestedOrder = Array.isArray(body.queueOrder)
    ? [...new Set(body.queueOrder.map((id) => String(id || "").trim()).filter(Boolean))].slice(0, 1000)
    : null;
  const sourcePlayback = body.playback && typeof body.playback === "object"
    ? body.playback
    : null;
  const currentTimeSeconds = Number(sourcePlayback?.currentTimeSeconds);
  const queueVisibility = body.queueVisibility &&
    typeof body.queueVisibility === "object" &&
    !Array.isArray(body.queueVisibility)
    ? Object.fromEntries(
        Object.entries(body.queueVisibility).slice(0, 1000)
          .map(([id, visible]) => [String(id || "").trim().slice(0, 160), visible !== false])
          .filter(([id]) => id)
      )
    : null;
  return {
    queueOrder: requestedOrder,
    queueVisibility,
    playback: sourcePlayback ? {
      currentRequestId: String(sourcePlayback.currentRequestId || "").trim().slice(0, 160),
      currentTimeSeconds: Number.isFinite(currentTimeSeconds)
        ? Math.max(0, Math.min(12 * 60 * 60, currentTimeSeconds))
        : 0,
      scene: sourcePlayback.scene === "karaoke" ? "karaoke" : "lobby",
      wasPlaying: sourcePlayback.wasPlaying === true,
      updatedAt: new Date().toISOString()
    } : null
  };
}

async function pushPlayerRuntimeRemote() {
  if (
    !playerRuntimeDirty ||
    !hasV4Session(config) ||
    !config.lastActivityId ||
    operatingMode !== "player"
  ) return false;
  const data = await v4AppsScriptAction(config, "playerRuntimeUpdate", {
    hotelId: config.lastHotelId,
    venueId: config.lastVenueId,
    activityId: config.lastActivityId,
    source: "player",
    queueOrder: playerOrder,
    queueVisibility: Object.fromEntries(playerQueueVisibility),
    playback: playerPlayback
  });
  if (data?.ok === false) throw new Error(data.code || "Guest Star could not save Player state.");
  if (data?.playerRuntime) remotePlayerRuntime = data.playerRuntime;
  playerRuntimeDirty = false;
  return true;
}

async function updatePlayerRuntime(body = {}) {
  if (operatingMode !== "player" || !config.lastActivityId || !tenantState.activity) {
    throw new Error("Player state can only change after selecting an activity in Player mode.");
  }
  const clean = cleanPlayerRuntimeUpdate(body);
  if (clean.queueOrder) playerOrder = clean.queueOrder;
  if (clean.queueVisibility) playerQueueVisibility = new Map(Object.entries(clean.queueVisibility));
  if (clean.playback) {
    const previousPlayback = playerPlayback;
    playerPlayback = clean.playback;
    if (
      previousPlayback.currentRequestId !== clean.playback.currentRequestId ||
      clean.playback.scene !== "karaoke"
    ) {
      activeStemPlaybackLock = null;
    }
    if (clean.playback.scene === "karaoke" && clean.playback.currentRequestId) {
      lockStemSourceForPlayback(clean.playback.currentRequestId, "runtime");
    }
    updateStemResourceState();
  }
  playerRuntimeDirty = true;
  await persistQueuedEntries();
  broadcastState();
  try {
    await pushPlayerRuntimeRemote();
    return { ok: true, remoteSaved: true, playerRuntime: stateView().playerRuntime };
  } catch (error) {
    sheetError = errorMessage(error);
    return {
      ok: true,
      remoteSaved: false,
      warning: "The Player remains safe locally and will retry cloud persistence.",
      playerRuntime: stateView().playerRuntime
    };
  }
}

async function resetLocalActivity(activityId) {
  requests = [];
  queuedEntries.clear();
  requestFileLinks.clear();
  queuedIds.clear();
  suppressedQueueIds.clear();
  removedExternallyIds.clear();
  outcomeRecoveries.clear();
  playerLocalRequests.clear();
  playerStemJobs.clear();
  playerOrder = [];
  playerQueueVisibility.clear();
  activeStemPlaybackLock = null;
  stemPlaybackLocks.clear();
  playerPlayback = {
    currentRequestId: "",
    currentTimeSeconds: 0,
    scene: "lobby",
    wasPlaying: false,
    updatedAt: new Date().toISOString()
  };
  remotePlayerRuntime = null;
  playerRuntimeDirty = false;
  pendingInsertions.clear();
  queuePresenceMisses = new Map();
  transientQueueMissingIds = new Set();
  vdjQueuePositions.clear();
  clearTransientCaches();
  await persistQueuedEntries(activityId);
}

async function reconcileDeletedRequests(
  nextRequests,
  nextActivity,
  { removeFromVirtualDJ = false } = {}
) {
  const activeIds = new Set(nextRequests.map((item) => item.id));
  const previousById = new Map(requests.map((item) => [item.id, item]));
  const trackedIds = new Set([...queuedIds, ...queuedEntries.keys()]);
  const activityChanged = Boolean(
    queueActivityId &&
    nextActivity.activityId &&
    queueActivityId !== nextActivity.activityId
  );
  if (activityChanged) {
    operatingMode = "";
    playerLocalRequests.clear();
    playerStemJobs.clear();
  }
  const shouldDiscardMissing = removeFromVirtualDJ || activityChanged;
  let changed = false;

  if (shouldDiscardMissing) {
    for (const id of [...suppressedQueueIds]) {
      if (!activityChanged && activeIds.has(id)) continue;
      suppressedQueueIds.delete(id);
      changed = true;
    }
    for (const id of [...removedExternallyIds]) {
      if (!activityChanged && activeIds.has(id)) continue;
      removedExternallyIds.delete(id);
      vdjQueuePositions.delete(id);
      changed = true;
    }
    for (const id of [...outcomeRecoveries.keys()]) {
      if (!activityChanged && activeIds.has(id)) continue;
      outcomeRecoveries.delete(id);
      changed = true;
    }
  }
  for (const id of [...youtubeCache.keys()]) {
    if (activeIds.has(id)) continue;
    youtubeCache.delete(id);
    youtubeSearchAt.delete(id);
    clipboardHandledIds.delete(id);
    reportedStatuses.delete(id);
  }
  for (const id of [...youtubeSearchAt.keys()]) {
    if (!activeIds.has(id)) youtubeSearchAt.delete(id);
  }
  for (const id of [...requestFileLinks.keys()]) {
    if (!activityChanged && activeIds.has(id)) continue;
    if (!shouldDiscardMissing) continue;
    requestFileLinks.delete(id);
    changed = true;
  }

  for (const id of trackedIds) {
    if (!activityChanged && activeIds.has(id)) continue;
    if (!shouldDiscardMissing) {
      recordReconciliation({
        requestId: id,
        virtualDJItemId: queuedEntries.get(id)?.virtualDJItemId,
        previousStatus: previousById.get(id)?.status,
        newStatus: "locally_preserved",
        reason: "request_temporarily_missing_from_sync"
      });
      continue;
    }
    const entry =
      queuedEntries.get(id) || queuedEntryFromRequest(previousById.get(id));
    if (!entry) {
      queuedIds.delete(id);
      queuedEntries.delete(id);
      removedExternallyIds.delete(id);
      vdjQueuePositions.delete(id);
      changed = true;
      continue;
    }
    if (removeFromVirtualDJ) {
      try {
        const result = await removeKaraokeEntry(config.virtualDJ, entry);
        if (result.reason === "ambiguous") {
          throw new Error(
            `VirtualDJ has more than one copy of “${entry.song}” for ${entry.singer}; none were removed.`
          );
        }
        vdjError = "";
      } catch (error) {
        vdjError =
          `The queue was archived, but one track could not be removed from VirtualDJ: ${errorMessage(error)}`;
      }
    } else {
      recordReconciliation({
        requestId: id,
        virtualDJItemId: entry.virtualDJItemId,
        previousStatus: previousById.get(id)?.status,
        newStatus: "virtualdj_external",
        reason: "request_missing_from_sheet_kept_in_virtualdj"
      });
    }
    queuedIds.delete(id);
    queuedEntries.delete(id);
    youtubeCache.delete(id);
    youtubeSearchAt.delete(id);
    clipboardHandledIds.delete(id);
    reportedStatuses.delete(id);
    removedExternallyIds.delete(id);
    vdjQueuePositions.delete(id);
    queuePresenceMisses.delete(id);
    pendingInsertions.delete(id);
    changed = true;
  }

  if (
    changed ||
    (nextActivity.activityId && nextActivity.activityId !== queueActivityId)
  ) {
    await persistQueuedEntries(nextActivity.activityId);
  }
}

async function reconcileTerminalRequests(nextRequests) {
  let changed = false;
  for (const item of nextRequests) {
    const outcome = effectiveRequestOutcome(item);
    if (!outcome) continue;
    const id = item.id;
    const existingRecovery = outcomeRecoveries.get(id);
    const entry = queuedEntries.get(id) || queuedEntryFromRequest(item);
    let originalPosition = vdjQueuePositions.get(id);
    // A passive cloud/sheet refresh may update the request state, but it must
    // never issue a destructive VirtualDJ command. Physical removal is limited
    // to an explicit operator action or an explicit activity archive/reset.
    if (!existingRecovery) {
      outcomeRecoveries.set(id, {
        id,
        outcome,
        previousStatus: entry ? "Agregada a VirtualDJ" : "Pendiente",
        originalPosition: Number.isInteger(originalPosition)
          ? originalPosition
          : null,
        markedAt: new Date().toISOString(),
        entry: entry || null
      });
      changed = true;
    }
    const hadPosition = vdjQueuePositions.has(id);
    const removedQueued = queuedIds.delete(id);
    const removedEntry = queuedEntries.delete(id);
    const removedExternally = removedExternallyIds.delete(id);
    const localChanged =
      removedQueued ||
      removedEntry ||
      removedExternally ||
      hadPosition ||
      !suppressedQueueIds.has(id);
    if (hadPosition) removeQueuePosition(id);
    if (localChanged) changed = true;
    suppressedQueueIds.add(id);
  }
  if (changed) await persistQueuedEntries();
}

function sheetMarksVirtualDj(item) {
  const status = normalizeText(item?.status);
  if (!status || status.includes("fuera") || status.includes("retirada")) {
    return false;
  }
  return (
    status.includes("agregada a virtualdj") ||
    status.includes("reagregada a virtualdj") ||
    status.includes("reenviada a virtualdj") ||
    status === "en virtualdj"
  );
}

function actualQueueEntryFromRequest(item, actualEntries, claimedIndices) {
  const targetSingers = new Set([
    vdjSingerForRequest(item),
    String(item?.singer || "").trim(),
    item?.guestCode
      ? `${String(item?.singer || "").trim()} · ${String(item.guestCode).trim()}`
      : ""
  ].filter(Boolean).map((value) => normalizeText(normalizeVdjSinger(value))));
  const candidates = actualEntries.filter(
    (entry) =>
      !claimedIndices.has(entry.index) &&
      (
        targetSingers.has(normalizeText(normalizeVdjSinger(entry.singer))) ||
        targetSingers.has(
          normalizeText(normalizeVdjSinger(visibleVdjSinger(entry.singer)))
        )
      )
  );
  if (!candidates.length) return null;

  const expectedName = String(item.fileName || "").trim().toLowerCase();
  if (expectedName) {
    const named = candidates.filter(
      (entry) =>
        entry.filePath &&
        basename(entry.filePath).trim().toLowerCase() === expectedName
    );
    if (named.length === 1) return named[0];
  }

  const metadataMatches = candidates.filter((entry) =>
    queueMetadataMatches(item, entry)
  );
  if (metadataMatches.length === 1) return metadataMatches[0];

  const searchablePaths = candidates.map((entry) =>
    entry.filePath || [entry.artist, entry.song].filter(Boolean).join(" - ")
  );
  const top = findMatches(
    searchablePaths,
    item.song,
    item.artist,
    item.languageCode || item.language,
    1
  )[0];
  if (!top?.exact) return null;
  const matchIndex = searchablePaths.indexOf(top.filePath);
  return matchIndex >= 0 ? candidates[matchIndex] : null;
}

async function reconcileVirtualDjQueue(force = false) {
  if (operatingMode !== "bridge") return;
  if (vdjQueueOperationBusy) return;
  if (vdjQueueCheckPromise) return vdjQueueCheckPromise;
  if (queueLocks.size) return;

  vdjQueueCheckPromise = (async () => {
    broadcastState();
    try {
      // Every physical row in VirtualDJ is authoritative. Never remove a row
      // merely because its singer and metadata look like another row.
      const rawActualEntries = await listKaraokeEntries(config.virtualDJ);
      const actualEntries = stabilizeVirtualDjEntries(
        rawActualEntries,
        vdjQueueEntries
      );
      const libraryIndex = localLibraryPathIndex(libraryFiles);
      const inspectedEntries = await Promise.all(
        actualEntries.map(async (entry) => {
          const reportedFilePath = entry.filePath || "";
          const resolvedFilePath = await resolveVirtualDjLocalFile(
            entry,
            libraryIndex
          );
          return {
            ...entry,
            reportedFilePath,
            filePath: resolvedFilePath || reportedFilePath,
            localAvailable: Boolean(resolvedFilePath),
            availableInVirtualDJ: true
          };
        })
      );
      vdjQueueEntries = inspectedEntries;
      vdjAvailablePaths = new Set(
        inspectedEntries
          .filter((entry) => entry.localAvailable && entry.filePath)
          .map((entry) => normalizeVdjPath(entry.filePath))
      );
      const trackedById = new Map();
      for (const entry of queuedEntries.values()) {
        const item = requests.find((request) => request.id === entry.id);
        if (
          !suppressedQueueIds.has(entry.id) &&
          !effectiveRequestOutcome(item || { id: entry.id, status: "" })
        ) {
          trackedById.set(entry.id, {
            ...entry,
            // Old inferred matches may have copied the physical VDJ singer
            // into local state. Always reconcile a non-manual link against
            // the singer who actually submitted the request.
            expectedSinger: item ? vdjSingerForRequest(item) : entry.singer,
            queuePosition: vdjQueuePositions.get(entry.id)
          });
        }
      }
      for (const item of requests) {
        if (
          effectiveRequestOutcome(item) ||
          !sheetMarksVirtualDj(item) ||
          suppressedQueueIds.has(item.id) ||
          trackedById.has(item.id)
        ) {
          continue;
        }
        trackedById.set(item.id, {
          ...trackingEntryFromRequest(item),
          expectedSinger: vdjSingerForRequest(item),
          queuePosition: vdjQueuePositions.get(item.id)
        });
      }
      const tracked = [...trackedById.values()];
      const reconciliation = reconcileTrackedQueue(
        tracked,
        inspectedEntries.map((entry) => ({
          ...entry,
          knownExternal: knownExternalEntries.has(entry.virtualDJItemId)
        }))
      );
      const presence = reconcileQueuePresence({
        previous: queuePresenceMisses,
        trackedIds: tracked.map((entry) => entry.id),
        matchedIds: new Set(reconciliation.matched.keys()),
        pendingInsertions,
        now: Date.now()
      });
      queuePresenceMisses = presence.next;
      transientQueueMissingIds = new Set(presence.transientMissing);
      const confirmedMissing = new Set(presence.confirmedMissing);
      const nextPositions = new Map();
      const nextRequestFilePaths = new Map();
      const newlyMissing = [];
      const restored = [];
      const durationUpdates = new Set();
      let adopted = false;

      for (const entry of tracked) {
        const item = requests.find((request) => request.id === entry.id);
        const actual = reconciliation.matched.get(entry.id);
        if (actual) {
          const previousStatus = item?.status || "";
          const linkedEntry = {
            ...entry,
            filePath: actual.filePath || entry.filePath,
            singer: entry.manualLink
              ? actual.singer || entry.singer
              : vdjSingerForRequest(item) || entry.singer,
            song: entry.manualLink
              ? actual.song || entry.song
              : item?.song || actual.song || entry.song,
            artist: entry.manualLink
              ? actual.artist || entry.artist
              : item?.artist || actual.artist || entry.artist,
            durationSeconds:
              Math.max(0, Number(actual.durationSeconds) || 0) ||
              Math.max(0, Number(item?.durationSeconds) || 0),
            virtualDJItemId: actual.virtualDJItemId,
            fingerprint: actual.fingerprint,
            insertedAt: entry.insertedAt || new Date().toISOString(),
            lastSeenAt: new Date().toISOString()
          };
          queuedEntries.set(entry.id, linkedEntry);
          adopted = true;
          queuedIds.add(entry.id);
          pendingInsertions.delete(entry.id);
          nextPositions.set(entry.id, actual.index);
          if (actual.filePath) nextRequestFilePaths.set(entry.id, actual.filePath);
          const matchDetail = reconciliation.matchDetails.get(entry.id) || {};
          recordReconciliation({
            requestId: entry.id,
            virtualDJItemId: actual.virtualDJItemId,
            confidence: matchDetail.confidence,
            matchFields: matchDetail.fields,
            previousStatus,
            newStatus: "In VirtualDJ",
            reason: "matched_real_virtualdj_queue"
          });
          if (
            Number(actual.durationSeconds) > 0 &&
            Math.abs(
              Number(item?.durationSeconds || 0) -
              Number(actual.durationSeconds)
            ) >= 1
          ) {
            item.durationSeconds = Number(actual.durationSeconds);
            durationUpdates.add(entry.id);
          }
          if (
            removedExternallyIds.delete(entry.id) ||
            (item && !sheetMarksVirtualDj(item))
          ) {
            restored.push(entry.id);
          }
          continue;
        }
        if (!confirmedMissing.has(entry.id)) {
          if (queuedIds.has(entry.id) || sheetMarksVirtualDj(item)) {
            queuedIds.add(entry.id);
          }
          const previousPosition = vdjQueuePositions.get(entry.id);
          if (Number.isInteger(previousPosition)) {
            nextPositions.set(entry.id, previousPosition);
          }
          const previousPath =
            vdjRequestFilePaths.get(entry.id) || entry.filePath || "";
          if (previousPath) nextRequestFilePaths.set(entry.id, previousPath);
          recordReconciliation({
            requestId: entry.id,
            virtualDJItemId: entry.virtualDJItemId,
            previousStatus: item?.status,
            newStatus: "Confirming in VirtualDJ",
            reason: pendingInsertions.has(entry.id)
              ? "insertion_grace_window"
              : "temporary_missing_scan"
          });
          continue;
        }
        queuedIds.delete(entry.id);
        pendingInsertions.delete(entry.id);
        if (!removedExternallyIds.has(entry.id) || item?.status !== "Fuera de VirtualDJ") {
          newlyMissing.push(entry.id);
        }
        removedExternallyIds.add(entry.id);
        recordReconciliation({
          requestId: entry.id,
          virtualDJItemId: entry.virtualDJItemId,
          previousStatus: item?.status,
          newStatus: "Removed from VirtualDJ",
          reason: "missing_in_multiple_consecutive_scans"
        });
      }

      vdjQueuePositions = nextPositions;
      vdjRequestFilePaths = nextRequestFilePaths;
      vdjQueueHasSnapshot = true;
      vdjQueueCount = inspectedEntries.length;
      const linkedByIndex = new Map();
      for (const [requestId, actual] of reconciliation.matched) {
        linkedByIndex.set(actual.index, requestId);
      }
      vdjQueueEntries = inspectedEntries.map((entry) => ({
        ...entry,
        linkedRequestId: linkedByIndex.get(entry.index) || "",
        sourceType: linkedByIndex.has(entry.index)
          ? "public_request"
          : "virtualdj_external"
      }));
      externalQueueEntries = vdjQueueEntries.filter(
        (entry) => entry.sourceType === "virtualdj_external"
      );
      const currentExternalIds = new Set(
        externalQueueEntries.map((entry) => entry.virtualDJItemId)
      );
      externalQueueEntries.forEach((entry) => {
        knownExternalEntries.set(entry.virtualDJItemId, entry);
        externalQueueMisses.set(entry.virtualDJItemId, 0);
      });
      const confirmedMissingExternalIds = [];
      for (const [virtualDJItemId] of knownExternalEntries) {
        if (currentExternalIds.has(virtualDJItemId)) continue;
        const misses = (externalQueueMisses.get(virtualDJItemId) || 0) + 1;
        externalQueueMisses.set(virtualDJItemId, misses);
        if (misses >= 3) {
          confirmedMissingExternalIds.push(virtualDJItemId);
          knownExternalEntries.delete(virtualDJItemId);
          externalQueueMisses.delete(virtualDJItemId);
        }
      }
      lastVdjQueueAt = new Date().toISOString();
      vdjQueueConsecutiveFailures = 0;
      vdjError = "";
      if (adopted || newlyMissing.length || restored.length) {
        await persistQueuedEntries();
      }
      broadcastState();

      for (const id of newlyMissing) {
        const item = requests.find((entry) => entry.id === id);
        if (!item) continue;
        item.status = "Fuera de VirtualDJ";
        try {
          await updateBridgeRequest(
            config,
            id,
            item.status,
            basename(queuedEntries.get(id)?.filePath || item.fileName || ""),
            {
              durationSeconds: item.durationSeconds,
              virtualDJItemId: queuedEntries.get(id)?.virtualDJItemId || "",
              syncState: "confirmed_missing"
            }
          );
        } catch {
          // La tarjeta local conserva la pregunta y la hoja se reintentará después.
        }
      }
      for (const id of restored) {
        const item = requests.find((entry) => entry.id === id);
        if (!item) continue;
        item.status = "Agregada a VirtualDJ";
        try {
          await updateBridgeRequest(
            config,
            id,
            item.status,
            basename(queuedEntries.get(id)?.filePath || item.fileName || ""),
            {
              durationSeconds: item.durationSeconds,
              virtualDJItemId: queuedEntries.get(id)?.virtualDJItemId || "",
              queuePosition: vdjQueuePositions.get(id),
              syncState: "confirmed",
              lastSeenAt: new Date().toISOString()
            }
          );
        } catch {
          // La cola real de VirtualDJ sigue siendo la fuente de verdad.
        }
      }
      for (const id of durationUpdates) {
        if (newlyMissing.includes(id) || restored.includes(id)) continue;
        const item = requests.find((entry) => entry.id === id);
        if (!item) continue;
        try {
          await updateBridgeRequest(
            config,
            id,
            item.status,
            basename(queuedEntries.get(id)?.filePath || item.fileName || ""),
            {
              durationSeconds: item.durationSeconds,
              virtualDJItemId: queuedEntries.get(id)?.virtualDJItemId || "",
              queuePosition: vdjQueuePositions.get(id),
              syncState: "confirmed",
              lastSeenAt: new Date().toISOString()
            }
          );
        } catch {
          // La duración exacta local permanece visible y se reintentará.
        }
      }
      if (hasV4Session(config)) {
        const externalEntriesPayload = externalQueueEntries.map((entry) => ({
          virtualDJItemId: entry.virtualDJItemId,
          index: entry.index,
          filePath: entry.filePath,
          singer: entry.singer,
          song: entry.song,
          artist: entry.artist,
          durationSeconds: entry.durationSeconds,
          sourceType: "virtualdj_external"
        }));
        const externalSyncSignature = JSON.stringify({
          activityId: activityState.activityId,
          entries: externalEntriesPayload,
          confirmedMissingIds: [...confirmedMissingExternalIds].sort()
        });
        try {
          if (externalSyncSignature !== lastExternalSyncSignature) {
            await syncExternalVirtualDjEntries(
              config,
              externalEntriesPayload,
              confirmedMissingExternalIds
            );
            lastExternalSyncSignature = externalSyncSignature;
          }
        } catch {
          // The real VirtualDJ queue remains authoritative; retry on the next scan.
        }
      }
    } catch (error) {
      vdjQueueConsecutiveFailures += 1;
      if (!vdjQueueHasSnapshot || vdjQueueConsecutiveFailures >= 3) {
        vdjError = `The Karaoke queue could not be checked: ${errorMessage(error)}`;
      }
    }
  })();

  try {
    await vdjQueueCheckPromise;
  } finally {
    vdjQueueCheckPromise = null;
    broadcastState();
  }
}

function stateView() {
  const requestViews = orderRequestViews([
    ...requests.map(requestView),
    ...[...playerLocalRequests.values()].map(playerLocalRequestView)
  ]);
  const activePlayerIds = requestViews
    .filter((item) =>
      !item.outcome &&
      !["Ya cantó", "Saltado", "Retirada del Player"].includes(String(item.status || ""))
    )
    .sort((left, right) => {
      const leftPosition = Number(left.playerQueuePosition) || Number.MAX_SAFE_INTEGER;
      const rightPosition = Number(right.playerQueuePosition) || Number.MAX_SAFE_INTEGER;
      return leftPosition - rightPosition;
    })
    .map((item) => String(item.id));
  playerOrder = [
    ...playerOrder.filter((id) => activePlayerIds.includes(id)),
    ...activePlayerIds.filter((id) => !playerOrder.includes(id))
  ];
  const requestsByQueuePosition = new Map(
    requestViews
      .filter((item) => Number.isInteger(item.queuePosition))
      .map((item) => [item.queuePosition, item])
  );
  const verifiedQueue = vdjQueueHasSnapshot
    ? vdjQueueEntries.map((entry) => {
        const request = requestsByQueuePosition.get(entry.index + 1);
        return {
          durationSeconds:
            Number(entry.durationSeconds) > 0
              ? Number(entry.durationSeconds)
              : Number(request?.durationSeconds) || 240,
          transitionSeconds: safeTransitionSeconds(
            request?.transitionSeconds,
            activityState.transitionSeconds
          )
        };
      })
    : null;
  const activitySummary = buildActivitySummary(
    activityState,
    requestViews,
    Date.now(),
    verifiedQueue,
    { currentPlayback: playerPlayback }
  );
  if (vdjQueueCount > 0) activitySummary.suggestHits = false;
  const hitSuggestions = activitySummary.suggestHits
    ? selectHitSuggestions(requests, libraryFiles, activityState.activityId, 6)
        .map((item) => {
          const key = hitSuggestionKey(item);
          return {
            ...item,
            trackId: item.filePath ? Buffer.from(item.filePath).toString("base64url") : "",
            youtube: hitYoutubeCache.get(key) || [],
            youtubeSearched: hitYoutubeCache.has(key)
          };
        })
    : [];
  return {
    ok: true,
    version: BRIDGE_VERSION,
    build: bundleBuild,
    config: { ...publicConfig(config), diagnostics: diagnosticPreferencesView() },
    account: {
      authenticated: identityState.authenticated && hasV4Session(config),
      user: identityState.user,
      selection: identityState.selection,
      current: {
        hotelId: config.lastHotelId,
        venueId: config.lastVenueId,
        activityId: config.lastActivityId
      }
    },
    tenant: tenantState,
    activity: activityState,
    operatingMode: {
      selected: operatingMode,
      lastSelected: lastSelectedMode,
      // Auto Start may create a real running occurrence before this Mac has
      // chosen its renderer. The first selection completes recovery; once a
      // mode exists it remains locked until the occurrence finishes.
      locked: Boolean(activityState.activityRunning && operatingMode),
      canChange: !activityState.activityRunning || !operatingMode
    },
    playerRuntime: {
      ...(remotePlayerRuntime && typeof remotePlayerRuntime === "object"
        ? remotePlayerRuntime
        : {}),
      queueOrder: [...playerOrder],
      queueVisibility: Object.fromEntries(playerQueueVisibility),
      playback: { ...playerPlayback }
    },
    stemEngine: {
      available: stemEngineAvailable,
      status: stemEngineStatus.status,
      message: stemEngineStatus.message,
      source: stemEngineStatus.source,
      defaultEngine: normalizeStemEngine(config.defaultStemEngine, "auto"),
      engines: {
        spleeter: {
          available: stemCapabilities.spleeter.available,
          status: stemCapabilities.spleeter.status,
          message: stemCapabilities.spleeter.message,
          modelVersion: STEM_MODEL_VERSIONS.spleeter,
          actualThreads: spleeterExecutionBudget(availableParallelism(), stemResourceState).numThreads
        },
        demucs: {
          available: stemCapabilities.demucs.available,
          status: stemCapabilities.demucs.status,
          message: stemCapabilities.demucs.message,
          modelVersion: STEM_MODEL_VERSIONS.demucs,
          maxHeavyJobs: 1,
          internalThreads: null
        }
      },
      resourceState: stemResourceState,
      resourceBudget: {
        spleeter: spleeterExecutionBudget(availableParallelism(), stemResourceState),
        demucs: demucsExecutionBudget(availableParallelism(), stemResourceState)
      },
      processing: Boolean(activeStemJobId),
      pausedForLivePlayback: stemWorkerPaused,
      activeRequestId: playerStemJobs.get(activeStemJobId)?.requestId || "",
      activeJobId: activeStemJobId,
      activeEngine: activeStemEngine,
      jobs: [...new Set([...playerStemJobs.values()].map((job) => job.requestId))]
        .map((id) => ({ id, ...playerStemJobView(id) }))
    },
    diagnostics: {
      sessionDiagnosticId: diagnostics.sessionDiagnosticId,
      health: diagnostics.health,
      recentErrors: diagnostics.events.filter((event) =>
        ["WARNING", "ERROR", "CRITICAL", "RECOVERED"].includes(event.severity)
      ).slice(-8).reverse()
    },
    activitySummary,
    library: {
      count: libraryFiles.length,
      lastScanAt,
      scanning,
      realtime: libraryWatchers.length > 0,
      error: libraryError
    },
    backgroundMusic: {
      count: backgroundMusicFiles.length,
      error: backgroundMusicError,
      sources: [...config.backgroundMusicSources],
      volume: config.backgroundMusicVolume,
      tracks: backgroundMusicFiles.slice(0, 1000).map((filePath) => ({
        id: Buffer.from(filePath).toString("base64url"),
        ...mediaMetadata(filePath),
        name: basename(filePath, extname(filePath)),
        extension: extname(filePath).replace(/^\./, "").toUpperCase(),
        mediaType: MIME[extname(filePath).toLowerCase()] || "application/octet-stream"
      }))
    },
    sheet: {
      lastSyncAt,
      syncing,
      error: sheetError
    },
    virtualDJ: {
      playback: vdjOperations.view(),
      error: vdjError,
      queueCount: vdjQueueCount,
      lastQueueCheckAt: lastVdjQueueAt,
      queueVerified: vdjQueueHasSnapshot,
      checkingQueue: Boolean(vdjQueueCheckPromise),
      entries: vdjQueueEntries.map((entry) => ({
        virtualDJItemId: entry.virtualDJItemId,
        position: entry.index + 1,
        singer: visibleVdjSinger(entry.singer) || "No singer",
        song:
          entry.song || basename(entry.filePath || "") || "Untitled track",
        artist: entry.artist || "",
        durationSeconds: Math.max(0, Number(entry.durationSeconds) || 0),
        localAvailable: entry.localAvailable === true,
        availableInVirtualDJ: true,
        linkedRequestId: entry.linkedRequestId || "",
        sourceType: entry.sourceType || "virtualdj_external"
      })),
      externalCount: externalQueueEntries.length
    },
    clipboard: clipboardState,
    hitSuggestions,
    rotation: {
      favorites: config.lastHotelId ? favoritesForHotel(config.lastHotelId) : [],
      counts: {
        spanish: ROTATION_CATALOGS.spanish.length,
        english: ROTATION_CATALOGS.english.length,
        favorites: config.lastHotelId ? favoritesForHotel(config.lastHotelId).length : 0
      }
    },
    singerCandidates: [
      ...new Set(
        requests
          .filter((item) => effectiveRequestOutcome(item) !== "skipped")
          .map(vdjSingerForRequest)
          .filter(Boolean)
      )
    ],
    requests: requestViews
  };
}

function broadcastInterfacePreferences() {
  const message = "event: interface-preferences\ndata: " + JSON.stringify(config.interfacePreferences) + "\n\n";
  for (const response of [...eventClients]) {
    try { response.write(message); } catch { eventClients.delete(response); }
  }
}

function broadcastState() {
  if (!eventClients.size) return;
  const message = `event: state\ndata: ${JSON.stringify(stateView())}\n\n`;
  for (const response of [...eventClients]) {
    try {
      response.write(message);
    } catch {
      eventClients.delete(response);
    }
  }
}

function openEventStream(request, response) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no"
  });
  response.write(`event: state\ndata: ${JSON.stringify(stateView())}\n\n`);
  eventClients.add(response);
  request.on("close", () => eventClients.delete(response));
}

function refreshLocalAvailability() {
  const snapshot = requests.map((item) => ({
    id: item.id,
    available: Boolean(
      findMatches(
        libraryFiles,
        item.song,
        item.artist,
        item.languageCode || item.language,
        1
      )[0]?.exact ||
      vdjAvailablePaths.has(
        normalizeVdjPath(
          vdjRequestFilePaths.get(item.id) ||
          queuedEntries.get(item.id)?.filePath ||
          ""
        )
      )
    )
  }));
  const result = reconcileLocalAvailability(localAvailability, snapshot);
  localAvailability = result.next;

  for (const id of result.becameMissing) {
    youtubeCache.delete(id);
    youtubeSearchAt.delete(id);
    clipboardHandledIds.delete(id);
    if (clipboardState.requestId === id) {
      clipboardState = {
        requestId: "",
        url: "",
        resultType: "",
        notice: "",
        copiedAt: "",
        error: ""
      };
    }
  }
  return result.becameMissing;
}

function closeLibraryWatchers() {
  if (libraryWatchTimer) {
    clearTimeout(libraryWatchTimer);
    libraryWatchTimer = null;
  }
  for (const watcher of libraryWatchers) {
    try {
      watcher.close();
    } catch {
      // The polling fallback remains active if a watcher already closed.
    }
  }
  libraryWatchers = [];
}

function scheduleRealtimeScan() {
  if (libraryWatchTimer) clearTimeout(libraryWatchTimer);
  libraryWatchTimer = setTimeout(() => {
    libraryWatchTimer = null;
    void scanNow();
  }, 350);
  libraryWatchTimer.unref?.();
}

function startLibraryWatchers() {
  closeLibraryWatchers();
  for (const folder of config.libraryFolders) {
    try {
      const watcher = watch(
        folder,
        { recursive: true, persistent: false },
        scheduleRealtimeScan
      );
      watcher.on("error", () => {
        try {
          watcher.close();
        } catch {
          // The 10-second scan loop continues as a fallback.
        }
        libraryWatchers = libraryWatchers.filter((item) => item !== watcher);
        broadcastState();
      });
      libraryWatchers.push(watcher);
    } catch {
      // Missing or unsupported folders continue to use the scan loop.
    }
  }
  broadcastState();
}

async function scanNow() {
  if (scanning) {
    scanAgain = true;
    return;
  }
  scanning = true;
  libraryError = "";
  broadcastState();
  try {
    libraryFiles = await scanLibrary(config.libraryFolders);
    lastScanAt = new Date().toISOString();
  } catch (error) {
    libraryError = errorMessage(error);
  } finally {
    scanning = false;
  }
  await scanBackgroundMusicNow();
  refreshLocalAvailability();
  broadcastState();
  await reportLocalStates();
  await prepareMissingYoutube();
  await autoLinkSafeMatches();
  if (operatingMode === "bridge") await autoQueueExactMatches();
  broadcastState();
  if (scanAgain) {
    scanAgain = false;
    scheduleRealtimeScan();
  }
}

async function scanBackgroundMusicNow() {
  const files = [];
  const errors = [];
  for (const source of config.backgroundMusicSources) {
    try {
      const info = await stat(source);
      if (info.isDirectory()) {
        const found = await scanLibrary([source]);
        files.push(...found.filter((filePath) => BACKGROUND_AUDIO_EXTENSIONS.has(extname(filePath).toLowerCase())));
      } else if (info.isFile() && BACKGROUND_AUDIO_EXTENSIONS.has(extname(source).toLowerCase())) {
        files.push(source);
      } else {
        errors.push(`${source} no es una carpeta ni un audio compatible.`);
      }
    } catch {
      errors.push(`La fuente ambiental no está disponible: ${source}`);
    }
  }
  backgroundMusicFiles = [...new Set(files)].sort((a, b) => a.localeCompare(b));
  backgroundMusicError = errors.join(" ");
}

async function syncNow() {
  if (!guestStarConfigured()) return;
  if (syncing) {
    syncAgain = true;
    return;
  }
  syncing = true;
  sheetError = "";
  let refreshed = false;
  broadcastState();
  try {
    const previousRealtimeMode = operatingMode;
    const data = await fetchBridgeQueue(config);
    scheduleCloudScheduleWake(data);
    const nextActivity = normalizedActivity(data);
    const receivedRequests = bridgeRequests(data);
    const duplicateRequests = receivedRequests.filter((item) => item.duplicateOf);
    const nextRequests = receivedRequests.filter((item) => !item.duplicateOf);
    const activityChanged =
      queueActivityId &&
      nextActivity.activityId &&
      queueActivityId !== nextActivity.activityId;
    await reconcileDeletedRequests(nextRequests, nextActivity);
    if (activityChanged) clearTransientCaches();
    seedKnownExternalEntries(data);
    requests = nextRequests;
    for (const item of requests) {
      if (effectiveRequestOutcome(item)) continue;
      if (sheetMarksOutsideVirtualDj(item)) {
        removedExternallyIds.add(item.id);
        if (normalizeText(item.status).includes("retirada")) {
          suppressedQueueIds.add(item.id);
        }
      }
    }
    refreshLocalAvailability();
    applyActivityState(data);
    if (cloudRealtimeSocket && previousRealtimeMode !== operatingMode) {
      restartCloudRealtime();
    }
    await reconcileTerminalRequests(nextRequests);
    lastSyncAt = new Date().toISOString();
    broadcastState();
    for (const item of requests) {
      if (effectiveRequestOutcome(item)) continue;
      if (!sheetMarksVirtualDj(item)) continue;
      if (suppressedQueueIds.has(item.id)) continue;
      if (!queuedEntries.has(item.id)) {
        const entry = queuedEntryFromRequest(item);
        if (entry) queuedEntries.set(item.id, entry);
      }
    }
    await persistQueuedEntries(nextActivity.activityId);
    for (const duplicate of duplicateRequests) {
      if (reportedDuplicateIds.has(duplicate.id)) continue;
      try {
        await updateBridgeRequest(config, duplicate.id, "Cancelada", "", {
          syncState: `duplicate_of:${duplicate.duplicateOf}`
        });
        reportedDuplicateIds.add(duplicate.id);
        recordReconciliation({
          requestId: duplicate.id,
          previousStatus: duplicate.status,
          newStatus: "Canceled duplicate",
          reason: `duplicate_request_of:${duplicate.duplicateOf}`
        });
      } catch {
        // The local Bridge still suppresses the duplicate for this cycle.
        reportedDuplicateIds.add(duplicate.id);
      }
    }
    refreshed = true;
  } catch (error) {
    sheetError = errorMessage(error);
  } finally {
    syncing = false;
    broadcastState();
    if (refreshed) void runSyncMaintenance();
    if (syncAgain) {
      syncAgain = false;
      void syncNow();
    }
  }
}

async function runSyncMaintenance() {
  if (!guestStarConfigured()) return;
  if (syncMaintenanceRunning) {
    syncMaintenanceAgain = true;
    return;
  }
  syncMaintenanceRunning = true;
  try {
    if (operatingMode === "bridge") await reconcileVirtualDjQueue();
    await reportLocalStates();
    await prepareMissingYoutube();
    if (operatingMode === "bridge") {
      await prepareHitSuggestionYoutube();
      await autoQueueExactMatches();
    }
  } catch (error) {
    if (!sheetError) sheetError = errorMessage(error);
  } finally {
    syncMaintenanceRunning = false;
    broadcastState();
    if (syncMaintenanceAgain) {
      syncMaintenanceAgain = false;
      void runSyncMaintenance();
    }
  }
}

async function reportLocalStates() {
  if (!guestStarConfigured()) return;
  for (const item of requests) {
    if (effectiveRequestOutcome(item)) continue;
    if (queuedIds.has(item.id) || removedExternallyIds.has(item.id)) continue;
    if (
      !vdjQueueHasSnapshot &&
      (queuedEntries.has(item.id) || sheetMarksVirtualDj(item))
    ) {
      continue;
    }
    const top = findMatches(
      libraryFiles,
      item.song,
      item.artist,
      item.languageCode || item.language,
      1
    )[0];
    const verifiedQueuePath =
      vdjRequestFilePaths.get(item.id) ||
      queuedEntries.get(item.id)?.filePath ||
      "";
    const verifiedInVirtualDJ = Boolean(
      verifiedQueuePath &&
      vdjAvailablePaths.has(normalizeVdjPath(verifiedQueuePath))
    );
    const status = top?.exact || verifiedInVirtualDJ
      ? "Local encontrado"
      : top
        ? "Coincidencia para revisar"
        : "No está local";
    if (reportedStatuses.get(item.id) === status || item.status === status) continue;
    try {
      await updateBridgeRequest(
        config,
        item.id,
        status,
        top?.exact ? top.fileName : basename(verifiedQueuePath || "")
      );
      reportedStatuses.set(item.id, status);
      item.status = status;
    } catch {
      // La próxima sincronización volverá a intentarlo.
    }
  }
}

async function assertAllowedFile(filePath) {
  const target = await realpath(String(filePath || ""));
  const info = await stat(target);
  if (!info.isFile()) throw new Error("The selected track is not a file.");
  for (const folder of config.libraryFolders) {
    try {
      const root = await realpath(folder);
      if (target === root || target.startsWith(`${root}${sep}`)) return target;
    } catch {
      // Ignore folders that disappeared after the last scan.
    }
  }
  throw new Error("The track is not inside a configured karaoke folder.");
}

async function stemCacheRootForFile(filePath) {
  const target = await realpath(String(filePath || ""));
  for (const folder of config.libraryFolders) {
    try {
      const root = await realpath(folder);
      if (target !== root && !target.startsWith(`${root}${sep}`)) continue;
      const cacheRoot = resolve(root, ".guest-star-stems");
      await mkdir(cacheRoot, { recursive: true });
      const safeCacheRoot = await realpath(cacheRoot);
      if (safeCacheRoot !== root && safeCacheRoot.startsWith(`${root}${sep}`)) {
        return safeCacheRoot;
      }
    } catch {
      // Continue through the configured karaoke folders.
    }
  }
  throw new Error("Guest Star could not create its Stems cache inside the configured karaoke folder.");
}

function firstExistingPath(candidates = []) {
  return candidates.map((value) => String(value || "").trim()).find((value) =>
    value && existsSync(value)
  ) || "";
}

function stemCapability(status, message, details = {}) {
  return { available: status === "ready", status, message, ...details };
}

function stemStatusMessage(status, engine = "") {
  const name = engine === "spleeter" ? "Spleeter" : engine === "demucs" ? "Demucs" : "Motores IA";
  if (status === "not_installed") return `${name} no está instalado. Actualiza o reinstala Guest Star Universal.`;
  if (status === "not_executable") return `${name} está instalado pero no se puede ejecutar. Reinstala Guest Star Universal.`;
  if (status === "model_missing") return `Falta el modelo de ${name}. Reinstala Guest Star Universal.`;
  if (status === "temporary_error") return `${name} no superó la prueba de ejecución. Cierra otras apps intensivas y vuelve a intentarlo.`;
  if (status === "checking") return `Verificando ${name} con una prueba real…`;
  return `${name} está listo.`;
}

async function canAccessStemPath(filePath, executable = false) {
  if (!filePath) return false;
  try {
    await access(filePath, executable ? fsConstants.X_OK : fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function stemEngineFingerprint() {
  const entries = [
    resolve(STEM_ENGINE_ROOT, "package.json"),
    stemFfmpegPath,
    stemFfprobePath,
    resolve(STEM_ENGINE_ROOT, "bin", "sherpa-onnx-offline-source-separation"),
    resolve(STEM_ENGINE_ROOT, "models", "sherpa-onnx-spleeter-2stems-fp16", "vocals.fp16.onnx"),
    resolve(STEM_ENGINE_ROOT, "models", "sherpa-onnx-spleeter-2stems-fp16", "accompaniment.fp16.onnx"),
    DEMUCS_ENGINE_CLI,
    resolve(STEM_ENGINE_ROOT, "node_modules", "demucs", "htdemucs.onnx")
  ];
  const fingerprint = createHash("sha256");
  fingerprint.update(`${bundleBuild}|${process.arch}|${STEM_ENGINE_SOURCE}|`);
  for (const filePath of entries) {
    try {
      const info = await stat(filePath);
      fingerprint.update(`${filePath}|${info.size}|${info.mtimeMs}|`);
    } catch {
      fingerprint.update(`${filePath}|missing|`);
    }
  }
  return fingerprint.digest("hex");
}

async function loadStemEngineVerification() {
  try {
    const saved = JSON.parse(await readFile(STEM_ENGINE_VERIFICATION_PATH, "utf8"));
    return saved?.fingerprint === stemEngineVerificationFingerprint && saved?.engines &&
      typeof saved.engines === "object" ? saved.engines : {};
  } catch {
    return {};
  }
}

async function saveStemEngineVerification(engines) {
  const directory = dirname(STEM_ENGINE_VERIFICATION_PATH);
  const staged = `${STEM_ENGINE_VERIFICATION_PATH}.${process.pid}.tmp`;
  await mkdir(directory, { recursive: true });
  await writeFile(staged, `${JSON.stringify({
    fingerprint: stemEngineVerificationFingerprint,
    source: STEM_ENGINE_SOURCE,
    verifiedAt: new Date().toISOString(),
    engines
  }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(staged, STEM_ENGINE_VERIFICATION_PATH);
}

function updateStemEngineSummary() {
  const engines = [stemCapabilities.spleeter, stemCapabilities.demucs];
  stemEngineAvailable = engines.some((engine) => engine.available);
  const status = stemEngineAvailable ? "ready" : [
    "model_missing", "not_executable", "not_installed", "temporary_error", "checking"
  ].find((candidate) => engines.some((engine) => engine.status === candidate)) || "not_installed";
  stemEngineStatus = {
    status,
    message: stemEngineAvailable
      ? "Motores IA verificados y listos."
      : stemStatusMessage(status),
    source: STEM_ENGINE_SOURCE
  };
  diagnostics.setHealth("Spleeter", stemCapabilities.spleeter.available ? "IDLE" : "OFFLINE");
  diagnostics.setHealth("Demucs", stemCapabilities.demucs.available ? stemResourceState : "OFFLINE");
  diagnostics.setHealth("Stem Cache", engines.some((engine) => engine.status !== "not_executable") ? "OK" : "WARNING");
}

async function refreshStemEngineCapability() {
  const packagePath = resolve(STEM_ENGINE_ROOT, "package.json");
  if (!(await canAccessStemPath(packagePath))) {
    stemCapabilities = {
      spleeter: stemCapability("not_installed", stemStatusMessage("not_installed", "spleeter")),
      demucs: stemCapability("not_installed", stemStatusMessage("not_installed", "demucs"), { cli: DEMUCS_ENGINE_CLI })
    };
    updateStemEngineSummary();
    return false;
  }
  try { stemFfmpegPath = String(process.env.GUEST_STAR_FFMPEG || stemEngineRequire("ffmpeg-static") || ""); }
  catch { stemFfmpegPath = String(process.env.GUEST_STAR_FFMPEG || ""); }
  try { stemFfprobePath = String(process.env.GUEST_STAR_FFPROBE || stemEngineRequire("@ffprobe-installer/ffprobe")?.path || ""); }
  catch { stemFfprobePath = String(process.env.GUEST_STAR_FFPROBE || ""); }
  const toolsAvailable = (await Promise.all([
    canAccessStemPath(stemFfmpegPath, true),
    canAccessStemPath(stemFfprobePath, true),
    canAccessStemPath(STEM_ENGINE_SMOKE_SCRIPT)
  ])).every(Boolean);
  const spleeterCli = firstExistingPath([
    process.env.GUEST_STAR_SPLEETER_CLI,
    resolve(STEM_ENGINE_ROOT, "bin", "sherpa-onnx-offline-source-separation"),
    resolve(STEM_ENGINE_ROOT, "sherpa-onnx-offline-source-separation")
  ]);
  const modelDirectories = [
    process.env.GUEST_STAR_SPLEETER_MODEL_DIR,
    resolve(STEM_ENGINE_ROOT, "models", "sherpa-onnx-spleeter-2stems-fp16"),
    resolve(STEM_ENGINE_ROOT, "models", "spleeter-2stems")
  ].filter(Boolean);
  const vocalsModel = firstExistingPath([
    process.env.GUEST_STAR_SPLEETER_VOCALS_MODEL,
    ...modelDirectories.map((directory) => resolve(directory, "vocals.fp16.onnx"))
  ]);
  const accompanimentModel = firstExistingPath([
    process.env.GUEST_STAR_SPLEETER_ACCOMPANIMENT_MODEL,
    ...modelDirectories.map((directory) => resolve(directory, "accompaniment.fp16.onnx"))
  ]);
  const [spleeterExecutable, demucsExecutable, demucsModel] = await Promise.all([
    canAccessStemPath(spleeterCli, true),
    canAccessStemPath(DEMUCS_ENGINE_CLI),
    canAccessStemPath(resolve(STEM_ENGINE_ROOT, "node_modules", "demucs", "htdemucs.onnx"))
  ]);
  stemEngineVerificationFingerprint = await stemEngineFingerprint();
  const verified = await loadStemEngineVerification();
  const statusFor = (engine, structurallyReady) => {
    if (!toolsAvailable) return "not_executable";
    if (engine === "spleeter" && !(vocalsModel && accompanimentModel)) return "model_missing";
    if (engine === "demucs" && !demucsModel) return "model_missing";
    if (!structurallyReady) return "not_installed";
    return verified[engine]?.status === "ready" ? "ready" : "checking";
  };
  const spleeterStatus = statusFor("spleeter", spleeterExecutable);
  const demucsStatus = statusFor("demucs", demucsExecutable);
  stemCapabilities = {
    spleeter: stemCapability(spleeterStatus, stemStatusMessage(spleeterStatus, "spleeter"), {
      cli: spleeterCli,
      vocalsModel,
      accompanimentModel
    }),
    demucs: stemCapability(demucsStatus, stemStatusMessage(demucsStatus, "demucs"), {
      cli: DEMUCS_ENGINE_CLI
    })
  };
  updateStemEngineSummary();
  return stemEngineAvailable;
}

async function verifyStemEngineCapability() {
  if (stemEngineVerificationRunning || stemResourceState !== "IDLE" || !["checking", "ready"].includes(stemEngineStatus.status)) return;
  const engines = Object.entries(stemCapabilities)
    .filter(([, capability]) => capability.status === "checking")
    .map(([engine]) => engine);
  if (!engines.length) return;
  stemEngineVerificationRunning = true;
  const verification = await loadStemEngineVerification();
  try {
    for (const engine of engines) {
      if (stemWorkerPaused) break;
      const result = await new Promise((resolveVerification) => {
        const child = spawn(process.execPath, [
          STEM_ENGINE_SMOKE_SCRIPT, STEM_ENGINE_ROOT, `--engine=${engine}`
        ], {
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            OMP_NUM_THREADS: "1",
            MKL_NUM_THREADS: "1",
            OPENBLAS_NUM_THREADS: "1",
            VECLIB_MAXIMUM_THREADS: "1",
            UV_THREADPOOL_SIZE: "1"
          }
        });
        activeStemVerificationChild = child;
        try { setPriority(child.pid, 19); } catch { /* Best effort on supported systems. */ }
        let output = "";
        const capture = (chunk) => { output = `${output}${String(chunk || "")}`.slice(-1600); };
        child.stdout?.on("data", capture);
        child.stderr?.on("data", capture);
        child.once("error", (error) => resolveVerification({ ok: false, error: errorMessage(error) }));
        child.once("close", (code, signal) => resolveVerification({
          ok: Number(code) === 0,
          error: output.trim() || `code ${code}${signal ? ` (${signal})` : ""}`
        }));
      });
      activeStemVerificationChild = null;
      if (result.ok) {
        stemCapabilities[engine] = {
          ...stemCapabilities[engine],
          available: true,
          status: "ready",
          message: stemStatusMessage("ready", engine)
        };
        verification[engine] = { status: "ready", verifiedAt: new Date().toISOString() };
      } else {
        stemCapabilities[engine] = {
          ...stemCapabilities[engine],
          available: false,
          status: "temporary_error",
          message: stemStatusMessage("temporary_error", engine)
        };
        verification[engine] = { status: "temporary_error", error: String(result.error || "").slice(-800) };
        recordStemBreadcrumb("STEM_ENGINE_SMOKE_FAILED", {
          engine,
          summary: String(result.error || "Stems smoke test failed.").slice(-800)
        }, { severity: "WARNING" });
      }
      updateStemEngineSummary();
      broadcastState();
    }
    await saveStemEngineVerification(verification);
  } catch (error) {
    stemEngineStatus = {
      status: "temporary_error",
      message: stemStatusMessage("temporary_error"),
      source: STEM_ENGINE_SOURCE
    };
    recordStemBreadcrumb("STEM_ENGINE_VERIFICATION_FAILED", {
      summary: errorMessage(error)
    }, { severity: "WARNING" });
    broadcastState();
  } finally {
    activeStemVerificationChild = null;
    stemEngineVerificationRunning = false;
    void processStemQueue();
  }
}

function recordStemBreadcrumb(event, details = {}, { severity = "INFO", createIncident = false } = {}) {
  const engine = String(details.engine || "");
  return diagnostics.record({
    module: details.module || (engine === "spleeter" ? "Spleeter" : engine === "demucs" ? "Demucs" : "Stems IA"),
    severity,
    event,
    summary: details.summary || event,
    jobId: details.jobId || "",
    engine,
    elapsedMs: details.elapsedMs || 0,
    context: details.context || {}
  }, { createIncident });
}

function currentStemResourceSignals() {
  const healthAge = Date.now() - Date.parse(playerHealthState.updatedAt || "");
  const fresh = Number.isFinite(healthAge) && healthAge >= 0 && healthAge < 15000;
  const cores = availableParallelism();
  const karaokeFromRuntime = playerPlayback.scene === "karaoke" && playerPlayback.wasPlaying;
  return {
    karaokeActive: fresh ? playerHealthState.karaokeActive || karaokeFromRuntime : karaokeFromRuntime,
    backgroundActive: fresh && playerHealthState.backgroundActive,
    videoActive: fresh ? playerHealthState.videoActive : karaokeFromRuntime,
    audioContextState: fresh ? playerHealthState.audioContextState : "unknown",
    mediaState: fresh ? playerHealthState.mediaState : "idle",
    audioRecovering: fresh && playerHealthState.audioRecovering,
    audioOutputLost: fresh && playerHealthState.audioOutputLost,
    starScreenProblem: fresh && playerHealthState.starScreenExpected && !playerHealthState.starScreenConnected,
    cpuLoadRatio: cores > 0 ? loadavg()[0] / cores : 0,
    memoryPressure: systemMemoryPressure,
    memoryFreePercent: systemMemoryFreePercent
  };
}

async function refreshSystemMemoryPressure() {
  if (systemMemoryPressureRefresh) return systemMemoryPressureRefresh;
  systemMemoryPressureRefresh = (async () => {
    if (platform() === "darwin") {
      try {
        const { stdout } = await execFileAsync("/usr/bin/memory_pressure", ["-Q"], {
          timeout: 3000,
          maxBuffer: 256 * 1024
        });
        const match = String(stdout || "").match(/System-wide memory free percentage:\s*(\d+(?:\.\d+)?)%/i);
        if (match) {
          systemMemoryFreePercent = Math.max(0, Math.min(100, Number(match[1])));
          systemMemoryPressure = systemMemoryFreePercent < 10;
          return;
        }
      } catch {
        // Fall through to the portable estimate when the native probe is unavailable.
      }
    }
    const memoryTotal = totalmem();
    const ratio = memoryTotal > 0 ? freemem() / memoryTotal : 1;
    systemMemoryFreePercent = Math.round(ratio * 1000) / 10;
    systemMemoryPressure = ratio < 0.08;
  })().finally(() => {
    systemMemoryPressureRefresh = null;
  });
  return systemMemoryPressureRefresh;
}

function applyActiveStemResourceBudget(previousState = stemResourceState) {
  stemWorkerPaused = stemResourceState === "PRESSURE";
  const verificationPaused = stemResourceState !== "IDLE";
  if (activeStemVerificationChild?.pid) {
    try { setPriority(activeStemVerificationChild.pid, 19); } catch { /* Best effort on supported systems. */ }
    if (verificationPaused && !activeStemVerificationChild.guestStarStopped) {
      try {
        activeStemVerificationChild.kill("SIGSTOP");
        activeStemVerificationChild.guestStarStopped = true;
      } catch { /* The verification may have completed between state updates. */ }
    } else if (!verificationPaused && activeStemVerificationChild.guestStarStopped) {
      try {
        activeStemVerificationChild.kill("SIGCONT");
        activeStemVerificationChild.guestStarStopped = false;
      } catch { /* The verification may have completed while it was stopped. */ }
    }
  }
  const job = playerStemJobs.get(activeStemJobId);
  if (!activeStemChild?.pid || !job) return;
  const budget = job.engine === "spleeter"
    ? spleeterExecutionBudget(availableParallelism(), stemResourceState)
    : demucsExecutionBudget(availableParallelism(), stemResourceState);
  job.resourceState = stemResourceState;
  try {
    setPriority(activeStemChild.pid, budget.osPriority);
    job.osPriorityApplied = budget.osPriority;
  } catch {
    job.osPriorityApplied = null;
  }
  if (stemWorkerPaused && !activeStemChild.guestStarStopped) {
    try {
      activeStemChild.kill("SIGSTOP");
      activeStemChild.guestStarStopped = true;
    } catch {
      // The process may have completed between the health update and the signal.
    }
  } else if (!stemWorkerPaused && activeStemChild.guestStarStopped) {
    try {
      activeStemChild.kill("SIGCONT");
      activeStemChild.guestStarStopped = false;
      if (job.engine === "demucs") {
        recordStemBreadcrumb("DEMUCS_RESUMED", {
          engine: "demucs",
          jobId: job.jobId,
          context: { previousState, resourceState: stemResourceState }
        });
      }
    } catch {
      // The process may have completed while it was stopped.
    }
  }
}

function updateStemResourceState() {
  const result = stemResourceController.update(currentStemResourceSignals());
  stemResourceState = result.state;
  if (!result.changed) return result;
  applyActiveStemResourceBudget(result.previous);
  const event = `DEMUCS_MODE_${stemResourceState}`;
  recordStemBreadcrumb(event, {
    engine: "demucs",
    context: {
      previousState: result.previous,
      resourceState: stemResourceState,
      signals: currentStemResourceSignals(),
      budget: demucsExecutionBudget(availableParallelism(), stemResourceState)
    }
  });
  diagnostics.setHealth("Demucs", stemCapabilities.demucs.available ? stemResourceState : "OFFLINE");
  if (stemResourceState === "PRESSURE") {
    recordStemBreadcrumb("DEMUCS_RESOURCE_REDUCED", {
      engine: "demucs",
      context: { previousState: result.previous, resourceState: stemResourceState }
    });
    recordStemBreadcrumb("DEMUCS_PAUSED_OR_DEFERRED", {
      engine: "demucs",
      context: { activeJobId: activeStemJobId, pauseMechanism: "SIGSTOP" }
    });
  } else {
    void processStemQueue();
    if (stemResourceState === "IDLE") void verifyStemEngineCapability();
  }
  void persistQueuedEntries().catch(() => {});
  broadcastState();
  return result;
}

class StemCommandInterruptedError extends Error {
  constructor(reason) {
    super(`Stem command interrupted: ${reason}`);
    this.name = "StemCommandInterruptedError";
    this.reason = reason;
  }
}

function interruptActiveDemucs(reason) {
  const job = playerStemJobs.get(activeStemJobId);
  if (!activeStemChild?.pid || job?.engine !== "demucs") return false;
  activeStemInterrupt = String(reason || "preempted");
  try {
    if (activeStemChild.guestStarStopped) activeStemChild.kill("SIGCONT");
    activeStemChild.kill("SIGTERM");
    return true;
  } catch {
    return false;
  }
}

async function runStemCommand(command, args, job, phase, onOutput = null) {
  if (!playerStemJobs.has(job.id)) throw new Error("Stem preparation was cancelled.");
  job.phase = phase;
  job.updatedAt = new Date().toISOString();
  await persistQueuedEntries();
  broadcastState();
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env
  });
  activeStemChild = child;
  activeStemEngine = job.engine;
  activeStemInterrupt = "";
  applyActiveStemResourceBudget();
  let errorText = "";
  const consume = (chunk) => {
    const output = String(chunk || "");
    errorText = `${errorText}${output}`.slice(-12000);
    job.lastOutputAt = new Date().toISOString();
    if (onOutput) onOutput(output);
  };
  child.stdout?.on("data", consume);
  child.stderr?.on("data", consume);
  const [code, signal] = await new Promise((resolveClose, rejectClose) => {
    child.once("error", rejectClose);
    child.once("close", (...values) => resolveClose(values));
  });
  if (activeStemChild === child) activeStemChild = null;
  const interrupted = activeStemInterrupt;
  activeStemInterrupt = "";
  if (interrupted) throw new StemCommandInterruptedError(interrupted);
  if (Number(code) !== 0) {
    const failure = new Error(`Stem engine stopped${signal ? ` (${signal})` : ""}: ${errorText.trim().slice(-800) || `code ${code}`}`);
    failure.exitCode = code;
    failure.signal = signal;
    failure.stderr = errorText.trim().slice(-2000);
    failure.command = basename(command);
    throw failure;
  }
}

async function probeDuration(filePath) {
  const { stdout } = await execFileAsync(stemFfprobePath, [
    "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", filePath
  ], { timeout: 30000 });
  return Math.max(0, Number(String(stdout).trim()) || 0);
}

async function probeAudioStream(filePath) {
  const { stdout } = await execFileAsync(stemFfprobePath, [
    "-v", "error", "-select_streams", "a:0",
    "-show_entries", "stream=codec_name,profile,sample_rate,channels,bit_rate,duration,duration_ts,time_base",
    "-of", "json", filePath
  ], { timeout: 30000, maxBuffer: 256 * 1024 });
  const stream = JSON.parse(String(stdout || "{}")).streams?.[0] || {};
  const sampleRate = Math.max(1, Number(stream.sample_rate) || 44_100);
  const durationSeconds = Math.max(0, Number(stream.duration) || await probeDuration(filePath));
  return {
    codec: String(stream.codec_name || "").toLowerCase() === "aac" ? "aac-lc" : String(stream.codec_name || ""),
    profile: String(stream.profile || ""),
    bitrate: Math.max(1, Number(stream.bit_rate) || 0),
    sampleRate,
    channels: Math.max(1, Number(stream.channels) || 0),
    durationSeconds,
    frameCount: Math.max(1, Math.round(durationSeconds * sampleRate)),
    packetFrames: 1024
  };
}

function requestStemJobs(requestId) {
  return [...playerStemJobs.values()].filter((job) => job.requestId === String(requestId));
}

function requestStemIntent(requestId) {
  return requestStemJobs(requestId).sort((left, right) =>
    Date.parse(right.intentUpdatedAt || right.requestedAt || "") -
    Date.parse(left.intentUpdatedAt || left.requestedAt || "")
  )[0]?.intent || normalizeStemEngine(config.defaultStemEngine, "auto");
}

function setRequestStemIntent(requestId, intent, timestamp = new Date().toISOString()) {
  for (const job of requestStemJobs(requestId)) {
    job.intent = intent;
    job.intentUpdatedAt = timestamp;
    if (intent === "demucs" && job.engine === "demucs" && job.status === "deferred") {
      job.status = "queued";
      job.phase = "Alta calidad · esperando recursos seguros";
    }
    if (intent === "auto" && job.engine === "demucs" && job.status === "deferred") {
      job.status = "queued";
      job.phase = "AUTO · Mejora en cola";
    }
  }
}

function deferAutoDemucs(requestId) {
  for (const job of requestStemJobs(requestId)) {
    if (job.engine !== "demucs" || job.intent !== "auto" || job.status === "ready") continue;
    if (job.id === activeStemJobId && job.status === "processing") {
      interruptActiveDemucs("deferred_by_manual_fast_mode");
    } else {
      job.status = "deferred";
      job.phase = "Mejora Demucs diferida por modo Rápido";
      job.updatedAt = new Date().toISOString();
    }
  }
}

function playerQueueRowsForStemEta() {
  const byId = new Map([
    ...requests.map((item) => [String(item.id), item]),
    ...[...playerLocalRequests.values()].map((item) => [String(item.id), item])
  ]);
  const ids = [
    ...playerOrder,
    ...[...byId.keys()].filter((id) => !playerOrder.includes(id))
  ];
  return ids.map((id) => ({
    id,
    durationSeconds: Math.max(1, Number(byId.get(id)?.durationSeconds) || 240),
    transitionSeconds: activityState.transitionSeconds
  }));
}

function estimatedTurnForRequest(requestId) {
  const rows = playerQueueRowsForStemEta();
  const current = rows.find((item) => item.id === String(playerPlayback.currentRequestId));
  return estimateTurnSeconds({
    requestId,
    queue: rows,
    currentRequestId: playerPlayback.currentRequestId,
    currentTimeSeconds: playerPlayback.currentTimeSeconds,
    currentDurationSeconds: current?.durationSeconds,
    transitionSeconds: activityState.transitionSeconds,
    defaultDurationSeconds: 240
  });
}

async function trackStemContext(filePath) {
  const [cacheRoot, identity] = await Promise.all([
    stemCacheRootForFile(filePath),
    fingerprintStemTrack(filePath)
  ]);
  return { cacheRoot, ...identity };
}

async function lookupStemCache(context, engine, requestId = "") {
  const modelVersion = STEM_MODEL_VERSIONS[engine];
  recordStemBreadcrumb("STEMS_CACHE_LOOKUP", {
    module: "Stem Cache",
    engine,
    context: {
      requestId: requestId ? createHash("sha256").update(requestId).digest("hex").slice(0, 16) : "",
      fingerprint: context.fingerprint.slice(0, 20),
      modelVersion
    }
  });
  const result = await inspectStemCache({
    cacheRoot: context.cacheRoot,
    fingerprint: context.fingerprint,
    engine,
    modelVersion,
    probeDuration: stemFfprobePath ? probeDuration : null
  });
  const prefix = engine === "spleeter" ? "SPLEETER" : "DEMUCS";
  recordStemBreadcrumb(`${prefix}_CACHE_${result.valid ? "HIT" : "MISS"}`, {
    module: result.valid ? engine === "spleeter" ? "Spleeter" : "Demucs" : "Stem Cache",
    engine,
    context: {
      fingerprint: context.fingerprint.slice(0, 20),
      modelVersion,
      reason: result.reason
    }
  });
  return result;
}

function upsertStemJob({ requestId, filePath, engine, intent, context, cache = null }) {
  const id = stemJobKey(requestId, engine);
  const existing = playerStemJobs.get(id);
  const stamp = new Date().toISOString();
  const cached = cache?.valid === true;
  const plannedGSX = gsxStemCachePaths(
    context.cacheRoot,
    context.fingerprint,
    engine,
    STEM_MODEL_VERSIONS[engine]
  );
  const job = {
    ...existing,
    id,
    requestId,
    jobId: existing?.jobId || `GSJ-${randomUUID()}`,
    filePath,
    engine,
    intent,
    intentUpdatedAt: stamp,
    required: engine === "spleeter" || intent === "demucs",
    opportunistic: engine === "demucs" && intent === "auto",
    status: cached ? "ready" : "queued",
    progress: cached ? 100 : 0,
    phase: cached
      ? `${engine === "spleeter" ? "Spleeter" : "Demucs"} listo desde caché`
      : engine === "spleeter"
        ? intent === "auto" ? "AUTO · Preparando rápido…" : "Rápido · en cola"
        : intent === "auto" ? "AUTO · Mejora en cola" : "Alta calidad · en cola",
    fingerprint: context.fingerprint,
    cacheKey: cache?.cacheKey || plannedGSX.cacheKey,
    modelVersion: STEM_MODEL_VERSIONS[engine],
    manifestPath: cached ? cache.manifestPath : "",
    instrumentalPath: cached ? cache.instrumentalPath : "",
    vocalsPath: cached ? cache.vocalsPath : "",
    gsxPath: cached ? cache.gsxPath || "" : "",
    cacheFormat: cached ? cache.format || "legacy" : "",
    error: "",
    cacheHit: cached,
    estimatedTurnSeconds: estimatedTurnForRequest(requestId),
    etaSeconds: 0,
    resourceState: stemResourceState,
    actualThreads: engine === "spleeter"
      ? spleeterExecutionBudget(availableParallelism(), stemResourceState).numThreads
      : null,
    osPriorityApplied: null,
    requestedAt: existing?.requestedAt || stamp,
    startedAt: cached ? existing?.startedAt || "" : "",
    completedAt: cached ? cache.manifest?.createdAt || stamp : "",
    lastOutputAt: "",
    updatedAt: stamp
  };
  playerStemJobs.set(id, job);
  return job;
}

async function queueAutoDemucsUpgrade(requestId, filePath, context) {
  const cache = await lookupStemCache(context, "demucs", requestId);
  const job = upsertStemJob({ requestId, filePath, engine: "demucs", intent: "auto", context, cache });
  if (!cache.valid && !stemCapabilities.demucs.available) {
    job.status = "deferred";
    job.phase = "AUTO · Demucs no está instalado";
  } else if (!cache.valid) {
    recordStemBreadcrumb("DEMUCS_QUEUE", {
      engine: "demucs",
      jobId: job.jobId,
      context: { estimatedTurnSeconds: job.estimatedTurnSeconds, resourceState: stemResourceState }
    });
  }
  return job;
}

async function acquireGSXGenerationClaim(paths, expected) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = await open(paths.lockPath, "wx", 0o600);
      await handle.writeFile(`${JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() })}\n`);
      await handle.sync();
      return { handle, existing: null };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const lock = JSON.parse(await readFile(paths.lockPath, "utf8"));
        process.kill(Number(lock.pid), 0);
      } catch (lockError) {
        if (lockError?.code === "EPERM") {
          // A live process owned by another user still owns the claim.
        } else {
          await rm(paths.lockPath, { force: true });
          continue;
        }
      }
      for (let second = 0; second < 600; second += 1) {
        await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
        const existing = await inspectGSXStems(paths.gsxPath, expected);
        if (existing.valid) return { handle: null, existing };
        try { await stat(paths.lockPath); } catch { break; }
      }
      throw new Error("Another Guest Star process is still generating this GSX stem set.");
    }
  }
  throw new Error("The GSX generation claim could not be acquired.");
}

async function prepareStemJob(job) {
  const context = await trackStemContext(job.filePath);
  if (job.fingerprint && job.fingerprint !== context.fingerprint) {
    job.fingerprint = context.fingerprint;
  }
  const cached = await lookupStemCache(context, job.engine, job.requestId);
  if (cached.valid) return { ...cached, cacheHit: true };
  const modelVersion = STEM_MODEL_VERSIONS[job.engine];
  const finalPaths = gsxStemCachePaths(context.cacheRoot, context.fingerprint, job.engine, modelVersion);
  await mkdir(finalPaths.directory, { recursive: true });
  if (!finalPaths.gsxPath.startsWith(`${context.cacheRoot}${sep}`)) {
    throw new Error("The Stems cache entry is outside Guest Star storage.");
  }
  const expectedGSX = {
    sourceHash: context.fingerprint,
    separationModel: job.engine,
    separationModelVersion: modelVersion,
    encodingProfile: finalPaths.encodingProfile
  };
  const claim = await acquireGSXGenerationClaim(finalPaths, expectedGSX);
  if (claim.existing) {
    return { ...finalPaths, format: "gsx", manifest: claim.existing.manifest, cacheHit: true };
  }
  let workDir = "";
  try {
    await rm(finalPaths.tempPath, { force: true });
    workDir = await mkdtemp(resolve(context.cacheRoot, ".work-"));
    const wavPath = resolve(workDir, "input.wav");
    const separatedDir = resolve(workDir, "separated");
    await mkdir(separatedDir, { recursive: true });
    const sourceDuration = await probeDuration(job.filePath);
    const spleeterBudget = spleeterExecutionBudget(availableParallelism(), stemResourceState);
    const ffmpegThreads = job.engine === "spleeter"
      ? spleeterBudget.numThreads
      : stemResourceState === "LIVE" ? 1 : Math.max(1, Math.min(2, Math.floor(availableParallelism() / 4)));
    job.progress = 3;
    await runStemCommand(stemFfmpegPath, [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-threads", String(ffmpegThreads), "-y",
      "-i", job.filePath, "-vn", "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le", wavPath
    ], job, "Extrayendo audio");
    job.progress = 10;
    let instrumentalWav;
    let vocalsWav;
    if (job.engine === "spleeter") {
      vocalsWav = resolve(separatedDir, "vocals.wav");
      instrumentalWav = resolve(separatedDir, "accompaniment.wav");
      job.actualThreads = spleeterBudget.numThreads;
      await runStemCommand(stemCapabilities.spleeter.cli, [
        `--spleeter-vocals=${stemCapabilities.spleeter.vocalsModel}`,
        `--spleeter-accompaniment=${stemCapabilities.spleeter.accompanimentModel}`,
        `--num-threads=${spleeterBudget.numThreads}`,
        `--input-wav=${wavPath}`,
        `--output-vocals-wav=${vocalsWav}`,
        `--output-accompaniment-wav=${instrumentalWav}`
      ], job, "Spleeter · separación rápida", (output) => {
        const percent = Number(output.match(/(\d{1,3})%/)?.[1]);
        if (Number.isFinite(percent)) job.progress = Math.max(10, Math.min(80, 10 + Math.round(percent * 0.7)));
      });
    } else {
      job.actualThreads = null;
      await runStemCommand(process.execPath, [
        stemCapabilities.demucs.cli, wavPath, "--output", separatedDir, "--overlap", "0.05"
      ], job, "Demucs · mejorando calidad", (output) => {
        const matches = [...output.matchAll(/(\d+)\/(\d+)/g)];
        const latest = matches.at(-1);
        if (!latest) return;
        job.progress = Math.max(10, Math.min(82, 10 + Math.round((Number(latest[1]) / Math.max(1, Number(latest[2]))) * 72)));
        const elapsed = job.startedAt ? Math.max(1, (Date.now() - Date.parse(job.startedAt)) / 1000) : 0;
        job.etaSeconds = job.progress > 10 ? Math.round(elapsed * (100 - job.progress) / job.progress) : 0;
        job.updatedAt = new Date().toISOString();
        broadcastState();
      });
      const parts = resolve(separatedDir, "input");
      instrumentalWav = resolve(workDir, "instrumental.wav");
      vocalsWav = resolve(parts, "vocals.wav");
      await runStemCommand(stemFfmpegPath, [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-threads", String(ffmpegThreads), "-y",
        "-i", resolve(parts, "drums.wav"),
        "-i", resolve(parts, "bass.wav"),
        "-i", resolve(parts, "other.wav"),
        "-filter_complex", "[0:a]asetpts=PTS-STARTPTS[a0];[1:a]asetpts=PTS-STARTPTS[a1];[2:a]asetpts=PTS-STARTPTS[a2];[a0][a1][a2]amix=inputs=3:normalize=0,alimiter=limit=0.95,aresample=44100:first_pts=0[a]",
        "-map", "[a]", "-c:a", "pcm_s16le", instrumentalWav
      ], job, "Demucs · mezclando instrumental");
    }
    const instrumentalPath = resolve(workDir, "instrumental.m4a");
    const vocalsPath = resolve(workDir, "vocals.m4a");
    job.progress = 86;
    await runStemCommand(stemFfmpegPath, [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-threads", String(ffmpegThreads), "-fflags", "+genpts", "-y",
      "-i", instrumentalWav, "-af", "asetpts=PTS-STARTPTS,aresample=44100:first_pts=0,alimiter=limit=0.95",
      "-c:a", "aac", "-profile:a", "aac_low", "-b:a", String(GSX_DEFAULT_PROFILE.instrumentalBitrate), "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", instrumentalPath
    ], job, "Generando instrumental");
    job.progress = 93;
    await runStemCommand(stemFfmpegPath, [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-threads", String(ffmpegThreads), "-fflags", "+genpts", "-y",
      "-i", vocalsWav, "-af", "asetpts=PTS-STARTPTS,aresample=44100:first_pts=0",
      "-c:a", "aac", "-profile:a", "aac_low", "-b:a", String(GSX_DEFAULT_PROFILE.vocalsBitrate), "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", vocalsPath
    ], job, "Preparando control de voz");
    const [instrumentalAudio, vocalsAudio, instrumentalInfo, vocalsInfo] = await Promise.all([
      probeAudioStream(instrumentalPath),
      probeAudioStream(vocalsPath),
      stat(instrumentalPath),
      stat(vocalsPath)
    ]);
    if (
      instrumentalInfo.size < 1024 || vocalsInfo.size < 1024 ||
      instrumentalAudio.codec !== "aac-lc" || vocalsAudio.codec !== "aac-lc" ||
      instrumentalAudio.channels !== 2 || vocalsAudio.channels !== 2 ||
      instrumentalAudio.durationSeconds <= 1 || vocalsAudio.durationSeconds <= 1 ||
      Math.abs(instrumentalAudio.durationSeconds - vocalsAudio.durationSeconds) >= 1.5 ||
      (sourceDuration > 1 && Math.abs(sourceDuration - instrumentalAudio.durationSeconds) >= 2)
    ) {
      throw new Error("The generated stems did not pass size and synchronization validation.");
    }
    job.progress = 97;
    await writeGSXStems({
      destination: finalPaths.tempPath,
      sourceHash: context.fingerprint,
      sourceSize: context.size,
      sourceDurationSeconds: sourceDuration,
      separationModel: job.engine,
      separationModelVersion: modelVersion,
      encodingProfile: finalPaths.encodingProfile,
      instrumentalPath,
      vocalsPath,
      instrumental: instrumentalAudio,
      vocals: vocalsAudio
    });
    const validated = await inspectGSXStems(finalPaths.tempPath, expectedGSX);
    if (!validated.valid) throw new Error(`GSX validation failed: ${validated.reason}`);
    await rename(finalPaths.tempPath, finalPaths.gsxPath);
    const finalRead = await inspectGSXStems(finalPaths.gsxPath, expectedGSX);
    if (!finalRead.valid) throw new Error(`GSX atomic publish failed validation: ${finalRead.reason}`);
    return { ...finalPaths, format: "gsx", manifest: finalRead.manifest, cacheHit: false };
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true });
    await claim.handle?.close().catch(() => {});
    await rm(finalPaths.lockPath, { force: true });
  }
}

function readyStemJobsForRequest(requestId) {
  return requestStemJobs(requestId).filter((job) =>
    job.status === "ready" && (job.gsxPath || (job.instrumentalPath && job.vocalsPath))
  );
}

function addReadyRequestToPlayerOrder(requestId) {
  const id = String(requestId || "");
  if (!id || playerOrder.includes(id)) return;
  playerOrder.push(id);
  playerRuntimeDirty = true;
}

function lockStemSourceForPlayback(requestId, reason = "runtime", preferredSource = "") {
  const id = String(requestId || "");
  if (!id) return null;
  const ready = new Map(readyStemJobsForRequest(id).map((job) => [job.engine, job]));
  const preferred = ["spleeter", "demucs"].includes(preferredSource) && ready.has(preferredSource)
    ? preferredSource
    : "";
  const desired = preferred || (ready.has("demucs") ? "demucs" : ready.has("spleeter") ? "spleeter" : "original");
  if (activeStemPlaybackLock?.requestId === id) {
    if (desired !== "original" && desired !== activeStemPlaybackLock.source) {
      recordStemBreadcrumb("STEM_HOT_SWAP_BLOCKED", {
        engine: desired,
        context: { requestId: id, lockedSource: activeStemPlaybackLock.source, availableSource: desired, reason }
      });
    }
    return activeStemPlaybackLock;
  }
  const lock = { requestId: id, source: desired, reason, lockedAt: new Date().toISOString() };
  activeStemPlaybackLock = lock;
  stemPlaybackLocks.set(id, lock);
  recordStemBreadcrumb("STEM_SOURCE_LOCKED_FOR_PLAYBACK", {
    engine: desired === "original" ? "" : desired,
    context: { requestId: id, source: desired, reason }
  });
  return lock;
}

function refreshQueuedStemEtas() {
  for (const job of playerStemJobs.values()) {
    if (!["queued", "processing", "deferred"].includes(job.status)) continue;
    job.estimatedTurnSeconds = estimatedTurnForRequest(job.requestId);
  }
}

async function processStemQueue() {
  if (stemWorkerRunning || !stemEngineAvailable) return;
  updateStemResourceState();
  if (stemWorkerPaused || stemResourceState === "PRESSURE") return;
  stemWorkerRunning = true;
  try {
    while (!stemWorkerPaused && stemResourceState !== "PRESSURE") {
      refreshQueuedStemEtas();
      const job = prioritizeStemJobs([...playerStemJobs.values()])[0];
      if (!job) break;
      if (!stemCapabilities[job.engine]?.available) {
        job.status = job.opportunistic ? "deferred" : "failed";
        job.phase = job.opportunistic ? "Mejora diferida · motor no disponible" : "Motor no disponible";
        job.error = `The ${job.engine} engine is not installed on this Mac.`;
        job.updatedAt = new Date().toISOString();
        await persistQueuedEntries();
        continue;
      }
      activeStemJobId = job.id;
      activeStemEngine = job.engine;
      job.status = "processing";
      job.startedAt = new Date().toISOString();
      job.error = "";
      job.resourceState = stemResourceState;
      job.updatedAt = job.startedAt;
      const prefix = job.engine === "spleeter" ? "SPLEETER" : "DEMUCS";
      recordStemBreadcrumb(`${prefix}_START`, {
        engine: job.engine,
        jobId: job.jobId,
        context: { intent: job.intent, estimatedTurnSeconds: job.estimatedTurnSeconds, resourceState: stemResourceState }
      });
      await persistQueuedEntries();
      broadcastState();
      try {
        const output = await prepareStemJob(job);
        job.status = "ready";
        job.progress = 100;
        job.phase = job.engine === "spleeter"
          ? job.intent === "auto" ? "AUTO · Spleeter listo" : "Rápido · Spleeter listo"
          : job.intent === "auto" ? "AUTO · Demucs listo" : "Alta calidad · Demucs listo";
        job.manifestPath = output.manifestPath;
        job.instrumentalPath = output.instrumentalPath;
        job.vocalsPath = output.vocalsPath;
        job.gsxPath = output.gsxPath || "";
        job.cacheFormat = output.format || (job.gsxPath ? "gsx" : "legacy");
        job.cacheKey = output.cacheKey || job.cacheKey;
        job.cacheHit = output.cacheHit === true;
        job.completedAt = new Date().toISOString();
        job.updatedAt = job.completedAt;
        addReadyRequestToPlayerOrder(job.requestId);
        recordStemBreadcrumb(`${prefix}_COMPLETE`, {
          engine: job.engine,
          jobId: job.jobId,
          elapsedMs: Math.max(0, Date.now() - Date.parse(job.startedAt)),
          context: {
            cacheHit: job.cacheHit,
            cacheFormat: job.cacheFormat,
            gsxBytes: job.gsxPath ? (await stat(job.gsxPath)).size : 0,
            modelVersion: job.modelVersion
          }
        });
        if (
          activeStemPlaybackLock?.requestId === job.requestId &&
          activeStemPlaybackLock.source !== job.engine &&
          job.engine === "demucs"
        ) {
          recordStemBreadcrumb("STEM_HOT_SWAP_BLOCKED", {
            engine: "demucs",
            jobId: job.jobId,
            context: { requestId: job.requestId, lockedSource: activeStemPlaybackLock.source }
          });
        }
      } catch (error) {
        if (error instanceof StemCommandInterruptedError) {
          job.status = "queued";
          job.phase = job.engine === "demucs"
            ? "AUTO · Mejora reanudará después del trabajo prioritario"
            : "Preparación reanudará cuando el sistema esté estable";
          job.error = "";
        } else {
          job.status = "failed";
          job.phase = job.opportunistic
            ? "Spleeter sigue listo · mejora HQ no completada"
            : "No se pudo preparar";
          job.error = errorMessage(error);
          recordStemBreadcrumb(`${prefix}_ERROR`, {
            engine: job.engine,
            jobId: job.jobId,
            elapsedMs: job.startedAt ? Math.max(0, Date.now() - Date.parse(job.startedAt)) : 0,
            summary: job.error,
            context: { command: error?.command || "", exitCode: error?.exitCode ?? null, signal: error?.signal || "" }
          }, { severity: job.opportunistic ? "WARNING" : "ERROR", createIncident: !job.opportunistic });
        }
        job.updatedAt = new Date().toISOString();
      } finally {
        activeStemJobId = "";
        activeStemEngine = "";
        await persistQueuedEntries();
        broadcastState();
        if (playerRuntimeDirty) void pushPlayerRuntimeRemote().catch(() => {});
      }
      updateStemResourceState();
    }
  } finally {
    stemWorkerRunning = false;
  }
}

async function enqueueStemRequest(id, requestedEngine = config.defaultStemEngine) {
  const requestId = String(id || "");
  const intent = normalizeStemEngine(requestedEngine, normalizeStemEngine(config.defaultStemEngine, "auto"));
  const filePath = await playerFileForRequest(requestId);
  const context = await trackStemContext(filePath);
  recordStemBreadcrumb(intent === "auto" ? "STEMS_AUTO_SELECTED" : "STEMS_ENGINE_SELECTED", {
    engine: intent === "auto" ? "" : intent,
    context: { requestId, intent, fingerprint: context.fingerprint.slice(0, 20) }
  });

  let cacheHit = false;
  if (intent === "auto") {
    const demucsCache = await lookupStemCache(context, "demucs", requestId);
    if (demucsCache.valid) {
      upsertStemJob({ requestId, filePath, engine: "demucs", intent, context, cache: demucsCache });
      cacheHit = true;
    } else {
      const spleeterCache = await lookupStemCache(context, "spleeter", requestId);
      if (!spleeterCache.valid && !stemCapabilities.spleeter.available) {
        throw new Error("AUTO requires the Spleeter fast engine or a valid cached stem on this Mac.");
      }
      upsertStemJob({ requestId, filePath, engine: "spleeter", intent, context, cache: spleeterCache });
      cacheHit = spleeterCache.valid;
      await queueAutoDemucsUpgrade(requestId, filePath, context);
    }
  } else {
    const cache = await lookupStemCache(context, intent, requestId);
    if (!cache.valid && !stemCapabilities[intent]?.available) {
      throw new Error(`The ${intent} Stems engine is not installed on this Mac.`);
    }
    upsertStemJob({ requestId, filePath, engine: intent, intent, context, cache });
    cacheHit = cache.valid;
    if (intent === "spleeter") deferAutoDemucs(requestId);
  }
  setRequestStemIntent(requestId, intent);
  // Stems are an enhancement, never admission control for the live queue.
  // A fast or HQ job can continue in the background, but it cannot make the
  // Host wait or silently remove a selected song from the Player.
  addReadyRequestToPlayerOrder(requestId);
  playerRuntimeDirty = true;
  await persistQueuedEntries();
  broadcastState();

  const requiredFastJob = playerStemJobs.get(stemJobKey(requestId, "spleeter"));
  if (
    activeStemEngine === "demucs" &&
    requiredFastJob?.status === "queued" &&
    requiredFastJob.required !== false
  ) {
    interruptActiveDemucs("preempted_by_required_spleeter");
  }
  void processStemQueue();
  return { ok: true, stem: playerStemJobView(requestId), cached: cacheHit, intent };
}

async function servePlayerStem(request, response, id, kind, requestedEngine = "") {
  const requestId = String(id || "");
  const preferred = ["spleeter", "demucs"].includes(requestedEngine) ? requestedEngine : "";
  const lock = lockStemSourceForPlayback(requestId, "media-request", preferred);
  // A prepared incoming source is fetched before the Player crossfades it.
  // Keep the transport lock; honour only an explicitly requested ready job.
  const source = preferred && readyStemJobsForRequest(requestId).some(job => job.engine === preferred) ? preferred : lock?.source;
  if (!source || source === "original") throw new Error("The requested stems are not ready.");
  const job = playerStemJobs.get(stemJobKey(requestId, source));
  if (!job || job.status !== "ready") throw new Error("The locked stems are not ready.");
  const root = await realpath(await stemCacheRootForFile(job.filePath));
  if (job.gsxPath) {
    const target = await realpath(job.gsxPath);
    if (!target.startsWith(`${root}${sep}`)) throw new Error("The GSX stem file is outside Guest Star storage.");
    await streamGSXStem(request, response, target, kind);
    return;
  }
  const candidate = kind === "vocals" ? job.vocalsPath : job.instrumentalPath;
  const target = await realpath(candidate);
  if (!target.startsWith(`${root}${sep}`)) throw new Error("The stem file is outside Guest Star storage.");
  await streamPlayerMedia(request, response, target);
}

async function servePlayerGSXDescriptor(response, id, requestedEngine = "") {
  const requestId = String(id || "");
  const preferred = ["spleeter", "demucs"].includes(requestedEngine) ? requestedEngine : "";
  const lock = lockStemSourceForPlayback(requestId, "gsx-descriptor", preferred);
  // A prepared incoming source is fetched before the Player crossfades it.
  // Keep the transport lock; honour only an explicitly requested ready job.
  const source = preferred && readyStemJobsForRequest(requestId).some(job => job.engine === preferred) ? preferred : lock?.source;
  if (!source || source === "original") throw new Error("The requested stems are not ready.");
  const job = playerStemJobs.get(stemJobKey(requestId, source));
  if (!job?.gsxPath || job.status !== "ready") throw new Error("A GSX stem set is not ready for this song.");
  const target = await realpath(job.gsxPath);
  const root = await realpath(await stemCacheRootForFile(job.filePath));
  if (!target.startsWith(`${root}${sep}`)) throw new Error("The GSX stem file is outside Guest Star storage.");
  const inspected = await inspectGSXStems(target, {
    sourceHash: job.fingerprint,
    separationModel: job.engine,
    separationModelVersion: job.modelVersion,
    encodingProfile: GSX_DEFAULT_PROFILE.id
  });
  if (!inspected.valid) throw new Error(`The GSX stem set is invalid: ${inspected.reason}`);
  json(response, 200, {
    ok: true,
    format: "gsx",
    formatVersion: inspected.manifest.formatVersion,
    path: target,
    sourceHash: inspected.manifest.sourceHash,
    durationSeconds: inspected.manifest.durationSeconds,
    streams: Object.fromEntries(Object.entries(inspected.manifest.streams).map(([kind, stream]) => [kind, {
      codec: stream.codec,
      sampleRate: stream.sampleRate,
      channels: stream.channels,
      durationSeconds: stream.durationSeconds,
      offset: stream.offset,
      length: stream.length,
      checksum: stream.checksum
    }]))
  });
}

function decodeMediaToken(token) {
  try {
    return Buffer.from(String(token || ""), "base64url").toString("utf8");
  } catch {
    throw new Error("The local library reference is invalid.");
  }
}

async function playerFileForRequest(id) {
  const localRequest = playerLocalRequests.get(id);
  if (localRequest) return assertAllowedFile(localRequest.filePath);
  const item = requests.find((entry) => entry.id === id);
  if (!item) throw new Error("The request is no longer available.");
  const exact = findMatches(libraryFiles, item.song, item.artist, item.languageCode || item.language, 1)[0];
  return firstAllowedFile([
    queuedEntries.get(id)?.filePath || "",
    vdjRequestFilePaths.get(id) || "",
    exact?.exact ? exact.filePath : ""
  ]);
}

async function servePlayerMedia(request, response, id) {
  const filePath = await playerFileForRequest(id);
  await streamPlayerMedia(request, response, filePath);
}

function playerLibrarySearch(query = "", options = {}) {
  const requestsById = new Map(requests.map(item => [item.id, item]));
  const metadataByPath = new Map();
  for (const entry of [...playerLocalRequests.values(), ...queuedEntries.values()]) {
    if (!entry.filePath) continue;
    const request = requestsById.get(entry.id) || {};
    const source = (youtubeCache.get(entry.id) || []).find(item => item.url && item.url === request.sourceUrl) || {};
    const previous = metadataByPath.get(entry.filePath) || {};
    const known = { ...request, ...entry };
    metadataByPath.set(entry.filePath, {
      song: known.song || previous.song,
      artist: known.artist || previous.artist,
      durationSeconds: Number(known.durationSeconds) || Number(request.durationSeconds) || previous.durationSeconds || 0,
      language: request.language || request.languageCode || known.language || previous.language || '',
      channel: source.channel || source.channelTitle || known.channel || previous.channel || '',
      provider: known.provider || previous.provider || '',
      sourceUrl: request.sourceUrl || previous.sourceUrl || ''
    });
  }
  return queryIndexedLibrary(libraryFiles, (filePath) => {
    const fallback = mediaMetadata(filePath);
    const known = metadataByPath.get(filePath) || {};
    return {
      id: Buffer.from(filePath).toString("base64url"),
      name: basename(filePath, extname(filePath)),
      ...known,
      song: known.song || fallback.song,
      artist: known.artist || fallback.artist,
      extension: extname(filePath).replace(/^\./, "").toUpperCase(),
      mediaType: MIME[extname(filePath).toLowerCase()] || "application/octet-stream"
    };
  }, query, options);
}

async function servePlayerLibraryMedia(request, response, token) {
  const decoded = decodeMediaToken(token);
  const filePath = await assertAllowedFile(decoded);
  await streamPlayerMedia(request, response, filePath);
}

async function assertAllowedBackgroundFile(filePath) {
  const target = await realpath(String(filePath || ""));
  const info = await stat(target);
  if (!info.isFile() || !BACKGROUND_AUDIO_EXTENSIONS.has(extname(target).toLowerCase())) {
    throw new Error("The selected background track is not a compatible audio file.");
  }
  for (const source of config.backgroundMusicSources) {
    try {
      const root = await realpath(source);
      const sourceInfo = await stat(root);
      if (sourceInfo.isFile() && target === root) return target;
      if (sourceInfo.isDirectory() && target.startsWith(`${root}${sep}`)) return target;
    } catch {
      // Ignore sources that disappeared after the last scan.
    }
  }
  throw new Error("The background track is not inside a configured source.");
}

async function serveBackgroundMusic(request, response, token) {
  const filePath = await assertAllowedBackgroundFile(decodeMediaToken(token));
  await streamPlayerMedia(request, response, filePath);
}

function loudnessStore() {
  if (!loudnessAnalysisStore) {
    loudnessAnalysisStore = new LoudnessAnalysisStore({
      cachePath: resolve(STEM_DATA_ROOT, "data", "loudness-analysis.json"),
      ffmpegPath: stemFfmpegPath
    });
  }
  // The bundled FFmpeg path is resolved during capability refresh. Keep the
  // long-lived local cache while allowing a repaired installation to recover.
  loudnessAnalysisStore.ffmpegPath = stemFfmpegPath;
  return loudnessAnalysisStore;
}

async function analyzePlayerLoudness(kind, id, { force = false } = {}) {
  const filePath = kind === "background"
    ? await assertAllowedBackgroundFile(decodeMediaToken(id))
    : await playerFileForRequest(id);
  const analysis = await loudnessStore().analyze(filePath, { force });
  return { ok: true, kind, trackId: id, ...analysis };
}

async function createPlayerLocalRequest(body = {}) {
  if (operatingMode !== "player" || !config.lastActivityId || !tenantState.activity) {
    throw new Error("Select an activity and Player mode before adding a local singer.");
  }
  const singer = String(body.singer || "").trim().slice(0, 100);
  if (!singer) throw new Error("Enter the singer's name.");
  const filePath = await assertAllowedFile(decodeMediaToken(body.trackId));
  const metadata = mediaMetadata(filePath);
  const item = {
    id: `player-local-${randomUUID()}`,
    filePath,
    singer,
    song: metadata.song,
    artist: metadata.artist,
    durationSeconds: 0,
    status: "En fila del Player",
    outcome: "",
    insertedAt: new Date().toISOString(),
    markedAt: ""
  };
  playerLocalRequests.set(item.id, item);
  playerOrder = [...playerOrder.filter((id) => id !== item.id), item.id];
  await persistQueuedEntries();
  // Queue the existing cache/Spleeter/Demucs plan automatically.  This work is
  // explicitly detached from adding the singer: an unavailable engine or a
  // long job must not delay either the queue or playback.
  if (stemEngineAvailable) {
    void enqueueStemRequest(item.id, "auto").catch((error) => {
      recordStemBreadcrumb("STEMS_AUTO_QUEUE_FAILED", {
        summary: errorMessage(error),
        context: { requestId: item.id }
      }, { severity: "WARNING" });
      broadcastState();
    });
  }
  broadcastState();
  return { ok: true, item: playerLocalRequestView(item) };
}

async function streamPlayerMedia(request, response, filePath) {
  const info = await stat(filePath);
  const type = MIME[extname(filePath).toLowerCase()] || "application/octet-stream";
  const range = String(request.headers.range || "").match(/^bytes=(\d*)-(\d*)$/);
  if (!range) {
    response.writeHead(200, { "Content-Type": type, "Content-Length": info.size, "Accept-Ranges": "bytes", "Cache-Control": "no-store" });
    createReadStream(filePath).pipe(response);
    return;
  }
  const start = range[1] ? Number(range[1]) : 0;
  const end = range[2] ? Math.min(Number(range[2]), info.size - 1) : info.size - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= info.size) {
    response.writeHead(416, { "Content-Range": `bytes */${info.size}` });
    response.end();
    return;
  }
  response.writeHead(206, { "Content-Type": type, "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${info.size}`, "Accept-Ranges": "bytes", "Cache-Control": "no-store" });
  createReadStream(filePath, { start, end }).pipe(response);
}

async function firstAllowedFile(candidates) {
  let lastError = null;
  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    try {
      return await assertAllowedFile(candidate);
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  throw new Error("The song is not yet available in the local library.");
}

function removeQueuePosition(id) {
  const removedPosition = vdjQueuePositions.get(id);
  vdjQueuePositions.delete(id);
  if (!Number.isInteger(removedPosition)) return;
  for (const [requestId, position] of vdjQueuePositions) {
    if (position > removedPosition) {
      vdjQueuePositions.set(requestId, position - 1);
    }
  }
  vdjQueueCount = Math.max(0, vdjQueueCount - 1);
}

function appendQueuePosition(id) {
  const knownEnd = Math.max(
    vdjQueueCount,
    ...[...vdjQueuePositions.values()].map((position) => position + 1)
  );
  vdjQueuePositions.set(id, knownEnd);
  vdjQueueCount = knownEnd + 1;
}

async function linkRequestFile(id, requestedPath, source = "manual") {
  if (operatingMode !== "bridge") {
    throw new Error("This activity is not operating in Bridge mode.");
  }
  const item = requests.find((entry) => entry.id === id);
  if (!item) throw new Error("The request is no longer available.");
  if (effectiveRequestOutcome(item)) {
    throw new Error("This request was already marked completed or skipped.");
  }
  const filePath = await firstAllowedFile([requestedPath]);
  requestFileLinks.set(id, {
    id,
    filePath,
    source: source === "automatic" ? "automatic" : "manual",
    updatedAt: new Date().toISOString()
  });
  const tracked = queuedEntries.get(id);
  if (tracked) queuedEntries.set(id, { ...tracked, manualLink: source !== "automatic" });
  item.fileName = basename(filePath);
  item.sourceUrl = "";
  await persistQueuedEntries();
  let warning = "";
  try {
    const updated = await updateBridgeRequest(config, id, item.status, basename(filePath), {
      durationSeconds: item.durationSeconds,
      sourceUrl: ""
    });
    if (updated?.state) applyActivityState(updated);
  } catch (error) {
    warning = `The local link is safe on this Mac, but cloud confirmation is pending: ${errorMessage(error)}`;
  }
  return {
    ok: true,
    linked: true,
    filePath,
    fileName: basename(filePath),
    source: source === "automatic" ? "automatic" : "manual",
    warning
  };
}

async function unlinkRequestFile(id) {
  if (operatingMode !== "bridge") {
    throw new Error("This activity is not operating in Bridge mode.");
  }
  const item = requests.find((entry) => entry.id === id);
  if (!item) throw new Error("The request is no longer available.");
  requestFileLinks.delete(id);
  const tracked = queuedEntries.get(id);
  if (tracked) queuedEntries.set(id, { ...tracked, manualLink: false });
  await persistQueuedEntries();
  const physicalFileName = queuedIds.has(id) ? basename(tracked?.filePath || "") : "";
  let warning = queuedIds.has(id)
    ? "The manual link was cleared. The confirmed VirtualDJ row was left untouched to protect playback."
    : "";
  try {
    const updated = await updateBridgeRequest(config, id, item.status, physicalFileName, {
      durationSeconds: item.durationSeconds
    });
    if (updated?.state) applyActivityState(updated);
  } catch (error) {
    warning = warning || `The link was cleared on this Mac, but cloud confirmation is pending: ${errorMessage(error)}`;
  }
  return { ok: true, unlinked: true, physicalRowPreserved: queuedIds.has(id), warning };
}

async function queueRequest(id, requestedPath) {
  if (operatingMode !== "bridge") {
    throw new Error("This activity is not operating in Bridge mode.");
  }
  const item = requests.find((entry) => entry.id === id);
  if (!item) throw new Error("The request is no longer available.");
  if (effectiveRequestOutcome(item)) {
    throw new Error("This request was already marked completed or skipped.");
  }
  if (vdjQueueCheckPromise) await vdjQueueCheckPromise;
  if (pendingInsertions.has(id)) {
    return {
      ok: true,
      confirmationPending: true,
      warning:
        "VirtualDJ accepted the song. Guest Star is confirming the live queue and will not send a second copy."
    };
  }
  const wasQueued = !suppressedQueueIds.has(id) && queuedIds.has(id);
  const wasRemovedExternally = removedExternallyIds.has(id);
  if (wasQueued) {
    return {
      ok: true,
      alreadyQueued: true,
      linked: true,
      preserved: true,
      warning:
        "The song is already in VirtualDJ. Move it directly in VirtualDJ; the Bridge will preserve the row and follow its new position."
    };
  }
  if (queueLocks.has(id)) throw new Error("This request is already being processed.");
  queueLocks.add(id);
  pendingInsertions.set(id, {
    phase: "adding",
    startedAt: Date.now()
  });
  broadcastState();
  try {
    const exact = matchesForRequest(item, youtubeCache.get(item.id) || [], 1)[0];
    const filePath = await firstAllowedFile([
      requestedPath,
      requestFileLinks.get(id)?.filePath,
      exact?.exact ? exact.filePath : "",
      queuedEntries.get(id)?.filePath
    ]);
    if (requestedPath) {
      requestFileLinks.set(id, {
        id,
        filePath,
        source: "manual",
        updatedAt: new Date().toISOString()
      });
    }
    pendingInsertions.set(id, {
      phase: "confirming",
      startedAt: pendingInsertions.get(id)?.startedAt || Date.now()
    });
    broadcastState();
    const insertionEntry = {
      ...trackingEntryFromRequest(item),
      filePath
    };
    let result;
    try {
      result = await insertKaraokeEntry(
        config.virtualDJ,
        insertionEntry,
        Number.MAX_SAFE_INTEGER
      );
    } catch (error) {
      if (error?.commandAccepted !== true) throw error;
      const uncertainEntry = queuedEntryFromRequest(item, filePath);
      if (uncertainEntry) {
        queuedEntries.set(id, { ...uncertainEntry, manualLink: true });
        await persistQueuedEntries();
      }
      pendingInsertions.set(id, {
        phase: "confirming",
        startedAt: Date.now(),
        accepted: true
      });
      vdjError = "";
      return {
        ok: true,
        confirmationPending: true,
        warning:
          "VirtualDJ accepted the song. Guest Star is confirming the live queue and will not send a second copy."
      };
    }
    if (!result.verified || !result.entry) {
      throw new Error(
        "VirtualDJ received the command but did not confirm the song in the queue."
      );
    }
    const actualEntry = stabilizeVirtualDjEntries(
      [{ ...result.entry, index: result.index }],
      vdjQueueEntries
    )[0];
    suppressedQueueIds.delete(id);
    removedExternallyIds.delete(id);
    transientQueueMissingIds.delete(id);
    queuePresenceMisses.delete(id);
    queuedIds.add(id);
    vdjQueuePositions.set(id, result.index);
    vdjQueueCount = Math.max(vdjQueueCount, result.index + 1);
    const queuedEntry = queuedEntryFromRequest(item, filePath, actualEntry);
    if (queuedEntry) {
      queuedEntries.set(id, queuedEntry);
      await persistQueuedEntries();
    }
    pendingInsertions.delete(id);
    vdjError = "";
    item.status = wasRemovedExternally
      ? "Reagregada a VirtualDJ"
      : "Agregada a VirtualDJ";
    let warning = "";
    try {
      await updateBridgeRequest(config, id, item.status, basename(filePath), {
        durationSeconds: item.durationSeconds,
        virtualDJItemId: queuedEntry?.virtualDJItemId || "",
        queuePosition: result.index,
        syncState: "confirmed",
        lastSeenAt: new Date().toISOString()
      });
    } catch (error) {
      warning = `The song entered VirtualDJ, but Guest Star did not confirm the update: ${errorMessage(error)}`;
    }
    return {
      ok: true,
      result,
      alreadyQueued: result.alreadyQueued === true,
      linked: result.alreadyQueued === true,
      restored: wasRemovedExternally,
      warning
    };
  } catch (error) {
    pendingInsertions.delete(id);
    vdjError = errorMessage(error);
    throw error;
  } finally {
    queueLocks.delete(id);
    broadcastState();
  }
}

async function replaceQueuedRequest(id, requestedPath) {
  if (operatingMode !== "bridge") {
    throw new Error("This activity is not operating in Bridge mode.");
  }
  const item = requests.find((entry) => entry.id === id);
  if (!item) throw new Error("The request is no longer available.");
  if (effectiveRequestOutcome(item)) {
    throw new Error("This request was already marked completed or skipped.");
  }
  if (vdjQueueCheckPromise) await vdjQueueCheckPromise;
  if (queueLocks.has(id)) throw new Error("This request is already being processed.");
  const current = queuedEntries.get(id);
  if (!current || !queuedIds.has(id)) {
    throw new Error("Synchronize first; the linked VirtualDJ row is no longer confirmed.");
  }
  const nextFilePath = await firstAllowedFile([requestedPath]);
  if (normalizeVdjPath(nextFilePath) === normalizeVdjPath(current.filePath)) {
    return { ok: true, alreadyQueued: true, linked: true };
  }
  const activeDeck = vdjOperations.view().decks.find((deck) =>
    deck.playing === true &&
    normalizeVdjPath(deck.filePath) === normalizeVdjPath(current.filePath)
  );
  if (activeDeck) {
    const link = await linkRequestFile(id, nextFilePath, "manual");
    return {
      ...link,
      replaced: false,
      requiresSafeReplace: true,
      warning: `The request now points to ${basename(nextFilePath)}, but deck ${activeDeck.deck} is playing the previous file. The live VirtualDJ row was not interrupted; replace it after playback stops.`
    };
  }

  queueLocks.add(id);
  try {
    const removal = await removeKaraokeEntry(config.virtualDJ, current);
    if (removal.reason === "ambiguous") {
      throw new Error(
        "VirtualDJ has ambiguous copies; change the correct row directly in VirtualDJ."
      );
    }
    if (removal.removed !== true) {
      throw new Error(
        "The linked row could not be identified safely, so the Bridge did not remove or replace anything."
      );
    }

    const originalPosition = Number.isInteger(removal.index)
      ? removal.index
      : vdjQueuePositions.get(id) || 0;
    let result;
    try {
      result = await insertKaraokeEntry(config.virtualDJ, {
        ...trackingEntryFromRequest(item),
        filePath: nextFilePath
      }, originalPosition);
    } catch (error) {
      let restored = false;
      try {
        const rollback = await insertKaraokeEntry(
          config.virtualDJ,
          current,
          originalPosition
        );
        restored = rollback.verified === true;
      } catch {
        restored = false;
      }
      throw new Error(
        restored
          ? `The replacement failed and the original VirtualDJ row was restored: ${errorMessage(error)}`
          : `The replacement failed and the original row could not be restored automatically: ${errorMessage(error)}`
      );
    }

    const actualEntry = stabilizeVirtualDjEntries(
      [{ ...result.entry, index: result.index }],
      vdjQueueEntries
    )[0];
    requestFileLinks.set(id, {
      id,
      filePath: nextFilePath,
      source: "manual",
      updatedAt: new Date().toISOString()
    });
    const linkedEntry = queuedEntryFromRequest(
      item,
      nextFilePath,
      actualEntry
    );
    if (!linkedEntry) {
      throw new Error("VirtualDJ confirmed the replacement, but its row could not be linked.");
    }
    queuedEntries.set(id, linkedEntry);
    queuedIds.add(id);
    suppressedQueueIds.delete(id);
    removedExternallyIds.delete(id);
    pendingInsertions.delete(id);
    queuePresenceMisses.delete(id);
    transientQueueMissingIds.delete(id);
    vdjQueuePositions.set(id, result.index);
    await persistQueuedEntries();
    item.status = "Reagregada a VirtualDJ";
    let warning = "";
    try {
      await updateBridgeRequest(
        config,
        id,
        item.status,
        basename(nextFilePath),
        {
          durationSeconds: item.durationSeconds,
          virtualDJItemId: linkedEntry.virtualDJItemId,
          queuePosition: result.index,
          syncState: "confirmed",
          lastSeenAt: new Date().toISOString()
        }
      );
    } catch (error) {
      warning =
        `The file was replaced in VirtualDJ, but Guest Star did not confirm the update: ${errorMessage(error)}`;
    }
    return {
      ok: true,
      replaced: true,
      queuePosition: result.index + 1,
      fileName: basename(nextFilePath),
      warning
    };
  } finally {
    queueLocks.delete(id);
    await reconcileVirtualDjQueue(true);
  }
}

async function removeQueuedRequest(id) {
  if (operatingMode !== "bridge") {
    throw new Error("This activity is not operating in Bridge mode.");
  }
  const item = requests.find((entry) => entry.id === id);
  if (!item) throw new Error("The request is no longer available.");
  if (vdjQueueCheckPromise) await vdjQueueCheckPromise;
  if (queueLocks.has(id)) throw new Error("This request is already being processed.");
  queueLocks.add(id);
  try {
    const entry = queuedEntries.get(id) || queuedEntryFromRequest(item);
    if (!entry) {
      throw new Error("The file associated with this request was not found.");
    }
    const result = await removeKaraokeEntry(config.virtualDJ, entry);
    if (result.reason === "ambiguous") {
      throw new Error(
        "VirtualDJ has more than one identical copy; none were removed for safety."
      );
    }

    queuedIds.delete(id);
    removedExternallyIds.delete(id);
    removeQueuePosition(id);
    queuedEntries.delete(id);
    suppressedQueueIds.add(id);
    pendingInsertions.delete(id);
    queuePresenceMisses.delete(id);
    transientQueueMissingIds.delete(id);
    await persistQueuedEntries();
    vdjError = "";
    item.status = "Retirada de rotación";
    let warning =
      result.reason === "not-found"
        ? "The song was no longer in VirtualDJ; the local status was updated."
        : "";
    try {
      await updateBridgeRequest(config, id, item.status, "");
    } catch (error) {
      warning =
        warning ||
        `The song was removed from VirtualDJ, but Guest Star did not confirm the update: ${errorMessage(error)}`;
    }
    return {
      ok: true,
      removed: result.removed === true,
      verified: result.verified === true || result.reason === "not-found",
      singer: item.singer,
      song: item.song,
      status: item.status,
      warning
    };
  } catch (error) {
    vdjError = errorMessage(error);
    throw error;
  } finally {
    queueLocks.delete(id);
    await reconcileVirtualDjQueue(true);
  }
}

async function dismissRequeue(id) {
  const item = requests.find((entry) => entry.id === id);
  if (!item) throw new Error("The request is no longer available.");
  queuedIds.delete(id);
  removedExternallyIds.delete(id);
  removeQueuePosition(id);
  queuedEntries.delete(id);
  suppressedQueueIds.add(id);
  pendingInsertions.delete(id);
  queuePresenceMisses.delete(id);
  transientQueueMissingIds.delete(id);
  await persistQueuedEntries();
  item.status = "Fuera de VirtualDJ";
  let warning = "";
  try {
    await updateBridgeRequest(config, id, item.status, "");
  } catch (error) {
    warning = `The decision was saved locally, but Guest Star did not confirm the update: ${errorMessage(error)}`;
  }
  return { ok: true, warning };
}

async function setRequestOutcome(id, outcome, options = {}) {
  if (options.origin !== 'VDJ_EVENT') vdjOperations.invalidate(id);
  const previous = outcomeOperations.get(id);
  const promise = (async () => {
    if (previous) await previous.catch(() => {});
    return commitRequestOutcome(id, outcome, options);
  })();
  outcomeOperations.set(id, promise);
  try { return await promise; }
  finally { if (outcomeOperations.get(id) === promise) outcomeOperations.delete(id); }
}

async function commitRequestOutcome(id, outcome, { origin = 'USER_ACTION', version, removeVDJ = true } = {}) {
  if (operatingMode !== "bridge") {
    throw new Error("Use the internal Player controls for this activity.");
  }
  const item = requests.find((entry) => entry.id === id);
  if (!item) throw new Error("The request is no longer available.");
  if (!["completed", "skipped", "removed"].includes(outcome)) {
    throw new Error("Song outcome is not allowed.");
  }
  if (queueLocks.has(id)) throw new Error("This request is already being processed.");
  if (origin === 'VDJ_EVENT' && (effectiveRequestOutcome(item) || item.stateRevision !== version)) return { ok: true, ignored: true };
  if (effectiveRequestOutcome(item) === outcome) return { ok: true, alreadyMarked: true, outcome, status: item.status };
  queueLocks.add(id);
  const status = outcome === "completed" ? "Ya cantó" : outcome === 'skipped' ? "Saltado" : 'Eliminada';
  try {
    const priorRecovery = outcomeRecoveries.get(id);
    const previousStatus = priorRecovery?.previousStatus || item.status || 'Pendiente';
    const entry = queuedEntries.get(id) || priorRecovery?.entry || queuedEntryFromRequest(item);
    let originalPosition = vdjQueuePositions.get(id) ?? priorRecovery?.originalPosition;
    let warning = "";
    let removedFromVirtualDJ = false;

    let remoteResult = null;
    if (origin === 'VDJ_EVENT') {
      // CAS at the existing service prevents an older automatic Played edge
      // from overwriting a remote/manual terminal decision.
      remoteResult = await updateBridgeRequest(config, id, status,
        basename(entry?.filePath || item.fileName || ''),
        { durationSeconds: item.durationSeconds, expectedRevision: version, eventOrigin: origin });
      if (!remoteResult?.request || remoteResult.request.status !== status ||
          Number(remoteResult.request.stateRevision) <= version) return { ok: true, ignored: true };
    }
    vdjOperations.invalidate(id);

    outcomeRecoveries.set(id, {
      id,
      outcome,
      previousStatus,
      originalPosition: Number.isInteger(originalPosition)
        ? originalPosition
        : null,
      markedAt: new Date().toISOString(),
      entry: entry || null
    });
    queuedIds.delete(id);
    removedExternallyIds.delete(id);
    if (vdjQueuePositions.has(id)) removeQueuePosition(id);
    queuedEntries.delete(id);
    suppressedQueueIds.add(id);
    pendingInsertions.delete(id);
    queuePresenceMisses.delete(id);
    transientQueueMissingIds.delete(id);
    item.status = status;
    await persistQueuedEntries();
    broadcastState();

    try {
      const data = remoteResult || await updateBridgeRequest(
        config,
        id,
        status,
        basename(entry?.filePath || item.fileName || ""),
        { durationSeconds: item.durationSeconds, eventOrigin: origin }
      );
      if (data?.state) applyActivityState(data);
      if (data?.request?.stateRevision) item.stateRevision = Number(data.request.stateRevision);
    } catch (error) {
      warning =
        `The outcome is visible in Bridge, but Guest Star did not confirm the update: ${errorMessage(error)}`;
    }
    if (entry && removeVDJ) {
      try {
        const result = await removeKaraokeEntry(config.virtualDJ, entry);
        if (result.reason === 'ambiguous') throw new Error('VDJ has ambiguous copies; no physical row was removed.');
        removedFromVirtualDJ = result.removed === true || result.reason === 'not-found';
      } catch (error) {
        warning = [warning, `The administrative decision was saved; VDJ could not remove its row: ${errorMessage(error)}`].filter(Boolean).join(' ');
      }
    }
    return {
      ok: true,
      status,
      outcome,
      singer: item.singer,
      song: item.song,
      removedFromVirtualDJ,
      undoOriginalPosition: Number.isInteger(originalPosition)
        ? originalPosition + 1
        : null,
      warning
    };
  } finally {
    queueLocks.delete(id);
    await reconcileVirtualDjQueue(true);
  }
}

async function setPlayerRequestOutcome(id, outcome) {
  if (operatingMode !== "player" || (!activityState.activityRunning && outcome !== "removed")) {
    throw new Error("Start this activity in Player mode before completing or skipping a song.");
  }
  const localItem = playerLocalRequests.get(id);
  if (localItem) {
    if (!["completed", "skipped", "removed"].includes(outcome)) throw new Error("Song outcome is not allowed.");
    if (localItem.outcome) throw new Error("This request was already marked completed or skipped.");
    if (queueLocks.has(id)) throw new Error("This request is already being processed.");
    queueLocks.add(id);
    try {
      localItem.outcome = outcome;
      localItem.status = outcome === "completed" ? "Ya cantó" : outcome === "skipped" ? "Saltado" : "Retirada del Player";
      localItem.markedAt = new Date().toISOString();
      playerOrder = playerOrder.filter((entryId) => entryId !== id);
      if (playerPlayback.currentRequestId === id) {
        playerPlayback = {
          currentRequestId: "",
          currentTimeSeconds: 0,
          scene: "lobby",
          wasPlaying: false,
          updatedAt: new Date().toISOString()
        };
      }
      await persistQueuedEntries();
      return {
        ok: true,
        status: localItem.status,
        outcome,
        singer: localItem.singer,
        song: localItem.song,
        playerMode: true,
        localPlayerRequest: true,
        warning: ""
      };
    } finally {
      queueLocks.delete(id);
    }
  }
  const item = requests.find((entry) => entry.id === id);
  if (!item) throw new Error("The request is no longer available.");
  if (!["completed", "skipped", "removed"].includes(outcome)) throw new Error("Song outcome is not allowed.");
  if (queueLocks.has(id)) throw new Error("This request is already being processed.");
  queueLocks.add(id);
  const status = outcome === "completed" ? "Ya cantó" : outcome === "skipped" ? "Saltado" : "Retirada del Player";
  try {
    const entry = queuedEntries.get(id) || queuedEntryFromRequest(item);
    outcomeRecoveries.set(id, { id, outcome, previousStatus: item.status || "Pendiente", originalPosition: null, markedAt: new Date().toISOString(), entry: entry || null, playerMode: true });
    queuedIds.delete(id);
    removedExternallyIds.delete(id);
    vdjQueuePositions.delete(id);
    queuedEntries.delete(id);
    suppressedQueueIds.add(id);
    pendingInsertions.delete(id);
    queuePresenceMisses.delete(id);
    transientQueueMissingIds.delete(id);
    playerOrder = playerOrder.filter((entryId) => entryId !== id);
    if (playerPlayback.currentRequestId === id) {
      playerPlayback = {
        currentRequestId: "",
        currentTimeSeconds: 0,
        scene: "lobby",
        wasPlaying: false,
        updatedAt: new Date().toISOString()
      };
    }
    await persistQueuedEntries();
    item.status = status;
    let warning = "";
    try {
      const data = await updateBridgeRequest(config, id, status, basename(entry?.filePath || item.fileName || ""), { durationSeconds: item.durationSeconds });
      if (data?.state) applyActivityState(data);
    } catch (error) {
      warning = `The Player saved the outcome locally, but Guest Star did not confirm the update: ${errorMessage(error)}`;
    }
    return { ok: true, status, outcome, singer: item.singer, song: item.song, playerMode: true, warning };
  } finally {
    queueLocks.delete(id);
  }
}

async function undoPlayerRequestOutcome(id) {
  if (operatingMode !== "player" || !activityState.activityRunning) {
    throw new Error("The Player queue is not active.");
  }
  const localItem = playerLocalRequests.get(id);
  if (localItem) {
    if (!localItem.outcome) throw new Error("This request is not completed or skipped.");
    if (queueLocks.has(id)) throw new Error("This request is already being processed.");
    queueLocks.add(id);
    try {
      localItem.outcome = "";
      localItem.status = "En fila del Player";
      localItem.markedAt = "";
      playerOrder = [...playerOrder.filter((entryId) => entryId !== id), id];
      await persistQueuedEntries();
      return { ok: true, restored: true, playerMode: true, localPlayerRequest: true };
    } finally {
      queueLocks.delete(id);
    }
  }
  const item = requests.find((entry) => entry.id === id);
  if (!item) throw new Error("The request is no longer available.");
  if (!effectiveRequestOutcome(item)) {
    throw new Error("This request is not completed or skipped.");
  }
  outcomeRecoveries.delete(id);
  suppressedQueueIds.delete(id);
  const exact = findMatches(
    libraryFiles,
    item.song,
    item.artist,
    item.languageCode || item.language,
    1
  )[0];
  item.status = exact?.exact ? "Local encontrado" : "No está local";
  playerOrder = [...playerOrder.filter((entryId) => entryId !== id), id];
  await persistQueuedEntries();
  try {
    const data = await updateBridgeRequest(
      config,
      id,
      item.status,
      exact?.exact ? basename(exact.filePath) : "",
      { durationSeconds: item.durationSeconds }
    );
    if (data?.state) applyActivityState(data);
  } catch {
    // The local Player remains authoritative and retries on the next sync.
  }
  return { ok: true, id, status: item.status, playerMode: true };
}

async function undoRequestOutcome(id, placement) {
  if (operatingMode !== "bridge") {
    throw new Error("Use the internal Player history for this activity.");
  }
  const item = requests.find((entry) => entry.id === id);
  if (!item) throw new Error("The request is no longer available.");
  if (!effectiveRequestOutcome(item)) {
    throw new Error("This request is no longer marked completed or skipped.");
  }
  if (!["original", "end", "pending"].includes(placement)) {
    throw new Error("Choose how you want to restore the song.");
  }
  if (queueLocks.has(id)) throw new Error("This request is already being processed.");
  queueLocks.add(id);
  vdjOperations.invalidate(id);

  try {
    const recovery = outcomeRecoveries.get(id);
    const entry =
      recovery?.entry ||
      queuedEntryFromRequest(item) ||
      queuedEntryFromRequest(
        item,
        findMatches(
          libraryFiles,
          item.song,
          item.artist,
          item.languageCode || item.language,
          1
        )[0]?.filePath || ""
      );
    if (placement === "original" && !Number.isInteger(recovery?.originalPosition)) {
      throw new Error(
        "No se pudo recuperar el turno anterior. Puedes agregarla al final."
      );
    }
    if (placement !== "pending" && !entry) {
      throw new Error(
        "The file is no longer available locally. Undo without adding it, or restore the track to the library."
      );
    }

    const pendingStatus = "Fuera de VirtualDJ";
    const pendingUpdate = await updateBridgeRequest(
      config,
      id,
      pendingStatus,
      basename(entry?.filePath || item.fileName || ""),
      { durationSeconds: item.durationSeconds }
    );
    if (pendingUpdate?.state) applyActivityState(pendingUpdate);
    item.status = pendingStatus;
    queuedIds.delete(id);
    removedExternallyIds.delete(id);
    vdjQueuePositions.delete(id);
    queuedEntries.delete(id);
    suppressedQueueIds.add(id);
    pendingInsertions.delete(id);
    queuePresenceMisses.delete(id);
    transientQueueMissingIds.delete(id);

    let restoredPosition = null;
    if (placement !== "pending") {
      const desiredPosition =
        placement === "original"
          ? recovery.originalPosition
          : Number.MAX_SAFE_INTEGER;
      const restored = await insertKaraokeEntry(
        config.virtualDJ,
        entry,
        desiredPosition
      );
      restoredPosition = restored.index;
      queuedEntries.set(id, entry);
      queuedIds.add(id);
      suppressedQueueIds.delete(id);
      vdjQueuePositions.set(id, restored.index);
      item.status = "Reagregada a VirtualDJ";
      const queuedUpdate = await updateBridgeRequest(
        config,
        id,
        item.status,
        basename(entry.filePath),
        { durationSeconds: item.durationSeconds }
      );
      if (queuedUpdate?.state) applyActivityState(queuedUpdate);
    }

    outcomeRecoveries.delete(id);
    await persistQueuedEntries();
    return {
      ok: true,
      placement,
      restoredToVirtualDJ: placement !== "pending",
      queuePosition: Number.isInteger(restoredPosition)
        ? restoredPosition + 1
        : null,
      singer: item.singer,
      song: item.song,
      status: item.status
    };
  } finally {
    queueLocks.delete(id);
    await reconcileVirtualDjQueue(true);
  }
}

function hitSuggestionKey(item = {}) {
  return [item.song, item.artist, item.language]
    .map((value) => normalizeText(value))
    .join("|");
}

async function findHitSuggestionYoutube(body = {}) {
  const suggestions = selectHitSuggestions(
    requests,
    libraryFiles,
    activityState.activityId,
    6
  );
  const requested = {
    song: String(body.song || "").trim(),
    artist: String(body.artist || "").trim(),
    language: String(body.language || "Español")
  };
  const favorites = config.lastHotelId ? favoritesForHotel(config.lastHotelId) : [];
  const suggestion = suggestions.find(
    (item) =>
      normalizeText(item.song) === normalizeText(body.song) &&
      normalizeText(item.artist) === normalizeText(body.artist)
  ) || (isKnownRotationSong(requested, favorites)
    ? rotationItemView(requested, String(body.list || "favorites"))
    : null);
  if (!suggestion) throw new Error("The suggestion is no longer available.");
  const key = hitSuggestionKey(suggestion);
  if (body.force === true) hitYoutubeCache.delete(key);
  if (hitYoutubeCache.has(key)) return hitYoutubeCache.get(key);
  const data = await searchKaraokeYouTube(
    config,
    suggestion.song,
    suggestion.artist,
    suggestion.language,
    suggestion.languageCode || ""
  );
  const items = selectYoutubeOptions(
    Array.isArray(data.items) ? data.items : [],
    1
  );
  hitYoutubeCache.set(key, items);
  return items;
}

async function prepareHitSuggestionYoutube() {
  if (!guestStarConfigured() || vdjQueueCount > 0) return;
  const target = selectHitSuggestions(
    requests,
    libraryFiles,
    activityState.activityId,
    6
  ).find(
    (item) => !item.localAvailable && !hitYoutubeCache.has(hitSuggestionKey(item))
  );
  if (!target) return;
  try {
    await findHitSuggestionYoutube(target);
  } catch {
    hitYoutubeCache.set(hitSuggestionKey(target), []);
  }
  broadcastState();
}

async function queueHitSuggestion(body = {}) {
  const automaticSuggestions = selectHitSuggestions(
    requests,
    libraryFiles,
    activityState.activityId,
    6
  );
  const song = String(body.song || "").trim();
  const artist = String(body.artist || "").trim();
  const requested = {
    song,
    artist,
    language: String(body.language || "Español")
  };
  const favorites = config.lastHotelId ? favoritesForHotel(config.lastHotelId) : [];
  const known = isKnownRotationSong(requested, favorites);
  const suggestion = automaticSuggestions.find(
    (item) =>
      normalizeText(item.song) === normalizeText(song) &&
      normalizeText(item.artist) === normalizeText(artist)
  ) || (known ? rotationItemView(requested, String(body.list || "favorites")) : null);
  if (!suggestion) throw new Error("The suggestion is no longer available.");
  if (!suggestion.localAvailable || !suggestion.filePath) {
    throw new Error("That suggested song is not yet in the local library.");
  }

  let singer = "EMCEE";
  if (body.singerMode === "random") {
    const candidates = [
      ...new Set(
        requests
          .filter((item) => effectiveRequestOutcome(item) !== "skipped")
          .map((item) => item.singer)
          .filter(Boolean)
      )
    ];
    if (!candidates.length) {
      throw new Error("There are no registered participants to choose from yet.");
    }
    singer = candidates[Math.floor(Math.random() * candidates.length)];
  }
  const filePath = await assertAllowedFile(suggestion.filePath);
  const result = await executeVdj(
    config.virtualDJ,
    buildKaraokeScript(filePath, singer)
  );
  vdjQueueHasSnapshot = false;
  await reconcileVirtualDjQueue(true);
  return {
    ok: true,
    result,
    singer,
    song: suggestion.song,
    artist: suggestion.artist
  };
}

async function autoQueueExactMatches() {
  if (vdjQueueOperationBusy) return;
  if (!config.autoQueueExact) return;
  for (const item of requests) {
    if (effectiveRequestOutcome(item)) continue;
    if (
      queuedIds.has(item.id) ||
      removedExternallyIds.has(item.id) ||
      suppressedQueueIds.has(item.id) ||
      pendingInsertions.has(item.id) ||
      queueLocks.has(item.id)
    ) {
      continue;
    }
    const top = matchesForRequest(item, youtubeCache.get(item.id) || [], 2)[0];
    if (!top?.autoLinkEligible) continue;
    try {
      await queueRequest(item.id, "");
    } catch {
      // The error is exposed in the local panel and the host can retry manually.
    }
  }
}

async function autoLinkSafeMatches() {
  let changed = false;
  for (const item of requests) {
    if (effectiveRequestOutcome(item)) continue;
    const existing = requestFileLinks.get(item.id);
    if (existing?.source === "manual") continue;
    if (existing?.source === "automatic" && libraryFiles.includes(existing.filePath)) continue;
    const top = matchesForRequest(item, youtubeCache.get(item.id) || [], 2)[0];
    if (!top?.autoLinkEligible) continue;
    requestFileLinks.set(item.id, {
      id: item.id,
      filePath: top.filePath,
      source: "automatic",
      updatedAt: new Date().toISOString()
    });
    changed = true;
  }
  if (changed) await persistQueuedEntries();
  return changed;
}

async function findYoutube(id) {
  if (youtubeSearches.has(id)) return youtubeSearches.get(id);
  const item = requests.find((entry) => entry.id === id);
  if (!item) throw new Error("The request is no longer available.");

  const operation = (async () => {
    let results = [];
    try {
      const data = await searchKaraokeYouTube(
        config,
        item.song,
        item.artist,
        item.language,
        item.languageCode
      );
      results = Array.isArray(data.items) ? data.items : [];
    } catch {
      results = [];
    }
    results = selectYoutubeOptions(results, 6);
    youtubeCache.set(id, results);
    youtubeSearchAt.set(id, Date.now());
    return results;
  })();
  youtubeSearches.set(id, operation);
  broadcastState();
  try {
    return await operation;
  } finally {
    youtubeSearches.delete(id);
    broadcastState();
  }
}

async function prepareMissingYoutube() {
  if (!guestStarConfigured()) return;
  const missing = requests.filter(
    (item) =>
      !effectiveRequestOutcome(item) &&
      !findMatches(
        libraryFiles,
        item.song,
        item.artist,
        item.languageCode || item.language,
        1
      )[0]?.exact &&
      !vdjAvailablePaths.has(
        normalizeVdjPath(
          vdjRequestFilePaths.get(item.id) ||
          queuedEntries.get(item.id)?.filePath ||
          ""
        )
      )
  );
  const unhandled = missing.filter((item) => !clipboardHandledIds.has(item.id));
  const now = Date.now();
  const retryAfterMs = 5 * 60 * 1000;
  const needsSearch = missing.filter((item) => {
    if (!youtubeCache.has(item.id)) return true;
    const cached = youtubeCache.get(item.id) || [];
    const lastAttempt = youtubeSearchAt.get(item.id) || 0;
    return cached.length === 0 && now - lastAttempt >= retryAfterMs;
  });
  if (!unhandled.length && !needsSearch.length) return;

  for (const item of needsSearch) {
    try {
      await findYoutube(item.id);
    } catch {
      youtubeCache.set(item.id, []);
      youtubeSearchAt.set(item.id, Date.now());
    }
  }

  if (!unhandled.length) return;
  unhandled.forEach((item) => clipboardHandledIds.add(item.id));
  const target = unhandled[unhandled.length - 1];
  const best = youtubeCache.get(target.id)?.[0];
  if (!best) {
    clipboardState = {
      requestId: target.id,
      url: "",
      resultType: "",
      notice: "No sufficiently reliable video with visible lyrics was found yet.",
      copiedAt: "",
      error: "No recommended link was found."
    };
    broadcastState();
    return;
  }

  clipboardState = {
    requestId: target.id,
    url: best.url,
    resultType: best.resultType || "",
    notice: best.notice || "",
    copiedAt: "",
    error: ""
  };
  broadcastState();
}

async function chooseFolder(prompt = "Choose your karaoke song folder") {
  if (process.platform !== "darwin") {
    throw new Error("The automatic folder picker is available when Bridge runs on Mac.");
  }
  const safePrompt = String(prompt).replace(/["\\]/g, " ");
  const script = `POSIX path of (choose folder with prompt "${safePrompt}")`;
  const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 120000 });
  return stdout.trim().replace(/\/$/, "");
}

async function chooseBackgroundAudioFile() {
  if (process.platform !== "darwin") {
    throw new Error("The automatic file picker is available when Guest Star runs on Mac.");
  }
  const script = 'POSIX path of (choose file with prompt "Choose one background music audio file")';
  const { stdout } = await execFileAsync("osascript", ["-e", script], { timeout: 120000 });
  const filePath = stdout.trim();
  const info = await stat(filePath);
  if (!info.isFile() || !BACKGROUND_AUDIO_EXTENSIONS.has(extname(filePath).toLowerCase())) {
    throw new Error("Choose an MP3, M4A, WAV, OGG, AAC or FLAC audio file.");
  }
  return filePath;
}

async function openStarScreenWindow() {
  if (operatingMode !== "player" || !config.lastActivityId || !tenantState.activity) {
    throw new Error("Select an activity and Player mode before opening Star Screen.");
  }
  const url = `http://127.0.0.1:${runtimePort}/star-screen.html?display=1`;
  const opened = await openMacUrl(url);
  return { ok: true, url: opened, mode: "browser-fallback", reused: false };
}

async function serveStatic(pathname, response) {
  const relative = pathname === "/"
    ? "index.html"
    : pathname === "/google-sign-in"
      ? "google-sign-in.html"
      : pathname.replace(/^\/+/, "");
  const filePath = resolve(PUBLIC_DIR, relative);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(`${PUBLIC_DIR}${sep}`)) {
    json(response, 403, { ok: false, error: "Ruta no permitida." });
    return;
  }
  try {
    await access(filePath);
    const info = await stat(filePath);
    if (!info.isFile()) throw new Error("not-file");
    response.writeHead(200, {
      "Content-Type": MIME[extname(filePath)] || "application/octet-stream",
      "Content-Length": info.size,
      "Cache-Control": "no-store"
    });
    createReadStream(filePath).pipe(response);
  } catch {
    json(response, 404, { ok: false, error: "No encontrado." });
  }
}

function songStorageOptions() {
  return {
    libraryFolders: config.libraryFolders,
    temporaryRoot: tmpdir(),
    home: homedir()
  };
}

let songStorageScan = null;
let songStorageScanKey = "";
async function songStorageView() {
  const options = songStorageOptions();
  const key = JSON.stringify(options);
  if (!songStorageScan || key !== songStorageScanKey) {
    songStorageScanKey = key;
    const scan = inspectSongStorage(options).then((usage) => ({
      ok: true,
      ...usage,
      locations: usage.locations.map(({ fallbackPath, ...location }) => location)
    })).finally(() => { if (songStorageScan === scan) songStorageScan = null; });
    songStorageScan = scan;
  }
  return songStorageScan;
}

async function api(request, response, url) {
  const { pathname } = url;
  const bridgeMutation = request.method === 'POST' && (
    pathname.startsWith('/api/virtualdj/') || /\/api\/requests\/[^/]+\/(metadata|move)$/.test(pathname));
  if (bridgeMutation && request.headers.origin && request.headers.origin !== `http://${String(request.headers.host || '')}`) {
    json(response, 403, { ok: false, error: 'Cross-origin Bridge commands are not allowed.' }); return;
  }
  if (request.method === 'POST' && pathname === '/api/virtualdj/control') {
    requireSignedInBridge();
    const body = await readJson(request);
    const data = body.action === 'skip'
      ? await runVdjQueueOperation(body, () => skipVdjTrack(body))
      : await vdjOperations.command(body);
    json(response, 200, data);
    return;
  }
  if (request.method === 'POST' && pathname === '/api/virtualdj/queue/move') {
    requireSignedInBridge();
    if (operatingMode !== 'bridge') throw new Error('Reorder here belongs to Bridge mode.');
    const body = await readJson(request);
    const data = await runVdjQueueOperation(body, async () => {
      const source = bridgeQueueEntry(String(body.sourceId || ''));
      const target = body.beforeId === null ? null : bridgeQueueEntry(String(body.beforeId || ''));
      if (!source || (body.beforeId !== null && !target)) throw new Error('The queue source/destination disappeared.');
      const result = await moveKaraokeEntry(config.virtualDJ, source, target);
      return { ok: true, moved: result.moved };
    });
    json(response, 200, data);
    return;
  }
  const metadataMatch = pathname.match(/^\/api\/requests\/([^/]+)\/metadata$/);
  if (request.method === 'POST' && metadataMatch) {
    requireSignedInBridge();
    json(response, 200, await editBridgeMetadata(decodeURIComponent(metadataMatch[1]), await readJson(request)));
    return;
  }
  const moveRequestMatch = pathname.match(/^\/api\/requests\/([^/]+)\/move$/);
  if (request.method === 'POST' && moveRequestMatch) {
    requireSignedInBridge();
    const body = await readJson(request);
    json(response, 200, await runVdjQueueOperation(body, () => moveBridgeRequest(decodeURIComponent(moveRequestMatch[1]), body)));
    return;
  }
  if (request.method === "GET" && pathname === "/api/player/library") {
    const offset = Math.max(0, Math.floor(Number(url.searchParams.get("offset")) || 0));
    const limit = Math.max(1, Math.min(100, Math.floor(Number(url.searchParams.get("limit")) || 60)));
    const result = playerLibrarySearch(
      url.searchParams.get("query") || "",
      { offset, limit, includeAll: url.searchParams.get("all") === "1", sort: url.searchParams.get("sort") || "title", language: url.searchParams.get("language") || "" }
    );
    json(response, 200, { ok: true, ...result });
    return;
  }
  if (request.method === "POST" && pathname === "/api/player/runtime") {
    requireSignedInBridge();
    json(response, 200, await updatePlayerRuntime(await readJson(request)));
    return;
  }
  if (request.method === "POST" && pathname === "/api/player/local-requests") {
    requireSignedInBridge();
    json(response, 200, await createPlayerLocalRequest(await readJson(request)));
    return;
  }
  const loudnessMatch = pathname.match(/^\/api\/player\/loudness\/(karaoke|background)\/([^/]+)$/);
  if ((request.method === "GET" || request.method === "POST") && loudnessMatch) {
    const body = request.method === "POST" ? await readJson(request) : {};
    json(response, 200, await analyzePlayerLoudness(
      loudnessMatch[1],
      decodeURIComponent(loudnessMatch[2]),
      { force: body.force === true }
    ));
    return;
  }
  const backgroundMediaMatch = pathname.match(/^\/api\/player\/background\/media\/([^/]+)$/);
  if (request.method === "GET" && backgroundMediaMatch) {
    await serveBackgroundMusic(request, response, decodeURIComponent(backgroundMediaMatch[1]));
    return;
  }
  if (request.method === "POST" && pathname === "/api/player/background/choose-folder") {
    requireSignedInBridge();
    const folder = await chooseFolder("Choose the folder with your background music");
    config = await saveConfig(sanitizeConfig({
      backgroundMusicSources: [...config.backgroundMusicSources, folder]
    }, config));
    await scanBackgroundMusicNow();
    broadcastState();
    json(response, 200, stateView());
    return;
  }
  if (request.method === "POST" && pathname === "/api/player/background/choose-file") {
    requireSignedInBridge();
    const filePath = await chooseBackgroundAudioFile();
    config = await saveConfig(sanitizeConfig({
      backgroundMusicSources: [...config.backgroundMusicSources, filePath]
    }, config));
    await scanBackgroundMusicNow();
    broadcastState();
    json(response, 200, stateView());
    return;
  }
  if (request.method === "POST" && pathname === "/api/player/background/config") {
    requireSignedInBridge();
    const body = await readJson(request);
    config = await saveConfig(sanitizeConfig({
      backgroundMusicSources: Array.isArray(body.sources)
        ? body.sources
        : config.backgroundMusicSources,
      backgroundMusicVolume: body.volume === undefined
        ? config.backgroundMusicVolume
        : body.volume
    }, config));
    await scanBackgroundMusicNow();
    broadcastState();
    json(response, 200, stateView());
    return;
  }
  const playerLibraryMediaMatch = pathname.match(/^\/api\/player\/library-media\/([^/]+)$/);
  if (request.method === "GET" && playerLibraryMediaMatch) {
    await servePlayerLibraryMedia(request, response, decodeURIComponent(playerLibraryMediaMatch[1]));
    return;
  }
  const playerStemMediaMatch = pathname.match(/^\/api\/player\/stems\/([^/]+)\/(instrumental|vocals)$/);
  if (request.method === "GET" && playerStemMediaMatch) {
    await servePlayerStem(
      request,
      response,
      decodeURIComponent(playerStemMediaMatch[1]),
      playerStemMediaMatch[2],
      String(url.searchParams.get("engine") || "").toLowerCase()
    );
    return;
  }
  const playerGSXDescriptorMatch = pathname.match(/^\/api\/player\/stems\/([^/]+)\/container$/);
  if (request.method === "GET" && playerGSXDescriptorMatch) {
    await servePlayerGSXDescriptor(
      response,
      decodeURIComponent(playerGSXDescriptorMatch[1]),
      String(url.searchParams.get("engine") || "").toLowerCase()
    );
    return;
  }
  const playerStemRequestMatch = pathname.match(/^\/api\/player\/requests\/([^/]+)\/stems$/);
  if (request.method === "POST" && playerStemRequestMatch) {
    requireSignedInBridge();
    const body = await readJson(request);
    json(response, 200, await enqueueStemRequest(
      decodeURIComponent(playerStemRequestMatch[1]),
      body.engine
    ));
    return;
  }
  const playerMediaMatch = pathname.match(/^\/api\/player\/media\/([^/]+)$/);
  if (request.method === "GET" && playerMediaMatch) {
    await servePlayerMedia(request, response, decodeURIComponent(playerMediaMatch[1]));
    return;
  }
  const playerOutcomeMatch = pathname.match(/^\/api\/player\/requests\/([^/]+)\/outcome$/);
  if (request.method === "POST" && playerOutcomeMatch) {
    const body = await readJson(request);
    const data = await setPlayerRequestOutcome(decodeURIComponent(playerOutcomeMatch[1]), String(body.outcome || ""));
    broadcastState();
    json(response, 200, data);
    return;
  }
  const playerUndoMatch = pathname.match(/^\/api\/player\/requests\/([^/]+)\/undo$/);
  if (request.method === "POST" && playerUndoMatch) {
    const data = await undoPlayerRequestOutcome(decodeURIComponent(playerUndoMatch[1]));
    broadcastState();
    json(response, 200, data);
    return;
  }
  if (request.method === "GET" && pathname === "/api/events") {
    openEventStream(request, response);
    return;
  }
  if (request.method === "GET" && pathname === "/api/state") {
    json(response, 200, stateView());
    return;
  }
  if (request.method === "GET" && pathname === "/api/storage/usage") {
    json(response, 200, await songStorageView());
    return;
  }
  if (request.method === "POST" && pathname === "/api/storage/reveal") {
    const origin = String(request.headers.origin || "");
    if (origin && origin !== `http://${String(request.headers.host || "")}`) {
      json(response, 403, { ok: false, error: "Origen no permitido.", code: "INVALID_ORIGIN" });
      return;
    }
    const body = await readJson(request);
    json(response, 200, await revealSongStorageLocation(body.id, songStorageOptions()));
    return;
  }
  if (pathname === "/api/diagnostics/preferences") {
    try {
      if (request.method === "POST") {
        await diagnosticPreferences.update(await readJson(request));
        if (!diagnosticPreferences.view().testerMode) diagnosticTesterFailure = "";
        broadcastState();
      } else if (request.method !== "GET") {
        throw diagnosticError('Método no permitido.', 'METHOD_NOT_ALLOWED', 405);
      }
      json(response, 200, { ok: true, preferences: diagnosticPreferencesView() });
    } catch (error) {
      json(response, error.status || 500, { ok: false, code: error.code || 'PREFERENCE_SAVE_FAILED', error: errorMessage(error), preferences: diagnosticPreferencesView() });
    }
    return;
  }
  if (request.method === "GET" && pathname === "/api/diagnostics/state") {
    json(response, 200, diagnostics.view());
    return;
  }
  if (request.method === "POST" && pathname === "/api/diagnostics/events") {
    const body = await readJson(request);
    const batch = Array.isArray(body.events) ? body.events.slice(0, 50) : [];
    const recorded = batch.map((event) => diagnostics.record(event));
    if (body.autoSend === true && diagnosticPreferences.view().autoSendTechnicalErrors === true) {
      const reportIds = new Set(recorded
        .filter((event) => ["ERROR", "CRITICAL"].includes(event.severity))
        .map((event) => diagnostics.reports.find((report) => report.fingerprint === event.fingerprint)?.reportId)
        .filter(Boolean));
      for (const id of reportIds) {
        const report = diagnostics.reports.find((entry) => entry.reportId === id);
        if (report && report.deliveryStatus !== "sent") void deliverDiagnosticReport(report);
      }
    }
    json(response, 200, { ok: true, recorded: recorded.length });
    return;
  }
  if (request.method === "POST" && pathname === "/api/diagnostics/mark") {
    await requireDiagnosticTester();
    const body = await readJson(request);
    const snapshot = serverDiagnosticSnapshot(body.snapshot || {});
    const capture = diagnostics.markFailure(snapshot);
    diagnostics.record({
      module: "Application / Runtime",
      severity: "INFO",
      event: "DIAGNOSTIC_MARKED_NOW",
      summary: "Tester captured the current diagnostic state",
      context: { captureId: capture.captureId }
    }, { createIncident: false });
    json(response, 200, { ok: true, capture });
    return;
  }
  if (request.method === "POST" && pathname === "/api/diagnostics/report") {
    const body = await readJson(request);
    const snapshot = serverDiagnosticSnapshot(body.snapshot || {});
    const report = diagnostics.createReport({
      ...body,
      snapshot,
      health: diagnostics.health,
      deliveryStatus: body.action === "send" ? "queued" : "local"
    });
    if (body.action === "send") await deliverDiagnosticReport(report, { force: true });
    json(response, 200, {
      ok: true,
      report,
      text: technicalReportText(report)
    });
    return;
  }
  const diagnosticStatusMatch = pathname.match(/^\/api\/diagnostics\/reports\/([^/]+)$/);
  if (request.method === "PATCH" && diagnosticStatusMatch) {
    requireSignedInBridge();
    const body = await readJson(request);
    const report = diagnostics.updateReport(decodeURIComponent(diagnosticStatusMatch[1]), body);
    if (!report) throw new Error("That diagnostic report no longer exists.");
    json(response, 200, { ok: true, report });
    return;
  }
  if (request.method === "GET" && pathname === "/api/diagnostics/export") {
    await requireDiagnosticTester();
    const body = JSON.stringify(sanitizeDiagnosticValue({
      exportedAt: new Date().toISOString(),
      version: BRIDGE_VERSION,
      build: bundleBuild,
      system: diagnosticSystemView(),
      ...diagnostics.view()
    }), null, 2);
    const filename = `Guest-Star-Diagnostic-${new Date().toISOString().replace(/\D/g, "").slice(0, 14)}.json`;
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Length": Buffer.byteLength(body),
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Guest-Star-Filename": filename,
      "Cache-Control": "no-store"
    });
    response.end(body);
    return;
  }
  if (request.method === "POST" && pathname === "/api/player/health") {
    const body = await readJson(request);
    const audioContextState = ["running", "suspended", "interrupted", "closed", "missing", "unknown"]
      .includes(body.audioContextState) ? body.audioContextState : "unknown";
    const mediaState = ["idle", "waiting", "playing", "paused", "ended", "error"]
      .includes(body.mediaState) ? body.mediaState : body.transitionBusy ? "waiting" : body.playing ? "playing" : "idle";
    const videoMetric = (value, maximum = 1_000_000_000) => Math.max(0, Math.min(maximum, Number(value) || 0));
    playerHealthState = {
      updatedAt: new Date().toISOString(),
      karaokeActive: body.karaokeActive === true || body.playing === true,
      videoActive: body.videoActive === true || body.playing === true,
      audioContextState,
      mediaState,
      audioRecovering: body.audioRecovering === true,
      audioOutputLost: body.audioOutputLost === true,
      backgroundActive: body.backgroundPlaying === true,
      starScreenConnected: body.starScreenConnected === true,
      starScreenExpected: body.starScreenExpected === true,
      videoFrames: videoMetric(body.videoFrames),
      videoDroppedFrames: videoMetric(body.videoDroppedFrames),
      videoCorruptedFrames: videoMetric(body.videoCorruptedFrames),
      videoFrameRate: videoMetric(body.videoFrameRate, 240),
      videoHardResyncs: videoMetric(body.videoHardResyncs),
      videoRateWrites: videoMetric(body.videoRateWrites),
      videoDriftSeconds: videoMetric(body.videoDriftSeconds, 86_400),
      videoReadyState: Math.round(videoMetric(body.videoReadyState, 4)),
      videoPaused: body.videoPaused === true
    };
    const resource = updateStemResourceState();
    if (resource.state !== "PRESSURE") void processStemQueue();
    json(response, 200, { ok: true, resourceState: stemResourceState });
    return;
  }
  if (request.method === "POST" && pathname === "/api/rotation/draw") {
    requireSignedInBridge();
    const body = await readJson(request);
    const list = String(body.list || "both").toLowerCase();
    const items = drawRotation(list, body.count);
    json(response, 200, { ok: true, list, items });
    return;
  }
  if (request.method === "POST" && pathname === "/api/favorites") {
    const body = await readJson(request);
    json(response, 200, await updateFavorite(body));
    broadcastState();
    return;
  }
  if (request.method === "POST" && pathname === "/api/superhost/preferences") {
    requireLocalSuperhost();
    const body = await readJson(request);
    config = await saveConfig(sanitizeConfig({
      ...config,
      superhostLanguage: body.language,
      uiLanguage: body.language
    }, config));
    json(response, 200, {
      ok: true,
      language: config.superhostLanguage
    });
    broadcastState();
    return;
  }
  if (request.method === "GET" && pathname === "/api/superhost/state") {
    requireLocalManagement();
    const isSuperhost = identityState.user?.role === "superhost";
    const data = isSuperhost ? await v4AppsScriptAction(config, "adminState") : {};
    json(response, 200, {
      ...scopedManagementState(data),
      localFavoritesByHotel: isSuperhost ? config.favoriteSongsByHotel || {} : {}
    });
    return;
  }
  if (request.method === "POST" && pathname === "/api/superhost/action") {
    requireLocalManagement();
    const body = await readJson(request);
    const action = String(body.action || "");
    const superhostAllowed = new Set([
      "adminState", "createHotel", "updateHotel", "createVenue", "updateVenue",
      "createActivity", "updateActivity", "createHost", "updateHost", "assignUser",
      "setHostPassword", "updateActivityLanguages",
      "revokeAssignment", "revokeDevice", "updateHotelBranding",
      "scheduleActivity", "updateSchedule", "cancelSchedule", "listReviews", "updateReview",
      "regenerateHotelQr", "hotelShare"
    ]);
    const hostAllowed = new Set([
      "scheduleActivity", "updateSchedule", "cancelSchedule", "listReviews", "updateHotelBranding"
    ]);
    const allowed = identityState.user?.role === "superhost" ? superhostAllowed : hostAllowed;
    if (!allowed.has(action)) throw new Error("Management action not allowed for this account.");
    if (identityState.user?.role === "host") {
      assertHostManagementScope(action, body, {});
      if (action === "updateHotelBranding") {
        const permittedFields = [
          "activityEndingMessage", "activityFinishedTitle", "activityFinishedMessage",
          "upcomingActivityMessage", "messageSourceLanguage", "translationMode",
          "localizedMessagesJson"
        ];
        const incoming = body.branding && typeof body.branding === "object" ? body.branding : {};
        body.branding = { ...(tenantState.branding || {}) };
        for (const field of permittedFields) {
          if (Object.prototype.hasOwnProperty.call(incoming, field)) body.branding[field] = incoming[field];
        }
        if (Object.prototype.hasOwnProperty.call(incoming, "localizedMessagesJson")) {
          const parseMessages = (value) => {
            if (value && typeof value === "object") return value;
            try { return JSON.parse(String(value || "{}")); } catch { return {}; }
          };
          const existingMessages = parseMessages(tenantState.branding?.localizedMessagesJson);
          const submittedMessages = parseMessages(incoming.localizedMessagesJson);
          body.branding.localizedMessagesJson = Object.fromEntries(
            [...new Set([...Object.keys(existingMessages), ...Object.keys(submittedMessages)])]
              .map((language) => [language, { ...(existingMessages[language] || {}), ...(submittedMessages[language] || {}) }])
          );
        }
      }
    }
    const data = await v4AppsScriptAction(config, action, body);
    if (identityState.user?.role === "host" && action === "listReviews") {
      const reviews = Array.isArray(data?.reviews) ? data.reviews.filter((review) =>
        (!review.hotelId || String(review.hotelId) === String(body.hotelId)) &&
        (!review.venueId || String(review.venueId) === String(body.venueId)) &&
        (!review.activityId || String(review.activityId) === String(body.activityId))
      ) : [];
      json(response, 200, { ...data, reviews });
      return;
    }
    if ([
      "createHotel", "updateHotel", "createVenue", "updateVenue", "createActivity", "updateActivity",
      "assignUser", "revokeAssignment"
    ].includes(action)) {
      const identity = await fetchBridgeIdentity(config);
      identityState = {
        authenticated: true,
        user: identity.user || identityState.user,
        selection: identity.selection || { hotels: [], venues: [], activities: [] }
      };
    }
    if (
      action === "updateHotel" &&
      body.status === "inactive" &&
      String(body.hotelId || "") === String(config.lastHotelId || "")
    ) {
      config = await saveConfig(sanitizeConfig({
        ...config,
        lastHotelId: "",
        lastVenueId: "",
        lastActivityId: ""
      }, config));
      tenantState = {
        hotel: null,
        branding: null,
        venue: null,
        activity: null,
        kioskAccess: null,
        permissions: {},
        share: null,
        upcomingActivities: []
      };
      requests = [];
    }
    json(response, 200, data);
    broadcastState();
    return;
  }
  if (request.method === "POST" && pathname === "/api/auth/login") {
    const body = await readJson(request);
    const data = await signInBridge(config, {
      username: String(body.username || "").trim(),
      password: String(body.password || ""),
      rememberLogin: body.rememberLogin !== false,
      deviceName: body.deviceName || `Guest Star Bridge on ${process.env.HOSTNAME || "Mac"}`
    });
    config = await saveConfig(sanitizeConfig({
      ...config,
      authToken: data.authToken,
      deviceToken: data.deviceToken,
      deviceId: data.deviceId,
      lastUsername: String(body.username || "").trim(),
      rememberLogin: body.rememberLogin !== false
    }, config), { storeSecrets: true });
    identityState = {
      authenticated: true,
      user: data.user || null,
      selection: data.selection || { hotels: [], venues: [], activities: [] }
    };
    await resumeRunningActivity();
    restartCloudRealtime();
    sheetError = "";
    broadcastState();
    json(response, 200, {
      ok: true,
      user: identityState.user,
      selection: identityState.selection,
      mustChangePassword: data.user?.mustChangePassword === true
    });
    return;
  }
  if (request.method === "GET" && pathname === "/api/auth/google-config") {
    const data = await fetchGoogleLoginConfig(config);
    json(response, 200, {
      ok: true,
      googleClientId: String(data.googleClientId || "")
    });
    return;
  }
  if (request.method === "POST" && pathname === "/api/auth/google") {
    const expectedOrigin = `http://${String(request.headers.host || "")}`;
    const requestOrigin = String(request.headers.origin || "");
    if (requestOrigin && requestOrigin !== expectedOrigin) {
      json(response, 403, { ok: false, code: "INVALID_ORIGIN" });
      return;
    }
    const body = await readJson(request);
    const data = await signInBridgeWithGoogle(config, String(body.credential || ""), {
      rememberLogin: body.rememberLogin !== false,
      deviceName: body.deviceName || `Guest Star Bridge on ${process.env.HOSTNAME || "Mac"}`
    });
    config = await saveConfig(sanitizeConfig({
      ...config,
      authToken: data.authToken,
      deviceToken: data.deviceToken,
      deviceId: data.deviceId,
      lastUsername: String(data.user?.email || data.user?.username || ""),
      rememberLogin: body.rememberLogin !== false
    }, config), { storeSecrets: true });
    identityState = {
      authenticated: true,
      user: data.user || null,
      selection: data.selection || { hotels: [], venues: [], activities: [] }
    };
    await resumeRunningActivity();
    restartCloudRealtime();
    sheetError = "";
    broadcastState();
    json(response, 200, {
      ok: true,
      user: identityState.user,
      selection: identityState.selection,
      mustChangePassword: false
    });
    return;
  }
  if (request.method === "POST" && pathname === "/api/auth/logout") {
    const previousDeviceId = config.deviceId;
    stopCloudRealtime();
    try {
      if (hasV4Session(config)) await signOutBridge(config);
    } finally {
      await clearBridgeSecrets(previousDeviceId);
      config = await saveConfig(sanitizeConfig({
        ...config,
        authToken: "",
        deviceToken: "",
        lastHotelId: "",
        lastVenueId: "",
        lastActivityId: ""
      }, config));
      identityState = {
        authenticated: false,
        user: null,
        selection: { hotels: [], venues: [], activities: [] }
      };
      tenantState = {
        hotel: null,
        branding: null,
        venue: null,
        activity: null,
        kioskAccess: null,
        permissions: {},
        share: null,
        upcomingActivities: []
      };
      requests = [];
      clearTransientCaches();
      broadcastState();
    }
    json(response, 200, { ok: true });
    return;
  }
  if (request.method === "POST" && pathname === "/api/auth/change-password") {
    const body = await readJson(request);
    const data = await v4AppsScriptAction(config, "changePassword", {
      currentPassword: String(body.currentPassword || ""),
      newPassword: String(body.newPassword || "")
    });
    if (identityState.user) identityState.user.mustChangePassword = false;
    json(response, 200, data);
    return;
  }
  if (request.method === "GET" && pathname === "/api/auth/me") {
    if (!hasV4Session(config)) {
      json(response, 200, { ok: true, authenticated: false });
      return;
    }
    const data = await fetchBridgeIdentity(config);
    identityState = {
      authenticated: true,
      user: data.user || null,
      selection: data.selection || { hotels: [], venues: [], activities: [] }
    };
    json(response, 200, { ok: true, authenticated: true, ...identityState });
    return;
  }
  if (request.method === "POST" && pathname === "/api/auth/selection") {
    const body = await readJson(request);
    const previousActivityId = config.lastActivityId;
    const selection = {
      hotelId: String(body.hotelId || ""),
      venueId: String(body.venueId || ""),
      activityId: String(body.activityId || "")
    };
    const data = await selectBridgeActivity(config, selection);
    if (selection.activityId && selection.activityId !== previousActivityId) {
      operatingMode = "";
    }
    config = await saveConfig(sanitizeConfig({
      ...config,
      lastHotelId: selection.hotelId,
      lastVenueId: selection.venueId,
      lastActivityId: selection.activityId,
      rememberSelection: body.rememberSelection !== false
    }, config));
    applyActivityState(data);
    requests = bridgeRequests(data);
    clearTransientCaches();
    sheetError = "";
    json(response, 200, stateView());
    broadcastState();
    restartCloudRealtime();
    return;
  }
  if (request.method === "POST" && pathname === "/api/config/language") {
    const body = await readJson(request);
    config = await saveConfig(sanitizeConfig({
      ...config,
      uiLanguage: body.uiLanguage,
      superhostLanguage: body.uiLanguage
    }, config));
    json(response, 200, { ok: true, uiLanguage: config.uiLanguage });
    broadcastState();
    return;
  }
  if (request.method === "POST" && pathname === "/api/config") {
    const body = await readJson(request);
    // Host presentation-only updates must not restart any runtime or connection.
    if (Object.keys(body).length === 1 && body.interfacePreferences &&
        typeof body.interfacePreferences === "object" && !Array.isArray(body.interfacePreferences)) {
      config = await saveConfig(sanitizeConfig(body, config));
      json(response, 200, { ok: true, config: { ...publicConfig(config), diagnostics: diagnosticPreferencesView() } });
      broadcastInterfacePreferences();
      return;
    }
    let baseConfig = config;
    if (body.clearVdjPassword) {
      baseConfig = {
        ...baseConfig,
        virtualDJ: { ...baseConfig.virtualDJ, password: "" }
      };
    }
    const nextConfig = sanitizeConfig({ ...body, diagnostics: baseConfig.diagnostics }, baseConfig);
    if (body.sheetConfig && typeof body.sheetConfig === "object") {
      const data = await updateBridgeConfig(nextConfig, body.sheetConfig);
      if (data?.state) applyActivityState(data);
    }
    config = await saveConfig(nextConfig);
    restartCloudRealtime();
    startLibraryWatchers();
    await scanNow();
    await syncNow();
    json(response, 200, { ok: true, config: { ...publicConfig(config), diagnostics: diagnosticPreferencesView() } });
    return;
  }
  if (request.method === "POST" && pathname === "/api/activity/settings") {
    const body = await readJson(request);
    const data = await v4AppsScriptAction(config, "updateActivitySettings", {
      hotelId: config.lastHotelId,
      venueId: config.lastVenueId,
      activityId: config.lastActivityId,
      source: operatingMode === "player" ? "player" : "bridge",
      scheduledStartAt: body.scheduledStartAt,
      defaultDurationSeconds: body.defaultDurationSeconds,
      defaultTransitionSeconds: body.defaultTransitionSeconds,
      acceptEarlyRequests: body.acceptEarlyRequests,
      showCountdown: body.showCountdown,
      autoStartEnabled: body.autoStartEnabled,
      showPublicStatus: body.showPublicStatus,
      showStarScreenQueueCount: body.showStarScreenQueueCount,
      allowedLanguages: body.allowedLanguages
    });
    activityState.showStarScreenQueueCount = body.showStarScreenQueueCount !== false;
    applyActivityState(data);
    requests = bridgeRequests(data);
    json(response, 200, stateView());
    return;
  }
  if (request.method === "POST" && pathname === "/api/library/choose-folder") {
    json(response, 200, { ok: true, folder: await chooseFolder() });
    return;
  }
  if (request.method === "POST" && pathname === "/api/library/scan") {
    await scanNow();
    json(response, 200, stateView());
    return;
  }
  if (request.method === "POST" && pathname === "/api/requests/sync") {
    await syncNow();
    if (operatingMode === "bridge") await reconcileVirtualDjQueue(true);
    json(response, 200, stateView());
    return;
  }
  if (request.method === "POST" && pathname === "/api/player/requests/pull") {
    requireSignedInBridge();
    await syncNow();
    json(response, 200, stateView());
    return;
  }
  if (request.method === "POST" && pathname === "/api/player/sync") {
    await scanNow();
    await syncNow();
    json(response, 200, stateView());
    return;
  }
  if (request.method === "POST" && pathname === "/api/activity/mode") {
    requireSignedInBridge();
    const body = await readJson(request);
    const nextMode = String(body.mode || "").toLowerCase();
    if (!config.lastHotelId || !config.lastVenueId || !config.lastActivityId || !tenantState.activity) {
      throw new Error("Select a hotel, venue and activity before choosing the playback mode.");
    }
    if (!["player", "bridge"].includes(nextMode)) {
      throw new Error("Choose Player or Bridge before starting the activity.");
    }
    if (activityState.activityRunning && operatingMode) {
      throw new Error("The playback mode is locked until this activity finishes.");
    }
    operatingMode = nextMode;
    lastSelectedMode = nextMode;
    await persistQueuedEntries(config.lastActivityId || activityState.activityId);
    restartCloudRealtime();
    json(response, 200, stateView());
    broadcastState();
    return;
  }
  const activityMatch = pathname.match(
    /^\/api\/activity\/(start|open|close|reset|finish|start-new|archive)$/
  );
  if (request.method === "POST" && activityMatch) {
    const action = activityMatch[1];
    if (["start", "start-new"].includes(action) && !operatingMode) {
      throw new Error("Choose Player or Bridge before starting the activity.");
    }
    const context = {
      hotelId: config.lastHotelId,
      venueId: config.lastVenueId,
      activityId: config.lastActivityId,
      source: operatingMode === "player" ? "player" : "bridge"
    };
    const data = action === "finish"
      ? await v4AppsScriptAction(config, "finishActivityV4", context)
      : action === "start-new"
        ? await v4AppsScriptAction(config, "startNewActivityV4", context)
        : action === "archive"
          ? await v4AppsScriptAction(config, "archiveClearQueue", context)
          : await controlActivity(config, action, context.source);
    applyActivityState(data);
    if (["finish", "reset", "archive"].includes(action)) operatingMode = "";
    if (["reset", "archive", "start-new"].includes(action)) {
      await reconcileDeletedRequests([], activityState, {
        removeFromVirtualDJ: true
      });
      await resetLocalActivity(activityState.activityId);
    } else if (Array.isArray(data.requests)) {
      requests = bridgeRequests(data);
      refreshLocalAvailability();
    }
    await syncNow();
    await reconcileVirtualDjQueue(true);
    await persistQueuedEntries(activityState.activityId);
    if (["finish", "reset", "archive"].includes(action)) restartCloudRealtime();
    json(response, 200, stateView());
    return;
  }
  if (request.method === "POST" && pathname === "/api/virtualdj/test") {
    const body = await readJson(request);
    const testConfig = sanitizeConfig(body, config);
    const clock = await queryVdj(testConfig.virtualDJ, "get_clock");
    const queueEntries = await listKaraokeEntries(testConfig.virtualDJ);
    vdjError = "";
    broadcastState();
    json(response, 200, {
      ok: true,
      clock,
      queueCount: queueEntries.length
    });
    return;
  }
  if (request.method === "POST" && pathname === "/api/external/open") {
    const body = await readJson(request);
    const openedUrl = await openMacUrl(body.url);
    json(response, 200, { ok: true, url: openedUrl });
    return;
  }
  if (request.method === "POST" && pathname === "/api/player/star-screen/open") {
    requireSignedInBridge();
    json(response, 200, await openStarScreenWindow());
    return;
  }
  const queueMatch = pathname.match(/^\/api\/requests\/([^/]+)\/queue$/);
  if (request.method === "POST" && queueMatch) {
    const body = await readJson(request);
    const data = await runVdjQueueOperation({ ...body, commandId: body.commandId || randomUUID() }, () => queueRequest(
      decodeURIComponent(queueMatch[1]),
      body.filePath
    ));
    broadcastState();
    json(response, 200, data);
    return;
  }
  const removeMatch = pathname.match(/^\/api\/requests\/([^/]+)\/remove$/);
  const replaceMatch = pathname.match(/^\/api\/requests\/([^/]+)\/replace$/);
  const linkMatch = pathname.match(/^\/api\/requests\/([^/]+)\/link$/);
  const unlinkMatch = pathname.match(/^\/api\/requests\/([^/]+)\/unlink$/);
  if (request.method === "POST" && linkMatch) {
    const body = await readJson(request);
    const data = await linkRequestFile(decodeURIComponent(linkMatch[1]), body.filePath, "manual");
    broadcastState();
    json(response, 200, data);
    return;
  }
  if (request.method === "POST" && unlinkMatch) {
    const data = await unlinkRequestFile(decodeURIComponent(unlinkMatch[1]));
    broadcastState();
    json(response, 200, data);
    return;
  }
  if (request.method === "POST" && replaceMatch) {
    const body = await readJson(request);
    const data = await runVdjQueueOperation({ ...body, commandId: body.commandId || randomUUID() }, () => replaceQueuedRequest(
      decodeURIComponent(replaceMatch[1]),
      body.filePath
    ));
    broadcastState();
    json(response, 200, data);
    return;
  }
  if (request.method === "POST" && removeMatch) {
    const body = await readJson(request);
    const data = await runVdjQueueOperation({ ...body, commandId: body.commandId || randomUUID() }, () => removeQueuedRequest(decodeURIComponent(removeMatch[1])));
    broadcastState();
    json(response, 200, data);
    return;
  }
  const dismissRequeueMatch =
    pathname.match(/^\/api\/requests\/([^/]+)\/dismiss-requeue$/);
  if (request.method === "POST" && dismissRequeueMatch) {
    const data = await dismissRequeue(
      decodeURIComponent(dismissRequeueMatch[1])
    );
    broadcastState();
    json(response, 200, data);
    return;
  }
  const outcomeMatch =
    pathname.match(/^\/api\/requests\/([^/]+)\/outcome$/);
  if (request.method === "POST" && outcomeMatch) {
    const body = await readJson(request);
    const data = await runAdministrativeCommand({ ...body, requestId: decodeURIComponent(outcomeMatch[1]), commandId: body.commandId || randomUUID() }, () => setRequestOutcome(
      decodeURIComponent(outcomeMatch[1]),
      String(body.outcome || ""), { removeVDJ: !vdjQueueOperationBusy }
    ));
    broadcastState();
    json(response, 200, data);
    return;
  }
  const undoOutcomeMatch =
    pathname.match(/^\/api\/requests\/([^/]+)\/undo-outcome$/);
  if (request.method === "POST" && undoOutcomeMatch) {
    const body = await readJson(request);
    const data = await runVdjQueueOperation({ ...body, commandId: body.commandId || randomUUID() }, () => undoRequestOutcome(
      decodeURIComponent(undoOutcomeMatch[1]),
      String(body.placement || "")
    ));
    broadcastState();
    json(response, 200, data);
    return;
  }
  if (request.method === "POST" && pathname === "/api/suggestions/queue") {
    const body = await readJson(request);
    const data = await queueHitSuggestion(body);
    broadcastState();
    json(response, 200, data);
    return;
  }
  if (request.method === "POST" && pathname === "/api/suggestions/youtube") {
    const body = await readJson(request);
    const items = await findHitSuggestionYoutube(body);
    broadcastState();
    json(response, 200, { ok: true, items });
    return;
  }
  const youtubeCopyMatch =
    pathname.match(/^\/api\/requests\/([^/]+)\/youtube\/copy$/);
  if (request.method === "POST" && youtubeCopyMatch) {
    const id = decodeURIComponent(youtubeCopyMatch[1]);
    const body = await readJson(request);
    const items = youtubeCache.get(id) || await findYoutube(id);
    const selected = items.find((item) => item.url === String(body.url || ""));
    if (!selected) throw new Error("Elige uno de los enlaces mostrados por el Bridge.");
    try {
      await copyMacClipboard(selected.url);
      const item = requests.find((entry) => entry.id === id);
      if (item) {
        const updated = await updateBridgeRequest(
          config,
          id,
          item.status,
          basename(queuedEntries.get(id)?.filePath || ""),
          {
            durationSeconds:
              Number(selected.durationSeconds) || item.durationSeconds,
            sourceUrl: selected.url
          }
        );
        if (updated?.state) applyActivityState(updated);
        item.sourceUrl = selected.url;
        if (Number(selected.durationSeconds) > 0) {
          item.durationSeconds = Number(selected.durationSeconds);
        }
        requestFileLinks.delete(id);
        const tracked = queuedEntries.get(id);
        if (tracked) queuedEntries.set(id, { ...tracked, manualLink: false });
        await persistQueuedEntries();
      }
      clipboardHandledIds.add(id);
      clipboardState = {
        requestId: id,
        url: selected.url,
        resultType: selected.resultType || "",
        notice: selected.notice || "",
        copiedAt: new Date().toISOString(),
        error: ""
      };
    } catch (error) {
      clipboardState = {
        requestId: id,
        url: selected.url,
        resultType: selected.resultType || "",
        notice: selected.notice || "",
        copiedAt: "",
        error: errorMessage(error)
      };
      throw error;
    }
    broadcastState();
    json(response, 200, {
      ok: true,
      url: selected.url,
      sheetUpdated: true
    });
    return;
  }
  const youtubeMatch = pathname.match(/^\/api\/requests\/([^/]+)\/youtube$/);
  if (request.method === "POST" && youtubeMatch) {
    const id = decodeURIComponent(youtubeMatch[1]);
    const items = await findYoutube(id);
    const best = items[0];
    clipboardHandledIds.add(id);
    if (best) {
      clipboardState = {
        requestId: id,
        url: best.url,
        resultType: best.resultType || "",
        notice: best.notice || "",
        copiedAt: "",
        error: ""
      };
    }
    broadcastState();
    json(response, 200, {
      ok: true,
      items,
      clipboardCopied: false
    });
    return;
  }
  if (request.method === "POST" && pathname === "/api/apps-script/test") {
    const body = await readJson(request);
    const testConfig = sanitizeConfig(body, config);
    const data = await fetchBridgeQueue(testConfig);
    if (data.codeVersion !== BRIDGE_PROTOCOL_VERSION) {
      throw new Error(
        `Guest Star is connected, but its service version is ${data.codeVersion || "older"}. Contact the Superhost to install version ${BRIDGE_PROTOCOL_VERSION}.`
      );
    }
    json(response, 200, {
      ok: true,
      requestCount: data.requests.length,
      codeVersion: data.codeVersion
    });
    return;
  }
  json(response, 404, { ok: false, error: "Action not found." });
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (url.pathname.startsWith("/api/")) await api(request, response, url);
    else await serveStatic(url.pathname, response);
  } catch (error) {
    const pathname = (() => {
      try { return new URL(request.url || "/", "http://127.0.0.1").pathname; }
      catch { return ""; }
    })();
    if (!pathname.startsWith("/api/diagnostics/")) {
      recordBackendDiagnostic(error, {
        module: pathname.includes("stems") ? "Stems IA" : "Network/API",
        event: "HTTP_ENDPOINT_ERROR",
        context: { method: request.method, pathname }
      });
    }
    json(response, error.status || 400, { ok: false, error: errorMessage(error), ...(error.code ? { code: error.code } : {}) });
  }
});

process.on("unhandledRejection", (reason) => {
  recordBackendDiagnostic(reason, { event: "UNHANDLED_REJECTION" });
});
process.on("uncaughtExceptionMonitor", (error, origin) => {
  recordBackendDiagnostic(error, {
    severity: "CRITICAL",
    event: "UNCAUGHT_EXCEPTION",
    context: { origin }
  });
});

async function restoreBridgeIdentity() {
  if (!hasV4Session(config)) return;
  try {
    const data = await fetchBridgeIdentity(config);
    identityState = {
      authenticated: true,
      user: data.user || null,
      selection: data.selection || { hotels: [], venues: [], activities: [] }
    };
  } catch (error) {
    identityState.authenticated = false;
    sheetError = errorMessage(error);
  }
}

async function resumeRunningActivity() {
  if (!identityState.authenticated || !hasV4Session(config)) return false;
  const activities = Array.isArray(identityState.selection?.activities)
    ? identityState.selection.activities
    : [];
  const running = activities.filter((item) => String(item.status || "") === "in_progress");
  const remembered = running.find((item) => String(item.activityId || "") === String(config.lastActivityId || ""));
  const activity = remembered || (running.length === 1 ? running[0] : null);
  if (!activity) {
    operatingMode = "";
    activityState = {
      ...activityState,
      activityStartedAt: "",
      activityFinishedAt: "",
      activityRunning: false,
      playbackMode: ""
    };
    return false;
  }
  const hotelId = String(activity.hotelId || config.lastHotelId || "");
  const venueId = String(activity.venueId || config.lastVenueId || "");
  const activityId = String(activity.activityId || "");
  if (!hotelId || !venueId || !activityId) return false;
  const data = await selectBridgeActivity(config, {
    hotelId,
    venueId,
    activityId,
    source: "resume"
  });
  config = await saveConfig(sanitizeConfig({
    ...config,
    lastHotelId: hotelId,
    lastVenueId: venueId,
    lastActivityId: activityId,
    rememberSelection: true
  }, config));
  applyActivityState(data);
  if (!activityState.activityRunning) {
    operatingMode = "";
    activityState = {
      ...activityState,
      activityStartedAt: "",
      activityFinishedAt: "",
      activityRunning: false,
      playbackMode: ""
    };
    return false;
  }
  if (Array.isArray(data.requests)) requests = bridgeRequests(data);
  refreshLocalAvailability();
  await persistQueuedEntries(activityId);
  return true;
}

async function editBridgeMetadata(id, body) {
  if (operatingMode !== 'bridge') throw new Error('Metadata editing here belongs to Bridge mode.');
  const item = requests.find(value => value.id === id);
  if (!item || queueLocks.has(id)) throw new Error('The request is unavailable or being updated.');
  const metadata = {};
  for (const [key, maximum] of [['singer', 120], ['song', 180], ['artist', 180]]) {
    metadata[key] = String(body[key] ?? item[key] ?? '').replace(/[\r\n\0]/g, ' ').trim();
    if (metadata[key].length > maximum || (key !== 'artist' && !metadata[key])) throw new Error('Invalid visible request metadata.');
  }
  if (bridgeFeatures.versionedMetadata !== true || !Number.isInteger(item.stateRevision) || item.stateRevision <= 0) throw new Error('The connected Guest Star service must support versioned metadata edits.');
  if (Number(body.expectedRevision) !== item.stateRevision) throw new Error('This request changed while editing. Review it and save again.');
  queueLocks.add(id);
  try {
    const result = await updateBridgeRequest(config, id, item.status, item.fileName || '', {
      ...metadata, expectedRevision: item.stateRevision, eventOrigin: 'USER_ACTION'
    });
    const updated = result?.request;
    if (!updated || String(updated.name || updated.singer || '') !== metadata.singer ||
        updated.song !== metadata.song || updated.artist !== metadata.artist) {
      throw new Error('The remote service did not confirm these fields. No local-only metadata was substituted.');
    }
    const current = requests.find(value => value.id === id);
    if (!current) throw new Error('Metadata was saved remotely; the request is no longer in this activity.');
    Object.assign(current, metadata, { stateRevision: Number(updated.stateRevision) });
    // Preserve physical VDJ identity: visible Guest Star metadata is not a
    // physical rename/re-tag and must not sever a previously verified link.
    const entry = queuedEntries.get(id);
    if (entry) queuedEntries.set(id, { ...entry, manualLink: true });
    vdjOperations.invalidate(id);
    await persistQueuedEntries();
    broadcastState();
    return { ok: true, request: requestView(current) };
  } finally { queueLocks.delete(id); }
}

function bridgeQueueEntry(id) {
  return vdjQueueEntries.find(entry => `vdj:${entry.virtualDJItemId}` === id ||
    (entry.linkedRequestId && `request:${entry.linkedRequestId}` === id));
}

async function moveBridgeRequest(id, body) {
  if (operatingMode !== 'bridge' || bridgeFeatures.administrativeReorder !== true) throw new Error('The service must support Bridge administrative reorder.');
  const item = requests.find(value => value.id === id);
  if (!item || effectiveRequestOutcome(item) || item.sourceType === 'player_local') throw new Error('The active request is no longer available.');
  if (Number(body.expectedRevision) !== item.stateRevision) throw new Error('The request changed before reorder. Review its current position.');
  const beforeId = body.beforeId === null ? null : String(body.beforeId || '');
  if (beforeId !== null && !requests.some(value => value.id === beforeId && !effectiveRequestOutcome(value))) throw new Error('The reorder destination disappeared.');
  vdjOperations.invalidate(id);
  await updateBridgeRequest(config, id, item.status, item.fileName || '', {
    beforeRequestId: beforeId, expectedRevision: item.stateRevision, eventOrigin: 'USER_ACTION'
  });
  await syncNow();
  // Administrative order is stored on the same Guest Star records. VDJ's
  // physical rows remain a projection: never replay a move on reconnect.
  const source = bridgeQueueEntry(`request:${id}`);
  const target = beforeId === null ? null : bridgeQueueEntry(`request:${beforeId}`);
  let warning = '';
  if (vdjOperations.view().connected && source && (beforeId === null || target)) {
    try { await moveKaraokeEntry(config.virtualDJ, source, target); }
    catch (error) { warning = `Guest Star order saved; VDJ order was not confirmed: ${errorMessage(error)}`; }
  } else warning = 'Guest Star order saved. VDJ physical order is unchanged; no move will be replayed on reconnect.';
  return { ok: true, warning };
}

async function skipVdjTrack(body) {
  if (operatingMode !== 'bridge') throw new Error('Select Bridge mode before Skip.');
  await vdjOperations.refresh();
  const playback = vdjOperations.view();
  const deck = playback.decks.find(value => value.deck === Number(body.deck));
  if (!playback.connected || !deck?.filePath || normalizeVdjPath(deck.filePath) !== normalizeVdjPath(body.filePath)) {
    throw new Error('The current VDJ deck/song is not confirmed.');
  }
  const matches = vdjQueueEntries.filter(entry => normalizeVdjPath(entry.filePath) === normalizeVdjPath(deck.filePath));
  if (matches.length > 1) throw new Error('Multiple singers share this source. Select the request and mark it manually; Skip will not guess.');
  const current = matches[0];
  const tracked = [...queuedEntries.values()].filter(entry => normalizeVdjPath(entry.filePath) === normalizeVdjPath(deck.filePath));
  if (tracked.length > 1 || (tracked.length === 1 && current?.linkedRequestId && tracked[0].id !== current.linkedRequestId)) {
    throw new Error('The loaded source belongs to multiple requests. Skip will not choose a participant by filename.');
  }
  const next = vdjQueueEntries.find(entry => entry !== current && entry.filePath &&
    (!current || entry.index > current.index) &&
    (!entry.linkedRequestId || !effectiveRequestOutcome(requests.find(item => item.id === entry.linkedRequestId))));
  await vdjOperations.command({ action: 'pause', deck: deck.deck, filePath: deck.filePath, commandId: `${body.commandId}_pause` });
  let outcome = null;
  const currentId = current?.linkedRequestId || (tracked.length === 1 ? tracked[0].id : '');
  if (currentId) outcome = await setRequestOutcome(currentId, 'skipped');
  if (next) {
    if (/["`\r\n\0]/.test(next.filePath)) throw new Error('VDJ cannot safely load this source using the current script quoting mechanism.');
    const pathNow = await queryVdj(config.virtualDJ, `deck ${deck.deck} get_filepath`);
    if (normalizeVdjPath(pathNow) === normalizeVdjPath(next.filePath)) return { ok: true, alreadyAdvanced: true, outcome };
    if (normalizeVdjPath(pathNow) !== normalizeVdjPath(deck.filePath)) throw new Error('VDJ advanced independently; no second Next command was sent.');
    if (operatingMode !== 'bridge') throw new Error('Bridge mode changed before Next.');
    await executeVdj(config.virtualDJ, `deck ${deck.deck} load "${next.filePath}"${deck.playing ? ` & deck ${deck.deck} play` : ''}`);
  }
  await vdjOperations.refresh();
  return { ok: true, outcome, nextLoaded: Boolean(next), playback: vdjOperations.view() };
}

let cloudLoopRunning = false;

async function executeCloudCommand(command) {
  if (operatingMode !== "bridge") {
    throw new Error("VirtualDJ commands are locked because this activity uses Player mode.");
  }
  const payload = command?.payload || {};
  if (command.commandType === "synchronize") {
    await syncNow();
    await reconcileVirtualDjQueue(true);
    return { synchronized: true };
  }
  if (command.commandType === "addRequest") {
    return runVdjQueueOperation(command, () => queueRequest(String(payload.requestId || ''), payload.filePath || ''));
  }
  if (command.commandType === "removeRequest") {
    return runVdjQueueOperation(command, () => removeQueuedRequest(String(payload.requestId || '')));
  }
  if (command.commandType === "markSang") {
    return runAdministrativeCommand(command, () => setRequestOutcome(String(payload.requestId || ''), 'completed', { removeVDJ: !vdjQueueOperationBusy }));
  }
  if (command.commandType === "markSkipped") {
    return runAdministrativeCommand(command, () => setRequestOutcome(String(payload.requestId || ''), 'skipped', { removeVDJ: !vdjQueueOperationBusy }));
  }
  if (command.commandType === "undo") {
    return runVdjQueueOperation(command, () => undoRequestOutcome(
      String(payload.requestId || ""),
      String(payload.placement || "pending")
    ));
  }
  if (command.commandType === "moveRequest") {
    return runVdjQueueOperation(command, () => queueRequest(String(payload.requestId || ''), payload.filePath || ''));
  }
  throw new Error("Unsupported Bridge command.");
}

async function bridgeCloudLoop() {
  if (operatingMode !== "bridge") return;
  if (cloudLoopRunning || !hasV4Session(config) || !config.lastActivityId) return;
  cloudLoopRunning = true;
  try {
    const data = await pollBridgeCommands(config);
    for (const command of data.commands || []) {
      try {
        const result = await executeCloudCommand(command);
        await completeBridgeCommand(config, command.commandId, {
          ok: true,
          result
        });
      } catch (error) {
        await completeBridgeCommand(config, command.commandId, {
          ok: false,
          errorMessage: errorMessage(error)
        });
      }
    }
  } catch (error) {
    sheetError = errorMessage(error);
  } finally {
    cloudLoopRunning = false;
    broadcastState();
  }
}

let cloudRealtimeSocket = null;
let cloudRealtimeReconnectTimer = null;
let cloudRealtimeFallbackTimer = null;
let cloudRealtimeAuthTimer = null;
let cloudRealtimeScheduleTimer = null;
let cloudRealtimeAttempt = 0;
let cloudRealtimeFallbackAttempt = 0;
let cloudRealtimeGeneration = 0;
let cloudRealtimeRefresh = null;
let cloudRealtimeRefreshGeneration = -1;
let cloudRealtimeReady = false;
let cloudRealtimePendingSync = false;
let cloudRealtimePendingCommands = false;

function cloudRealtimeEligible() {
  return hasV4Session(config) && Boolean(
    config.lastHotelId && config.lastActivityId && config.deviceId
  );
}

function clearCloudRealtimeTimers() {
  if (cloudRealtimeReconnectTimer) clearTimeout(cloudRealtimeReconnectTimer);
  if (cloudRealtimeFallbackTimer) clearTimeout(cloudRealtimeFallbackTimer);
  if (cloudRealtimeAuthTimer) clearTimeout(cloudRealtimeAuthTimer);
  if (cloudRealtimeScheduleTimer) clearTimeout(cloudRealtimeScheduleTimer);
  cloudRealtimeReconnectTimer = null;
  cloudRealtimeFallbackTimer = null;
  cloudRealtimeAuthTimer = null;
  cloudRealtimeScheduleTimer = null;
}

function terminalRealtimeError(error) {
  return /UNAUTHORIZED|session expired|revoked|sign in/i.test(errorMessage(error));
}

function scheduleCloudScheduleWake(data) {
  if (cloudRealtimeScheduleTimer) clearTimeout(cloudRealtimeScheduleTimer);
  cloudRealtimeScheduleTimer = null;
  if (!cloudRealtimeEligible()) return;
  const now = Date.now();
  const candidates = (Array.isArray(data?.schedules) ? data.schedules : [])
    .filter((schedule) => String(schedule?.status || "") === "active")
    .flatMap((schedule) => [schedule?.requestOpeningAt, schedule?.scheduledStartAt])
    .map((value) => Date.parse(String(value || "")))
    .filter((value) => Number.isFinite(value) && value > now + 250)
    .sort((left, right) => left - right);
  if (!candidates.length) return;
  const target = candidates[0];
  const delay = Math.min(2_000_000_000, Math.max(250, target - now + Math.floor(Math.random() * 750)));
  cloudRealtimeScheduleTimer = setTimeout(() => {
    cloudRealtimeScheduleTimer = null;
    if (target - Date.now() > 1000) {
      scheduleCloudScheduleWake(data);
      return;
    }
    void refreshCloudAfterSignal("schedule").catch((error) => {
      sheetError = errorMessage(error);
      broadcastState();
    });
  }, delay);
  cloudRealtimeScheduleTimer.unref();
}

function queueCloudRefresh(eventType) {
  if (eventType === "bridge.command.queued") {
    cloudRealtimePendingCommands = true;
    return;
  }
  if ([
    "public.request.created", "request.changed", "activity.changed",
    "experience.changed", "schedule"
  ].includes(eventType)) {
    cloudRealtimePendingSync = true;
    return;
  }
  cloudRealtimePendingSync = true;
  cloudRealtimePendingCommands = true;
}

async function refreshCloudAfterSignal(eventType = "bootstrap") {
  queueCloudRefresh(eventType);
  const generation = cloudRealtimeGeneration;
  if (cloudRealtimeRefresh && cloudRealtimeRefreshGeneration === generation) {
    return cloudRealtimeRefresh;
  }
  const operation = (async () => {
    while (
      generation === cloudRealtimeGeneration &&
      (cloudRealtimePendingSync || cloudRealtimePendingCommands)
    ) {
      const refreshState = cloudRealtimePendingSync;
      const refreshCommands = cloudRealtimePendingCommands;
      cloudRealtimePendingSync = false;
      cloudRealtimePendingCommands = false;
      if (refreshState) await syncNow();
      if (generation !== cloudRealtimeGeneration) return;
      if (terminalRealtimeError(sheetError)) {
        stopCloudRealtime();
        return;
      }
      if (refreshCommands) await bridgeCloudLoop();
      if (generation !== cloudRealtimeGeneration) return;
      if (terminalRealtimeError(sheetError)) {
        stopCloudRealtime();
        return;
      }
      if (sheetError) {
        scheduleCloudFallback(generation, true);
        return;
      }
      if (cloudRealtimeReady) cloudRealtimeFallbackAttempt = 0;
    }
  })();
  cloudRealtimeRefresh = operation;
  cloudRealtimeRefreshGeneration = generation;
  try {
    await operation;
  } finally {
    if (cloudRealtimeRefresh === operation) {
      cloudRealtimeRefresh = null;
      cloudRealtimeRefreshGeneration = -1;
    }
  }
}

function scheduleCloudFallback(generation, force = false) {
  if (
    generation !== cloudRealtimeGeneration || !cloudRealtimeEligible() ||
    (!force && cloudRealtimeReady) || cloudRealtimeFallbackTimer
  ) return;
  const base = Math.min(30_000, 5_000 * (2 ** Math.min(cloudRealtimeFallbackAttempt, 3)));
  cloudRealtimeFallbackAttempt += 1;
  const delay = base + Math.floor(Math.random() * Math.max(250, base * 0.2));
  cloudRealtimeFallbackTimer = setTimeout(async () => {
    cloudRealtimeFallbackTimer = null;
    if (generation !== cloudRealtimeGeneration || (!force && cloudRealtimeReady)) return;
    try {
      await refreshCloudAfterSignal();
    } catch (error) {
      sheetError = errorMessage(error);
      broadcastState();
      if (terminalRealtimeError(error)) {
        stopCloudRealtime();
        return;
      }
    }
    scheduleCloudFallback(generation, Boolean(sheetError));
  }, delay);
  cloudRealtimeFallbackTimer.unref();
}

function scheduleCloudReconnect(generation) {
  if (
    generation !== cloudRealtimeGeneration || !cloudRealtimeEligible() ||
    cloudRealtimeReconnectTimer
  ) return;
  const base = Math.min(30_000, 1_000 * (2 ** Math.min(cloudRealtimeAttempt, 5)));
  const delay = base + Math.floor(Math.random() * Math.max(100, base * 0.25));
  cloudRealtimeAttempt += 1;
  cloudRealtimeReconnectTimer = setTimeout(() => {
    cloudRealtimeReconnectTimer = null;
    connectCloudRealtime(generation);
  }, delay);
  cloudRealtimeReconnectTimer.unref();
  scheduleCloudFallback(generation);
}

function connectCloudRealtime(generation = cloudRealtimeGeneration) {
  if (
    generation !== cloudRealtimeGeneration || !cloudRealtimeEligible() ||
    cloudRealtimeSocket?.readyState === 0 || cloudRealtimeSocket?.readyState === 1
  ) return;
  if (typeof WebSocket !== "function") {
    scheduleCloudFallback(generation);
    return;
  }
  let connection;
  try {
    connection = bridgeRealtimeConnection(config, operatingMode);
  } catch (error) {
    sheetError = errorMessage(error);
    scheduleCloudFallback(generation);
    return;
  }
  const socket = new WebSocket(connection.url, connection.protocols);
  cloudRealtimeSocket = socket;
  cloudRealtimeReady = false;
  scheduleCloudFallback(generation);
  socket.addEventListener("open", () => {
    if (generation !== cloudRealtimeGeneration || cloudRealtimeSocket !== socket) {
      socket.close(1000, "Superseded");
      return;
    }
    socket.send(JSON.stringify(connection.authentication));
    cloudRealtimeAuthTimer = setTimeout(() => {
      cloudRealtimeAuthTimer = null;
      if (!cloudRealtimeReady && cloudRealtimeSocket === socket) {
        socket.close(4008, "Realtime authentication timed out");
      }
    }, 10_000);
    cloudRealtimeAuthTimer.unref();
  });
  socket.addEventListener("message", (event) => {
    if (generation !== cloudRealtimeGeneration || cloudRealtimeSocket !== socket) return;
    try {
      const message = JSON.parse(String(event.data || "{}"));
      if (!message.type || message.type === "realtime.auth-required" || message.type === "pong") return;
      if (message.type === "realtime.ready") {
        cloudRealtimeReady = true;
        cloudRealtimeAttempt = 0;
        cloudRealtimeFallbackAttempt = 0;
        if (cloudRealtimeAuthTimer) clearTimeout(cloudRealtimeAuthTimer);
        if (cloudRealtimeFallbackTimer) clearTimeout(cloudRealtimeFallbackTimer);
        cloudRealtimeAuthTimer = null;
        cloudRealtimeFallbackTimer = null;
      } else if (!cloudRealtimeReady) {
        return;
      }
      void refreshCloudAfterSignal(message.type === "realtime.ready" ? "bootstrap" : message.type).catch((error) => {
        sheetError = errorMessage(error);
        broadcastState();
      });
    } catch {
      // Only small server invalidations are accepted on this channel.
    }
  });
  socket.addEventListener("close", () => {
    if (generation !== cloudRealtimeGeneration || cloudRealtimeSocket !== socket) return;
    cloudRealtimeSocket = null;
    cloudRealtimeReady = false;
    if (cloudRealtimeAuthTimer) clearTimeout(cloudRealtimeAuthTimer);
    cloudRealtimeAuthTimer = null;
    scheduleCloudReconnect(generation);
  });
  socket.addEventListener("error", () => {
    if (generation === cloudRealtimeGeneration && cloudRealtimeSocket === socket) {
      cloudRealtimeReady = false;
    }
    // Undici closes failed WebSockets itself. Calling close() from this handler
    // can synchronously emit another error in Node 22 and overflow the stack.
  });
}

function stopCloudRealtime() {
  cloudRealtimeGeneration += 1;
  clearCloudRealtimeTimers();
  const socket = cloudRealtimeSocket;
  cloudRealtimeSocket = null;
  cloudRealtimeReady = false;
  cloudRealtimeAttempt = 0;
  cloudRealtimeFallbackAttempt = 0;
  cloudRealtimePendingSync = false;
  cloudRealtimePendingCommands = false;
  try { socket?.close(1000, "Guest Star disconnected"); } catch { /* already closed */ }
}

function restartCloudRealtime() {
  stopCloudRealtime();
  if (!cloudRealtimeEligible()) return;
  const generation = cloudRealtimeGeneration;
  connectCloudRealtime(generation);
}

await refreshStemEngineCapability();
await refreshSystemMemoryPressure();
updateStemResourceState();

server.listen(runtimePort, "127.0.0.1", () => {
  const edition = WEB_BETA ? "Guest Star Web Beta" : "Guest Star";
  console.log(`${edition} listo: http://127.0.0.1:${runtimePort}`);
});

await restoreBridgeIdentity();
try {
  await resumeRunningActivity();
} catch (error) {
  sheetError = errorMessage(error);
}
startLibraryWatchers();
await scanNow();
await syncNow();
void processStemQueue();
void verifyStemEngineCapability();

async function scanLoop() {
  await scanNow();
  setTimeout(scanLoop, (WEB_BETA ? 5 : config.scanIntervalSeconds) * 1000).unref();
}

setTimeout(scanLoop, (WEB_BETA ? 5 : config.scanIntervalSeconds) * 1000).unref();
restartCloudRealtime();
// Network Control exposes HTTP queries, not push events. Bounded LOCAL reads
// only while Bridge has an SSE consumer; never poll D1/cloud for playback.
async function vdjPlaybackLoop() {
  if (operatingMode === 'bridge' && eventClients.size > 0) await vdjOperations.refresh();
  setTimeout(vdjPlaybackLoop, vdjOperations.view().connected ? 1000 : 5000).unref();
}
void vdjPlaybackLoop();
setInterval(() => {
  void refreshSystemMemoryPressure().then(() => {
    const result = updateStemResourceState();
    if (result.state !== "PRESSURE") void processStemQueue();
  });
}, 2000).unref();
setInterval(() => {
  if (!playerRuntimeDirty) return;
  void pushPlayerRuntimeRemote().catch((error) => {
    sheetError = errorMessage(error);
    broadcastState();
  });
}, 10000).unref();
setInterval(() => {
  for (const response of [...eventClients]) {
    try {
      response.write(": keepalive\n\n");
    } catch {
      eventClients.delete(response);
    }
  }
}, 20000).unref();
setInterval(() => {
  const queued = diagnostics.reports.find((report) =>
    (report.deliveryStatus === "queued" || (report.automatic === true && report.deliveryStatus === "local")) &&
    (report.automatic !== true || diagnosticPreferences.view().autoSendTechnicalErrors === true)
  );
  if (queued) void deliverDiagnosticReport(queued);
}, 30000).unref();

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (activeStemChild?.pid) {
      try {
        if (activeStemChild.guestStarStopped) activeStemChild.kill("SIGCONT");
        activeStemChild.kill("SIGTERM");
      } catch { /* The stem process may already have completed. */ }
    }
    closeLibraryWatchers();
    for (const response of eventClients) response.end();
    eventClients.clear();
    server.close(() => process.exit(0));
  });
}
