import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SERVICE_AUTH = "Guest Star Bridge Auth";
const SERVICE_DEVICE = "Guest Star Bridge Device";

async function security(args) {
  const result = await execFileAsync("/usr/bin/security", args, {
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true
  });
  return String(result.stdout || "").trim();
}

async function setSecret(service, account, value) {
  if (process.platform !== "darwin" || !account || !value) return false;
  await security([
    "add-generic-password",
    "-U",
    "-s", service,
    "-a", account,
    "-w", value
  ]);
  return true;
}

async function getSecret(service, account) {
  if (process.platform !== "darwin" || !account) return "";
  try {
    return await security(["find-generic-password", "-s", service, "-a", account, "-w"]);
  } catch {
    return "";
  }
}

async function deleteSecret(service, account) {
  if (process.platform !== "darwin" || !account) return;
  try {
    await security(["delete-generic-password", "-s", service, "-a", account]);
  } catch {
    // Deleting an absent Keychain item is already the desired result.
  }
}

export async function storeBridgeSecrets({ deviceId, authToken, deviceToken }) {
  if (process.platform !== "darwin" || !deviceId || !authToken || !deviceToken) {
    return false;
  }
  try {
    await setSecret(SERVICE_AUTH, deviceId, authToken);
    await setSecret(SERVICE_DEVICE, deviceId, deviceToken);
    return true;
  } catch {
    return false;
  }
}

export async function loadBridgeSecrets(deviceId) {
  if (!deviceId) return { authToken: "", deviceToken: "" };
  return {
    authToken: await getSecret(SERVICE_AUTH, deviceId),
    deviceToken: await getSecret(SERVICE_DEVICE, deviceId)
  };
}

export async function clearBridgeSecrets(deviceId) {
  await Promise.all([
    deleteSecret(SERVICE_AUTH, deviceId),
    deleteSecret(SERVICE_DEVICE, deviceId)
  ]);
}
