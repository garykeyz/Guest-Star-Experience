import { createHash } from "node:crypto";

const STEM_ENGINES = new Set(["auto", "spleeter", "demucs"]);
const RESOURCE_STATES = new Set(["IDLE", "LIVE", "PRESSURE"]);

export const STEM_CACHE_FORMAT_VERSION = 3;
export const STEM_MODEL_VERSIONS = Object.freeze({
  spleeter: "sherpa-onnx-spleeter-2stems-fp16-v1",
  demucs: "demucs-js-1.0.0-default-v1"
});

export function normalizeStemEngine(value, fallback = "auto") {
  const normalized = String(value || "").trim().toLowerCase();
  return STEM_ENGINES.has(normalized) ? normalized : fallback;
}

export function stemJobKey(requestId, engine) {
  return `${String(requestId || "").trim()}:${normalizeStemEngine(engine, "spleeter")}`;
}

export function stemCacheKey(fingerprint, engine, modelVersion) {
  const normalizedEngine = normalizeStemEngine(engine, "spleeter");
  if (normalizedEngine === "auto") throw new Error("Auto is not a cache engine.");
  return createHash("sha256").update([
    `stems-v${STEM_CACHE_FORMAT_VERSION}`,
    String(fingerprint || "").trim(),
    normalizedEngine,
    String(modelVersion || STEM_MODEL_VERSIONS[normalizedEngine]).trim()
  ].join("|")).digest("hex").slice(0, 40);
}

export function validateStemManifest({
  manifest,
  fingerprint,
  engine,
  modelVersion,
  instrumental,
  vocals,
  measuredDurations
} = {}) {
  const expectedEngine = normalizeStemEngine(engine, "spleeter");
  const expectedModel = String(modelVersion || STEM_MODEL_VERSIONS[expectedEngine] || "");
  if (!manifest || typeof manifest !== "object") return { valid: false, reason: "manifest_missing" };
  if (manifest.complete !== true || Number(manifest.formatVersion) !== STEM_CACHE_FORMAT_VERSION) {
    return { valid: false, reason: "manifest_incomplete" };
  }
  if (String(manifest.fingerprint || "") !== String(fingerprint || "")) {
    return { valid: false, reason: "fingerprint_mismatch" };
  }
  if (normalizeStemEngine(manifest.engine, "") !== expectedEngine) {
    return { valid: false, reason: "engine_mismatch" };
  }
  if (String(manifest.modelVersion || "") !== expectedModel) {
    return { valid: false, reason: "model_version_mismatch" };
  }
  const expectedOutputs = manifest.outputs || {};
  const files = [
    ["instrumental", instrumental, expectedOutputs.instrumental],
    ["vocals", vocals, expectedOutputs.vocals]
  ];
  for (const [kind, actual, expected] of files) {
    if (!actual?.isFile || Number(actual.size) < 1024) {
      return { valid: false, reason: `${kind}_missing_or_small` };
    }
    if (!expected || expected.file !== `${kind}.m4a` || Number(expected.size) !== Number(actual.size)) {
      return { valid: false, reason: `${kind}_manifest_mismatch` };
    }
  }
  const durations = measuredDurations || {
    instrumental: Number(expectedOutputs.instrumental?.durationSeconds),
    vocals: Number(expectedOutputs.vocals?.durationSeconds)
  };
  const instrumentalDuration = Number(durations.instrumental);
  const vocalsDuration = Number(durations.vocals);
  if (
    !Number.isFinite(instrumentalDuration) || instrumentalDuration <= 1 ||
    !Number.isFinite(vocalsDuration) || vocalsDuration <= 1 ||
    Math.abs(instrumentalDuration - vocalsDuration) >= 1.5
  ) {
    return { valid: false, reason: "duration_invalid" };
  }
  const sourceDuration = Number(manifest.source?.durationSeconds);
  if (
    Number.isFinite(sourceDuration) && sourceDuration > 1 &&
    Math.abs(sourceDuration - instrumentalDuration) >= 2
  ) {
    return { valid: false, reason: "source_duration_mismatch" };
  }
  return {
    valid: true,
    reason: "valid",
    durations: { instrumental: instrumentalDuration, vocals: vocalsDuration }
  };
}

