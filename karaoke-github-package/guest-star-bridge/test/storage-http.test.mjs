import assert from "node:assert/strict";
import test from "node:test";
import { cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("storage HTTP: isolated real endpoints, live update after file changes, no originals and safe reveal", { timeout: 15000 }, async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "guest-star-storage-http-")));
  const library = join(root, "library");
  const temporary = join(root, "temporary");
  await Promise.all([
    cp(new URL("../src", import.meta.url), join(root, "src"), { recursive: true }),
    cp(new URL("../public", import.meta.url), join(root, "public"), { recursive: true }),
    mkdir(join(root, "data")), mkdir(join(root, "stem-engine")), mkdir(library), mkdir(temporary)
  ]);
  // A deliberately unavailable bundled fixture engine prevents real IA execution.
  await writeFile(join(root, "stem-engine", "package.json"), "{}");
  await writeFile(join(root, "package.json"), '{"type":"module"}');
  const reserve = createServer();
  await new Promise((resolve) => reserve.listen(0, "127.0.0.1", resolve));
  const port = reserve.address().port;
  await new Promise((resolve) => reserve.close(resolve));
  await writeFile(join(root, "data", "config.json"), JSON.stringify({ configVersion: 15, bridgePort: port, libraryFolders: [library], appsScriptUrl: "http://127.0.0.1:1", autoQueueExact: false }));
  const original = join(library, "Original - Song.mp4");
  await writeFile(original, Buffer.alloc(100000));
  const before = await lstat(original);
  const child = spawn(process.execPath, [join(root, "src", "server.mjs")], { cwd: root, env: { ...process.env, TMPDIR: temporary, GUEST_STAR_PORT: String(port) }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout.on("data", (chunk) => output += chunk);
  child.stderr.on("data", (chunk) => output += chunk);
  t.after(async () => {
    if (child.exitCode === null) { const exited = once(child, "exit"); child.kill("SIGTERM"); await exited; }
    await rm(root, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`${base}/api/state`)).ok) { ready = true; break; } } catch {}
    if (child.exitCode !== null) throw new Error(output);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(ready, output);
  const get = async () => {
    const response = await fetch(`${base}/api/storage/usage`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "no-store");
    return response.json();
  };
  const empty = await get();
  assert.equal(empty.totalBytes, 0);
  assert.equal(empty.locations.length, 2);
  assert.equal(empty.locations[0].exists, false);
  assert.ok(!("fallbackPath" in empty.locations[0]));
  const cache = join(library, ".guest-star-stems");
  await mkdir(cache);
  await writeFile(join(cache, "instrumental.m4a"), Buffer.alloc(250));
  await mkdir(join(temporary, "GuestStarNativeAudio"));
  await writeFile(join(temporary, "GuestStarNativeAudio", "background.media"), Buffer.alloc(50));
  const updated = await get();
  assert.equal(updated.totalBytes, 300);
  await rm(join(cache, "instrumental.m4a")); // Test-owned fixture only.
  assert.equal((await get()).totalBytes, 50);
  const invalid = await fetch(`${base}/api/storage/reveal`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: original }) });
  assert.equal(invalid.status, 400);
  const wrongOrigin = await fetch(`${base}/api/storage/reveal`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://unrelated.invalid" }, body: JSON.stringify({ id: updated.locations[0].id }) });
  assert.equal(wrongOrigin.status, 403);
  assert.equal((await lstat(original)).mtimeMs, before.mtimeMs);
  assert.deepEqual(await readFile(original), Buffer.alloc(100000));
  assert.doesNotMatch(output, /ReferenceError|SyntaxError|TypeError/);
});
