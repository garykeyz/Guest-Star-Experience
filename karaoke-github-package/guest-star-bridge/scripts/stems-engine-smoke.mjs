import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const engineRoot = resolve(process.argv[2] || "");
assert.notEqual(engineRoot, resolve(""), "Pass the installed Guest Star stem-engine folder.");

const engineRequire = createRequire(resolve(engineRoot, "package.json"));
const ffmpeg = String(engineRequire("ffmpeg-static") || "");
const ffprobe = String(engineRequire("ffprobe-static")?.path || "");
const demucsCli = resolve(engineRoot, "node_modules", "demucs", "dist", "cli.js");
const workDir = await mkdtemp(join(tmpdir(), "guest-star-stems-smoke-"));
const environment = {
  ...process.env,
  OMP_NUM_THREADS: "1",
  MKL_NUM_THREADS: "1",
  OPENBLAS_NUM_THREADS: "1",
  VECLIB_MAXIMUM_THREADS: "1",
  UV_THREADPOOL_SIZE: "1"
};

async function run(command, args, timeout = 300_000) {
  return execFileAsync(command, args, {
    env: environment,
    timeout,
    maxBuffer: 16 * 1024 * 1024
  });
}

async function duration(filePath) {
  const { stdout } = await run(ffprobe, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=nw=1:nk=1",
    filePath
  ], 30_000);
  return Number(String(stdout).trim()) || 0;
}

try {
  const input = join(workDir, "input.wav");
  const separated = join(workDir, "separated");
  const instrumental = join(workDir, "instrumental.m4a");
  const vocals = join(workDir, "vocals.m4a");

  await run(ffmpeg, [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "sine=frequency=220:duration=12",
    "-f", "lavfi", "-i", "sine=frequency=880:duration=12",
    "-filter_complex", "[0:a][1:a]amix=inputs=2:normalize=0[a]",
    "-map", "[a]", "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le",
    input
  ], 30_000);

  await run(process.execPath, [
    demucsCli, input, "--output", separated, "--overlap", "0.10"
  ]);

  const parts = join(separated, "input");
  await run(ffmpeg, [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-i", join(parts, "drums.wav"),
    "-i", join(parts, "bass.wav"),
    "-i", join(parts, "other.wav"),
    "-filter_complex", "[0:a][1:a][2:a]amix=inputs=3:normalize=0,alimiter=limit=0.95[a]",
    "-map", "[a]", "-c:a", "aac", "-b:a", "256k", "-movflags", "+faststart",
    instrumental
  ], 30_000);
  await run(ffmpeg, [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-i", join(parts, "vocals.wav"),
    "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
    vocals
  ], 30_000);

  const [instrumentalDuration, vocalsDuration, instrumentalInfo, vocalsInfo] = await Promise.all([
    duration(instrumental),
    duration(vocals),
    stat(instrumental),
    stat(vocals)
  ]);
  assert.ok(instrumentalDuration > 10, "The instrumental output is too short.");
  assert.ok(vocalsDuration > 10, "The vocals output is too short.");
  assert.ok(Math.abs(instrumentalDuration - vocalsDuration) < 0.25,
    "The generated tracks are not synchronized.");
  assert.ok(instrumentalInfo.size > 1024 && vocalsInfo.size > 1024,
    "The generated stem files are empty.");

  console.log("Guest Star Stems IA smoke test passed", {
    instrumentalDuration,
    vocalsDuration,
    instrumentalBytes: instrumentalInfo.size,
    vocalsBytes: vocalsInfo.size
  });
} finally {
  await rm(workDir, { recursive: true, force: true });
}
