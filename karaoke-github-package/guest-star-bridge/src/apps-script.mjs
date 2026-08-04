async function parseResponse(response) {
  const text = await response.text();
  if (!response.ok) throw new Error(`Google Apps Script respondió ${response.status}.`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Google Apps Script no devolvió una respuesta JSON válida.");
  }
}

const REQUIRED_CODE_VERSION = "3.0.6";

export async function appsScriptAction(config, action, extra = {}) {
  if (!config.appsScriptUrl) throw new Error("Configura el enlace de Google Apps Script.");
  if (!config.hostPin) throw new Error("Configura el PIN privado del host.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(config.appsScriptUrl, {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ action, pin: config.hostPin, ...extra }),
      signal: controller.signal
    });
    const data = await parseResponse(response);
    if (!data.ok) {
      const message =
        data.code === "INVALID_PIN"
          ? "El PIN del host no coincide."
          : data.error || data.code || "Google Apps Script rechazó la solicitud.";
      throw new Error(message);
    }
    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Google Apps Script no respondió a tiempo.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchBridgeQueue(config) {
  const data = await appsScriptAction(config, "bridgeQueue");
  if (!Array.isArray(data.requests)) {
    throw new Error(
      "La implementación publicada de Apps Script no devolvió la cola. Publica Code.gs como una nueva versión."
    );
  }
  return data;
}

export function updateBridgeRequest(
  config,
  id,
  status,
  fileName = "",
  extra = {}
) {
  return appsScriptAction(config, "bridgeUpdate", {
    id,
    status,
    fileName,
    durationSeconds: extra.durationSeconds,
    sourceUrl: extra.sourceUrl
  });
}

export function updateBridgeConfig(config, sheetConfig = {}) {
  return appsScriptAction(config, "bridgeConfigUpdate", {
    source: "bridge",
    activityHours: sheetConfig.activityHours,
    transitionSeconds: sheetConfig.transitionSeconds,
    accepting: sheetConfig.accepting
  });
}

export function searchKaraokeYouTube(config, song, artist, language = "") {
  return appsScriptAction(config, "youtubeSearch", { song, artist, language });
}

export async function controlActivity(config, action) {
  if (!["start", "open", "close", "reset"].includes(action)) {
    throw new Error("Acción de actividad no permitida.");
  }
  let data;
  try {
    data = await appsScriptAction(config, "bridgeControl", {
      control: action,
      source: "bridge"
    });
  } catch (error) {
    if (
      String(error?.message || "").includes("INVALID_ACTION") ||
      String(error?.message || "").includes("Acción")
    ) {
      throw new Error(
        `El Code.gs publicado está desactualizado. Instala el Code.gs ${REQUIRED_CODE_VERSION} y publica una versión nueva.`
      );
    }
    throw error;
  }
  if (!data?.state || !Array.isArray(data.requests)) {
    throw new Error(
      `Google Sheets no confirmó el cambio. Instala el Code.gs ${REQUIRED_CODE_VERSION} y publica una versión nueva.`
    );
  }
  if (action === "open" && data.state.accepting === false) {
    throw new Error("Google Sheets no confirmó que las solicitudes quedaron abiertas.");
  }
  if (action === "close" && data.state.accepting !== false) {
    throw new Error("Google Sheets no confirmó que las solicitudes quedaron cerradas.");
  }
  if (action === "reset" && data.state.lastAction !== "reset") {
    throw new Error("Google Sheets no confirmó el reinicio de la actividad.");
  }
  if (action === "start" && data.state.lastAction !== "start") {
    throw new Error("Google Sheets no confirmó el inicio de la actividad.");
  }
  if (action === "reset" && data.requests.length !== 0) {
    throw new Error("Google Sheets no archivó todas las solicitudes al reiniciar.");
  }
  return data;
}
