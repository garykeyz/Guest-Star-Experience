import { normalizeText } from "./matcher.mjs";

export const ROTATION_CATALOGS = Object.freeze({
  spanish: Object.freeze([
    { song: "Vivir Mi Vida", artist: "Marc Anthony", language: "Español" },
    { song: "La Vida Es un Carnaval", artist: "Celia Cruz", language: "Español" },
    { song: "Suavemente", artist: "Elvis Crespo", language: "Español" },
    { song: "Bailando", artist: "Enrique Iglesias", language: "Español" },
    { song: "Burbujas de Amor", artist: "Juan Luis Guerra", language: "Español" },
    { song: "Como La Flor", artist: "Selena", language: "Español" },
    { song: "Colgando en Tus Manos", artist: "Carlos Baute y Marta Sánchez", language: "Español" },
    { song: "La Camisa Negra", artist: "Juanes", language: "Español" },
    { song: "Rayando el Sol", artist: "Maná", language: "Español" },
    { song: "Me Rehúso", artist: "Danny Ocean", language: "Español" },
    { song: "Procura", artist: "Chichi Peralta", language: "Español" },
    { song: "Obsesión", artist: "Aventura", language: "Español" },
    { song: "Despacito", artist: "Luis Fonsi", language: "Español" },
    { song: "Robarte un Beso", artist: "Carlos Vives y Sebastián Yatra", language: "Español" },
    { song: "Creo en Mí", artist: "Natalia Jiménez", language: "Español" },
    { song: "Corre", artist: "Jesse & Joy", language: "Español" },
    { song: "Entra en Mi Vida", artist: "Sin Bandera", language: "Español" },
    { song: "Qué Agonía", artist: "Yuridia y Ángela Aguilar", language: "Español" },
    { song: "Te Aviso, Te Anuncio", artist: "Shakira", language: "Español" },
    { song: "Eres", artist: "Café Tacvba", language: "Español" }
  ]),
  english: Object.freeze([
    { song: "Dancing Queen", artist: "ABBA", language: "English" },
    { song: "I Wanna Dance with Somebody", artist: "Whitney Houston", language: "English" },
    { song: "Don't Stop Believin'", artist: "Journey", language: "English" },
    { song: "Sweet Caroline", artist: "Neil Diamond", language: "English" },
    { song: "Livin' on a Prayer", artist: "Bon Jovi", language: "English" },
    { song: "Man! I Feel Like a Woman!", artist: "Shania Twain", language: "English" },
    { song: "I Want It That Way", artist: "Backstreet Boys", language: "English" },
    { song: "Valerie", artist: "Amy Winehouse", language: "English" },
    { song: "Shallow", artist: "Lady Gaga and Bradley Cooper", language: "English" },
    { song: "Flowers", artist: "Miley Cyrus", language: "English" },
    { song: "Someone Like You", artist: "Adele", language: "English" },
    { song: "Perfect", artist: "Ed Sheeran", language: "English" },
    { song: "Rolling in the Deep", artist: "Adele", language: "English" },
    { song: "Uptown Funk", artist: "Mark Ronson feat. Bruno Mars", language: "English" },
    { song: "Can't Help Falling in Love", artist: "Elvis Presley", language: "English" },
    { song: "Zombie", artist: "The Cranberries", language: "English" },
    { song: "What's Up?", artist: "4 Non Blondes", language: "English" },
    { song: "Wonderwall", artist: "Oasis", language: "English" },
    { song: "I Will Survive", artist: "Gloria Gaynor", language: "English" },
    { song: "Before He Cheats", artist: "Carrie Underwood", language: "English" }
  ])
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
      language: /^english$/i.test(language) ? "English" : "Español"
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
    ...normalizeFavoriteSongs(favorites)
  ].some((candidate) => rotationSongKey(candidate) === key);
}
