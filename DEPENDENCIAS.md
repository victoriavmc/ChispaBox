# Inventario de dependencias, tecnologías y versiones

Proyecto: **ChispaBox — Pequeñas herramientas, grandes soluciones.** (landing estática).
Fecha del inventario: 2026-11-15.

Este archivo lista todo lo que interviene en el proyecto: lo que se compila (solo en desarrollo) y lo que realmente llega a la imagen Docker que se ejecuta.

---

## 1. Resumen

| Capa                | Tecnología                       | Versión                                            | Llega a la imagen final   |
| ------------------- | -------------------------------- | -------------------------------------------------- | ------------------------- |
| Lenguaje de marcado | HTML5                            | —                                                  | Sí (archivos compilados)  |
| Estilos             | CSS3 (variables, responsive)     | —                                                  | Sí (archivo compilado)    |
| Lógica en navegador | TypeScript → JavaScript (ES2020) | TypeScript 7.0.2                                   | Sí (JS compilado, sin TS) |
| Empaquetador        | Vite                             | 8.3.8                                              | No (solo build)           |
| Runtime de build    | Node.js                          | 22.x (imagen `node:22-alpine`; local: v22.17.0)    | No                        |
| Gestor de paquetes  | npm                              | 10.9.2 (local)                                     | No                        |
| Servidor web        | Nginx (sin root)                 | 1.27.x (imagen `nginxinc/nginx-unprivileged:1.27-alpine`, puerto 8080) | Sí |
| Sistema base        | Alpine Linux                     | 3.21.10 (tras `apk upgrade`; base original 3.21.3) | Sí                        |

**Dependencias de terceros: sí las hay, y se empaquetan en el sitio.** Las librerías de `dependencies` de `package.json` (FFmpeg, pdf-lib, pdf.js, QPDF, etc.) se compilan dentro de `dist/` y se sirven desde el mismo origen. Las rutas de FFmpeg apuntan a archivos del propio sitio. Las peticiones a terceros en tiempo de ejecución que existen en el código son: (1) la API de `es.wiktionary.org` («Buscar palabra»), y (2) los enlaces que el usuario abre a otros sitios (RAE, etc.). Las fuentes no son externas: no se encontró Google Fonts ni CDN en `index.html`, `paginas/`, `templates/` ni `src/`. La búsqueda de `http(s)://` en `src/` solo muestra el espacio de nombres SVG (`http://www.w3.org/2000/svg`) y el de OOXML, que son identificadores y no peticiones de red.

Herramientas locales (OCR de documentos, transcripción de audio con Whisper y descargas de YouTube): se ejecutan solo en tu computadora desde `extras/local/`. Sus dependencias (tesseract.js, @huggingface/transformers y las de OCR) y su lockfile están en `extras/local/package.json`, fuera de la instalación pública. Ver `extras/local/README.md`.

---

## 2. Dependencias de la aplicación (npm)

Definidas en `package.json` y bloqueadas en `package-lock.json` (lockfileVersion 3).

### Directas (`devDependencies`)

| Paquete    | Versión en `package.json` | Versión bloqueada | Uso                                    |
| ---------- | ------------------------- | ----------------- | -------------------------------------- |
| typescript | ^7.0.2                    | 7.0.2             | Verificación de tipos (`tsc --noEmit`) |
| vite       | ^8.3.8                    | 8.3.8             | Servidor de desarrollo y build         |
| sharp      | 0.35.5 (exacta)           | 0.35.5 (publicada el 27 sep 2026) | Método Sharp de «Mejorar calidad»: solo en `npm run dev` y `npm run preview`. Licencia Apache-2.0 |
| @types/papaparse | 5.3.16 (exacta)        | 5.3.16 (publicada el 4 oct 2026)                 | Tipos de TypeScript para papaparse (solo desarrollo, licencia MIT) |
| @types/nspell | ^2.1.6 | 2.1.6 | Tipos de TypeScript para nspell (solo desarrollo, licencia MIT) |

### De ejecución (`dependencies`)

