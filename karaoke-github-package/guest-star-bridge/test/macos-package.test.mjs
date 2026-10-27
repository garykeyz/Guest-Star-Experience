import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const bridgeRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = resolve(bridgeRoot, "../..");
const [buildSource, shellSource, nativeHostSource, workflowSource, guideSource, engineInstallSource, engineSmokeSource] =
  await Promise.all([
    readFile(resolve(bridgeRoot, "macos/build_installer.py"), "utf8"),
    readFile(resolve(bridgeRoot, "macos/GuestStarBridge"), "utf8"),
    readFile(resolve(bridgeRoot, "macos/GuestStarNativeHost.m"), "utf8"),
    readFile(
      resolve(repositoryRoot, ".github/workflows/publish-guest-star-bridge.yml"),
      "utf8"
    ),
    readFile(resolve(bridgeRoot, "macos/INSTALACION-OTRA-MAC.txt"), "utf8"),
    readFile(resolve(bridgeRoot, "scripts/install-stem-engine-macos.sh"), "utf8"),
    readFile(resolve(bridgeRoot, "scripts/stems-engine-smoke.mjs"), "utf8")
  ]);

test("construye una app Cocoa/WebKit Universal con identidad propia", () => {
  assert.match(buildSource, /def compile_universal_native_host/);
  assert.match(buildSource, /GuestStarNativeHost\.m/);
  assert.match(buildSource, /"-arch",\s*"arm64"/);
  assert.match(buildSource, /"-arch",\s*"x86_64"/);
  assert.match(buildSource, /"-framework",\s*"Cocoa"/);
  assert.match(buildSource, /"-framework",\s*"CoreAudio"/);
  assert.match(buildSource, /"-framework",\s*"AVFoundation"/);
  assert.match(buildSource, /"-framework",\s*"AudioToolbox"/);
  assert.match(buildSource, /"-framework",\s*"WebKit"/);
  assert.match(buildSource, /LSArchitecturePriority.*arm64.*x86_64/s);
  assert.match(buildSource, /CFBundleExecutable": "GuestStarBridge"/);
  assert.match(buildSource, /BUNDLE_ID = "com\.gstarxp\.guest-star"/);
  assert.match(nativeHostSource, /#import <Cocoa\/Cocoa\.h>/);
  assert.match(nativeHostSource, /#import <WebKit\/WebKit\.h>/);
  assert.match(nativeHostSource, /#import <CoreAudio\/CoreAudio\.h>/);
  assert.match(nativeHostSource, /#import <AVFoundation\/AVFoundation\.h>/);
  assert.match(nativeHostSource, /AVAudioEngine/);
  assert.match(nativeHostSource, /AVAudioUnitTimePitch/);
  assert.match(nativeHostSource, /setVocalLevel/);
  assert.match(nativeHostSource, /vocalsMix\.outputVolume/);
  assert.match(nativeHostSource, /payload\[@"vocalLevel"\]/);
  assert.match(nativeHostSource, /scheduledTimerWithTimeInterval:0\.25/);
  assert.match(nativeHostSource, /requestID\.length > 0/);
  assert.match(nativeHostSource, /listAudioOutputs/);
  assert.match(nativeHostSource, /setAudioOutput/);
  assert.match(nativeHostSource, /kAudioHardwarePropertyDefaultOutputDevice/);
  assert.match(nativeHostSource, /setActivationPolicy:NSApplicationActivationPolicyRegular/);
  assert.match(nativeHostSource, /self\.mainWindow\.title = @"Guest Star"/);
  assert.match(nativeHostSource, /WKWebViewConfiguration/);
  assert.match(nativeHostSource, /NSTask \*task/);
  assert.match(nativeHostSource, /GUEST_STAR_NATIVE_HOST/);
});

test("ofrece menú nativo Guest Star y Preferencias con Comando-coma", () => {
  assert.match(nativeHostSource, /buildMainMenu/);
  assert.match(nativeHostSource, /addMenuWithTitle:@"Guest Star"/);
  assert.match(nativeHostSource, /menuItemWithTitle:@"Acerca de Guest Star"/);
  assert.match(
    nativeHostSource,
    /menuItemWithTitle:@"Preferencias…"[\s\S]*?action:@selector\(openPreferences:\)[\s\S]*?key:@","/
  );
  assert.match(nativeHostSource, /GSOpenPreferencesEventName/);
  assert.match(nativeHostSource, /dispatchEvent:GSOpenPreferencesEventName/);
  assert.match(nativeHostSource, /addMenuWithTitle:@"Actividad"/);
  assert.match(nativeHostSource, /Modo Host/);
  assert.match(nativeHostSource, /openLiveEvent:/);
  assert.match(nativeHostSource, /switchActivity:/);
  assert.match(nativeHostSource, /openAdministration:/);
});

test("el primer plano pertenece a Cocoa y no a automatización osascript/JXA", () => {
  assert.match(nativeHostSource, /makeKeyAndOrderFront:nil/);
  assert.match(nativeHostSource, /activateIgnoringOtherApps:YES/);
  assert.doesNotMatch(nativeHostSource, /osascript|NSAppleScript|JavaScript for Automation/);
  assert.doesNotMatch(shellSource, /osascript|System Events|activate application/);
  assert.doesNotMatch(shellSource, /GuestStarWindow\.js|star-screen-window\.jxa/);
  assert.doesNotMatch(buildSource, /shutil\.copy2\([^\n]*GuestStarWindow\.js/);
  assert.doesNotMatch(workflowSource, /node --check[^\n]*GuestStarWindow\.js/);
  assert.doesNotMatch(workflowSource, /node --check[^\n]*star-screen-window\.jxa/);
});

test("Star Screen reutiliza una sola ventana, respeta pantalla y recupera foco", () => {
  assert.match(nativeHostSource, /if \(self\.starWindow != nil\) return/);
  assert.match(nativeHostSource, /CGDisplayCreateUUIDFromDisplayID/);
  assert.match(nativeHostSource, /NSScreenNumber/);
  assert.match(nativeHostSource, /screenForDisplayID:/);
  assert.match(nativeHostSource, /setStarScreenDisplay/);
  assert.match(nativeHostSource, /updateStarScreenDisplayWithPayload:/);
  assert.match(nativeHostSource, /NSApplicationDidChangeScreenParametersNotification/);
  assert.match(nativeHostSource, /requestedScreen \?: \[self primaryScreen\]/);
  assert.match(nativeHostSource, /BOOL floatingWindow = preview \|\| NSScreen\.screens\.count <= 1/);
  assert.match(nativeHostSource, /NSWindowCollectionBehaviorDefault/);
  assert.match(nativeHostSource, /contentAspectRatio = NSMakeSize\(16, 9\)/);
  assert.match(nativeHostSource, /9\.0 \/ 16\.0/);
  assert.match(nativeHostSource, /makeKeyAndOrderFront:nil/);
  assert.match(nativeHostSource, /orderFrontRegardless/);
  assert.match(nativeHostSource, /if \(self\.starWindow\.miniaturized\) \[self\.starWindow deminiaturize:nil\]/);
  assert.match(nativeHostSource, /@"reused": @\(reused\)/);
});

test("Star Screen es flotante con una sola pantalla y conserva la salida externa", () => {
  assert.match(nativeHostSource, /BOOL floatingWindow = preview \|\| NSScreen\.screens\.count <= 1/);
  assert.match(
    nativeHostSource,
    /if \(floatingWindow\) \{[\s\S]*?NSWindowStyleMaskTitled[\s\S]*?NSWindowStyleMaskClosable[\s\S]*?NSWindowStyleMaskMiniaturizable[\s\S]*?NSWindowStyleMaskResizable[\s\S]*?\} else \{[\s\S]*?NSWindowStyleMaskBorderless[\s\S]*?NSWindowCollectionBehaviorCanJoinAllSpaces[\s\S]*?NSWindowCollectionBehaviorFullScreenAuxiliary[\s\S]*?setFrame:screen\.frame/
  );
});

test("incluye y ejercita Spleeter rápido y Demucs HQ en el motor Universal", () => {
  assert.match(buildSource, /--stem-engine-root/);
  assert.match(buildSource, /def copy_stem_engine/);
  assert.match(buildSource, /demucs\/dist\/cli\.js/);
  assert.match(buildSource, /onnxruntime-node\/bin\/napi-v6\/darwin\/arm64/);
  assert.match(buildSource, /onnxruntime-node\/bin\/napi-v6\/darwin\/x64/);
  assert.match(buildSource, /ffmpeg-static.*ffmpeg/s);
  assert.match(engineInstallSource, /demucs@1\.0\.0/);
  assert.match(engineInstallSource, /onnxruntime-node@1\.23\.2/);
  assert.match(engineInstallSource, /@ffprobe-installer\/ffprobe@2\.1\.2/);
  assert.match(engineInstallSource, /@ffprobe-installer\/darwin-arm64@5\.0\.1/);
  assert.match(engineInstallSource, /@ffprobe-installer\/darwin-x64@5\.1\.0/);
  assert.match(engineInstallSource, /overrides\.adm-zip=0\.6\.0/);
  assert.match(engineInstallSource, /k2-fsa\/sherpa-onnx\/releases\/download\/v\$\{sherpa_version\}/);
  assert.match(engineInstallSource, /osx-universal2-shared-no-tts\.tar\.bz2/);
  assert.match(engineInstallSource, /source-separation-models\/\$\{spleeter_archive_name\}/);
  assert.match(engineInstallSource, /sherpa-onnx-offline-source-separation/);
  assert.match(engineInstallSource, /vocals\.fp16\.onnx/);
  assert.match(engineInstallSource, /accompaniment\.fp16\.onnx/);
  assert.match(engineInstallSource, /sherpa_archive_sha256="[a-f0-9]{64}"/);
  assert.match(engineInstallSource, /spleeter_archive_sha256="[a-f0-9]{64}"/);
  assert.doesNotMatch(engineInstallSource + workflowSource, /PENDING/);
  assert.match(engineInstallSource, /lipo "\$sherpa_cli" -verify_arch arm64 x86_64/);
  assert.match(engineInstallSource, /lipo "\$ffprobe_arm64" -verify_arch arm64/);
  assert.match(engineInstallSource, /lipo "\$ffprobe_x64" -verify_arch x86_64/);
  assert.match(engineSmokeSource, /--input-wav=/);
  assert.match(engineSmokeSource, /--engine=/);
  assert.match(engineSmokeSource, /--output-vocals-wav=/);
  assert.match(engineSmokeSource, /--output-accompaniment-wav=/);
  assert.match(engineInstallSource, /stems-engine-smoke\.mjs/);
  assert.match(workflowSource, /install-stem-engine-macos\.sh/);
  assert.match(workflowSource, /--stem-engine-root "\$RUNNER_TEMP\/guest-star-stem-engine"/);
  assert.match(buildSource, /lib\/libonnxruntime\.dylib/);
  assert.match(buildSource, /smoke_test_packaged_stem_engine/);
  assert.match(buildSource, /destination \/ "scripts"/);
});

test("firma y valida plist, frameworks, binario final, DMG y ZIP", () => {
  assert.match(buildSource, /codesign/);
  assert.match(buildSource, /--verify/);
  assert.match(
    buildSource,
    /\["lipo", str\(destination\), "-verify_arch", "arm64", "x86_64"\]/
  );
  assert.match(buildSource, /\["plutil", "-lint"/);
  assert.match(workflowSource, /xcrun clang/);
  assert.match(workflowSource, /-framework Cocoa/);
  assert.match(workflowSource, /-framework AVFoundation/);
  assert.match(workflowSource, /-framework AudioToolbox/);
  assert.match(workflowSource, /-framework WebKit/);
  assert.match(workflowSource, /lipo[^\n]*native_host[^\n]*-verify_arch arm64 x86_64/);
  assert.match(workflowSource, /otool -L[^\n]*native_host/);
  assert.match(workflowSource, /plutil -lint/);
  assert.match(workflowSource, /Contents\/MacOS\/GuestStarBridge/);
  assert.match(buildSource, /app_bundle\.rename\(distributed_app\)/);
  assert.match(buildSource, /"--sequesterRsrc"/);
  assert.match(buildSource, /hdiutil/);
  assert.match(buildSource, /hdiutil",\s*"verify/);
  assert.match(buildSource, /unzip",\s*"-tq/);
  assert.match(buildSource, /def create_pkg/);
  assert.match(buildSource, /"--install-location",\s*"\/Applications"/);
  assert.match(buildSource, /GuestStar-\{version\}\.pkg/);
  assert.match(buildSource, /pkgutil", "--payload-files"/);
  assert.doesNotMatch(buildSource, /pycdlib/);
});

test("selecciona automáticamente el runtime correcto en cada Mac", () => {
  assert.match(shellSource, /arm64\) RUNTIME=.*node-arm64\/node/);
  assert.match(shellSource, /x86_64\) RUNTIME=.*node-x64\/node/);
  assert.match(shellSource, /APP_VERSION="4\.5"/);
  assert.match(shellSource, /GUEST_STAR_PORT=8787 \/usr\/bin\/nohup/);
  assert.match(shellSource, /puerto local 8787 está ocupado por otra aplicación/);
  assert.match(shellSource, /\.bundle-build/);
  assert.match(shellSource, /installed_build.*bundled_build/s);
  assert.match(buildSource, /def write_bundle_build_id/);
  assert.match(buildSource, /La versión del iniciador no coincide con package\.json/);
  assert.match(shellSource, /Application Support\/Guest Star"/);
  assert.match(shellSource, /LEGACY_SUPPORT_DIR=.*Guest Star Bridge/);
});

test("la publicación deriva Guest Star Universal de la versión del paquete", () => {
  assert.match(workflowSource, /release_meta\.outputs\.version/);
  assert.match(workflowSource, /Guest-Star-Universal-v\$\{VERSION\}-app\.zip/);
  assert.match(buildSource, /APP_NAME = "Guest Star\.app"/);
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
  assert.match(workflowSource, /Test Bridge regression suite/);
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
