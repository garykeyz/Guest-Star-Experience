import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createTimedLyricsController, lyricsForSelection, lyricsForSnapshot, lyricsPlaybackTime, normalizeTimedLyrics, timedLyricsLines, renderTimedWords } from '../public/shared/timed-lyrics.js';
import { starScreenPreferences, starScreenPresentation, starScreenPresentationSignature } from '../public/star-screen-presentation.js';
import { normalizeGuestLanguage, STAR_SCREEN_COPY } from '../public/shared/guest-locales.js';

const ready = (sourceKey, text = 'Primera línea') => ({ status: 'ready', sourceKey, segments: [{ start: 1, end: 3, text }, { start: 4, end: 6, text: 'Segunda línea' }] });
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('las líneas siguen pausa, saltos hacia atrás, huecos y final', () => {
  const segments = normalizeTimedLyrics(ready('a')).segments;
  assert.equal(timedLyricsLines(segments, 0).current, '');
  assert.equal(timedLyricsLines(segments, 1).current, 'Primera línea');
  assert.equal(timedLyricsLines(segments, 3).current, '');
  assert.equal(timedLyricsLines(segments, 4.5).current, 'Segunda línea');
  assert.equal(timedLyricsLines(segments, 1.5).current, 'Primera línea');
  assert.equal(timedLyricsLines(segments, 6).current, '');
  const paused = { playing: false, currentTime: 1.5, publishedAt: 1000, duration: 10, tempoPercent: 150 };
  assert.equal(lyricsPlaybackTime(paused, 5000), 1.5);
  assert.equal(lyricsPlaybackTime({ ...paused, playing: true }, 3000), 4.5);
  assert.equal(lyricsPlaybackTime({ ...paused, playing: true, tempoPercent: 50 }, 3000), 2.5);
  assert.equal(lyricsPlaybackTime({ ...paused, playing: true }, 30000), 10);
});

test('Star Screen nunca muestra letras de otra pista, fuente o escena', () => {
  const snapshot = { displayMode: 'karaoke', currentId: 'a', mediaUrl: '/media/a', lyrics: { ...ready('fingerprint-a'), currentId: 'a', mediaUrl: '/media/a', enabled: true } };
  assert.equal(lyricsForSnapshot(snapshot).length, 2);
  for (const changed of [{ currentId: 'b' }, { mediaUrl: '/media/b' }, { displayMode: 'lobby' }, { lyrics: { ...snapshot.lyrics, enabled: false } }, { lyrics: { ...snapshot.lyrics, status: 'transcribing' } }]) {
    assert.deepEqual(lyricsForSnapshot({ ...snapshot, ...changed }), []);
  }
});

test('publicar antes de renderizar una selección nueva no relabela letras antiguas', () => {
  const lyrics = ready('a');
  assert.equal(lyricsForSelection(lyrics, 'a|file-a', 'a|file-a'), lyrics);
  assert.deepEqual(lyricsForSelection(lyrics, 'a|file-a', 'b|file-b'), { status: 'idle', segments: [] });
  assert.deepEqual(lyricsForSelection(lyrics, 'a|file-a', 'a|replacement-file'), { status: 'idle', segments: [] });
  assert.deepEqual(lyricsForSelection(lyrics, '', ''), { status: 'idle', segments: [] });
});

test('cambiar canción invalida respuestas lentas y borra la letra anterior inmediatamente', async () => {
  const first = deferred();
  const second = deferred();
  const calls = [];
  const controller = createTimedLyricsController({ request: (url) => { calls.push(url); return calls.length === 1 ? first.promise : second.promise; } });
  controller.select({ id: 'a', source: 'audio-a' });
  controller.select({ id: 'b', source: 'audio-b' });
  assert.equal(controller.value.status, 'preparing');
  assert.deepEqual(controller.value.segments, []);
  second.resolve(ready('b', 'Canción B'));
  await tick();
  first.resolve(ready('a', 'Canción A'));
  await tick();
  assert.equal(controller.value.sourceKey, 'b');
  assert.equal(controller.value.segments[0].text, 'Canción B');
  controller.destroy();
});

