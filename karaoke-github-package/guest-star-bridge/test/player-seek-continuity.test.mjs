import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import { playerStemMix } from '../public/player-beta.js';

const source = fs.readFileSync(new URL('../public/player-beta.js', import.meta.url), 'utf8');
function fixture() {
  const events = {}, requests = [], visualPositions = [], snapshots = [], counters = { renders: 0, publishes: 0 };
  const element = { value: '0' };
  const context = {
    media: {}, performance: { now: () => 100 }, AbortController, DOMException, Promise, Math, Number,
    $: selector => selector === '#playerSeek' ? { addEventListener: (name, fn) => events[name] = fn } : { textContent: '' },
    karaokeClockDuration: () => 300, karaokeTransportIsPlaying: () => true, usingNativeAudio: () => true, nativeDeckIsLoaded: () => true,
    setVisualClockPosition: (_media, value) => visualPositions.push(value),
    setNativeKaraokeTransportSnapshot: value => { snapshots.push(value); context.karaokePendingStartPosition = value; },
    renderNow: () => counters.renders++, publish: () => counters.publishes++, paintRange() {}, formatDuration: String,
    recordAudio() {}, showNotice() {}, scheduleRuntimeSave() {},
    karaokeMediaGeneration: 1, currentId: 'song-A', nativeKaraokeDeckRequestId: 'song-A', karaokeSeekGeneration: 0,
    nativeKaraokeCommittedSeekRevision: 0, karaokeSeekInFlight: false, karaokeQueuedSeek: null, karaokeSeekActiveRequest: null, karaokeScrubPreview: null,
    karaokeSeekPointerActive: false, karaokePendingStartPosition: 0, visualTransportRevision: 0,
    // Deliberately accept late native replies even after abort: generation guards
    // must still reject stale completions, independent of AbortController.
    nativeAudioRequest: (_action, payload, { signal } = {}) => new Promise(resolve => requests.push({ payload, signal, resolve }))
  };
  vm.createContext(context);
  const a = source.indexOf('  function cancelPendingKaraokeSeek()');
  const b = source.indexOf('  function publishNativeTransportUpdate()', a);
  const c = source.indexOf("  $('#playerSeek').addEventListener('input'");
  const d = source.indexOf('  function bindMediaEvents()', c);
  vm.runInContext(source.slice(a, b) + source.slice(c, d), context);
  const fire = (name, position = Number(element.value)) => { element.value = String(position); events[name]({ target: element, currentTarget: element }); };
  return { context, fire, requests, visualPositions, snapshots, counters };
}

const settle = () => new Promise(resolve => setImmediate(resolve));

test('Play follows the final paused seek owner before using the committed clock', async () => {
  const f = fixture();
  f.context.seekKaraokeTransport(25);
  let played = false;
  const play = f.context.waitForLatestKaraokeSeek().then(() => {
    played = true;
    return f.context.karaokePendingStartPosition;
  });
  f.context.seekKaraokeTransport(140);
  f.requests[0].resolve({ position: 25 }); await settle();
  assert.equal(played, false);
  f.requests[1].resolve({ position: 140 });
  assert.equal(await play, 140);
  assert.equal(f.requests.length, 2);
  assert.deepEqual(f.visualPositions, [140]);
});

test('200 scrub inputs preview locally; release dispatches only latest immediately', async () => {
  const f = fixture(); f.fire('pointerdown');
  for (let value = 1; value <= 200; value++) f.fire('input', value);
  assert.equal(f.requests.length, 0);
  assert.equal(f.visualPositions.length, 0);
  assert.equal(f.counters.publishes, 0);
  assert.equal(f.context.visualTransportRevision, 0);
  f.fire('pointerup', 200); f.fire('change', 200);
  assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].payload.position, 200);
  f.requests[0].resolve({ position: 200 }); await settle();
  assert.deepEqual(f.visualPositions, [200]);
  assert.equal(f.context.visualTransportRevision, 1);
  assert.equal(f.counters.publishes, 1);
});

test('new final destination supersedes unfinished seek without waiting; old reply never commits', async () => {
  const f = fixture(); f.fire('input', 20); f.fire('change');
  f.fire('input', 140); f.fire('change');
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0].signal.aborted, true);
  assert.equal(f.requests[1].signal.aborted, false);
  f.requests[0].resolve({ position: 20 }); await settle();
  assert.deepEqual(f.visualPositions, []);
  assert.notEqual(f.context.karaokeSeekInFlight, false);
  f.requests[1].resolve({ position: 140 }); await settle();
  assert.deepEqual(f.visualPositions, [140]);
  assert.deepEqual(f.snapshots, [140]);
  assert.equal(f.context.karaokeSeekInFlight, false);
});

test('track change cancels seek and rejects previous source completion', async () => {
  const f = fixture(); const pending = f.context.seekKaraokeTransport(90);
  f.context.cancelPendingKaraokeSeek(); f.context.karaokeMediaGeneration++; f.context.currentId = 'song-B';
  assert.equal(f.requests[0].signal.aborted, true);
  f.requests[0].resolve({ position: 90 }); await pending;
  assert.deepEqual(f.visualPositions, []);
  assert.equal(f.counters.publishes, 0);
});