| Paquete           | Versión en `package.json` | Versión bloqueada | Uso | Licencia |
| ----------------- | ------------------------- | ----------------- | --- | -------- |
| @ffmpeg/ffmpeg    | 0.12.15 (exacta)          | 0.12.15 (publicada el 7 ene 2025) | Wrapper del motor FFmpeg en el navegador («Convertir formato de audio»). Se carga en un Worker | MIT |
| @ffmpeg/util      | 0.12.2 (exacta)           | 0.12.2 (publicada el 7 ene 2025) | Utilidades (`fetchFile`) para pasar archivos al motor | MIT |
| @ffmpeg/core      | 0.12.10 (eliminado) | — | **Eliminado del proyecto.** Era un núcleo GPL-2.0-or-later (incluye x264). Lo sustituye el núcleo FFmpeg LGPL propio de `public/ffmpeg-lgpl/` (FFmpeg 5.1.4, sin GPL). | Ver `THIRD_PARTY_NOTICES.md`, fila 1 |
| pdf-lib           | 1.17.1 (exacta)           | 1.17.1 (última modificación en npm: 12 may 2022) | «Dividir PDF» y «Unificar PDF»: separan y unen páginas en el navegador. Sin IA, sin servicios externos, JavaScript puro | MIT |
| papaparse         | 5.7.0 (exacta)            | 5.7.0 (publicada el 24 ago 2026)                 | «Convertidor de datos»: lee CSV (con comillas y delimitadores) y escribe CSV. Corre en el navegador, sin red | MIT |
| read-excel-file   | 9.3.14 (exacta)           | 9.3.14 (publicada el 29 oct 2026)                | «Convertidor de datos»: lee hojas de libros .xlsx en el navegador (usa fflate para descomprimir). No lee .xls ni .xlsm. Sin IA | MIT |
| @neslinesli93/qpdf-wasm | 0.3.0 (exacta) | 0.3.0 (publicada el 27 jun 2025) | «Proteger PDF con contraseña»: QPDF (Apache-2.0) compilado a WebAssembly. Cifra con AES-256 (PDF 2.0, R6) y corre en el hilo principal del navegador. El `.wasm` se sirve del mismo origen con `?url` (CSP `wasm-unsafe-eval`). Motor QPDF bajo licencia Apache-2.0; el envoltorio npm es ISC | ISC |
| qrcode | 1.5.4 (exacta) | 1.5.4 | «Generador y lector de QR»: crea códigos en PNG o SVG (`src/scripts/generador-qr.ts`) | MIT |
| jsqr | 1.4.0 (exacta) | 1.4.0 | «Generador y lector de QR»: lee códigos QR desde imágenes (mismo archivo) | Apache-2.0 |
| pdfjs-dist | 6.5.438 (exacta) | 6.5.438 | PDF.js: vista previa de PDF (`src/lib/pdf-viewer.ts`) y miniaturas en «Organizar páginas» y «Comprimir PDF». Sus recursos se copian a `public/pdfjs/` | Apache-2.0 |
| nspell | ^2.1.5 | 2.1.5 | «Buscar palabra»: sugerencias ortográficas con Hunspell (`src/lib/spelling-es.ts`) | MIT |
| dictionary-es | ^4.0.0 | 4.0.0 | Diccionario español para nspell (se copia a `public/dictionaries/es/`) | GPL-3.0, LGPL-3.0 o MPL-1.1 (se elige una; ver `LICENSE-dictionary-es`) |

Por requerir WebAssembly y Worker, `nginx.conf` añade `'wasm-unsafe-eval'` a `script-src` y `worker-src 'self' blob:`.

Servicios externos (sin paquete npm): «Buscar palabra» consulta la API de MediaWiki de `es.wiktionary.org` (licencia CC BY-SA). `nginx.conf` la permite en `connect-src https://es.wiktionary.org`. La RAE no tiene API pública; su entrada se abre como enlace. Para sugerir la forma correcta de una palabra mal escrita, «Buscar palabra» usa `nspell` (MIT) con el diccionario español de `dictionary-es` (copiado en `public/dictionaries/es/`, licencia en `LICENSE-dictionary-es`); se carga solo cuando hace falta. El conversor de audio funciona también en producción, porque no depende del servidor de desarrollo.

### Transitivas (instaladas por Vite y TypeScript)