test('reemplazar fuente con el mismo id también invalida respuestas pendientes', async () => {
  const first = deferred();
  let count = 0;
  const controller = createTimedLyricsController({ request: () => ++count === 1 ? first.promise : Promise.resolve(ready('new-source')) });
  controller.select({ id: 'same', source: 'old-file.mp3' });
  controller.select({ id: 'same', source: 'new-file.mp3' });
  await tick();
  first.resolve(ready('old-source'));
  await tick();
  assert.equal(controller.value.sourceKey, 'new-source');
  controller.destroy();
});

test('audio sin cache comienza una vez; video espera una acción explícita', async () => {
  const calls = [];
  const controller = createTimedLyricsController({ request: async (url, options) => { calls.push({ url, ...options }); return { status: 'idle' }; } });
  controller.select({ id: 'audio', source: 'a.mp3', autoAnalyze: true });
  await tick();
  assert.deepEqual(calls.map(call => call.method || 'GET'), ['GET', 'POST']);
  controller.select({ id: 'video', source: 'v.mp4', autoAnalyze: false });
  await tick();
  assert.deepEqual(calls.map(call => call.method || 'GET'), ['GET', 'POST', 'GET']);
  await controller.start();
  assert.equal(calls.at(-1).method, 'POST');
  assert.deepEqual(JSON.parse(calls.at(-1).body), { language: 'auto', force: false });
  controller.destroy();
});

test('una letra en cache evita ASR; polling terminado no continúa y cancelar gana a una respuesta tardía', async () => {
  const callbacks = new Map();
  const calls = [];
  const late = deferred();
  const controller = createTimedLyricsController({
    request: async (url, options) => {
      calls.push(options.method || 'GET');
      if (options.method === 'DELETE') return { status: 'cancelled' };
      if (options.method === 'POST') return { status: 'transcribing', processedSeconds: 5 };
      if (calls.length === 1) return ready('cached');
      return late.promise;
    },
    schedule: callback => { callbacks.set(1, callback); return 1; },
    unschedule: timer => callbacks.delete(timer)
  });
  controller.select({ id: 'song', source: 'song.mp3', autoAnalyze: true });
  await tick();
  assert.deepEqual(calls, ['GET']);
  assert.equal(callbacks.size, 0);
  await controller.start({ force: true });
  assert.equal(callbacks.size, 1);
  callbacks.get(1)();
  await controller.cancel();
  late.resolve(ready('late'));
  await tick();
  assert.equal(controller.value.status, 'cancelled');
  assert.equal(callbacks.size, 0);
  controller.destroy();
});

test('errores conservan un fallback vacío y una nueva selección puede recuperarse', async () => {
  const controller = createTimedLyricsController({ request: async url => { if (url.endsWith('/broken')) throw new Error('network'); return ready('healthy'); } });
  controller.select({ id: 'broken', source: 'broken.mp3' });
  await tick();
  assert.equal(controller.value.status, 'error');
  assert.deepEqual(controller.value.segments, []);
  controller.select({ id: 'healthy', source: 'healthy.mp3' });
  await tick();
  assert.equal(controller.value.status, 'ready');
  controller.destroy();
});

test('cue inválido se descarta, texto se limita y la UI trata la letra como texto', async () => {
  const normalized = normalizeTimedLyrics({ status: 'ready', segments: [{ start: -1, text: 'invalid' }, { start: 4, text: '<img src=x onerror=alert(1)>\u0000' }, { start: 1, end: 20, text: 'first' }] });
  assert.equal(normalized.segments.length, 2);
  assert.equal(normalized.segments[0].end, 4);
  assert.equal(normalized.segments[1].text, '<img src=x onerror=alert(1)>');
  for (const file of ['../public/player-beta.js', '../public/star-screen.js']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /(?:player|starScreen)Lyrics\w*'\)\.innerHTML/);
    assert.match(source, /LyricsCurrent/);
  }
});

