import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = resolve(ROOT, "data");
const CONFIG_PATH = resolve(DATA_DIR, "config.json");

export const DEFAULT_CONFIG = Object.freeze({
  configVersion: 6,
  bridgePort: 8787,
  libraryFolders: [],
  rememberLibraryFolders: true,
  appsScriptUrl:
    "https://script.google.com/macros/s/AKfycbxtWSOtS9IuiHJk6eRGAwy-6GsbypLUU4-3hzrNHp4NYXPcsZexgHVkF0y4KlU3zMfA/exec",
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

export function sanitizeConfig(input = {}, current = DEFAULT_CONFIG) {
  const vdj = input.virtualDJ || {};
  const currentVdj = current.virtualDJ || DEFAULT_CONFIG.virtualDJ;
  return {
    configVersion: DEFAULT_CONFIG.configVersion,
    bridgePort: numberInRange(input.bridgePort, current.bridgePort, 1024, 65535),
    libraryFolders: normalizeFolders(
      input.libraryFolders === undefined ? current.libraryFolders : input.libraryFolders
    ),
    rememberLibraryFolders:
      input.rememberLibraryFolders === undefined
        ? Boolean(current.rememberLibraryFolders)
        : Boolean(input.rememberLibraryFolders),
    appsScriptUrl:
      input.appsScriptUrl === undefined
        ? current.appsScriptUrl
        : String(input.appsScriptUrl || "").trim(),
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
      parsed.configVersion = DEFAULT_CONFIG.configVersion;
      parsed.requestIntervalSeconds = 2;
      if (parsed.autoQueueExact === undefined) parsed.autoQueueExact = true;
      if (parsed.rememberLibraryFolders === undefined) {
        parsed.rememberLibraryFolders = true;
      }
      if (parsed.rememberHostPin === undefined) parsed.rememberHostPin = true;
    }
    const clean = sanitizeConfig(parsed, DEFAULT_CONFIG);
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
  const stored = configForStorage(clean);
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
    hostPin: "",
    hostPinConfigured: Boolean(config.hostPin),
    virtualDJ: {
      ...config.virtualDJ,
      password: "",
      passwordConfigured: Boolean(config.virtualDJ.password)
    }
  };
}

export { CONFIG_PATH, ROOT };
