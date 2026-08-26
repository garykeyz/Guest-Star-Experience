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
const formClientSource = await readFile(
  resolve(root, "../components/KaraokeExperienceClient.tsx"),
  "utf8"
);
const rootPageSource = await readFile(resolve(root, "../app/page.tsx"), "utf8");
const hotelPageSource = await readFile(resolve(root, "../app/h/[hotel]/page.tsx"), "utf8");
const bridgeHtml = await readFile(resolve(root, "public/index.html"), "utf8");
const bridgeStyles = await readFile(resolve(root, "public/styles.css"), "utf8");
const googleSignInHtml = await readFile(resolve(root, "public/google-sign-in.html"), "utf8");
const googleSignInSource = await readFile(resolve(root, "public/google-sign-in.js"), "utf8");
const superhostSource = await readFile(resolve(root, "public/superhost.js"), "utf8");
const qrSource = await readFile(resolve(root, "public/qr-ui.js"), "utf8");
const faviconSource = await readFile(resolve(root, "../app/icon.svg"), "utf8");
const hostPanelSource = await readFile(
  resolve(root, "../components/HostPanel.tsx"),
  "utf8"
);
const hostApiSource = await readFile(
  resolve(root, "../app/api/host/route.ts"),
  "utf8"
);
const publicApiSource = await readFile(
  resolve(root, "../app/api/karaoke/route.ts"),
  "utf8"
);
const bridgeApiSource = await readFile(
  resolve(root, "../app/api/bridge/route.ts"),
  "utf8"
);
const runtimeEnvSource = await readFile(
  resolve(root, "../lib/guest-star/runtime-env.ts"),
  "utf8"
);

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

