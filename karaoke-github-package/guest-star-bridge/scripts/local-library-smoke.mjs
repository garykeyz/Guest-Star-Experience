// Isolated browser audit: actual library markup/functions, synthetic index, real WAV.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { queryIndexedLibrary } from '../src/local-library-view.mjs';
import { libraryFixtureHtml, libraryFixtureModule } from '../test/helpers/local-library-fixture.mjs';
const require = createRequire(import.meta.url);
const queued = [];
const wav = Buffer.alloc(44 + 60 * 22050 * 2);
wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(22050, 24); wav.writeUInt32LE(44100, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
wav.write('data', 36); wav.writeUInt32LE(wav.length - 44, 40);
for (let i = 44; i < wav.length; i += 2) wav.writeInt16LE(Math.round(Math.sin((i - 44) / 2 / 22050 * 2 * Math.PI * 220) * 300), i);
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const json = data => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(data)); };
  if (url.pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(libraryFixtureHtml()); return; }
  if (url.pathname === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(libraryFixtureModule()); return; }
  if (url.pathname === '/playing.wav') { res.setHeader('Content-Type', 'audio/wav'); res.end(wav); return; }
  if (url.pathname === '/api/player/library') {
    const rows = Array.from({length: Number(url.searchParams.get('size'))}, (_, i) => ({id: String(i), name: 'raw_' + i, song: 'Canción ' + i, artist: i % 2 ? 'Ana' : 'Zeta', channel: 'Canal limpio', language: i % 2 ? 'English' : 'Spanish', durationSeconds: 187, mediaType: 'video/mp4', extension: 'MP4'}));
    json(queryIndexedLibrary(rows.map(row => '/index/' + row.id + '.mp4'), path => rows[Number(path.split('/').pop().replace('.mp4', ''))], url.searchParams.get('query'), {includeAll: true, offset: Number(url.searchParams.get('offset')), limit: Number(url.searchParams.get('limit')), sort: url.searchParams.get('sort'), language: url.searchParams.get('language')})); return;
  }
  if (url.pathname === '/api/player/local-requests') {
    let body = ''; for await (const part of req) body += part;
    queued.push({...JSON.parse(body), id: 'B'}); json({ok: true, item: queued.at(-1)}); return;
  }
  if (url.pathname === '/api/state') { json({requests: queued}); return; }
  if (/^\/[\w-]+\.(css|js)$/.test(url.pathname)) {
    try { res.setHeader('Content-Type', url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript'); res.end(await readFile(new URL('../public' + url.pathname, import.meta.url))); return; } catch {}
  }
  res.writeHead(404); res.end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  if (process.env.GUEST_STAR_LIBRARY_PREVIEW) {
    console.log(`Library preview: http://127.0.0.1:${server.address().port}`);
    await new Promise(() => {});
  }
  const playwright = require(process.env.GUEST_STAR_PLAYWRIGHT_PATH || 'playwright');
  const engine = process.env.GUEST_STAR_BROWSER || 'chromium';
  browser = await playwright[engine].launch({headless: true, ...(process.env.GUEST_STAR_BROWSER_EXECUTABLE ? {executablePath: process.env.GUEST_STAR_BROWSER_EXECUTABLE} : {})});
  const page = await browser.newPage({viewport: {width: 1100, height: 800}});
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`); await page.waitForFunction(() => window.fixture);
  await page.click('#start'); await page.waitForFunction(() => window.initialPlayback);
  await page.fill('#playerDirectSearch', 'Búsqueda anterior');
  await page.click('#playerLibraryBrowse'); await page.waitForSelector('[data-library-track]');
  assert.equal(await page.inputValue('#playerDirectSearch'), '');
  assert.equal(await page.locator('[data-library-track]').count(), 60);
  assert.match(await page.textContent('#playerLibraryCount'), /60 de 127/);
  assert.match(await page.locator('[data-library-track]').first().textContent(), /Canal limpio.*0:03:07.*Spanish.*Local/);
  assert.ok(await page.locator('[data-library-track]').first().evaluate(el => el.getBoundingClientRect().height <= 60));
  for (let i = 0; i < 6; i++) { await page.click('#playerLibraryClose'); await page.click('#playerLibraryBrowse'); }
  assert.equal(await page.evaluate(() => window.reads), 1, 'reopening reuses existing results');
  assert.equal(await page.inputValue('#playerDirectSearch'), '');
  await page.click('#playerLibraryMore'); await page.waitForFunction(() => document.querySelectorAll('[data-library-track]').length === 120);
  await page.click('#playerLibraryMore'); await page.waitForFunction(() => document.querySelectorAll('[data-library-track]').length === 127);
  await page.fill('#playerDirectSearch', 'cancion 12'); await page.waitForFunction(() => document.querySelector('#playerLibraryCount').textContent === '9 de 9 pistas');
  // Older search must not overwrite newer query/filters.
  await page.evaluate(() => { window.delay = 400; document.querySelector('#playerDirectSearch').value = 'Canción 2'; void window.fixture.searchLibrary(); });
  await page.evaluate(() => { window.delay = 0; document.querySelector('#playerDirectSearch').value = 'Canción 126'; void window.fixture.searchLibrary(); });
  await page.waitForFunction(() => document.querySelectorAll('[data-library-track]').length === 1 && document.querySelector('[data-library-track] strong').textContent === 'Canción 126');
  await page.waitForTimeout(450);
  assert.equal(await page.locator('[data-library-track] strong').textContent(), 'Canción 126');
  await page.locator('[data-library-track]').click(); await page.fill('#playerAssignSinger', 'Biblioteca B'); await page.locator('#playerAssignSingerForm button[type="submit"]').click();
  await page.waitForFunction(() => window.fixture.state.requests.length === 1);
  assert.deepEqual(await page.evaluate(() => window.writes), [{url: '/api/player/local-requests', body: {trackId: '126', singer: 'Biblioteca B'}}]);
  await page.fill('#playerDirectSearch', ''); await page.waitForFunction(() => document.querySelector('#playerLibraryCount').textContent === '60 de 127 pistas');
  await page.evaluate(() => {window.size = 0; return window.fixture.searchLibrary();}); assert.match(await page.textContent('#playerLibraryList'), /biblioteca está vacía/);
  await page.evaluate(() => {window.size = 1; return window.fixture.searchLibrary();}); assert.equal(await page.locator('[data-library-track]').count(), 1);
  await page.fill('#playerDirectSearch', 'no existe'); await page.waitForFunction(() => document.querySelector('#playerLibraryList').textContent.includes('No hay coincidencias'));
  await page.press('#playerDirectSearch', 'Escape'); assert.equal(await page.locator('#playerLocalLibrary').isVisible(), false);
  const active = await page.evaluate(() => ({paused: document.querySelector('#playing').paused, time: document.querySelector('#playing').currentTime, src: document.querySelector('#playing').currentSrc, initial: window.initialPlayback, id: window.currentId, forbidden: window.forbidden}));
  assert.equal(active.paused, false); assert.equal(active.src, active.initial.src); assert.ok(active.time > active.initial.time); assert.equal(active.id, 'A'); assert.deepEqual(active.forbidden, []); assert.deepEqual(errors, []);
  console.log(JSON.stringify({engine, passed: true, activeId: active.id, elapsed: active.time - active.initial.time, forbidden: active.forbidden, queued: queued.length}));
} finally { await browser?.close(); server.close(); }
