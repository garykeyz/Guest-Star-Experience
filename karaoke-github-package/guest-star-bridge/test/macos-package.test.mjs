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

test("incluye y prueba el motor Stems IA real para Intel y Apple Silicon", () => {
  assert.match(buildSource, /--stem-engine-root/);
  assert.match(buildSource, /def copy_stem_engine/);
  assert.match(buildSource, /demucs\/dist\/cli\.js/);
  assert.match(buildSource, /onnxruntime-node\/bin\/napi-v6\/darwin\/arm64/);
  assert.match(buildSource, /onnxruntime-node\/bin\/napi-v6\/darwin\/x64/);
  assert.match(buildSource, /ffmpeg-static.*ffmpeg/s);
  assert.match(workflowSource, /demucs@1\.0\.0/);
  assert.match(workflowSource, /onnxruntime-node@1\.23\.2/);
  assert.match(workflowSource, /overrides\.adm-zip=0\.6\.0/);
  assert.match(workflowSource, /lipo -create/);
  assert.match(workflowSource, /stems-engine-smoke\.mjs/);
  assert.match(workflowSource, /--stem-engine-root "\$RUNNER_TEMP\/guest-star-stem-engine"/);
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
  assert.match(shellSource, /APP_VERSION="4\.4\.0"/);
  assert.match(shellSource, /\.bundle-build/);
  assert.match(shellSource, /installed_build.*bundled_build/s);
  assert.match(buildSource, /def write_bundle_build_id/);
  assert.match(buildSource, /La versión del iniciador no coincide con package\.json/);
  assert.match(shellSource, /Application Support\/Guest Star"/);
  assert.match(shellSource, /LEGACY_SUPPORT_DIR=.*Guest Star Bridge/);
  assert.match(shellSource, /version.*APP_VERSION/s);
});

test("la barra nativa se identifica como Guest Star y separa el modo Bridge", () => {
  assert.match(windowSource, /processName = "Guest Star"/);
  assert.match(windowSource, /addMenu\(menuBar, "Guest Star"/);
  assert.match(windowSource, /addMenu\(menuBar, "Actividad"/);
  assert.match(windowSource, /openLiveEvent:/);
  assert.match(windowSource, /switchActivity:/);
  assert.match(windowSource, /openAdministration:/);
  assert.match(windowSource, /openSettings:/);
  assert.match(windowSource, /reloadPage:/);
  assert.match(windowSource, /Bridge \(VirtualDJ\)/);
});

test("la publicación deriva Guest Star Universal de la versión 4.4.0", () => {
  assert.match(workflowSource, /release_meta\.outputs\.version/);
  assert.match(workflowSource, /Guest-Star-Universal-v\$\{VERSION\}-app\.zip/);
  assert.match(buildSource, /APP_NAME = "Guest Star\.app"/);
  assert.match(buildSource, /BUNDLE_ID = "com\.gstarxp\.guest-star"/);
  assert.match(workflowSource, /karaoke-github-package\/\*\*/);
  assert.match(workflowSource, /node-v22\.22\.0-darwin-arm64/);
  assert.match(workflowSource, /node-v22\.22\.0-darwin-x64/);
  assert.match(guideSource, /Mac Intel y Mac Apple Silicon M1, M2, M3, M4 y M5/);
  assert.match(guideSource, /No necesitas instalar Node, npm ni usar Terminal/);
  assert.match(guideSource, /clic derecho sobre Guest Star y elige Abrir/);
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
  assert.match(workflowSource, /deploy-production:\s*\n\s*if:.*\n\s*needs: validate/);
  assert.match(workflowSource, /environment: production/);
  assert.match(workflowSource, /secrets\.CLOUDFLARE_API_TOKEN/);
  assert.match(workflowSource, /secrets\.CLOUDFLARE_ACCOUNT_ID/);
  assert.match(workflowSource, /release:\s*\n\s*if:.*\n\s*needs: validate/);
});
