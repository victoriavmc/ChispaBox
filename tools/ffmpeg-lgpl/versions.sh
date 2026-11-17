# Versiones fijadas de la compilación LGPL de FFmpeg para WebAssembly (ChispaBox).
# Cada fuente se descarga desde su sitio oficial y se verifica con SHA-256 antes de compilar.

# FFmpeg: repositorio oficial, etiqueta n5.1.4.
FFMPEG_REPO=https://github.com/FFmpeg/FFmpeg.git
FFMPEG_COMMIT=4729204c17f756e186d622060088371d10b34f7e
# FFmpeg n5.1.4 (etiqueta oficial), igual que el núcleo publicado (FFmpeg 5.1.4).

# Emscripten: la misma versión que usa el proyecto ffmpeg.wasm-core (build-with-docker.sh).
EMSDK_IMAGE=emscripten/emsdk:3.1.30
# Digest verificado el 16 nov 2026: emscripten/emsdk@sha256:3977e19edd48f8370b1fe43bfe0368439d3521f0bbe0d96e6d018fc076241491

# zlib 1.3.1 (licencia zlib): https://zlib.net/
ZLIB_ARCHIVO=zlib-1.3.1.tar.gz
ZLIB_DIR=zlib-1.3.1
ZLIB_SHA256=9a93b2b7dfdac77ceba5a558a580e74667dd6fede4585b91eefb60f03b72df23

# LAME 3.100 (LGPL-2.0; texto COPYING del paquete): https://lame.sourceforge.io/
LAME_ARCHIVO=lame-3.100.tar.gz
LAME_DIR=lame-3.100
LAME_SHA256=ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e

# Opus 1.5.2 (BSD-3-Clause, texto COPYING del paquete): https://opus-codec.org/
OPUS_ARCHIVO=opus-1.5.2.tar.gz
OPUS_DIR=opus-1.5.2
OPUS_SHA256=65c1d2f78b9f2fb20082c38cbe47c951ad5839345876e46941612ee87f9a7ce1
