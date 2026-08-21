export const HOST_PANEL_HOSTNAME = "host.gstarxp.com";

export function normalizedHostname(value: string | null | undefined) {
  const candidate = String(value || "").split(",", 1)[0].trim().toLowerCase();
  if (!candidate) return "";
  if (candidate.startsWith("[")) {
    const closingBracket = candidate.indexOf("]");
    return closingBracket >= 0 ? candidate.slice(1, closingBracket) : candidate;
  }
  return candidate.split(":", 1)[0].replace(/\.$/, "");
}

export function isHostPanelHostname(value: string | null | undefined) {
  return normalizedHostname(value) === HOST_PANEL_HOSTNAME;
}

export function canonicalHostPanelPath(value: string | null | undefined) {
  return isHostPanelHostname(value) ? "/" : "/host";
}
