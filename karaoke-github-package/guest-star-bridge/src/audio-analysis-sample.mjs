import { spawn } from 'node:child_process';
import { setPriority } from 'node:os';

// These are the Player's existing analysis window and rate, not playback limits.
export const ANALYSIS_SAMPLE_RATE = 11025;
export const ANALYSIS_SECONDS = 120;
export const ANALYSIS_MAX_BYTES = ANALYSIS_SAMPLE_RATE * ANALYSIS_SECONDS * 4;

export class AudioAnalysisSampler {
  constructor() { this.child = null; this.waiting = false; this.closed = null; this.cancelActive = null; this.stopping = false; }

  async decode(filePath, { ffmpegPath, signal } = {}) {
    signal?.throwIfAborted();
    if (this.stopping) throw new DOMException('Analysis stopped.', 'AbortError');
    if (!ffmpegPath) return Promise.reject(Object.assign(new Error('The local analysis decoder is unavailable.'), { status: 503 }));
    if (this.child) {
      if (this.waiting) throw Object.assign(new Error('A local audio analysis is already queued.'), { status: 429 });
      this.waiting = true;
      let abort;
      try {
        // A cancelled HTTP fetch can finish before its FFmpeg child exits.
        // Let the next track wait for that exit without spawning a second child.
        await new Promise((resolve, reject) => {
          abort = () => reject(signal.reason || new DOMException('Analysis cancelled.', 'AbortError'));
          signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted) abort();
          this.closed.then(resolve);
        });
      } finally {
        this.waiting = false;
        signal?.removeEventListener('abort', abort);
      }
      return this.decode(filePath, { ffmpegPath, signal });
    }
    return new Promise((resolve, reject) => {
      const child = spawn(ffmpegPath, [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-threads', '1',
        '-i', filePath, '-t', String(ANALYSIS_SECONDS), '-map', '0:a:0',
        '-vn', '-sn', '-dn', '-ac', '1', '-ar', String(ANALYSIS_SAMPLE_RATE),
        '-filter_threads', '1', '-f', 'f32le', 'pipe:1'
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      this.child = child;
      this.closed = new Promise(resolveExit => child.once('close', resolveExit));
      try { setPriority(child.pid, 19); } catch { /* Best effort on supported systems. */ }
      const chunks = [];
      let size = 0, stderr = '', failure = null, killTimer = null;
      const stop = (error) => {
        if (failure) return;
        failure = error;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => child.kill('SIGKILL'), 1000);
        killTimer.unref();
      };
      const abort = () => stop(signal.reason || new DOMException('Analysis cancelled.', 'AbortError'));
      this.cancelActive = () => stop(new DOMException('Analysis stopped.', 'AbortError'));
      const timeout = setTimeout(() => stop(new Error('Local audio analysis timed out.')), 30000);
      timeout.unref();
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
      child.stdout.on('data', (chunk) => {
        if (failure) return;
        size += chunk.length;
        if (size > ANALYSIS_MAX_BYTES) { stop(new Error('The analysis sample exceeded its window.')); return; }
        chunks.push(chunk);
      });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
      child.once('error', error => { failure = error; });
      child.once('close', code => {
        clearTimeout(timeout); clearTimeout(killTimer);
        signal?.removeEventListener('abort', abort);
        if (this.child === child) { this.child = null; this.cancelActive = null; }
        if (failure) { reject(failure); return; }
        if (code !== 0 || !size || size % 4) { reject(new Error(stderr || 'No analyzable audio was returned.')); return; }
        resolve(Buffer.concat(chunks, size));
      });
    });
  }

  stop() { this.stopping = true; this.cancelActive?.(); return this.closed || Promise.resolve(); }
}
