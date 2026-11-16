# ChispaBox — Pequeñas herramientas, grandes soluciones.

Landing page estática de la plataforma **ChispaBox — Pequeñas herramientas, grandes soluciones.**.
Está hecha con HTML5 semántico, CSS3 moderno y TypeScript mínimo. Vite se usa solo para desarrollo y compilación, y Nginx Alpine sirve los archivos estáticos en producción. No necesita Node.js en ejecución.

## 💛 ¿Por qué existe ChispaBox?

Desde la facultad siempre me pasaba lo mismo: necesitábamos juntar un PDF, pasar un audio a MP3 o quitarle el fondo a una foto, y los sitios que lo resolvían empezaban a pedirnos plata. Otros directamente nos pedían subir nuestros archivos a servidores que no conocíamos. 🤔

Con el tiempo entendí por qué cobraban: tener un servidor cuesta plata, tiempo y mucha responsabilidad. Hay que mantenerlo actualizado, protegerlo, y aun así uno nunca sabe del todo quién lo está cuidando de verdad. 😅

Por eso ChispaBox nació con una idea simple: **que las herramientas corran en tu propio navegador**. Se intenta que el archivo no salga de la computadora propia, no y que el servidor no filtre nada y no hay nada que pagar. 🐣

### Lo que me importa

- 🔒 **Privacidad:** la mayoría de las herramientas procesan tus archivos en el navegador. Las excepciones están documentadas en cada sección.
- 🆓 **Gratis y de código libre:** ninguna herramienta cobra ni pide cuenta.
- 🛡️ **Seguridad sin atajos:** cabeceras de seguridad (CSP y otras), nada cargado desde CDN de terceros y dependencias revisadas.

## 📚 Librerías: por qué estas y no otras

No metí mil librerías "por si acaso". Cada una entró porque cumple estos criterios:

1. 🆓 **Gratuita y de uso libre**, con licencia clara (MIT, Apache-2.0, BSD, LGPL o GPL).
2. 🔎 **Mantenida y con versión fijada**, para saber exactamente qué código se usa.
3. 🧠 **Sin IA ni servicios en la nube**: el procesamiento queda en tu navegador.
4. 🛡️ **Sin vulnerabilidades conocidas:** `npm audit` no reporta hallazgos (revisión del 15 de noviembre de 2026, sobre 218 paquetes del árbol de dependencias).
5. 📦 **Empaquetada dentro del propio sitio:** nada se carga desde CDN de terceros.

