import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, stat } from "node:fs/promises";

export const GSX_MAGIC = "GSXS";
export const GSX_FORMAT_VERSION = 1;
export const GSX_HEADER_SIZE = 128;
export const GSX_ALIGNMENT = 4096;
export const GSX_ENCODING_PROFILES = Object.freeze({
  quality: Object.freeze({ id: "quality-aac-v1", instrumentalBitrate: 160_000, vocalsBitrate: 80_000 }),
  balanced: Object.freeze({ id: "balanced-aac-v1", instrumentalBitrate: 128_000, vocalsBitrate: 64_000 }),
  compact: Object.freeze({ id: "compact-aac-v1", instrumentalBitrate: 96_000, vocalsBitrate: 48_000 })
});
export const GSX_DEFAULT_PROFILE = GSX_ENCODING_PROFILES.balanced;

const COMPLETE_FLAG = 1;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

function align(value, boundary = GSX_ALIGNMENT) {
  return Math.ceil(value / boundary) * boundary;
}

function integer(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

function sha256(value) {
  return createHash("sha256").update(value).digest();
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    bytes += chunk.length;
    hash.update(chunk);
  }
  return { bytes, checksum: hash.digest("hex") };
}

async function copyInto(sourcePath, destination, offset) {
  let written = 0;
  for await (const chunk of createReadStream(sourcePath)) {
    await destination.write(chunk, 0, chunk.length, offset + written);
    written += chunk.length;
  }
  return written;
}

function seekIndex(sampleRate, frameCount, packetFrames = 1024) {
  const rate = Math.max(1, integer(sampleRate, 44_100));
  const frames = Math.max(0, integer(frameCount));
  const packetSize = Math.max(1, integer(packetFrames, 1024));
  const entries = [];
  for (let pcmFrame = 0; pcmFrame < frames; pcmFrame += rate) {
    entries.push([pcmFrame, Math.floor(pcmFrame / packetSize)]);
  }
  if (!entries.length || entries.at(-1)[0] !== frames) entries.push([frames, Math.floor(frames / packetSize)]);
  return entries;
}

function streamManifest(kind, details, file, offset) {
  const sampleRate = Math.max(1, integer(details?.sampleRate, 44_100));
  const durationSeconds = Math.max(0, Number(details?.durationSeconds) || 0);
  const frameCount = Math.max(1, integer(details?.frameCount, Math.round(durationSeconds * sampleRate)));
  const packetFrames = Math.max(1, integer(details?.packetFrames, 1024));
  return {
    kind,
    codec: String(details?.codec || "aac-lc"),
    bitrate: Math.max(1, integer(details?.bitrate)),
    sampleRate,
    channels: Math.max(1, integer(details?.channels, 2)),
    durationSeconds,
    frameCount,
    packetFrames,
    offset,
    length: file.bytes,
    checksum: file.checksum,
    seekIndex: seekIndex(sampleRate, frameCount, packetFrames)
  };
}

function buildHeader({ manifest, fileLength, instrumental, vocals }) {
  const header = Buffer.alloc(GSX_HEADER_SIZE);
  header.write(GSX_MAGIC, 0, 4, "ascii");
  header.writeUInt16LE(GSX_FORMAT_VERSION, 4);
  header.writeUInt16LE(COMPLETE_FLAG, 6);
  header.writeUInt32LE(GSX_HEADER_SIZE, 8);
  header.writeUInt32LE(manifest.length, 12);
  header.writeBigUInt64LE(BigInt(fileLength), 16);
  header.writeBigUInt64LE(BigInt(GSX_HEADER_SIZE), 24);
  header.writeBigUInt64LE(BigInt(instrumental.offset), 32);
  header.writeBigUInt64LE(BigInt(instrumental.length), 40);
  header.writeBigUInt64LE(BigInt(vocals.offset), 48);
  header.writeBigUInt64LE(BigInt(vocals.length), 56);
  sha256(manifest).copy(header, 64);
  sha256(header.subarray(0, 96)).copy(header, 96);
  return header;
}

function parseHeader(header) {
  if (header.length !== GSX_HEADER_SIZE || header.toString("ascii", 0, 4) !== GSX_MAGIC) throw new Error("gsx_magic_invalid");
  const version = header.readUInt16LE(4);
  if (version !== GSX_FORMAT_VERSION) throw new Error("gsx_version_unsupported");
  if ((header.readUInt16LE(6) & COMPLETE_FLAG) === 0) throw new Error("gsx_incomplete");
  if (header.readUInt32LE(8) !== GSX_HEADER_SIZE) throw new Error("gsx_header_size_invalid");
  if (!sha256(header.subarray(0, 96)).equals(header.subarray(96, 128))) throw new Error("gsx_header_checksum_mismatch");
  const numberAt = (offset) => {
    const value = Number(header.readBigUInt64LE(offset));
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("gsx_offset_invalid");
    return value;
  };
  return {
    version,
    manifestLength: header.readUInt32LE(12),
    fileLength: numberAt(16),
    manifestOffset: numberAt(24),
    instrumentalOffset: numberAt(32),
    instrumentalLength: numberAt(40),
    vocalsOffset: numberAt(48),
    vocalsLength: numberAt(56),
    manifestChecksum: header.subarray(64, 96).toString("hex")
  };
}

