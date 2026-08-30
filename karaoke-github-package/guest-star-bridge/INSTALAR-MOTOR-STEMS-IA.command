#!/bin/bash
set -euo pipefail

engine_root="$HOME/Library/Application Support/Guest Star/stem-engine"
script_root="$(cd "$(dirname "$0")" && pwd)"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Guest Star necesita Node.js y npm para instalar el motor IA."
  read -r -p "Pulsa Enter para cerrar."
  exit 1
fi

mkdir -p "$engine_root"

echo "Instalando el motor gratuito Demucs y sus herramientas de audio..."
echo "Esta descarga se realiza una sola vez y puede tardar varios minutos."
npm install \
  --prefix "$engine_root" \
  --omit=dev \
  --no-audit \
  --no-fund \
  --save-exact \
  demucs@1.0.0 \
  ffmpeg-static@5.3.0 \
  ffprobe-static@3.1.0

node "$script_root/scripts/stems-engine-smoke.mjs" "$engine_root"

echo
echo "Motor Stems IA instalado y verificado. Cierra y vuelve a abrir Guest Star."
read -r -p "Pulsa Enter para cerrar."
