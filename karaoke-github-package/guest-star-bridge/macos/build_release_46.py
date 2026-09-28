#!/usr/bin/env python3
"""Package the audited installed runtime with the matching source, icon and version."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import shutil
import subprocess


def run(*args):
    subprocess.run(list(map(str, args)), check=True)


parser = argparse.ArgumentParser()
parser.add_argument('--audited-app', type=Path, required=True)
parser.add_argument('--native-executable', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
source = Path(__file__).resolve().parent.parent
out = args.output.resolve()
out.mkdir(parents=True, exist_ok=True)
distribution = out / 'distribution'
distribution.mkdir()
app = distribution / 'Guest Star Experience.app'
contents = app / 'Contents'
resources = contents / 'Resources'
macos = contents / 'MacOS'
macos.mkdir(parents=True)
resources.mkdir()
with (args.audited_app / 'Contents/Info.plist').open('rb') as handle:
    info = plistlib.load(handle)
info.update(CFBundleDisplayName='Guest Star Experience',
            CFBundleName='Guest Star Experience',
            CFBundleShortVersionString='4.6', CFBundleVersion='460',
            LSArchitecturePriority=['arm64'])
with (contents / 'Info.plist').open('wb') as handle:
    plistlib.dump(info, handle)
shutil.copy2(args.native_executable, macos / 'GuestStarBridge')
shutil.copy2(source / 'macos/GuestStarBridge', macos / 'GuestStarBridge.sh')
shutil.copy2(source / 'macos/assets/AppIcon.icns', resources / 'AppIcon.icns')
bridge = resources / 'bridge'
bridge.mkdir()
for folder in ('src', 'public'):
    shutil.copytree(source / folder, bridge / folder)
for filename in ('package.json', 'README.md', 'config.example.json',
                 'app.js', 'host-console.css', 'index.html',
                 'native-display-routing.js', 'player-beta.js',
                 'storage-preferences.js'):
    shutil.copy2(source / filename, bridge / filename)
(bridge / 'scripts').mkdir()
shutil.copy2(source / 'scripts/stems-engine-smoke.mjs',
             bridge / 'scripts/stems-engine-smoke.mjs')
# Native dependency versions and model files are preserved from the audited bundle.
shutil.copytree(args.audited_app / 'Contents/Resources/runtime/node-arm64',
                resources / 'runtime/node-arm64')
shutil.copytree(args.audited_app / 'Contents/Resources/bridge/stem-engine',
                bridge / 'stem-engine')
magics = {b'\xcf\xfa\xed\xfe', b'\xce\xfa\xed\xfe',
          b'\xca\xfe\xba\xbe', b'\xbe\xba\xfe\xca'}
binaries = []
for path in sorted(app.rglob('*')):
    if not path.is_file():
        continue
    with path.open('rb') as handle:
        magic = handle.read(4)
    if magic not in magics:
        continue
    archs = subprocess.check_output(['lipo', '-archs', str(path)], text=True).split()
    if 'arm64' not in archs:
        path.unlink()  # Intel-only alternatives are excluded from this arm64 package.
        continue
    if len(archs) > 1:
        thin = path.with_name(path.name + '.arm64-stage')
        run('lipo', path, '-thin', 'arm64', '-output', thin)
        thin.replace(path)
    path.chmod(path.stat().st_mode | 0o111)
    binaries.append(path)
for directory in (
    bridge / 'stem-engine/node_modules/@ffprobe-installer/darwin-x64',
    bridge / 'stem-engine/node_modules/onnxruntime-node/bin/napi-v6/darwin/x64',
):
    if directory.exists():
        shutil.rmtree(directory)
run('codesign', '--force', '--sign', '-', '--timestamp=none',
    macos / 'GuestStarBridge.sh')
for binary in sorted(binaries, key=lambda p: p == macos / 'GuestStarBridge'):
    run('lipo', binary, '-verify_arch', 'arm64')
    run('codesign', '--force', '--sign', '-', '--timestamp=none', binary)
    run('codesign', '--verify', '--strict', binary)
digest = hashlib.sha256()
for path in sorted(bridge.rglob('*')):
    if path.is_file() and path.name != '.bundle-build':
        digest.update(path.relative_to(bridge).as_posix().encode())
        digest.update(b'\0')
        digest.update(path.read_bytes())
        digest.update(b'\0')
(bridge / '.bundle-build').write_text(digest.hexdigest() + '\n')
run('codesign', '--force', '--deep', '--sign', '-', '--timestamp=none', app)
run('codesign', '--verify', '--deep', '--strict', '--verbose=2', app)
run('plutil', '-lint', contents / 'Info.plist')
os.symlink('/Applications', distribution / 'Applications')
(out / 'package-metadata.json').write_text(json.dumps({
    'version': '4.6', 'build': '460', 'architecture': 'arm64',
    'bundleId': info['CFBundleIdentifier'], 'bundleBuild': digest.hexdigest(),
    'signature': 'AD-HOC', 'notarized': False,
    'binaries': [str(p.relative_to(app)) for p in binaries],
}, indent=2) + '\n')
print(app)
