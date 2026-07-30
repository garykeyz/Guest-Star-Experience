import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appSource = await readFile(resolve(root, "public/app.js"), "utf8");
const windowSource = await readFile(
  resolve(root, "macos/GuestStarWindow.js"),
  "utf8"
);
const serverSource = await readFile(resolve(root, "src/server.mjs"), "utf8");
const formSource = await readFile(
  resolve(root, "../components/KaraokeExperience.tsx"),
  "utf8"
);
const bridgeHtml = await readFile(resolve(root, "public/index.html"), "utf8");

test("los enlaces externos no crean pestañas dentro del WebView", () => {
  assert.doesNotMatch(appSource, /window\.open/);
  assert.match(appSource, /\/api\/external\/open/);
  assert.match(serverSource, /pathname === "\/api\/external\/open"/);
});

test("la ventana interna no instala el delegado que causaba el cierre", () => {
  assert.doesNotMatch(windowSource, /WKUIDelegate/);
  assert.doesNotMatch(windowSource, /createWebViewWithConfiguration/);
  assert.match(
    windowSource,
    /javaScriptCanOpenWindowsAutomatically = false/
  );
});

test("el formulario exige elegir idioma y el Bridge se lo muestra al host", () => {
  assert.match(formSource, /useState<Lang\|null>\(null\)/);
  assert.match(formSource, /¿En qué idioma vas a cantar\?/);
  assert.match(formSource, /!lang\?<motion\.section/);
  assert.match(bridgeHtml, /class="request-language"/);
  assert.match(appSource, /Idioma: \$\{item\.language\}/);
});

test("las acciones usan confirmación interna y notifican su resultado", () => {
  assert.doesNotMatch(appSource, /window\.confirm/);
  assert.match(appSource, /function confirmAction/);
  assert.match(appSource, /function runAction/);
  assert.match(appSource, /showSuccess\(success\.title, success\.detail\)/);
  assert.match(appSource, /Canción retirada de VirtualDJ/);
  assert.match(appSource, /Cantante completado/);
  assert.match(appSource, /Canción saltada/);
  assert.match(bridgeHtml, /id="confirmDialog"/);
  assert.match(bridgeHtml, /id="acceptConfirm"/);
});

test("la sincronización de fondo no bloquea los botones por canción", () => {
  assert.match(appSource, /let syncBusy = false/);
  assert.match(appSource, /const actionLocks = new Set/);
  assert.doesNotMatch(appSource, /let busy = false/);
  assert.match(appSource, /actionLocks\.has\(actionScope\(item\.id\)\)/);
});