| Paquete                                             | Versión      | Nota                             |
| --------------------------------------------------- | ------------ | -------------------------------- |
| rolldown                                            | 1.2.19       | Bundler que usa Vite 8           |
| @rolldown/pluginutils                               | 1.1.1        |                                  |
| @oxc-project/types                                  | 0.156.0      |                                  |
| lightningcss                                        | 1.33.0       | Procesado de CSS                 |
| postcss                                             | 8.5.33       |                                  |
| picomatch                                           | 4.0.7        |                                  |
| tinyglobby                                          | 0.2.17       |                                  |
| fdir                                                | 6.5.0        |                                  |
| picocolors                                          | 1.1.1        |                                  |
| nanoid                                              | 3.3.20       |                                  |
| source-map-js                                       | 1.2.2        |                                  |
| detect-libc                                         | 2.1.2        |                                  |
| tslib                                               | 2.9.1        |                                  |
| @emnapi/core                                        | 2.0.0-beta.2 |                                  |
| @emnapi/runtime                                     | 2.0.0-beta.2 |                                  |
| @emnapi/wasi-threads                                | 2.2.0        |                                  |
| @napi-rs/wasm-runtime                               | 1.2.6        |                                  |
| @tybys/wasm-util                                    | 0.10.4       |                                  |
| @typescript/typescript-\* (binarios por plataforma) | 7.0.2        | Un binario por sistema operativo |
| @rolldown/binding-\* (binarios por plataforma)      | 1.2.19       | Un binario por sistema operativo |
| lightningcss-\* (binarios por plataforma)           | 1.33.0       | Un binario por sistema operativo |
| fsevents                                            | 2.3.3        | Solo macOS (opcional)            |

En `package.json` hay 17 dependencias de ejecución (`dependencies`) y 5 de desarrollo (`devDependencies`). Las de ejecución se empaquetan en `dist/` durante el build, por eso el sitio final no necesita Node.js. Las de desarrollo solo sirven para compilar y para el servidor local.

### Dependencias de Sharp (transitivas y binarios)

| Paquete | Versión | Licencia | Nota |
| --- | --- | --- | --- |
| semver | ^7.8.5 (instalada 7.8.x) | ISC | Utilidad de versiones |
| @img/colour | ^1.1.0 | MIT | Utilidad de color |
| @img/sharp-win32-x64 (y demás `@img/sharp-*`) | 0.35.5 | Apache-2.0 (paquete de Sharp) y LGPL-3.0-or-later (libvips) | Binario nativo por plataforma |
| @img/sharp-libvips-* | 1.3.4 | LGPL-3.0-or-later | libvips se enlaza dinámicamente como biblioteca compartida. Impacto: al distribuir binarios hay que cumplir la LGPL (incluir la licencia y permitir reemplazar la biblioteca). No afecta al código de la aplicación, que no se publica como binario |
| @img/sharp-wasm32 | 0.35.5 | Apache-2.0 | Opcional; no se instala en Windows x64 |

`npm audit` (sharp 0.35.5 y árbol completo, 15 nov 2026): **0 vulnerabilidades** conocidas en 218 paquetes (111 de producción, 68 de desarrollo, 93 opcionales y 11 peer).

### Cambios de la revisión de herramientas de imagen (15 nov 2026)

- **Eliminada** `onnxruntime-web` 1.31.1 (MIT) y sus archivos `public/ort/*` (WASM y glue JS).
- **Eliminado** el modelo `public/models/ormbg.onnx` (ORMBG, Apache-2.0, descargado de Hugging Face). Motivo: RG-02 prohíbe modelos de IA. Solo lo usaba `quitar-fondo.ts`, así que no afectó a otros módulos.
- **Eliminados** `public/assets.manifest.json` y `scripts/verify-assets.mjs` (solo verificaban esos archivos) y el script `verify:assets`.
- **Añadida** `sharp` 0.35.5 como devDependency (fijada sin `^`).
- **No añadido** `png-to-ico`: el contenedor ICO se genera con código propio (`src/lib/ico.ts`), verificado al leerlo.
- **Corrección**: la directiva `'wasm-unsafe-eval'` **sí** es necesaria en la CSP de nginx: FFmpeg y QPDF ejecutan WebAssembly. Se mantiene.

---

## 3. Tecnologías del código propio

