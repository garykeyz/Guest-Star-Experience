import { findMatches, normalizeText } from "./matcher.mjs";
import { PLAN_B_SONGS } from "../public/shared/plan-b.js";
import { LANGUAGE_BY_CODE } from "../public/shared/guest-locales.js";

const hostSong = (item) => ({song:item.title,artist:item.artist,language:LANGUAGE_BY_CODE[item.language]?.nativeName||item.language});
const HITS = PLAN_B_SONGS.filter((item)=>item.language==="es"||item.language==="en")
  .filter((item,index,items)=>items.filter(candidate=>candidate.language===item.language).indexOf(item)<6)
  .map(hostSong);

function seedFrom(value) {
  return [...String(value || "guest-star")].reduce(
    (total, character) => (total * 31 + character.charCodeAt(0)) >>> 0,
    2166136261
  );
}

function rotate(items, offset) {
  if (!items.length) return [];
  const safe = offset % items.length;
  return [...items.slice(safe), ...items.slice(0, safe)];
}

export function selectHitSuggestions(
  requests = [],
  libraryFiles = [],
  activityId = "",
  limit = 6
) {
  const englishCount = requests.filter((item) =>
    normalizeText(item?.language).includes("english")
  ).length;
  const spanishCount = requests.filter((item) => {
    const language = normalizeText(item?.language);
    return language.includes("espanol") || language.includes("spanish");
  }).length;
  const preferred = englishCount > spanishCount ? "English" : "Español";
  const seed = seedFrom(activityId);
  const english = rotate(
    HITS.filter((item) => item.language === "English"),
    seed
  );
  const spanish = rotate(
    HITS.filter((item) => item.language === "Español"),
    Math.floor(seed / 7)
  );
  const primary = preferred === "English" ? english : spanish;
  const secondary = preferred === "English" ? spanish : english;
  const ordered = [];
  const target = Math.max(1, limit);
  for (let index = 0; ordered.length < target; index++) {
    if (primary[index]) ordered.push(primary[index]);
    if (ordered.length >= target) break;
    if (secondary[index]) ordered.push(secondary[index]);
    if (!primary[index] && !secondary[index]) break;
  }

  return ordered.slice(0, target).map((item) => {
    const match = findMatches(
      libraryFiles,
      item.song,
      item.artist,
      item.language,
      1
    )[0];
    return {
      ...item,
      localAvailable: Boolean(match?.exact),
      filePath: match?.exact ? match.filePath : "",
      fileName: match?.exact ? match.fileName : ""
    };
  });
}