test('pointer cancel does not commit; keyboard change commits and clamps target', async () => {
  const f = fixture(); f.fire('pointerdown'); f.fire('input', 100); f.fire('pointercancel');
  assert.equal(f.requests.length, 0);
  f.fire('input', 500); f.fire('change');
  assert.equal(f.requests[0].payload.position, 300);
  f.requests[0].resolve({ position: 300 }); await settle();
  assert.deepEqual(f.visualPositions, [300]);
});

test('Vocal adds vocals while accompaniment stays at reference gain throughout 0–100%', () => {
  for (let step = 0; step <= 100; step++) {
    const g = step / 100, mix = playerStemMix({ stemsReady: true, vocalLevel: g });
    assert.equal(mix.instrumental, 1); assert.equal(mix.vocals, g); assert.equal(mix.normal, 0);
    const original = .7, vocal = .2, instrumental = original - vocal;
    assert.ok(Math.abs(instrumental * mix.instrumental + vocal * mix.vocals - (instrumental + g * vocal)) < 1e-12);
  }
  assert.deepEqual(playerStemMix({ stemsReady: false, vocalLevel: .5 }), { normal: 1, instrumental: 0, vocals: 0 });
});

test('native transport ticks use no full snapshot publication or Lyrics refresh', () => {
  let clockOnly = null, renders = 0, publishes = 0;
  const context = { performance: { now: () => 500 }, Date: { now: () => 5000 }, nativeTransportPublishAt: 0, lastRuntimeCheckpoint: 0,
    renderNow: options => { clockOnly = options?.clockOnly; renders++; }, publish: () => publishes++, scheduleRuntimeSave() {} };
  vm.createContext(context);
  const a = source.indexOf('  function publishNativeTransportUpdate()');
  const b = source.indexOf("  window.addEventListener('gueststar:native-audio-state'", a);
  vm.runInContext(source.slice(a, b), context);
  context.publishNativeTransportUpdate();
  assert.equal(renders, 1); assert.equal(clockOnly, true); assert.equal(publishes, 0);
});

test('superseded native requests release IPC pending map and timeout immediately', async () => {
  const requests = new Map(), timers = new Map(); let sequence = 0;
  const context = { nativeAudioRequests: requests, Date, Math, DOMException, Promise,
    window: { setTimeout: callback => { timers.set(++sequence, callback); return sequence; }, clearTimeout: id => timers.delete(id),
      webkit: { messageHandlers: { guestStarNative: { postMessage() {} } } } } };
  vm.createContext(context);
  const a = source.indexOf('  function nativeAudioRequest('), b = source.indexOf('  function nativeAudioCommand(', a);
  vm.runInContext(source.slice(a, b), context);
  const controller = new AbortController();
  const pending = context.nativeAudioRequest('nativeAudioSeek', { position: 30 }, { signal: controller.signal });
  assert.equal(requests.size, 1); assert.equal(timers.size, 1);
  controller.abort();
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(requests.size, 0); assert.equal(timers.size, 0);
});

test('a native snapshot from before seek cannot overwrite committed media clock', () => {
  let now = 5000;
  let deck = { seekRevision: 4, position: 5, duration: 300, playing: true, tempoPercent: 100 };
  const context = { performance: { now: () => now }, nativeDeckState: () => deck, usingNativeAudio: () => true,
    nativeDeckIsLoaded: () => true, media: { currentTime: 5, duration: 300 }, tempoPercent: 100,
    nativeKaraokeClockOverride: { position: 100, playing: true, tempoPercent: 100, receivedAt: 1000 },
    nativeKaraokeCommittedSeekRevision: 5, nativeAudioStateReceivedAt: 4900, karaokePendingStartPosition: 100 };
  vm.createContext(context);
  const a = source.indexOf('  function karaokeClockPosition()'), b = source.indexOf('  function karaokeClockDuration()', a);
  vm.runInContext(source.slice(a, b), context);
  assert.equal(context.karaokeClockPosition(), 104);
  deck = { ...deck, seekRevision: 5, position: 104 };
  context.nativeKaraokeClockOverride = null;
  assert.equal(context.karaokeClockPosition(), 104.1);
});


test('a seek staged during source preparation does not claim a native revision until load ready', async () => {
  const f = fixture(); f.context.nativeKaraokeDeckRequestId = '';
  await f.context.seekKaraokeTransport(95);
  assert.equal(f.requests.length, 0);
  assert.equal(f.context.nativeKaraokeCommittedSeekRevision, 0);
  assert.equal(f.context.karaokePendingStartPosition, 95);
  f.context.nativeKaraokeDeckRequestId = 'song-A';
  const readySeek = f.context.seekKaraokeTransport(95);
  assert.equal(f.requests.length, 1);
  f.requests[0].resolve({ position: 95 }); await readySeek;
  assert.equal(f.context.nativeKaraokeCommittedSeekRevision, 2);
});
