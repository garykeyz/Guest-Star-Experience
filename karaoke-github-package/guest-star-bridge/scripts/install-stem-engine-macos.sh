#!/bin/bash
set -euo pipefail

if [[ $# -ne 1 || -z "${1:-}" ]]; then
  echo "Usage: $0 <stem-engine-directory>" >&2
  exit 64
fi

destination_root="$1"
case "$destination_root" in
  /|"") echo "Refusing an unsafe stem-engine destination." >&2; exit 64 ;;
esac

script_root="$(cd "$(dirname "$0")" && pwd)"
sherpa_version="1.13.6"
sherpa_archive_name="sherpa-onnx-v${sherpa_version}-osx-universal2-shared-no-tts.tar.bz2"
sherpa_archive_sha256="a16e7b91784775616c3b92f2a4947de3ac340a1df9fb9b610d86447f0857b150"
spleeter_archive_name="sherpa-onnx-spleeter-2stems-fp16.tar.bz2"
spleeter_archive_sha256="d54561979bd2e08a51e7dbd99ac36bb47564e089eefd403636dbca93e811bba2"
destination_parent="$(dirname "$destination_root")"
destination_name="$(basename "$destination_root")"
case "$destination_name" in
  *stem-engine*) ;;
  *) echo "Refusing a destination that is not a dedicated stem-engine folder." >&2; exit 64 ;;
esac
mkdir -p "$destination_parent"
destination_parent="$(cd "$destination_parent" && pwd)"
destination_root="$destination_parent/$destination_name"
engine_root="$(mktemp -d "$destination_parent/guest-star-stem-engine-new-XXXXXX")"
work_root="$(mktemp -d "${TMPDIR:-/tmp}/guest-star-stem-engine.XXXXXX")"
install_complete=0

cleanup() {
  [[ -n "$work_root" && "$work_root" != "/" ]] && rm -rf "$work_root"
  if [[ "$install_complete" != "1" && -n "$engine_root" && "$engine_root" != "/" ]]; then
    rm -rf "$engine_root"
  fi
}
trap cleanup EXIT

for command_name in curl npm node tar lipo shasum; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Missing required command: $command_name" >&2
    exit 1
  fi
done

sherpa_archive="$work_root/$sherpa_archive_name"
spleeter_archive="$work_root/$spleeter_archive_name"
curl --proto '=https' --tlsv1.2 -fsSL --retry 3 --retry-delay 2 \
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/v${sherpa_version}/${sherpa_archive_name}" \
  -o "$sherpa_archive"
curl --proto '=https' --tlsv1.2 -fsSL --retry 3 --retry-delay 2 \
  "https://github.com/k2-fsa/sherpa-onnx/releases/download/source-separation-models/${spleeter_archive_name}" \
  -o "$spleeter_archive"

LC_ALL=C LANG=C shasum -a 256 -c - <<EOF
${sherpa_archive_sha256}  ${sherpa_archive}
${spleeter_archive_sha256}  ${spleeter_archive}
EOF

sherpa_extract="$work_root/sherpa"
spleeter_extract="$work_root/spleeter"
mkdir -p "$sherpa_extract" "$spleeter_extract"
LC_ALL=C LANG=C tar -xjf "$sherpa_archive" -C "$sherpa_extract"
LC_ALL=C LANG=C tar -xjf "$spleeter_archive" -C "$spleeter_extract"
sherpa_dist="$sherpa_extract/sherpa-onnx-v${sherpa_version}-osx-universal2-shared-no-tts"
spleeter_dist="$spleeter_extract/sherpa-onnx-spleeter-2stems-fp16"
for required_file in \
  "$sherpa_dist/bin/sherpa-onnx-offline-source-separation" \
  "$sherpa_dist/lib/libonnxruntime.dylib" \
  "$spleeter_dist/vocals.fp16.onnx" \
  "$spleeter_dist/accompaniment.fp16.onnx"; do
  test -s "$required_file"
done

mkdir -p \
  "$engine_root/bin" \
  "$engine_root/lib" \
  "$engine_root/models/sherpa-onnx-spleeter-2stems-fp16" \
  "$engine_root/licenses"
