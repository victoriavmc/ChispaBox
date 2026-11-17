/*
 * Plugin de Vite: monta el API de YouTube en el servidor de desarrollo y en la vista previa.
 * En la compilación estática (Nginx) no existe servidor, por lo que el API no está disponible
 * y la interfaz muestra la herramienta como no disponible.
 */
import type { Plugin, ViteDevServer } from 'vite';
import { createYoutubeApi, API_PREFIX } from './api.ts';
import type { YoutubeConfig } from './config.ts';

/** Partes del servidor de desarrollo y de vista previa que usa el API. */
type ServerLike = Pick<ViteDevServer, 'middlewares' | 'httpServer'>;

export function youtubeApi(config: YoutubeConfig): Plugin {
  const install = (server: ServerLike): void => {
    for (const warning of config.warnings) console.warn(`[youtube] ${warning}`);
    console.info(`[youtube] descargas ${config.enabled ? 'habilitadas' : 'deshabilitadas'} en este entorno.`);

    const instance = createYoutubeApi(config);
    instance.init();

    server.middlewares.use((req, res, next) => {
      const path = (req.url ?? '').split('?')[0];
      if (path !== API_PREFIX && !path.startsWith(`${API_PREFIX}/`)) return next();
      instance.handle(req, res);
    });

    server.httpServer?.once('close', () => {
      void instance.dispose();
    });
  };

  return {
    name: 'youtube-api',
    configureServer(server) {
      install(server);
    },
    configurePreviewServer(server) {
      install(server);
    },
  };
}
