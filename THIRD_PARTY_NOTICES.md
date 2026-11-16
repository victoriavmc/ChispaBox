# Avisos de terceros — ChispaBox

Fecha de revisión: **16 nov 2026**. Alcance: componentes que se distribuyen en la compilación pública (`npm run build` → `dist/`) y el material que debe acompañarlos.

**Esta lista es una revisión técnica de licencias, no una certificación legal.** Cada licencia rige sus propios términos; si hay dudas de interpretación, consultar con un profesional del derecho.

## 1. Regla general aplicada

- La licencia del código original (`LICENSE`) **no reemplaza ni restringe** las licencias de terceros.
- Un aviso de «todos los derechos reservados» en el código propio **no elimina** las obligaciones de una licencia copyleft (GPL/LGPL) sobre el componente de terceros que se distribuye.
- Un sitio web que sirve un archivo al navegador de un visitante **distribuye** ese archivo a efectos de estas licencias.

**Método de inventario (16 nov 2026):** se compiló la copia pública con mapas de código fuente (`vite build --sourcemap`) y se listaron los paquetes npm cuyo código aparece en `dist/`. Esa lista es la base de la sección 2. Los datos del diccionario y los recursos de PDF.js se copian a `dist/` tal cual y se listan aparte.

**Convención de estado:** «Confirmado» significa que la fuente fue leída y coincide. «Inferido» significa que el vínculo entre la fuente y el archivo distribuido se deduce y no se demuestra. «Pendiente» significa que no hay evidencia suficiente para afirmar la licencia.

## 2. Componentes que se distribuyen

