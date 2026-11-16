# Oferta de código fuente y avisos — núcleo FFmpeg de ChispaBox

Este documento acompaña al núcleo `ffmpeg-core.js` y `ffmpeg-core.wasm` que ChispaBox sirve en la función «Convertir audio». Cumple las obligaciones de la GNU LGPL-2.1 (FFmpeg), LGPL-2.0 (LAME) y de las licencias BSD-3-Clause (Opus) y zlib, para el binario distribuido.

## 1. Binario distribuido

| Archivo | Tamaño (bytes) | SHA-256 |
|---|---|---|
| `ffmpeg-core.wasm` | 19417194 | 78959ed5caed69fb377d8843ba9ab5afeb77746b87d84075b8de4aa01ff34840 |
| `ffmpeg-core.js` | 111392 | 9637e453aad68a832ba9497f5cc99dbe13650e58a617e8ddc5bb5d0991d1c3dd |

Compilación: FFmpeg 5.1.4 + LAME 3.100 (libmp3lame) + Opus 1.5.2 (libopus) + zlib 1.3.1, con Emscripten 3.1.30, una hebra (`--disable-pthreads`). Configuración de FFmpeg:

`--target-os=none --arch=x86_32 --enable-cross-compile --disable-x86asm --disable-inline-asm --disable-programs --disable-doc --disable-debug --disable-runtime-cpudetect --disable-autodetect --disable-pthreads --enable-zlib --enable-libmp3lame --enable-libopus`

Sin `--enable-gpl`, sin `--enable-nonfree`, sin x264, x265 ni fdk-aac. Verificable en el binario con `-buildconf` (no muestra `--enable-gpl`).

## 2. Código fuente correspondiente

Todos los archivos están en `fuentes/`. Hashes en `fuentes/SHA256SUMS.txt`.

| Componente | Archivo | Origen | Versión |
|---|---|---|---|
| FFmpeg | `fuentes/ffmpeg-5.1.4-fuente.tar.gz` | Repositorio oficial `github.com/FFmpeg/FFmpeg`, commit `4729204c17f756e186d622060088371d10b34f7e` (etiqueta `n5.1.4`). Generado con `git archive` desde ese commit | 5.1.4 |
| LAME | `fuentes/lame-3.100.tar.gz` | Paquete oficial de LAME (SourceForge) | 3.100 |
| Opus | `fuentes/opus-1.5.2.tar.gz` | Paquete oficial de Xiph.Org | 1.5.2 |
| zlib | `fuentes/zlib-1.3.1.tar.gz` | Paquete oficial de zlib.net | 1.3.1 |
| Scripts de compilación y capa JS | `fuentes/build/` | Código de ChispaBox (`tools/ffmpeg-lgpl/` del repositorio) | — |

**Modificaciones al código de FFmpeg, LAME, Opus y zlib:** ninguna. Los archivos son los publicados por sus autores. Lo que ChispaBox añade está en `fuentes/build/`: scripts de compilación, versiones fijadas y la capa JavaScript (`bind-pre.js`, `bind-post.js`) que expone la API de ejecución compatible con `@ffmpeg/ffmpeg`.

## 3. Licencias incluidas

En `licencias/`:
- `LGPL-2.1-FFmpeg.txt`: texto de la GNU LGPL versión 2.1 (`COPYING.LGPLv2.1` del código de FFmpeg).
- `LGPL-2.0-LAME.txt`: texto de la GNU LGPL versión 2.0 (`COPYING` de LAME 3.100).
- `BSD-3-Clause-Opus.txt`: licencia de Opus.
- `zlib-LICENSE.txt`: licencia de zlib.

Los textos completos de GPL-2.0, LGPL-2.1 y LGPL-3.0 usados en el proyecto están en el repositorio, en `licenses/`, con su origen y verificación en `THIRD_PARTY_NOTICES.md`.

## 4. Reemplazo y reconstrucción (LGPL)

Puedes reemplazar `ffmpeg-core.js` y `ffmpeg-core.wasm` por tu propia compilación compatible con la misma API (`exec`, `setLogger`, `setProgress`, `setTimeout`, `reset`). Para reconstruirla:

1. Verifica los hashes: `sha256sum -c SHA256SUMS.txt` dentro de `fuentes/`.
2. Extrae `ffmpeg-5.1.4-fuente.tar.gz` y `build/`, y coloca las dependencias (`lame`, `opus`, `zlib`) junto a ellas, como indica `build/README.md`.
3. Ejecuta `build/build-docker.sh` (requiere Docker con `emscripten/emsdk:3.1.30`). El script verifica los SHA-256 antes de compilar.

**Reproducibilidad:** la compilación se verificó funcionalmente (pruebas de conversión), pero no bit a bit: no se ha comprobado que dos compilaciones den el mismo hash.

## 5. Oferta escrita

Quien reciba este binario puede obtener el código fuente correspondiente de los componentes anteriores durante al menos tres años desde su distribución, sin costo, mediante los mismos archivos publicados en `fuentes/` y, si los necesitas, solicitándolos por el formulario de contacto de ChispaBox (sección «Contacto y sugerencias» de la página de políticas).

## 6. Límites de esta oferta
- Los archivos generados por Emscripten (runtime de `ffmpeg-core.js` y libc incluida en el `.wasm`) están bajo licencias permisivas (MIT en Emscripten y musl). La versión exacta de sus avisos en el contenedor 3.1.30 **no se ha verificado** y debe comprobarse antes de publicar.
- Esta oferta es una medida técnica de cumplimiento. No constituye asesoramiento jurídico (**revisión jurídica pendiente**).
