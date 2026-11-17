import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request, createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createYoutubeApi, type YoutubeApi } from '../../server/youtube/api.ts';
import { loadYoutubeConfig } from '../../server/youtube/config.ts';

interface Reply {
  status: number;
  body: string;
  json: unknown;
}

function makeServer(api: YoutubeApi): Server {
  return createServer((req, res) => {
    if (api.handle(req, res)) return;
    res.writeHead(404);
    res.end();
  });
}

function call(port: number, options: { method?: string; path: string; host?: string; origin?: string; contentType?: string; body?: string; fetchSite?: string }): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string> = {};
    if (options.host !== undefined) headers.host = options.host;
    if (options.origin !== undefined) headers.origin = options.origin;
    if (options.fetchSite !== undefined) headers['sec-fetch-site'] = options.fetchSite;
    if (options.contentType !== undefined) headers['content-type'] = options.contentType;
    if (options.body !== undefined) headers['content-length'] = String(Buffer.byteLength(options.body));
    const req = request(
      { host: '127.0.0.1', port, path: options.path, method: options.method ?? 'GET', headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          let json: unknown = null;
          try {
            json = JSON.parse(body);
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode ?? 0, body, json });
        });
      },
    );
    req.on('error', reject);
    if (options.body !== undefined) req.write(options.body);
    req.end();
  });
}

const LOCAL = 'localhost';

function config(env: Record<string, string | undefined>) {
  return loadYoutubeConfig({
    YOUTUBE_TEMP_DIR: join(tmpdir(), `chispabox-yt-test-${process.pid}-${Math.random().toString(36).slice(2)}`),
    YTDLP_PATH: join(tmpdir(), 'no-existe-yt-dlp'),
    ...env,
  });
}

// Entorno de producción: descargas deshabilitadas.
const disabledApi = createYoutubeApi(config({ NODE_ENV: 'production' }));
const enabledApi = createYoutubeApi(config({ YOUTUBE_DOWNLOADS_ENABLED: 'true' }));
let disabledServer: Server;
let enabledServer: Server;
let disabledPort = 0;
let enabledPort = 0;

before(async () => {
  disabledApi.init();
  enabledApi.init();
  disabledServer = makeServer(disabledApi);
  enabledServer = makeServer(enabledApi);
  await new Promise<void>((r) => disabledServer.listen(0, '127.0.0.1', () => r()));
  await new Promise<void>((r) => enabledServer.listen(0, '127.0.0.1', () => r()));
  disabledPort = (disabledServer.address() as { port: number }).port;
  enabledPort = (enabledServer.address() as { port: number }).port;
});

after(async () => {
  disabledServer.close();
  enabledServer.close();
  await disabledApi.dispose();
  await enabledApi.dispose();
});

