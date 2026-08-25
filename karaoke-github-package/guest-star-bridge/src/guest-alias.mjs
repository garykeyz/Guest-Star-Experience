function normalizedGuestName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function guestIdentityKey(item, singerKey) {
  const identity = String(item?.guestIdentity || item?.guestCode || "")
    .trim()
    .toLowerCase();
  return identity ? `device:${identity}` : `legacy:${singerKey}`;
}

export function alphabeticalGuestAlias(index) {
  let value = Math.max(0, Math.floor(Number(index) || 0)) + 1;
  let alias = "";
  while (value > 0) {
    value -= 1;
    alias = String.fromCharCode(65 + (value % 26)) + alias;
    value = Math.floor(value / 26);
  }
  return alias;
}

export function assignGuestAliases(items = [], toneCount = 6) {
  const source = Array.isArray(items) ? items : [];
  const ordered = source
    .map((item, sourceIndex) => ({ item, sourceIndex }))
    .sort((left, right) => {
      const leftTime = Date.parse(String(left.item?.timestamp || ""));
      const rightTime = Date.parse(String(right.item?.timestamp || ""));
      const safeLeft = Number.isFinite(leftTime) ? leftTime : Number.MAX_SAFE_INTEGER;
      const safeRight = Number.isFinite(rightTime) ? rightTime : Number.MAX_SAFE_INTEGER;
      return safeLeft - safeRight || left.sourceIndex - right.sourceIndex;
    });
  const identitiesBySinger = new Map();

  for (const { item } of ordered) {
    const singerKey = normalizedGuestName(item?.singer);
    if (!singerKey) continue;
    if (!identitiesBySinger.has(singerKey)) {
      identitiesBySinger.set(singerKey, new Map());
    }
    const identities = identitiesBySinger.get(singerKey);
    const identity = guestIdentityKey(item, singerKey);
    if (!identities.has(identity)) identities.set(identity, identities.size);
  }

  const colors = Math.max(1, Math.floor(Number(toneCount) || 1));
  return source.map((item) => {
    const singerKey = normalizedGuestName(item?.singer);
    const identities = identitiesBySinger.get(singerKey);
    const identity = guestIdentityKey(item, singerKey);
    const aliasIndex = identities?.get(identity) || 0;
    return {
      ...item,
      guestAlias: identities && identities.size > 1
        ? alphabeticalGuestAlias(aliasIndex)
        : "",
      guestTone: aliasIndex % colors
    };
  });
}

export function virtualDjSingerLabel(item = {}) {
  const singer = String(item?.singer || item?.name || "").trim();
  const alias = String(item?.guestAlias || "").trim();
  return alias ? `${singer} ${alias}`.trim() : singer;
}
