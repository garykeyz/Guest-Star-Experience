import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { findMatches, normalizeText, scanLibrary, scoreFile } from "../src/matcher.mjs";
import { normalizeLanguage } from "../src/language.mjs";

test("normaliza acentos y signos para comparar títulos", () => {
  assert.equal(normalizeText("¿Qué Será de Ti?"), "que sera de ti");
});

test("detecta una coincidencia exacta aunque el archivo diga karaoke lyrics", () => {
  const match = scoreFile(
    "/Music/Karaoke/Bruno Mars - Treasure (Karaoke Lyrics).mp4",
    "Treasure",
    "Bruno Mars"
  );
  assert.equal(match.exact, true);
  assert.ok(match.score >= 0.9);
});

test("ordena primero la pista que coincide con canción y artista", () => {
  const matches = findMatches(
    [
      "/Music/Karaoke/Adele - Hello Karaoke.mp4",
      "/Music/Karaoke/Lionel Richie - Hello Karaoke.mp4",
      "/Music/Karaoke/Lionel Richie - All Night Long Karaoke.mp4"
    ],
    "All Night Long",
    "Lionel Richie"
  );
  assert.match(matches[0].fileName, /All Night Long/);
  assert.equal(matches[0].exact, true);
});

test("el idioma seleccionado cambia cuál archivo local queda primero", () => {
  const files = [
    "/Music/English/Celine Dion - My Heart Will Go On Karaoke.mp4",
    "/Music/French/Celine Dion - My Heart Will Go On Karaoke.mp4"
  ];
  const french = findMatches(
    files,
    "My Heart Will Go On",
    "Celine Dion",
    "French"
  );
  const english = findMatches(
    files,
    "My Heart Will Go On",
    "Celine Dion",
    "English"
  );

  assert.match(french[0].filePath, /\/French\//);
  assert.equal(french[0].languageMatch, true);
  assert.match(english[0].filePath, /\/English\//);
  assert.equal(english[0].languageMatch, true);
});

test("acepta una coincidencia exacta sin etiqueta de idioma", () => {
  const result = findMatches(
    ["/Music/Karaoke/Adele - Hello Karaoke Lyrics.mp4"],
    "Hello",
    "Adele",
    "French"
  );
  assert.equal(result[0].exact, true);
  assert.equal(result[0].languageConflict, false);
});

test("normaliza los ocho idiomas locales sin inventar un valor", () => {
  const expected = [
    ["English", "english"],
    ["Español", "spanish"],
    ["Français", "french"],
    ["Português", "portuguese"],
    ["Deutsch", "german"],
    ["Italiano", "italian"],
    ["Русский", "russian"],
    ["हिन्दी", "hindi"]
  ];
  expected.forEach(([value, code]) => assert.equal(normalizeLanguage(value), code));
  assert.equal(normalizeLanguage("unknown"), "");
});

test("escanea subcarpetas y omite archivos que no son multimedia", async () => {
  const root = await mkdtemp(join(tmpdir(), "guest-star-"));
  const nested = join(root, "Latin");
  await mkdir(nested);
  await writeFile(join(nested, "Malagueña - Karaoke.mp4"), "");
  await writeFile(join(nested, "notas.txt"), "");
  const files = await scanLibrary([root]);
  assert.equal(files.length, 1);
  assert.match(files[0], /Malagueña - Karaoke\.mp4$/);
});

test("no convierte un fallo temporal de carpeta en una biblioteca vacía", async () => {
  await assert.rejects(
    scanLibrary([join(tmpdir(), "guest-star-folder-that-is-not-mounted")]),
    /karaoke folder is not available/
  );
});

test("caso A: título y artista correctos producen confianza real muy alta", () => {
  const [match] = findMatches(
    ["/Library/Adele - Hello Karaoke.mp4"],
    "Hello",
    "Adele",
    "English",
    2
  );
  assert.equal(match.confidenceTier, "very-high");
  assert.equal(match.autoLinkEligible, true);
  assert.ok(match.confidencePercent >= 94);
});

test("caso B: formato artista conjunto antes del separador conserva una coincidencia fuerte", () => {
  const [match] = findMatches(
    ["/Library/Lady Gaga Bradley Cooper - Shallow Karaoke.mp4"],
    "Shallow",
    "Lady Gaga & Bradley Cooper"
  );
  assert.equal(match.exact, true);
  assert.ok(match.confidencePercent >= 90);
});

test("caso C: mismo título con artista incorrecto nunca recibe un falso 90%", () => {
  const [match] = findMatches(
    ["/Library/Lionel Richie - Hello Karaoke.mp4"],
    "Hello",
    "Adele"
  );
  assert.equal(match.artistConflict, true);
  assert.equal(match.exact, false);
  assert.ok(match.confidencePercent < 60);
});

test("caso D: una versión alternativa no se autoasigna a una solicitud genérica", () => {
  const [match] = findMatches(
    ["/Library/Adele - Hello Live.mp4"],
    "Hello",
    "Adele"
  );
  assert.equal(match.versionConflict, true);
  assert.equal(match.autoLinkEligible, false);
});

test("caso E: candidatos casi idénticos quedan ambiguos por margen", () => {
  const [match] = findMatches(
    [
      "/Library/Adele - Hello Karaoke.mp4",
      "/Library/Adele - Hello Karaoke HD.mp4"
    ],
    "Hello",
    "Adele"
  );
  assert.equal(match.ambiguous, true);
  assert.equal(match.autoLinkEligible, false);
  assert.ok(match.margin < 0.08);
});

test("caso F: YouTube puede corroborar pero no rescata un conflicto de artista", () => {
  const [match] = findMatches(
    ["/Library/Lionel Richie - Hello Karaoke.mp4"],
    "Hello",
    "Adele",
    "English",
    1,
    { youtubeResults: [{ title: "Adele - Hello Karaoke Lyrics", durationSeconds: 295 }] }
  );
  assert.equal(match.artistConflict, true);
  assert.equal(match.autoLinkEligible, false);
  assert.ok(match.confidencePercent < 60);
});

test("caso G: duración compatible suma evidencia y una duración incompatible penaliza", () => {
  const close = scoreFile(
    { filePath: "/Library/Adele - Hello Karaoke.mp4", durationSeconds: 296 },
    "Hello",
    "Adele",
    "English",
    { durationSeconds: 300 }
  );
  const far = scoreFile(
    { filePath: "/Library/Adele - Hello Karaoke.mp4", durationSeconds: 180 },
    "Hello",
    "Adele",
    "English",
    { durationSeconds: 300 }
  );
  assert.equal(close.durationCompared, true);
  assert.ok(close.score > far.score);
});
