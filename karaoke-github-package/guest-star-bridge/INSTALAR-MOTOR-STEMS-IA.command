#!/bin/bash
set -euo pipefail

engine_root="$HOME/Library/Application Support/Guest Star/stem-engine"
script_root="$(cd "$(dirname "$0")" && pwd)"

if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Guest Star necesita Node.js y npm para instalar el motor IA."
  read -r -p "Pulsa Enter para cerrar."
  exit 1
fi

echo "Instalando Spleeter rápido, Demucs HQ y sus herramientas de audio..."
echo "Esta descarga se realiza una sola vez y puede tardar varios minutos."
bash "$script_root/scripts/install-stem-engine-macos.sh" "$engine_root"

echo
echo "Motor Stems IA instalado y verificado. Cierra y vuelve a abrir Guest Star."
read -r -p "Pulsa Enter para cerrar."
