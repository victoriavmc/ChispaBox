/*
 * Servidor autónomo del API de YouTube, pensado para desplegarse detrás de un proxy inverso
 * con HTTPS y controles de acceso. Solo responde /api/youtube/*; el resto de la web es estática.
 *
 * Arranque:  node --experimental-strip-types server/youtube/standalone.ts
 * (o con npm run api:youtube). Host y puerto: API_HOST y API_PORT.
 *
 * No exponer este proceso directamente a Internet: usar un proxy con HTTPS y autenticación.
 */
import { createServer } from 'node:http';
import { createYoutubeApi } from './api.ts';
import { loadYoutubeConfig } from './config.ts';

const config = loadYoutubeConfig(process.env);
for (const warning of config.warnings) console.warn(`[youtube] ${warning}`);

const api = createYoutubeApi(config);
api.init();

const server = createServer((req, res) => {
  if (api.handle(req, res)) return;
  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ error: 'Ruta no encontrada.' }));
});

server.listen(config.port, config.host, () => {
  console.info(
    `[youtube] API escuchando en ${config.host}:${config.port} · descargas ${config.enabled ? 'habilitadas' : 'deshabilitadas'}`,
  );
});

async function shutdown(): Promise<void> {
  server.close();
  await api.dispose();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
