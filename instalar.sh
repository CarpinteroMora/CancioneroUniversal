#!/usr/bin/env bash
# Instalador de Cancionero Universal para Linux y Mac (reproducción local de YouTube y otras páginas):
#   curl -fsSL https://carpinteromora.github.io/CancioneroUniversal/instalar.sh | bash
# Descarga la app, la deja funcionando en segundo plano y la agrega al menú de aplicaciones.
set -euo pipefail

REPO_ZIP="${CANCIONERO_ZIP:-https://github.com/CarpinteroMora/CancioneroUniversal/archive/refs/heads/main.zip}"
PORT=8777

say()  { printf '\n\033[1;32m%s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m%s\033[0m\n' "$*" >&2; exit 1; }

if [ "$(uname)" = "Darwin" ]; then
  MAC=1
  DEST="$HOME/Library/Application Support/Cancionero Universal"
else
  MAC=0
  DEST="${XDG_DATA_HOME:-$HOME/.local/share}/cancionero-universal"
fi

if ! python3 -c 'import sys; sys.exit(sys.version_info < (3, 8))' >/dev/null 2>&1; then
  if [ "$MAC" = 1 ]; then
    fail "Falta Python 3. Acepta la instalación de las «herramientas de línea de comandos» que ofrece el Mac
(o escribe: xcode-select --install) y vuelve a pegar el comando."
  fi
  fail "Falta Python 3. Instálalo (en Ubuntu, Debian o Mint: sudo apt install python3) y vuelve a pegar el comando."
fi

say "Descargando Cancionero Universal…"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "$REPO_ZIP" -o "$TMP/app.zip"
python3 -m zipfile -e "$TMP/app.zip" "$TMP/x"
SRC="$(find "$TMP/x" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
[ -f "$SRC/servidor/canciotras_servidor.py" ] || fail "La descarga no está completa. Vuelve a intentarlo."

# yt-dlp y Deno de una instalación anterior se conservan (son pesados de descargar)
if [ -d "$DEST/servidor/bin" ]; then mv "$DEST/servidor/bin" "$TMP/bin"; fi
rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
mv "$SRC" "$DEST"
if [ -d "$TMP/bin" ]; then mv "$TMP/bin" "$DEST/servidor/bin"; fi
chmod +x "$DEST/iniciar-canciotras.sh"

say "Instalando en $DEST…"
python3 "$DEST/servidor/canciotras_servidor.py" --instalar

say "Preparando el reproductor (la primera vez descarga yt-dlp y Deno: puede tardar un par de minutos)…"
for _ in $(seq 1 60); do
  if curl -fs --max-time 8 "http://127.0.0.1:$PORT/api/estado" 2>/dev/null | grep -q CancioTras; then
    say "Listo: Cancionero Universal quedó instalado.
Vuelve a la página y pulsa «Reproducir». También está en tu menú de aplicaciones."
    exit 0
  fi
  sleep 3
done
fail "El reproductor no respondió. Abre Cancionero Universal desde el menú de aplicaciones y vuelve a la página."