| # | Componente | Versión | Licencia | Dónde aparece en el build | Obligaciones que genera | Material que debe acompañar el build | Estado |
|---|---|---|---|---|---|---|---|
| 1 | Núcleo FFmpeg propio (LGPL), en `public/ffmpeg-lgpl/` | FFmpeg 5.1.4 | **LGPL-2.1-or-later** (FFmpeg); LGPL-2.0 (LAME 3.100); BSD-3-Clause (Opus 1.5.2); licencia zlib 1.3.1 | `public/ffmpeg-lgpl/ffmpeg-core.js` y `.wasm` (función *Convertir audio* y exportar MP3) | Texto LGPL-2.1 y LGPL-2.0, código fuente de FFmpeg 5.1.4 y de LAME 3.100 de la versión distribuida, avisos y posibilidad de reemplazar el núcleo. Instrucciones en `public/ffmpeg-lgpl/LEEME.md`. | Compilado en `tools/ffmpeg-lgpl/`; probado en la app (77/77). Textos en `licenses/` (sección 5). Fuente y avisos en `public/ffmpeg-lgpl/fuentes/` y `OFERTA-CODIGO-FUENTE.md`. | Incorporado; textos y fuente incluidos |
| 2 | @ffmpeg/ffmpeg | 0.12.15 | MIT | `dist/assets/` (función *Convertir audio*) | Conservar el aviso de copyright y el texto MIT. | `licenses/ffmpeg-wasm/LICENSE-ffmpeg.txt` (Copyright (c) 2019 Jerome Wu). Publicado en `/licencias/ffmpeg-wasm-MIT.txt`. | **Confirmado:** el commit de release `f78aed14…` («RELEASE: @ffmpeg/ffmpeg v0.12.15») tiene `version` 0.12.15, `license` MIT y el LICENSE con el copyright indicado. **Inferido:** que el tarball npm salga de ese commit (sin `gitHead`). Ver `licenses/ffmpeg-wasm/LEEME.md`. |
| 3 | @ffmpeg/util | 0.12.2 | MIT | `dist/assets/` (función *Convertir audio*) | Idem | `licenses/ffmpeg-wasm/LICENSE-util.txt` (mismo texto). Publicado en `/licencias/ffmpeg-wasm-MIT.txt`. | **Confirmado:** el commit `d3c018aa…` («util v12.2 release») tiene `version` 0.12.2, `license` MIT y el mismo LICENSE. **Inferido:** que el tarball npm salga de ese commit. |
| 4 | dictionary-es (diccionario español) | 4.0.0 | **Triple licencia a elección: GPL-3.0, LGPL-3.0 o MPL-1.1** | `dist/dictionaries/es/` | Elegir una y declararla. | `public/dictionaries/es/LICENSE-MPL-1.1.txt` y `LEEME.txt`. | **Elección declarada: MPL-1.1** (sección 4). |
| 5 | pdfjs-dist (PDF.js) | 6.5.438 | Apache-2.0 | `dist/assets/` y `dist/pdfjs/` (visor, comprimir y organizar páginas) | Texto Apache-2.0 y avisos. | `licenses/pdfjs-dist/LICENSE`. | Cumplido en el repositorio. |
| 6 | Fuentes de `public/pdfjs/standard_fonts/` (Foxit, Liberation) | — | Foxit: licencia propia del paquete (`LICENSE_FOXIT`); Liberation: SIL Open Font License 1.1 | `dist/pdfjs/standard_fonts/` | Mantener sus avisos junto a las fuentes. | `LICENSE_FOXIT` y `LICENSE_LIBERATION` (copiados por `scripts/copy-pdfjs.mjs`). | Cumplido por copia automática. |
| 7 | Módulos WASM y cmaps de PDF.js (`public/pdfjs/wasm/`, `cmaps/`) | — | Cada uno con su licencia (`LICENSE_*`: OpenJPEG, JBIG2, QCMS, QuickJS; cmaps de Adobe) | `dist/pdfjs/` | Mantener los avisos que acompañan cada archivo. | Archivos `LICENSE_*` y `cmaps/LICENSE` presentes en la copia. | Cumplido por copia. |
| 8 | @neslinesli93/qpdf-wasm (envoltorio de QPDF en WASM) | 0.3.0 | ISC (envoltorio). El binario QPDF es **Apache-2.0** | `dist/assets/` (función *Proteger PDF*) | Conservar el aviso ISC y el texto Apache-2.0. | `licenses/qpdf-wasm/LICENSE` (ISC, Copyright (c) 2026 Tommaso Pifferi). `licenses/qpdf-Apache-2.0/LICENSE`. Publicados en `/licencias/`. | **Confirmado:** QPDF **12.2.0** es la versión que indica el `Dockerfile` del commit `e661db2d…` del paquete, y su commit (`856d32c6…`) es el tag firmado `v12.2.0` de `qpdf/qpdf`. El copyright de QPDF aparece en el binario. **Inferido:** que el `dist/qpdf.wasm` del paquete 0.3.0 se compiló con ese `Dockerfile`. NOTICE no existe en v12.2.0, así que no se incluye. |
| 9 | pdf-lib | 1.17.1 | MIT | `dist/assets/` (dividir, unir, proteger) | Aviso MIT. | `licenses/pdf-lib/LICENSE.md`. | Cumplido en el repositorio. |
| 10 | @pdf-lib/standard-fonts | 1.0.0 | MIT | `dist/assets/` (fuentes estándar de pdf-lib) | Aviso MIT. | `licenses/pdf-lib-standard-fonts/LICENSE` (Copyright (c) 2018 Andrew Dillon). | Cumplido en el repositorio. |
| 11 | @pdf-lib/upng | 1.0.1 | MIT | `dist/assets/` (pdf-lib, imágenes PNG) | Aviso MIT. | `licenses/pdf-lib-upng/LICENSE` (Copyright (c) 2017 Photopea). | Cumplido en el repositorio. |
| 12 | pako | 1.0.11 | MIT **y** Zlib | `dist/assets/` (pdf-lib, compresión) | Avisos MIT y Zlib. | `licenses/pako/LICENSE` (Copyright (C) 2014-2017 Vitaly Puzrin y Andrei Tuputcyn). | Cumplido en el repositorio. |
| 13 | tslib | 2.9.1 | 0BSD | `dist/assets/` (pdf-lib) | Sin obligación de aviso; se conserva por transparencia. | `licenses/tslib/LICENSE`. | Cumplido en el repositorio. |
| 14 | papaparse | 5.7.0 | MIT | `dist/assets/` (convertidor de datos) | Aviso MIT. | `licenses/papaparse/LICENSE`. | Cumplido en el repositorio. |
| 15 | qrcode | 1.5.4 | MIT | `dist/assets/` (generador QR) | Aviso MIT. | `licenses/qrcode/license`. | Cumplido en el repositorio. |
| 16 | dijkstrajs | 1.0.3 | MIT | `dist/assets/` (qrcode) | Aviso MIT. | `licenses/dijkstrajs/LICENSE`. | Cumplido en el repositorio. |
| 17 | jsqr | 1.4.0 | Apache-2.0 | `dist/assets/` (lector QR) | Texto Apache-2.0 y avisos. | `licenses/jsqr/LICENSE`. | Cumplido en el repositorio. |
| 18 | nspell | 2.1.5 | MIT | `dist/assets/` (ortografía) | Aviso MIT. | `licenses/nspell/license`. | Cumplido en el repositorio. |
| 19 | read-excel-file | 9.3.14 | MIT | `dist/assets/` (convertidor de datos, XLSX) | Aviso MIT. | `licenses/read-excel-file/LICENSE`. | Cumplido en el repositorio. |
| 20 | fflate | 0.8.3 | MIT | `dist/assets/` (read-excel-file, descompresión) | Aviso MIT. | `licenses/fflate/LICENSE` (Copyright (c) 2026 Arjun Barrett). | Cumplido en el repositorio. |
| 21 | worker-f | 0.1.24 | MIT **declarado** en `package.json` del tarball | No se distribuye desde la versión de este commit: `read-excel-file/browser` se compila con `src/shims/worker-f-browser.ts` (alias en `vite.config.ts`), que no ejecuta worker-f. Comprobado: no aparece código de worker-f en `dist/` ni en sus mapas (16 nov 2026). | Ninguno para la distribución; el aviso de worker-f deja de ser necesario mientras no se distribuya. | — | **Resuelto por sustitución** (equivalencia comprobada con `dist/` en navegador: convertidor de .xlsx a CSV, misma salida que la lectura en Node). Consulta al autor enviada; respuesta pendiente. |

