import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBridgeSecrets, storeBridgeSecrets } from "./keychain.mjs";
import { normalizeFavoriteSongs } from "./random-rotation.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = resolve(ROOT, "data");
const CONFIG_PATH = resolve(DATA_DIR, "config.json");
const BRIDGE_PROXY_URL = "https://request.gstarxp.com/api/bridge";

export const DEFAULT_CONFIG = Object.freeze({
  configVersion: 15,
  bridgePort: 8787,
  authToken: "",
  deviceToken: "",
  deviceId: "",
  lastHotelId: "",
  lastVenueId: "",
  lastActivityId: "",
  lastUsername: "",
  rememberLogin: true,
  rememberSelection: true,
  rememberedActivity: null,
  superhostLanguage: "es",
  uiLanguage: "es",
  favoriteSongsByHotel: {},
  secretsInKeychain: false,
  libraryFolders: [],
  playerAudioFolders: [],
  playerVideoFolders: [],
  playerMediaPriority: "auto",
  rememberLibraryFolders: true,
  backgroundMusicSources: [],
  backgroundMusicVolume: 0.55,
  audioOutputDeviceId: "",
  starScreenDisplayId: "",
  selectedStemEngine: "gsvocalrt",
  defaultStemEngine: "gsvocalrt", // Compatibility alias; never enables Auto.
  defaultVocalGuideLevel: 0,
  interfacePreferences: {
    showStarScreenPreview: true,
    showWaveform: true,
    showStarScreenNowPlaying: true,
    showActivityAccess: false,
    showCurrentSongBackground: false,
    starScreenSongSource: "request",
    starScreenLineupCount: 5,
    showEq: true,
    showAdvancedControls: true
  },
  diagnostics: {
    autoSendTechnicalErrors: false,
    testerMode: false
  },
  appsScriptUrl: BRIDGE_PROXY_URL,
  virtualDJ: {
    host: "127.0.0.1",
    port: 80,
    password: "",
    timeoutMs: 3500
  },
  scanIntervalSeconds: 10,
  autoQueueExact: true
});

function numberInRange(value, fallback, min, max) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeFolders(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))];
}

function normalizeFavoritesByHotel(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [hotelId, songs] of Object.entries(value).slice(0, 50)) {
    const safeHotelId = String(hotelId || "").trim().slice(0, 100);
    if (!safeHotelId) continue;
    result[safeHotelId] = normalizeFavoriteSongs(songs);
  }
  return result;
}

function normalizeInterfacePreferences(value, current = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const previous = current && typeof current === "object" && !Array.isArray(current)
    ? current
    : DEFAULT_CONFIG.interfacePreferences;
  return {
    showStarScreenPreview: source.showStarScreenPreview === undefined
      ? previous.showStarScreenPreview !== false
      : source.showStarScreenPreview !== false,
    showWaveform: source.showWaveform === undefined
      ? previous.showWaveform !== false
      : source.showWaveform !== false,
    showStarScreenNowPlaying: source.showStarScreenNowPlaying === undefined
      ? previous.showStarScreenNowPlaying !== false
      : source.showStarScreenNowPlaying !== false,
    showActivityAccess: source.showActivityAccess === undefined
      ? previous.showActivityAccess === true
      : source.showActivityAccess === true,
    showCurrentSongBackground: source.showCurrentSongBackground === undefined
      ? previous.showCurrentSongBackground === true
      : source.showCurrentSongBackground === true,
    starScreenSongSource: source.starScreenSongSource === undefined
      ? previous.starScreenSongSource === "local" ? "local" : "request"
      : source.starScreenSongSource === "local" ? "local" : "request",
    starScreenLineupCount: source.starScreenLineupCount === undefined
      ? Number.isInteger(previous.starScreenLineupCount) && previous.starScreenLineupCount >= 1 && previous.starScreenLineupCount <= 5 ? previous.starScreenLineupCount : 5
      : Number.isInteger(Number(source.starScreenLineupCount)) && Number(source.starScreenLineupCount) >= 1 && Number(source.starScreenLineupCount) <= 5 ? Number(source.starScreenLineupCount) : Number.isInteger(previous.starScreenLineupCount) && previous.starScreenLineupCount >= 1 && previous.starScreenLineupCount <= 5 ? previous.starScreenLineupCount : 5,
    showEq: source.showEq === undefined
      ? previous.showEq !== false
      : source.showEq !== false,
    showAdvancedControls: source.showAdvancedControls === undefined
      ? previous.showAdvancedControls !== false
      : source.showAdvancedControls !== false
  };
}

