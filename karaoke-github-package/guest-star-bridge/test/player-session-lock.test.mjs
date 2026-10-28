import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../public/player-beta.js', import.meta.url), 'utf8');
function functionText(name) {
  const start = source.indexOf(`async function ${name}(`);
  assert.ok(start >= 0, name);
  const end = source.indexOf('\n  }', start);
  assert.ok(end > start, name);
  return source.slice(start, end + 4);
}
function flow(name, { confirm = false, playing = true } = {}) {
  const events = [];
  const item = { id: 'A', singer: 'Host test', song: 'A' };
  const context = vm.createContext({
    currentId: 'A', order: ['A', 'B', 'C', 'D', 'E'], transitionBusy: false,
    requestsById: () => new Map([['A', item], ['B', { ...item, id: 'B' }]]),
    current: () => item, queue: () => [item], playerReady: () => true,
    karaokeTransportIsPlaying: () => playing,
    confirmAction: async detail => { events.push(['confirm', detail]); return confirm; },
    enterLobby: async options => events.push(['lobby', options]),
    releaseActivePlayback: id => events.push(['release', id]),
    clearPlayerMedia: () => events.push(['clear']),
    api: async (url, options) => { events.push(['api', url, options]); return {}; },
    saveOrder: options => events.push(['saveOrder', options]),
    sync: () => events.push(['sync']), render: () => events.push(['render']),
    guest: i => i.singer, showNotice: message => events.push(['notice', message])
  });
  vm.runInContext(`${functionText(name)}; globalThis.runFlow = ${name};`, context);
  return { context, events };
}

for (const [outcome, label] of [['skipped', 'Saltar'], ['completed', 'Ya cantó'], ['removed', 'Quitar de todas formas']]) {
  test(`${label}: el primer click y Cancelar no modifican A`, async () => {
    const { context, events } = flow('advance');
    await context.runFlow(outcome);
    assert.equal(events.length, 1);
    assert.equal(events[0][0], 'confirm');
    assert.equal(events[0][1].confirmLabel, label);
    assert.equal(context.currentId, 'A');
    assert.deepEqual(Array.from(context.order), ['A', 'B', 'C', 'D', 'E']);
  });
  test(`${label}: solo la segunda confirmación libera A`, async () => {
    const { context, events } = flow('advance', { confirm: true });
    await context.runFlow(outcome);
    assert.equal(events[0][0], 'confirm');
    assert.equal(events[1][0], 'lobby');
    assert.equal(events[1][1].authorized, true);
    const write = events.find(e => e[0] === 'api' && e[2]);
    assert.match(write[1], /\/A\/outcome$/);
    assert.equal(JSON.parse(write[2].body).outcome, outcome);
    assert.ok(events.findIndex(e => e[0] === 'release') > events.indexOf(write));
    assert.ok(events.findIndex(e => e[0] === 'clear') > events.findIndex(e => e[0] === 'release'));
    assert.equal(context.currentId, '');
  });
}

test('Devolver: Cancelar conserva la sesión y confirmar la libera', async () => {
  const cancelled = flow('returnToEnd');
  await cancelled.context.runFlow();
  assert.equal(cancelled.events.length, 1);
  assert.equal(cancelled.context.currentId, 'A');
  const confirmed = flow('returnToEnd', { confirm: true });
  await confirmed.context.runFlow();
  assert.deepEqual(confirmed.events.slice(0, 3).map(e => e[0]), ['confirm', 'lobby', 'release']);
  assert.equal(confirmed.context.currentId, '');
  assert.deepEqual(Array.from(confirmed.context.order), ['B', 'C', 'D', 'E', 'A']);
});

test('acciones sobre B no pausan ni descargan la sesión A', async () => {
  const { context, events } = flow('advance', { confirm: true });
  await context.runFlow('removed', 'B');
  assert.equal(context.currentId, 'A');
  assert.equal(events.some(e => ['lobby', 'release', 'clear'].includes(e[0])), false);
  assert.deepEqual(Array.from(context.order), ['A', 'C', 'D', 'E']);
});

test('el guard central rechaza B/C/D/E antes de cualquier operación de transporte', async () => {
  const events = [];
  const context = vm.createContext({
    activePlaybackSession: { trackId: 'A', source: '/A.mp4' },
    playerReady: () => true,
    playerTrackChangeAllowed: ({ activeTrackId, targetTrackId }) => Boolean(targetTrackId && !activeTrackId),
    showNotice: text => events.push(text)
  });
  vm.runInContext(`${functionText('loadRequest')}; globalThis.load = loadRequest;`, context);
  // No media, native bridge, queue, AudioContext or audio engine is supplied:
  // reaching any of those operations would throw instead of passing.
  for (const id of ['B', 'C', 'D', 'E', 'A']) assert.equal(await context.load(id, true), false);
  assert.equal(events.length, 5);
  assert.equal(context.activePlaybackSession.trackId, 'A');
  assert.equal(context.activePlaybackSession.source, '/A.mp4');
});

test('Superhost suspende la canción al cambiar de actividad y conserva su posición sin finalizar', async () => {
  const start = source.indexOf('async leaveWorkspace() {');
  const end = source.indexOf('\n    },\n    audioOutputCapability', start);
  assert.ok(start > 0 && end > start);
  const method = source.slice(start, end + 6);
  const events = [];
  const context = vm.createContext({
    leavingWorkspace: false,
    runtimeSaveTimer: 1,
    window: {clearTimeout: () => events.push('cancel-checkpoint')},
    playerPreparationReady: () => true,
    runtimePayload: () => ({queueOrder:['A'],playback:{currentRequestId:'A',currentTimeSeconds:40,scene:'karaoke',wasPlaying:true}}),
    enterLobby: async options => {events.push(['pause',options]);return true;},
    karaokeClockPosition: () => 42,
    api: async (path,options) => {events.push(['save',path,JSON.parse(options.body)]);return {};},
    releaseActivePlayback: () => events.push('release'),
    clearPlayerMedia: () => {events.push('clear-media');return true;},
    clearBackgroundMedia: () => events.push('clear-background'),
    stemTransportTail: Promise.resolve(),
    close: options => events.push(['close',options])
  });
  vm.runInContext(`globalThis.leave = ({${method}}).leaveWorkspace`,context);
  await context.leave();
  assert.equal(events[1][0],'pause');
  assert.equal(events[1][1].startBackground,false);
  assert.equal(events[1][1].authorized,true);
  assert.equal(events[2][1],'/api/player/runtime');
  assert.equal(events[2][2].playback.currentRequestId,'A');
  assert.equal(events[2][2].playback.currentTimeSeconds,42);
  assert.equal(events[2][2].playback.wasPlaying,false);
  assert.deepEqual(events.slice(3,6),['release','clear-media','clear-background']);
  assert.equal(events.some(event=>Array.isArray(event)&&String(event[1]).includes('/api/activity/finish')),false);
});
