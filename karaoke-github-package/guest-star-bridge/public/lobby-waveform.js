// Real PCM peak envelope of the latest audio buffer, not a song timeline.
export const LOBBY_BAR_COUNT = 64;

export function normalizeLobbyLevel(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

export function lobbyBarGeometry(index, level) {
  // Fixed visual gain/compression, identical for every bar. No invented profile.
  const height = 2 + 224 * Math.sqrt(normalizeLobbyLevel(level) * .9);
  return { x: 30 + index * 680 / (LOBBY_BAR_COUNT - 1), y1: 130 - height / 2, y2: 130 + height / 2 };
}

export function normalizeLobbySamples(samples) {
  if (!Array.isArray(samples) || samples.length !== LOBBY_BAR_COUNT) return null;
  return samples.map(normalizeLobbyLevel);
}

export function initLobbyWaveform(svg) {
  if (!svg) return { receive() {}, setScene() {} };
  const bars = Array.from({ length: LOBBY_BAR_COUNT }, (_, index) => {
    const bar = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    const { x } = lobbyBarGeometry(index, 0);
    bar.setAttribute('x1', x); bar.setAttribute('x2', x);
    svg.append(bar);
    return bar;
  });
  let targets = Array(LOBBY_BAR_COUNT).fill(0);
  const levels = Array(LOBBY_BAR_COUNT).fill(0);
  let receivedAt = -Infinity, sequence = -1;
  let active = false, lastFrame = 0, frame = 0;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function paint(now) {
    frame = requestAnimationFrame(paint);
    const elapsed = Math.max(0, now - lastFrame);
    if (elapsed < (reducedMotion.matches ? 500 : 33)) return;
    lastFrame = now;
    const live = active && now - receivedAt < 500;
    bars.forEach((bar, index) => {
      const next = live ? targets[index] : 0;
      levels[index] = reducedMotion.matches ? next : levels[index] + (next - levels[index]) * (1 - Math.exp(-Math.min(100, elapsed) / (next > levels[index] ? 35 : 100)));
      const { y1, y2 } = lobbyBarGeometry(index, levels[index]);
      bar.setAttribute('y1', y1); bar.setAttribute('y2', y2);
    });
  }
  frame = requestAnimationFrame(paint);
  window.addEventListener('pagehide', () => cancelAnimationFrame(frame), { once: true });
  return {
    receive(message) {
      if (message?.type !== 'lobby-waveform-frame' || !Number.isFinite(message.sequence) || message.sequence <= sequence) return;
      const samples = normalizeLobbySamples(message.samples);
      if (!samples) return;
      sequence = message.sequence;
      targets = message.playing === true ? samples : Array(LOBBY_BAR_COUNT).fill(0);
      receivedAt = performance.now();
    },
    setScene(state) { active = state?.displayMode !== 'karaoke' && state?.background?.playing === true; }
  };
}
