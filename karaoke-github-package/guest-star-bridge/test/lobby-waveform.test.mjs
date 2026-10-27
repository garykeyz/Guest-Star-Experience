import test from 'node:test';
import assert from 'node:assert/strict';
import { LOBBY_BAR_COUNT, lobbyBarGeometry, normalizeLobbyLevel, normalizeLobbySamples, initLobbyWaveform } from '../public/lobby-waveform.js';

test('real-sample bars remain fixed and centered without any decorative profile', () => {
  for (let index = 0; index < LOBBY_BAR_COUNT; index++) {
    const idle = lobbyBarGeometry(index, 0), peak = lobbyBarGeometry(index, 1);
    assert.equal(idle.x, peak.x);
    assert.equal(peak.y1 + peak.y2, 260);
    assert.ok(peak.y2 - peak.y1 > idle.y2 - idle.y1);
    assert.ok(peak.y1 >= 0 && peak.y2 <= 260);
  }
  assert.equal(lobbyBarGeometry(1, .3).y1, lobbyBarGeometry(30, .3).y1);
  assert.equal(lobbyBarGeometry(1, 0).y2 - lobbyBarGeometry(1, 0).y1, 2);
});

test('invalid, absent and out-of-range meters are safe', () => {
  assert.equal(normalizeLobbyLevel(undefined), 0);
  assert.equal(normalizeLobbyLevel(NaN), 0);
  assert.equal(normalizeLobbyLevel(Infinity), 0);
  assert.equal(normalizeLobbyLevel(-1), 0);
  assert.equal(normalizeLobbyLevel(3), 1);
  assert.equal(normalizeLobbySamples(undefined), null);
  assert.equal(normalizeLobbySamples([1, 2]), null);
  const values = Array(LOBBY_BAR_COUNT).fill(.2); values[0] = NaN;
  assert.equal(normalizeLobbySamples(values)[0], 0);
  assert.equal(normalizeLobbySamples(values)[1], .2);
});

test('each PCM bar reacts independently, stale frames are ignored and silence is real', () => {
  const saved = { document: globalThis.document, window: globalThis.window, requestAnimationFrame: globalThis.requestAnimationFrame, cancelAnimationFrame: globalThis.cancelAnimationFrame };
  let callback;
  const bars = [];
  const motion = { matches: false };
  globalThis.document = { addEventListener() {}, createElementNS() { return { attributes: {}, hasAttribute(key){return key in this.attributes;}, setAttribute(key, value) { this.attributes[key] = Number(value); } }; } };
  globalThis.window = { matchMedia: () => motion, addEventListener() {} };
  globalThis.requestAnimationFrame = fn => { callback = fn; return 1; };
  globalThis.cancelAnimationFrame = () => {};
  try {
    const renderer = initLobbyWaveform({ getClientRects:()=>[{}], append: bar => bars.push(bar) });
    const now = performance.now();
    const height = () => bars[35].attributes.y2 - bars[35].attributes.y1;
    renderer.setScene({ displayMode: 'lobby', background: { playing: true } });
    callback(now + 100);
    const idle = height(), x = bars[35].attributes.x1;
    const samples = Array(LOBBY_BAR_COUNT).fill(0); samples[35] = 1; samples[34] = .1;
    renderer.receive({ type: 'lobby-waveform-frame', sequence: 2, playing: true, samples });
    callback(now + 200);
    assert.ok(height() > idle);
    const live = height();
    assert.ok(bars[34].attributes.y2 - bars[34].attributes.y1 < live);
    assert.equal(bars[0].attributes.y2 - bars[0].attributes.y1, 2);
    renderer.receive({ type: 'lobby-waveform-frame', sequence: 1, playing: true, samples: Array(LOBBY_BAR_COUNT).fill(0) });
    callback(now + 300);
    assert.ok(height() >= live);
    const peak = height();
    assert.equal(bars[35].attributes.x1, x);
    renderer.setScene({ displayMode: 'karaoke', background: { playing: true } });
    callback(now + 400);
    assert.ok(height() < peak);
    renderer.setScene({ displayMode: 'lobby', background: { playing: true } });
    for (let i = 0; i < 30; i++) callback(now + 2000 + i * 100);
    assert.ok(height() < idle + 1);
    motion.matches = true;
    const actualNow = performance.now();
    renderer.receive({ type: 'lobby-waveform-frame', sequence: 3, playing: true, samples });
    // A reduced-motion update still displays actual samples, never a fake shape.
    callback(actualNow + 5600);
    assert.equal(height(), 2); // stale data settles even with reduced motion
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  }
});

test('publisher forwards real background frames only, never karaoke meters or invalid data', async () => {
  const previousWindow = globalThis.window, previousChannel = globalThis.BroadcastChannel;
  const listeners = new Map(), messages = [];
  globalThis.window = { addEventListener: (name, callback) => listeners.set(name, callback) };
  globalThis.BroadcastChannel = class { postMessage(message) { messages.push(message); } close() {} };
  try {
    await import('../public/lobby-waveform-publisher.js?test=pcm');
    assert.equal(listeners.has('gueststar:native-audio-state'), false);
    const receive = listeners.get('gueststar:native-background-waveform');
    receive({ detail: { playing: true, samples: [1] } });
    assert.equal(messages.length, 0);
    const samples = Array.from({ length: LOBBY_BAR_COUNT }, (_, index) => index / LOBBY_BAR_COUNT);
    receive({ detail: { playing: true, frame: 10, samples } });
    assert.equal(messages[0].type, 'lobby-waveform-frame');
    assert.deepEqual(messages[0].samples, samples);
    assert.equal(messages[0].playing, true);
  } finally {
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
    globalThis.BroadcastChannel = previousChannel;
  }
});
