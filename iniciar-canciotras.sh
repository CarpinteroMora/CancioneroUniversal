#!/usr/bin/env bash
# Abre Cancionero Universal. La primera vez lo deja listo en segundo plano y en el menú de aplicaciones.
cd "$(dirname "$(readlink -f "$0")")" || exit 1
if ! command -v python3 >/dev/null 2>&1; then
  msg="Cancionero Universal necesita Python 3 (sudo apt install python3)."
  command -v notify-send >/dev/null && notify-send "Cancionero Universal" "$msg"
  echo "$msg" >&2
  exit 1
fi
exec python3 servidor/canciotras_servidor.py "$@"
