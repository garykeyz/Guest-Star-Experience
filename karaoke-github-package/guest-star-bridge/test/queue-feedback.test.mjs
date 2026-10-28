import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createQueueToast } from '../public/queue-toast.js';
const source = readFileSync(new URL('../public/player-beta.js', import.meta.url), 'utf8');
function fn(name) {
  const start = source.indexOf(`async function ${name}(`);
  return source.slice(start, source.indexOf('\n  }', start) + 4);
}
test('acciones consecutivas sobre otras canciones y Deshacer no operan el transporte activo', async () => {
  const notices = [], writes = [];
  const forbidden = () => { throw new Error('Transport touched'); };
  const context = vm.createContext({
    currentId: 'playing', transitionBusy: false, order: ['playing', 'B', 'C', 'D'],
    requestsById: () => new Map(['B', 'C', 'D'].map(id => [id, { id, singer: id, song: 'Song' }])),
    playerReady: () => true, karaokeTransportIsPlaying: () => true,
    confirmAction: forbidden, enterLobby: forbidden, releaseActivePlayback: forbidden, clearPlayerMedia: forbidden,
    api: async (url, options) => { if (options) writes.push(url); return {}; },
    saveOrder: () => {}, sync: () => {}, render: () => {}, guest: item => item.singer,
    showNotice: (...args) => notices.push(args)
  });
  vm.runInContext(`${fn('advance')}\n${fn('undoOutcome')}\nglobalThis.advance = advance;`, context);
  for (const [id, outcome] of [['B', 'removed'], ['C', 'skipped'], ['D', 'completed']]) await context.advance(outcome, id);
  assert.equal(context.currentId, 'playing');
  assert.equal(notices.length, 3);
  assert.ok(notices.every(n => n[2].label === 'Deshacer'));
  for (const notice of [...notices]) await notice[2].run();
  assert.equal(writes.filter(url => url.endsWith('/undo')).length, 3);
  assert.equal(context.currentId, 'playing');
});
test('toast compacto: no roba foco, conserva varios Deshacer y desaparece automáticamente', async () => {
  class Element {
    children = []; events = {}; classes = new Set();
    classList = { toggle: (key, value) => value ? this.classes.add(key) : this.classes.delete(key) };
    append(child) { this.children.push(child); }
    replaceChildren() { this.children = []; }
    addEventListener(event, handler) { this.events[event] = handler; }
    matches() { return false; } contains() { return false; }
  }
  const previous = globalThis.document;
  globalThis.document = { createElement: () => new Element(), activeElement: null };
  try {
    const tasks = new Map(); let serial = 0;
    const timers = { setTimeout: fn => { tasks.set(++serial, fn); return serial; }, clearTimeout: id => tasks.delete(id) };
    const host = new Element(), undone = [];
    const toast = createQueueToast(host, { timers });
    toast('B quitada', false, { run: async () => undone.push('B') });
    toast('C omitida', false, { run: async () => undone.push('C') });
    assert.equal(host.children[0].textContent, 'B quitada');
    assert.equal(host.children.length, 2);
    await host.children[1].events.click();
    assert.equal(host.children[0].textContent, 'C omitida');
    await host.children[1].events.click();
    assert.deepEqual(undone, ['B', 'C']);
    assert.ok(host.classes.has('hidden'));
    toast('Error recuperable', true);
    assert.ok(host.classes.has('error'));
    [...tasks.values()][0]();
    assert.ok(host.classes.has('hidden'));
  } finally { globalThis.document = previous; }
});
