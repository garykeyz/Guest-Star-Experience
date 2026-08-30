import test from 'node:test';
import assert from 'node:assert/strict';
import { OPERATING_MODE, resolveOperatingMode } from '../src/operating-mode.mjs';

test('Player es interno y no depende de VirtualDJ', () => {
  assert.equal(resolveOperatingMode(OPERATING_MODE.PLAYER).externalPlayer, false);
});

test('Bridge identifica exclusivamente la integración con VirtualDJ', () => {
  const bridge = resolveOperatingMode(OPERATING_MODE.BRIDGE);
  assert.equal(bridge.productName, 'Guest Star Bridge');
  assert.equal(bridge.externalPlayer, true);
});

test('no acepta modos ambiguos que puedan controlar dos colas', () => {
  assert.throws(() => resolveOperatingMode('player+bridge'), /inválido/);
});
