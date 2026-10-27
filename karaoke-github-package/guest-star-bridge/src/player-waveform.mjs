import {spawn} from 'node:child_process';
import {readFile, mkdir, writeFile, rename} from 'node:fs/promises';
import {resolve} from 'node:path';
import {setPriority} from 'node:os';

// Independent of lyrics. One byte per peak at 20 and 80 bins/second keeps a
// 30-minute recording below 180 KiB before JSON/base64 overhead.
export const WAVEFORM_VERSION = 1;
export class PlayerWaveformCache {
  constructor({root, ffmpegPath, identityStore} = {}) {
    Object.assign(this, {root, ffmpegPath, identityStore});
    this.pending = new Map(); this.errors = new Map(); this.queue = Promise.resolve(); this.closed = false; this.child=null;
  }
  path(fingerprint) { return resolve(this.root, 'waveforms', `${fingerprint}.json`); }
  async read(fingerprint) {
    try {
      const data = JSON.parse(await readFile(this.path(fingerprint), 'utf8'));
      if (data.version !== WAVEFORM_VERSION || data.fingerprint !== fingerprint || !Array.isArray(data.levels) || data.levels.length !== 2 ||
          data.levels.some(level => ![20,80].includes(level.rate) || !Number.isInteger(level.bins) || level.bins < 1 || level.bins > 2_000_000 ||
            Buffer.from(level.peaks || '', 'base64').length !== level.bins)) return null;
      return data;
    } catch { return null; }
  }
  async request(file) {
    this.identityStore.ffmpegPath = this.ffmpegPath;
    const recording = await this.identityStore.identify(file);
    const key = recording.fingerprint;
    const saved = await this.read(key);
    if (saved) return {status:'ready', cacheHit:true, ...saved};
    if(this.errors.has(key))return {status:'error',fingerprint:key,error:this.errors.get(key)};
    if (!this.pending.has(key)) {
      const task = this.queue.catch(()=>{}).then(() => this.generate(file, recording)).catch(error=>{this.errors.set(key,String(error.message||error));return null;}).finally(() => this.pending.delete(key));
      this.pending.set(key, task); this.queue = task;
    }
    return {status:'preparing', fingerprint:key, duration:recording.durationSeconds, version:WAVEFORM_VERSION};
  }
  async wait(fingerprint) { return this.pending.get(fingerprint); }
  async generate(file, recording) {
    if (this.closed) throw new Error('Waveform cache closed');
    const rate = 8000, samplesPerBin = 100; // 80 detailed bins/s
    const duration = recording.durationSeconds;
    if (!(duration > 0) || duration > 8 * 3600) throw new Error('Unsupported waveform duration');
    const bins = Math.ceil(duration * 80) + 1;
    const detailed = new Uint8Array(bins);
    const child = spawn(this.ffmpegPath, ['-v','error','-nostdin','-threads','1','-filter_threads','1','-i',file,'-vn','-ac','1','-ar',String(rate),'-f','s16le','pipe:1'], {stdio:['ignore','pipe','ignore'],env:{...process.env,VECLIB_MAXIMUM_THREADS:'1',OMP_NUM_THREADS:'1'}});
    this.child=child;
    try { setPriority(child.pid, 15); } catch {}
    let sample = 0, peak = 0, byteTail = null;
    child.stdout.on('data', chunk => {
      let offset = 0;
      if (byteTail !== null && chunk.length) { const value = ((chunk[0] << 8) | byteTail); peak = Math.max(peak, Math.abs(value & 0x8000 ? value - 0x10000 : value)); sample++; offset = 1; byteTail = null; }
      for (; offset + 1 < chunk.length; offset += 2) {
        peak = Math.max(peak, Math.abs(chunk.readInt16LE(offset))); sample++;
        if (sample % samplesPerBin === 0) { const index = Math.floor(sample / samplesPerBin) - 1; if (index < bins) detailed[index] = Math.min(255, Math.round(255 * peak / 32768)); peak = 0; }
      }
      if (offset < chunk.length) byteTail = chunk[offset];
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 120000); timer.unref();
    try { await new Promise((yes,no) => {child.once('error',no);child.once('close',code => code===0 ? yes() : no(new Error('Waveform decoder failed')));}); }
    finally {clearTimeout(timer);if(this.child===child)this.child=null;}
    if (sample % samplesPerBin) detailed[Math.floor(sample / samplesPerBin)] = Math.min(255,Math.round(255 * peak / 32768));
    const count = Math.ceil(sample / samplesPerBin);
    const overview = new Uint8Array(Math.ceil(count / 4));
    for (let i=0;i<count;i++) overview[Math.floor(i/4)] = Math.max(overview[Math.floor(i/4)], detailed[i]);
    const result = {version:WAVEFORM_VERSION, fingerprint:recording.fingerprint, duration, createdAt:new Date().toISOString(),
      levels:[{rate:20,bins:overview.length,peaks:Buffer.from(overview).toString('base64')},{rate:80,bins:count,peaks:Buffer.from(detailed.subarray(0,count)).toString('base64')}]};
    if (this.root) {const path=this.path(recording.fingerprint);await mkdir(resolve(this.root,'waveforms'),{recursive:true});await writeFile(path+'.tmp',JSON.stringify(result));await rename(path+'.tmp',path);}
    return result;
  }
  close() { this.closed = true;this.child?.kill('SIGKILL'); }
}
