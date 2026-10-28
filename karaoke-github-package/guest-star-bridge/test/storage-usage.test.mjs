import assert from "node:assert/strict";
import test from "node:test";
import { chmod, lstat, mkdir, mkdtemp, open, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { directoryUsage, inspectSongStorage, revealSongStorageLocation, songStorageLocations } from "../src/storage-usage.mjs";
import { formatStorageBytes } from "../public/storage-preferences.js";

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "guest-star-storage-test-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = join(root, "library");
  const temporaryRoot = join(root, "temporary");
  await Promise.all([mkdir(library), mkdir(temporaryRoot)]);
  return { root, library, temporaryRoot, cache: join(library, ".guest-star-stems") };
}

test("storage: absent and empty folders measure zero without creating them", async (t) => {
  const f = await fixture(t);
  assert.deepEqual(await directoryUsage(f.cache), { exists: false, bytes: 0, files: 0, directories: 0 });
  const usage = await inspectSongStorage({ libraryFolders: [f.library], temporaryRoot: f.temporaryRoot });
  assert.equal(usage.totalBytes, 0);
  assert.equal(usage.complete, true);
  await assert.rejects(lstat(f.cache), { code: "ENOENT" });
  await mkdir(f.cache);
  assert.deepEqual(await directoryUsage(f.cache), { exists: true, bytes: 0, files: 0, directories: 1 });
});

test("storage: nested stems, legacy files, work files and native audio only; originals excluded", async (t) => {
  const f = await fixture(t);
  const entry = join(f.cache, "v3", "entry");
  const work = join(f.cache, ".work-test");
  const native = join(f.temporaryRoot, "GuestStarNativeAudio");
  await Promise.all([mkdir(entry, { recursive: true }), mkdir(work, { recursive: true }), mkdir(native)]);
  await Promise.all([
    writeFile(join(entry, "instrumental.m4a"), Buffer.alloc(1300)),
    writeFile(join(entry, "vocals.m4a"), Buffer.alloc(700)),
    writeFile(join(entry, "manifest.json"), "{}"),
    writeFile(join(work, "input.wav"), Buffer.alloc(2100)),
    writeFile(join(native, "karaoke-fixture.media"), Buffer.alloc(900)),
    writeFile(join(f.library, "original.mp4"), Buffer.alloc(100000)),
    writeFile(join(f.temporaryRoot, "unrelated.wav"), Buffer.alloc(100000))
  ]);
  const before = await lstat(join(entry, "instrumental.m4a"));
  const usage = await inspectSongStorage({ libraryFolders: [f.library], temporaryRoot: f.temporaryRoot });
  assert.equal(usage.totalBytes, 5002);
  assert.deepEqual(usage.locations.map((location) => location.bytes), [4102, 900]);
  assert.equal(usage.locations[0].files, 4);
  const after = await lstat(join(entry, "instrumental.m4a"));
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.deepEqual(await readFile(join(entry, "instrumental.m4a")), Buffer.alloc(1300));
});

test("storage: folder aliases deduplicate and IDs remain stable when libraries reorder", async (t) => {
  const f = await fixture(t);
  const alias = join(f.root, "alias");
  await symlink(f.library, alias);
  const a = await songStorageLocations({ libraryFolders: [f.library, alias, f.library], temporaryRoot: f.temporaryRoot });
  assert.equal(a.length, 2);
  const other = join(f.root, "other");
  await mkdir(other);
  const b = await songStorageLocations({ libraryFolders: [other, f.library], temporaryRoot: f.temporaryRoot });
  assert.equal(a[0].id, b[1].id);
});

test("storage: symbolic links never add external files or enter cycles", async (t) => {
  const f = await fixture(t);
  await mkdir(f.cache);
  await writeFile(join(f.library, "original.mp4"), Buffer.alloc(100000));
  await writeFile(join(f.cache, "vocals.m4a"), Buffer.alloc(10));
  await symlink(f.library, join(f.cache, "external-folder"));
  await symlink(join(f.library, "original.mp4"), join(f.cache, "external-file"));
  assert.equal((await directoryUsage(f.cache)).bytes, 10);
  const linkedRoot = join(f.root, "linked-cache");
  await symlink(f.cache, linkedRoot);
  assert.equal((await directoryUsage(linkedRoot)).bytes, 0);
});

test("storage: thousands of files and multi-GB logical sizes do not read media or block the loop", async (t) => {
  const f = await fixture(t);
  await mkdir(f.cache);
  const handle = await open(join(f.cache, "large.media"), "w");
  await handle.truncate(7_000_000_000);
  await handle.close();
  for (let batch = 0; batch < 10; batch += 1) {
    await Promise.all(Array.from({ length: 100 }, (_, index) => writeFile(join(f.cache, `small-${batch}-${index}.json`), "{}")));
  }
  let ticks = 0;
  const timer = setInterval(() => ticks += 1, 1);
  const usage = await directoryUsage(f.cache);
  clearInterval(timer);
  assert.equal(usage.bytes, 7_000_002_000);
  assert.equal(usage.files, 1001);
  assert.ok(ticks > 0, "async directory traversal yields to the event loop");
  assert.equal(formatStorageBytes(usage.bytes, "en"), "7 GB");
});

test("storage: unreadable folder makes total incomplete, not a false zero", async (t) => {
  const f = await fixture(t);
  await mkdir(f.cache);
  await chmod(f.cache, 0o000);
  t.after(() => chmod(f.cache, 0o700).catch(() => {}));
  const usage = await inspectSongStorage({ libraryFolders: [f.library], temporaryRoot: f.temporaryRoot });
  assert.equal(usage.complete, false);
  assert.equal(usage.locations[0].error, "EACCES");
  assert.equal(usage.locations[0].bytes, null);
  await chmod(f.cache, 0o700);
});

test("storage: Finder reveals allowlisted folders only, missing cache reveals parent without mutation", async (t) => {
  const f = await fixture(t);
  const opened = [];
  const options = { libraryFolders: [f.library], temporaryRoot: f.temporaryRoot, platform: "darwin", openDirectory: async (...args) => opened.push(args) };
  const [location] = await songStorageLocations(options);
  assert.equal((await revealSongStorageLocation(location.id, options)).exact, false);
  assert.deepEqual(opened[0], ["/usr/bin/open", ["-a", "Finder", f.library]]);
  await assert.rejects(lstat(f.cache), { code: "ENOENT" });
  await mkdir(f.cache);
  assert.equal((await revealSongStorageLocation(location.id, options)).exact, true);
  assert.deepEqual(opened[1], ["/usr/bin/open", ["-a", "Finder", f.cache]]);
  await assert.rejects(revealSongStorageLocation("/Users/arbitrary", options));
  await assert.rejects(revealSongStorageLocation(location.id, { ...options, platform: "linux" }));
  assert.equal(opened.length, 2);
});

test("storage: decimal KB/MB/GB/TB formatting matches Finder-style units", () => {
  assert.equal(formatStorageBytes(0, "en"), "0 KB");
  assert.equal(formatStorageBytes(842_000, "en"), "842 KB");
  assert.equal(formatStorageBytes(842_000_000, "en"), "842 MB");
  assert.equal(formatStorageBytes(3_400_000_000, "en"), "3.4 GB");
  assert.equal(formatStorageBytes(18_700_000_000, "en"), "18.7 GB");
  assert.equal(formatStorageBytes(3_420_000_000_000, "es"), "3,4 TB");
});
