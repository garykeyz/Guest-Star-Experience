import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
const read = path => readFile(new URL(path,import.meta.url),'utf8');
const [host,star,css,native]=await Promise.all([
  read('../public/index.html'),read('../public/star-screen.html'),
  read('../public/adaptive-host.css'),read('../macos/GuestStarNativeHost.m')
]);
test('la capa adaptive pertenece solo al Host, no a la composición pública',()=>{
  assert.equal((host.match(/href="\/adaptive-host.css"/g)||[]).length,1);
  assert.ok(!star.includes('adaptive-host.css'));
  assert.equal((host.match(/id="playerMedia"/g)||[]).length,1);
  assert.equal((host.match(/id="playerBackgroundAudio"/g)||[]).length,1);
  assert.equal((host.match(/id="playerStarScreenPreview"/g)||[]).length,1);
});
test('ventanas estrechas permitidas sin reconstruir el WebView ni cambiar Star Screen',()=>{
  assert.match(native,/self\.mainWindow\.minSize = NSMakeSize\(320, 260\)/);
  assert.match(native,/self\.starWindow\.minSize = NSMakeSize\(800, 450\)/);
  assert.match(native,/self\.mainWebView\.autoresizingMask = NSViewWidthSizable \| NSViewHeightSizable/);
});
test('layout local por containers, scroll natural y Preview proporcional',()=>{
  assert.match(css,/@container performance \(max-width: 700px\)/);
  assert.match(css,/@container performance \(max-width: 430px\)/);
  assert.match(css,/@container rail \(max-width: 400px\)/);
  assert.match(css,/aspect-ratio: 16 \/ 9 !important/);
  assert.match(css,/height: auto; min-height: 0; max-height: none/);
  assert.match(css,/\.player-plan-b-card:not\(\[open\]\) > \.player-plan-b-content \{ display: none; \}/);
  assert.doesNotMatch(css,/#playerMedia\s*\{[^}]*display:\s*none/);
  assert.ok(!css.includes('content-visibility'));
});
test('safe zone real, scroll interno y etiquetas del mismo botón sin lógica de resize',async()=>{
  const presentation=await read('../public/adaptive-host.js');
  assert.match(css,/--host-safe-space: clamp\(8px, 1vw, 16px\)/);
  assert.match(css,/scroll-padding: 8px/);
  assert.match(presentation,/setAttribute\('aria-label', text\)/);
  assert.match(presentation,/button.title = title/);
  assert.ok(!/addEventListener|ResizeObserver|AudioContext|\.play\(|\.pause\(|innerHTML|replaceChildren/.test(presentation));
  const app=await read('../public/app.js');
  assert.equal((app.match(/await import\('\.\/adaptive-host\.js'\)/g)||[]).length,1);
  assert.match(app,/async function mountWorkspace/);
});
test('consola solo Host: búsqueda prioritaria y acciones movidas sin duplicación',async()=>{
  const consoleCSS=await read('../public/host-console.css');
  const presentation=await read('../public/adaptive-host.js');
  assert.equal((host.match(/href="\/host-console.css"/g)||[]).length,1);
  assert.ok(!star.includes('host-console.css'));
  for(const id of ['playerOpenStarScreen','playerHistoryBadge','playerQueueCount','playerPlay','playerTempo','playerKeyShiftValue']) assert.equal((host.match(new RegExp(`id="${id}"`,'g'))||[]).length,1);
  const toolbar=host.slice(host.indexOf('<section class="player-activity-toolbar">'),host.indexOf('<section class="player-library-card'));
  assert.ok(toolbar.includes('data-player-drawer="summary"')&&toolbar.includes('data-player-drawer="history"')&&toolbar.includes('id="playerOpenStarScreen"'));
  assert.ok(toolbar.includes('player-critical-actions')&&toolbar.includes('player-secondary-actions')&&toolbar.includes('player-toolbar-metrics'));
  assert.match(consoleCSS,/grid-template-areas: "identity critical" "summary summary" "search secondary"/);
  assert.match(consoleCSS,/width: 32px; height: 32px/);
  assert.match(consoleCSS,/mask: var\(--console-icon\) center \/ contain no-repeat/);
  assert.match(presentation,/\['#playerPlay','play'\]/);
  assert.ok(!/[🎤🔊🔒📁]/u.test(consoleCSS));
  assert.ok(!/\['#playerPrimaryActivity'/.test(presentation));
});
test('Audio Mixer unifica solo la presentación y conserva decks independientes',async()=>{
  const consoleCSS=await read('../public/host-console.css');
  assert.equal((host.match(/class="player-audio-mixer-console"/g)||[]).length,1);
  const mixer=host.slice(host.indexOf('<section class="player-audio-mixer-console"'),host.indexOf('<aside class="player-side-rail"'));
  for(const id of ['playerBpmValue','playerTempo','playerTempoLock','playerKeyValue','playerKeyShiftValue','playerEqLow','playerEqMid','playerEqHigh','playerVocalLevel','playerBackgroundAudio','playerBackgroundBpmValue','playerBackgroundTempo','playerBackgroundTempoLock','playerBackgroundVolume']) {
    assert.equal((host.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,`${id} debe conservar una sola instancia`);
  }
  assert.ok(mixer.includes('player-musical-controls')&&mixer.includes('player-live-mixer')&&mixer.includes('player-background-live'));
  assert.match(host,/for="playerTempoLock" title="Bloquear tempo del karaoke"/);
  assert.match(host,/for="playerBackgroundTempoLock" title="Bloquear tempo de la música de fondo"/);
  assert.match(consoleCSS,/player-audio-mixer-console/);
  assert.match(consoleCSS,/\.player-audio-mixer-console\s*\{[^}]*display:\s*grid/);
  assert.match(consoleCSS,/@container performance \(max-width: 400px\)/);
});
test('Resumen usa los mismos valores en una franja inline desplegada por defecto',async()=>{
  const [consoleCSS,presentation,player]=await Promise.all([
    read('../public/host-console.css'),read('../public/adaptive-host.js'),read('../public/player-beta.js')
  ]);
  assert.equal((host.match(/id="playerSummaryInline"/g)||[]).length,1);
  assert.ok(!host.includes('data-player-drawer-panel="summary"'));
  const toolbar=host.slice(host.indexOf('<section class="player-activity-toolbar">'),host.indexOf('<section class="player-library-card'));
  assert.ok(toolbar.indexOf('id="playerSummaryInline"') < toolbar.indexOf('class="player-direct-search"'));
  for(const id of ['playerLibraryMetric','playerRequestsMetric','playerEngineMetric','playerActivityMetric','playerElapsedTime','playerConfirmedTime','playerPlannedTime','playerCoverageTime','playerEventEndTime']) {
    assert.equal((host.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,`${id} debe seguir siendo la fuente visual única`);
  }
  assert.match(host,/class="player-summary-inline is-expanded"/);
  assert.match(host,/data-player-drawer="summary" aria-controls="playerSummaryInline" aria-expanded="true"/);
  assert.match(consoleCSS,/grid-template-areas: "identity critical" "summary summary" "search secondary"/);
  assert.match(consoleCSS,/player-summary-inline\.is-expanded \{ display: flex; \}/);
  assert.match(consoleCSS,/overflow-x: auto; overflow-y: hidden/);
  assert.match(player,/if \(name === 'summary'\) \{[\s\S]*setInlineSummaryExpanded/);
  assert.match(player,/if \(previousActivity !== activityId\(\)\) \{[^}]*setInlineSummaryExpanded\(true\)/);
  assert.match(presentation,/detail\.dataset\.compactValue/);
});
