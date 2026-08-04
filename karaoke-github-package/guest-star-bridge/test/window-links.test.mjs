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
const bridgeStyles = await readFile(resolve(root, "public/styles.css"), "utf8");
const faviconSource = await readFile(resolve(root, "../app/icon.svg"), "utf8");

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
  assert.match(formSource, /What language will you sing in\?/);
  assert.match(formSource, /!lang\?<motion\.section/);
  assert.match(bridgeHtml, /class="request-language"/);
  assert.match(appSource, /Idioma: \$\{item\.language\}/);
});

test("el selector universal está en inglés sin cambiar el idioma guardado", () => {
  assert.match(formSource, /SONG LANGUAGE/);
  assert.match(formSource, /\["es","🇪🇸","Spanish","Español"\]/);
  assert.match(formSource, /\["fr","🇫🇷","French","Français"\]/);
  assert.match(formSource, /language:active\[3\]/);
});

test("pedir otra canción obliga a elegir nuevamente el idioma", () => {
  const resetSource = formSource.slice(
    formSource.indexOf("const reset="),
    formSource.indexOf("return <main")
  );
  assert.match(resetSource, /setMenu\(false\)/);
  assert.match(resetSource, /setLang\(null\)/);
  assert.match(resetSource, /setDone\(false\)/);
});

test("muestra el comentario o la dedicatoria a simple vista en cada tarjeta", () => {
  assert.match(bridgeHtml, /class="request-comment hidden"/);
  assert.match(appSource, /const requestComment = String\(item\.comment \|\| ""\)\.trim\(\)/);
  assert.match(appSource, /requestCommentEl\.textContent = `💬 \$\{requestComment\}`/);
  assert.match(appSource, /requestCommentEl\.classList\.remove\("hidden"\)/);
  assert.match(bridgeStyles, /\.request-comment \{/);
  assert.match(bridgeStyles, /-webkit-line-clamp: 2/);
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

test("permite deshacer el resultado y elegir dónde restaurar la pista", () => {
  assert.match(appSource, /function undoOutcome\(id, placement\)/);
  assert.match(appSource, /Deshacer y volver al turno/);
  assert.match(appSource, /Deshacer y enviar al final/);
  assert.match(appSource, /Solo deshacer · dejar fuera/);
  assert.match(serverSource, /\/undo-outcome/);
  assert.match(serverSource, /async function undoRequestOutcome/);
});

test("el reloj visible avanza cada segundo y recalcula todos los totales", () => {
  assert.match(appSource, /window\.setInterval\(updateTimeDashboard, 1000\)/);
  assert.match(appSource, /Date\.now\(\) - started/);
  assert.match(appSource, /Pulsa Iniciar actividad para activar el reloj/);
  assert.match(appSource, /activityBusy \|\| running/);
  assert.match(appSource, /Pista \$\{activityDuration\(songSeconds\)\}/);
  assert.match(appSource, /transición \$\{activityDuration\(transitionSeconds\)\}/);
});

test("el Bridge respeta el estado sin iniciar y no inventa una hora local", () => {
  const normalizedActivitySource = serverSource.slice(
    serverSource.indexOf("function normalizedActivity"),
    serverSource.indexOf("function clearTransientCaches")
  );
  assert.match(normalizedActivitySource, /hasSuppliedStart/);
  assert.match(normalizedActivitySource, /activityRunning:/);
  assert.doesNotMatch(normalizedActivitySource, /new Date\(\)\.toISOString\(\)/);
});

test("el enlace seleccionado se copia y se guarda como fuente única en Sheets", () => {
  assert.match(
    appSource,
    /quedó como el único enlace de esa solicitud en Google Sheets/
  );
  assert.match(serverSource, /sourceUrl: selected\.url/);
  assert.match(serverSource, /item\.sourceUrl = selected\.url/);
});

test("la sincronización de fondo no bloquea los botones por canción", () => {
  assert.match(appSource, /let syncBusy = false/);
  assert.match(appSource, /const actionLocks = new Set/);
  assert.doesNotMatch(appSource, /let busy = false/);
  assert.match(appSource, /actionLocks\.has\(actionScope\(item\.id\)\)/);
});

test("separa solicitudes compactas por estado sin perder el orden de llegada", () => {
  assert.match(appSource, /Pendientes de entrar a la cola/);
  assert.match(appSource, /En la cola de VirtualDJ/);
  assert.match(appSource, /Ya cantaron \/ finalizadas/);
  assert.match(appSource, /Llegada #\$\{arrival\.number\}/);
  assert.match(appSource, /total solicitado al llegar/);
  assert.match(bridgeHtml, /class="request-details"/);
  assert.match(bridgeHtml, /id="startRequests"/);
});

test("muestra la cola real de VirtualDJ y la hora final sin saturar la lista", () => {
  assert.match(bridgeHtml, /id="vdjQueuePanel"/);
  assert.match(bridgeHtml, /id="eventEndTime"/);
  assert.match(appSource, /function renderVdjQueue/);
  assert.match(appSource, /EMCEE: organiza los turnos/);
  assert.match(serverSource, /entries: vdjQueueEntries\.map/);
  assert.match(serverSource, /verifiedQueue = vdjQueueHasSnapshot/);
  assert.match(appSource, /pistas reales/);
});

test("el formulario confirma repeticiones en el idioma elegido", () => {
  assert.match(formSource, /DUPLICATE_CONFIRMATION_REQUIRED/);
  assert.match(formSource, /duplicateCopy: Record<Lang, DuplicateCopy>/);
  assert.match(formSource, /confirmDuplicate/);
  assert.match(formSource, /duplicateDialog/);
});

test("muestra opcionalmente el estado público y el HOST puede ocultarlo", () => {
  assert.match(formSource, /activityCopy: Record<Lang, ActivityCopy>/);
  assert.match(formSource, /activity\.showPublicStatus/);
  assert.match(formSource, /className="publicActivityStatus"/);
  assert.match(formSource, /queuePeopleCount/);
  assert.match(formSource, /setClockNow\(Date\.now\(\)\),1000/);
  assert.match(formSource, /action:"publicStatusVisibility"/);
  assert.match(formSource, /Mostrar estado al público/);
  assert.match(formSource, /Ocultar estado al público/);
});

test("la página incluye un favicon propio de Guest Star", () => {
  assert.match(faviconSource, /<svg/);
  assert.match(faviconSource, /linearGradient id="bg"/);
  assert.match(faviconSource, /<rect x="197" y="112"/);
  assert.match(faviconSource, /<path d="m374 77/);
});

test("el Plan B alterna idiomas y permite buscar un enlace Karaoke", () => {
  assert.match(appSource, /Temas hit equilibrados en español e inglés/);
  assert.match(appSource, /Buscar enlace Karaoke/);
  assert.match(appSource, /Copiar enlace Karaoke/);
  assert.match(serverSource, /\/api\/suggestions\/youtube/);
});