function normalizeDiagnosticPreferences(value, current = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
  const previous = current && typeof current === "object" && !Array.isArray(current)
    ? current
    : DEFAULT_CONFIG.diagnostics;
  return {
    autoSendTechnicalErrors: source.autoSendTechnicalErrors === undefined
      ? previous.autoSendTechnicalErrors === true
      : source.autoSendTechnicalErrors === true,
    testerMode: source.testerMode === undefined
      ? previous.testerMode === true
      : source.testerMode === true
  };
}

export function migrateAppsScriptUrl(value, configVersion) {
  void configVersion;
  const candidate = String(value || "").trim();
  if (!candidate) return BRIDGE_PROXY_URL;
  try {
    const url = new URL(candidate);
    if (["localhost", "127.0.0.1"].includes(url.hostname)) return candidate;
    if (
      url.protocol === "https:" &&
      url.hostname === "request.gstarxp.com" &&
      url.pathname.replace(/\/$/, "") === "/api/bridge"
    ) return BRIDGE_PROXY_URL;
  } catch {
    // Invalid and retired endpoints are replaced with the fixed D1 proxy.
  }
  return BRIDGE_PROXY_URL;
}

export function sanitizeConfig(input = {}, current = DEFAULT_CONFIG) {
  const vdj = input.virtualDJ || {};
  const currentVdj = current.virtualDJ || DEFAULT_CONFIG.virtualDJ;
  return {
    configVersion: DEFAULT_CONFIG.configVersion,
    bridgePort: numberInRange(input.bridgePort, current.bridgePort, 1024, 65535),
    authToken:
      input.authToken === undefined ? String(current.authToken || "") : String(input.authToken || ""),
    deviceToken:
      input.deviceToken === undefined ? String(current.deviceToken || "") : String(input.deviceToken || ""),
    deviceId:
      input.deviceId === undefined ? String(current.deviceId || "") : String(input.deviceId || ""),
    lastHotelId:
      input.lastHotelId === undefined ? String(current.lastHotelId || "") : String(input.lastHotelId || ""),
    lastVenueId:
      input.lastVenueId === undefined ? String(current.lastVenueId || "") : String(input.lastVenueId || ""),
    lastActivityId:
      input.lastActivityId === undefined ? String(current.lastActivityId || "") : String(input.lastActivityId || ""),
    rememberedActivity: (()=>{
      const value=input.rememberedActivity===undefined
        ? current.rememberedActivity || ((input.rememberSelection ?? current.rememberSelection) && (input.lastActivityId ?? current.lastActivityId) ? {hotelId:input.lastHotelId ?? current.lastHotelId,venueId:input.lastVenueId ?? current.lastVenueId,activityId:input.lastActivityId ?? current.lastActivityId} : null)
        : input.rememberedActivity;
      return value?.hotelId && value?.venueId && value?.activityId ? {hotelId:String(value.hotelId),venueId:String(value.venueId),activityId:String(value.activityId)} : null;
    })(),
    lastUsername:
      input.lastUsername === undefined ? String(current.lastUsername || "") : String(input.lastUsername || "").trim(),
    rememberLogin:
      input.rememberLogin === undefined ? Boolean(current.rememberLogin) : Boolean(input.rememberLogin),
    rememberSelection:
      input.rememberSelection === undefined
        ? Boolean(current.rememberSelection)
        : Boolean(input.rememberSelection),
    superhostLanguage:
      String(
        input.superhostLanguage === undefined
          ? current.superhostLanguage || "es"
          : input.superhostLanguage
      ).toLowerCase() === "en"
        ? "en"
        : "es",
    uiLanguage:
      String(
        input.uiLanguage === undefined
          ? current.uiLanguage || "es"
          : input.uiLanguage
      ).toLowerCase() === "en"
        ? "en"
        : "es",
    favoriteSongsByHotel: normalizeFavoritesByHotel(
      input.favoriteSongsByHotel === undefined
        ? current.favoriteSongsByHotel
        : input.favoriteSongsByHotel
    ),
    secretsInKeychain:
      input.secretsInKeychain === undefined
        ? Boolean(current.secretsInKeychain)
        : Boolean(input.secretsInKeychain),
    libraryFolders: normalizeFolders(
      input.libraryFolders === undefined ? current.libraryFolders : input.libraryFolders
    ),
    playerAudioFolders: normalizeFolders(input.playerAudioFolders === undefined ? current.playerAudioFolders : input.playerAudioFolders),
    playerVideoFolders: normalizeFolders(input.playerVideoFolders === undefined ? current.playerVideoFolders : input.playerVideoFolders),
    playerMediaPriority: ['audio','video','auto'].includes(input.playerMediaPriority ?? current.playerMediaPriority) ? (input.playerMediaPriority ?? current.playerMediaPriority) : 'auto',
    rememberLibraryFolders:
      input.rememberLibraryFolders === undefined
        ? Boolean(current.rememberLibraryFolders)
        : Boolean(input.rememberLibraryFolders),
    backgroundMusicSources: normalizeFolders(
      input.backgroundMusicSources === undefined
        ? current.backgroundMusicSources
        : input.backgroundMusicSources
    ),
    backgroundMusicVolume: numberInRange(
      input.backgroundMusicVolume,
      Number(current.backgroundMusicVolume ?? 0.55),
      0,
      1
    ),
    audioOutputDeviceId:
      input.audioOutputDeviceId === undefined
        ? String(current.audioOutputDeviceId || "").trim().slice(0, 500)
        : String(input.audioOutputDeviceId || "").trim().slice(0, 500),
    starScreenDisplayId:
      input.starScreenDisplayId === undefined
        ? String(current.starScreenDisplayId || "").trim().slice(0, 500)
        : String(input.starScreenDisplayId || "").trim().slice(0, 500),
    defaultVocalGuideLevel: Math.max(0, Math.min(0.2, Number(input.defaultVocalGuideLevel ?? current.defaultVocalGuideLevel ?? 0) || 0)),
    selectedStemEngine: ["spleeter", "demucs", "gsvocalrt"].includes(String(input.selectedStemEngine ?? input.defaultStemEngine ?? current.selectedStemEngine ?? current.defaultStemEngine).toLowerCase())
      ? String(input.selectedStemEngine ?? input.defaultStemEngine ?? current.selectedStemEngine ?? current.defaultStemEngine).toLowerCase() : "spleeter",
    defaultStemEngine: ["spleeter", "demucs", "gsvocalrt"].includes(String(input.selectedStemEngine ?? input.defaultStemEngine ?? current.selectedStemEngine ?? current.defaultStemEngine).toLowerCase())
      ? String(input.selectedStemEngine ?? input.defaultStemEngine ?? current.selectedStemEngine ?? current.defaultStemEngine).toLowerCase() : "spleeter",
    interfacePreferences: normalizeInterfacePreferences(
      input.interfacePreferences,
      current.interfacePreferences
    ),
    diagnostics: normalizeDiagnosticPreferences(
      input.diagnostics,
      current.diagnostics
    ),
    appsScriptUrl: migrateAppsScriptUrl(
      input.appsScriptUrl === undefined
        ? current.appsScriptUrl
        : input.appsScriptUrl,
      input.configVersion === undefined ? current.configVersion : input.configVersion
    ),
    virtualDJ: {
      host:
        vdj.host === undefined ? currentVdj.host : String(vdj.host || "127.0.0.1").trim(),
      port: numberInRange(vdj.port, currentVdj.port, 1, 65535),
      password:
        vdj.password === undefined || vdj.password === ""
          ? currentVdj.password
          : String(vdj.password),
      timeoutMs: numberInRange(vdj.timeoutMs, currentVdj.timeoutMs, 500, 15000)
    },
    scanIntervalSeconds: numberInRange(
      input.scanIntervalSeconds,
      current.scanIntervalSeconds,
      5,
      300
    ),
    autoQueueExact:
      input.autoQueueExact === undefined
        ? Boolean(current.autoQueueExact)
        : Boolean(input.autoQueueExact)
  };
}

