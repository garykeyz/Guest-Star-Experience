import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DEFAULT_CONFIG, sanitizeConfig, configForStorage } from '../src/config.mjs';
import { normalizeVocalGuideDefault, playerStemMix } from '../public/player-beta.js';

test('Vocal reaches native gain while animation frames are suspended', () => {
  const source = fs.readFileSync(new URL('../public/player-beta.js', import.meta.url), 'utf8');
  const start = source.indexOf('  let vocalGuideFrame = 0;');
  const end = source.indexOf("  $('#playerBackgroundToggle')", start);
  const handlers = {}, commands = [], frames = [];
  const context = { audioSettings: { vocalLevel: 0 }, Math, Number,
    $: selector => ({ addEventListener: (name, fn) => handlers[selector + name] = fn, textContent: '' }),
    usingNativeAudio: () => true, nativeAudioCommand: (action, payload) => commands.push({action, ...payload}),
    requestAnimationFrame: fn => { frames.push(fn); return frames.length; }, paintRange() {}, persistAudioSettings() {}
  };
  vm.runInNewContext(source.slice(start, end), context);
  for (const value of [0, .5, 1, .25, 0]) handlers['#playerVocalLevelinput']({ target: { value } });
  assert.deepEqual(commands.map(x => x.vocalLevel), [0, .5, 1, .25, 0]);
  assert.ok(commands.every(x => x.action === 'nativeAudioVocalGain' && x.deck === 'karaoke'));
  assert.equal(frames.length, 1);
});

test('guía inicial baja configurable y persistente, conserva ajustes ajenos', () => {
  assert.equal(DEFAULT_CONFIG.selectedStemEngine, 'gsvocalrt');
  assert.equal(DEFAULT_CONFIG.defaultVocalGuideLevel, 0);
  for (const [value, expected] of [[0, 0], [0.1, 0.1], [1, 0.2], [-1, 0], ['invalido', 0]]) {
    const clean = sanitizeConfig({ defaultVocalGuideLevel: value }, { ...DEFAULT_CONFIG, backgroundMusicVolume: .35 });
    assert.equal(clean.defaultVocalGuideLevel, expected);
    assert.equal(clean.backgroundMusicVolume, .35);
    assert.equal(configForStorage(clean).defaultVocalGuideLevel, expected);
    assert.equal(normalizeVocalGuideDefault(value), expected);
  }
});

test('dos buses: acompañamiento fijo y vocal nominal; OFF conserva original', () => {
  assert.deepEqual(playerStemMix({stemsReady:true,vocalLevel:0}), {normal:0,instrumental:1,vocals:0});
  assert.deepEqual(playerStemMix({stemsReady:true,vocalLevel:1}), {normal:0,instrumental:1,vocals:1});
  for (let i=0;i<=100;i++) {
    const mix=playerStemMix({stemsReady:true,vocalLevel:i/100});
    assert.equal(mix.instrumental, 1);
    assert.equal(mix.vocals, i/100);
    assert.equal(mix.normal, 0);
  }
  assert.deepEqual(playerStemMix({stemsReady:false,vocalLevel:1}), {normal:1,instrumental:0,vocals:0});
});