test('el DOM real de Star Screen muestra dos líneas, responde al reloj y limpia al cambiar de pista', async () => {
  const nodes = new Map();
  const node = selector => {
    if (!nodes.has(selector)) nodes.set(selector, {
      dataset: {}, style: { setProperty() {} }, classList: { add() {}, remove() {}, toggle() {} },
      textContent: '', innerHTML: '', src: '', paused: true, readyState: 1, seeking: false,
      addEventListener() {}, removeAttribute() {}, load() {}, pause() {}, play() { return Promise.resolve(); }
    });
    return nodes.get(selector);
  };
  let listener;
  class Channel { addEventListener(type, handler) { if (type === 'message') listener = handler; } postMessage() {} }
  const document = { querySelector: node, body: node('body'), addEventListener() {}, documentElement: {} };
  const window = { addEventListener() {}, clearTimeout() {}, setTimeout() {}, setInterval() {} };
  const source = (await readFile(new URL('../public/star-screen.js', import.meta.url), 'utf8')).replace(/^import .*;\n/gm, '');
  const bindings = {
    document, window, location: { search: '', origin: 'http://127.0.0.1:8787' }, localStorage: { getItem: () => null },
    BroadcastChannel: Channel, initLobbyWaveform: () => ({ receive() {}, setScene() {} }), setLocalQrImage() {},
    starScreenPreferences, starScreenPresentation, starScreenPresentationSignature,
    installStarScreenCanvas: () => ({ destroy() {} }), normalizeGuestLanguage, STAR_SCREEN_COPY,
    applyBrandingTheme() {}, renderBrandLogos() {}, lyricsForSnapshot, lyricsPlaybackTime, timedLyricsLines,renderTimedWords
  };
  new Function(...Object.keys(bindings), source)(...Object.values(bindings));
  const now = Date.now();
  const snapshot = {
    displayMode: 'karaoke', currentId: 'a', mediaUrl: '/media/a', playing: false, currentTime: 1.5,
    publishedAt: now, sequence: 1, now: { id: 'a', song: 'Fixture', singer: 'Test' }, queue: [],
    lyrics: { ...ready('a', '<img src=x onerror=alert(1)>'), currentId: 'a', mediaUrl: '/media/a', enabled: true, estimated: true }
  };
  listener({ data: snapshot });
  assert.equal(node('#starScreenLyrics').hidden, false);
  assert.equal(node('#starScreenLyricsCurrent').textContent, '<img src=x onerror=alert(1)>');
  assert.equal(node('#starScreenLyricsCurrent').innerHTML, '');
  assert.equal(node('#starScreenLyricsNext').textContent, 'Segunda línea');
  assert.equal(node('#starScreenLyricsEstimated').hidden, false);
  listener({ data: { type: 'player-clock', currentId: 'a', currentTime: 4.5, playing: false, publishedAt: now + 1 } });
  assert.equal(node('#starScreenLyricsCurrent').textContent, 'Segunda línea');
  listener({ data: { type: 'player-clock', currentId: 'a', currentTime: 1.5, playing: false, publishedAt: now + 2 } });
  assert.equal(node('#starScreenLyricsCurrent').textContent, '<img src=x onerror=alert(1)>');
  listener({ data: { ...snapshot, currentId: 'b', mediaUrl: '/media/b', publishedAt: now + 3, sequence: 2 } });
  assert.equal(node('#starScreenLyrics').hidden, true);
  assert.equal(node('#starScreenLyricsCurrent').textContent, '');
  listener({ data: { ...snapshot, displayMode: 'lobby', publishedAt: now + 4, sequence: 3 } });
  assert.equal(node('#starScreenLyrics').hidden, true);
});
