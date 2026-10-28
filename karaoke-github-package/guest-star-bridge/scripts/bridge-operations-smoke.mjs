// Isolated headless UI regression: no installed app, cloud or real VDJ writes.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const playwright = require(process.env.GUEST_STAR_PLAYWRIGHT_PATH || 'playwright');
const output = process.env.GUEST_STAR_AUDIT_OUTPUT || '/tmp/guest-star-bridge-ui-audit';
await mkdir(output, { recursive: true });
const state = await fetch('http://127.0.0.1:8787/api/state').then(response => response.json());
state.operatingMode = { selected: 'bridge', locked: true, canChange: false };
state.account.user = { role: 'host', displayName: 'Fixture Host', mustChangePassword: false };
state.activity.activityRunning = true; state.activity.playbackMode = 'bridge'; state.activity.lastSource = 'bridge';
state.tenant.activity.status = 'in_progress';
state.config.backgroundMusicSources = []; state.config.backgroundMusicAutoplay = false;
state.tenant.branding = {}; state.tenant.share = {}; state.hitSuggestions = [];
state.playerRuntime = { queueOrder: [], playback: { scene: 'lobby', wasPlaying: false, currentRequestId: '', currentTimeSeconds: 0 } };
state.requests = [1, 2, 3].map(id => ({ id: `fixture-${id}`, timestamp: `2026-09-18T01:0${id}:00Z`,
  singer: `Participant ${id}`, song: `Title ${id} with long visible metadata`, artist: `Artist ${id}`,
  status: 'Agregada a VirtualDJ', stateRevision: 1, administrativePosition: id, queued: true,
  localState: 'queued', outcome: '', queuePosition: id, queuedFilePath: `/fixture/${id}.wav`,
  durationSeconds: 120, transitionSeconds: 30, matches: [], youtube: [], sourceType: 'public_request' }));
const rebindFiles = ['Adele - Hello A.mp4', 'Adele - Hello B.mp4', 'Adele - Hello C.mp4'];
Object.assign(state.requests[0], {
  linkedFilePath: `/fixture/${rebindFiles[0]}`,
  linkedFileName: rebindFiles[0],
  linkSource: 'automatic',
  manualLink: false,
  matches: rebindFiles.map((fileName, index) => ({
    filePath: `/fixture/${fileName}`,
    fileName,
    score: 1 - index * .05,
    confidencePercent: 100 - index * 5,
    confidenceTier: index ? 'high' : 'very-high',
    exact: true,
    ambiguous: false
  })),
  youtube: [{
    url: 'https://www.youtube.com/watch?v=fixture123',
    title: 'Adele - Hello Karaoke Lyrics',
    channel: 'Fixture Karaoke',
    durationSeconds: 120,
    resultType: 'karaoke',
    localMatch: { filePath: `/fixture/${rebindFiles[0]}`, fileName: rebindFiles[0], confidencePercent: 100, confidenceTier: 'very-high' }
  }]
});
state.virtualDJ = { ...state.virtualDJ, connected: true, queueVerified: true, queueCount: 3,
  playback: { connected: true, selectedDeck: 1, masterVolume: .75,
    decks: [{ deck: 1, loaded: true, playing: false, filePath: '/fixture/1.wav', played: false, cue: null }] },
  entries: state.requests.map((item, index) => ({ index, singer: item.singer, song: item.song, artist: item.artist,
    filePath: item.queuedFilePath, linkedRequestId: item.id, virtualDJItemId: `physical-${index}`, durationSeconds: 120 })) };