| Archivo                                                                       | Tecnología / API                                                                  |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `index.html`, `contador.html`, `prueba-plantilla.html`, `templates/page.html` | HTML5 semántico                                                                   |
| `src/styles/variables.css`, `main.css`, `responsive.css`                      | CSS3 (variables, media queries, `prefers-color-scheme`, `prefers-reduced-motion`) |
| `src/scripts/main.ts`                                                         | TypeScript, punto de entrada                                                      |
| `src/scripts/theme.ts`                                                        | TypeScript, `localStorage` (clave `mp-theme`)                                     |
| `src/scripts/text-tools.ts`                                                   | TypeScript, DOM API, portapapeles (`navigator.clipboard`)                         |
| `src/scripts/recortar-audio.ts`, `src/shared/recortar-audio.ts`, `src/lib/recortar-audio.ts` | Recorte de audio con Web Audio API (sin paquetes). Reutiliza `src/lib/audio-export.ts` (WAV y MP3 con libmp3lame del núcleo FFmpeg propio) |
| `public/theme-init.js`                                                        | JavaScript plano, aplica el tema antes del primer pintado                         |
| `vite.config.ts`                                                              | Vite plugin propio (`include-partials`) para incluir `src/partials/*.html`        |
| `scripts/new-page.mjs`                                                        | Node.js (ESM), genera páginas nuevas desde `templates/page.html`                  |
| `src/partials/*.html`, `src/partials/sprite.html`                             | Plantillas HTML y sprite SVG                                                      |
| `public/images/characters/*.webp`, `public/favicon.png, public/images/logo/`                       | Imágenes WebP y SVG                                                               |

Configuración de TypeScript (`tsconfig.json`): target ES2020, módulos ESNext, `strict` activado, `types: []` (sin tipos de Node en el código de la página).

---

## 4. Infraestructura Docker

| Elemento          | Valor                                                           |
| ----------------- | --------------------------------------------------------------- |
| Etapa 1 (build)   | `node:22-alpine` — `npm ci` + `npm run build`                   |
| Etapa 2 (runtime) | `nginxinc/nginx-unprivileged:1.27-alpine` (usuario 101, sin root) |
| Orquestación      | Docker Compose (`compose.yaml`), `name: mi-pagina-herramientas` |
| Puerto            | 8080 dentro del contenedor (no publicado en producción; Caddy llega por la red `edge`) |
| Healthcheck       | `wget` de BusyBox contra `http://127.0.0.1/`                    |
| Configuración web | `nginx.conf` (gzip, caché, CSP y cabeceras de seguridad)        |

### Paquetes del sistema en la imagen final (tras los cambios de la sección 6)

Salida de `apk list --installed` sobre la imagen `mi-pagina-herramientas:latest`, 61 paquetes.

