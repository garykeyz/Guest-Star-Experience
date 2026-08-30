/** Contrato del modo Guest Star Player. Bridge/VirtualDJ vive en su propio adaptador. */
export class PlaybackEngine {
  async load() { throw new Error('load() debe implementarse'); }
  async play() { throw new Error('play() debe implementarse'); }
  pause() { throw new Error('pause() debe implementarse'); }
  stop() { throw new Error('stop() debe implementarse'); }
  seek() { throw new Error('seek() debe implementarse'); }
}

/** Implementación temporal para la beta web local. Tauri la reemplazará sin cambiar la cola. */
export class HtmlAudioPlaybackEngine extends PlaybackEngine {
  constructor(audio, onStateChange = () => {}) {
    super();
    this.audio = audio;
    this.onStateChange = onStateChange;
    audio.addEventListener('play', () => onStateChange({ state: 'playing' }));
    audio.addEventListener('pause', () => onStateChange({ state: 'paused' }));
    audio.addEventListener('timeupdate', () => onStateChange({ state: 'progress', currentTime: audio.currentTime, duration: audio.duration || 0 }));
    audio.addEventListener('ended', () => onStateChange({ state: 'ended' }));
    audio.addEventListener('error', () => onStateChange({ state: 'error', message: 'No se pudo reproducir este archivo.' }));
  }

  async load(file) {
    this.stop();
    this.audio.src = URL.createObjectURL(file);
    this.audio.load();
  }

  async play() { await this.audio.play(); }
  pause() { this.audio.pause(); }
  stop() { this.audio.pause(); this.audio.currentTime = 0; }
  seek(seconds) { this.audio.currentTime = seconds; }
}