export function gsxCacheKey({ sourceHash, separationModel, separationModelVersion, encodingProfile = GSX_DEFAULT_PROFILE.id } = {}) {
  return createHash("sha256").update([
    `gsx-v${GSX_FORMAT_VERSION}`,
    String(sourceHash || "").trim(),
    String(separationModel || "").trim().toLowerCase(),
    String(separationModelVersion || "").trim(),
    String(encodingProfile || "").trim()
  ].join("|")).digest("hex").slice(0, 40);
}

export async function writeGSXStems({
  destination,
  sourceHash,
  sourceSize = 0,
  sourceDurationSeconds = 0,
  separationModel,
  separationModelVersion,
  encodingProfile = GSX_DEFAULT_PROFILE.id,
  instrumentalPath,
  vocalsPath,
  instrumental,
  vocals,
  createdAt = new Date().toISOString()
} = {}) {
  const [instrumentalFile, vocalsFile] = await Promise.all([hashFile(instrumentalPath), hashFile(vocalsPath)]);
  let payloadOffset = GSX_ALIGNMENT;
  let manifest;
  let encodedManifest;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const instrumentalStream = streamManifest("instrumental", instrumental, instrumentalFile, payloadOffset);
    const vocalsStream = streamManifest("vocals", vocals, vocalsFile, align(instrumentalStream.offset + instrumentalStream.length));
    manifest = {
      format: "Guest Star Stems",
      formatVersion: GSX_FORMAT_VERSION,
      complete: true,
      sourceHash: String(sourceHash || ""),
      sourceSize: Math.max(0, Number(sourceSize) || 0),
      durationSeconds: Math.max(0, Number(sourceDurationSeconds) || Math.max(instrumentalStream.durationSeconds, vocalsStream.durationSeconds)),
      createdAt,
      separationModel: String(separationModel || ""),
      separationModelVersion: String(separationModelVersion || ""),
      encodingProfile: String(encodingProfile || ""),
      streams: { instrumental: instrumentalStream, vocals: vocalsStream }
    };
    encodedManifest = Buffer.from(JSON.stringify(manifest), "utf8");
    if (encodedManifest.length > MAX_MANIFEST_BYTES) throw new Error("gsx_manifest_too_large");
    const nextOffset = align(GSX_HEADER_SIZE + encodedManifest.length);
    if (nextOffset === payloadOffset) break;
    payloadOffset = nextOffset;
  }
  const instrumentalStream = manifest.streams.instrumental;
  const vocalsStream = manifest.streams.vocals;
  const fileLength = vocalsStream.offset + vocalsStream.length;
  const header = buildHeader({ manifest: encodedManifest, fileLength, instrumental: instrumentalStream, vocals: vocalsStream });
  const handle = await open(destination, "wx", 0o600);
  try {
    await handle.write(header, 0, header.length, 0);
    await handle.write(encodedManifest, 0, encodedManifest.length, GSX_HEADER_SIZE);
    await handle.truncate(fileLength);
    if (await copyInto(instrumentalPath, handle, instrumentalStream.offset) !== instrumentalStream.length) throw new Error("gsx_instrumental_copy_incomplete");
    if (await copyInto(vocalsPath, handle, vocalsStream.offset) !== vocalsStream.length) throw new Error("gsx_vocals_copy_incomplete");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return { header: parseHeader(header), manifest, size: fileLength };
}

async function readExact(handle, length, position) {
  const buffer = Buffer.alloc(length);
  const { bytesRead } = await handle.read(buffer, 0, length, position);
  if (bytesRead !== length) throw new Error("gsx_truncated");
  return buffer;
}

function validateStream(stream, header, fileSize) {
  if (!stream || typeof stream !== "object") throw new Error("gsx_stream_missing");
  if (!Number.isSafeInteger(stream.offset) || !Number.isSafeInteger(stream.length) || stream.length < 1024 || stream.offset < GSX_HEADER_SIZE || stream.offset + stream.length > fileSize) throw new Error("gsx_stream_bounds_invalid");
  const offset = stream.kind === "vocals" ? header.vocalsOffset : header.instrumentalOffset;
  const length = stream.kind === "vocals" ? header.vocalsLength : header.instrumentalLength;
  if (stream.offset !== offset || stream.length !== length) throw new Error("gsx_stream_header_mismatch");
  if (stream.codec !== "aac-lc" || stream.sampleRate <= 0 || stream.channels <= 0 || stream.durationSeconds <= 1) throw new Error("gsx_stream_metadata_invalid");
  if (!Array.isArray(stream.seekIndex) || !stream.seekIndex.length || stream.seekIndex[0]?.[0] !== 0) throw new Error("gsx_seek_index_invalid");
}

