import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { findMatches, normalizeText, scanLibrary, scoreFile } from "../src/matcher.mjs";

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
    /carpeta de karaoke no está disponible/
  );
});
