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
const appsScriptSource = await readFile(
  resolve(root, "../google-apps-script/Code.gs"),
  "utf8"
);
const d1ActionsSource = await readFile(
  resolve(root, "../lib/guest-star/d1-actions.ts"),
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
  assert.match(bridgeHtml, /translate="no" data-brand>✦ GUEST STAR EXPERIENCE/);
  assert.match(bridgeHtml, /translate="no" data-brand>Guest Star/);
  assert.match(formSource, /className="brand notranslate" translate="no"/);
  assert.match(hostPanelSource, /hostEyebrow notranslate/);
});

test("integra Player Beta dentro de Guest Star y comparte la actividad real", () => {
  assert.match(bridgeHtml, /id="playerBetaButton"/);
  assert.match(bridgeHtml, /id="playerWorkspace"/);
  assert.match(bridgeHtml, /Bridge \(VirtualDJ\)/);
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
  assert.match(appSource, /openPlaybackModeDialog/);
  assert.match(serverSource, /\/api\/activity\/mode/);
  assert.match(serverSource, /operatingMode !== "bridge"/);
  assert.match(serverSource, /operatingMode !== "player"/);
  assert.match(serverSource, /The playback mode is locked until this activity finishes/);
});

test("Player ofrece controles operativos completos y un preview real de Star Screen", () => {
  for (const id of [
    "playerPlay", "playerRestart", "playerReturn", "playerSkip",
    "playerComplete", "playerRemove", "playerSeek", "playerVolume", "playerMute",
    "playerRequestsToggle", "playerPrimaryActivity", "playerScan",
    "playerSync", "playerShare", "playerSettings", "playerCompleted"
  ]) assert.match(bridgeHtml, new RegExp(`id="${id}"`));
  assert.match(playerSource, /media\.addEventListener\('ended'/);
  assert.match(playerSource, /\/api\/player\/requests\/\$\{encodeURIComponent\(item\.id\)\}\/outcome/);
  assert.match(playerSource, /\/api\/player\/requests\/\$\{encodeURIComponent\(id\)\}\/undo/);
  assert.match(playerSource, /\/api\/player\/sync/);
  assert.match(starScreenSource, /const drift = target - \(video\.currentTime/);
  assert.match(starScreenSource, /video\.playbackRate = Math\.max\(0\.97/);
  assert.match(starScreenSource, /setInterval\(\(\) => .*200\)/);
  assert.match(starScreenSource, /lastState\.playing/);
  assert.match(playerSource, /moveQueueItem/);
  assert.match(playerSource, /data-player-row-outcome/);
  assert.match(playerSource, /event\.shiftKey/);
  assert.match(playerSource, /fadeVolume/);
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
  assert.match(bridgeHtml, /MÚSICA DE FONDO · STAR SCREEN/);
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
  assert.match(serverSource, /demucs/);
  assert.match(serverSource, /BUNDLED_STEM_ENGINE_ROOT = resolve\(ROOT, "stem-engine"\)/);
  assert.match(serverSource, /\.guest-star-stems/);
  assert.match(serverSource, /instrumental\.m4a/);
  assert.match(serverSource, /vocals\.m4a/);
  assert.match(serverSource, /"-c:a", "aac", "-b:a", "256k"/);
  assert.match(stemsInstaller, /stems-engine-smoke\.mjs/);
  assert.match(stemsSmokeTest, /instrumentalDuration - vocalsDuration/);
  assert.match(stemsSmokeTest, /instrumentalBytes/);
  assert.match(playerSource, /setTargetAtTime/);
  assert.match(playerStyles, /\.player-audio-lab/);
});

test("el QR de Star Screen es grande y el preview conserva legibilidad", () => {
  assert.match(playerStyles, /width:clamp\(140px,10vw,210px\)/);
  assert.match(playerStyles, /star-screen-preview[^}]+qr-card img\{width:96px;height:96px\}/);
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
  assert.match(starScreenSource, /Date\.now\(\) - publishedAt/);
  assert.match(starScreenSource, /video\.addEventListener\('loadedmetadata'/);
  assert.doesNotMatch(starScreenSource, /else video\.addEventListener\('loadedmetadata', align/);
});

test("el lanzador web de prueba sigue aislado de la aplicación oficial", () => {
  assert.match(bridgeHtml, /GUEST STAR 4\.4\.0/);
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
  assert.match(appsScriptSource, /requestDuplicateWarning_\(body, publicContext\)/);
  assert.match(appsScriptSource, /String\(row\[18\] \|\| ""\) !== cycleId/);
  assert.match(appsScriptSource, /"Retirada del Player", "Fuera de VirtualDJ"/);
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
  assert.match(hostPanelSource, /GUEST STAR EXPERIENCE 4\.4\.0/);
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