export function bestCachedStem(cache = {}) {
  if (cache.demucs === true) return "demucs";
  if (cache.spleeter === true) return "spleeter";
  return "original";
}

export function autoStemPlan(cache = {}) {
  if (cache.demucs === true) {
    return { ready: true, source: "demucs", prepare: [], improving: false };
  }
  if (cache.spleeter === true) {
    return { ready: true, source: "spleeter", prepare: ["demucs"], improving: true };
  }
  return {
    ready: false,
    source: "original",
    prepare: ["spleeter", "demucs"],
    improving: false
  };
}

export function stemSourceForIntent({ intent = "auto", cache = {}, lockedSource = "" } = {}) {
  if (["original", "spleeter", "demucs"].includes(lockedSource)) return lockedSource;
  const normalized = normalizeStemEngine(intent, "auto");
  if (normalized === "spleeter") return cache.spleeter === true ? "spleeter" : "original";
  if (normalized === "demucs") return cache.demucs === true ? "demucs" : "original";
  return bestCachedStem(cache);
}

export function estimateTurnSeconds({
  requestId,
  queue = [],
  currentRequestId = "",
  currentTimeSeconds = 0,
  currentDurationSeconds = 0,
  transitionSeconds = 30,
  defaultDurationSeconds = 240
} = {}) {
  const target = String(requestId || "");
  const rows = Array.isArray(queue) ? queue : [];
  const targetIndex = rows.findIndex((item) => String(item?.id || "") === target);
  if (targetIndex < 0) return Number.POSITIVE_INFINITY;

  let seconds = 0;
  const currentIndex = rows.findIndex((item) =>
    String(item?.id || "") === String(currentRequestId || "")
  );
  let startIndex = 0;
  if (currentIndex >= 0 && currentIndex < targetIndex) {
    const currentDuration = Math.max(
      0,
      Number(currentDurationSeconds) ||
        Number(rows[currentIndex]?.durationSeconds) ||
        Number(defaultDurationSeconds) ||
        240
    );
    seconds += Math.max(0, currentDuration - Math.max(0, Number(currentTimeSeconds) || 0));
    startIndex = currentIndex + 1;
  }
  for (let index = startIndex; index < targetIndex; index += 1) {
    seconds += Math.max(
      1,
      Number(rows[index]?.durationSeconds) || Number(defaultDurationSeconds) || 240
    );
    seconds += Math.max(
      0,
      Number(rows[index]?.transitionSeconds) || Number(transitionSeconds) || 0
    );
  }
  return Math.round(seconds);
}

export function detectStemResourceState(signals = {}) {
  const contextState = String(signals.audioContextState || "").toLowerCase();
  const mediaState = String(signals.mediaState || "").toLowerCase();
  const pressure = signals.memoryPressure === true ||
    signals.audioRecovering === true ||
    signals.audioOutputLost === true ||
    ["suspended", "interrupted", "closed"].includes(contextState) ||
    ["waiting", "stalled", "error"].includes(mediaState) ||
    Number(signals.cpuLoadRatio) >= 0.9;
  if (pressure) return "PRESSURE";
  if (signals.karaokeActive === true || signals.videoActive === true || signals.backgroundActive === true) return "LIVE";
  return "IDLE";
}

