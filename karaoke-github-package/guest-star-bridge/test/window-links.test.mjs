const packageVersion=JSON.parse(await (await import('node:fs/promises')).readFile(new URL('../package.json',import.meta.url),'utf8')).version;
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const appSource = await readFile(resolve(root, "public/app.js"), "utf8");
const windowSource = await readFile(
  resolve(root, "macos/GuestStarNativeHost.m"),
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
const sessionRequestSource = await readFile(
  resolve(root, "../components/SessionRequestExperience.tsx"),
  "utf8"
);
const rootPageSource = await readFile(resolve(root, "../app/page.tsx"), "utf8");
const layoutSource = await readFile(resolve(root, "../app/layout.tsx"), "utf8");
const hotelPageSource = await readFile(resolve(root, "../app/h/[hotel]/page.tsx"), "utf8");
const bridgeHtml = await readFile(resolve(root, "public/index.html"), "utf8");
const bridgeStyles = await readFile(resolve(root, "public/styles.css"), "utf8");
const playerStyles = await readFile(resolve(root, "public/player-beta.css"), "utf8");
const playerSource = await readFile(resolve(root, "public/player-beta.js"), "utf8");
const webBetaLauncher = await readFile(resolve(root, "INICIAR-GUEST-STAR-WEB-BETA.command"), "utf8");
const stemsInstaller = await readFile(resolve(root, "INSTALAR-MOTOR-STEMS-IA.command"), "utf8");
const stemsSmokeTest = await readFile(resolve(root, "scripts/stems-engine-smoke.mjs"), "utf8");
const starScreenSource = await readFile(resolve(root, "public/star-screen.js"), "utf8");
const starScreenHtml = await readFile(resolve(root, "public/star-screen.html"), "utf8");
const starScreenCanvasSource = await readFile(resolve(root, "public/star-screen-canvas.js"), "utf8");
const googleSignInHtml = await readFile(resolve(root, "public/google-sign-in.html"), "utf8");
const googleSignInSource = await readFile(resolve(root, "public/google-sign-in.js"), "utf8");
const superhostSource = await readFile(resolve(root, "public/superhost.js"), "utf8");
const qrSource = await readFile(resolve(root, "public/qr-ui.js"), "utf8");
const faviconSource = await readFile(resolve(root, "../app/icon.png"));
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
const d1ActionsSource = await readFile(
  resolve(root, "../lib/guest-star/d1-actions.ts"),
  "utf8"
);

test("el motor de stems recibe WAV PCM compatible en macOS y Linux", () => {
  assert.match(serverSource, /"-c:a", "pcm_s16le"/);
  assert.match(stemsSmokeTest, /"-c:a", "pcm_s16le"/);
  assert.doesNotMatch(serverSource, /pcm_f32le/);
  assert.doesNotMatch(stemsSmokeTest, /pcm_f32le/);
});

test("los enlaces externos no crean pestañas dentro del WebView", () => {
  assert.doesNotMatch(appSource, /window\.open/);
  assert.match(appSource, /\/api\/external\/open/);
  assert.match(serverSource, /pathname === "\/api\/external\/open"/);
});

test("la ventana interna pertenece al host Cocoa y bloquea ventanas web emergentes", () => {
  assert.match(windowSource, /#import <Cocoa\/Cocoa\.h>/);
  assert.match(windowSource, /#import <WebKit\/WebKit\.h>/);
  assert.match(windowSource, /WKWebViewConfiguration/);
  assert.match(windowSource, /javaScriptCanOpenWindowsAutomatically = NO/);
  assert.doesNotMatch(windowSource, /osascript|JavaScript for Automation/);
});

test("la música ambiental nativa no depende del foco ni del espejo oculto de WebKit", () => {
  assert.match(windowSource, /applicationShouldTerminateAfterLastWindowClosed/);
  assert.match(windowSource, /return NO/);
  assert.match(windowSource, /applicationShouldHandleReopen/);
  assert.match(playerSource, /function backgroundTransportIsPlaying/);
  assert.match(playerSource, /function pauseNativeBackgroundDeck/);
  const pauseHandlerStart = playerSource.indexOf("backgroundAudio.addEventListener('pause'");
  const pauseHandler = playerSource.slice(pauseHandlerStart, playerSource.indexOf("backgroundAudio.addEventListener('timeupdate'", pauseHandlerStart));
  assert.match(pauseHandler, /if \(!usingNativeAudio\(\)\) pauseNativeDeck\('background'\)/);
  const endedHandlerStart = playerSource.indexOf("backgroundAudio.addEventListener('ended'");
  const endedHandler = playerSource.slice(endedHandlerStart, playerSource.indexOf("backgroundAudio.addEventListener('error'", endedHandlerStart));
  assert.match(endedHandler, /if \(usingNativeAudio\(\)\) return/);
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
  assert.doesNotMatch(googleSignInHtml, /Google Form|Google Sheet|reusable Guest Star Form/i);
  assert.match(googleSignInSource, /accounts\.google\.com\/gsi\/client/);
  assert.match(googleSignInSource, /google\.accounts\.id\.initialize/);
  assert.match(googleSignInSource, /credential: response\.credential/);
  assert.match(googleSignInSource, /jsonRequest\("\/api\/auth\/google"/);
  assert.doesNotMatch(googleSignInSource, /localStorage|sessionStorage|document\.cookie/);
});

test("Google se limita al inicio de sesión del Bridge y usa el binding real de Cloudflare", () => {
  assert.match(runtimeEnvSource, /getCloudflareContext/);
  assert.match(runtimeEnvSource, /context\.env/);
  assert.match(runtimeEnvSource, /process\.env\[key\]/);
  assert.match(bridgeApiSource, /runtimeEnvString\("GOOGLE_OAUTH_CLIENT_ID"\)/);
  assert.doesNotMatch(bridgeApiSource, /process\.env\.GOOGLE_OAUTH_CLIENT_ID/);
  assert.doesNotMatch(publicApiSource, /Apps Script|Google Forms|Google Sheets|callAppsScript/);
  assert.doesNotMatch(formSource, /googleFallback|Google Forms/);
});

test("el formulario envía el idioma seleccionado y el Bridge se lo muestra al host", () => {
  assert.match(formSource, /useState<Lang>\(providedUiLanguage\|\|"en"\)/);
  assert.match(formSource, /const active=languages\.find\(x=>x\[0\]===uiLang\)/);
  assert.match(formSource, /language:active\[3\]/);
  assert.match(bridgeHtml, /class="request-language"/);
  assert.match(appSource, /Language: \$\{item\.language\}/);
});

test("el idioma seleccionado usa el catálogo de ocho idiomas y persiste la interfaz", () => {
  assert.match(formSource, /aria-label="Interface language"/);
  assert.match(formSource, /GUEST_LANGUAGES\.map/);
  assert.match(formSource, /requestUiLanguage/);
  assert.match(formSource, /UI_LANGUAGE_STORAGE_KEY/);
  assert.match(formSource, /songLanguage=\{active\[0\]\}/);
  assert.match(formSource, /hindiLatinRequired=active\[0\]===\"hi\"/);
  assert.match(formSource, /language:active\[3\]/);
});

test("los módulos públicos y sugerencias siguen el idioma seleccionado", () => {
  assert.match(formSource, /const moduleText=moduleCopy\[uiLang\]/);
  assert.match(formSource, /className="requestUiLanguage"/);
  assert.match(formSource, /value=\{uiLang\}/);
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
  assert.match(rootPageSource, /SessionRequestExperience/);
  assert.match(sessionRequestSource, /KaraokeExperienceClient/);
  assert.doesNotMatch(rootPageSource, /hotelCode="default"/);
  assert.match(hotelPageSource, /KaraokeExperienceClient/);
  assert.doesNotMatch(rootPageSource, /from "@\/components\/KaraokeExperience"/);
  assert.doesNotMatch(hotelPageSource, /from "@\/components\/KaraokeExperience"/);
});

test("pedir otra canción conserva los idiomas elegidos localmente", () => {
  const resetSource = formSource.slice(
    formSource.indexOf("const reset="),
    formSource.indexOf("return <main")
  );
  assert.doesNotMatch(resetSource, /setUiLang|setLang/);
  assert.doesNotMatch(resetSource, /setLang\(null\)/);
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

test("las acciones rutinarias notifican sin modal y conservan confirmación de alto riesgo", () => {
  assert.doesNotMatch(appSource, /window\.confirm/);
  assert.match(appSource, /function confirmAction/);
  assert.match(appSource, /function runAction/);
  assert.match(appSource, /showNotice\(success\.detail, false, success\.action\)/);
  assert.doesNotMatch(appSource, /showSuccess\(success\.title, success\.detail\)/);
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
  assert.match(appSource, /buildActivitySummary\(state\?\.activity/);
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

test("el enlace seleccionado se copia y se guarda como referencia", () => {
  assert.match(
    appSource,
    /showNotice\([\x27"]Copiado[\x27"]\)/
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

test("la configuración heredada ya no se expone al operador", () => {
  assert.doesNotMatch(bridgeHtml, /id="legacyConnection"/);
  assert.doesNotMatch(appSource, /#legacyConnection/);
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
  assert.match(serverSource, /verifiedQueue = operatingMode === .bridge. \? \(vdjQueueHasSnapshot/);
  assert.match(appSource, /live VDJ/);
});

test("conserva el punto visible y nunca marca ausente una fila viva de VirtualDJ", () => {
  assert.match(appSource, /preserveBridgeScroll/);
  assert.match(appSource, /card\.dataset\.requestId = item\.id/);
  assert.match(appSource, /row\.dataset\.vdjId/);
  assert.doesNotMatch(appSource, /file unavailable/);
  assert.match(serverSource, /vdjLocalPathCandidates/);
  assert.match(serverSource, /availableInVirtualDJ: true/);
  assert.doesNotMatch(appSource, /Resend to the End/);
  const passiveTerminalSync = serverSource.slice(
    serverSource.indexOf("async function reconcileTerminalRequests"),
    serverSource.indexOf("function sheetMarksVirtualDj")
  );
  assert.doesNotMatch(passiveTerminalSync, /removeKaraokeEntry/);
  const queueAction = serverSource.slice(
    serverSource.indexOf("async function queueRequest"),
    serverSource.indexOf("async function replaceQueuedRequest")
  );
  assert.doesNotMatch(queueAction, /removeKaraokeEntry/);
  assert.match(appSource, /Change linked file/);
  assert.match(serverSource, /const replaceMatch = pathname\.match/);
  assert.match(serverSource, /replaceQueuedRequest/);
  assert.match(serverSource, /manualLink/);
  assert.match(serverSource, /expectedSinger: item \? vdjSingerForRequest\(item\) : entry\.singer/);
  assert.match(serverSource, /expectedSinger: vdjSingerForRequest\(item\)/);
  assert.match(serverSource, /knownExternal: knownExternalEntries\.has\(entry\.virtualDJItemId\)/);
});

test("protege Guest Star Experience y Guest Star como nombres de marca", () => {
  assert.match(bridgeHtml, /meta name="google" content="notranslate"/);
  assert.match(googleSignInHtml, /meta name="google" content="notranslate"/);
  assert.match(layoutSource, /meta name="google" content="notranslate"/);
  assert.match(bridgeHtml, /translate="no" data-brand><img class="gs-product-logo"/);
  assert.match(bridgeHtml, /translate="no" data-brand>Guest Star/);
  assert.match(formSource, /className="brand notranslate" translate="no"/);
  assert.match(hostPanelSource, /hostEyebrow notranslate/);
});

test("mantiene hotel, actividad, venue y PIN visibles en Modo Host", () => {
  assert.match(bridgeHtml, /id="hostSessionPin"/);
  assert.match(bridgeHtml, /id="hostSessionHotel"/);
  assert.match(bridgeHtml, /id="hostSessionPinValue"/);
  assert.match(bridgeHtml, /id="hostSessionQrButton"/);
  assert.match(bridgeHtml, /id="hostActivityQrDialog"/);
  assert.match(bridgeStyles, /\.topbar \{ position: sticky; top: 0; z-index: 120;/);
  assert.match(appSource, /currentHostActivityAccess\(state, \{ superhostInHostView: isHostView \}\)/);
  assert.match(appSource, /state\.account\?\.user\?\.role === "host"/);
  assert.match(appSource, /superhostInHostView && !superhostPanel\.isOpen\(\)/);
  assert.match(appSource, /!isHostView \|\| !tenant\.hotel \|\| !selectedActivity \|\| !tenant\.venue/);
  assert.match(appSource, /tenant\.hotel\?\.name, selectedActivity\?\.name, tenant\.venue\?\.name/);
  assert.match(serverSource, /kioskAccess: Object\.hasOwn\(data,\x27kioskAccess\x27\) \? data\.kioskAccess \|\| null : tenantState\.kioskAccess/);
});

test("integra Player Beta dentro de Guest Star y comparte la actividad real", () => {
  assert.doesNotMatch(bridgeHtml, /id="playerBetaButton"/);
  assert.doesNotMatch(bridgeHtml, /id="liveEventButton"/);
  assert.match(bridgeHtml, /id="openHostPanel">Modo Host/);
  assert.match(appSource, /requestHostEntry/);
  assert.match(appSource, /showHostForSelectedMode/);
  assert.match(bridgeHtml, /id="playerWorkspace"/);
  assert.match(bridgeHtml, /data-playback-mode="bridge"/);
  assert.match(appSource, /playerPanel\.sync\(state\)/);
  assert.match(playerSource, /state\?\.tenant\?\.hotel/);
  assert.match(playerSource, /state\?\.tenant\?\.activity/);
  assert.match(playerSource, /state\?\.tenant\?\.share/);
  assert.match(playerSource, /\/api\/player\/media/);
  assert.match(playerSource, /\/api\/player\/library/);
  assert.match(playerSource, /createMediaElementSource/);
  assert.match(starScreenSource, /guest-star:player-state/);
  assert.match(starScreenSource, /currentTime/);
  assert.match(starScreenHtml, /Star Screen/);
  assert.match(bridgeHtml, /id="playerStarScreenPreview"/);
  assert.match(serverSource, /assertAllowedFile/);
  assert.match(serverSource, /playerLibrarySearch/);
  assert.match(serverSource, /Accept-Ranges/);
  assert.match(serverSource, /setPlayerRequestOutcome/);
  assert.match(serverSource, /undoPlayerRequestOutcome/);
});

test("obliga a elegir Player o Bridge y bloquea el modo durante la actividad", () => {
  assert.match(bridgeHtml, /id="playbackModeDialog"/);
  assert.match(bridgeHtml, /data-playback-mode="player"/);
  assert.match(bridgeHtml, /data-playback-mode="bridge"/);
  assert.match(bridgeHtml, /id="bridgeChangeMode"/);
  assert.match(bridgeHtml, /id="playerChangeMode"/);
  assert.match(bridgeHtml, /Seleccionar el modo no inicia la actividad/);
  assert.match(appSource, /openPlaybackModeDialog/);
  assert.match(appSource, /state\.activity\?\.activityRunning === true/);
  assert.match(appSource, /#bridgeChangeMode/);
  assert.match(appSource, /#playerChangeMode/);
  assert.match(appSource, /Puedes cambiar entre Player y Bridge hasta iniciar la actividad/);
  assert.match(serverSource, /\/api\/activity\/mode/);
  assert.match(serverSource, /if \(activityState\.activityRunning\)/);
  assert.match(serverSource, /operatingMode !== "bridge"/);
  assert.match(serverSource, /operatingMode !== "player"/);
  assert.match(serverSource, /The playback mode is locked until this activity finishes/);
  assert.match(serverSource, /Select a hotel, venue and activity before choosing the playback mode/);
  assert.match(appSource, /Selecciona el hotel, venue y actividad antes de elegir el modo/);
  assert.match(appSource, /pendingHostEntry/);
  assert.match(appSource, /gueststar:open-superhost/);
  assert.match(appSource, /bridgeFinishedExpanded/);
  assert.match(appSource, /createBridgeOperations/);
});

test("Player ofrece controles operativos completos y un preview real de Star Screen", () => {
  for (const id of [
    "playerPlay", "playerRestart", "playerReturn", "playerSkip",
    "playerComplete", "playerRemove", "playerSeek", "playerVolume", "playerMute",
    "playerRequestsToggle", "playerPrimaryActivity", "playerScan",
    "playerSync", "playerSettings", "playerCompleted",
    "playerBackgroundToggle", "playerBackgroundVolume"
  ]) assert.match(bridgeHtml, new RegExp(`id="${id}"`));
  assert.doesNotMatch(bridgeHtml, /id="playerShare"/);
  assert.match(bridgeHtml, /id="hostActivityQrUrl"/);
  assert.match(bridgeHtml, /id="copyHostActivityLink"/);
  assert.match(appSource, /copyLink\(access\.joinUrl, "Enlace directo de la actividad copiado\."\)/);
  assert.match(playerSource, /media\.addEventListener\('ended'/);
  assert.match(playerSource, /\/api\/player\/requests\/\$\{encodeURIComponent\(item\.id\)\}\/outcome/);
  assert.match(playerSource, /\/api\/player\/requests\/\$\{encodeURIComponent\(id\)\}\/undo/);
  assert.match(playerSource, /\/api\/player\/requests\/pull/);
  assert.match(starScreenSource, /const drift = target - \(video\.currentTime/);
  assert.match(starScreenSource, /setVideoPlaybackRate\(rate \* \(1 \+ Math\.sign\(drift\)/);
  assert.match(starScreenSource, /pendingVideoTransportKey/);
  assert.match(starScreenSource, /presentationSignature/);
  assert.match(starScreenSource, /star-screen-video-health/);
  assert.match(starScreenSource, /setInterval\(\(\) => .*syncVideo\(lastState\); \}, 100\)/);
  assert.match(starScreenSource, /lastState\.playing/);
  assert.match(playerSource, /moveQueueItem/);
  assert.match(playerSource, /data-player-row-outcome/);
  assert.match(playerSource, /event\.shiftKey/);
  assert.match(playerSource, /fadeVolume/);
  assert.match(playerSource, /nativeVisualSyncPlan/);
  assert.match(playerSource, /publishNativeTransportUpdate/);
  assert.match(playerSource, /starScreenVideoHealth/);
  assert.match(playerSource, /endedNaturally/);
  assert.match(playerSource, /currentTimeSeconds: karaokeClockPosition\(\)/);
  assert.match(playerSource, /function cancelPendingKaraokeSeek/);
  assert.match(playerSource, /nativeAudioRequest\('nativeAudioSeek', \{ deck: 'karaoke', position: target, revision: generation \}, \{ signal: controller\.signal \}\)/);
  assert.match(playerSource, /if \(usingNativeAudio\(\)\) return;/);
  assert.match(playerStyles, /body\.player-mode \.player-star-screen-shell[^}]+aspect-ratio:16\/9!important/);
  assert.doesNotMatch(playerStyles, /player-star-screen-shell[^}]+aspect-ratio:auto/);
  assert.match(playerStyles, /\.player-live-mixer\{display:grid/);
  assert.match(playerStyles, /\.player-queue-card\{align-self:start;height:auto/);
});

test("los sliders del Player muestran pista, avance y porcentaje en macOS", () => {
  for (const id of [
    "playerSeek", "playerVolume", "playerVolumeValue",
    "playerVocalLevel", "playerVocalLevelValue",
    "playerBackgroundVolume", "playerBackgroundVolumeValue"
  ]) assert.match(bridgeHtml, new RegExp(`id="${id}"`));
  assert.match(bridgeHtml, /id="playerSeek" class="player-range player-seek-range"/);
  assert.match(bridgeHtml, /id="playerVolume" class="player-range"/);
  assert.match(bridgeHtml, /Volumen karaoke/);
  assert.match(bridgeHtml, /Volumen de fondo/);
  assert.match(playerStyles, /\.player-range::\-webkit-slider-runnable-track/);
  assert.match(playerStyles, /--range-progress/);
  assert.match(playerSource, /function paintRange/);
  assert.match(playerSource, /style\.setProperty\('--range-progress'/);
  assert.match(playerSource, /function renderKaraokeVolume/);
});

test("tempo y tonalidad conservan datos reales, precisión y controles compactos accesibles", () => {
  assert.match(bridgeHtml, /id="playerTempo"[^>]+min="50"[^>]+max="150"[^>]+step="0\.1"/);
  for (const id of ["playerTempoDown", "playerTempoReset", "playerTempoUp", "playerTempoLock"]) {
    assert.match(bridgeHtml, new RegExp(`id="${id}"`));
  }
  assert.match(bridgeHtml, /id="playerTempoReset">Restablecer tempo/);
  assert.doesNotMatch(bridgeHtml, /id="playerKeyShift"/);
  assert.match(bridgeHtml, /id="playerKeyDown"[^>]+Bajar un semitono/);
  assert.match(bridgeHtml, /id="playerKeyReset"[^>]+Restablecer tonalidad a cero/);
  assert.match(bridgeHtml, /id="playerKeyReset"[^>]*>\s*<span>Reset Key<\/span>/);
  assert.match(bridgeHtml, /id="playerKeyUp"[^>]+Subir un semitono/);
  assert.match(playerSource, /bpmAtTempo\(bpm, tempoPercent\)/);
  assert.match(playerSource, /function setKaraokeTempo/);
  assert.match(playerSource, /function setBackgroundTempo/);
  assert.match(playerSource, /\$\('#playerTempoReset'\)\.disabled = tempoPercent === 100;/);
  assert.match(playerSource, /\$\('#playerBackgroundTempoReset'\)\.disabled = backgroundTempoPercent === 100;/);
  assert.match(playerSource, /\$\('#playerTempoReset'\)\.addEventListener\('click', \(\) => setKaraokeTempo\(100, \{ immediate: true \}\)\);/);
  assert.match(playerSource, /\$\('#playerBackgroundTempoReset'\)\.addEventListener\('click', \(\) => setBackgroundTempo\(100, \{ immediate: true \}\)\);/);
  assert.match(playerSource, /setPitchRatio\(mediaAudioGraph\?\.pitch, keySemitones\)/);
  assert.match(playerSource, /analysisGeneration \+= 1;[\s\S]*?currentAnalysis = null;[\s\S]*?tempoPercent = 100;[\s\S]*?keySemitones = 0;/);
  assert.match(playerStyles, /body\.player-mode \.player-screen-card\{height:100%;max-height:100%;overflow-x:hidden;overflow-y:auto;[\s\S]*?scrollbar-gutter:stable/);
  for (const height of [1024, 820, 700]) assert.match(playerStyles, new RegExp(`@media\\(max-height:${height}px\\)`));
});

test("la consola ambiental no solapa botones ni controles de volumen", () => {
  assert.match(playerStyles, /\.player-background-live-actions\{[\s\S]*?grid-template-columns:minmax\(0,1\.35fr\)/);
  assert.match(playerStyles, /\.player-background-live>header,\.player-background-live-actions,\.player-background-volume,\.player-background-quick-pick/);
  assert.match(playerStyles, /\.player-background-live-actions \.button span\{[\s\S]*?text-overflow:ellipsis/);
});

test("el preview del Host encaja toda la composición Star Screen dentro de 16:9", () => {
  assert.match(playerStyles, /Canonical 1920×1080 canvas/);
  assert.match(playerStyles, /\.star-screen-canvas\{[^}]*width:1920px;height:1080px;[^}]*scale\(var\(--star-screen-scale\)\)/);
  assert.match(playerStyles, /\.player-star-screen-shell\{[^}]*aspect-ratio:16\/9/);
  assert.match(starScreenHtml, /id="starScreenCanvas"/);
  assert.match(starScreenSource, /installStarScreenCanvas/);
  assert.doesNotMatch(starScreenSource, /classList\.add\('star-screen-preview'\)/);
  assert.match(starScreenCanvasSource, /Math\.min\(width \/ STAR_SCREEN_CANVAS_WIDTH, height \/ STAR_SCREEN_CANVAS_HEIGHT\)/);
});

test("al volver desde Player muestra la actividad y oculta la consola VirtualDJ", () => {
  assert.match(appSource, /classList\.toggle\("player-selected-mode", selectedMode === "player"\)/);
  assert.match(appSource, /function playerActivityDisplaySummary/);
  assert.match(playerStyles, /player-selected-mode:not\(\.player-mode\) #vdjStatus/);
  assert.match(playerStyles, /player-selected-mode:not\(\.player-mode\) #vdjQueuePanel/);
  assert.match(playerStyles, /player-selected-mode:not\(\.player-mode\) #requests \.request-details/);
  assert.match(appSource, /active Player/);
  assert.match(appSource, /function playerActivityDisplaySummary/);
});

test("Player recibe solicitudes públicas sin reconciliar VirtualDJ", () => {
  assert.match(serverSource, /pathname === "\/api\/player\/requests\/pull"/);
  assert.match(playerSource, /\/api\/player\/requests\/pull/);
  assert.match(serverSource, /if \(operatingMode === "bridge"\) await reconcileVirtualDjQueue\(true\)/);
  assert.match(serverSource, /void runSyncMaintenance\(\)/);
});

test("Star Screen abre, enfoca y mueve una única ventana del host nativo", () => {
  assert.match(playerSource, /\/api\/player\/star-screen\/open/);
  assert.doesNotMatch(playerSource, /playerOpenStarScreen[^\n]+\/api\/external\/open/);
  assert.match(serverSource, /openStarScreenWindow/);
  assert.match(serverSource, /pathname === "\/api\/player\/star-screen\/open"/);
  assert.match(playerSource, /window\.webkit\?\.messageHandlers\?\.guestStarNative/);
  assert.match(playerSource, /action: 'openStarScreen'/);
  assert.match(windowSource, /if \(self\.starWindow != nil\) return/);
  assert.match(windowSource, /NSWindowStyleMaskBorderless/);
  assert.match(windowSource, /BOOL floatingWindow = preview \|\| \(NSScreen\.screens\.count <= 1 &&\s*\[self isBuiltInScreen:screen\]\)/);
  assert.match(windowSource, /NSWindowStyleMaskTitled \|[\s\S]*?NSWindowStyleMaskClosable \|[\s\S]*?NSWindowStyleMaskMiniaturizable \|[\s\S]*?NSWindowStyleMaskResizable/);
  assert.match(windowSource, /NSWindowCollectionBehaviorDefault/);
  assert.match(windowSource, /NSMakeRect\(0, 0, 1280, 720\)/);
  assert.match(windowSource, /CGDisplayCreateUUIDFromDisplayID/);
  assert.match(windowSource, /makeKeyAndOrderFront:nil/);
  assert.match(windowSource, /orderFrontRegardless/);
  assert.match(windowSource, /if \(self\.starWindow\.miniaturized\) \[self\.starWindow deminiaturize:nil\]/);
  assert.match(windowSource, /starScreenForDisplayID:self\.requestedStarDisplayID preview:self\.starPreview/);
  assert.match(windowSource, /NSApplicationDidChangeScreenParametersNotification/);
});

test("Star Screen muestra video limpio y reserva Sonando ahora para la música ambiental", () => {
  assert.match(playerSource, /displayMode: stageMode === 'karaoke'/);
  assert.match(starScreenSource, /next\?\.displayMode === 'karaoke'/);
  assert.match(playerStyles, /star-screen-karaoke-active \.star-screen-stage/);
  assert.doesNotMatch(playerStyles, /star-screen-karaoke-active \.star-screen-stage[^}]*display:none/);
  assert.match(playerStyles, /transition:opacity 760ms/);
  assert.match(starScreenSource, /next\.background\?\.track/);
  assert.match(starScreenSource, /starScreenNowSinger/);
  assert.match(starScreenHtml, /vendor\/qrcode\.js/);
  assert.match(starScreenHtml, /star-screen-lineup-tools/);
  assert.match(bridgeHtml, /PISTA KARAOKE SELECCIONADA/);
  assert.match(bridgeHtml, /MÚSICA DE FONDO \/ BACKGROUND MUSIC/);
});

test("las preferencias visuales ocultan sus regiones sin detener Player, audio ni análisis", () => {
  assert.match(bridgeHtml, /id="preferenceShowWaveform"/);
  assert.match(bridgeHtml, /id="preferenceShowStarScreenNowPlaying"/);
  assert.match(starScreenHtml, /id="starScreenWaveformRegion"/);
  assert.match(starScreenHtml, /id="starScreenNow"/);
  assert.match(starScreenSource, /starScreenWaveformRegion'\)\.hidden = !showWaveform/);
  assert.match(starScreenSource, /starScreenNow'\)\.hidden = finale \|\| !showNowPlaying/);
  assert.match(playerStyles, /star-screen-hide-waveform [^{]*\.star-screen-lobby-waveform\{display:none!important\}/);
  assert.match(playerStyles, /star-screen-hide-now-playing [^{]*\.star-screen-now\{display:none!important\}/);
  assert.doesNotMatch(starScreenSource, /showWaveform[\s\S]{0,120}(?:pause|load|currentTime|playbackRate)/);
  assert.doesNotMatch(starScreenSource, /showNowPlaying[\s\S]{0,120}(?:pause|load|currentTime|playbackRate)/);
});

test("la biblioteca local exige cantante y crea una entrada propia del Player", () => {
  assert.match(bridgeHtml, /id="playerAssignSingerDialog"/);
  assert.match(bridgeHtml, /id="playerAssignSinger"/);
  assert.match(playerStyles, /:not\(#playerAssignSingerDialog\)/);
  assert.match(playerSource, /openSingerAssignment/);
  assert.match(playerSource, /\/api\/player\/local-requests/);
  assert.match(serverSource, /createPlayerLocalRequest/);
  assert.match(serverSource, /sourceType: "player_local"/);
  assert.match(serverSource, /playerLocalRequests/);
  assert.doesNotMatch(bridgeHtml, /¿Separar voces con IA\?/);
  assert.match(serverSource, /void enqueueStemRequest\(item\.id, "auto"\)/);
  assert.match(playerSource, /playerPreparationReady\(\)/);
  assert.match(serverSource, /Select an activity and Player mode before adding a local singer/);
});

test("agregar una pista local a la fila no sustituye el medio activo", () => {
  const assignmentFlow = playerSource.slice(
    playerSource.indexOf("async function assignSinger"),
    playerSource.indexOf("function recordAudio")
  );
  assert.match(assignmentFlow, /sync\(await api\('\/api\/state'\)\)/);
  assert.doesNotMatch(assignmentFlow, /loadRequest\(/);
  assert.doesNotMatch(assignmentFlow, /currentId\s*=/);
  assert.doesNotMatch(assignmentFlow, /clearPlayerMedia\(/);
});

test("la sesión activa bloquea mutaciones externas y confirma acciones de alto riesgo", () => {
  assert.match(playerSource, /let activePlaybackSession = null/);
  assert.match(playerSource, /function activePlaybackLocked\(\)/);
  assert.match(playerSource, /ACTIVE_PLAYBACK_MUTATION_BLOCKED/);
  assert.match(playerSource, /playerTrackChangeAllowed\(\{ activeTrackId: activePlaybackSession\?\.trackId, targetTrackId: requestId \}\)/);
  assert.match(playerSource, /La pista cargada está protegida/);
  assert.match(playerSource, /Esta canción está en reproducción\. ¿Devolverla a la fila\?/);
  assert.match(playerSource, /Esta canción está en reproducción\. ¿Saltar al siguiente turno\?/);
  assert.match(playerSource, /Esta canción todavía está reproduciéndose\. ¿Marcarla como completada\?/);
  assert.match(playerSource, /Quitarla interrumpirá el Player/);
  assert.match(playerSource, /if \(!playerReady\(\) && !activePlaybackLocked\(\)\)/);
});

test("la música ambiental tiene fuentes, mezcla aleatoria y volumen independiente", () => {
  for (const id of [
    "playerBackgroundAudio", "playerBackgroundToggle", "playerBackgroundNext",
    "playerBackgroundChooseFolder", "playerBackgroundChooseFile",
    "playerBackgroundVolume", "playerBackgroundVolumeValue"
  ]) assert.match(bridgeHtml, new RegExp(`id="${id}"`));
  assert.match(playerSource, /shuffled\(/);
  assert.match(playerSource, /playNextBackground/);
  assert.match(playerSource, /backgroundAudio\.volume/);
  assert.match(playerSource, /backgroundFailedIds/);
  assert.doesNotMatch(playerSource, /setTimeout\(\(\) => void playNextBackground\(\), 250\)/);
  assert.match(playerSource, /\/api\/player\/background\/config/);
  assert.match(serverSource, /BACKGROUND_AUDIO_EXTENSIONS/);
  assert.match(serverSource, /backgroundMusicVolume/);
  assert.match(playerSource, /const hasConfiguredSources = sources\.length > 0/);
  assert.match(playerSource, /Música ambiental configurada/);
  assert.match(playerSource, /Analizando fuentes configuradas/);
  assert.match(playerSource, /if \(nativeDeckIsLoaded\('background'\)\) await pauseNativeBackgroundDeck\(\)/);
  assert.match(playerSource, /if \(!playerPreparationReady\(\) \|\| stageMode === 'karaoke'\) return/);
  assert.match(bridgeHtml, /id="playerBackgroundBpmValue"/);
  assert.match(bridgeHtml, /id="playerBackgroundBpmStatus"/);
  assert.match(bridgeHtml, /id="playerBackgroundTempo"[^>]+min="50"[^>]+max="150"[^>]+step="0\.1"/);
  for (const id of ["playerBackgroundTempoDown", "playerBackgroundTempoReset", "playerBackgroundTempoUp", "playerBackgroundTempoLock"]) {
    assert.match(bridgeHtml, new RegExp(`id="${id}"`));
  }
  assert.match(bridgeHtml, /id="playerBackgroundTempoReset">Restablecer tempo/);
  assert.doesNotMatch(bridgeHtml, /id="playerBackgroundPitch"/);
  assert.doesNotMatch(playerSource, /backgroundSemitones|playerBackgroundPitch/);
  assert.match(playerSource, /analyzeBackgroundTrack/);
  assert.match(playerSource, /BACKGROUND_TRACK_ANALYSIS_COMPLETED/);
  assert.match(playerStyles, /\.player-background-processing\{[^}]+grid-template-columns:minmax\(145px,\.8fr\) minmax\(210px,1\.2fr\)/);
});

test("cada turno del Player despliega versiones Karaoke para copiar o abrir", () => {
  assert.match(playerSource, /function youtubeDropdown/);
  assert.match(playerSource, /data-player-youtube-details/);
  assert.match(playerSource, /data-player-youtube-copy/);
  assert.match(playerSource, /data-player-youtube-open/);
  assert.match(playerSource, /data-player-youtube-search/);
  assert.match(playerSource, /\/api\/requests\/\$\{encodeURIComponent\(id\)\}\/youtube/);
  assert.match(playerSource, /\/youtube\/copy/);
  assert.match(playerSource, /\/api\/external\/open/);
  assert.match(playerSource, /openYoutubeIds/);
  assert.match(playerStyles, /\.player-queue-youtube/);
});

test("la beta detecta archivos automáticamente y refresca el buscador abierto", () => {
  assert.match(serverSource, /const WEB_BETA = process\.env\.GUEST_STAR_WEB_BETA === "1"/);
  assert.match(serverSource, /\(WEB_BETA \? 5 : config\.scanIntervalSeconds\) \* 1000/);
  assert.match(serverSource, /function startLibraryWatchers/);
  assert.match(serverSource, /scheduleRealtimeScan/);
  assert.match(playerSource, /lastLibraryScanAt !== previousLibraryScanAt/);
  assert.match(playerSource, /searchLibrary\(\{ silent: true, browseAll: libraryBrowseAll \}\)/);
  assert.match(bridgeHtml, /id="playerLibraryAutoState"/);
});

test("Player ofrece pista ambiental específica, EQ real y stems IA separados", () => {
  for (const id of [
    "playerBackgroundSearch", "playerBackgroundTrackSelect", "playerBackgroundPlaySelected",
    "playerEqLow", "playerEqMid", "playerEqHigh", "playerEqReset",
    "playerInstrumentalAudio", "playerVocalsAudio", "playerVocalLevel"
  ]) assert.match(bridgeHtml, new RegExp(`id="${id}"`));
  assert.match(playerSource, /preferredId/);
  assert.match(playerSource, /createBiquadFilter/);
  assert.match(playerSource, /low\.type = 'lowshelf'/);
  assert.match(playerSource, /mid\.type = 'peaking'/);
  assert.match(playerSource, /high\.type = 'highshelf'/);
  assert.match(playerSource, /instrumentalGain/);
  assert.match(playerSource, /vocalsGain/);
  assert.match(playerSource, /audioSettings\.vocalLevel/);
  assert.match(playerSource, /queueStemsForAvailability/);
  assert.doesNotMatch(bridgeHtml, /id="playerStemQuickAction"/);
  assert.doesNotMatch(bridgeHtml, /id="playerStemEngine"/);
  assert.match(serverSource, /demucs/);
  assert.match(serverSource, /BUNDLED_STEM_ENGINE_ROOT = resolve\(ROOT, "stem-engine"\)/);
  assert.match(serverSource, /\.guest-star-stems/);
  assert.match(serverSource, /instrumental\.m4a/);
  assert.match(serverSource, /vocals\.m4a/);
  assert.match(serverSource, /"-c:a", "aac", "-profile:a", "aac_low", "-b:a", String\(GSX_DEFAULT_PROFILE\.instrumentalBitrate\)/);
  assert.match(stemsInstaller, /scripts\/install-stem-engine-macos\.sh/);
  assert.match(stemsSmokeTest, /sherpa-onnx-offline-source-separation/);
  assert.match(stemsSmokeTest, /instrumentalDuration - vocalsDuration/);
  assert.match(stemsSmokeTest, /instrumentalBytes/);
  assert.match(playerSource, /setTargetAtTime/);
  assert.match(playerStyles, /\.player-audio-lab/);
  assert.match(playerSource, /shell\.addEventListener\('pointermove'/);
  assert.match(playerSource, /audioContext\?\.resume\(\)/);
  assert.match(playerStyles, /\.player-knob-shell input\{pointer-events:none\}/);
  assert.match(playerSource, /function syncStemTimes\(force = false\)/);
  assert.match(playerSource, /Math\.abs\(drift\) > 0\.15/);
  assert.doesNotMatch(playerSource, /element\.playbackRate = Math\.max/);
  assert.match(playerSource, /for \(const type of \['waiting', 'stalled'\]\)/);
  assert.match(playerSource, /media\.addEventListener\(type, \(\) => \{[\s\S]*?pauseStemTracks\(\)/);
  assert.match(playerSource, /media\.addEventListener\('seeked'/);
  assert.match(serverSource, /gsxStemCachePaths/);
  assert.match(serverSource, /aresample=44100:first_pts=0/);
  assert.match(serverSource, /spleeterExecutionBudget\(availableParallelism\(\), stemResourceState\)/);
  assert.match(serverSource, /"--overlap", "0\.05"/);
  assert.match(serverSource, /stemResourceController\.update\(currentStemResourceSignals\(\)\)/);
});

test("los motores IA usan el paquete integrado, se prueban de verdad y explican cada fallo", () => {
  assert.match(serverSource, /STEM_ENGINE_ROOT = existsSync\(resolve\(BUNDLED_STEM_ENGINE_ROOT, "package\.json"\)\)[\s\S]*?BUNDLED_STEM_ENGINE_ROOT[\s\S]*?INSTALLED_STEM_ENGINE_ROOT/);
  for (const status of ["not_installed", "not_executable", "model_missing", "temporary_error", "checking"]) {
    assert.match(serverSource, new RegExp(`"${status}"`));
  }
  assert.match(serverSource, /function stemStatusMessage/);
  assert.match(serverSource, /function verifyStemEngineCapability/);
  assert.match(serverSource, /STEM_ENGINE_SMOKE_SCRIPT, STEM_ENGINE_ROOT, `--engine=\$\{engine\}`/);
  assert.match(serverSource, /activeStemVerificationChild\.kill\("SIGSTOP"\)/);
  assert.match(serverSource, /status: stemEngineStatus\.status/);
  assert.match(serverSource, /status: stemCapabilities\.spleeter\.status/);
  assert.match(playerSource, /state\?\.stemEngine\?\.message \|\| 'Motores IA no disponibles'/);
  assert.match(playerSource, /queueStemsForAvailability/);
  assert.match(stemsSmokeTest, /--engine=/);
});

test("la fila y Stems mantienen altura fija y las opciones flotan fuera de la tarjeta", () => {
  assert.match(playerSource, /expandedRequestIds/);
  assert.match(playerSource, /data-player-expand/);
  assert.match(playerSource, /player-queue-details \$\{expanded \? '' : 'hidden'\}/);
  assert.match(playerSource, /class="player-queue-stem-state/);
  assert.doesNotMatch(playerSource, /STEMS IA EN PREPARACIÓN/);
  assert.match(playerSource, /queueUI\.refresh\(\)/);
  assert.match(playerStyles, /height:52px;min-height:52px;max-height:52px/);
  assert.match(playerStyles, /\.player-queue-options\{position:fixed/);
  assert.match(playerStyles, /\.player-queue-details\.hidden\{display:none\}/);
  assert.match(playerStyles, /max-height:min\(56vh,565px\)/);
});

test("historial y Plan B viven dentro del Player y la lista infinita ya no se duplica", () => {
  assert.match(bridgeHtml, /data-player-drawer="history"/);
  assert.doesNotMatch(bridgeHtml, /data-player-drawer="plan-b"/);
  assert.match(bridgeHtml, /<details class="player-plan-b-card">/);
  assert.match(bridgeHtml, /<summary><div><p class="eyebrow">PLAN B DE ROTACIÓN/);
  assert.match(bridgeHtml, /class="player-plan-b-content"/);
  assert.match(bridgeHtml, /id="playerPlanBBadge"/);
  assert.match(bridgeHtml, /id="playerPlanB"/);
  assert.match(playerSource, /function drawPlanB/);
  assert.match(playerSource, /data-player-plan-b-assign/);
  assert.doesNotMatch(bridgeHtml, /Listas infinitas para llenar la rotación/);
  assert.doesNotMatch(bridgeHtml, /id="randomRotation"/);
});

test("Plan B permanece compacto, desplegable y con scroll interno junto al Player", () => {
  assert.match(bridgeHtml, /<aside class="player-side-rail"[\s\S]*?class="player-queue-list"[\s\S]*?<details class="player-plan-b-card">[\s\S]*?<\/aside>/);
  assert.match(playerStyles, /body\.player-mode \.player-side-rail\{[\s\S]*?grid-template-rows:minmax\(150px,1fr\) minmax\(210px,46%\);[\s\S]*?overflow:visible/);
  assert.match(playerStyles, /body\.player-mode \.player-side-rail \.player-queue-list\{[\s\S]*?max-height:none;[\s\S]*?overflow:auto/);
  assert.match(playerStyles, /\.player-plan-b-card\{[\s\S]*?height:auto;[\s\S]*?max-height:100%;[\s\S]*?align-self:stretch;[\s\S]*?overflow:hidden/);
  assert.match(playerStyles, /\.player-plan-b-card\[open\]\{display:grid;grid-template-rows:auto minmax\(0,1fr\)\}/);
  assert.match(playerStyles, /\.player-plan-b-content\{[\s\S]*?display:grid;[\s\S]*?grid-template-rows:auto minmax\(0,1fr\);[\s\S]*?height:calc\(100% - 66px\);[\s\S]*?max-height:calc\(100% - 66px\);[\s\S]*?overflow:hidden/);
  assert.match(playerStyles, /\.player-plan-b-list\{[\s\S]*?min-height:0;[\s\S]*?overflow-y:auto;[\s\S]*?overscroll-behavior:contain;[\s\S]*?scrollbar-gutter:stable/);
  assert.match(playerStyles, /\.player-plan-b-controls \.button\{[\s\S]*?padding:6px 7px;[\s\S]*?white-space:nowrap/);
  assert.match(playerStyles, /@media\(max-width:1050px\)\{[\s\S]*?body\.player-mode \.player-layout\{grid-template-columns:1fr;overflow:visible\}[\s\S]*?body\.player-mode \.player-side-rail\{[\s\S]*?grid-template-rows:auto auto/);
  assert.doesNotMatch(playerStyles, /body\.player-mode \.player-screen-card\{grid-row:1\/3\}/);
  assert.doesNotMatch(playerStyles, /body\.player-mode \.player-workspace\{overflow-x:hidden;overflow-y:auto/);
});

test("las sugerencias de Plan B priorizan título y artista y conservan metadatos reales", () => {
  assert.match(playerSource, /const song = String\(item\.song \|\| ''\)\.trim\(\) \|\| 'Título no indicado'/);
  assert.match(playerSource, /const artist = String\(item\.artist \|\| ''\)\.trim\(\) \|\| 'Artista no indicado'/);
  assert.match(playerSource, /class="player-plan-b-primary"/);
  assert.match(playerSource, /class="player-plan-b-meta"/);
  assert.match(playerSource, /item\.fileName \|\| \(item\.localAvailable \? 'Biblioteca local'/);
  assert.match(playerSource, /\['YouTube', link\.channel \|\| 'Canal no indicado'/);
  assert.match(playerSource, /player-plan-b-youtube-artist/);
  assert.match(playerStyles, /\.player-plan-b-primary strong\{[\s\S]*?white-space:normal;[\s\S]*?overflow-wrap:anywhere/);
});

test("cada filtro de Plan B refleja una única selección real y conserva el vacío", () => {
  for (const list of ['spanish', 'english', 'favorites']) {
    assert.match(bridgeHtml, new RegExp(`data-player-plan-b-list="${list}" aria-pressed="false"`));
  }
  assert.match(bridgeHtml, /data-player-plan-b-list="both" aria-pressed="true"/);
  assert.match(playerSource, /let planBSelectionMade = false;/);
  assert.match(playerSource, /let activePlanBList = 'both';/);
  assert.match(playerSource, /button\.classList\.toggle\('primary', active\)/);
  assert.match(playerSource, /button\.classList\.toggle\('ghost', !active\)/);
  assert.match(playerSource, /button\.setAttribute\('aria-pressed', String\(active\)\)/);
  assert.match(playerSource, /if \(planBSelectionMade\) return planBItems;/);
  assert.match(playerSource, /body: JSON\.stringify\(\{ list: requestedList, count: 8 \}\)/);
  assert.doesNotMatch(playerSource, /activePlanBList = previousList/);
  assert.match(playerStyles, /\.player-plan-b-controls \.button\[aria-pressed="true"\]\{[\s\S]*?background:linear-gradient/);
});

test("los ajustes visuales de búsqueda, Música de fondo y Plan B conservan los flujos existentes", () => {
  assert.doesNotMatch(bridgeHtml, /data-player-drawer="library"/);
  assert.doesNotMatch(bridgeHtml, /data-player-drawer="background"/);
  assert.match(bridgeHtml, /id="preferencesBackgroundTitle">Fuentes de audio/);
  assert.match(bridgeHtml, /id="playerBackgroundChooseFolder"/);
  assert.match(bridgeHtml, /id="playerBackgroundChooseFile"/);
  assert.match(bridgeHtml, /id="playerBackgroundTrackSelect" size="4"/);
  assert.match(playerStyles, /\.player-background-quick-pick:focus-within select\[size\]/);
  assert.match(playerStyles, /\.player-background-quick-pick option/);
  assert.doesNotMatch(playerStyles, /body\.player-mode \.player-workspace\{overflow-x:hidden;overflow-y:auto/);
  assert.doesNotMatch(playerSource, /Karaoke con letras/);
  assert.match(playerSource, /link\.channel \|\| 'Canal no indicado'/);
});

test("una actividad en curso bloquea el cambio de modo pero permite volver a Superhost", () => {
  assert.match(playerSource, /if \(!force && playerReady\(\)\)/);
  assert.doesNotMatch(bridgeHtml, /id="playerClose"/);
  assert.match(appSource, /openSuperhostView/);
  assert.match(appSource, /autoRestoredBridgeActivityId/);
  assert.match(appSource, /Finaliza la actividad antes de cambiar hotel, actividad o modo/);
  assert.match(appSource, /playerPanel\.close\(\{ force: true \}\)/);
});

test("el QR de Star Screen es grande y el preview conserva legibilidad", () => {
  assert.match(playerStyles, /star-screen-canvas \.star-screen-lineup-head>\.star-screen-lineup-tools \.star-screen-qr-card img\{[^}]*width:104px;height:104px/);
  assert.doesNotMatch(starScreenHtml, /starScreenFullscreen/);
  assert.doesNotMatch(starScreenHtml, /starScreenStatus/);
});

test("Saltar y Cantada funcionan con la pista seleccionada o el primer turno, sin depender de Play o Pausa", () => {
  assert.match(playerSource, /\['#playerSkip', '#playerComplete', '#playerRemove'\]/);
  assert.match(playerSource, /!current\(\) && !queue\(\)\.length/);
  assert.match(playerSource, /requestedId = currentId \|\| queue\(\)\[0\]\?\.id/);
  assert.doesNotMatch(playerSource, /\['#playerReturn', '#playerSkip', '#playerComplete'[^\n]+media\.paused/);
  assert.match(playerSource, /await enterLobby\(/);
  assert.match(playerSource, /advance\('removed'\)/);
});

test("el cambio a karaoke espera reproducción real y la música ambiental no publica candidatos fallidos", () => {
  const start = playerSource.slice(
    playerSource.indexOf("async function startKaraoke"),
    playerSource.indexOf("async function pauseKaraoke")
  );
  assert.ok(start.indexOf("await media.play()") < start.indexOf("setScene('karaoke', 'to-karaoke')"));
  const ambient = playerSource.slice(
    playerSource.indexOf("async function playNextBackground"),
    playerSource.indexOf("async function ensureBackgroundPlaying")
  );
  assert.ok(ambient.indexOf("await backgroundAudio.play()") < ambient.indexOf("backgroundCurrentId = nextId"));
  assert.match(ambient, /maximumAttempts = Math\.min\(backgroundTracks\(\)\.length, 3\)/);
  assert.match(starScreenSource, /publishedAt && publishedAt < lastPublishedAt/);
  assert.match(starScreenSource, /function expectedPlaybackTime/);
  assert.match(starScreenSource, /return lyricsPlaybackTime\(next\)/);
  assert.match(starScreenSource, /video\.addEventListener\('loadedmetadata'/);
  assert.doesNotMatch(starScreenSource, /else video\.addEventListener\('loadedmetadata', align/);
});

test("el lanzador web de prueba sigue aislado de la aplicación oficial", () => {
  assert.match(bridgeHtml, new RegExp("GUEST STAR "+packageVersion.replaceAll(".","\\.")));
  assert.match(serverSource, /process\.env\.GUEST_STAR_PORT/);
  assert.match(serverSource, /process\.env\.GUEST_STAR_WEB_BETA/);
  assert.match(webBetaLauncher, /GUEST_STAR_PORT=8790/);
  assert.match(webBetaLauncher, /http:\/\/127\.0\.0\.1:8790/);
});

test("el formulario confirma repeticiones en el idioma elegido", () => {
  assert.match(formSource, /DUPLICATE_CONFIRMATION_REQUIRED/);
  assert.match(formSource, /duplicateCopy: Record<Lang, DuplicateCopy>/);
  assert.match(formSource, /confirmDuplicate/);
  assert.match(formSource, /duplicateDialog/);
  assert.match(d1ActionsSource, /"Retirada del Player", "Fuera de VirtualDJ"/);
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
  assert.match(d1ActionsSource, /action === "createHotel"/);
});

test("Host y Superhost editan agenda única o recurrente con anuncios por día", () => {
  assert.match(hostPanelSource, /editingSchedule\?"updateSchedule":"scheduleActivity"/);
  assert.match(hostPanelSource, /recurrenceType==="none"\?\{scheduledLocal:local\}:\{scheduledTime:/);
  assert.match(hostPanelSource, /weekdayAnnouncements=recurrenceDays\.map/);
  assert.match(superhostSource, /scheduleId \? "updateSchedule" : "scheduleActivity"/);
  assert.match(superhostSource, /data-announcement-day/);
  assert.match(d1ActionsSource, /ONE_TIME_DATE_REQUIRED/);
  assert.match(d1ActionsSource, /RECURRENCE_DAYS_REQUIRED/);
  assert.match(d1ActionsSource, /async function postActivityAnnouncement/);
  assert.match(formSource, /postActivityAnnouncement/);
  assert.match(formSource, /nextGuestStarAt/);
});

test("el Bridge usa un proxy dedicado sin quitar los tokens de su sesión", () => {
  assert.match(bridgeApiSource, /X-Guest-Star-Bridge-Proxy/);
  assert.doesNotMatch(bridgeApiSource, /callAppsScript|APPS_SCRIPT_TIMEOUT_MS/);
  assert.doesNotMatch(bridgeApiSource, /delete payload\.authToken/);
  assert.match(bridgeHtml, /id="bridgeVersion"/);
  assert.match(appSource, /state\.version \|\| "unknown"/);
  assert.match(bridgeApiSource, /X-Guest-Star-Bridge-Proxy": "4\.4\.0"/);
  assert.match(hostPanelSource, /brand-horizontal\.png/);
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
  assert.equal(faviconSource.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.match(bridgeHtml, /branding\/favicon-32\.png/);
});

test("el Plan B alterna idiomas y permite buscar un enlace Karaoke", () => {
  assert.match(appSource, /Balanced Spanish and English Hits/);
  assert.match(appSource, /Find Karaoke Link/);
  assert.match(appSource, /Copy Karaoke Link/);
  assert.match(serverSource, /\/api\/suggestions\/youtube/);
});

test("la fuente de stems se bloquea antes de reproducir y nunca cambia en caliente", () => {
  const start = playerSource.slice(
    playerSource.indexOf("async function startKaraoke()"),
    playerSource.indexOf("async function pauseKaraoke()")
  );
  assert.ok(start.indexOf("lockStemSourceForCurrent()") < start.indexOf("media.play()"));
  assert.match(serverSource, /function lockStemSourceForPlayback/);
  assert.match(serverSource, /activeStemPlaybackLock/);
  assert.match(serverSource, /STEM_HOT_SWAP_BLOCKED/);
});

test("cada selección de video invalida audio y stems de la fila anterior", () => {
  const nativeSources = playerSource.slice(
    playerSource.indexOf("function nativeKaraokeSources"),
    playerSource.indexOf("function nativeDeckIsLoaded")
  );
  const start = playerSource.slice(
    playerSource.indexOf("async function startKaraoke()"),
    playerSource.indexOf("async function pauseKaraoke()")
  );
  assert.match(playerSource, /let karaokeMediaGeneration = 0;/);
  assert.match(playerSource, /let nativeKaraokeDeckRequestId = '';/);
  assert.match(playerSource, /function karaokeMediaSource/);
  assert.match(playerSource, /function karaokeStemSource/);
  assert.doesNotMatch(nativeSources, /media\.currentSrc/);
  assert.match(nativeSources, /absoluteMediaURL\(karaokeMediaSource\(id\)\)/);
  assert.match(nativeSources, /absoluteMediaURL\(karaokeStemSource\(id, 'instrumental'\)\)/);
  assert.match(nativeSources, /absoluteMediaURL\(karaokeStemSource\(id, 'vocals'\)\)/);
  assert.match(playerSource, /nativeAudioStop/);
  assert.match(playerSource, /expectedSource: karaokeMediaSource\(requestId\)/);
  assert.match(start, /nativeKaraokeDeckRequestId === requestId/);
  assert.match(start, /nativeKaraokeSources\(requestId\)/);
  assert.match(windowSource, /cancelPendingLoadsAndStop/);
  assert.match(windowSource, /\[deck cancelPendingLoadsAndStop\]/);
});

test("Player y Star Screen intercambian heartbeat y acuse cada dos segundos", () => {
  assert.match(starScreenSource, /function sendHeartbeat/);
  assert.match(starScreenSource, /type: 'star-screen-heartbeat'/);
  assert.match(starScreenSource, /type === 'star-screen-ack'/);
  assert.match(starScreenSource, /setInterval\(sendHeartbeat, 2000\)/);
  assert.match(playerSource, /type !== 'star-screen-heartbeat'/);
  assert.match(playerSource, /type: 'star-screen-ack'/);
});

test("los snapshots diagnósticos no aceptan identidad ni estado arbitrario del cliente", () => {
  assert.doesNotMatch(serverSource, /client:\s*clientSnapshot/);
  assert.match(serverSource, /installationRef: diagnosticReference/);
  assert.match(serverSource, /hotelRef: diagnosticReference/);
  assert.match(serverSource, /activityRef: diagnosticReference/);
  assert.doesNotMatch(serverSource, /currentState:\s*\{[\s\S]{0,260}hotelId:/);
  assert.match(serverSource, /\["spleeter", "demucs", "original"\]\.includes/);
  assert.match(serverSource, /DIAGNOSTIC_DELIVERY_COOLDOWN_MS = 30000/);
  assert.match(serverSource, /diagnosticDeliveryInFlight/);
});
