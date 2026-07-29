#!/bin/bash
set -u

BRIDGE_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$BRIDGE_DIR"

if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display alert "Falta Node.js" message "Instala Node.js 18 o más reciente y vuelve a abrir Guest Star Bridge." as critical' >/dev/null 2>&1 || true
  open "https://nodejs.org/en/download"
  exit 1
fi

(sleep 2; open "http://127.0.0.1:8787") &
exec node src/server.mjs
