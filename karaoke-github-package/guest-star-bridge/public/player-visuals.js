// Presentation-only: read already decoded local frames; never control media or fetch assets.
export function drawCurrentSongBackground({ canvas, panel, videos, source, enabled, origin }) {
  const hide = () => panel.classList.remove('player-has-current-song-visual');
  if (!enabled || !source) { hide(); return false; }
  try {
    const expected = new URL(source, origin);
    if (expected.origin !== origin || !expected.pathname.startsWith('/api/player/media/')) {
      hide(); return false;
    }
    const video = videos.find((candidate) => {
      if (!candidate || candidate.error || candidate.readyState < 2 || !candidate.videoWidth || !candidate.videoHeight) return false;
      const actual = new URL(candidate.currentSrc || candidate.src, origin);
      return actual.href === expected.href;
    });
    if (!video) { hide(); return false; }
    const context = canvas.getContext('2d');
    if (!context) { hide(); return false; }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    panel.classList.add('player-has-current-song-visual');
    return true;
  } catch { hide(); return false; }
}

export function initCurrentSongBackground({ getMedia, getSource }) {
  const panel = document.querySelector('.player-transport-panel');
  const canvas = document.querySelector('#playerCurrentSongBackground');
  const preview = document.querySelector('#playerStarScreenPreview');
  const render = () => {
    const enabled = document.body.classList.contains('preference-current-song-background');
    // A same-origin preview may already have the decoded frame when native audio
    // keeps the main media element metadata-only. Access is read-only.
    let previewVideo = null;
    if (enabled) {
      try { previewVideo = preview?.contentDocument?.querySelector('video'); } catch {}
    }
    const visible = drawCurrentSongBackground({
      canvas, panel, videos: [previewVideo, getMedia()], source: getSource(),
      enabled: enabled && document.body.classList.contains('player-mode'),
      origin: location.origin
    });
    const status = document.querySelector('#playerCurrentSongBackgroundStatus');
    if (status) {
      const text = !enabled ? 'Fondo visual desactivado.' : visible
        ? 'Fondo visual disponible desde el video local.'
        : 'Sin fotograma disponible; se usa el fondo normal.';
      if (status.textContent !== text) status.textContent = text;
    }
    return visible;
  };
  const timer = window.setInterval(render, 1000);
  window.addEventListener('beforeunload', () => window.clearInterval(timer), { once: true });
  return { render };
}