export async function readGSXStems(filePath, { verifyChecksums = true } = {}) {
  const info = await stat(filePath);
  if (!info.isFile() || info.size < GSX_HEADER_SIZE + 2048) throw new Error("gsx_missing_or_small");
  const handle = await open(filePath, "r");
  try {
    const headerBuffer = await readExact(handle, GSX_HEADER_SIZE, 0);
    const header = parseHeader(headerBuffer);
    if (header.fileLength !== info.size) throw new Error("gsx_file_length_mismatch");
    if (header.manifestOffset !== GSX_HEADER_SIZE || header.manifestLength <= 2 || header.manifestLength > MAX_MANIFEST_BYTES) throw new Error("gsx_manifest_bounds_invalid");
    const manifestBuffer = await readExact(handle, header.manifestLength, header.manifestOffset);
    if (sha256(manifestBuffer).toString("hex") !== header.manifestChecksum) throw new Error("gsx_manifest_checksum_mismatch");
    let manifest;
    try { manifest = JSON.parse(manifestBuffer.toString("utf8")); } catch { throw new Error("gsx_manifest_invalid_json"); }
    if (manifest?.complete !== true || Number(manifest?.formatVersion) !== GSX_FORMAT_VERSION) throw new Error("gsx_manifest_invalid");
    const instrumental = manifest.streams?.instrumental;
    const vocals = manifest.streams?.vocals;
    validateStream(instrumental, header, info.size);
    validateStream(vocals, header, info.size);
    if (Math.abs(Number(instrumental.durationSeconds) - Number(vocals.durationSeconds)) >= 1.5) throw new Error("gsx_duration_mismatch");
    if (verifyChecksums) {
      for (const stream of [instrumental, vocals]) {
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(filePath, { start: stream.offset, end: stream.offset + stream.length - 1 })) hash.update(chunk);
        if (hash.digest("hex") !== stream.checksum) throw new Error(`gsx_${stream.kind}_checksum_mismatch`);
      }
    }
    return { valid: true, path: filePath, size: info.size, header, manifest };
  } finally {
    await handle.close();
  }
}

export async function inspectGSXStems(filePath, expected = {}) {
  try {
    const result = await readGSXStems(filePath, { verifyChecksums: expected.verifyChecksums !== false });
    const manifest = result.manifest;
    if (expected.sourceHash && manifest.sourceHash !== expected.sourceHash) throw new Error("gsx_source_hash_mismatch");
    if (expected.separationModel && manifest.separationModel !== expected.separationModel) throw new Error("gsx_model_mismatch");
    if (expected.separationModelVersion && manifest.separationModelVersion !== expected.separationModelVersion) throw new Error("gsx_model_version_mismatch");
    if (expected.encodingProfile && manifest.encodingProfile !== expected.encodingProfile) throw new Error("gsx_encoding_profile_mismatch");
    return result;
  } catch (error) {
    return { valid: false, path: filePath, reason: String(error?.message || "gsx_invalid") };
  }
}

export async function streamGSXStem(request, response, filePath, kind, inspected = null) {
  const gsx = inspected?.valid ? inspected : await readGSXStems(filePath, { verifyChecksums: false });
  const stream = gsx.manifest.streams?.[kind];
  if (!stream) throw new Error("gsx_stream_missing");
  const requested = String(request.headers.range || "").match(/^bytes=(\d*)-(\d*)$/);
  let start = 0;
  let end = stream.length - 1;
  let status = 200;
  if (requested) {
    start = requested[1] ? Number(requested[1]) : 0;
    end = requested[2] ? Math.min(Number(requested[2]), stream.length - 1) : stream.length - 1;
    status = 206;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= stream.length) {
    response.writeHead(416, { "Content-Range": `bytes */${stream.length}` });
    response.end();
    return;
  }
  const headers = {
    "Content-Type": "audio/mp4",
    "Content-Length": end - start + 1,
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
    "X-Guest-Star-Stem-Container": `GSXS/${GSX_FORMAT_VERSION}`
  };
  if (status === 206) headers["Content-Range"] = `bytes ${start}-${end}/${stream.length}`;
  response.writeHead(status, headers);
  createReadStream(filePath, { start: stream.offset + start, end: stream.offset + end }).pipe(response);
}