| 22 | is-buffer | 2.0.5 | MIT | `dist/assets/` (dependencia de bundle) | Aviso MIT. | `licenses/is-buffer/LICENSE` (Copyright (c) Feross Aboukhadijeh). | Cumplido en el repositorio. |
| 23 | Contenido de Wiktionary (definiciones) | — | **Creative Commons Attribution-ShareAlike 4.0** (CC BY-SA 4.0) | No se distribuye en el repositorio: se consulta en tiempo real a la API de `es.wiktionary.org` y se muestra en la página. | Atribución (autor, fuente, enlace a la licencia y a la página), indicar si el texto se modificó, y licencia compartible (BY-SA). | La página de búsqueda indica la fuente y la licencia. | **Licencia confirmada** con `siteinfo/rightsinfo` de `es.wiktionary.org` (16 nov 2026): `https://creativecommons.org/licenses/by-sa/4.0/deed.es`. **Atribución corregida** en `paginas/buscar-palabra/index.html` (16 nov 2026): enlace a CC BY-SA 4.0, aviso de reorganización y enlace a la entrada original cuando existe. Obligación ShareAlike: el texto de Wiktionary no se redistribuye en el repositorio ni en `dist/`; se consulta en vivo. Si ese uso se considera adaptación redistribuida, se requiere revisión jurídica. |

Las librerías de desarrollo (por ejemplo, TypeScript, Vite o Sharp) no se incluyen en `dist/` y no requieren aviso en la distribución.

