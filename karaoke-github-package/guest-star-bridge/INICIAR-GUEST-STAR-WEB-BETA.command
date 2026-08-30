#!/bin/bash
set -u

BETA_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$BETA_DIR"

if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display alert "Falta Node.js" message "Instala Node.js 18 o más reciente para abrir Guest Star Web Beta." as critical' >/dev/null 2>&1 || true
  open "https://nodejs.org/en/download"
  exit 1
fi

export GUEST_STAR_PORT=8790
export GUEST_STAR_WEB_BETA=1

(sleep 2; open "http://127.0.0.1:8790") &
exec node src/server.mjs