export function configForStorage(config) {
  const clean = sanitizeConfig(config, DEFAULT_CONFIG);
  return {
    ...clean,
    authToken: clean.rememberLogin ? clean.authToken : "",
    deviceToken: clean.rememberLogin ? clean.deviceToken : "",
    lastHotelId: clean.rememberedActivity?.hotelId || "",
    lastVenueId: clean.rememberedActivity?.venueId || "",
    lastActivityId: clean.rememberedActivity?.activityId || "",
    libraryFolders: clean.rememberLibraryFolders ? clean.libraryFolders : []
  };
}

export function mergeLoadedSecrets(config, keychain = {}) {
  return sanitizeConfig({
    ...config,
    authToken: keychain.authToken || config.authToken,
    deviceToken: keychain.deviceToken || config.deviceToken
  }, config);
}

export async function loadConfig() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const parsed = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
    const needsMigration =
      Number(parsed.configVersion || 0) < DEFAULT_CONFIG.configVersion;
    if (needsMigration) {
      parsed.appsScriptUrl = migrateAppsScriptUrl(
        parsed.appsScriptUrl,
        parsed.configVersion
      );
      parsed.configVersion = DEFAULT_CONFIG.configVersion;
      if (parsed.autoQueueExact === undefined) parsed.autoQueueExact = true;
      if (parsed.rememberLibraryFolders === undefined) {
        parsed.rememberLibraryFolders = true;
      }
      if (parsed.backgroundMusicSources === undefined) {
        parsed.backgroundMusicSources = [];
      }
      if (parsed.backgroundMusicVolume === undefined) {
        parsed.backgroundMusicVolume = 0.55;
      }
      if (parsed.audioOutputDeviceId === undefined) parsed.audioOutputDeviceId = "";
      if (parsed.starScreenDisplayId === undefined) parsed.starScreenDisplayId = "";
      if (parsed.defaultStemEngine === undefined) parsed.defaultStemEngine = "spleeter";
      if (parsed.interfacePreferences === undefined) {
        parsed.interfacePreferences = { ...DEFAULT_CONFIG.interfacePreferences };
      }
      if (parsed.diagnostics === undefined) {
        parsed.diagnostics = { ...DEFAULT_CONFIG.diagnostics };
      }
      if (parsed.rememberLogin === undefined) parsed.rememberLogin = true;
      if (parsed.rememberSelection === undefined) parsed.rememberSelection = true;
      if (parsed.superhostLanguage === undefined) parsed.superhostLanguage = "es";
      if (parsed.uiLanguage === undefined) parsed.uiLanguage = "es";
      if (parsed.favoriteSongsByHotel === undefined) parsed.favoriteSongsByHotel = {};
    }
    let clean = sanitizeConfig(parsed, DEFAULT_CONFIG);
    if (
      clean.secretsInKeychain &&
      clean.deviceId &&
      (!clean.authToken || !clean.deviceToken)
    ) {
      const keychain = await loadBridgeSecrets(clean.deviceId);
      clean = mergeLoadedSecrets(clean, keychain);
    }
    if (needsMigration) await saveConfig(clean);
    return clean;
  } catch {
    const fresh = sanitizeConfig(DEFAULT_CONFIG, DEFAULT_CONFIG);
    await saveConfig(fresh);
    return fresh;
  }
}

export async function saveConfig(config, { storeSecrets = false } = {}) {
  const clean = sanitizeConfig(config, DEFAULT_CONFIG);
  const keychainSaved = clean.rememberLogin && storeSecrets
    ? await storeBridgeSecrets(clean)
    : false;
  const saved = sanitizeConfig({
    ...clean,
    secretsInKeychain: storeSecrets ? keychainSaved : clean.secretsInKeychain
  }, clean);
  const stored = configForStorage(saved);
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  try {
    await chmod(CONFIG_PATH, 0o600);
  } catch {
    // Windows and some mounted filesystems do not implement POSIX permissions.
  }
  return saved;
}

export function publicConfig(config) {
  return {
    ...config,
    authToken: "",
    deviceToken: "",
    signedIn: Boolean(config.authToken && config.deviceToken && config.deviceId),
    favoriteSongsByHotel: {},
    virtualDJ: {
      ...config.virtualDJ,
      password: "",
      passwordConfigured: Boolean(config.virtualDJ.password)
    }
  };
}

export {
  BRIDGE_PROXY_URL,
  CONFIG_PATH,
  ROOT
};
