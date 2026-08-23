const TECHNICAL_VDJ_ERROR = /^error\s*:\s*-?\d+$/i;

function normalizedSource(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function isTechnicalVirtualDjValue(value) {
  return TECHNICAL_VDJ_ERROR.test(String(value || "").trim());
}

export function isOnlineGuestRequest(item = {}) {
  if (normalizedSource(item.sourceType) === "virtualdj_external") return false;
  return ![
    item.singer,
    item.song,
    item.artist,
    item.fileName
  ].some(isTechnicalVirtualDjValue);
}