| Librería                                                             | Para qué la uso                        | Licencia         |
| -------------------------------------------------------------------- | -------------------------------------- | ---------------- |
| [pdf-lib](https://github.com/Hopding/pdf-lib)                        | Dividir, unir, organizar y limpiar PDF | MIT              |
| [PDF.js](https://github.com/mozilla/pdf.js)                          | Ver miniaturas y comprimir PDF         | Apache-2.0       |
| [qrcode](https://github.com/soldair/node-qrcode)                     | Crear códigos QR                       | MIT              |
| [jsQR](https://github.com/cozmo/jsQR)                                | Leer códigos QR desde imágenes         | Apache-2.0       |
| [lamejs](https://github.com/zhuker/lamejs)                           | Generar MP3 al unificar audios         | LGPL-3.0         |
| [FFmpeg (WebAssembly)](https://github.com/ffmpegwasm/ffmpeg.wasm)    | Convertir formatos de audio            | GPL-2.0-or-later |
| [Tesseract.js](https://github.com/naptha/tesseract.js)               | Reconocer texto (OCR)                  | Apache-2.0       |
| [QPDF (qpdf-wasm)](https://github.com/neslinesli93/qpdf-wasm)        | Proteger PDF con contraseña (AES-256)  | Apache-2.0       |
| [PapaParse](https://github.com/mholt/PapaParse)                      | Leer y escribir CSV                    | MIT              |
| [read-excel-file](https://github.com/catamphetamine/read-excel-file) | Leer hojas de cálculo .xlsx            | MIT              |

Algunas licencias (GPL y LGPL) son software libre, pero tienen sus propias obligaciones. Por eso el inventario completo, con versiones, licencias y lo que queda fuera de la imagen final, está en [DEPENDENCIAS.md](DEPENDENCIAS.md). 📄

## Estructura

```
ChispaBox/
├── index.html               # Landing
├── contador.html            # Contador y limpiador de texto
├── paginas/                 # Una página HTML por herramienta
├── templates/               # Header, footer, encabezado y plantilla page.html
├── src/
│   ├── styles/              # CSS (variables.css define los temas claro y oscuro)
│   ├── scripts/             # TypeScript de la landing y del contador
│   └── shared/              # Lógica de cada herramienta
├── public/                  # Archivos copiados tal cual (personajes, favicon, theme-init.js)
├── scripts/                 # Utilidades de build (new-page, copia de PDF.js y OCR)
├── tests/                   # Pruebas (node:test)
├── docs/                    # Detalle de las herramientas más complejas
├── deploy/                  # Configuración de despliegue
├── nginx.conf               # Cabeceras de seguridad, CSP y caché
├── Dockerfile               # Build multietapa: Node Alpine → Nginx Alpine
├── compose.yaml
├── DEPENDENCIAS.md          # Inventario de librerías, versiones y licencias
├── README-YOUTUBE.md        # Cómo activar las descargas de YouTube en local
└── package.json
```

## Ejecutar con Docker (recomendado)

Requisitos: Docker Desktop (o Docker Engine con el plugin de Compose) en ejecución.

```bash
docker compose up --build -d
```

Luego abrí en el navegador:

```
http://localhost:8080
```

Para detenerlo:

```bash
docker compose down
```

## Desarrollo local (sin Docker)

Requisitos: Node.js 22 o superior.

```bash
npm ci
npm run dev        # http://127.0.0.1:5173
```

Otros comandos:

| Comando                                                     | Descripción                                                                     |
| ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `npm run typecheck`                                         | Verifica los tipos de TypeScript sin generar archivos.                          |
| `npm run build`                                             | Verifica tipos y genera la versión estática en `dist/`.                         |
| `npm run new-page -- <nombre> "<Título>" ["<descripción>"]` | Crea `<nombre>.html` con el header y el footer compartidos.                     |
| `npm run preview`                                           | Sirve `dist/` localmente para revisar la compilación (`http://127.0.0.1:4173`). |

### Crear una página nueva

```bash
npm run new-page -- conversor-audio "Conversor de audio" "Convierte audios entre formatos."
```

La página se crea en la raíz y se incluye sola en el build y en el Dockerfile. No hace falta tocar `vite.config.ts`.

El header, el footer y el sprite de iconos viven en `templates/`. Cualquier HTML de la raíz los incluye con una línea:

```html
<!-- @include:header -->
<!-- @include:footer -->
```

Editar un partial actualiza todas las páginas a la vez. Para una página sin el header o el footer compartidos, basta con quitar esas líneas.

### Encabezado de herramienta (título, subtítulo y personaje)

El bloque superior de cada herramienta (título, subtítulo y personaje a la derecha) es `templates/encabezado.html`. Se le pasan los datos como atributos:

```html
<!-- @include:encabezado titulo="Mi herramienta" subtitulo="Qué hace, en una o dos frases." personaje="/images/characters/miles-cutout.webp" -->
```

`templates/page.html` (el que usa `npm run new-page`) ya lo trae junto con el header y el footer. Para cambiar el diseño de todas las herramientas, edita `templates/encabezado.html` y `src/styles/encabezado.css`.

## Temas

- Por defecto se usa **tema claro**, o el tema del sistema operativo si tiene modo oscuro (`prefers-color-scheme`).
- El botón de la barra superior alterna entre claro y oscuro. La elección se guarda en `localStorage` (clave `mp-theme`).
- Los colores están definidos como variables CSS en `src/styles/variables.css` y se activan con el atributo `data-theme` en `<html>`.

## Contador y limpiador de texto

Vive en su propia página, `contador.html` (`http://localhost:8080/contador.html`), y se abre desde las tarjetas de herramientas de la landing. Funciona completamente en el navegador, sin llamadas a servidores:

- **Palabras**, **caracteres con espacios** y **caracteres sin espacios**, siempre visibles y actualizados al escribir o pegar.
- **Limpiar texto** aplica las reglas activas:
  - Eliminar muletillas configuradas (lista editable; por defecto: `eh, ehm, em, emm, ajá, mmm`). Solo se eliminan como palabra completa.
  - Eliminar asteriscos `*`.
  - Eliminar símbolos, cada uno con su casilla: `#`, `_`, `---` (tres guiones seguidos) y `-` (todos los guiones, también los que están dentro de palabras como «pre-escolar»; desactivada por defecto).
  - Normalizar espacios repetidos.
  - Buscar y reemplazar (o eliminar) hasta tres textos propios. Cada regla tiene una casilla «Solo palabra completa» (activada por defecto). Dejá «Reemplazar por» vacío para eliminar el texto.
  - Eliminar saltos de línea excesivos.
- **Deshacer** restaura la versión anterior después de una limpieza o un borrado.
- **Copiar** envía el texto al portapapeles. Si el navegador no lo permite, el texto queda seleccionado para copiarlo con Ctrl+C.
- No se modifican acentos, signos de puntuación ni fragmentos internos de otras palabras.

## Estado de las herramientas

| Herramienta                       | Estado                                                                                                                                                                                                                                                                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Grabar audio                      | Operativa en el navegador (MediaRecorder). Página `paginas/grabar-audio/index.html`.                                                                                                                                                                                                                                                                                           |
| Transcribir audio a texto         | Operativa con la Web Speech API del navegador (dictado por micrófono, sin modelos propios). Depende del navegador: en Chrome y Edge el reconocimiento lo procesa el servicio del navegador, así que el audio sale de tu equipo. Hay un aviso de privacidad en la página.                                                                                                       |
| Convertir formato de audio        | Operativa en el navegador (FFmpeg WebAssembly, sin servidor): entrada OGG, MP3, MP4, M4A, WAV, FLAC, WebM y más; salida MP3, OGG (Opus), M4A, MP4 (audio), WAV, FLAC o WebM. La primera carga descarga el motor (~32 MB).                                                                                                                                                      |
| Unificar audios                   | Operativa en el navegador (Web Audio API y lamejs, sin IA ni servidor): une hasta 20 grabaciones en un MP3 (128 kbps) o WAV, en el orden elegido. Límite: 15 min de duración total. Página `paginas/unificar-audios/index.html`.                                                                                                                                               |
| Recortar audio                    | Operativa en el navegador. Página `paginas/recortar-audio/index.html`.                                                                                                                                                                                                                                                                                                         |
| Contar palabras y caracteres      | Operativa. Página `paginas/contador/index.html`.                                                                                                                                                                                                                                                                                                                               |
| Limpiar texto                     | Operativa. Página `paginas/limpiador/index.html`.                                                                                                                                                                                                                                                                                                                              |
| Buscar palabra                    | Operativa: significado (Wiktionary en español), sinónimos y antónimos; enlace a la RAE. Requiere conexión; la página de Wiktionary se consulta desde el navegador.                                                                                                                                                                                                             |
| Quitar fondo de imagen            | Operativa: algoritmos clásicos sin IA (fondo uniforme, cuentagotas, región conectada y pincel). Ver `docs/herramientas-imagen.md`                                                                                                                                                                                                                                              |
| Convertir formato de imagen       | Operativa: JPG, PNG, WebP e ICO en el navegador. Ver `docs/herramientas-imagen.md`                                                                                                                                                                                                                                                                                             |
| Redimensionar y recortar imágenes | Operativa en el navegador. Página `paginas/redimensionar-imagen/index.html`.                                                                                                                                                                                                                                                                                                   |
| Mejorar calidad de imagen         | Operativa con dos métodos: Canvas (navegador) y Sharp (solo con `npm run dev` o `npm run preview`). No recupera detalles perdidos. Ver `docs/herramientas-imagen.md`                                                                                                                                                                                                           |
| Generador de favicon              | Operativa en el navegador. Página `paginas/generador-favicon/index.html`.                                                                                                                                                                                                                                                                                                      |
| Selector de color                 | Operativa en el navegador (sin IA ni servidor): tocá un píxel de una imagen (PNG, JPG, WebP, GIF, BMP) y obtené HEX, RGB, HSL y HSV, con botones para copiar. Página `paginas/selector-color/index.html`.                                                                                                                                                                      |
| Documento a PDF                   | Operativa: imágenes JPG/PNG/WebP a PDF en el navegador (uno o varios PDF, con ZIP). Word, Excel y PowerPoint con LibreOffice en el servidor local (`npm run dev` o `npm run preview`); en una publicación estática quedan deshabilitados. Ver `docs/documentos-a-pdf.md`                                                                                                       |
| PDF a documento                   | Operativa solo con `npm run dev` o `npm run preview`: PDF a Word (.docx), OpenDocument (.odt) o RTF (.rtf) con LibreOffice en el servidor local (importa con Writer). Los PDF escaneados no tienen texto; el texto importado aparece en cuadros de texto y puede requerir reacomodo. Página `paginas/pdf-a-documento/index.html`.                                              |
| Dividir PDF                       | Operativa en el navegador (pdf-lib, MIT, sin IA ni servidor): cada página en un PDF separado, o intervalos como 3-8. Varios archivos se entregan en ZIP. Página `paginas/dividir-pdf/index.html`.                                                                                                                                                                              |
| Unificar PDF                      | Operativa en el navegador (pdf-lib, MIT, sin IA ni servidor): varios PDF en uno, en el orden elegido. Límites: 30 archivos, 50 MB por archivo, 200 MB en total y 3000 páginas. Página `paginas/unificar-pdf/index.html`.                                                                                                                                                       |
| Organizar páginas                 | Operativa en el navegador (pdf-lib y PDF.js, sin IA ni servidor): reordenar, girar, quitar y extraer páginas. Máximo 500 páginas y 50 MB. Página `paginas/organizar-paginas/index.html`.                                                                                                                                                                                       |
| Comprimir PDF                     | Operativa en el navegador (PDF.js, pdf-lib, sin IA ni servidor): cada página se convierte en JPEG en dos niveles (correo 96 ppp o impresión 150 ppp). Pierde el texto seleccionable y los enlaces. Solo entrega si el resultado pesa menos. Página `paginas/comprimir-pdf/index.html`.                                                                                         |
| OCR de documentos                 | Operativa en el navegador con Tesseract.js (sin servidor): reconoce texto de imágenes y PDF escaneados. Página `paginas/ocr-documentos/index.html`.                                                                                                                                                                                                                            |
| Convertidor de datos              | Operativa en el navegador: lee y escribe CSV (PapaParse) y lee hojas .xlsx (read-excel-file). No lee .xls ni .xlsm. Página `paginas/convertidor-datos/index.html`.                                                                                                                                                                                                             |
| Formatear y validar JSON/XML      | Operativa en el navegador. Página `paginas/formato-json-xml/index.html`.                                                                                                                                                                                                                                                                                                       |
| Verificador de integridad         | Operativa en el navegador (Web Crypto, sin IA ni servidor): calcula el SHA-256 de un archivo (máximo 500 MB) y lo compara con el hash que pegues. Requiere conexión segura (https) o localhost. Página `paginas/verificador-integridad/index.html`. Pruebas: `npm run test:verificador-integridad`.                                                                            |
| Generador de contraseñas          | Operativa en el navegador (sin IA ni servidor, sin librerías): genera con crypto.getRandomValues (muestreo sin sesgo), longitud de 8 a 128, mayúsculas, minúsculas, números y símbolos, con opción de excluir caracteres ambiguos. Muestra la fortaleza por entropía y permite copiar. Página `paginas/generador-contrasenas/index.html`. Pruebas: `npm run test:contrasenas`. |
| Eliminar metadatos                | Operativa en el navegador, sin IA ni servidor. PDF (pdf-lib): muestra y quita autor, programa creador/productor, fechas, título, XMP, JavaScript y adjuntos. JPG/PNG/WebP: quita GPS, fecha, datos de cámara, XMP e IPTC sin recomprimir los píxeles. Página `paginas/eliminar-metadatos/index.html`.                                                                          |
| Proteger PDF con contraseña       | Operativa en el navegador (QPDF compilado a WebAssembly): cifra con AES-256. Ver `DEPENDENCIAS.md`. Página `paginas/proteger-pdf/index.html`.                                                                                                                                                                                                                                  |
| Generador y lector de QR          | Operativa en el navegador: crea QR de enlaces, texto, Wi-Fi o contactos (qrcode, MIT) en PNG o SVG, y lee QR desde imágenes (jsQR, Apache-2.0). Los enlaces leídos solo se abren al confirmarlos y únicamente si son http o https. Página `paginas/generador-qr/index.html`.                                                                                                   |
| Acortador de enlaces              | Operativa en el navegador (sin IA ni servidor): guarda el enlace en el almacenamiento local y genera `paginas/acortador-enlaces/index.html?c=código`, que redirige al original. Solo funciona en el navegador donde se creó. Solo http y https. Pruebas: `npm run test:acortador-enlaces`.                                                                                     |
| Descargar video de YouTube        | Operativa solo con `npm run dev` o `npm run preview` (uso personal, contenido propio o autorizado). Desactivada en producción. Cómo activarla en local: [README-YOUTUBE.md](README-YOUTUBE.md).                                                                                                                                                                                |
| Descargar música de YouTube       | Operativa solo con `npm run dev` o `npm run preview` (MP3, M4A, WAV, FLAC; «Artista - Título»). Desactivada en producción. Cómo activarla en local: [README-YOUTUBE.md](README-YOUTUBE.md).                                                                                                                                                                                    |
| Descargar playlist de YouTube     | Operativa solo con `npm run dev` o `npm run preview`, igual que las otras descargas de YouTube. Desactivada en producción. Cómo activarla en local: [README-YOUTUBE.md](README-YOUTUBE.md).                                                                                                                                                                                    |

Todas las herramientas de la landing tienen su página. Las que dependen de `npm run dev` o `npm run preview` (LibreOffice, Sharp o las descargas de YouTube) lo indican en su fila.

## Ilustraciones

- Los personajes de `public/images/characters/` son recortes optimizados de las ilustraciones de referencia (WebP, alto máximo 900 px). Se muestran con `object-fit: cover` para mostrar la cabeza y el torso.
- Para reemplazarlos por recortes con fondo transparente, guardá el archivo con el mismo nombre (o cambiá la ruta en `index.html`). Las dimensiones están reservadas con `width`, `height` y `aspect-ratio`, así que no se mueve el diseño.
- Las mascotas (perritos) todavía no tienen ilustración. Cuando estén disponibles, se pueden agregar en el hero y en el banner de novedades siguiendo el mismo patrón.

## Accesibilidad y rendimiento

- HTML semántico con landmarks (`header`, `nav`, `main`, `section` con título, `footer`), enlace de salto al contenido y textos alternativos o `aria-hidden` en las decoraciones.
- Foco visible para teclado (`:focus-visible`) y objetivos táctiles de al menos 2.6 rem.
- `prefers-reduced-motion` desactiva transiciones y animaciones.
- Las animaciones usan `transform`, `opacity` y transiciones CSS. No hay JavaScript corriendo continuamente.
- Sin fuentes externas: usa las fuentes del sistema e íconos SVG incrustados. Las librerías se empaquetan dentro del propio sitio y no se cargan desde CDN.
- Imágenes fuera del primer viewport con `loading="lazy"`; la del hero tiene prioridad alta.
- Nginx: compresión gzip, caché larga para `/assets/` (archivos con hash), y cabeceras de seguridad (CSP, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `X-Frame-Options`).

Las métricas de Core Web Vitals (LCP, INP, CLS) no se han medido todavía. Hay que medirlas con Lighthouse o PageSpeed Insights sobre la URL desplegada.

## Documentos a PDF

Página `paginas/documentos-a-pdf/index.html` (tarjeta «Documento a PDF» de la landing).

- **Imágenes** (JPG, JPEG, PNG, WebP): se convierten en el navegador con Canvas y un escritor de PDF propio. No se suben a ningún servidor.
- **Word** (`.docx`, `.doc`), **Excel** (`.xlsx`, `.xls`) y **PowerPoint** (`.pptx`, `.ppt`): los convierte LibreOffice instalado en el servidor de esta aplicación, en un perfil temporal aislado, sin macros ni vínculos externos. Solo funciona con `npm run dev` o `npm run preview`.

Requisitos para Office: LibreOffice 26.8 o superior. Configuración en `.env.local` (ver `.env.example`):

```bash
SOFFICE_PATH=C:/ruta/a/LibreOffice/program/soffice.com
```

Detalle de límites, seguridad, pruebas y limitaciones: [docs/documentos-a-pdf.md](docs/documentos-a-pdf.md).

Antes de `dev` y `build` se copian los recursos de PDF.js a `public/pdfjs/` (`npm run copy:pdfjs`); esa carpeta es generada y no se versiona.

## Dividir PDF

Página `paginas/dividir-pdf/index.html` (tarjeta «Dividir PDF» de la landing).

- **Cada página en un PDF separado**: se muestran miniaturas de todas las páginas y elegís cuáles separar (todas vienen seleccionadas por defecto; «Seleccionar todas», «Ninguna» e «Invertir selección» ayudan). Cada página elegida genera su propio PDF (ZIP si son varios).
- **Por intervalos**: escribí rangos separados por comas, por ejemplo `3-8, 10, 12-14`. Cada intervalo genera un PDF. Los números deben estar entre 1 y el total de páginas, y el inicio no puede ser mayor que el final.
- Todo se procesa en el navegador con [pdf-lib](https://github.com/Hopding/pdf-lib) (licencia MIT, JavaScript puro). El archivo no se sube a ningún servidor.
- Límites: 50 MB y 2000 páginas por PDF; 100 intervalos y 200 archivos de salida por operación.
- Los PDF protegidos con contraseña se rechazan. El documento de salida no lleva metadatos añadidos por la librería.
- Pruebas: `npm run test:dividir-pdf` (`tests/dividir-pdf/`).

## Unificar PDF

Página `paginas/unificar-pdf/index.html` (tarjeta «Unificar PDF» de la landing).

- Agregá varios PDF con el selector o arrastrándolos. Se unen en el orden de la lista: podés subir, bajar o quitar cada archivo.
- Límites: mínimo 2 archivos, hasta 30 archivos, 50 MB por archivo, 200 MB en total y 3000 páginas en el resultado.
- Los PDF protegidos con contraseña se rechazan. El resultado no lleva metadatos añadidos por la librería.
- Todo se procesa en el navegador con pdf-lib (MIT). Pruebas: `npm run test:unificar-pdf` (`tests/unificar-pdf/`).

## Organizar páginas

Página `paginas/organizar-paginas/index.html` (tarjeta «Organizar páginas» de la landing).

- Cada página tiene miniatura, con sus botones para subirla, bajarla, girarla 90° a izquierda o derecha y quitarla. Las páginas quitadas se pueden restaurar.
- «Guardar PDF organizado» crea un PDF con las páginas en el orden y el giro actuales. «Extraer solo las marcadas» crea otro PDF solo con las páginas marcadas.
- Límites: hasta 500 páginas y 50 MB. Los PDF protegidos con contraseña se rechazan.
- Todo se procesa en el navegador con pdf-lib (MIT) y PDF.js (Apache-2.0). Pruebas: `npm run test:organizar-paginas` (`tests/organizar-paginas/`).

## Comprimir PDF

Página `paginas/comprimir-pdf/index.html` (tarjeta «Comprimir PDF» de la landing).

- **Sin perder calidad** (por defecto): reescribe el PDF con pdf-lib, quitando objetos sobrantes. Conserva el texto, las imágenes y los enlaces de página. En el PDF de prueba bajó de 364 KB a 192 KB, con las mismas 10 páginas y el mismo texto.
- **Correo** (96 ppp, calidad 60 %) o **impresión** (150 ppp, calidad 85 %): cada página se dibuja con PDF.js y se guarda como JPEG. Sirven para PDF con imágenes; en PDF de texto suelen dar un archivo más pesado.
- Solo en correo e impresión el texto deja de poder seleccionarse y buscarse, y se pierden enlaces y formularios. En todos los niveles se pierden los marcadores y formularios.
- Si el resultado no pesa menos que el original, no se entrega nada.
- Límites: 100 MB, 200 páginas. Una página que tarda más de 30 s en dibujarse cancela la operación.
- Pruebas: `npm run test:comprimir-pdf` (`tests/comprimir-pdf/`).

## Eliminar metadatos

Página `paginas/eliminar-metadatos/index.html`. Tiene una sola tarjeta en la landing («Eliminar metadatos»), que sirve para PDF e imágenes.

**Imágenes (JPG, PNG, WebP)** — `src/shared/eliminar-metadatos-imagen.ts`:

- Sin librerías externas ni IA. Los segmentos (JPEG), chunks (PNG) o chunks RIFF (WebP) se recorren byte a byte y se quitan EXIF (cámara, fecha, GPS, miniatura), XMP, IPTC, comentarios, textos y `tIME`. Los píxeles no se vuelven a codificar, así que la calidad se mantiene.
- Se conservan el perfil de color ICC y la orientación. La orientación se reescribe en un EXIF mínimo que solo la contiene, para que una foto girada no se vea de costado.
- El formato se detecta por firma binaria, no por extensión. La salida se verifica de nuevo y se avisa si queda algún dato.
- Límite: 20 MB por imagen. Un WebP sin cabecera VP8X no conserva la orientación (caso poco común).
- Pruebas: `npm run test:eliminar-metadatos` (`tests/eliminar-metadatos/imagen.test.ts`).

**PDF**:

- Muestra la información del PDF (título, autor, programa creador y productor, fechas, adjuntos, anotaciones con autor) antes de limpiarla.
- La copia se arma pasando las páginas a un documento nuevo: no se arrastran el diccionario de información, el XMP, el JavaScript ni los adjuntos. Se quitan además el autor y la fecha de las anotaciones (salvo en campos de formulario).
- Se pierden los marcadores (índice) y los formularios. Las páginas, el texto, las imágenes y los enlaces se conservan.
- Después de limpiar, la página vuelve a leer la copia y lo informa. Pruebas: `npm run test:eliminar-metadatos`.

## Selector de color

Página `paginas/selector-color/index.html` (tarjeta «Selector de color» de la landing).

- Abrí una imagen y hacé clic sobre el píxel que te interese, o escribí sus coordenadas X e Y (también para teclado).
- Muestra el color en HEX, RGB, HSL y HSV, con botones para copiar cada valor.
- Límites: 40 MB y 6000 px por lado. La imagen no sale del navegador.
- Pruebas: `npm run test:selector-color` (`tests/selector-color/`).

## Unificar audios

Página `paginas/unificar-audios/index.html` (tarjeta «Unificar audios» de la landing).

- Agregá grabaciones y ordenalas con «Subir» y «Bajar». Podés escuchar el resultado antes de descargarlo.
- Salida: MP3 a 128 kbps (liviano, codificado con lamejs, LGPL-3.0) o WAV sin compresión.
- Límites: 20 audios, 100 MB por archivo y 15 minutos de duración total (el audio se guarda sin comprimir mientras se trabaja).
- Pruebas: `npm run test:unificar-audios` (`tests/unificar-audios/`).

## Generador y lector de QR

Página `paginas/generador-qr/index.html` (tarjeta «Generador y lector de QR» de la landing).

- **Crear:** enlace, texto, red Wi-Fi o contacto (vCard 3.0). Se descarga como PNG o SVG. El Wi-Fi escapa los caracteres especiales del formato.
- **Leer:** se busca el código en una imagen (PNG, JPG, WebP, GIF o BMP) y se muestra el contenido antes de hacer nada.
- Un enlace leído solo se abre si lo tocás, y únicamente si es http o https. Otros esquemas (javascript:, data:, file:) se muestran como texto.
- Límites: 1000 caracteres por código; imagen de hasta 20 MB y 4000 px por lado.
- Librerías: qrcode 1.5.4 (MIT) y jsqr 1.4.0 (Apache-2.0). Pruebas: `npm run test:qr` (`tests/qr-contenido/`).

## Sugerencias de herramientas

El formulario «¿Qué herramienta te gustaría tener?» (debajo del banner de cierre) está implementado en `index.html`, `src/scripts/suggestions.ts` y `src/styles/main.css`.

**Estado: habilitado.** El formulario envía a `/api/sugerencias` del mismo sitio. Caddy lo reenvía al servicio de sugerencias (`deploy/sugerencias/`), que no tiene base de datos: cada sugerencia llega por correo al buzón del proyecto.

- El formulario valida en el navegador por comodidad, pero el servidor vuelve a validar todo.
- Si un visitante deja su correo, recibe un agradecimiento automático (como máximo uno por dirección por día).
- Para deshabilitarlo, definir `VITE_SUGGESTIONS_ENDPOINT` vacío al compilar.

**Medidas de seguridad:**

- 🧱 **Solo el origen del sitio:** con `ALLOWED_ORIGIN` definido, cualquier envío desde otro sitio recibe `403`.
- 🚦 **Límites:** 3 sugerencias por IP al día, 60 por hora en total, 8 KB máximo por envío y 200 pendientes en cola. Las IP se guardan solo como hash con sal.
- ✅ **Validación del servidor:** descripción de 10 a 1000 caracteres, correo con formato válido y de 254 caracteres como máximo, y `Content-Type: application/json` obligatorio.
- 🍯 **Trampa para bots:** el campo oculto `website`. Si llega con texto, se responde como si todo estuviera bien y no se envía nada.
- ✉️ **Sin inyección de cabeceras:** los caracteres de control se eliminan antes de armar el correo, y el agradecimiento nunca incluye texto del usuario.
- 🔐 **Credenciales fuera del repositorio:** el SMTP va en `sugerencias.env` del servidor (permisos 600). Ver `deploy/chispabox/sugerencias.env.example`.
- 🧊 **Contenedor endurecido:** sin usuario root, sistema de archivos de solo lectura, sin capacidades de Linux y sin puertos publicados (solo lo alcanza Caddy por la red interna).
- 🧹 **Sin datos guardados:** no hay base de datos. La memoria de los límites se limpia sola y se pierde al reiniciar.

Nada de esto va en el frontend: ninguna clave de API, token ni credencial. La URL del endpoint sí puede ser pública.

## Próximos pasos

- Recortes de personajes con fondo transparente (AVIF o WebP) y las mascotas.
- Implementar las herramientas pendientes, cada una como módulo independiente en `src/scripts/`.
