#!/bin/bash
set -euo pipefail
TASK_DIR="$(cd "$(dirname "$0")" && pwd)"
SDK_DIR="${1:?Supply path to officially downloaded VirtualDJ SDK headers}"
OUTPUT_DIR="$TASK_DIR/build"
mkdir -p "$OUTPUT_DIR/Guest Star Karaoke.bundle/Contents/MacOS"
xcrun clang++ -std=c++17 -O2 -fobjc-arc -arch arm64 -mmacosx-version-min=11.0 -bundle -I "$SDK_DIR" "$TASK_DIR/GuestStarOverlay.mm" "$TASK_DIR/Renderer.mm" -framework AppKit -framework CoreImage -framework ImageIO -framework Metal -o "$OUTPUT_DIR/Guest Star Karaoke.bundle/Contents/MacOS/GuestStarOverlay"
cat > "$OUTPUT_DIR/Guest Star Karaoke.bundle/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>com.gueststar.vdj.karaoke</string><key>CFBundleName</key><string>Guest Star Karaoke</string><key>CFBundleExecutable</key><string>GuestStarOverlay</string><key>CFBundlePackageType</key><string>BNDL</string><key>CFBundleVersion</key><string>1.0.2</string></dict></plist>
PLIST
codesign --force --sign - "$OUTPUT_DIR/Guest Star Karaoke.bundle"
xcrun clang++ -std=c++17 -O2 -fobjc-arc -arch arm64 "$TASK_DIR/preview.mm" "$TASK_DIR/Renderer.mm" -framework AppKit -framework CoreImage -o "$OUTPUT_DIR/render-preview"
