import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { starScreenPreferences, starScreenRequestData, starScreenSongInformation, starScreenPresentation, starScreenPresentationSignature } from '../public/star-screen-presentation.js';
import { DEFAULT_CONFIG, sanitizeConfig, configForStorage } from '../src/config.mjs';
import { normalizeGuestLanguage, STAR_SCREEN_COPY } from '../public/shared/guest-locales.js';

const request = (id, singer = id) => ({ id, singer, song: 'Song ' + id, artist: 'Artist ' + id });
const state = (count, queue) => ({ displayMode: 'lobby', queue, starScreenPreferences: { starScreenSongSource: 'request', starScreenLineupCount: count } });

test('A: Perry displays exact guest semantics, never the unrelated playback filename; projection cannot mutate source', () => {
  const item = Object.freeze({ id: 'perry', singer: 'Perry', song: "Don't Go Breaking My Heart", artist: 'Elton John & Kiki Dee', filePath: '/Music/Elton_John_Kiki_Dee_KaraFun_Final_v2.mp4' });
  const result = starScreenRequestData(item);
  assert.deepEqual(result.starScreenSongInformation.request, { title: "Don't Go Breaking My Heart", artist: 'Elton John & Kiki Dee' });
  assert.equal(item.filePath, '/Music/Elton_John_Kiki_Dee_KaraFun_Final_v2.mp4');
  assert.equal(result.starScreenSongInformation.local.title, 'Elton John Kiki Dee');
});

test('B: counts 1–5 select the next real requests, excluding current on-stage singer', () => {
  const current = request('luis', 'Luis');
  const queue = [current, ...['Perry', 'Maria', 'John', 'Alex', 'Sarah'].map(request)];
  for (let count = 1; count <= 5; count++) {
    const view = starScreenPresentation({ ...state(count, queue), displayMode: 'karaoke', now: current });
    assert.equal(view.visible.length, count);
    assert.deepEqual(view.visible.map(item => item.id), ['Perry', 'Maria', 'John', 'Alex', 'Sarah'].slice(0, count));
    assert.equal(view.upcoming.length, 5);
  }
});

test('C: five configured with two available renders only two, without fillers or duplicates', () => {
  const view = starScreenPresentation(state(5, [request('Perry'), request('Maria')]));
  assert.deepEqual(view.visible.map(item => item.id), ['Perry', 'Maria']);
  assert.equal(starScreenPresentation(state(5, [])).visible.length, 0);
});

test('D: reorder, add, remove, skip, sung and hidden requests derive immediately from the actual input queue', () => {
  const first = [request('Perry'), request('Maria'), request('John')];
  const second = [first[1], first[0], first[2], request('Alex')];
  assert.deepEqual(starScreenPresentation(state(3, second)).visible.map(item => item.id), ['Maria', 'Perry', 'John']);
  assert.notEqual(starScreenPresentationSignature(state(3, first)), starScreenPresentationSignature(state(3, second)));
  assert.equal(starScreenPresentation(state(5, second)).visible.length, 4);
  assert.equal(starScreenPresentation(state(5, second.slice(1))).visible.length, 3);
  for (const change of [{ status: 'Saltado' }, { status: 'Ya cantó' }, { outcome: 'completed' }, { visibleOnStarScreen: false }]) {
    assert.deepEqual(starScreenPresentation(state(5, [{ ...first[0], ...change }, first[1]])).visible.map(item => item.id), ['Maria']);
  }
});

