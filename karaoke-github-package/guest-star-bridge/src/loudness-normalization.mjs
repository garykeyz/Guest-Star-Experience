import { createHash } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { spawn } from "node:child_process";
import { setPriority } from "node:os";

export const LOUDNESS_ANALYSIS_VERSION = 1;
export const AUTO_GAIN_TARGET_OUTPUT_DB = Object.freeze([-12, -9, -6, -3]);

export function normalizeAutoGainTargetOutputDb(value) {
  const candidate = Number(value);
  return AUTO_GAIN_TARGET_OUTPUT_DB.includes(candidate) ? candidate : -6;
}

export function autoGainMusicalTargetLufs(targetOutputDb) {
  return normalizeAutoGainTargetOutputDb(targetOutputDb) - 8;
}

export function calculateAutoGain({
  integratedLufs,
  truePeakDbtp,
  targetLufs,
  targetOutputDb,
  maxBoostDb = 6,
  maxAttenuationDb = 12,
  truePeakCeilingDbtp
} = {}) {
  const loudness = Number(integratedLufs);
  const peak = Number(truePeakDbtp);
  if (!Number.isFinite(loudness) || !Number.isFinite(peak)) {
    return { requiredDb: 0, peakLimitedDb: 0, appliedDb: 0, limitedByPeak: false };
  }
  const finiteOr = (candidate, fallback) => Number.isFinite(Number(candidate)) ? Number(candidate) : fallback;
  const hasOutputTarget = AUTO_GAIN_TARGET_OUTPUT_DB.includes(Number(targetOutputDb));
  const outputTarget = hasOutputTarget ? normalizeAutoGainTargetOutputDb(targetOutputDb) : null;
  const target = hasOutputTarget
    ? autoGainMusicalTargetLufs(outputTarget)
    : Math.max(-18, Math.min(-10, finiteOr(targetLufs, -14)));
  const boost = Math.max(0, Math.min(12, finiteOr(maxBoostDb, 6)));
  const cut = Math.max(0, Math.min(24, finiteOr(maxAttenuationDb, 12)));
  const ceiling = hasOutputTarget
    ? outputTarget
    : Math.max(-3, Math.min(0, finiteOr(truePeakCeilingDbtp, -1)));
  const requiredDb = target - loudness;
  const boundedLoudnessDb = Math.max(-cut, Math.min(boost, requiredDb));
  const peakLimitedDb = ceiling - peak;
  // Peak safety takes priority even if a malformed/already-clipped source
  // needs more attenuation than the configured musical correction limit.
  const appliedDb = Math.min(boundedLoudnessDb, peakLimitedDb);
  return {
    requiredDb,
    peakLimitedDb,
    appliedDb,
    limitedByPeak: appliedDb < boundedLoudnessDb - 0.005
  };
}

export function parseEbur128Summary(output) {
  const text = String(output || "");
  const summaries = [...text.matchAll(/Integrated loudness:\s*[\s\S]*?I:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*LUFS[\s\S]*?True peak:\s*[\s\S]*?Peak:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dBFS/gim)];
  const match = summaries.at(-1);
  if (!match) throw new Error("FFmpeg did not return an EBU R128 loudness summary.");
  const integratedLufs = Number(match[1]);
  const truePeakDbtp = Number(match[2]);
  if (!Number.isFinite(integratedLufs) || !Number.isFinite(truePeakDbtp)) {
    throw new Error("The track does not contain a measurable audio signal.");
  }
  return { integratedLufs, truePeakDbtp };
}

export async function audioFileFingerprint(filePath) {
  const info = await stat(filePath);
  return createHash("sha256")
    .update(`${filePath}\0${info.size}\0${Math.trunc(info.mtimeMs)}\0v${LOUDNESS_ANALYSIS_VERSION}`)
    .digest("hex");
}

export class LoudnessAnalysisStore {
  constructor({ cachePath, ffmpegPath }) {
    this.cachePath = cachePath;
    this.ffmpegPath = ffmpegPath;
    this.loaded = false;
    this.entries = new Map();
    this.tasks = new Map();
    this.writePromise = Promise.resolve();
    // Keep the expensive decoder/filter work strictly serial.  Different
    // tracks can be requested at the same time by the two players, but one
    // low-priority FFmpeg process is enough to warm the persistent cache.
    this.analysisQueue = Promise.resolve();
  }

  async load() {
    if (this.loaded) return;
    this.loaded = true;
    try {
      const saved = JSON.parse(await readFile(this.cachePath, "utf8"));
      if (saved?.version !== LOUDNESS_ANALYSIS_VERSION || !saved.entries) return;
      for (const [fingerprint, entry] of Object.entries(saved.entries)) this.entries.set(fingerprint, entry);
    } catch {
      // Missing or incompatible local cache is expected on first launch.
    }
  }

  async persist() {
    const payload = `${JSON.stringify({
      version: LOUDNESS_ANALYSIS_VERSION,
      updatedAt: new Date().toISOString(),
      entries: Object.fromEntries(this.entries)
    }, null, 2)}\n`;
    this.writePromise = this.writePromise.then(async () => {
      await mkdir(dirname(this.cachePath), { recursive: true });
      const staged = `${this.cachePath}.${process.pid}.tmp`;
      await writeFile(staged, payload, { encoding: "utf8", mode: 0o600 });
      await rename(staged, this.cachePath);
    });
    return this.writePromise;
  }

  async analyze(filePath, { force = false } = {}) {
    await this.load();
    const fingerprint = await audioFileFingerprint(filePath);
    if (!force && this.entries.has(fingerprint)) return { ...this.entries.get(fingerprint), cached: true };
    if (!force && this.tasks.has(fingerprint)) return this.tasks.get(fingerprint);
    const analysis = this.analysisQueue
      .catch(() => {})
      .then(() => this.runFfmpeg(filePath));
    this.analysisQueue = analysis.catch(() => {});
    const task = analysis
      .then(async (measurement) => {
        const entry = {
          fingerprint,
          algorithm: "ITU-R BS.1770-4 / EBU R128 (FFmpeg ebur128)",
          version: LOUDNESS_ANALYSIS_VERSION,
          integratedLufs: measurement.integratedLufs,
          truePeakDbtp: measurement.truePeakDbtp,
          analyzedAt: new Date().toISOString()
        };
        this.entries.set(fingerprint, entry);
        await this.persist();
        return { ...entry, cached: false };
      })
      .finally(() => this.tasks.delete(fingerprint));
    this.tasks.set(fingerprint, task);
    return task;
  }

  runFfmpeg(filePath) {
    if (!this.ffmpegPath) return Promise.reject(new Error("FFmpeg is unavailable for loudness analysis."));
    return new Promise((resolve, reject) => {
      const child = spawn(this.ffmpegPath, [
        "-hide_banner", "-nostats", "-threads", "1", "-i", filePath,
        "-map", "0:a:0", "-filter:a", "ebur128=peak=true:framelog=quiet",
        "-f", "null", "-"
      ], { stdio: ["ignore", "ignore", "pipe"] });
      try { setPriority(child.pid, 19); } catch { /* Best effort. */ }
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-24000); });
      child.once("error", reject);
      child.once("close", (code, signal) => {
        if (Number(code) !== 0) {
          reject(new Error(`Loudness analysis stopped${signal ? ` (${signal})` : ""}: ${stderr.trim().slice(-800)}`));
          return;
        }
        try { resolve(parseEbur128Summary(stderr)); }
        catch (error) { reject(error); }
      });
    });
  }
}
