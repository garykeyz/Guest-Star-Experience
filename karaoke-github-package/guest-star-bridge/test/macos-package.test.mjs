import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const bridgeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(bridgeRoot, "../..");
const [buildSource, shellSource, launcherSource, workflowSource, guideSource] =
  await Promise.all([
    readFile(resolve(bridgeRoot, "macos/build_installer.py"), "utf8"),
    readFile(resolve(bridgeRoot, "macos/GuestStarBridge"), "utf8"),
    readFile(resolve(bridgeRoot, "macos/GuestStarLauncher.c"), "utf8"),
    readFile(
      resolve(repositoryRoot, ".github/workflows/publish-guest-star-bridge.yml"),
      "utf8"
    ),
    readFile(resolve(bridgeRoot, "macos/INSTALACION-OTRA-MAC.txt"), "utf8")
  ]);

test("construye una app Universal con iniciador Mach-O y dos motores nativos", () => {
  assert.match(buildSource, /"-arch",\s*"arm64"/);
  assert.match(buildSource, /"-arch",\s*"x86_64"/);
  assert.match(buildSource, /LSArchitecturePriority.*arm64.*x86_64/s);
  assert.match(buildSource, /node-arm64/);
  assert.match(buildSource, /node-x64/);
  assert.match(launcherSource, /_NSGetExecutablePath/);
  assert.match(launcherSource, /GuestStarBridge\.sh/);
});

test("firma, verifica y crea un DMG real antes de publicar el ZIP", () => {
  assert.match(buildSource, /codesign/);
  assert.match(buildSource, /--verify/);
  assert.match(
    buildSource,
    /\["lipo", str\(destination\), "-verify_arch", "arm64", "x86_64"\]/
  );
  assert.match(
    buildSource,
    /\["lipo", str\(node_arm64\), "-verify_arch", "arm64"\]/
  );
  assert.match(
    buildSource,
    /\["lipo", str\(node_x64\), "-verify_arch", "x86_64"\]/
  );
  assert.doesNotMatch(buildSource, /\["lipo", "-verify_arch"/);
  assert.match(
    buildSource,
    /\["\/usr\/bin\/ditto", str\(app_bundle\), str\(distributed_app\)\]/
  );
  assert.match(buildSource, /"--sequesterRsrc"/);
  assert.match(buildSource, /hdiutil/);
  assert.match(buildSource, /hdiutil",\s*"verify/);
  assert.match(buildSource, /unzip",\s*"-tq/);
  assert.doesNotMatch(buildSource, /pycdlib/);
});

test("selecciona automáticamente el motor correcto en Intel o Apple Silicon", () => {
  assert.match(shellSource, /arm64\) RUNTIME=.*node-arm64\/node/);
  assert.match(shellSource, /x86_64\) RUNTIME=.*node-x64\/node/);
  assert.match(shellSource, /APP_VERSION="3\.0\.2"/);
});

test("la publicación y el instructivo entregan el paquete Universal 3.0.2", () => {
  assert.match(workflowSource, /Guest-Star-Bridge-Universal-v3\.0\.2-app\.zip/);
  assert.match(workflowSource, /karaoke-github-package\/\*\*/);
  assert.match(workflowSource, /node-v22\.22\.0-darwin-arm64/);
  assert.match(workflowSource, /node-v22\.22\.0-darwin-x64/);
  assert.match(guideSource, /Mac Intel y Mac Apple Silicon M1, M2, M3, M4 y M5/);
  assert.match(guideSource, /No necesitas instalar Node, npm ni usar Terminal/);
  assert.match(guideSource, /clic derecho sobre Guest Star Bridge y elige Abrir/);
});
