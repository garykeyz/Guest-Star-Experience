import { normalizeLobbySamples } from './lobby-waveform.js';

// Forward real background-only PCM envelopes. Never command or duplicate audio.
const channel = new BroadcastChannel('guest-star-player');
window.addEventListener('gueststar:native-background-waveform', (event) => {
  const snapshot = event.detail;
  const samples = normalizeLobbySamples(snapshot?.samples);
  if (!samples) return;
  channel.postMessage({
    type: 'lobby-waveform-frame', sequence: Date.now(),
    playing: snapshot.playing === true, samples
  });
});
window.addEventListener('pagehide', () => channel.close(), { once: true });
