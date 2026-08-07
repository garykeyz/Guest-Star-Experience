import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadBridgeSecrets, storeBridgeSecrets } from "./keychain.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = resolve(ROOT, "data");
const CONFIG_PATH = resolve(DATA_DIR, "config.json");
const LEGACY_DIRECT_APPS_SCRIPT_URL =
  "https://script.google.com/macros/s/AKfycbxtWSOtS9IuiHJk6eRGAwy-6GsbypLUU4-3hzrNHp4NYXPcsZexgHVkF0y4KlU3zMfA/exec";
const BRIDGE_PROXY_URL = "https://request.gstarxp.com/api/bridge";

export const DEFAULT_CONFIG = Object.freeze({
  configVersion: 8,
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
  secretsInKeychain: false,
  libraryFolders: [],
  rememberLibraryFolders: true,
  appsScriptUrl: BRIDGE_PROXY_URL,
  hostPin: "",
  rememberHostPin: true,
  virtualDJ: {
    host: "127.0.0.1",
    port: 80,
    password: "",
    timeoutMs: 3500
  },
  requestIntervalSeconds: 2,
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

export function migrateAppsScriptUrl(value, configVersion) {
  const candidate = String(value || "").trim();
  if (!candidate) return candidate;
  try {
    const url = new URL(candidate);
    const directAppsScriptWebApp =
      url.protocol === "https:" &&
      url.hostname === "script.google.com" &&
      /^\/macros\/s\/[^/]+\/exec\/?$/.test(url.pathname);
    if (directAppsScriptWebApp) return BRIDGE_PROXY_URL;
  } catch {
    // sanitizeConfig will preserve the invalid value so the UI can report it.
  }
  return candidate;
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
    lastUsername:
      input.lastUsername === undefined ? String(current.lastUsername || "") : String(input.lastUsername || "").trim(),
    rememberLogin:
      input.rememberLogin === undefined ? Boolean(current.rememberLogin) : Boolean(input.rememberLogin),
    rememberSelection:
      input.rememberSelection === undefined
        ? Boolean(current.rememberSelection)
        : Boolean(input.rememberSelection),
    secretsInKeychain:
      input.secretsInKeychain === undefined
        ? Boolean(current.secretsInKeychain)
        : Boolean(input.secretsInKeychain),
    libraryFolders: normalizeFolders(
      input.libraryFolders === undefined ? current.libraryFolders : input.libraryFolders
    ),
    rememberLibraryFolders:
      input.rememberLibraryFolders === undefined
        ? Boolean(current.rememberLibraryFolders)
        : Boolean(input.rememberLibraryFolders),
    appsScriptUrl: migrateAppsScriptUrl(
      input.appsScriptUrl === undefined
        ? current.appsScriptUrl
        : input.appsScriptUrl,
      input.configVersion === undefined ? current.configVersion : input.configVersion
    ),
    hostPin:
      input.hostPin === undefined || input.hostPin === ""
        ? current.hostPin
        : String(input.hostPin).replace(/\D/g, "").slice(0, 12),
    rememberHostPin:
      input.rememberHostPin === undefined
        ? Boolean(current.rememberHostPin)
        : Boolean(input.rememberHostPin),
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
    requestIntervalSeconds: numberInRange(
      input.requestIntervalSeconds,
      current.requestIntervalSeconds,
      2,
      120
    ),
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
    lastHotelId: clean.rememberSelection ? clean.lastHotelId : "",
    lastVenueId: clean.rememberSelection ? clean.lastVenueId : "",
    lastActivityId: clean.rememberSelection ? clean.lastActivityId : "",
    libraryFolders: clean.rememberLibraryFolders ? clean.libraryFolders : [],
    hostPin: clean.rememberHostPin ? clean.hostPin : ""
  };
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
      parsed.requestIntervalSeconds = 2;
      if (parsed.autoQueueExact === undefined) parsed.autoQueueExact = true;
      if (parsed.rememberLibraryFolders === undefined) {
        parsed.rememberLibraryFolders = true;
      }
      if (parsed.rememberHostPin === undefined) parsed.rememberHostPin = true;
      if (parsed.rememberLogin === undefined) parsed.rememberLogin = true;
      if (parsed.rememberSelection === undefined) parsed.rememberSelection = true;
    }
    let clean = sanitizeConfig(parsed, DEFAULT_CONFIG);
    if (clean.secretsInKeychain && clean.deviceId) {
      const keychain = await loadBridgeSecrets(clean.deviceId);
      clean = sanitizeConfig({ ...clean, ...keychain }, clean);
    }
    if (needsMigration) await saveConfig(clean);
    return clean;
  } catch {
    const fresh = sanitizeConfig(DEFAULT_CONFIG, DEFAULT_CONFIG);
    await saveConfig(fresh);
    return fresh;
  }
}

export async function saveConfig(config) {
  const clean = sanitizeConfig(config, DEFAULT_CONFIG);
  const keychainSaved = clean.rememberLogin
    ? await storeBridgeSecrets(clean)
    : false;
  const stored = configForStorage({
    ...clean,
    secretsInKeychain: keychainSaved
  });
  if (keychainSaved) {
    stored.authToken = "";
    stored.deviceToken = "";
  }
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, `${JSON.stringify(stored, null, 2)}\n`, "utf8");
  try {
    await chmod(CONFIG_PATH, 0o600);
  } catch {
    // Windows and some mounted filesystems do not implement POSIX permissions.
  }
  return clean;
}

export function publicConfig(config) {
  return {
    ...config,
    authToken: "",
    deviceToken: "",
    signedIn: Boolean(config.authToken && config.deviceToken && config.deviceId),
    hostPin: "",
    hostPinConfigured: Boolean(config.hostPin),
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
  LEGACY_DIRECT_APPS_SCRIPT_URL,
  ROOT
};
