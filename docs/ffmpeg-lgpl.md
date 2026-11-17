# FFmpeg LGPL para WebAssembly: resultados del rebase a FFmpeg 5.1.4

Fecha: **16 nov 2026**. Estado: **reemplazado en el repositorio** (16 nov 2026). `public/ffmpeg-lgpl/` sustituye a `@ffmpeg/core` (GPL), que se desinstaló. La app usa un motor nuevo por conversión. Probado en el build real: 77/77 combinaciones. Sin commit ni push.

## 1. Resumen

| Formato de salida de *Convertir audio* | Núcleo publicado (GPL, FFmpeg 5.1.4) | Variante LGPL (FFmpeg 5.1.4 oficial) |
|---|---|---|
| MP3 (libmp3lame) | Funciona: 48,945 B, SNR 26 dB | **Idéntico**: 48,945 B, SNR 26 dB |
| M4A / MP4 (AAC nativo) | Funciona: 49,282 B, SNR 29,7 dB | **Idéntico**: 49,282 B, SNR 29,7 dB |
| FLAC | Funciona: 97,245 B, sin pérdida | **Idéntico** |
| WAV (PCM 16 bits) | Funciona: 529,278 B | **Idéntico** |
| OGG (libopus, estéreo) | **Falla**: «memory access out of bounds» | **Funciona** |
| WebM (libopus, estéreo) | **Falla**: mismo error | **Funciona** |

## 2. Qué cambió frente a la versión anterior de la variante
- Base: FFmpeg **5.1.4 oficial** (`github.com/FFmpeg/FFmpeg`, etiqueta `n5.1.4`, commit `4729204c17f756e186d622060088371d10b34f7e`), en lugar del fork `f888b52` (FFmpeg 4.x). Ya no hay diferencias de versión con el núcleo publicado.
- Se eliminaron los archivos JS de pre/post del fork: solo redefinían `quit` y `exit`, que `exec` ya maneja.
- La lista de fuentes de `fftools` se toma del directorio (sin `ffplay` ni `ffprobe`), para incluir `ffmpeg_mux.c` y `opt_common.c` de 5.1.
- Pila de wasm de 2 MB (`STACK_SIZE`). Es la corrección del fallo de Opus estéreo (ver §3).

## 3. Causa del fallo de Opus: pila de wasm insuficiente
- Síntoma: codificar estéreo a 48 kHz terminaba con «Audio encoding failed» (variante) o «memory access out of bounds» (núcleo publicado).
- Prueba aislada con libopus sin FFmpeg: con pila de 64 KB el codificador estéreo a 48 kHz sale fuera de límites; con 1 MB codifica bien.
- Mismo caso en el núcleo publicado: el error de memoria sugiere el mismo problema. **Hay que confirmarlo dentro de la app** antes de darlo por hecho.

## 4. Compilación reproducible
- Scripts y versiones: `tools/ffmpeg-lgpl/` (`build-lgpl.sh`, `build-docker.sh`, `versions.sh`, `bind-pre.js`, `bind-post.js`).
- Entorno: `emscripten/emsdk:3.1.30`, digest `sha256:3977e19edd48f8370b1fe43bfe0368439d3521f0bbe0d96e6d018fc076241491`.
- Una hebra (`--disable-pthreads`), como `@ffmpeg/core`.
- Configuración de FFmpeg: `--target-os=none --arch=x86_32 --enable-cross-compile --disable-x86asm --disable-inline-asm --disable-programs --disable-doc --disable-debug --disable-runtime-cpudetect --disable-autodetect --disable-pthreads --enable-zlib --enable-libmp3lame --enable-libopus`, con `-msimd128`. Sin `--enable-gpl`, `--enable-nonfree`, x264, x265 ni fdk-aac.
- Dependencias de sus sitios oficiales, verificadas con SHA-256: zlib 1.3.1, LAME 3.100, Opus 1.5.2.
- Verificado en el binario: `-encoders` incluye `aac`, `flac`, `libmp3lame`, `libopus`, `pcm_s16le`; `-buildconf` no incluye `--enable-gpl` ni `libx264`.
- Artefacto final, fuera del repositorio y sin distribuir: `ffmpeg-core.wasm` 19,417,194 bytes, SHA-256 `78959ed5caed69fb377d8843ba9ab5afeb77746b87d84075b8de4aa01ff34840`.
- Capa de API compatible con `@ffmpeg/ffmpeg` (`exec`, `setLogger`, `setProgress`, `setTimeout`, `reset`). `ffprobe` no está incluido.

