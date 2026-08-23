async function parseResponse(response) {
  const text = await response.text();
  if (!response.ok) throw new Error(`Guest Star returned ${response.status}.`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Guest Star did not return a valid response.");
  }
}

const REQUIRED_CODE_VERSION = "4.2.0";
const BRIDGE_APP_VERSION = "4.3.0";
const APPS_SCRIPT_TIMEOUT_MS = 70000;

function endpoint(config) {
  if (!config.appsScriptUrl) throw new Error("Guest Star connection is not configured.");
  return config.appsScriptUrl;
}

async function postPayload(config, payload, timeoutMs = APPS_SCRIPT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint(config), {
      method: "POST",
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = await parseResponse(response);
    if (!data.ok) {
      const messages = {
        INVALID_PIN: "The legacy host PIN does not match.",
        UNAUTHORIZED: "Your Guest Star session expired. Sign in again.",
        FORBIDDEN: "Your account does not have permission for this action.",
        DEVICE_REVOKED: "This Bridge computer was revoked by the Superhost.",
        BRIDGE_OFFLINE: "The selected Bridge is offline."
      };
      throw new Error(messages[data.code] || data.error || data.code || "Guest Star rejected the request.");
    }
    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Guest Star did not respond in time.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function hasV4Session(config) {
  return Boolean(config.authToken && config.deviceToken && config.deviceId);
}

export function v4AppsScriptAction(config, action, extra = {}) {
  if (!config.authToken) throw new Error("Sign in to Guest Star first.");
  return postPayload(config, {
    action,
    authToken: config.authToken,
    deviceToken: config.deviceToken || "",
    ...extra
  });
}

export function signInBridge(config, credentials) {
  return postPayload(config, {
    action: "login",
    username: credentials.username,
    password: credentials.password,
    clientType: "bridge",
    deviceId: config.deviceId || credentials.deviceId || "",
    deviceName: credentials.deviceName || "Guest Star Bridge",
    bridgeVersion: BRIDGE_APP_VERSION,
    rememberLogin: credentials.rememberLogin !== false
  });
}

export function fetchGoogleLoginConfig(config) {
  return postPayload(config, { action: "googleLoginConfig" });
}

export function signInBridgeWithGoogle(config, credential, options = {}) {
  return postPayload(config, {
    action: "googleLogin",
    credential,
    clientType: "bridge",
    deviceId: config.deviceId || options.deviceId || "",
    deviceName: options.deviceName || "Guest Star Bridge",
    bridgeVersion: BRIDGE_APP_VERSION,
    rememberLogin: options.rememberLogin !== false
  });
}

export function signOutBridge(config) {
  return v4AppsScriptAction(config, "logout");
}

export function fetchBridgeIdentity(config) {
  return v4AppsScriptAction(config, "me");
}

export function selectBridgeActivity(config, selection) {
  return v4AppsScriptAction(config, "selectActivity", selection);
}

export function createHostPanelLogin(config) {
  return v4AppsScriptAction(config, "createOneTimeLoginCode");
}

export function sendBridgeHeartbeat(config, status = {}) {
  return v4AppsScriptAction(config, "bridgeHeartbeat", {
    bridgeVersion: BRIDGE_APP_VERSION,
    virtualDJConnected: status.virtualDJConnected === true
  });
}

export function pollBridgeCommands(config) {
  return v4AppsScriptAction(config, "pollBridgeCommands");
}

export function completeBridgeCommand(config, commandId, result) {
  return v4AppsScriptAction(config, "completeBridgeCommand", {
    commandId,
    ok: result.ok === true,
    result: result.result || {},
    errorMessage: result.errorMessage || ""
  });
}

export function syncExternalVirtualDjEntries(config, entries, confirmedMissingIds = []) {
  return v4AppsScriptAction(config, "bridgeExternalSync", {
    entries,
    confirmedMissingIds
  });
}

export async function appsScriptAction(config, action, extra = {}) {
  if (!config.appsScriptUrl) throw new Error("Configure the Guest Star connection.");
  if (!config.hostPin) throw new Error("Configure the private legacy host PIN.");
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
          ? "The legacy host PIN does not match."
          : data.error || data.code || "Guest Star rejected the request.";
      throw new Error(message);
    }
    return data;
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error("Guest Star did not respond in time.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchBridgeQueue(config) {
  if (hasV4Session(config)) {
    return v4AppsScriptAction(config, "activityState", {
      hotelId: config.lastHotelId,
      venueId: config.lastVenueId,
      activityId: config.lastActivityId
    });
  }
  const data = await appsScriptAction(config, "bridgeQueue");
  if (!Array.isArray(data.requests)) {
    throw new Error(
      "Guest Star did not return the request queue. Contact the Superhost."
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
  if (hasV4Session(config)) {
    return v4AppsScriptAction(config, "bridgeRequestUpdate", {
      id,
      status,
      fileName,
      durationSeconds: extra.durationSeconds,
      sourceUrl: extra.sourceUrl,
      virtualDJItemId: extra.virtualDJItemId,
      queuePosition: extra.queuePosition,
      syncState: extra.syncState,
      lastSeenAt: extra.lastSeenAt
    });
  }
  return appsScriptAction(config, "bridgeUpdate", {
    id,
    status,
    fileName,
    durationSeconds: extra.durationSeconds,
    sourceUrl: extra.sourceUrl
  });
}

export function updateBridgeConfig(config, sheetConfig = {}) {
  if (hasV4Session(config)) {
    return v4AppsScriptAction(config, "updateActivitySettings", {
      hotelId: config.lastHotelId,
      venueId: config.lastVenueId,
      activityId: config.lastActivityId,
      source: "bridge",
      defaultDurationSeconds:
        sheetConfig.activityHours === undefined
          ? undefined
          : Math.round(Number(sheetConfig.activityHours) * 3600),
      defaultTransitionSeconds: sheetConfig.transitionSeconds
    });
  }
  return appsScriptAction(config, "bridgeConfigUpdate", {
    source: "bridge",
    activityHours: sheetConfig.activityHours,
    transitionSeconds: sheetConfig.transitionSeconds,
    accepting: sheetConfig.accepting
  });
}

export function searchKaraokeYouTube(
  config,
  song,
  artist,
  language = "",
  languageCode = ""
) {
  if (hasV4Session(config)) {
    return v4AppsScriptAction(config, "youtubeSearchV4", {
      hotelId: config.lastHotelId,
      venueId: config.lastVenueId,
      activityId: config.lastActivityId,
      song,
      artist,
      language,
      languageCode
    });
  }
  return appsScriptAction(config, "youtubeSearch", {
    song,
    artist,
    language,
    languageCode
  });
}

export async function controlActivity(config, action) {
  if (!["start", "open", "close", "reset"].includes(action)) {
    throw new Error("Activity action is not allowed.");
  }
  let data;
  try {
    if (hasV4Session(config)) {
      const common = {
        hotelId: config.lastHotelId,
        venueId: config.lastVenueId,
        activityId: config.lastActivityId,
        source: "bridge"
      };
      if (action === "start") {
        return v4AppsScriptAction(config, "startActivityV4", common);
      }
      if (action === "open" || action === "close") {
        return v4AppsScriptAction(config, "toggleRequests", {
          ...common,
          open: action === "open"
        });
      }
      return v4AppsScriptAction(config, "archiveClearQueue", common);
    }
    data = await appsScriptAction(config, "bridgeControl", {
      control: action,
      source: "bridge"
    });
  } catch (error) {
    if (
      String(error?.message || "").includes("INVALID_ACTION") ||
      String(error?.message || "").includes("not allowed")
    ) {
      throw new Error(
        `Guest Star needs service version ${REQUIRED_CODE_VERSION}. Contact the Superhost to update it.`
      );
    }
    throw error;
  }
  if (!data?.state || !Array.isArray(data.requests)) {
    throw new Error(
      `Guest Star did not confirm the change. Contact the Superhost and report version ${REQUIRED_CODE_VERSION}.`
    );
  }
  if (action === "open" && data.state.accepting === false) {
    throw new Error("Guest Star did not confirm that requests are open.");
  }
  if (action === "close" && data.state.accepting !== false) {
    throw new Error("Guest Star did not confirm that requests are closed.");
  }
  if (action === "reset" && data.state.lastAction !== "reset") {
    throw new Error("Guest Star did not confirm the activity reset.");
  }
  if (action === "start" && data.state.lastAction !== "start") {
    throw new Error("Guest Star did not confirm the activity start.");
  }
  if (action === "reset" && data.requests.length !== 0) {
    throw new Error("Guest Star did not archive every request during reset.");
  }
  return data;
}