| Paquete                   | Versión          | Licencia                                                          |
| ------------------------- | ---------------- | ----------------------------------------------------------------- |
| alpine-baselayout         | 3.6.8-r1         | GPL-2.0-only                                                      |
| alpine-baselayout-data    | 3.6.8-r1         | GPL-2.0-only                                                      |
| alpine-keys               | 2.5-r0           | MIT                                                               |
| alpine-release            | 3.21.10-r0       | MIT                                                               |
| aom-libs                  | 3.11.0-r0        | BSD-2-Clause AND custom                                           |
| apk-tools                 | 2.14.13-r0       | GPL-2.0-only                                                      |
| brotli-libs               | 1.1.1-r0         | MIT                                                               |
| busybox                   | 1.37.0-r14       | GPL-2.0-only                                                      |
| busybox-binsh             | 1.37.0-r14       | GPL-2.0-only                                                      |
| ca-certificates           | 20261020-r0      | MPL-2.0 AND MIT                                                   |
| ca-certificates-bundle    | 20261020-r0      | MPL-2.0 AND MIT                                                   |
| fontconfig                | 2.15.0-r1        | MIT                                                               |
| freetype                  | 2.13.3-r0        | FTL OR GPL-2.0-or-later                                           |
| geoip                     | 1.6.12-r5        | LGPL-2.1-or-later                                                 |
| gettext-envsubst          | 0.22.5-r0        | GPL-3.0-or-later AND LGPL-2.1-or-later AND MIT                    |
| libavif                   | 1.0.4-r0         | BSD-2-Clause                                                      |
| libbsd                    | 0.12.2-r0        | BSD-3-Clause                                                      |
| libbz2                    | 1.0.8-r6         | bzip2-1.0.6                                                       |
| libcrypto3                | 3.3.7-r2         | Apache-2.0                                                        |
| libdav1d                  | 1.5.0-r0         | BSD-2-Clause                                                      |
| libedit                   | 20240808.3.1-r0  | BSD-3-Clause                                                      |
| libexpat                  | 2.10.0-r0        | MIT                                                               |
| libgcrypt                 | 1.10.3-r1        | LGPL-2.1-or-later AND GPL-2.0-or-later                            |
| libgd                     | 2.3.3-r9         | GD                                                                |
| libgpg-error              | 1.51-r0          | GPL-2.0-or-later AND LGPL-2.1-or-later                            |
| libice                    | 1.1.1-r6         | X11                                                               |
| libintl                   | 0.22.5-r0        | LGPL-2.1-or-later                                                 |
| libjpeg-turbo             | 3.0.4-r0         | BSD-3-Clause AND IJG AND Zlib                                     |
| libmd                     | 1.1.0-r0         | BSD (varias)                                                      |
| libncursesw               | 6.5_p20241006-r3 | X11                                                               |
| libpng                    | 1.6.59-r0        | Libpng                                                            |
| libsharpyuv               | 1.4.0-r0         | BSD-3-Clause                                                      |
| libsm                     | 1.2.4-r4         | MIT                                                               |
| libssl3                   | 3.3.7-r2         | Apache-2.0                                                        |
| libuuid                   | 2.40.4-r1        | BSD-3-Clause                                                      |
| libwebp                   | 1.4.0-r0         | BSD-3-Clause                                                      |
| libx11                    | 1.8.10-r0        | X11                                                               |
| libxau                    | 1.0.11-r4        | MIT                                                               |
| libxcb                    | 1.16.1-r0        | MIT                                                               |
| libxdmcp                  | 1.1.5-r1         | MIT                                                               |
| libxext                   | 1.3.6-r2         | MIT                                                               |
| libxml2                   | 2.13.9-r1        | MIT                                                               |
| libxpm                    | 3.5.19-r0        | X11                                                               |
| libxslt                   | 1.1.42-r3        | X11                                                               |
| libxt                     | 1.3.1-r0         | MIT                                                               |
| musl                      | 1.2.5-r12        | MIT                                                               |
| musl-utils                | 1.2.5-r12        | MIT AND BSD-2-Clause AND GPL-2.0-or-later                         |
| ncurses-terminfo-base     | 6.5_p20241006-r3 | X11                                                               |
| nginx                     | 1.27.5-r1        | 2-clause BSD-like                                                 |
| nginx-module-geoip        | 1.27.5-r1        | 2-clause BSD-like                                                 |
| nginx-module-image-filter | 1.27.5-r1        | 2-clause BSD-like                                                 |
| nginx-module-njs          | 1.27.5.0.8.10-r1 | 2-clause BSD-like                                                 |
| nginx-module-xslt         | 1.27.5-r1        | 2-clause BSD-like                                                 |
| pcre2                     | 10.43-r1         | BSD-3-Clause                                                      |
| scanelf                   | 1.3.8-r1         | GPL-2.0-only                                                      |
| ssl_client                | 1.37.0-r14       | GPL-2.0-only                                                      |
| tiff                      | 4.7.2-r0         | libtiff                                                           |
| tzdata                    | 2026f-r0         | Public-Domain                                                     |
| xz-libs                   | 5.8.4-r0         | GPL-2.0-or-later AND 0BSD AND Public-Domain AND LGPL-2.1-or-later |
| zlib                      | 1.4-r0           | Zlib                                                              |
| zstd-libs                 | 1.5.6-r2         | BSD-3-Clause OR GPL-2.0-or-later                                  |

Nota: `curl` y sus librerías (`libcurl`, `nghttp2-libs`, `c-ares`) se eliminaron de la imagen final. No los usa Nginx ni la aplicación.

---

## 4b. Servicio de sugerencias (`deploy/sugerencias/`, 15 nov 2026)

| Paquete | Versión | Licencia | Uso |
| --- | --- | --- | --- |
| nodemailer | 10.3.1 (exacta) | MIT | Envío SMTP al buzón y al agradecimiento. Versiones 10.0.x–10.1.3 tienen avisos de npm audit; 10.3.1 no tiene ninguno. |
| smtp-server | 3.13.7 (solo `deploy/sugerencias/pruebas/`, no entra en la imagen) | MIT | Servidor SMTP de prueba local. |

Imagen `node:22-alpine` con `apk upgrade` y sin npm en ejecución. Node 22 entra en mantenimiento según su calendario oficial; verificar el fin de soporte antes de desplegar.

## 5. Estado de seguridad (Docker Scout)

| Medición                                          | Críticas | Altas |
| ------------------------------------------------- | -------- | ----- |
| Imagen anterior (`nginx:1.27-alpine` sin parches) | 18       | 68    |
| Tras `apk upgrade` y quitar `curl`                | 0        | 1     |

