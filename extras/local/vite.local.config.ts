// Configuración de las herramientas locales de ChispaBox. Solo se usa desde extras/local/.
// Reutiliza vite.config.ts de la raíz (sin cambios) y añade las páginas locales, el API de
// YouTube (solo en dev y preview, en 127.0.0.1) y una salida de compilación separada.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadEnv, mergeConfig, type ConfigEnv, type UserConfig } from 'vite';
import baseConfig from '../../vite.config.ts';
import { loadYoutubeConfig } from './server/youtube/config.ts';
import { youtubeApi } from './server/youtube/vite-plugin.ts';
import { requisitosLocales } from './server/disponibilidad.ts';
import { indiceLocal } from './server/indice-local.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGINAS_LOCALES = ['descargar-youtube-video', 'descargar-youtube-audio', 'descargar-playlist-youtube', 'ocr-documentos', 'transcribir-audio'];

export default async (env: ConfigEnv): Promise<UserConfig> => {
  // Marca este servidor como local: la configuración raíz muestra las herramientas que solo existen aquí.
  process.env.CHISPABOX_LOCAL_SERVER = 'true';
  const base = typeof baseConfig === 'function' ? await baseConfig(env) : await baseConfig;
  // Variables de la raíz (.env.local, p. ej. SOFFICE_PATH) y de extras/local (.env, que tiene prioridad).
  const variables = {
    ...loadEnv(env.mode, join(HERE, '..', '..'), ''),
    ...loadEnv(env.mode, HERE, ''),
    ...process.env,
  };
  const youtube = loadYoutubeConfig(variables);
  const inputs = Object.fromEntries(
    PAGINAS_LOCALES.map((nombre) => [`extras/local/web/paginas/${nombre}`, join(HERE, 'web', 'paginas', nombre, 'index.html')]),
  );
  return mergeConfig(base, {
    // La raíz del sitio es el repositorio (no esta carpeta): así /src, /public y /paginas resuelven igual que en la versión pública.
    root: join(HERE, '..', '..'),
    server: { host: '127.0.0.1', port: 5180, strictPort: true },
    preview: { host: '127.0.0.1', port: 5181, strictPort: true },
    plugins: [youtubeApi(youtube), requisitosLocales(youtube, variables), indiceLocal()],
    build: {
      outDir: join(HERE, 'dist'),
      emptyOutDir: true,
      rollupOptions: { input: inputs },
    },
  });
};
