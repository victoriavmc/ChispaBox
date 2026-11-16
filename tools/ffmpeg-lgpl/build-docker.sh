#!/bin/bash
# Ejecuta build-lgpl.sh dentro del contenedor emscripten/emsdk fijado en versions.sh.
# Uso: build-docker.sh <directorio_ffmpeg_wasm_core> <directorio_dependencias> <directorio_trabajo>
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
source "$HERE/versions.sh"

SRC="$(cd "$1" && (pwd -W 2>/dev/null || pwd))"
DEPS="$(cd "$2" && (pwd -W 2>/dev/null || pwd))"
WORK="$(mkdir -p "$3" && cd "$3" && (pwd -W 2>/dev/null || pwd))"

# El código debe estar en el commit fijado.
actual=$(git -C "$SRC" rev-parse HEAD)
if [[ "$actual" != "$FFMPEG_COMMIT" ]]; then
  echo "Commit distinto al fijado: $actual (esperado $FFMPEG_COMMIT)" >&2
  exit 1
fi

docker run --rm \
  -v "$SRC:/src" \
  -v "$DEPS:/deps:ro" \
  -v "$(cd "$HERE" && (pwd -W 2>/dev/null || pwd)):/tools:ro" \
  -v "$WORK:/work" \
  "$EMSDK_IMAGE" bash /tools/build-lgpl.sh
