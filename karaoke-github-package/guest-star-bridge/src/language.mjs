const PROFILES = Object.freeze({
  english: Object.freeze({
    code: "english",
    displayName: "English",
    youtubeLanguage: "en",
    regionCode: "US",
    searchTerms: "karaoke lyrics on screen instrumental",
    lyricsTerms: "lyrics on screen",
    aliases: ["english", "ingles", "inglés", "en-us", "en-gb", "eng"],
    pathMarkers: ["english", "ingles", "en-us", "en-gb", "eng"]
  }),
  spanish: Object.freeze({
    code: "spanish",
    displayName: "Spanish",
    youtubeLanguage: "es",
    regionCode: "MX",
    searchTerms: "karaoke letra en pantalla instrumental",
    lyricsTerms: "letra en pantalla",
    aliases: [
      "spanish", "espanol", "español", "castellano", "latinoamerica",
      "latinoamérica", "latin america", "latino", "latina", "es-419", "spa"
    ],
    pathMarkers: [
      "spanish", "espanol", "castellano", "latinoamerica", "latin america",
      "latino", "es-419", "spa"
    ]
  }),
  french: Object.freeze({
    code: "french",
    displayName: "French",
    youtubeLanguage: "fr",
    regionCode: "FR",
    searchTerms: "karaoké paroles à l'écran instrumental",
    lyricsTerms: "paroles à l'écran",
    aliases: ["french", "francais", "français", "france", "fra"],
    pathMarkers: ["french", "francais", "france", "fra"]
  }),
  portuguese: Object.freeze({
    code: "portuguese",
    displayName: "Portuguese",
    youtubeLanguage: "pt",
    regionCode: "BR",
    searchTerms: "karaokê letra na tela instrumental",
    lyricsTerms: "letra na tela",
    aliases: ["portuguese", "portugues", "português", "brasil", "brazil", "pt-br", "por"],
    pathMarkers: ["portuguese", "portugues", "brasil", "brazil", "pt-br", "por"]
  }),
  german: Object.freeze({
    code: "german",
    displayName: "German",
    youtubeLanguage: "de",
    regionCode: "DE",
    searchTerms: "karaoke songtext instrumental",
    lyricsTerms: "songtext",
    aliases: ["german", "deutsch", "aleman", "alemán", "deutschland", "deu"],
    pathMarkers: ["german", "deutsch", "aleman", "deutschland", "deu"]
  }),
  italian: Object.freeze({
    code: "italian",
    displayName: "Italian",
    youtubeLanguage: "it",
    regionCode: "IT",
    searchTerms: "karaoke testo sullo schermo base musicale",
    lyricsTerms: "testo sullo schermo",
    aliases: ["italian", "italiano", "italia", "ita"],
    pathMarkers: ["italian", "italiano", "italia", "ita"]
  }),
  russian: Object.freeze({
    code: "russian",
    displayName: "Russian",
    youtubeLanguage: "ru",
    regionCode: "RU",
    searchTerms: "караоке текст песни минус",
    lyricsTerms: "текст песни",
    aliases: ["russian", "ruso", "русский", "русскии", "russia", "rus"],
    pathMarkers: ["russian", "ruso", "русский", "русскии", "russia", "rus"]
  })
});

function normalized(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_\\/.-]+/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function containsMarker(text, marker) {
  const source = ` ${normalized(text)} `;
  const target = ` ${normalized(marker)} `;
  return target.trim() && source.includes(target);
}

export function normalizeLanguage(value, fallback = "") {
  const candidate = normalized(value);
  if (!candidate) return fallback;
  for (const profile of Object.values(PROFILES)) {
    if (
      candidate === profile.code ||
      profile.aliases.some((alias) => normalized(alias) === candidate)
    ) {
      return profile.code;
    }
  }
  return fallback;
}

export function languageProfile(value) {
  const code = normalizeLanguage(value);
  return code ? PROFILES[code] : null;
}

export function languagePathEvidence(filePath, language) {
  const selected = normalizeLanguage(language);
  if (!selected) {
    return { code: "", match: false, conflict: false, detected: [] };
  }
  const detected = Object.values(PROFILES)
    .filter((profile) =>
      profile.pathMarkers.some((marker) => containsMarker(filePath, marker))
    )
    .map((profile) => profile.code);
  return {
    code: selected,
    match: detected.includes(selected),
    conflict: detected.some((code) => code !== selected),
    detected
  };
}

export function languageDisplayName(value) {
  return languageProfile(value)?.displayName || String(value || "").trim();
}

export const LANGUAGE_PROFILES = PROFILES;
