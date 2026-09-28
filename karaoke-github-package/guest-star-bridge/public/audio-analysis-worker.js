import { analyzeAudioFeatures } from './player-beta.js';

self.addEventListener('message', (event) => {
  try {
    const samples = new Float32Array(event.data.samples);
    self.postMessage(analyzeAudioFeatures(samples, event.data.sampleRate));
  } catch (error) {
    self.postMessage({ error: error?.message || 'No se pudo analizar el audio.' });
  }
});
