import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const bridgeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(bridgeRoot, "../..");
const [buildSource, shellSource, launcherSource, windowSource, workflowSource, guideSource] =
  await Promise.all([
    readFile(resolve(bridgeRoot, "macos/build_installer.py"), "utf8"),
    readFile(resolve(bridgeRoot, "macos/GuestStarBridge"), "utf8"),
    readFile(resolve(bridgeRoot, "macos/GuestStarLauncher.c"), "utf8"),
    readFile(resolve(bridgeRoot, "macos/GuestStarWindow.js"), "utf8"),
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
  assert.match(buildSource, /app_bundle\.rename\(distributed_app\)/);
  assert.match(buildSource, /prevents the macOS release runner from exhausting its disk/);
  assert.match(buildSource, /"--sequesterRsrc"/);
  assert.match(buildSource, /hdiutil/);
  assert.match(buildSource, /hdiutil",\s*"verify/);
  assert.match(buildSource, /unzip",\s*"-tq/);
  assert.doesNotMatch(buildSource, /pycdlib/);
});

test("selecciona automáticamente el motor correcto en Intel o Apple Silicon", () => {
  assert.match(shellSource, /arm64\) RUNTIME=.*node-arm64\/node/);
  assert.match(shellSource, /x86_64\) RUNTIME=.*node-x64\/node/);
  assert.match(shellSource, /APP_VERSION="4\.3\.0"/);
  assert.match(shellSource, /\.bundle-build/);
  assert.match(shellSource, /installed_build.*bundled_build/s);
  assert.match(buildSource, /def write_bundle_build_id/);
  assert.match(buildSource, /La versión del iniciador no coincide con package\.json/);
});

test("la barra nativa se identifica como Guest Star Bridge y ofrece acciones útiles", () => {
  assert.match(windowSource, /processName = "Guest Star Bridge"/);
  assert.match(windowSource, /addMenu\(menuBar, "Guest Star Bridge"/);
  assert.match(windowSource, /addMenu\(menuBar, "Actividad"/);
  assert.match(windowSource, /openLiveEvent:/);
  assert.match(windowSource, /switchActivity:/);
  assert.match(windowSource, /openAdministration:/);
  assert.match(windowSource, /openSettings:/);
  assert.match(windowSource, /reloadPage:/);
});

test("la publicación deriva el paquete Universal de la versión 4.3.0", () => {
  assert.match(workflowSource, /release_meta\.outputs\.version/);
  assert.match(workflowSource, /Guest-Star-Bridge-Universal-v\$\{VERSION\}-app\.zip/);
  assert.match(workflowSource, /karaoke-github-package\/\*\*/);
  assert.match(workflowSource, /node-v22\.22\.0-darwin-arm64/);
  assert.match(workflowSource, /node-v22\.22\.0-darwin-x64/);
  assert.match(guideSource, /Mac Intel y Mac Apple Silicon M1, M2, M3, M4 y M5/);
  assert.match(guideSource, /No necesitas instalar Node, npm ni usar Terminal/);
  assert.match(guideSource, /clic derecho sobre Guest Star Bridge y elige Abrir/);
});

test("bloquea la publicación hasta aprobar seguridad, regresión, web y Cloudflare", () => {
  assert.match(workflowSource, /pull_request:\s*\n\s*branches:\s*\n\s*- main/);
  assert.match(workflowSource, /validate:\s*\n\s*runs-on: ubuntu-latest/);
  assert.match(workflowSource, /npm ci --ignore-scripts/);
  assert.match(workflowSource, /npm audit --audit-level=low/);
  assert.match(workflowSource, /Test Bridge and Apps Script regression suite/);
  assert.match(workflowSource, /npx tsc --noEmit/);
  assert.match(workflowSource, /npm run build/);
  assert.match(workflowSource, /npm run test:http/);
  assert.match(workflowSource, /npx opennextjs-cloudflare build/);
  assert.match(workflowSource, /if: github\.event_name != 'pull_request'/);
  assert.match(workflowSource, /release:\s*\n\s*if:.*\n\s*needs: validate/);
});