test('fallback hierarchy, local source and privacy: no paths, extensions or internal identifiers', () => {
  const item = { id: 'internal', song: '/Users/private/file.mp4', artist: 'internal', requestMetadata: { title: 'Clean request', artist: 'Request artist' }, mediaMetadata: { title: 'Tagged title', artist: 'Tagged artist' }, fileName: 'Raw_KaraFun_FINAL_v2.mp4' };
  assert.deepEqual(starScreenSongInformation(item), { title: 'Clean request', artist: 'Request artist' });
  assert.equal(starScreenSongInformation(item, 'local').title, 'Tagged title');
  delete item.requestMetadata;
  assert.equal(starScreenSongInformation(item).title, 'Tagged title');
  delete item.mediaMetadata;
  assert.deepEqual(starScreenSongInformation(item), { title: 'Raw', artist: '' });
  assert.equal(starScreenSongInformation({ id: 'player-local-1234-abcd', song: 'player-local-1234-abcd', artist: 'file:///Users/private/a.mp3' }).title, 'Canción solicitada');
  assert.equal(starScreenSongInformation({ starScreenSongInformation: { request: { title: '/Users/private/file.mp4', artist: 'artist.mp3' } } }).title, 'Canción solicitada');
});

test('F: existing config storage round-trip persists presentation preferences, merges partial updates and rejects invalid counts', () => {
  assert.deepEqual(starScreenPreferences(), {
    starScreenSongSource: 'request',
    starScreenLineupCount: 5,
    showWaveform: true,
    showStarScreenNowPlaying: true,
    showActivityAccess: false
  });
  for (let count = 1; count <= 5; count++) {
    const config = sanitizeConfig({ interfacePreferences: { starScreenSongSource: 'local', starScreenLineupCount: count } }, DEFAULT_CONFIG);
    const reopened = sanitizeConfig(JSON.parse(JSON.stringify(configForStorage(config))), DEFAULT_CONFIG);
    assert.equal(reopened.interfacePreferences.starScreenLineupCount, count);
    assert.equal(reopened.interfacePreferences.starScreenSongSource, 'local');
    assert.equal(sanitizeConfig({ interfacePreferences: { showEq: false } }, reopened).interfacePreferences.starScreenLineupCount, count);
  }
  for (const count of [0, 6, 99, 2.5, null, 'bad']) {
    assert.equal(sanitizeConfig({ interfacePreferences: { starScreenLineupCount: count } }, DEFAULT_CONFIG).interfacePreferences.starScreenLineupCount, 5);
  }
});

