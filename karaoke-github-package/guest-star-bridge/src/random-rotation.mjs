import { normalizeText } from "./matcher.mjs";
import { PLAN_B_SONGS } from "../public/shared/plan-b.js";
import { GUEST_LANGUAGES, LANGUAGE_BY_CODE } from "../public/shared/guest-locales.js";

const hostSong = (item) => ({song:item.title,artist:item.artist,language:LANGUAGE_BY_CODE[item.language]?.nativeName||item.language});

export const ROTATION_CATALOGS = Object.freeze({
  spanish: Object.freeze(PLAN_B_SONGS.filter((item)=>item.language==="es").map(hostSong)),
  english: Object.freeze(PLAN_B_SONGS.filter((item)=>item.language==="en").map(hostSong))
});

export function rotationSongKey(item = {}) {
  return [
    normalizeText(item.language),
    normalizeText(item.artist),
    normalizeText(item.song)
  ].join("|");
}

export function normalizeFavoriteSongs(value) {
  if (!Array.isArray(value)) return [];
  const unique = new Map();
  for (const raw of value.slice(0, 250)) {
    const song = String(raw?.song || "").trim().slice(0, 160);
    const artist = String(raw?.artist || "").trim().slice(0, 160);
    const language = String(raw?.language || "Español").trim().slice(0, 40);
    if (!song || !artist) continue;
    const item = {
      favoriteId: String(raw?.favoriteId || "").trim().slice(0, 100),
      song,
      artist,
      language: GUEST_LANGUAGES.find((candidate)=>[
        candidate.code,candidate.songCode,candidate.englishName,candidate.nativeName
      ].some((name)=>normalizeText(name)===normalizeText(language)))?.nativeName||language
    };
    const key = rotationSongKey(item);
    if (!unique.has(key)) unique.set(key, item);
  }
  return [...unique.values()];
}

function shuffled(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.max(0, Math.min(0.999999999, random())) * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function drawInfiniteRotation(
  catalog = [],
  previous = {},
  count = 6,
  random = Math.random
) {
  const itemsByKey = new Map();
  for (const item of catalog) {
    const key = rotationSongKey(item);
    if (key && !itemsByKey.has(key)) itemsByKey.set(key, item);
  }
  const target = Math.max(1, Math.min(30, Math.floor(Number(count) || 1)));
  if (!itemsByKey.size) {
    return { items: [], state: { remainingKeys: [], round: 0, lastKey: "" } };
  }

  let remainingKeys = Array.isArray(previous.remainingKeys)
    ? previous.remainingKeys.filter((key) => itemsByKey.has(key))
    : [];
  let round = Math.max(0, Math.floor(Number(previous.round) || 0));
  let lastKey = String(previous.lastKey || "");
  const drawn = [];

  while (drawn.length < target) {
    if (!remainingKeys.length) {
      remainingKeys = shuffled([...itemsByKey.keys()], random);
      if (
        remainingKeys.length > 1 &&
        lastKey &&
        remainingKeys[0] === lastKey
      ) {
        [remainingKeys[0], remainingKeys[1]] = [remainingKeys[1], remainingKeys[0]];
      }
      round += 1;
    }
    const key = remainingKeys.shift();
    const item = itemsByKey.get(key);
    if (!item) continue;
    drawn.push({ ...item, rotationKey: key, rotationRound: round });
    lastKey = key;
  }

  return {
    items: drawn,
    state: { remainingKeys, round, lastKey }
  };
}

export function isKnownRotationSong(item, favorites = []) {
  const key = rotationSongKey(item);
  return [
    ...ROTATION_CATALOGS.spanish,
    ...ROTATION_CATALOGS.english,
    ...PLAN_B_SONGS.map(hostSong),
    ...normalizeFavoriteSongs(favorites)
  ].some((candidate) => rotationSongKey(candidate) === key);
}