## 3. Componentes incorporados en el núcleo FFmpeg

LAME (MP3), Opus y zlib forman parte del núcleo FFmpeg (fila 1). Sus avisos y fuentes se incluyen en `public/ffmpeg-lgpl/`.

| Componente | Versión | Licencia | Fuente verificada | Evidencia | Estado |
|---|---|---|---|---|---|
| Emscripten (runtime de `ffmpeg-core.js` y glue) | 3.1.30 (imagen `emscripten/emsdk:3.1.30`, digest `sha256:3977e19e…`, según `tools/ffmpeg-lgpl/versions.sh`) | **MIT o University of Illinois/NCSA** (a elección) | Tag `3.1.30` de `emscripten-core/emscripten`, commit `cfe2bdfe2692457cb5f5770672f6e5ccb3ffc2f2` (API de GitHub). `LICENSE` leído en ese tag: «Copyright (c) 2010-2014 Emscripten authors, see AUTHORS file.» | El `licenses/Emscripten-LICENSE.txt` local pesa 5093 bytes, igual que el archivo del tag (5093 caracteres, ASCII). **No se comparó byte a byte.** | **Confirmado** (texto). El **contenido de la imagen Docker no se pudo inspeccionar**: Docker no está activo en este equipo. |
| dlmalloc (asignador de memoria en el `.wasm`) | 2.8.6 | **Dominio público** (declaración del código: «released to the public domain») | `system/lib/dlmalloc.c` del tag 3.1.30 | Cabecera leída (primeras líneas y texto de dedicatoria) | Confirmado por el código. Presencia en el binario: **inferida** del enlazado. |
| musl libc (libc en el `.wasm`) | — | **MIT** (`COPYRIGHT`, Rich Felker et al.) | `git.musl-libc.org/cgit/musl/plain/COPYRIGHT` | `licenses/musl-COPYRIGHT.txt` | Texto verificado. Presencia en el binario **inferida** del enlazado (`-lc`). |
| libc++ / libc++abi | — | Apache-2.0 con excepción LLVM | — | No verificado: no se inspeccionó el binario ni la imagen | **Pendiente.** Hace falta `wasm-objdump` o un mapa de enlace del contenedor para confirmar si hay símbolos de libc++. |

**Limitación de la verificación:** no se ejecutó Docker, así que no se confirmó el contenido de la imagen ni el mapa de enlace del binario. Las presencias de musl y dlmalloc son inferidas del script de compilación.

## 4. Diccionario español (`dictionary-es` 4.0.0)

- **Procedencia:** paquete npm `dictionary-es` 4.0.0 (Titus Wormer, repositorio `wooorm/dictionaries`). Los datos son el diccionario español para corrección ortográfica, **versión 2.8**, de Santiago Bosio (autor según su propio texto).
- **Licencia original (evidencia):** el texto que acompaña a los datos (`dictionary-es/license`, sha256 a21581497f07…) dice: «se distribuye bajo un triple esquema de licencias disjuntas: GNU GPL versión 3 o posterior, GNU LGPL versión 3 o posterior, ó MPL versión 1.1 o posterior. Puede seleccionar libremente bajo cuál de estas licencias utilizará este diccionario».
- **Elección declarada:** MPL-1.1. **Limitación:** el archivo `LICENSE.md` que menciona el texto no existe en el repositorio de origen (404).

## 5. Verificación de textos de licencia

