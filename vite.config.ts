import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { imageEnhanceApi } from './server/image-enhance.ts';
import { seoHead } from './server/seo-head.ts';
import { minificarHtml } from './server/html-minify.ts';
import { documentosPdfApi } from './server/documentos-pdf/api.ts';
import { loadDocumentosConfig } from './server/documentos-pdf/config.ts';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PARTIALS_DIR = join(ROOT, 'templates');

// El plugin de descargas de YouTube (server/youtube/) no se carga aquí: no forma parte de la
// publicación inicial. Para el entorno local, ver vite.youtube.config.ts (no versionado).

// Plantillas reutilizables: en cualquier HTML de la raíz, la línea
//   <!-- @include:header -->
// se sustituye por templates/header.html (con la misma sangría).
// Así el header, el footer y el sprite se editan en un solo sitio.
//
// Los partials pueden recibir datos como atributos y los insertan donde aparece {{clave}}:
//   <!-- @include:encabezado titulo="Mi herramienta" subtitulo="Qué hace" personaje="/images/characters/miles-cutout.webp" -->
// se sustituye por templates/encabezado.html con {{titulo}}, {{subtitulo}} y {{personaje}} rellenados.
const INCLUDE_RE = /^([ \t]*)<!--\s*@include:([\w-]+)((?:\s+[\w-]+="[^"]*")*)\s*-->/gm;
const ATTR_RE = /([\w-]+)="([^"]*)"/g;

const escapeAttr = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function includePartials(): Plugin {
  return {
    name: 'include-partials',
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        return html.replace(INCLUDE_RE, (_match, indent: string, name: string, rawAttrs: string) => {
          let partial = readFileSync(join(PARTIALS_DIR, `${name}.html`), 'utf8').replace(/\n$/, '');
          for (const [, key, value] of rawAttrs.matchAll(ATTR_RE)) {
            partial = partial.replaceAll(`{{${key}}}`, escapeAttr(value.replace(/\s+/g, ' ').trim()));
          }
          const lines = partial.split('\n');
          return indent + lines.map((line, i) => (i === 0 || !line ? line : indent + line)).join('\n');
        });
      },
    },
    configureServer(server) {
      // Al cambiar un partial, recargar el navegador en desarrollo.
      server.watcher.add(PARTIALS_DIR);
      server.watcher.on('change', (file) => {
        if (file.startsWith(PARTIALS_DIR)) server.ws.send({ type: 'full-reload' });
      });
    },
  };
}

// Tarjetas de descargas de YouTube: en `dev`/`preview` se muestra el enlace al descargador;
// en la compilación estática se muestra «Próximamente» (sin enlace).
// Marcas en index.html: <!-- @dev-only --> ... <!-- @end-dev-only --> y <!-- @prod-only --> ... <!-- @end-prod-only -->.
// servidorLocal: true solo en extras/local (vite.local.config.ts), donde las descargas de YouTube, OCR y
// transcripción funcionan. En `dev` de la raíz y en la versión pública esas tarjetas dicen «Disponible en la versión local».
function devOnlyCards(localBuild: boolean, servidorLocal: boolean): Plugin {
  // En la compilación local (CHISPABOX_LOCAL=true) la tarjeta de PDF a documento se muestra completa:
  // necesita el servidor de esta app, que solo corre en dev y preview.
  const LOCAL_CARD = 'tool-pdf-doc-title';
  const stripPublic = (html: string): string =>
    html
      .replace(/<!-- @dev-only -->[\s\S]*?<!-- @end-dev-only -->[ \t]*\n?/g, '')
      .replace(/<!-- @prod-only -->[ \t]*\n?/g, '')
      .replace(/[ \t]*<!-- @end-prod-only -->[ \t]*\n?/g, '')
      .replace(/<article\s+class="tool-card"\s+data-dev-link/g, '<article class="tool-card tool-card--soon" data-dev-link');
  const keepDev = (html: string): string =>
    html
      .replace(/<!-- @prod-only -->[\s\S]*?<!-- @end-prod-only -->[ \t]*\n?/g, '')
      .replace(/<!-- @dev-only -->[ \t]*\n?/g, '')
      .replace(/[ \t]*<!-- @end-dev-only -->[ \t]*\n?/g, '');
  return {
    name: 'dev-only-cards',
    transformIndexHtml(html, ctx) {
      if (ctx.server && !servidorLocal) return stripPublic(html);
      if (ctx.server) {
        return html
          .replace(/<!-- @prod-only -->[\s\S]*?<!-- @end-prod-only -->[ \t]*\n?/g, '')
          .replace(/<!-- @dev-only -->[ \t]*\n?/g, '')
          .replace(/[ \t]*<!-- @end-dev-only -->[ \t]*\n?/g, '');
      }
      if (!localBuild) return stripPublic(html);
      return html.replace(/<article[\s\S]*?<\/article>/g, (article) =>
        article.includes(LOCAL_CARD) ? keepDev(article) : stripPublic(article),
      );
    },
  };
}

