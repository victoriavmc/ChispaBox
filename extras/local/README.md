# Herramientas locales de ChispaBox (extras/local)

Estas herramientas se ejecutan **solo en tu computadora**. No se publican en Hostinger y no tienen API pública. El sitio público (la raíz del repositorio) funciona sin ellas.

| Herramienta | Qué hace | Dónde se procesa |
|---|---|---|
| Descargar video de YouTube | Descarga un video en MP4, WebM o MKV con yt-dlp y FFmpeg. | Tu equipo. El API escucha solo en `127.0.0.1`. |
| Descargar música de YouTube | Extrae el audio y lo guarda en MP3, Opus, M4A, WAV o FLAC. | Tu equipo. |
| Descargar playlist de YouTube | Descarga una lista o varios enlaces y los entrega en un ZIP. | Tu equipo. |
| OCR de documentos | Reconoce texto en imágenes y PDF escaneados con Tesseract.js. | Tu navegador. Los datos de idioma vienen de este paquete. |
| Transcribir audio a texto | Convierte un archivo de audio en texto con Whisper (Transformers.js). | Tu navegador. El audio no sale del equipo. |

## Uso con contenido autorizado

- Usá estas herramientas **solo con contenido propio o con autorización** del titular, o con contenido cuya licencia lo permita (por ejemplo, Creative Commons con atribución). Respetá los términos de YouTube y de cada plataforma.
- Las herramientas **no eluden DRM, controles de acceso ni restricciones de seguridad** y no usan cookies ni credenciales personales.
- Si una descarga no está permitida por el titular o por la plataforma, no la hagas. Esta documentación no sustituye la responsabilidad de quien usa las herramientas.

## 1. Requisitos

- **Node.js 22 o superior** y npm.
- **yt-dlp** y **FFmpeg** (solo para las descargas de YouTube). Instalalos en una carpeta propia (sección 2).
- **Memoria y CPU**:
  - Transcripción con Whisper: unos **80 MB** de modelo descargados una vez y, durante la transcripción, alrededor de **1 GB de memoria libre**. Con CPU doméstica, un audio de 10 minutos puede tardar varios minutos. Es un modelo pequeño y puede equivocarse en audios con ruido, acentos fuertes o varias voces.
  - OCR: alrededor de 200 MB de memoria; una página escaneada puede tardar algunos segundos.
- Navegador Chromium (Chrome o Edge) recomendado. Las descargas con elección de carpeta requieren Chromium; en otros navegadores se descarga a la carpeta predeterminada.

## 2. Instalar yt-dlp y FFmpeg (sin tocar el PATH global)

Instalá los ejecutables en una carpeta propia y apuntá la configuración a ellos. No hace falta permiso de administrador.

