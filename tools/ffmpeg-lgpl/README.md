# Compilación LGPL de FFmpeg para WebAssembly (ChispaBox)

Scripts reproducibles para compilar un núcleo FFmpeg de una hebra, sin GPL ni componentes no redistribuibles.

- `versions.sh`: versiones, URLs oficiales y SHA-256 de cada dependencia, commit de FFmpeg y digest de la imagen Emscripten.
- `build-docker.sh`: ejecuta el build dentro de `emscripten/emsdk` (uso: `build-docker.sh <ffmpeg.wasm-core> <deps> <trabajo>`; el código debe estar en el commit fijado).
- `build-lgpl.sh`: verifica SHA-256, compila zlib, LAME, Opus y FFmpeg, y enlaza `ffmpeg-core.js` y `.wasm`.
- `bind-pre.js`, `bind-post.js`: API compatible con `@ffmpeg/core` 0.12 (`exec`, `setLogger`, `setProgress`, `setTimeout`, `reset`).
- `pruebas/`: arnés de conversión (`prueba.html` para navegador, `prueba-nucleo.mjs` y `opus-matriz.mjs` para Node).

Estado y resultados: ver `docs/ffmpeg-lgpl.md`. El binario no se incluye en el repositorio.

Notas de reproducción en Windows: el checkout de `ffmpeg.wasm-core` debe hacerse con `core.autocrlf=false`; si los scripts quedan con CRLF, fallan en el contenedor.