// Página 404 en desarrollo y vista previa: las rutas que no existen responden 404 con 404.html
// (sin el respaldo de SPA, que devolvería la portada con código 200). En producción lo hace nginx.
function pagina404(): Plugin {
  return {
    name: 'pagina-404',
    configureServer(server) {
      return () => {
        server.middlewares.use(async (req, res, next) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') return next();
          if (res.writableEnded || res.headersSent) return next();
          const ruta = (req.url ?? '/').split('?')[0];
          // Solo se responde 404 si la ruta no es un archivo del proyecto ni de public/.
          if (ruta.startsWith('/@') || ruta.startsWith('/__') || ruta === '/') return next();
          const enRaiz = join(ROOT, ruta);
          const enPublic = join(ROOT, 'public', ruta);
          const existe = (f: string): boolean => existsSync(f) && statSync(f).isFile();
          if (existe(enRaiz) || existe(enPublic)) return next();
          const html = await server.transformIndexHtml('/404.html', readFileSync(join(ROOT, '404.html'), 'utf8'));
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(req.method === 'HEAD' ? undefined : html);
        });
      };
    },
    configurePreviewServer(server) {
      return () => {
        server.middlewares.use((req, res, next) => {
          if (req.method !== 'GET' && req.method !== 'HEAD') return next();
          if (res.writableEnded || res.headersSent) return next();
          const ruta = (req.url ?? '/').split('?')[0];
          // Vite reescribe '/' a '/index.html' antes de llegar aquí (MPA).
          if (ruta === '/' || ruta === '/index.html') {
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/html; charset=utf-8');
            res.end(readFileSync(join(ROOT, 'dist', 'index.html'), 'utf8'));
            return;
          }
          res.statusCode = 404;
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.end(readFileSync(join(ROOT, 'dist', '404.html'), 'utf8'));
        });
      };
    },
  };
}

// Enlaces cortos del acortador: /s/CODIGO se sirve como la página del acortador (en producción lo hace nginx).
const SHORT_LINK_RE = /^\/s\/[A-Za-z0-9]{7}\/?(\?.*)?$/;
const SHORT_LINK_PAGE = '/paginas/acortador-enlaces/index.html';

function shortLinks(): Plugin {
  const reescribir = (req: { url?: string }, _res: unknown, next: () => void) => {
    if (req.url && SHORT_LINK_RE.test(req.url)) req.url = SHORT_LINK_PAGE;
    next();
  };
  return {
    name: 'short-links',
    configureServer(server) {
      server.middlewares.use(reescribir);
    },
    configurePreviewServer(server) {
      server.middlewares.use(reescribir);
    },
  };
}

// Entradas de build: las páginas HTML de la raíz y cada paginas/<herramienta>/index.html
// (una página nueva no necesita tocar esta lista).
const PAGES_DIR = join(ROOT, 'paginas');
// Páginas que solo entran en `dev` y `preview` (no existen en la compilación pública, ni HTML ni JavaScript):
// - Descargas de YouTube (no se publican).
// - PDF a documento: necesita LibreOffice en el servidor de desarrollo; en producción aparece «Próximamente».
// - Transcribir audio: el dictado usa un servicio de reconocimiento de voz externo (Web Speech API)
//   y RG-02 no permite modelos de IA. Aparece «Próximamente» en la compilación pública.
// - OCR de documentos: Tesseract usa modelos LSTM (RG-02). Aparece «Próximamente» en la compilación pública.
const SOLO_DESARROLLO_PUBLICAS = [
  'descargar-youtube-video',
  'descargar-youtube-audio',
  'descargar-playlist-youtube',
];
const SOLO_DESARROLLO = new Set([
  'descargar-youtube-video',
  'descargar-youtube-audio',
  'descargar-playlist-youtube',
  'pdf-a-documento',
  'transcribir-audio',
  'ocr-documentos',
  // Dominios que necesitan la API del servidor local (extras/local): solo aparecen en esa versión.
  'dominio-ssl',
  'dominio-cabeceras',
  'dominio-historial',
  'dominio-subdominios',
  'dominio-propagacion',
]);