test("la sincronización en vivo no borra el usuario mientras se escribe", () => {
  const authUiSource = appSource.slice(
    appSource.indexOf("function updateAuthUi()"),
    appSource.indexOf('$("#loginForm").addEventListener')
  );
  const dialogStart = authUiSource.indexOf("if (!loginDialog.open)");
  const openDialogBlock = authUiSource.slice(
    dialogStart,
    authUiSource.indexOf("return;", dialogStart)
  );
  assert.match(openDialogBlock, /loginUsername/);
  assert.match(openDialogBlock, /loginDialog\.showModal\(\)/);
  assert.equal(
    (authUiSource.match(/loginUsername"\)\.value =/g) || []).length,
    1
  );
  const loginHelp = bridgeHtml.slice(
    bridgeHtml.indexOf('id="loginDialog"'),
    bridgeHtml.indexOf('id="selectionDialog"')
  );
  assert.match(loginHelp, /Contact your Superhost/);
  assert.match(loginHelp, /Continue with Google/);
  assert.doesNotMatch(loginHelp, /Sheets|Drive|Apps Script|Code\.gs/i);
});

test("Google inicia la sesión del Bridge en el navegador del sistema y solo confía en el servidor", () => {
  assert.match(bridgeHtml, /id="googleLoginButton"/);
  assert.match(appSource, /\/google-sign-in/);
  assert.match(appSource, /openExternal/);
  assert.match(serverSource, /pathname === "\/api\/auth\/google-config"/);
  assert.match(serverSource, /pathname === "\/api\/auth\/google"/);
  assert.match(serverSource, /requestOrigin && requestOrigin !== expectedOrigin/);
  assert.match(serverSource, /signInBridgeWithGoogle/);
  assert.match(serverSource, /authToken: data\.authToken/);
  assert.match(serverSource, /deviceToken: data\.deviceToken/);
  assert.match(serverSource, /storeSecrets: true/);
  assert.match(googleSignInHtml, /google-sign-in\.js/);
  assert.match(googleSignInSource, /accounts\.google\.com\/gsi\/client/);
  assert.match(googleSignInSource, /google\.accounts\.id\.initialize/);
  assert.match(googleSignInSource, /credential: response\.credential/);
  assert.match(googleSignInSource, /jsonRequest\("\/api\/auth\/google"/);
  assert.doesNotMatch(googleSignInSource, /localStorage|sessionStorage|document\.cookie/);
});

test("Google usa el binding real de Cloudflare y conserva el fallback local", () => {
  assert.match(runtimeEnvSource, /getCloudflareContext/);
  assert.match(runtimeEnvSource, /context\.env/);
  assert.match(runtimeEnvSource, /process\.env\[key\]/);
  assert.match(hostApiSource, /runtimeEnvString\("GOOGLE_OAUTH_CLIENT_ID"\)/);
  assert.match(bridgeApiSource, /runtimeEnvString\("GOOGLE_OAUTH_CLIENT_ID"\)/);
  assert.doesNotMatch(hostApiSource, /process\.env\.GOOGLE_OAUTH_CLIENT_ID/);
  assert.doesNotMatch(bridgeApiSource, /process\.env\.GOOGLE_OAUTH_CLIENT_ID/);
});

test("el formulario exige elegir idioma y el Bridge se lo muestra al host", () => {
  assert.match(formSource, /useState<Lang\|null>\(null\)/);
  assert.match(formSource, /What language will you sing in\?/);
  assert.match(formSource, /!lang\?<motion\.section/);
  assert.match(bridgeHtml, /class="request-language"/);
  assert.match(appSource, /Language: \$\{item\.language\}/);
});

test("el selector universal está en inglés sin cambiar el idioma guardado", () => {
  assert.match(formSource, /SONG LANGUAGE/);
  assert.match(formSource, /\["es","🇪🇸","Spanish","Español"\]/);
  assert.match(formSource, /\["fr","🇫🇷","French","Français"\]/);
  assert.match(formSource, /language:active\[3\]/);
});

test("después de elegir idioma, todos los módulos públicos usan el mismo idioma", () => {
  assert.match(formSource, /const moduleText=moduleCopy\[lang\|\|"en"\]/);
  assert.match(formSource, /<span>\{active\[3\]\}<\/span>/);
  assert.match(formSource, /\{moduleText\.startsIn\}/);
  assert.match(formSource, /\{moduleText\.nextActivity\}/);
  assert.match(formSource, /\{moduleText\.addCalendar\}/);
  assert.match(formSource, /\{moduleText\.reviewLabel\}/);
  assert.match(formSource, /placeholder=\{moduleText\.optionalComment\}/);
  assert.match(formSource, /\{moduleText\.submitReview\}/);
  const localizedModules = formSource.slice(formSource.indexOf("{nextActivity&&"));
  assert.doesNotMatch(localizedModules, />OPTIONAL REVIEW</);
  assert.doesNotMatch(localizedModules, />NEXT ACTIVITY</);
  assert.doesNotMatch(localizedModules, />Add to Calendar</);
  assert.doesNotMatch(localizedModules, /placeholder="Optional comment"/);
  assert.doesNotMatch(localizedModules, />Submit Optional Review</);
});

test("la experiencia pública pesada se hidrata en el cliente sin gastar CPU del Worker", () => {
  assert.match(formClientSource, /dynamic\(/);
  assert.match(formClientSource, /ssr:\s*false/);
  assert.match(formClientSource, /import\("@\/components\/KaraokeExperience"\)/);
  assert.match(rootPageSource, /KaraokeExperienceClient/);
  assert.match(hotelPageSource, /KaraokeExperienceClient/);
  assert.doesNotMatch(rootPageSource, /from "@\/components\/KaraokeExperience"/);
  assert.doesNotMatch(hotelPageSource, /from "@\/components\/KaraokeExperience"/);
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
  assert.match(appSource, /Song removed from VirtualDJ/);
  assert.match(appSource, /Singer completed/);
  assert.match(appSource, /Song skipped/);
  assert.match(bridgeHtml, /id="confirmDialog"/);
  assert.match(bridgeHtml, /id="acceptConfirm"/);
});

test("permite deshacer el resultado y elegir dónde restaurar la pista", () => {
  assert.match(appSource, /function undoOutcome\(id, placement\)/);
  assert.match(appSource, /Undo and Restore Position/);
  assert.match(appSource, /Undo and Send to End/);
  assert.match(appSource, /Undo Only · Keep Outside/);
  assert.match(serverSource, /\/undo-outcome/);
  assert.match(serverSource, /async function undoRequestOutcome/);
});

test("el reloj visible avanza cada segundo y recalcula todos los totales", () => {
  assert.match(appSource, /window\.setInterval\(updateTimeDashboard, 1000\)/);
  assert.match(appSource, /Number\.isFinite\(finished\) \? finished : Date\.now\(\)/);
  assert.match(appSource, /activityFinishedAt/);
  assert.match(appSource, /Select Start Activity to activate the clock/);
  assert.match(appSource, /primary\.disabled = activityBusy/);
  assert.match(appSource, /Track \$\{activityDuration\(songSeconds\)\}/);
  assert.match(appSource, /transition \$\{activityDuration\(transitionSeconds\)\}/);
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

test("el enlace seleccionado se copia y se guarda como fuente única", () => {
  assert.match(
    appSource,
    /The selected link was copied and saved with the request/
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

test("el cursor no muestra carga al pasar por el botón y la operación real usa un indicador propio", () => {
  assert.doesNotMatch(
    bridgeStyles,
    /\.button:disabled\s*\{[^}]*cursor:\s*wait/
  );
  assert.doesNotMatch(
    bridgeStyles,
    /cursor:\s*(?:progress|wait)/
  );
  assert.match(
    bridgeStyles,
    /\.button\.is-loading\[aria-busy="true"\]::after\s*\{[^}]*animation:\s*spin/
  );
  assert.match(appSource, /primary\.classList\.toggle\("is-loading", activityBusy\)/);
  assert.match(appSource, /primary\.setAttribute\("aria-busy", activityBusy \? "true" : "false"\)/);
});

test("la configuración heredada se migra automáticamente y queda oculta al operador", () => {
  assert.match(bridgeHtml, /id="legacyConnection"[^>]*class="[^"]*hidden[^"]*"[^>]*hidden/);
  assert.match(appSource, /\$\("#legacyConnection"\)\.classList\.add\("hidden"\)/);
  assert.doesNotMatch(appSource, /\$\("#legacyConnection"\)\.classList\.toggle/);
});

test("identifica al huésped por dispositivo y suprime solicitudes repetidas", () => {
  assert.match(formSource, /guestDeviceId:guestDeviceId\(\)/);
  assert.match(appSource, /function guestDisplayName/);
  assert.match(appSource, /guest-alias-badge/);
  assert.match(bridgeStyles, /\.guest-tone-0/);
  assert.match(bridgeStyles, /\.guest-tone-1/);
  assert.match(serverSource, /duplicateOf/);
  assert.match(serverSource, /reportedDuplicateIds/);
  assert.doesNotMatch(serverSource, /removeDuplicateKaraokeEntries/);
  assert.match(serverSource, /virtualDjSingerLabel/);
});

test("muestra solicitudes y VDJ lado a lado con resultados compactos debajo", () => {
  assert.match(appSource, /Active Requests/);
  assert.match(appSource, /Completed \/ Skipped/);
  assert.match(appSource, /const groupKey = isTerminal \? "finished" : "active"/);
  assert.match(appSource, /Arrival #\$\{arrival\.number\}/);
  assert.match(appSource, /requested total at arrival/);
  assert.match(bridgeHtml, /class="live-queue-workspace"/);
  assert.match(bridgeHtml, /id="finishedRequests"/);
  assert.match(bridgeStyles, /\.live-queue-workspace\s*\{[^}]*grid-template-columns/);
  assert.match(bridgeStyles, /\.request-results \.request-list\s*\{[^}]*grid-template-columns/);
  assert.match(bridgeHtml, /class="request-details"/);
  assert.match(bridgeHtml, /id="primaryActivity"/);
  assert.match(bridgeHtml, /id="requestsToggle"/);
});

test("muestra la cola real de VirtualDJ y la hora final sin saturar la lista", () => {
  assert.match(bridgeHtml, /id="vdjQueuePanel"/);
  assert.match(bridgeHtml, /id="eventEndTime"/);
  assert.match(appSource, /function renderVdjQueue/);
  assert.match(appSource, /EMCEE: manage the rotation/);
  assert.match(serverSource, /entries: vdjQueueEntries\.map/);
  assert.match(serverSource, /verifiedQueue = vdjQueueHasSnapshot/);
  assert.match(appSource, /live VDJ/);
});

test("el formulario confirma repeticiones en el idioma elegido", () => {
  assert.match(formSource, /DUPLICATE_CONFIRMATION_REQUIRED/);
  assert.match(formSource, /duplicateCopy: Record<Lang, DuplicateCopy>/);
  assert.match(formSource, /confirmDuplicate/);
  assert.match(formSource, /duplicateDialog/);
});

test("muestra opcionalmente el estado público y el Host seguro lo controla", () => {
  assert.match(formSource, /activityCopy: Record<Lang, ActivityCopy>/);
  assert.match(formSource, /activity\.showPublicStatus/);
  assert.match(formSource, /className="publicActivityStatus"/);
  assert.match(formSource, /queuePeopleCount/);
  assert.match(formSource, /setClockNow\(Date\.now\(\)\),1000/);
  assert.match(formSource, /_receivedAt:\s*Date\.now\(\)/);
  assert.match(formSource, /const synchronizedNow=clockNow\+serverOffset/);
  assert.doesNotMatch(formSource, /HOST PIN/);
  assert.match(hostPanelSource, /Host Panel/);
  assert.match(hostPanelSource, /canShowHidePublicStatus/);
  assert.match(hostPanelSource, /Show Public Status/);
  assert.match(hostPanelSource, /Hide Public Status/);
  assert.match(hostPanelSource, /action:\"updateActivitySettings\"|\"updateActivitySettings\"/);
  assert.match(hostApiSource, /httpOnly:\s*true/);
  assert.match(hostApiSource, /delete payload\.authToken/);
  assert.match(publicApiSource, /submitReview.*createGuestReminder.*unsubscribeGuest/);
  assert.match(publicApiSource, /Public action is not allowed/);
});

test("el Superhost administra todo dentro del Bridge y usa QR local", () => {
  assert.match(superhostSource, /\/api\/superhost\/state/);
  assert.match(superhostSource, /\/api\/superhost\/action/);
  assert.match(superhostSource, /Hoteles/);
  assert.match(superhostSource, /Hosts y permisos/);
  assert.match(superhostSource, /Experiencia pública/);
  assert.match(superhostSource, /Dispositivos y auditoría/);
  assert.match(superhostSource, /type its exact name|escribe exactamente su nombre/);
  assert.match(superhostSource, /confirmHotelName/);
  assert.match(superhostSource, /status: "inactive"/);
  assert.match(superhostSource, /status: "active"/);
  assert.match(superhostSource, /data-superhost-language/);
  assert.match(superhostSource, /setLocalQrImage/);
  assert.match(qrSource, /globalThis\.qrcode/);
  assert.doesNotMatch(qrSource, /quickchart|drive\.google/i);
  assert.doesNotMatch(serverSource, /pathname === "\/api\/host-panel\/open"/);
  assert.match(hostApiSource, /HOTEL_PROVISIONING_TIMEOUT_MS = 120_000/);
  assert.match(hostApiSource, /action === "createHotel"/);
});

test("el Bridge usa un proxy dedicado sin quitar los tokens de su sesión", () => {
  assert.match(bridgeApiSource, /APPS_SCRIPT_TIMEOUT_MS = 60_000/);
  assert.match(bridgeApiSource, /X-Guest-Star-Bridge-Proxy/);
  assert.doesNotMatch(bridgeApiSource, /delete payload\.authToken/);
  assert.match(bridgeHtml, /id="bridgeVersion"/);
  assert.match(appSource, /state\.version \|\| "unknown"/);
  assert.match(bridgeApiSource, /X-Guest-Star-Bridge-Proxy": "4\.3\.7"/);
  assert.match(hostPanelSource, /GUEST STAR EXPERIENCE 4\.3\.7/);
  assert.match(hostPanelSource, /Service v/);
});

test("si una canción desaparece, pregunta si fue intencional", () => {
  assert.match(appSource, /Did you remove it intentionally\?/);
  assert.match(appSource, /No — Re-add at the End/);
  assert.match(appSource, /Yes — Keep It Outside/);
});

test("las decisiones terminales sobreviven lecturas atrasadas y reinicios", () => {
  assert.match(serverSource, /function effectiveRequestOutcome/);
  assert.match(serverSource, /storedQueueState\.removedIds/);
  assert.match(serverSource, /request_temporarily_missing_from_sync/);
  assert.match(serverSource, /lastExternalSyncSignature/);
  assert.match(serverSource, /if \(effectiveRequestOutcome\(item\)\) continue/);
  assert.match(serverSource, /This request was already marked completed or skipped/);
});

test("la página incluye un favicon propio de Guest Star", () => {
  assert.match(faviconSource, /<svg/);
  assert.match(faviconSource, /linearGradient id="bg"/);
  assert.match(faviconSource, /<rect x="197" y="112"/);
  assert.match(faviconSource, /<path d="m374 77/);
});

test("el Plan B alterna idiomas y permite buscar un enlace Karaoke", () => {
  assert.match(appSource, /Balanced Spanish and English Hits/);
  assert.match(appSource, /Find Karaoke Link/);
  assert.match(appSource, /Copy Karaoke Link/);
  assert.match(serverSource, /\/api\/suggestions\/youtube/);
});