export function demucsExecutionBudget(logicalCores, resourceState) {
  const cores = Math.max(1, Math.floor(Number(logicalCores) || 1));
  const state = RESOURCE_STATES.has(resourceState) ? resourceState : "IDLE";
  if (state === "PRESSURE") {
    return {
      resourceState: state,
      maxHeavyJobs: 0,
      workerProcesses: 0,
      internalThreads: null,
      osPriority: 19,
      paused: true
    };
  }
  return {
    resourceState: state,
    maxHeavyJobs: 1,
    workerProcesses: 1,
    // demucs-js 1.x does not expose an actual CPU thread-count option. Keep
    // this null instead of presenting an invented value in UI/diagnostics.
    internalThreads: null,
    recommendedThreadCeiling: state === "LIVE"
      ? Math.max(1, Math.min(2, Math.floor(cores * 0.25)))
      : Math.max(1, Math.floor(cores / 2)),
    osPriority: state === "LIVE" ? 19 : 10,
    paused: false
  };
}

export function spleeterExecutionBudget(logicalCores, resourceState) {
  const cores = Math.max(1, Math.floor(Number(logicalCores) || 1));
  const state = RESOURCE_STATES.has(resourceState) ? resourceState : "IDLE";
  const numThreads = state === "LIVE"
    ? Math.max(1, Math.min(2, Math.floor(cores * 0.25)))
    : state === "PRESSURE"
      ? 1
      : Math.max(1, Math.min(4, Math.floor(cores / 2)));
  return {
    resourceState: state,
    maxJobs: state === "PRESSURE" ? 0 : 1,
    numThreads,
    osPriority: state === "IDLE" ? 10 : 19,
    paused: state === "PRESSURE"
  };
}

export function prioritizeStemJobs(jobs = []) {
  const rank = (job) => {
    if (job.engine === "spleeter" && job.required !== false) return 0;
    if (job.engine === "spleeter") return 1;
    if (job.engine === "demucs" && job.intent === "demucs") return 2;
    return 3;
  };
  return (Array.isArray(jobs) ? jobs : [])
    .filter((job) => job?.status === "queued")
    .sort((left, right) =>
      rank(left) - rank(right) ||
      Number(left.estimatedTurnSeconds ?? Number.POSITIVE_INFINITY) -
        Number(right.estimatedTurnSeconds ?? Number.POSITIVE_INFINITY) ||
      Date.parse(left.requestedAt || "") - Date.parse(right.requestedAt || "") ||
      String(left.id || "").localeCompare(String(right.id || ""))
    );
}

export class StemResourceController {
  constructor({ now = () => Date.now(), promoteAfterMs = 8000 } = {}) {
    this.now = now;
    this.promoteAfterMs = Math.max(1000, Number(promoteAfterMs) || 8000);
    this.state = "IDLE";
    this.candidate = "";
    this.candidateSince = 0;
    this.changedAt = this.now();
  }

  update(signals = {}) {
    const desired = detectStemResourceState(signals);
    const timestamp = this.now();
    if (desired === this.state) {
      this.candidate = "";
      this.candidateSince = 0;
      return { state: this.state, changed: false, desired };
    }

    const severity = { IDLE: 0, LIVE: 1, PRESSURE: 2 };
    if (severity[desired] > severity[this.state]) {
      const previous = this.state;
      this.state = desired;
      this.changedAt = timestamp;
      this.candidate = "";
      this.candidateSince = 0;
      return { state: this.state, previous, changed: true, desired };
    }

    if (this.candidate !== desired) {
      this.candidate = desired;
      this.candidateSince = timestamp;
      return { state: this.state, changed: false, desired };
    }
    if (timestamp - this.candidateSince < this.promoteAfterMs) {
      return { state: this.state, changed: false, desired };
    }
    const previous = this.state;
    // Recover capacity one level at a time. A system that was under pressure
    // must prove stability in LIVE before returning to the wider IDLE budget.
    this.state = previous === "PRESSURE" && desired === "IDLE" ? "LIVE" : desired;
    this.changedAt = timestamp;
    this.candidate = "";
    this.candidateSince = 0;
    return { state: this.state, previous, changed: true, desired };
  }
}
