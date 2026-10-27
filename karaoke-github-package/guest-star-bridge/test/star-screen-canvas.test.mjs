import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  STAR_SCREEN_CANVAS_HEIGHT,
  STAR_SCREEN_CANVAS_WIDTH,
  starScreenContainLayout
} from '../public/star-screen-canvas.js';

test('canvas canónico mantiene 16:9 con contain y letterboxing en resoluciones reales', () => {
  assert.equal(STAR_SCREEN_CANVAS_WIDTH / STAR_SCREEN_CANVAS_HEIGHT, 16 / 9);
  for (const [width, height] of [[1920, 1080], [1600, 900], [1366, 768], [1280, 720], [1200, 900], [900, 1200]]) {
    const layout = starScreenContainLayout(width, height);
    assert.ok(layout.renderedWidth <= width + 1e-9);
    assert.ok(layout.renderedHeight <= height + 1e-9);
    assert.ok(Math.abs(layout.renderedWidth / layout.renderedHeight - 16 / 9) < 1e-12);
    assert.ok(layout.letterboxX >= 0);
    assert.ok(layout.letterboxY >= 0);
    assert.ok(Math.abs(layout.renderedWidth + layout.letterboxX * 2 - width) < 1e-6 ||
      Math.abs(layout.renderedHeight + layout.letterboxY * 2 - height) < 1e-6);
  }
});

test('Preview y Star Screen usan el mismo canvas, sin ramas visuales internas', async () => {
  const [html, source, styles, visualStyles] = await Promise.all([
    readFile(new URL('../public/star-screen.html', import.meta.url), 'utf8'),
    readFile(new URL('../public/star-screen.js', import.meta.url), 'utf8'),
    readFile(new URL('../public/player-beta.css', import.meta.url), 'utf8'),
    readFile(new URL('../public/star-screen-visual.css', import.meta.url), 'utf8')
  ]);
  assert.match(html, /class="star-screen-canvas" id="starScreenCanvas"/);
  assert.match(html, /href="\/star-screen-visual\.css"/);
  assert.match(html, /class="star-screen-vintage-mic"/);
  assert.match(html, /class="star-screen-left-stack"[\s\S]*id="starScreenActivityAccess"[\s\S]*class="star-screen-lineup"/);
  const topbar = html.slice(html.indexOf('<header class="star-screen-topbar">'), html.indexOf('</header>'));
  assert.doesNotMatch(topbar, /starScreenActivityAccess/);
  assert.doesNotMatch(html, /starScreenFullscreen|starScreenStatus|MÚSICA AMBIENTAL/);
  assert.doesNotMatch(source, /classList\.add\('star-screen-preview'\)/);
  assert.match(styles, /grid-auto-rows:76px/);
  assert.match(styles, /\.star-screen-canvas \.star-screen-lineup\{[^}]*height:auto/);
  assert.match(styles, /\.star-screen-canvas \.star-screen-now\{[^}]*height:118px/);
  assert.match(source, /singleNext \? escapeHtml\(copy\.next\) : escapeHtml\(copy\.queued\)/);
  assert.match(styles, /li\.star-screen-next-row\{grid-template-columns:minmax\(0,1fr\) 110px\}/);
  assert.match(visualStyles, /grid-template-columns:500px minmax\(0,1fr\)/);
  assert.match(visualStyles, /width:344px;[\s\S]*height:390px/);
  assert.match(visualStyles, /grid-template-rows:226px minmax\(0,1fr\)/);
});

test('altura natural de Star Lineup contiene 1–5 filas consistentes dentro del área central', () => {
  const header = 118;
  const margin = 16;
  const padding = 40;
  const row = 76;
  const gap = 8;
  const heights = Array.from({ length: 5 }, (_, index) => header + margin + padding + row * (index + 1) + gap * index);
  assert.deepEqual(heights, [250, 334, 418, 502, 586]);
  assert.ok(heights.every((height, index) => index === 0 || height - heights[index - 1] === row + gap));
  assert.ok(heights[4] <= 614);
});
