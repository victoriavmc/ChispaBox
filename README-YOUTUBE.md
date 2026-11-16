# Usar las descargas de YouTube en local

Guía corta para quien descargue este repositorio de GitHub y quiera usar **Descargar video** y **Descargar música** en su propio equipo.

Para el detalle completo (dependencias, límites, seguridad) ver [`docs/descargas-youtube.md`](docs/descargas-youtube.md).

## 1. La variable que tenés que modificar

La descarga de YouTube se controla con una sola variable de entorno:

```bash
YOUTUBE_DOWNLOADS_ENABLED=true
```

Dónde ponerla:

1. Copiá el archivo de plantilla:

   ```bash
   cp .env.example .env.local
   ```

   En Windows (PowerShell) podés usar `Copy-Item .env.example .env.local`.

2. Abrí `.env.local` y dejá esta línea así (sin el `#` al inicio, si está comentada):

   ```bash
   YOUTUBE_DOWNLOADS_ENABLED=true
   ```

`.env.local` no se sube a GitHub (está en `.gitignore`), así que cada persona configura la suya.

### Reglas que conviene conocer

| Situación | Resultado |
| --- | --- |
| `YOUTUBE_DOWNLOADS_ENABLED=true` | Habilitado |
| `YOUTUBE_DOWNLOADS_ENABLED=false` | Deshabilitado |
| Variable sin definir y `NODE_ENV` distinto de `production` | Habilitado (valor por defecto en desarrollo) |
| Variable sin definir y `NODE_ENV=production` | Deshabilitado |
| Valor no reconocido (por ejemplo `si`, `yes`) | Deshabilitado (cerrado por seguridad) |

Para que funcione de forma explícita, lo recomendable es definir `YOUTUBE_DOWNLOADS_ENABLED=true` en `.env.local`.

## 2. Instalar las herramientas externas

Las descargas usan dos programas que **no vienen con el repositorio**:

- **yt-dlp**: descarga el video o el audio.
- **FFmpeg** (incluye `ffprobe`): convierte y une los archivos.

Podés instalarlos y dejarlos en el `PATH`, o indicar la ruta exacta en `.env.local`:

```bash
YTDLP_PATH=yt-dlp
FFMPEG_PATH=ffmpeg
FFPROBE_PATH=ffprobe
```

Si no están en el `PATH`, usá la ruta completa, por ejemplo:

```bash
YTDLP_PATH=C:\Users\TuUsuario\tools\bin\yt-dlp.exe
FFMPEG_PATH=C:\Users\TuUsuario\tools\bin\ffmpeg.exe
FFPROBE_PATH=C:\Users\TuUsuario\tools\bin\ffprobe.exe
```

Para comprobar que se encuentran, ejecutá en una terminal:

```bash
yt-dlp --version
ffmpeg -version
ffprobe -version
```

## 3. Arrancar la aplicación

Instalá dependencias una vez y luego levantá el servidor de desarrollo:

```bash
npm install
npm run dev
```

Abrí la página de descarga en el navegador, por ejemplo:

- Video: `/paginas/descargar-youtube-video/`
- Música: `/paginas/descargar-youtube-audio/`

Las descargas **solo funcionan con `npm run dev` o `npm run preview`**. Con un build estático (`npm run build` servido por otro medio) las descargas quedan desactivadas.

## 4. Otras variables útiles (opcionales)

Todas están documentadas en `.env.example`. Las más comunes:

| Variable | Por defecto | Para qué sirve |
| --- | --- | --- |
| `YOUTUBE_MAX_CONCURRENT_JOBS` | `2` | Descargas simultáneas (1 a 8) |
| `YOUTUBE_MAX_MINUTES` | `120` | Duración máxima de un video |
| `YOUTUBE_MAX_FILESIZE_MB` | `2048` | Tamaño máximo de un archivo final |
| `YOUTUBE_TEMP_DIR` | carpeta temporal del sistema | Dónde se guardan los archivos de trabajo |

## Uso responsable

Usá esta herramienta solo con contenido propio o cuya descarga esté autorizada. No evade DRM ni controles de acceso, y no lee cookies ni credenciales del navegador.

## Solución de problemas

- **«Las descargas de YouTube están deshabilitadas en este entorno»**: revisá que `YOUTUBE_DOWNLOADS_ENABLED=true` esté en `.env.local` y reiniciá `npm run dev`. Los cambios en `.env.local` no se aplican hasta reiniciar.
- **Error al analizar un enlace o al descargar, con yt-dlp no encontrado**: `YTDLP_PATH` apunta a un programa que no existe. Corregí la ruta o agregá la carpeta al `PATH`.
- **Falla la conversión a MP4 o MP3**: revisá `FFMPEG_PATH` y `FFPROBE_PATH`.
- **Después de cambiar `.env.local`**: reiniciá el servidor. Las variables se leen al arrancar.
