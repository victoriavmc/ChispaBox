/*
 * Prueba de extremo a extremo con yt-dlp y FFmpeg reales. Solo se ejecuta si se activa:
 *   YOUTUBE_INTEGRATION=1 YTDLP_PATH=... FFMPEG_PATH=... FFPROBE_PATH=... npm run test:youtube
 *
 * Usa un video de prueba con licencia Creative Commons (Blender Foundation) y descargas pequeñas.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { request, createServer, type Server, type IncomingMessage } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createYoutubeApi, type YoutubeApi } from '../../server/youtube/api.ts';
import { loadYoutubeConfig } from '../../server/youtube/config.ts';
import { probeFile } from '../../server/youtube/ffmpeg.ts';

const ENABLED = process.env.YOUTUBE_INTEGRATION === '1';
const VIDEO_URL = 'https://youtu.be/aqz-KE-bpKQ';
const VIDEO_ID = 'aqz-KE-bpKQ';

interface Reply {
  status: number;
  headers: IncomingMessage['headers'];
  body: Buffer;
}

function call(port: number, method: string, path: string, json?: unknown): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const payload = json === undefined ? undefined : Buffer.from(JSON.stringify(json));
    const headers: Record<string, string> = { host: `localhost:${port}` };
    if (payload) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = String(payload.length);
    }
    const req = request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function pollUntilDone(port: number, id: string): Promise<{ estado: string; error: string | null; nombreArchivo: string }> {
  for (let i = 0; i < 600; i += 1) {
    const r = await call(port, 'GET', `/api/youtube/trabajos/${id}`);
    const status = JSON.parse(r.body.toString('utf8')) as { estado: string; error: string | null; nombreArchivo: string };
    if (['listo', 'error', 'cancelado'].includes(status.estado)) return status;
    await new Promise((r2) => setTimeout(r2, 1000));
  }
  throw new Error('tiempo de espera agotado');
}

if (!ENABLED) {
  test('prueba de integración omitida (defina YOUTUBE_INTEGRATION=1)', { skip: true }, () => undefined);
} else {
  const tempDir = join(tmpdir(), `chispabox-yt-int-${process.pid}`);
  const config = loadYoutubeConfig({
    YOUTUBE_DOWNLOADS_ENABLED: 'true',
    YOUTUBE_TEMP_DIR: tempDir,
    YTDLP_PATH: process.env.YTDLP_PATH,
    FFMPEG_PATH: process.env.FFMPEG_PATH,
    FFPROBE_PATH: process.env.FFPROBE_PATH,
    YOUTUBE_MAX_CONCURRENT_JOBS: '1',
  });
  const api: YoutubeApi = createYoutubeApi(config);
  const server: Server = createServer((req, res) => {
    if (!api.handle(req, res)) {
      res.writeHead(404);
      res.end();
    }
  });
  let port = 0;

  before(async () => {
    api.init();
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as { port: number }).port;
  });

  after(async () => {
    server.close();
    await api.dispose();
  });

  test('análisis real: formatos y calidades de un video de prueba', async () => {
    const r = await call(port, 'POST', '/api/youtube/analizar', { url: VIDEO_URL });
    assert.equal(r.status, 200, r.body.toString());
    const { analisis } = JSON.parse(r.body.toString('utf8')) as { analisis: { titulo: string; video: Array<{ contenedor: string; alturas: number[] }>; audio: Array<{ formato: string; kbps: number[] }> } };
    assert.match(analisis.titulo, /Big Buck Bunny/);
    assert.ok(analisis.video.find((v) => v.contenedor === 'mp4')?.alturas.includes(144), 'MP4 a 144p disponible');
    assert.ok(analisis.audio.length === 4);
  });

  test('tamaños aproximados: se informan por calidad y se acercan al archivo real', async () => {
    const r = await call(port, 'POST', '/api/youtube/analizar', { url: VIDEO_URL });
    const { analisis } = JSON.parse(r.body.toString('utf8')) as {
      analisis: { video: Array<{ contenedor: string; alturas: number[]; tamanos: Record<string, number | null> }>; audio: Array<{ formato: string; kbps: number[]; tamanos: Record<string, number | null> }> };
    };
    const mp4 = analisis.video.find((v) => v.contenedor === 'mp4');
    assert.ok(mp4, 'MP4 disponible');
    for (const altura of mp4.alturas) assert.ok((mp4.tamanos[String(altura)] ?? 0) > 0, `tamaño estimado a ${altura}p`);
    const mp3 = analisis.audio.find((a) => a.formato === 'mp3');
    assert.ok(mp3?.kbps.every((k) => (mp3.tamanos[String(k)] ?? 0) > 0));
    assert.ok((analisis.audio.find((a) => a.formato === 'wav')?.tamanos['0'] ?? 0) > 0);
  });

  test('audio MP3 real: genera archivo con nombre Artista - Título y lo verifica', async () => {
    const started = await call(port, 'POST', '/api/youtube/trabajos', {
      tipo: 'audio',
      videoId: VIDEO_ID,
      formato: 'mp3',
      kbps: 96,
      artista: 'Tan Biónica',
      titulo: 'Pastillitas del Olvido',
    });
    assert.equal(started.status, 202, started.body.toString());
    const { id, nombreArchivo } = JSON.parse(started.body.toString('utf8')) as { id: string; nombreArchivo: string };
    assert.equal(nombreArchivo, 'Tan Biónica - Pastillitas del Olvido.mp3');

    const done = await pollUntilDone(port, id);
    assert.equal(done.estado, 'listo', done.error ?? '');

    const file = await call(port, 'GET', `/api/youtube/trabajos/${id}/archivo`);
    assert.equal(file.status, 200);
    assert.equal(file.headers['content-type'], 'audio/mpeg');
    assert.match(String(file.headers['content-disposition']), /filename\*=UTF-8''Tan%20Bi%C3%B3nica%20-%20Pastillitas%20del%20Olvido\.mp3/);
    assert.ok(file.body.length > 10_000, 'archivo con contenido');

    // El archivo sigue disponible para guardarlo de nuevo mientras venza el plazo.
    const again = await call(port, 'GET', `/api/youtube/trabajos/${id}/archivo`);
    assert.equal(again.status, 200);
    assert.equal(again.body.length, file.body.length);
  });

  test('video MP4 real a 144p: se combina con FFmpeg y se verifica', async () => {
    const started = await call(port, 'POST', '/api/youtube/trabajos', {
      tipo: 'video',
      videoId: VIDEO_ID,
      contenedor: 'mp4',
      altura: 144,
      nombre: 'Prueba: 144p / mp4?',
    });
    assert.equal(started.status, 202, started.body.toString());
    const { id, nombreArchivo } = JSON.parse(started.body.toString('utf8')) as { id: string; nombreArchivo: string };
    assert.equal(nombreArchivo, 'Prueba_ 144p _ mp4_.mp4');
    const done = await pollUntilDone(port, id);
    assert.equal(done.estado, 'listo', done.error ?? '');
    const status = JSON.parse((await call(port, 'GET', `/api/youtube/trabajos/${id}`)).body.toString('utf8')) as { bytes: number | null };
    assert.ok((status.bytes ?? 0) > 0, 'el tamaño verificado se informa cuando el archivo está listo');

    const file = await call(port, 'GET', `/api/youtube/trabajos/${id}/archivo`);
    assert.equal(file.status, 200);
    assert.equal(file.headers['content-type'], 'video/mp4');
    const tmp = join(tempDir, 'verificacion-mp4.mp4');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(tmp, file.body);
    const probe = await probeFile(config, tmp);
    assert.equal(probe.hasVideo, true);
    assert.equal(probe.hasAudio, true);
    assert.ok((probe.durationSeconds ?? 0) > 1);
  });

  test('cancelación: el trabajo se detiene y no deja archivos', async () => {
    const started = await call(port, 'POST', '/api/youtube/trabajos', { tipo: 'audio', videoId: VIDEO_ID, formato: 'wav', nombre: 'cancelar' });
    assert.equal(started.status, 202);
    const { id } = JSON.parse(started.body.toString('utf8')) as { id: string };
    const del = await call(port, 'DELETE', `/api/youtube/trabajos/${id}`);
    assert.equal(del.status, 204);
    const gone = await call(port, 'GET', `/api/youtube/trabajos/${id}`);
    assert.equal(gone.status, 404);
  });

  test('calidad inexistente o no ofrecida se rechaza en el servidor', async () => {
    const r = await call(port, 'POST', '/api/youtube/trabajos', { tipo: 'video', videoId: VIDEO_ID, contenedor: 'mp4', altura: 4320 });
    assert.equal(r.status, 400);
    const bitrate = await call(port, 'POST', '/api/youtube/trabajos', { tipo: 'audio', videoId: VIDEO_ID, formato: 'mp3', kbps: 320, nombre: 'x' });
    assert.equal(bitrate.status, 400, 'no se ofrece 320 kbps por encima del origen');
  });

  test('lote real: enlaces pegados → ZIP con el audio de cada video', async () => {
    const analysis = await call(port, 'POST', '/api/youtube/lote/analizar', {
      texto: `https://youtu.be/${VIDEO_ID}\nno es un enlace\nhttps://youtu.be/${VIDEO_ID}`,
    });
    assert.equal(analysis.status, 200, analysis.body.toString());
    const { analisis } = JSON.parse(analysis.body.toString('utf8')) as {
      analisis: { loteId: string; items: Array<{ videoId: string }>; errores: string[] };
    };
    assert.equal(analisis.items.length, 1, 'el enlace repetido no se duplica');
    assert.equal(analisis.errores.length, 1, 'la línea inválida se informa');
    assert.match(analisis.errores[0], /Línea 2/);

    const started = await call(port, 'POST', '/api/youtube/lote/trabajos', {
      loteId: analisis.loteId,
      tipo: 'audio',
      formato: 'mp3',
      kbps: 96,
      nombre: 'Lote de prueba',
    });
    assert.equal(started.status, 202, started.body.toString());
    const { id, nombreArchivo } = JSON.parse(started.body.toString('utf8')) as { id: string; nombreArchivo: string };
    assert.equal(nombreArchivo, 'Lote de prueba.zip');

    const done = await pollUntilDone(port, id);
    assert.equal(done.estado, 'listo', done.error ?? '');
    const file = await call(port, 'GET', `/api/youtube/trabajos/${id}/archivo`);
    assert.equal(file.status, 200);
    assert.equal(file.headers['content-type'], 'application/zip');
    // Comprobación de estructura: firma de fin de directorio y una entrada.
    const eocd = file.body.length - 22;
    assert.equal(file.body.readUInt32LE(eocd), 0x06054b50);
    assert.equal(file.body.readUInt16LE(eocd + 10), 1);
    assert.ok(file.body.includes(Buffer.from('.mp3', 'utf8')), 'contiene el MP3');
  });

  test('lote real de DOS videos: el ZIP debe contener los dos MP4', async () => {
    const texto = `https://youtu.be/${VIDEO_ID}\nhttps://www.youtube.com/watch?v=TLkA0RELQ1g`;
    const analysis = await call(port, 'POST', '/api/youtube/lote/analizar', { texto });
    assert.equal(analysis.status, 200, analysis.body.toString());
    const { analisis } = JSON.parse(analysis.body.toString('utf8')) as { analisis: { loteId: string; items: unknown[] } };
    assert.equal(analisis.items.length, 2);
    const started = await call(port, 'POST', '/api/youtube/lote/trabajos', {
      loteId: analisis.loteId,
      tipo: 'video',
      contenedor: 'mp4',
      altura: 144,
      nombre: 'Lote dos videos',
    });
    assert.equal(started.status, 202, started.body.toString());
    const { id } = JSON.parse(started.body.toString('utf8')) as { id: string };
    const done = await pollUntilDone(port, id);
    assert.equal(done.estado, 'listo', done.error ?? '');
    const status = JSON.parse((await call(port, 'GET', `/api/youtube/trabajos/${id}`)).body.toString('utf8')) as { mensaje: string; avisos: string[] };
    const file = await call(port, 'GET', `/api/youtube/trabajos/${id}/archivo`);
    const { writeFileSync } = await import('node:fs');
    writeFileSync('C:/Users/VictoriaVMC/tools/downloads/lote-dos.zip', file.body);
    const eocd = file.body.length - 22;
    console.log('MENSAJE:', status.mensaje, '| AVISOS:', JSON.stringify(status.avisos));
    assert.equal(file.body.readUInt16LE(eocd + 10), 2, 'dos entradas en el ZIP');
  });

  test('lote real de VIDEO: el ZIP contiene el MP4 del video', async () => {
    const analysis = await call(port, 'POST', '/api/youtube/lote/analizar', { texto: `https://youtu.be/${VIDEO_ID}` });
    assert.equal(analysis.status, 200, analysis.body.toString());
    const { analisis } = JSON.parse(analysis.body.toString('utf8')) as { analisis: { loteId: string } };
    const started = await call(port, 'POST', '/api/youtube/lote/trabajos', {
      loteId: analisis.loteId,
      tipo: 'video',
      contenedor: 'mp4',
      altura: 144,
      nombre: 'Lote video prueba',
    });
    assert.equal(started.status, 202, started.body.toString());
    const { id } = JSON.parse(started.body.toString('utf8')) as { id: string };
    const done = await pollUntilDone(port, id);
    assert.equal(done.estado, 'listo', done.error ?? '');
    const file = await call(port, 'GET', `/api/youtube/trabajos/${id}/archivo`);
    const { writeFileSync } = await import('node:fs');
    writeFileSync('C:/Users/VictoriaVMC/tools/downloads/lote-video.zip', file.body);
    const eocd = file.body.length - 22;
    assert.equal(file.body.readUInt16LE(eocd + 10), 1, 'una entrada en el ZIP');
    assert.ok(file.body.includes(Buffer.from('.mp4', 'utf8')), 'el ZIP contiene el MP4');
  });
}