## 5. Pruebas
- **Batería de conversión (navegador, `tools/ffmpeg-lgpl/pruebas/prueba.html`)**: entrada sintética estéreo 44,1 kHz, 3 s, con ida y vuelta a WAV. Todos los casos devuelven código 0 en la variante; OGG y WebM fallan en el núcleo publicado.
- **Entradas (Node, `pruebas/entradas.mjs`)**: MKV con Opus y MOV con AAC codifican y decodifican. Los decodificadores `amrnb` y `amrwb` están incluidos; **no se probaron archivos AMR ni 3GP reales**.
- **Calidad de Opus (Node, `pruebas/opus-snr.mjs`)**: estéreo 48 kHz, 128 kb/s: 13,9 dB de SNR con alineación automática de retardo. Orientativo con tonos puros. No hay comparación de calidad con el núcleo publicado porque no se pudo ejecutar en Node.
- **Rendimiento (navegador)**: MP3 101 ms (publicado) frente a 99 ms (variante); M4A 220 ms frente a 222 ms; FLAC 28 ms frente a 29 ms; WAV 14 ms frente a 16 ms. Montón WASM inicial de 32 MB en ambos. No se midió pico de memoria.

## 6. Pendiente antes de reemplazar
1. Probar dentro de la app con archivos reales de cada formato de entrada (AMR, 3GP, MKV, MOV, OGG, WebM, MP3, M4A, WAV, FLAC), en mono y estéreo.
2. Confirmar en la app el fallo de OGG/WebM del núcleo publicado con entrada estéreo.
3. Verificado el 16 nov 2026: la app ya carga la variante desde `public/ffmpeg-lgpl/` (`src/scripts/convertir-audio.ts`). `@ffmpeg/core` está eliminado del proyecto.
4. Licencias: si se distribuye, quedan las obligaciones LGPL (`THIRD_PARTY_NOTICES.md`, fila 1b) y el código fuente de FFmpeg 5.1.4 y de LAME 3.100 en la versión entregada.
5. Decisión de la titular.

## 7. Prueba dentro de la app (16 nov 2026)

Método: copias de `dist/` con la página «Convertir audio» real, sin tocar el repositorio. En la copia LGPL se reemplazaron los dos archivos del núcleo (`ffmpeg-core-*.js` y `.wasm`) por la variante. Se automatizó la carga de cada archivo, la elección de cada formato de salida y el clic en «Convertir». Se verificó que cada salida tenga la cabecera del formato pedido (RIFF/WAVE, fLaC, OggS, ftyp, ID3 o cuadro MPEG, EBML).

Entradas (generadas con la variante): MP3 estéreo y mono, M4A, FLAC, WAV estéreo y mono, OGG estéreo y mono, WebM, MKV y MOV. Salidas: MP3, OGG, M4A, MP4, WAV, FLAC y WebM (77 combinaciones).

| Copia | Resultado |
|---|---|
| App publicada, tal como está | 1 de 77: después de la primera conversión, todas fallan en la misma visita |
| App publicada + reinicio del motor por conversión | 61 de 77: fallan OGG y WebM con entrada estéreo (mismo bug de pila) |
| App con variante LGPL + reinicio del motor por conversión | **77 de 77** |

### Dos hallazgos de la app publicada
1. **Bug previo, independiente de la variante:** la página reutiliza el mismo motor FFmpeg para todas las conversiones. El CLI de FFmpeg no reinicia sus variables globales entre ejecuciones, así que la segunda conversión de la visita falla con «memory access out of bounds». Verificado en la copia publicada: solo la primera conversión funciona. Corrección propuesta: crear un motor nuevo por conversión (`terminate()` y volver a `load()`), que es lo que se probó en la copia.
2. **OGG y WebM con entrada estéreo:** el mismo bug de pila de wasm que en la variante. La variante LGPL lo corrige.

### Cambios en la variante para la app
- `bind-pre.js`: `locateFile` que decodifica las URL del `.wasm` y del worker que pasa `@ffmpeg/ffmpeg` (sin esto la carga falla con «expected magic word»).
- Hash del glue final: `ffmpeg-core.js` (cambió por `bind-pre.js`); el `.wasm` no cambió (SHA-256 `78959ed5…`).

### Pendiente
- Cambio en el repositorio: `src/scripts/convertir-audio.ts` (motor por conversión) y reemplazo de los dos archivos del núcleo por la variante. **No hecho**: requiere autorización.
- Archivos AMR y 3GP reales: no disponibles para generarlos aquí. Los decodificadores están incluidos.
- Calidad de Opus frente al núcleo publicado: pendiente (ver §5).

## 8. Reconstrucción verificada (16 nov 2026)
La reconstrucción con `tools/ffmpeg-lgpl/build-docker.sh` (imagen `emscripten/emsdk:3.1.30`, digest `sha256:3977e19e…`, commit FFmpeg `4729204c`) produjo un `ffmpeg-core.wasm` y un `ffmpeg-core.js` idénticos bit a bit a los publicados (SHA-256 `78959ed5…` y `9637e453…`). Detalle del procedimiento y de las verificaciones en este documento (sección 8).