**yt-dlp** (fuente oficial: https://github.com/yt-dlp/yt-dlp/releases):
1. Descargá `yt-dlp.exe` (Windows) desde la última versión.
2. Descargá `SHA2-256SUMS` de la misma versión y comparalo con el hash del archivo (`certutil -hashfile yt-dlp.exe SHA256` en Windows o `sha256sum` en Linux/macOS). Deben coincidir.
3. Verificá la versión: `yt-dlp --version`.

**FFmpeg** (fuente oficial: https://ffmpeg.org/download.html, con builds de BtbN: https://github.com/BtbN/FFmpeg-Builds/releases):
1. Descargá `ffmpeg-master-latest-win64-gpl.zip` (o la variante de tu sistema) y `checksums.sha256` de la misma release. Verificá el hash.
2. Descomprimí y verificá: `ffmpeg -version` y que existan `ffprobe` y los codificadores `libmp3lame` y `libopus`.
3. La build GPL no se redistribuye con ChispaBox; la instalás vos, en tu equipo.

Luego creá `extras/local/.env` a partir de `.env.example` y poné las rutas completas, por ejemplo:

```
YTDLP_PATH=C:\Herramientas\yt-dlp\yt-dlp.exe
FFMPEG_PATH=C:\Herramientas\ffmpeg\bin\ffmpeg.exe
FFPROBE_PATH=C:\Herramientas\ffmpeg\bin\ffprobe.exe
```

## 3. Instalación y ejecución

Desde una clonación limpia del repositorio:

```bash
# 1. Sitio público (no necesario para las herramientas locales, pero sí para la página principal)
npm ci

# 2. Herramientas locales: dependencias propias, con su lockfile
cd extras/local
npm ci

# 3. Configuración personal (no se versiona)
cp .env.example .env        # en Windows: copy .env.example .env
# editá .env con las rutas de la sección 2

# 4. Ejecutar (solo en 127.0.0.1)
npm run dev
```

Abrí en el navegador:
- `http://127.0.0.1:5180/` — página principal del sitio, con las herramientas locales marcadas como «Disponible en la versión local».
- `http://127.0.0.1:5180/extras/local/web/paginas/descargar-youtube-audio/index.html` (y las demás rutas de `extras/local/web/paginas/`).

Comprobaciones útiles:
- `npm run typecheck` — verifica los tipos del código local.
- `npm test` — pruebas de las herramientas locales (URLs, nombres, formatos, ZIP, OCR).
- `npm run build` — compila las páginas locales en `extras/local/dist/` (no toca `dist/` del sitio público).

## 4. Modelo de Whisper

- La primera vez que transcribís, el navegador descarga el modelo `onnx-community/whisper-base` (cuantizado, unos 80 MB) desde huggingface.co. La página pide tu autorización antes de descargarlo.
- Después queda en la caché del navegador. El audio nunca se envía a ningún servicio.
- Formatos: los que el navegador puede decodificar (WAV, MP3, OGG, M4A, FLAC). Máximo 100 MB por archivo.
- Idiomas: los del selector (español, inglés, portugués, francés, etc.).

## 5. Dependencias y licencias de las herramientas locales

Estas dependencias se instalan en tu equipo desde npm. El repositorio no contiene sus archivos.

| Paquete | Versión | Licencia (verificada) | Uso |
|---|---|---|---|
| tesseract.js | 7.0.0 | Apache-2.0 (npm) | OCR en el navegador. |
| @tesseract.js-data/eng, @tesseract.js-data/spa | 1.0.0 | MIT declarado en npm; los datos proceden de tessdata_best, Apache-2.0 | Datos de idioma del OCR. Pendiente de confirmar la licencia del repositorio de origen. |
| @huggingface/transformers | 4.3.2 | Apache-2.0 (npm) | Whisper en el navegador. |
| onnx-community/whisper-base | — | Apache-2.0 (README del modelo) | Modelo descargado en el primer uso. |
| yt-dlp (instalado por vos) | 2026.10.26 probada | The Unlicense | Descargas de YouTube. |
| FFmpeg (instalado por vos) | build BtbN del 16 nov 2026 | Depende del build (LGPL o GPL) | Conversión y empaquetado de audio y video. |

## 6. Estructura

- `web/paginas/` — páginas de las herramientas. `web/scripts/` — su lógica en el navegador. `web/lib/`, `web/shared/`, `web/styles/` — código compartido de estas herramientas.
- `server/youtube/` — API local de YouTube (Node, `127.0.0.1`). Se monta en el servidor de desarrollo.
- `tests/` — pruebas de las herramientas locales.
- `scripts/copy-ocr.mjs` — copia los archivos de OCR a `public/ocr/` (se ejecuta antes de usar el OCR).
- `vite.local.config.ts` — configuración local (reutiliza `vite.config.ts` de la raíz sin cambiarlo).

## 7. Qué no está incluido

- Ejecutables de yt-dlp y FFmpeg (se instalan según la sección 2).
- Modelos de Whisper y datos de idioma descargados en tiempo de uso (el OCR copia sus datos desde `node_modules`).
- Archivos descargados, cookies, credenciales o sesiones: nunca se guardan en el repositorio.