test('producción: el estado indica deshabilitado y ninguna ruta de descarga responde', async () => {
  const estado = await call(disabledPort, { path: '/api/youtube/estado', host: LOCAL });
  assert.equal(estado.status, 200);
  assert.deepEqual(estado.json, { habilitado: false, limites: null });

  const body = JSON.stringify({ url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' });
  const analizar = await call(disabledPort, { method: 'POST', path: '/api/youtube/analizar', host: LOCAL, contentType: 'application/json', body });
  assert.equal(analizar.status, 404);
  assert.match(analizar.body, /deshabilitadas/);

  const trabajo = await call(disabledPort, {
    method: 'POST',
    path: '/api/youtube/trabajos',
    host: LOCAL,
    contentType: 'application/json',
    body: JSON.stringify({ tipo: 'audio', videoId: 'aqz-KE-bpKQ', formato: 'mp3', kbps: 128, nombre: 'x' }),
  });
  assert.equal(trabajo.status, 404);

  for (const path of ['/api/youtube/trabajos/00000000-0000-4000-8000-000000000000', '/api/youtube/trabajos/00000000-0000-4000-8000-000000000000/archivo']) {
    const r = await call(disabledPort, { path, host: LOCAL });
    assert.equal(r.status, 404, path);
  }
});

test('el API rechaza hosts y orígenes no permitidos (DNS rebinding y sitios ajenos)', async () => {
  const evilHost = await call(enabledPort, { path: '/api/youtube/estado', host: 'evil.example' });
  assert.equal(evilHost.status, 403);

  const evilOrigin = await call(enabledPort, { path: '/api/youtube/estado', host: LOCAL, origin: 'https://atacante.example' });
  assert.equal(evilOrigin.status, 403);

  const crossSite = await call(enabledPort, { path: '/api/youtube/estado', host: LOCAL, fetchSite: 'cross-site' });
  assert.equal(crossSite.status, 403);

  const sameOrigin = await call(enabledPort, {
    path: '/api/youtube/estado',
    host: `${LOCAL}:${enabledPort}`,
    origin: `http://${LOCAL}:${enabledPort}`,
  });
  assert.equal(sameOrigin.status, 200);
});

test('habilitado: estado con límites y validación de las peticiones POST', async () => {
  const estado = await call(enabledPort, { path: '/api/youtube/estado', host: LOCAL });
  assert.equal(estado.status, 200);
  const json = estado.json as { habilitado: boolean; limites: { duracionMaximaMinutos: number } };
  assert.equal(json.habilitado, true);
  assert.equal(json.limites.duracionMaximaMinutos, 120);

  const wrongType = await call(enabledPort, { method: 'POST', path: '/api/youtube/analizar', host: LOCAL, contentType: 'text/plain', body: '{}' });
  assert.equal(wrongType.status, 415);

  const badJson = await call(enabledPort, { method: 'POST', path: '/api/youtube/analizar', host: LOCAL, contentType: 'application/json', body: '{no json' });
  assert.equal(badJson.status, 400);

  const badUrl = await call(enabledPort, {
    method: 'POST',
    path: '/api/youtube/analizar',
    host: LOCAL,
    contentType: 'application/json',
    body: JSON.stringify({ url: 'https://evil.example/watch?v=aqz-KE-bpKQ' }),
  });
  assert.equal(badUrl.status, 400);

  const tooLarge = await call(enabledPort, {
    method: 'POST',
    path: '/api/youtube/analizar',
    host: LOCAL,
    contentType: 'application/json',
    body: JSON.stringify({ url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', pad: 'x'.repeat(5000) }),
  });
  assert.equal(tooLarge.status, 413);

  const method = await call(enabledPort, { method: 'PUT', path: '/api/youtube/analizar', host: LOCAL });
  assert.equal(method.status, 405);
});

test('habilitado: no se descarga nada sin un análisis previo y con identificadores inválidos', async () => {
  const noAnalysis = await call(enabledPort, {
    method: 'POST',
    path: '/api/youtube/trabajos',
    host: LOCAL,
    contentType: 'application/json',
    body: JSON.stringify({ tipo: 'audio', videoId: 'aqz-KE-bpKQ', formato: 'mp3', kbps: 128, nombre: 'x' }),
  });
  assert.equal(noAnalysis.status, 409);

  const badId = await call(enabledPort, {
    method: 'POST',
    path: '/api/youtube/trabajos',
    host: LOCAL,
    contentType: 'application/json',
    body: JSON.stringify({ tipo: 'audio', videoId: '../../etc/passwd', formato: 'mp3' }),
  });
  assert.equal(badId.status, 400);

  const unknownJob = await call(enabledPort, { path: '/api/youtube/trabajos/no-es-uuid', host: LOCAL });
  assert.equal(unknownJob.status, 404);

  const unknownRoute = await call(enabledPort, { path: '/api/youtube/otra-cosa', host: LOCAL });
  assert.equal(unknownRoute.status, 404);
});

test('las rutas fuera de /api/youtube no las atiende este módulo', async () => {
  const r = await call(enabledPort, { path: '/api/imagen/estado', host: LOCAL });
  assert.equal(r.status, 404);
});