| Licencia | Archivo | Fuente | Verificación |
|---|---|---|---|
| GPL-2.0 | `licenses/GPL-2.0/COPYING.txt` | `COPYING.GPLv2` de FFmpeg 5.1.4 (commit 4729204c) | Coincide con SPDX `GPL-2.0-only`. GNU (gnu.org) no respondió. |
| LGPL-2.1 | `licenses/LGPL-2.1/COPYING.txt` | `COPYING.LGPLv2.1` de FFmpeg 5.1.4 | Coincide con SPDX `LGPL-2.1-only`. |
| LGPL-3.0 | `licenses/LGPL-3.0/COPYING.txt` | `COPYING.LGPLv3` de FFmpeg 5.1.4 | Coincide con SPDX `LGPL-3.0-only`. |
| LGPL-2.0 (LAME) | `licenses/LGPL-2.0/COPYING.txt` | `COPYING` de lame-3.100 (sha256 ddfe36…) | Origen oficial del paquete. |
| MPL-1.1 | `licenses/MPL-1.1/MPL-1.1.txt` | mozilla.org/media/MPL/1.1/index.txt | Descargado; contiene «EXHIBIT A». |
| Apache-2.0 | `licenses/pdfjs-dist/LICENSE` y `licenses/qpdf-Apache-2.0/LICENSE` | Paquete pdfjs-dist; `LICENSE.txt` de QPDF v12.2.0 | Apache License, Version 2.0, January 2004 (ambos). |
| MIT, ISC y 0BSD de la sección 2 | Carpetas de `licenses/` indicadas en la sección 2 | LICENSE de cada paquete npm instalado (16 nov 2026), salvo los indicados como verificados contra el repositorio de origen | Textos copiados del paquete. |

## 6. Publicación de los avisos y atribución de Wiktionary

- Los textos de la sección 2 con fuente verificada están en `public/licencias/` y se publican en `dist/licencias/`. Se enlazan desde la página de librerías (sección «Avisos de licencia»).
- Los avisos del núcleo FFmpeg están en `public/ffmpeg-lgpl/licencias/` (incluidos en el build).
- Los textos de `licenses/` que no están en `public/` quedan en el repositorio para revisión.
- **Wiktionary (fila 23):** atribución corregida el 16 nov 2026 (ver fila 23). Pendiente solo la revisión jurídica de ShareAlike.

## 7. Pendientes antes de distribuir

1. **worker-f (fila 21):** consulta enviada al autor el 16 nov 2026; respuesta pendiente. No hay texto de licencia verificado. Hace falta una fuente nueva (por ejemplo, el repositorio en otra plataforma, o el autor). Mientras tanto, no se publica aviso.
2. **Vínculo tarball ↔ commit de @ffmpeg/ffmpeg y @ffmpeg/util (filas 2 y 3):** inferido. Los registros npm no indican `gitHead`.
3. **QPDF (fila 8):** la versión 12.2.0 está confirmada por el `Dockerfile`. Falta confirmar que el binario se compiló con ese `Dockerfile` (inferido).
4. **Wiktionary (fila 23):** revisión jurídica de ShareAlike para la consulta en vivo.
5. **Emscripten (sección 3):** inspeccionar la imagen `emscripten/emsdk:3.1.30` con Docker y confirmar la ausencia o presencia de libc++ en el binario.
6. **Decisión:** si `licenses/` debe servirse en `dist/` (ya se sirven los textos de `public/licencias/`).
7. Repetir el inventario (`vite build --sourcemap`) si cambia cualquier dependencia.

## 8. Herramientas locales (extras/local/): no distribuidas por el repositorio

Las herramientas de `extras/local/` no forman parte de la compilación pública ni de la imagen de producción. Sus dependencias se instalan desde npm en el equipo de cada usuario (`extras/local/package.json` y su lockfile). El repositorio no contiene sus archivos. Sus licencias figuran en `extras/local/README.md`, sección 5.

Los ejecutables yt-dlp y FFmpeg tampoco se distribuyen: cada usuario los instala desde su fuente oficial, con verificación de hash (`extras/local/README.md`, sección 2).

Modelo de Whisper (`onnx-community/whisper-base`): se descarga en el navegador del usuario, con su autorización, desde huggingface.co. Su licencia declarada en el README del modelo es Apache-2.0. No se incluye en el repositorio.
