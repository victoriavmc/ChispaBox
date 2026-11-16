#!/bin/bash
# Compila un núcleo FFmpeg para WebAssembly (una sola hebra) bajo LGPL-2.1-or-later.
# Se ejecuta DENTRO del contenedor emscripten/emsdk (ver build-docker.sh).
#
# Entradas (montadas por build-docker.sh):
#   /src   -> copia del repositorio ffmpegwasm/ffmpeg.wasm-core en el commit fijado en versions.sh
#   /deps  -> tarballs de las dependencias, verificados con SHA-256 antes de compilar
# Salida:
#   /src/wasm/packages/core-st/dist/ffmpeg-core.js y ffmpeg-core.wasm
#
# Sin --enable-gpl, sin --enable-nonfree, sin x264/x265/fdk-aac/wavpack/libass/freetype.
# libvorbis/libogg se omiten: la herramienta no codifica Vorbis (la salida OGG usa Opus).
set -euo pipefail

source /tools/versions.sh

# La imagen emscripten no incluye pkg-config, que FFmpeg usa para encontrar opus (lo instala también ffmpeg.wasm-core).
if ! command -v pkg-config >/dev/null; then
  apt-get update && apt-get install -y pkg-config
fi

BUILD=/work/build
mkdir -p "$BUILD" /work/libs
export PATH="$PATH:$EMSDK/upstream/bin"

# ---------- 1. Verificar y extraer dependencias ----------
verificar() {
  local archivo="$1" esperado="$2"
  local real
  real=$(sha256sum "/deps/$archivo" | cut -d' ' -f1)
  if [[ "$real" != "$esperado" ]]; then
    echo "SHA-256 no coincide para $archivo: $real" >&2
    exit 1
  fi
  echo "OK sha256 $archivo"
}

verificar "$ZLIB_ARCHIVO" "$ZLIB_SHA256"
verificar "$LAME_ARCHIVO" "$LAME_SHA256"
verificar "$OPUS_ARCHIVO" "$OPUS_SHA256"

for archivo in "$ZLIB_ARCHIVO" "$LAME_ARCHIVO" "$OPUS_ARCHIVO"; do
  tar -xzf "/deps/$archivo" -C /work/libs
done

CFLAGS_BASE="-O3 -msimd128 -I$BUILD/include"
export CFLAGS="$CFLAGS_BASE"
export CXXFLAGS="$CFLAGS_BASE"
export LDFLAGS="$CFLAGS_BASE -L$BUILD/lib"
export EM_PKG_CONFIG_PATH="$BUILD/lib/pkgconfig"

# ---------- 2. zlib ----------
cd "/work/libs/$ZLIB_DIR"
emconfigure ./configure --static --prefix="$BUILD"
emmake make -j"$(nproc)" libz.a
emmake make install

# ---------- 3. LAME (MP3, LGPL-2.0+) ----------
cd "/work/libs/$LAME_DIR"
emconfigure ./configure --prefix="$BUILD" --host=i686-linux --disable-shared --disable-frontend \
  --disable-analyzer-hooks --disable-dependency-tracking --disable-gtktest
emmake make clean || true
emmake make -j"$(nproc)" install

# ---------- 6. Opus (BSD-3) ----------
cd "/work/libs/$OPUS_DIR"
emconfigure ./configure --prefix="$BUILD" --host=i686-gnu --enable-shared=no --disable-asm \
  --disable-rtcd --disable-doc --disable-extra-programs --disable-stack-protector
emmake make clean || true
emmake make -j"$(nproc)" install

# ---------- 7. FFmpeg (LGPL-2.1-or-later, sin --enable-gpl) ----------
cd /src
export PKG_CONFIG_PATH="$BUILD/lib/pkgconfig"
export PKG_CONFIG_LIBDIR="$BUILD/lib/pkgconfig"
FFMPEG_CONFIG=(
  --target-os=none --arch=x86_32 --enable-cross-compile
  --disable-x86asm --disable-inline-asm --disable-stripping --disable-programs --disable-doc
  --disable-debug --disable-runtime-cpudetect --disable-autodetect
  --disable-pthreads --disable-w32threads --disable-os2threads
  --extra-cflags="$CFLAGS" --extra-cxxflags="$CFLAGS" --extra-ldflags="$LDFLAGS"
  --pkg-config-flags="--static" --nm=llvm-nm --ar=emar --ranlib=emranlib
  --cc=emcc --cxx=em++ --objcc=emcc --dep-cc=emcc
  --enable-zlib --enable-libmp3lame --enable-libopus
)
echo "FFMPEG_CONFIG=${FFMPEG_CONFIG[*]}"
./configure "${FFMPEG_CONFIG[@]}"
emmake make -j"$(nproc)"

# La pila por defecto de wasm (64 KB) no basta para el codificador CELT estéreo de libopus a 48 kHz:
# provoca un desbordamiento silencioso («memory access out of bounds»). Se fija en 2 MB.
# ---------- 8. Enlazar el núcleo WASM (una hebra) ----------
# fftools de la CLI sin ffplay/ffprobe (FFmpeg 5.1 añade ffmpeg_mux.c y opt_common.c).
FFTOOLS_FUENTES=$(ls fftools/*.c | grep -v -E '(ffplay|ffprobe)[.]c$' | tr '\n' ' ')
echo "FFTOOLS=$FFTOOLS_FUENTES"
DIST=/src/wasm/packages/core-st/dist
mkdir -p "$DIST"
emcc -I. -I./fftools -I"$BUILD/include" \
  -Llibavcodec -Llibavdevice -Llibavfilter -Llibavformat -Llibavutil -Llibswscale -Llibswresample -L"$BUILD/lib" \
  -Wno-deprecated-declarations -Wno-pointer-sign -Wno-implicit-int-float-conversion -Wno-switch -Wno-parentheses -Qunused-arguments \
  -lavdevice -lavfilter -lavformat -lavcodec -lswresample -lswscale -lavutil -lm \
  -lmp3lame -lopus -lz \
  $FFTOOLS_FUENTES \
  -s INVOKE_RUN=0 -s EXIT_RUNTIME=0 -s MODULARIZE=1 -s EXPORT_ES6=1 -s EXPORT_NAME="createFFmpegCore" \
  -s EXPORTED_FUNCTIONS="[_main]" \
  -s EXPORTED_RUNTIME_METHODS="[callMain, FS, cwrap, ccall, setValue, writeAsciiToMemory, lengthBytesUTF8, stringToUTF8, UTF8ToString]" \
  --post-js /tools/bind-post.js --pre-js /tools/bind-pre.js \
  -O3 -s STACK_SIZE=2097152 -s INITIAL_MEMORY=33554432 -s MAXIMUM_MEMORY=1073741824 -s ALLOW_MEMORY_GROWTH=1 \
  -o "$DIST/ffmpeg-core.js"

echo "Compilación terminada: $DIST"
ls -la "$DIST"