// Los archivos de OCR (public/ocr/) se copian a dist/ por ser parte de public/.
// En la compilación pública se eliminan, porque la página de OCR no se publica y son modelos de IA (RG-02).
function sinOcrEnPublico(publicBuild: boolean): Plugin {
  return {
    name: 'sin-ocr-en-publico',
    apply: 'build',
    closeBundle() {
      if (publicBuild) rmSync(join(ROOT, 'dist', 'ocr'), { recursive: true, force: true });
    },
  };
}

function pageInputs(publicBuild: boolean, localBuild: boolean): Record<string, string> {
  // En la compilación local solo se incluye PDF a documento; las descargas de YouTube siguen fuera.
  const excluidas = localBuild ? new Set(SOLO_DESARROLLO_PUBLICAS) : SOLO_DESARROLLO;
  return Object.fromEntries([
    ...readdirSync(ROOT)
      .filter((file) => file.endsWith('.html'))
      .map((file) => [basename(file, '.html'), join(ROOT, file)]),
    ...readdirSync(PAGES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(PAGES_DIR, entry.name, 'index.html')))
      .filter((entry) => !(publicBuild && excluidas.has(entry.name)))
      .map((entry) => [`paginas/${entry.name}`, join(PAGES_DIR, entry.name, 'index.html')]),
  ]);
}

// Vite se usa solo para desarrollo y compilación: el resultado es HTML/CSS/JS estático en /dist.
// Host, puerto y descargas de YouTube se configuran con variables de entorno (ver .env.example).
export default defineConfig(({ mode, command }) => {
  // process.env tiene prioridad sobre los archivos .env.
  const env = { ...loadEnv(mode, ROOT, ''), ...process.env };
  const youtube = { allowedHosts: ['localhost', '127.0.0.1', '[::1]'] };
  // CHISPABOX_LOCAL=true: compilación para probar en tu equipo (vista previa) con el servidor de PDF a documento.
  const localBuild = command === 'build' && env.CHISPABOX_LOCAL === 'true';
  const documentos = loadDocumentosConfig(env);
  const hostOf = (raw: string | undefined, fallback: string): string => (raw && raw.trim() ? raw.trim() : fallback);
  const port = (raw: string | undefined, fallback: number): number => {
    const value = Number(raw);
    return Number.isInteger(value) && value > 0 && value < 65536 ? value : fallback;
  };
  const allowedHosts = youtube.allowedHosts.map((host) => host.replace(/^\[|\]$/g, ''));

  return {
    base: '/',
    publicDir: 'public',
    // MPA: sin respaldo de SPA; las rutas inexistentes las resuelve pagina404().
    appType: 'mpa',
    // worker-f solo lo importa read-excel-file/browser, que no lo ejecuta (ver src/shims/worker-f-browser.ts).
    resolve: {
      alias: [{ find: /^worker-f\/browser$/, replacement: fileURLToPath(new URL('./src/shims/worker-f-browser.ts', import.meta.url)) }],
    },
    // El escaneo de dependencias de `dev` no debe leer la página de OCR: tesseract.js solo está instalado en extras/local
    // (ver RG-02 y extras/local/README.md). Sin esto, Vite avisa de una dependencia no resuelta en cada arranque.
    optimizeDeps: {
      entries: ['index.html', '404.html', 'paginas/**/index.html', '!paginas/ocr-documentos/index.html'],
    },
    // imageEnhanceApi, youtubeApi y documentosPdfApi solo existen en `dev` y `preview`; no se incluyen en el build estático.
    plugins: [includePartials(), pagina404(), devOnlyCards(localBuild, env.CHISPABOX_LOCAL_SERVER === 'true'),sinOcrEnPublico(command === 'build' && !localBuild), shortLinks(), seoHead(command === 'build' && !localBuild), minificarHtml(), imageEnhanceApi(), documentosPdfApi(documentos)],
    server: {
      host: hostOf(env.HOST, '127.0.0.1'),
      port: port(env.PORT, 5173),
      allowedHosts,
    },
    preview: {
      host: hostOf(env.PREVIEW_HOST, '127.0.0.1'),
      port: port(env.PREVIEW_PORT, 4173),
      allowedHosts,
      // Solo para probar el formulario localmente: en producción lo enruta Caddy al mismo origen.
      proxy: env.SUGERENCIAS_TARGET
        ? { '/api/sugerencias': { target: env.SUGERENCIAS_TARGET, changeOrigin: false } }
        : undefined,
    },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',
    cssCodeSplit: false,
    assetsInlineLimit: 0,
    modulePreload: { polyfill: false },
    reportCompressedSize: false,
    rollupOptions: {
      input: pageInputs(command === 'build', localBuild),
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  };
});