Hallazgos restantes:

| CVE            | Paquete           | Severidad | Estado                                                                                                                      |
| -------------- | ----------------- | --------- | --------------------------------------------------------------------------------------------------------------------------- |
| CVE-2026-86140 | libxml2 2.13.9-r1 | Alta      | Sin versión corregida en los repositorios de Alpine 3.21 todavía. Requiere esperar un parche o migrar a una base más nueva. |

Las CVEs que aparecían en la captura (por ejemplo CVE-2026-63073, CVE-2026-111497, CVE-2026-4738, CVE-2025-9230) pertenecen a `openssl`, `brotli`, `zlib` y `curl` del sistema base, no al código del proyecto ni a sus dependencias npm (que no llegan a la imagen).

Antes de los cambios, los paquetes con más hallazgos eran `curl` (27), `openssl` (23), `expat` (11), `libpng` (6) y `libxml2` (5); el resto tenía entre 1 y 3 hallazgos cada uno.

---

## 5b. Revisión de 15 nov 2026 (preparación de despliegue)

- **Nginx**: `nginx.conf` escucha en 8080. Se corrigió la regex de `/s/CODIGO`, que tenía llaves sin comillas y hacía fallar el arranque de Nginx.
- **Dockerfile**: base `nginx-unprivileged`, usuario 101, sin `curl`.
- **npm audit**: 0 vulnerabilidades en la raíz (con y sin dependencias de desarrollo) y en `deploy/sugerencias`.
- **Docker Scout, `chispabox-web:1.0.0`**: 1 alta, libxml2 2.13.9-r1 (CVE-2026-86140), sin versión corregida en Alpine 3.21.
- **Docker Scout, `chispabox-sugerencias:1.0.0`**: tras `apk upgrade` y quitar npm en ejecución, 1 alta, musl (CVE-2026-107891). Scout indica como versión corregida la 1.2.6-r6; el paquete de la imagen es anterior, así que hay que volver a construir cuando Alpine publique el parche.
- **Atestaciones**: Scout reporta que faltan SBOM y provenance; se generan con `docker buildx build --sbom=true --provenance=true`.

## 6. Cambios aplicados en el Dockerfile

Etapa runtime (`nginx:1.27-alpine`):

```dockerfile
RUN apk upgrade --no-cache \
 && apk del --no-cache curl
```

- `apk upgrade`: aplica los parches de seguridad de Alpine publicados después de la imagen base de Nginx.
- `apk del curl`: el servidor no usa curl. El healthcheck usa `wget`, que ya viene con BusyBox. Se comprobó que la página responde 200 y que `wget` funciona dentro del contenedor.

---

## 7. Pendientes y observaciones

1. **CVE-2026-86140 (libxml2, alta)**: sin parche en Alpine 3.21. Opciones: esperar la actualización de Alpine o cambiar a una imagen base con Alpine 3.22 o superior cuando Nginx la publique.
2. **Usuario root**: Docker Scout marca "Image runs as the root user". El proceso maestro de Nginx necesita root para abrir el puerto 80; solo los workers corren como `nginx`. El comentario del Dockerfile ("Usuario sin privilegios") no es exacto. Para ejecutarlo sin root habría que usar `nginxinc/nginx-unprivileged` y puerto 8080.
3. **Atestaciones de cadena de suministro**: Scout reporta 2 desviaciones (faltan SBOM y provenance). Se pueden generar con `docker buildx build --sbom=true --provenance=true`.
4. **Imágenes base sin fijar por digest**: `node:22-alpine` y `nginx:1.27-alpine` pueden cambiar con el tiempo. Para builds reproducibles, fijar con `@sha256:...`.
5. **Número de CVEs de la captura**: la captura muestra 150 vulnerabilidades. El escaneo local de Docker Scout sobre la imagen original dio 86 (18 críticas y 68 altas). La diferencia probablemente viene de otra herramienta, otra base de datos o una imagen distinta. Conviene volver a escanear con el mismo origen.
6. **Mantenimiento**: `npm audit` (15 nov 2026) reporta 0 vulnerabilidades en el árbol completo. La imagen final no contiene paquetes npm, así que ese resultado corresponde al código de build y desarrollo. Vite 8 y TypeScript 7 son versiones muy recientes; revisar su changelog antes de actualizarlas.

---

