import { findMatches, normalizeText } from "./matcher.mjs";

const HITS = [
  { song: "Vivir Mi Vida", artist: "Marc Anthony", language: "Español" },
  { song: "La Vida Es un Carnaval", artist: "Celia Cruz", language: "Español" },
  { song: "Suavemente", artist: "Elvis Crespo", language: "Español" },
  { song: "Bailando", artist: "Enrique Iglesias", language: "Español" },
  { song: "Burbujas de Amor", artist: "Juan Luis Guerra", language: "Español" },
  { song: "Como La Flor", artist: "Selena", language: "Español" },
  { song: "Dancing Queen", artist: "ABBA", language: "English" },
  { song: "I Wanna Dance with Somebody", artist: "Whitney Houston", language: "English" },
  { song: "Don't Stop Believin'", artist: "Journey", language: "English" },
  { song: "Sweet Caroline", artist: "Neil Diamond", language: "English" },
  { song: "Livin' on a Prayer", artist: "Bon Jovi", language: "English" },
  { song: "Man! I Feel Like a Woman!", artist: "Shania Twain", language: "English" }
];

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
    const match = findMatches(libraryFiles, item.song, item.artist, 1)[0];
    return {
      ...item,
      localAvailable: Boolean(match?.exact),
      filePath: match?.exact ? match.filePath : "",
      fileName: match?.exact ? match.fileName : ""
    };
  });
}