cp "$sherpa_dist/bin/sherpa-onnx-offline-source-separation" "$engine_root/bin/"
cp "$sherpa_dist/lib/libonnxruntime.dylib" "$engine_root/lib/"
cp "$spleeter_dist/vocals.fp16.onnx" "$engine_root/models/sherpa-onnx-spleeter-2stems-fp16/"
cp "$spleeter_dist/accompaniment.fp16.onnx" "$engine_root/models/sherpa-onnx-spleeter-2stems-fp16/"
curl --proto '=https' --tlsv1.2 -fsSL --retry 3 --retry-delay 2 \
  "https://raw.githubusercontent.com/k2-fsa/sherpa-onnx/v${sherpa_version}/LICENSE" \
  -o "$engine_root/licenses/sherpa-onnx-LICENSE.txt"
chmod +x "$engine_root/bin/sherpa-onnx-offline-source-separation"

if [[ ! -f "$engine_root/package.json" ]]; then
  (cd "$engine_root" && npm init --yes >/dev/null)
fi
(cd "$engine_root" && npm pkg set name=guest-star-stem-engine private=true overrides.adm-zip=0.6.0)
# Both Darwin ffprobe packages are intentionally installed on one build Mac;
# --force bypasses npm's host-CPU filter, then lipo below verifies each binary.
npm install \
  --prefix "$engine_root" \
  --omit=dev \
  --no-audit \
  --no-fund \
  --force \
  --save-exact \
  demucs@1.0.0 \
  onnxruntime-node@1.23.2 \
  ffmpeg-static@5.3.0 \
  @ffprobe-installer/ffprobe@2.1.2 \
  @ffprobe-installer/darwin-arm64@5.0.1 \
  @ffprobe-installer/darwin-x64@5.1.0

ffmpeg_dir="$engine_root/node_modules/ffmpeg-static"
if ! lipo "$ffmpeg_dir/ffmpeg" -verify_arch arm64 x86_64 >/dev/null 2>&1; then
  if lipo "$ffmpeg_dir/ffmpeg" -verify_arch arm64 >/dev/null 2>&1; then
    current_arch="arm64"
    other_npm_arch="x64"
    other_lipo_arch="x86_64"
  else
    current_arch="x86_64"
    other_npm_arch="arm64"
    other_lipo_arch="arm64"
  fi
  mv "$ffmpeg_dir/ffmpeg" "$ffmpeg_dir/ffmpeg-$current_arch"
  npm_config_arch="$other_npm_arch" npm rebuild --prefix "$engine_root" ffmpeg-static
  mv "$ffmpeg_dir/ffmpeg" "$ffmpeg_dir/ffmpeg-$other_lipo_arch"
  lipo -create \
    "$ffmpeg_dir/ffmpeg-$current_arch" \
    "$ffmpeg_dir/ffmpeg-$other_lipo_arch" \
    -output "$ffmpeg_dir/ffmpeg"
  chmod +x "$ffmpeg_dir/ffmpeg"
fi

sherpa_cli="$engine_root/bin/sherpa-onnx-offline-source-separation"
ffprobe_arm64="$engine_root/node_modules/@ffprobe-installer/darwin-arm64/ffprobe"
ffprobe_x64="$engine_root/node_modules/@ffprobe-installer/darwin-x64/ffprobe"
chmod +x "$ffprobe_arm64" "$ffprobe_x64"
lipo "$sherpa_cli" -verify_arch arm64 x86_64
lipo "$engine_root/lib/libonnxruntime.dylib" -verify_arch arm64 x86_64
lipo "$ffmpeg_dir/ffmpeg" -verify_arch arm64 x86_64
lipo "$ffprobe_arm64" -verify_arch arm64
lipo "$ffprobe_x64" -verify_arch x86_64
npm audit --prefix "$engine_root" --omit=dev --audit-level=high
node "$script_root/stems-engine-smoke.mjs" "$engine_root"

backup_root=""
if [[ -e "$destination_root" ]]; then
  backup_root="$destination_parent/.stem-engine-backup.$(date +%s).$$"
  mv "$destination_root" "$backup_root"
fi
if mv "$engine_root" "$destination_root"; then
  install_complete=1
  [[ -z "$backup_root" ]] || rm -rf "$backup_root"
else
  [[ -z "$backup_root" || -e "$destination_root" ]] || mv "$backup_root" "$destination_root"
  exit 1
fi

echo "Guest Star Stems IA engine installed and verified at $destination_root"
