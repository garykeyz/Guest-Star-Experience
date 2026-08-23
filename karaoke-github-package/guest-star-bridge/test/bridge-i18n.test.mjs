import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizeBridgeLanguage,
  translateBridgeText
} from "../public/bridge-i18n.js";

const appSource = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const i18nSource = readFileSync(new URL("../public/bridge-i18n.js", import.meta.url), "utf8");

test("traduce completamente las filas críticas de la cola al español", () => {
  assert.equal(translateBridgeText("Waiting to Enter the Queue", "es"), "Esperando para entrar en la cola");
  assert.equal(translateBridgeText("In the VirtualDJ Queue", "es"), "En la cola de VirtualDJ");
  assert.equal(translateBridgeText("Language not provided · Track 0:04:44 + transition 0:00:00 = 0:04:44", "es"),
    "Idioma no indicado · Pista 0:04:44 + transición 0:00:00 = 0:04:44");
  assert.equal(translateBridgeText("Unmatched VirtualDJ item", "es"), "Pista propia de VirtualDJ");
});

test("permite volver a inglés sin mezclar los textos que originalmente estaban en español", () => {
  assert.equal(translateBridgeText("Listas infinitas para llenar la rotación", "en"), "Infinite lists to fill the rotation");
  assert.equal(translateBridgeText("Elige una lista para generar los próximos temas.", "en"), "Choose a list to generate the next songs.");
  assert.equal(normalizeBridgeLanguage("fr"), "es");
});

test("traduce también los marcadores vacíos sin tocar nombres de canciones o artistas", () => {
  assert.match(appSource, /item\.artist \|\| bridgeI18n\.translate\("Artist not provided"\)/);
  assert.match(i18nSource, /\.artist/);
  assert.equal(translateBridgeText("Artist not provided", "es"), "Artista no indicado");
});