const commands = []; const errors = [];
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://fixture');
  if (url.pathname === '/api/events') { response.writeHead(200, { 'Content-Type': 'text/event-stream' }); response.write(': fixture\n\n'); return; }
  if (url.pathname.startsWith('/api/')) {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
    if (request.method === 'POST') commands.push({ path: url.pathname, body });
    const id = url.pathname.match(/\/requests\/([^/]+)/)?.[1]; const item = state.requests.find(value => value.id === id);
    if (url.pathname.endsWith('/link')) {
      Object.assign(item, { linkedFilePath: body.filePath, linkedFileName: body.filePath.split('/').at(-1), linkSource: 'manual', manualLink: true, sourceUrl: '' });
    } else if (url.pathname.endsWith('/unlink')) {
      Object.assign(item, { linkedFilePath: '', linkedFileName: '', linkSource: '', manualLink: false });
    } else if (url.pathname.endsWith('/youtube/copy')) {
      Object.assign(item, { linkedFilePath: '', linkedFileName: '', linkSource: '', manualLink: false, sourceUrl: body.url });
    } else if (url.pathname.endsWith('/metadata')) {
      Object.assign(item, { singer: body.singer, song: body.song, artist: body.artist, stateRevision: item.stateRevision + 1 });
    } else if (url.pathname.endsWith('/move')) {
      // A request arriving during a move must not be lost by a client array.
      if (!state.requests.some(value => value.id === 'fixture-new')) state.requests.push({ ...state.requests[0], id: 'fixture-new', administrativePosition: 4, queuePosition: 4 });
      const order = [...state.requests].sort((a, b) => a.administrativePosition - b.administrativePosition).filter(value => value !== item);
      const at = body.beforeId === null ? order.length : order.findIndex(value => value.id === body.beforeId);
      order.splice(at, 0, item); order.forEach((value, index) => value.administrativePosition = index + 1);
    } else if (url.pathname === '/api/virtualdj/control') {
      if (body.action === 'volume') state.virtualDJ.playback.masterVolume = body.volume;
      else state.virtualDJ.playback.decks[0].playing = body.action === 'play';
    } else if (url.pathname.endsWith('/outcome')) {
      item.outcome = body.outcome; item.localState = body.outcome; item.queued = false; item.canUndo = true;
    } else if (url.pathname.endsWith('/undo-outcome')) { item.outcome = ''; item.localState = 'queued'; item.queued = true; }
    const result = url.pathname === '/api/state' ? state : url.pathname === '/api/virtualdj/control'
      ? { ok: true, playback: state.virtualDJ.playback } : { ok: true };
    response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify(result)); return;
  }
  if (url.pathname === '/') url.pathname = '/index.html';
  if (!/^\/[\w.-]+$/.test(url.pathname)) { response.writeHead(404); response.end(); return; }
  try {
    const data = await readFile(new URL('../public' + url.pathname, import.meta.url));
    response.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : url.pathname.endsWith('.css') ? 'text/css' : 'text/html'); response.end(data);
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await playwright[process.env.GUEST_STAR_BROWSER || 'webkit'].launch({
    headless: true,
    ...(process.env.GUEST_STAR_BROWSER_EXECUTABLE
      ? { executablePath: process.env.GUEST_STAR_BROWSER_EXECUTABLE }
      : {})
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1600 } });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForSelector('[data-bridge-row="admin:fixture-1"]', { state: 'attached' });
  await page.screenshot({ path: `${output}/initial.png`, fullPage: true });
  const button = name => page.locator(`#bridgeOperations button[aria-label*="${name}"]`);
  await button('Reproducir').click(); await page.waitForFunction(() => document.querySelector('#bridgeOperations button').title.includes('Pausar'));
  await button('Pausar').click(); await page.waitForFunction(() => document.querySelector('#bridgeOperations button').title.includes('Reproducir'));
  assert.deepEqual(commands.filter(value => value.path === '/api/virtualdj/control').map(value => value.body.action), ['play', 'pause']);
  const initialVolumeCommands = commands.length;
  await page.locator('#bridgeMasterVolume').evaluate(slider => { for (let i = 10; i <= 42; i++) { slider.value = i; slider.dispatchEvent(new Event('input')); } slider.dispatchEvent(new Event('change')); });
  await page.waitForTimeout(250);
  assert.equal(commands.length - initialVolumeCommands, 1, 'slider is throttled and programmatic readback does not echo');
  assert.equal(commands.at(-1).body.volume, .42);
  assert.equal(await page.locator('#bridgeOperations output').textContent(), '42%');
  await page.locator('[data-bridge-row="admin:fixture-2"] button[aria-label*="arriba"]').click();
  await page.waitForFunction(() => document.querySelector('[data-bridge-row^="admin:"]').dataset.bridgeRow === 'admin:fixture-2');
  assert.equal(await page.locator('[data-bridge-row^="admin:"]').count(), 4, 'arrival preserved');
  await page.waitForTimeout(50); // allow the successful operation's finally block to release its lock
  await page.locator('#requests .request-list').first().evaluate(element => { element.style.maxHeight = 'none'; element.style.overflow = 'visible'; });
  const dragCommandCount = commands.filter(value => value.path.endsWith('/move')).length;
  const source = await page.locator('[data-bridge-row="admin:fixture-3"] [data-bridge-drag]').boundingBox();
  const destination = await page.locator('[data-bridge-row="admin:fixture-new"]').boundingBox();
  await page.mouse.move(source.x + 8, source.y + 8); await page.mouse.down();
  await page.mouse.move(destination.x + 8, destination.y + destination.height - 2, { steps: 10 });
  assert.equal(await page.locator('.bridge-drag-source').getAttribute('data-bridge-row'), 'admin:fixture-3');
  await page.waitForFunction(() => document.querySelector('#requests').classList.contains('bridge-drop-end'));
  await page.mouse.up();
  await page.waitForTimeout(500);
  assert.equal(commands.filter(value => value.path.endsWith('/move')).length, dragCommandCount + 1, 'pointer drag commits exactly one stable-ID move');
  assert.equal(state.requests.find(value => value.id === 'fixture-3').administrativePosition, 4);
  await page.locator('#requests .request-list').first().evaluate(element => {
    element.style.maxHeight = '';
    element.style.overflow = '';
  });
  await page.locator('[data-request-id="fixture-1"] button[aria-label*="Editar"]').click();
  await page.locator('[data-bridge-request="fixture-1"][data-bridge-field="singer"]').fill('Edited Participant');
  await page.locator('[data-bridge-request="fixture-1"][data-bridge-field="song"]').fill('Edited Title');
  await page.locator('[data-bridge-request="fixture-1"][data-bridge-field="artist"]').fill('Edited Artist');
  await page.locator('[data-request-id="fixture-1"] .bridge-metadata-form button').first().click();
  await page.waitForFunction(() => document.querySelector('[data-request-id="fixture-1"] .song').textContent === 'Edited Title');
  const linkCandidate = async fileName => {
    const card = page.locator('[data-request-id="fixture-1"]');
    await card.locator('.request-details').evaluate(element => { element.open = true; element.dispatchEvent(new Event('toggle')); });
    await card.locator('.change-link-panel').evaluate(element => { element.open = true; });
    await card.locator('.candidate').filter({ hasText: fileName }).getByRole('button', { name: 'Link Only' }).click();
    await page.waitForFunction(expected => document.querySelector('[data-request-id="fixture-1"]')?.textContent.includes('Manual local link protected') &&
      !document.querySelector('[data-request-id="fixture-1"] .change-link-panel')?.textContent.includes(expected), fileName);
  };
  await linkCandidate(rebindFiles[1]);
  assert.equal(state.requests[0].linkedFileName, rebindFiles[1], 'automatic → manual link is explicit');
  await linkCandidate(rebindFiles[2]);
  assert.equal(state.requests[0].linkedFileName, rebindFiles[2], 'B → C rebind persists');
  await linkCandidate(rebindFiles[0]);
  assert.equal(state.requests[0].linkedFileName, rebindFiles[0], 'C → A rebind persists');
  await page.locator('[data-request-id="fixture-1"] .queue-actions').getByRole('button', { name: 'Unlink Local File' }).click();
  await page.waitForFunction(() => !document.querySelector('[data-request-id="fixture-1"]')?.textContent.includes('Manual local link protected'));
  assert.equal(state.requests[0].linkedFilePath, '', 'unlink keeps request while clearing association');
  await page.evaluate(async url => {
    await fetch('/api/requests/fixture-1/youtube/copy', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
  }, state.requests[0].youtube[0].url);
  assert.match(state.requests[0].sourceUrl, /youtube\.com/, 'local → YouTube clears local link and keeps selected source');
  await linkCandidate(rebindFiles[1]);
  assert.equal(state.requests[0].sourceUrl, '', 'YouTube → local clears the previous source URL');
  const actionCount = commands.length;
  const layouts = [];
  const viewports = [[1920,1080],[1440,900],[1280,720],[1024,640],[820,600],[700,500],[600,460],[500,420],[400,380],
    [640,420], /* ~1/3 */ [480,400], /* ~1/4 */ [320,320]]; /* compactación extrema */
  for (const [width, height] of viewports) {
    await page.setViewportSize({ width, height });
    const overflow = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: innerWidth,
      buttons: [...document.querySelectorAll('#bridgeOperations button, #bridgeOperations select, #bridgeMasterVolume')].map(element => {
        const rect = element.getBoundingClientRect(); return { title: element.title || element.id, left: rect.left, right: rect.right, width: rect.width, height: rect.height };
      }), bridge: (() => {
        const rect = document.querySelector('#bridgeOperations').getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      })(), requestButtons: [...document.querySelectorAll('[data-request-id="fixture-1"] .bridge-icon-action')]
        .filter(element => element.offsetParent !== null).map(element => {
          const rect = element.getBoundingClientRect();
          return { aria: element.getAttribute('aria-label'), title: element.title, left: rect.left, right: rect.right, width: rect.width, height: rect.height };
        }), requestCard: (() => {
        const card = document.querySelector('#requests .request-card');
        if (!card) return null;
        const rect = card.getBoundingClientRect();
        return { top: rect.top, width: rect.width, height: rect.height, display: getComputedStyle(card).display };
      })(), metadataTitles: [...document.querySelectorAll('[data-request-id="fixture-1"] .singer-name, [data-request-id="fixture-1"] .song, [data-request-id="fixture-1"] .artist')]
        .map(element => ({ text: element.textContent.trim(), title: element.title })) }));
    assert.ok(overflow.width <= width + 1, `${width}: document overflow ${JSON.stringify(overflow)}`);
    assert.ok(overflow.bridge.left >= 8 && overflow.bridge.right <= width - 8, `${width}: Bridge safe zone lost ${JSON.stringify(overflow)}`);
    assert.ok(overflow.buttons.every(value => value.left >= 8 && value.right <= width - 8 && value.width >= 20 && value.height >= 16), `${width}: inaccessible toolbar ${JSON.stringify(overflow)}`);
    assert.ok(overflow.requestButtons.length >= 5 && overflow.requestButtons.every(value => value.left >= 8 && value.right <= width - 8 && value.width >= 20 && value.height >= 16 && value.aria && value.title),
      `${width}: inaccessible or unlabeled request action ${JSON.stringify(overflow)}`);
    assert.ok(overflow.metadataTitles.length === 3 && overflow.metadataTitles.every(value => value.text && value.title === value.text),
      `${width}: truncated metadata has no full-value tooltip ${JSON.stringify(overflow)}`);
    assert.ok(overflow.requestCard && overflow.requestCard.width >= 40 && overflow.requestCard.height >= 40,
      `${width}: administrative request card is not laid out ${JSON.stringify(overflow)}`);
    layouts.push({ width, requestCard: overflow.requestCard });
    await page.locator('#bridgeOperations').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${output}/bridge-${width}.png`, fullPage: true });
    if ([1024, 600, 500, 400, 320].includes(width)) {
      await page.locator('#requests .request-card').first().screenshot({ path: `${output}/bridge-${width}-request.png` });
    }
  }
  assert.equal(commands.length, actionCount, 'responsive redraw must never issue playback commands');
  const resizeSequence = [
    [320, 360], [1920, 1080], [480, 420], [1440, 800], [640, 500],
    [1280, 720], [400, 380], [1024, 640], [500, 420], [820, 600]
  ];
  const resizeFrames = [];
  for (const [width, height] of resizeSequence) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const frame = await page.evaluate(() => {
      const strip = document.querySelector('.operations-summary-strip');
      const stripRect = strip.getBoundingClientRect();
      const summaryItems = [...strip.querySelectorAll('.status-card, .time-card, .event-reminder')]
        .filter(element => element.offsetParent !== null)
        .map(element => {
          const rect = element.getBoundingClientRect();
          return { top: rect.top, bottom: rect.bottom, title: element.title };
        });
      const verticalLabels = [...document.querySelectorAll('button, .button')]
        .filter(element => element.offsetParent !== null && element.textContent.trim().length > 1)
        .filter(element => {
          const style = getComputedStyle(element);
          return style.whiteSpace === 'normal' || style.overflowWrap === 'anywhere' || style.wordBreak === 'break-all';
        })
        .map(element => element.textContent.trim().slice(0, 60));
      return {
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: innerWidth,
        strip: { height: stripRect.height, scrollWidth: strip.scrollWidth, clientWidth: strip.clientWidth },
        summaryItems,
        verticalLabels
      };
    });
    assert.ok(frame.documentWidth <= width + 1, `${width}: rapid resize caused page overflow ${JSON.stringify(frame)}`);
    assert.ok(frame.strip.height <= 42, `${width}: summary stopped being one compact row ${JSON.stringify(frame)}`);
    assert.ok(frame.summaryItems.length === 9, `${width}: summary lost a metric ${JSON.stringify(frame)}`);
    assert.ok(Math.max(...frame.summaryItems.map(item => item.top)) - Math.min(...frame.summaryItems.map(item => item.top)) <= 1,
      `${width}: summary wrapped into multiple rows ${JSON.stringify(frame)}`);
    assert.ok(frame.summaryItems.every(item => item.title), `${width}: compact summary lost full-detail tooltips ${JSON.stringify(frame)}`);
    assert.deepEqual(frame.verticalLabels, [], `${width}: button label can render vertically ${JSON.stringify(frame)}`);
    resizeFrames.push({ width, strip: frame.strip });
  }
  assert.equal(commands.length, actionCount, 'rapid resizing must not issue commands or wait on timers');
  state.virtualDJ.playback.connected = false;
  await page.reload(); await page.waitForSelector('[data-bridge-row="admin:fixture-1"]');
  assert.ok(await button('Reproducir').isDisabled());
  assert.ok(await page.locator('[data-bridge-row="admin:fixture-1"] button[aria-label*="arriba"]').isEnabled(), 'Guest Star reorder remains enabled offline');
  assert.ok(await page.locator('[data-request-id="fixture-1"] button[aria-label*="Editar"]').isEnabled());
  await page.locator('[data-request-id="fixture-1"] button[aria-label*="Eliminar"]').click();
  await page.waitForSelector('[data-request-id="fixture-1"] .outcome-summary', { state: 'attached' });
  assert.match(await page.locator('[data-request-id="fixture-1"] .outcome-summary').textContent(), /removed|eliminada/i);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, engine: process.env.GUEST_STAR_BROWSER || 'webkit', widths: viewports.length, rapidResizeFrames: resizeFrames.length, commands: commands.length, errors, layouts, resizeFrames, screenshots: output }));
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
