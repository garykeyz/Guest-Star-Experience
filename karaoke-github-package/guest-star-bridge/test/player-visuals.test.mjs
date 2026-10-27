import assert from 'node:assert/strict';
import test from 'node:test';
import { drawCurrentSongBackground } from '../public/player-visuals.js';

function fixture({ source = '/api/player/media/track-1', enabled = true, video = {} } = {}) {
  const classes = new Set();
  let frames = 0;
  const panel = { classList: { add: value => classes.add(value), remove: value => classes.delete(value) } };
  const canvas = { width: 480, height: 270, getContext: () => ({ drawImage: () => frames++ }) };
  const media = Object.freeze({
    currentSrc: 'http://127.0.0.1:8787/api/player/media/track-1',
    readyState: 2, videoWidth: 1280, videoHeight: 720, error: null,
    play() { throw new Error('forbidden play'); },
    pause() { throw new Error('forbidden pause'); },
    load() { throw new Error('forbidden load'); },
    ...video
  });
  return {
    classes, media, frames: () => frames,
    render: overrides => drawCurrentSongBackground({
      canvas, panel, videos: [media], source, enabled, origin: 'http://127.0.0.1:8787', ...overrides
    })
  };
}

test('copies an already decoded local frame without mutating or controlling media', () => {
  const f = fixture();
  assert.equal(f.render(), true);
  assert.equal(f.frames(), 1);
  assert.equal(f.classes.has('player-has-current-song-visual'), true);
  assert.equal(f.media.currentSrc, 'http://127.0.0.1:8787/api/player/media/track-1');
});

test('repeated ON/OFF changes hide only the visual layer', () => {
  const f = fixture();
  for (let i = 0; i < 10; i++) {
    assert.equal(f.render({ enabled: true }), true);
    assert.equal(f.render({ enabled: false }), false);
    assert.equal(f.classes.size, 0);
  }
  assert.equal(f.frames(), 10);
});

test('missing frame, audio-only media and broken media use normal background', () => {
  for (const video of [{ readyState: 1 }, { videoWidth: 0 }, { error: { code: 3 } }]) {
    const f = fixture({ video });
    assert.equal(f.render(), false);
    assert.equal(f.frames(), 0);
    assert.equal(f.classes.size, 0);
  }
});

test('a stale track, different source or external URL never supplies the backdrop', () => {
  for (const source of ['/api/player/media/track-2', '/api/player/background/media/track-1', 'https://example.com/image.jpg', '']) {
    const f = fixture({ source });
    assert.equal(f.render(), false);
    assert.equal(f.frames(), 0);
  }
});

test('frame rendering failure clears a previously visible background', () => {
  const f = fixture();
  f.render();
  assert.equal(f.render({ canvas: { getContext: () => ({ drawImage() { throw new Error('decode'); } }) } }), false);
  assert.equal(f.classes.size, 0);
});

test('can use an existing preview frame when the principal media is metadata-only', () => {
  const f = fixture();
  assert.equal(f.render({ videos: [{ readyState: 1 }, f.media] }), true);
  assert.equal(f.frames(), 1);
});

