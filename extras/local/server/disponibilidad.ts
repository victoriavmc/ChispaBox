/*
 * Requisitos de las herramientas locales. Solo corre en el servidor de desarrollo de extras/local.
 *
 * Si una herramienta no está instalada o configurada, su página responde 404 y lista qué falta.
 * Nada de esto se publica: el sitio público no incluye este archivo.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import type { YoutubeConfig } from './youtube/config.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
// HERE es extras/local/server: tres niveles hasta la raíz del repositorio.
const RAIZ = join(HERE, '..', '..', '..');
const requerir = createRequire(join(HERE, '..', 'package.json'));

export type Herramienta = 'video' | 'musica' | 'playlist' | 'transcribir' | 'ocr' | 'pdf-documento';

/** Página de cada herramienta, tal como la sirve el servidor de desarrollo. */
export const PAGINAS: Record<Herramienta, string> = {
  video: '/extras/local/web/paginas/descargar-youtube-video/index.html',
  musica: '/extras/local/web/paginas/descargar-youtube-audio/index.html',
  playlist: '/extras/local/web/paginas/descargar-playlist-youtube/index.html',
  transcribir: '/extras/local/web/paginas/transcribir-audio/index.html',
  ocr: '/extras/local/web/paginas/ocr-documentos/index.html',
  'pdf-documento': '/paginas/pdf-a-documento/index.html',
};

const NOMBRES: Record<Herramienta, string> = {
  video: 'Descargar video de YouTube',
  musica: 'Descargar música de YouTube',
  playlist: 'Descargar playlist de YouTube',
  transcribir: 'Transcribir audio a texto',
  ocr: 'OCR de documentos',
  'pdf-documento': 'PDF a documento',
};

/** Comprueba que un programa responde a su opción de versión (sin depender del PATH de la app). */
function programaOk(ruta: string, args: string[]): boolean {
  if (!ruta.trim()) return false;
  const r = spawnSync(ruta, args, { timeout: 8000, windowsHide: true, stdio: 'ignore' });
  return r.status === 0;
}

function modulo(nombre: string): boolean {
  try {
    requerir.resolve(nombre);
    return true;
  } catch {
    return false;
  }
}

/** Lista de cosas que faltan para usar una herramienta. Vacía si está lista. */
export function requisitosFaltantes(
  herramienta: Herramienta,
  youtube: YoutubeConfig,
  env: Record<string, string | undefined>,
): string[] {
  const faltan: string[] = [];
  const youtubeHerramienta = herramienta === 'video' || herramienta === 'musica' || herramienta === 'playlist';

  if (youtubeHerramienta) {
    if (!youtube.enabled) faltan.push('Descargas de YouTube deshabilitadas: poné YOUTUBE_DOWNLOADS_ENABLED=true en extras/local/.env.');
    if (!programaOk(youtube.ytDlpPath, ['--version'])) faltan.push(`yt-dlp no responde en «${youtube.ytDlpPath || '(vacío)'}». Revisá YTDLP_PATH en extras/local/.env.`);
    if (!programaOk(youtube.ffmpegPath, ['-version'])) faltan.push(`FFmpeg no responde en «${youtube.ffmpegPath || '(vacío)'}». Revisá FFMPEG_PATH en extras/local/.env.`);
    if (!programaOk(youtube.ffprobePath, ['-version'])) faltan.push(`ffprobe no responde en «${youtube.ffprobePath || '(vacío)'}». Revisá FFPROBE_PATH en extras/local/.env.`);
  }

  if (herramienta === 'transcribir' && !modulo('@huggingface/transformers')) {
    faltan.push('Falta el paquete @huggingface/transformers. Ejecutá «npm ci» dentro de extras/local.');
  }

  if (herramienta === 'ocr') {
    if (!modulo('tesseract.js')) faltan.push('Falta el paquete tesseract.js. Ejecutá «npm ci» dentro de extras/local.');
    if (!existsSync(join(RAIZ, 'public', 'ocr', 'worker.min.js')) || !existsSync(join(RAIZ, 'public', 'ocr', 'lang'))) {
      faltan.push('Faltan los archivos de OCR en public/ocr. Ejecutá el script de copia del OCR (scripts/copy-ocr.mjs) dentro de extras/local.');
    }
  }

  if (herramienta === 'pdf-documento') {
    const soffice = env.SOFFICE_PATH?.trim() || 'soffice';
    if (!programaOk(soffice, ['--version'])) {
      faltan.push(`LibreOffice no responde en «${soffice}». Instalalo y poné SOFFICE_PATH en extras/local/.env (ruta completa a soffice.exe).`);
    }
  }

  return faltan;
}

function escapar(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
}

/** Página 404 con la lista de requisitos que faltan. */
export function paginaNoDisponible(herramienta: Herramienta, faltan: string[]): string {
  const items = faltan.map((f) => `<li>${escapar(f)}</li>`).join('');
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>404: ${escapar(NOMBRES[herramienta])} no disponible | ChispaBox local</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; padding: 2rem 1rem; background: #101013; color: #f5f5f7; }
      main { max-width: 42rem; margin: 0 auto; }
      h1 { font-size: 1.5rem; margin: 0 0 0.75rem; }
      p, li { line-height: 1.5; }
      li { margin-bottom: 0.5rem; }
      a { color: #ff5a6e; }
    </style>
  </head>
  <body>
    <main>
      <h1>404: ${escapar(NOMBRES[herramienta])} no está disponible en este equipo</h1>
      <p>Para usar esta herramienta falta lo siguiente:</p>
      <ul>${items}</ul>
      <p>Cuando lo tengas, recargá esta página. <a href="/">Volver a la portada</a></p>
    </main>
  </body>
</html>`;
}

/** Middleware de Vite: responde 404 con la lista de faltantes en las páginas locales. */
export function requisitosLocales(youtube: YoutubeConfig, env: Record<string, string | undefined>): Plugin {
  const porRuta = new Map<string, Herramienta>(
    (Object.keys(PAGINAS) as Herramienta[]).map((h) => [PAGINAS[h], h]),
  );
  return {
    name: 'requisitos-herramientas-locales',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const ruta = (req.url ?? '').split('?')[0];
        const herramienta = porRuta.get(ruta);
        if (!herramienta || (req.method !== 'GET' && req.method !== 'HEAD')) return next();
        const faltan = requisitosFaltantes(herramienta, youtube, env);
        if (faltan.length === 0) return next();
        res.statusCode = 404;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(req.method === 'HEAD' ? undefined : paginaNoDisponible(herramienta, faltan));
      });
    },
  };
}