test('E: actual Star Screen preference handler updates live DOM without play, pause, load, seek or rate writes', async () => {
  const calls = [];
  const qrPayloads = [];
  const nodes = new Map();
  function node(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} },
      textContent: '', innerHTML: '', src: '', paused: false, readyState: 1, seeking: false,
      addEventListener() {}, removeAttribute() {}, load() { calls.push('load'); },
      pause() { calls.push('pause'); }, play() { calls.push('play'); return Promise.resolve(); }
    });
    return nodes.get(selector);
  }
  const media = node('#starScreenMedia');
  let position = 30, rate = 1;
  Object.defineProperties(media, {
    currentTime: { get: () => position, set: value => { position = value; calls.push('seek'); } },
    playbackRate: { get: () => rate, set: value => { rate = value; calls.push('rate'); } }
  });
  let listener;
  class Channel { addEventListener(type, handler) { if (type === 'message') listener = handler; } postMessage() {} }
  const document = { querySelector: node, body: node('body'), addEventListener() {}, documentElement: {} };
  const window = { innerWidth: 1920, innerHeight: 1080, addEventListener() {}, removeEventListener() {}, clearTimeout() {}, setTimeout() {}, setInterval() {} };
  const source = (await readFile(new URL('../public/star-screen.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
  const execute = new Function('document', 'window', 'location', 'localStorage', 'BroadcastChannel', 'initLobbyWaveform', 'setLocalQrImage', 'starScreenPreferences', 'starScreenPresentation', 'starScreenPresentationSignature', 'installStarScreenCanvas', 'normalizeGuestLanguage', 'STAR_SCREEN_COPY', 'applyBrandingTheme', 'renderBrandLogos', 'lyricsForSnapshot', 'lyricsPlaybackTime', 'timedLyricsLines', 'renderTimedWords', source);
  execute(document, window, { search: '', origin: 'http://127.0.0.1:8787' }, { getItem: () => null }, Channel, () => ({ receive() {}, setScene() {} }), (_, url) => { qrPayloads.push(url); }, starScreenPreferences, starScreenPresentation, starScreenPresentationSignature, () => ({ destroy() {} }), normalizeGuestLanguage, STAR_SCREEN_COPY, ()=>{}, ()=>'', ()=>[], next=>Number(next.currentTime)||0, ()=>({displayCurrent:false,current:'',previous:'',next:''}), ()=>{});
  const now = Date.now();
  const active = { ...request('Luis'), isVideo: true };
  const activityAccess = { pin: '760391', joinUrl: 'https://request.gstarxp.com/join/persistent-token', nextOccurrenceAt: new Date(now + 3 * 86400000).toISOString() };
  listener({ data: { ...state(5, [active, request('Perry'), request('Maria')]), activityAccess, now: active, displayMode: 'karaoke', mediaUrl: '/video.mp4', playing: true, currentTime: 30, tempoPercent: 100, publishedAt: now, sequence: 1 } });
  calls.length = 0;
  for (const count of [1, 2, 3, 4, 5]) {
    listener({ data: { type: 'star-screen-preferences', preferences: {
      starScreenSongSource: 'request',
      starScreenLineupCount: count,
      showWaveform: count !== 1,
      showStarScreenNowPlaying: count !== 1
    }, publishedAt: now + count } });
    assert.equal((node('#starScreenQueue').innerHTML.match(/<li\b/g) || []).length, Math.min(count, 2));
    if (count === 1) {
      assert.doesNotMatch(node('#starScreenQueue').innerHTML, /<b>/);
      assert.match(node('#starScreenQueue').innerHTML, /<strong>Perry<\/strong>/);
      assert.match(node('#starScreenQueue').innerHTML, /<span>SIGUIENTE<\/span>/);
      assert.equal(node('#starScreenNextSinger').textContent, 'Perry');
      assert.equal(node('#starScreenWaveformRegion').hidden, true);
      assert.equal(node('#starScreenNow').hidden, true);
    } else {
      assert.match(node('#starScreenQueue').innerHTML, />01<\/b>/);
      assert.match(node('#starScreenQueue').innerHTML, /<span>EN FILA<\/span>/);
      assert.equal(node('#starScreenWaveformRegion').hidden, false);
      assert.equal(node('#starScreenNow').hidden, false);
    }
    assert.equal(node('#starScreenNowSong').textContent, 'Song Luis');
  }
  listener({ data: { type: 'star-screen-preferences', preferences: { starScreenSongSource: 'local', starScreenLineupCount: 2 }, publishedAt: now + 10 } });
  listener({ data: { type: 'star-screen-preferences', preferences: { showActivityAccess: true }, publishedAt: now + 11 } });
  assert.equal(node('#starScreenActivityAccess').hidden, false);
  assert.equal(node('#starScreenActivityPin').textContent, activityAccess.pin);
  assert.match(node('#starScreenAccessCountdown').textContent, /^\d{2}d : \d{2}h : \d{2}m : \d{2}s$/);
  assert.equal(node('#starScreenAccessTimer').hidden, false);
  assert.ok(qrPayloads.length > 0 && qrPayloads.every(url => url === activityAccess.joinUrl));
  listener({ data: { type: 'star-screen-preferences', preferences: { showActivityAccess: false }, publishedAt: now + 12 } });
  assert.equal(node('#starScreenActivityAccess').hidden, true);
  const html = await readFile(new URL('../public/star-screen.html', import.meta.url), 'utf8');
  const accessMarkup = html.match(/<aside class="star-screen-activity-access"[\s\S]*?<\/aside>/)?.[0] || '';
  assert.match(accessMarkup, /starScreenActivityQr[\s\S]*starScreenActivityPin[\s\S]*starScreenAccessCountdown/);
  assert.doesNotMatch(accessMarkup, /starScreenAccessContext|starScreenAccessNext|SCAN TO JOIN|venue|hotel/i);
  assert.deepEqual(calls, []);
  assert.equal(media.paused, false);
});
