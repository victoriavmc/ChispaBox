/*
 * API HTTP de descargas de YouTube. Es independiente de Vite: el mismo manejador sirve al
 * middleware de desarrollo/vista previa (vite-plugin.ts) y al servidor autónomo (standalone.ts).
 *
 * Rutas (todas bajo /api/youtube):
 *   GET    /estado                  → si las descargas están habilitadas y sus límites
 *   POST   /analizar                → valida el enlace y devuelve formatos reales
 *   POST   /trabajos                → inicia una descarga con una opción ya analizada
 *   GET    /trabajos/:id            → estado y progreso
 *   GET    /trabajos/:id/archivo    → archivo final (solo si está listo y verificado)
 *   DELETE /trabajos/:id            → cancela y borra los temporales
 *
 * Controles: con descargas deshabilitadas no se lee el cuerpo ni se lanza ningún proceso.
 * Solo se aceptan Host y Origin de la lista ALLOWED_HOSTS; las peticiones POST deben ser JSON.
 */
import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { expandSources } from './lote.ts';
import { stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { loadYoutubeConfig, type YoutubeConfig } from './config.ts';
import { YoutubeError } from './errors.ts';
import { buildAudioOptions, buildVideoOptions, isAudioFormat, isVideoContainer, sourceAudioKbps } from './formats.ts';
import { JobManager, type Job, type JobSpec } from './jobs.ts';
import { fetchVideoInfo, type RawInfo } from './ytdlp.ts';
import { parseYoutubeVideoUrl } from './url.ts';
import {
  AUDIO_BITRATE_STEPS,
  type AnalysisResult,
  type AudioFormat,
  type BatchAnalysis,
  type BatchItem,
  type BatchJobRequest,
  type JobRequest,
  type JobStatus,
  type StatusResponse,
  type VideoContainer,
} from '../../web/shared/youtube-types.ts';
import { buildAudioName, buildVideoName, sanitizeFileName } from '../../web/shared/youtube-names.ts';

export const API_PREFIX = '/api/youtube';

/**
 * Nombre por defecto del ZIP: «Playlist - <nombre de la playlist>»; si no tiene nombre,
 * «Playlist - <fecha de hoy>». Para enlaces sueltos: «Videos - <fecha de hoy>».
 */
export function defaultBatchName(esPlaylist: boolean, playlistTitulo: string | null, hoy: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const fecha = `${hoy.getFullYear()}-${pad(hoy.getMonth() + 1)}-${pad(hoy.getDate())}`;
  if (esPlaylist) return `Playlist - ${playlistTitulo ?? fecha}`;
  return `Videos - ${fecha}`;
}

const JSON_BODY_LIMIT = 4 * 1024;
const BATCH_BODY_LIMIT = 16 * 1024;
const BATCH_CACHE_MAX = 10;
/** Alturas máximas que se pueden elegir para un lote (la mejor disponible hasta ese límite). */
const CAP_HEIGHTS: readonly number[] = [144, 240, 360, 480, 720, 1080, 1440, 2160, 4320];
const ANALYSIS_TTL_MS = 15 * 60_000;
const ANALYSIS_CACHE_MAX = 50;
const ANALYSES_IN_FLIGHT_MAX = 2;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const JOB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const LIVE_STATUSES: ReadonlySet<string> = new Set(['is_live', 'is_upcoming', 'post_live']);

const MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  flac: 'audio/flac',
  zip: 'application/zip',
};

export interface YoutubeApi {
  /** Atiende la petición si es de este módulo. Devuelve false para cualquier otra ruta. */
  handle(req: IncomingMessage, res: ServerResponse): boolean;
  /** Prepara carpetas temporales y tareas de limpieza (síncrono: antes de atender peticiones). */
  init(): void;
  /** Cancela trabajos activos y borra temporales. */
  dispose(): Promise<void>;
  readonly config: YoutubeConfig;
}

interface CachedAnalysis {
  analysis: AnalysisResult;
  canonicalUrl: string;
  expiresAt: number;
}

export function createYoutubeApi(config: YoutubeConfig, now: () => number = Date.now): YoutubeApi {
  const jobs = new JobManager(config, now);
  const analyses = new Map<string, CachedAnalysis>();
  const batches = new Map<string, { analysis: BatchAnalysis; expiresAt: number }>();
  let analysesInFlight = 0;

  function sendJson(res: ServerResponse, status: number, body: unknown): void {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Length': Buffer.byteLength(text),
    });
    res.end(text);
  }

  function sendError(res: ServerResponse, status: number, message: string): void {
    sendJson(res, status, { error: message });
  }

  /** Solo hosts locales (o los configurados en ALLOWED_HOSTS) y mismo origen. */
  function isAllowedRequest(req: IncomingMessage): boolean {
    const hostHeader = req.headers.host ?? '';
    let hostname: string;
    try {
      hostname = new URL(`http://${hostHeader}`).hostname.toLowerCase();
    } catch {
      return false;
    }
    if (!config.allowedHosts.includes(hostname)) return false;

    const origin = req.headers.origin;
    if (origin !== undefined) {
      try {
        if (new URL(origin).host.toLowerCase() !== hostHeader.toLowerCase()) return false;
      } catch {
        return false;
      }
    }
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin' && site !== 'none') return false;
    return true;
  }

  function readJson(req: IncomingMessage, limit: number = JSON_BODY_LIMIT): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const type = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (type !== 'application/json') {
        reject(new YoutubeError(415, 'Se esperaba una petición JSON.'));
        return;
      }
      const declared = Number(req.headers['content-length'] ?? 0);
      if (declared > limit) {
        reject(new YoutubeError(413, 'La petición es demasiado grande.'));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      req.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > limit) {
          reject(new YoutubeError(413, 'La petición es demasiado grande.'));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
        } catch {
          reject(new YoutubeError(400, 'El cuerpo de la petición no es JSON válido.'));
        }
      });
      req.on('error', () => reject(new YoutubeError(400, 'No se pudo leer la petición.')));
    });
  }

  function toAnalysis(info: RawInfo, videoId: string, canonicalUrl: string): AnalysisResult {
    const formats = Array.isArray(info.formats) ? info.formats : [];
    const duration = typeof info.duration === 'number' && info.duration > 0 ? Math.round(info.duration) : null;
    const title = (info.title ?? '').trim() || 'Sin título';
    const sourceKbps = sourceAudioKbps(formats);
    const artist = typeof info.artist === 'string' && info.artist.trim() ? info.artist.trim() : null;
    const track = typeof info.track === 'string' && info.track.trim() ? info.track.trim() : null;
    const channel = (info.channel ?? info.uploader ?? '').trim() || null;
    return {
      videoId,
      url: canonicalUrl,
      titulo: title,
      duracionSegundos: duration,
      artistaSugerido: artist,
      tituloSugerido: track ?? title,
      canal: channel,
      fuenteAudioKbps: sourceKbps,
      video: buildVideoOptions(formats, duration),
      audio: buildAudioOptions(sourceKbps, duration),
    };
  }

  function requireEnabledAnalysis(videoId: string): CachedAnalysis {
    const cached = analyses.get(videoId);
    if (!cached || cached.expiresAt < now()) {
      analyses.delete(videoId);
      throw new YoutubeError(409, 'Volvé a analizar el enlace: el análisis anterior ya venció.');
    }
    return cached;
  }

  function validateJobRequest(body: unknown): JobSpec {
    if (typeof body !== 'object' || body === null) throw new YoutubeError(400, 'Datos de descarga no válidos.');
    const data = body as Partial<JobRequest>;
    if (typeof data.videoId !== 'string' || !VIDEO_ID.test(data.videoId)) {
      throw new YoutubeError(400, 'Identificador de video no válido.');
    }
    const videoId = data.videoId;
    const cached = requireEnabledAnalysis(videoId);
    const { analysis } = cached;

    if (data.tipo === 'video') {
      if (!isVideoContainer(data.contenedor)) throw new YoutubeError(400, 'Formato de video no admitido.');
      const option = analysis.video.find((v) => v.contenedor === data.contenedor);
      const height = data.altura;
      if (!option || typeof height !== 'number' || !option.alturas.includes(height)) {
        throw new YoutubeError(400, 'La calidad elegida no está disponible para este video.');
      }
      const container: VideoContainer = data.contenedor;
      const baseName = sanitizeFileName(
        typeof data.nombre === 'string' && data.nombre.trim() ? data.nombre : buildVideoName(analysis.canal, analysis.titulo),
      );
      return {
        tipo: 'video',
        canonicalUrl: cached.canonicalUrl,
        container,
        height,
        baseName,
      };
    }

    if (data.tipo === 'audio') {
      if (!isAudioFormat(data.formato)) throw new YoutubeError(400, 'Formato de audio no admitido.');
      const format: AudioFormat = data.formato;
      const option = analysis.audio.find((a) => a.formato === format);
      if (!option) throw new YoutubeError(400, 'Formato de audio no disponible.');
      let kbps: number | null = null;
      if (format === 'mp3' || format === 'm4a') {
        // Solo bitrates que el propio servidor ofreció para este origen (nunca por encima del origen).
        if (typeof data.kbps !== 'number' || !option.kbps.includes(data.kbps)) {
          throw new YoutubeError(400, 'La calidad elegida no está disponible para este audio.');
        }
        kbps = data.kbps;
      }
      const artist = typeof data.artista === 'string' ? data.artista.slice(0, 200) : '';
      const title = typeof data.titulo === 'string' ? data.titulo.slice(0, 200) : '';
      const finalTitle = title.trim() || analysis.tituloSugerido;
      return {
        tipo: 'audio',
        canonicalUrl: cached.canonicalUrl,
        format,
        kbps,
        baseName: buildAudioName(artist, finalTitle),
        title: finalTitle.trim(),
        artist: artist.trim(),
      };
    }
    throw new YoutubeError(400, 'Tipo de descarga no válido.');
  }

  function statusOf(job: Job): JobStatus {
    return {
      id: job.id,
      estado: job.estado,
      progreso: job.progreso === null ? null : Math.round(job.progreso),
      mensaje: job.mensaje,
      nombreArchivo: job.nombreArchivo,
      bytes: job.estado === 'listo' ? job.bytes : null,
      error: job.error,
      avisos: job.avisos,
    };
  }

  function contentDisposition(name: string): string {
    const ascii = name.replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');
    return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
  }

  async function handleAnalyze(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = (await readJson(req)) as { url?: unknown } | null;
    const check = parseYoutubeVideoUrl(body?.url);
    if (!check.ok) throw new YoutubeError(400, check.error);
    if (analysesInFlight >= ANALYSES_IN_FLIGHT_MAX) {
      throw new YoutubeError(429, 'Hay análisis en curso. Esperá un momento e intentá de nuevo.');
    }
    analysesInFlight += 1;
    let info: RawInfo;
    try {
      info = await fetchVideoInfo(config, check.canonicalUrl);
    } finally {
      analysesInFlight -= 1;
    }
    if ((info.live_status && LIVE_STATUSES.has(info.live_status)) || info.is_live === true) {
      throw new YoutubeError(422, 'Las transmisiones en vivo y los estrenos pendientes no se admiten.');
    }
    const analysis = toAnalysis(info, check.videoId, check.canonicalUrl);
    if (analysis.duracionSegundos !== null && analysis.duracionSegundos > config.maxDurationSeconds) {
      throw new YoutubeError(
        422,
        `El video supera la duración máxima permitida (${Math.round(config.maxDurationSeconds / 60)} minutos).`,
      );
    }
    if (analysis.video.length === 0 && analysis.audio.length === 0) {
      throw new YoutubeError(422, 'No se encontraron formatos descargables en este video.');
    }
    if (analyses.size >= ANALYSIS_CACHE_MAX) {
      const oldest = analyses.keys().next().value;
      if (oldest !== undefined) analyses.delete(oldest);
    }
    analyses.set(check.videoId, { analysis, canonicalUrl: check.canonicalUrl, expiresAt: now() + ANALYSIS_TTL_MS });
    sendJson(res, 200, { analisis: analysis });
  }

  async function handleCreateJob(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const spec = validateJobRequest(await readJson(req));
    const job = jobs.start(spec); // lanza 429 si ya se alcanzó el límite de procesos simultáneos
    sendJson(res, 202, { id: job.id, nombreArchivo: job.nombreArchivo });
  }

  /** Lista o enlaces: valida cada línea y devuelve los videos que sí se pueden descargar. */
  async function handleBatchAnalyze(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = (await readJson(req, BATCH_BODY_LIMIT)) as { texto?: unknown } | null;
    if (typeof body?.texto !== 'string' || body.texto.trim().length === 0) {
      throw new YoutubeError(400, 'Pegá una playlist o uno o más enlaces de video (uno por línea).');
    }
    if (analysesInFlight >= ANALYSES_IN_FLIGHT_MAX) {
      throw new YoutubeError(429, 'Hay análisis en curso. Esperá un momento e intentá de nuevo.');
    }
    analysesInFlight += 1;
    let result: Awaited<ReturnType<typeof expandSources>>;
    try {
      result = await expandSources(config, body.texto);
    } finally {
      analysesInFlight -= 1;
    }
    if (result.items.length === 0) {
      throw new YoutubeError(422, result.errores[0] ?? 'No se encontró ningún video descargable.');
    }
    const loteId = randomUUID();
    if (batches.size >= BATCH_CACHE_MAX) {
      const oldest = batches.keys().next().value;
      if (oldest !== undefined) batches.delete(oldest);
    }
    const analysis: BatchAnalysis = {
      loteId,
      playlistTitulo: result.playlistTitulo,
      esPlaylist: result.esPlaylist,
      items: result.items,
      omitidos: result.omitidos,
      errores: result.errores,
    };
    batches.set(loteId, { analysis, expiresAt: now() + ANALYSIS_TTL_MS });
    sendJson(res, 200, { analisis: analysis });
  }

  async function handleBatchJob(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = (await readJson(req)) as Partial<BatchJobRequest> | null;
    if (!body || typeof body.loteId !== 'string') throw new YoutubeError(400, 'Falta el análisis de la lista.');
    const cached = batches.get(body.loteId);
    if (!cached || cached.expiresAt < now()) {
      batches.delete(body.loteId);
      throw new YoutubeError(409, 'Volvé a analizar la lista: el análisis anterior ya venció.');
    }
    const available = new Map(cached.analysis.items.map((item) => [item.videoId, item]));
    const chosenIds = Array.isArray(body.seleccion) ? body.seleccion : [...available.keys()];
    const videos = chosenIds.map((id) => (typeof id === 'string' ? available.get(id) : undefined));
    if (videos.length === 0 || videos.some((video) => video === undefined)) {
      throw new YoutubeError(400, 'La selección contiene videos que no están en la lista analizada.');
    }
    const nombre =
      typeof body.nombre === 'string' && body.nombre.trim()
        ? body.nombre
        : defaultBatchName(cached.analysis.esPlaylist, cached.analysis.playlistTitulo, new Date());
    const baseName = sanitizeFileName(nombre);

    if (body.tipo === 'video') {
      if (!isVideoContainer(body.contenedor)) throw new YoutubeError(400, 'Formato de video no admitido.');
      if (body.altura !== undefined && !CAP_HEIGHTS.includes(body.altura)) {
        throw new YoutubeError(400, 'La calidad máxima elegida no está admitida.');
      }
      const job = jobs.start({
        tipo: 'lote',
        baseName,
        videos: videos as BatchItem[],
        mode: 'video',
        container: body.contenedor,
        maxHeight: body.altura,
      });
      sendJson(res, 202, { id: job.id, nombreArchivo: job.nombreArchivo });
      return;
    }

    if (body.tipo === 'audio') {
      if (!isAudioFormat(body.formato)) throw new YoutubeError(400, 'Formato de audio no admitido.');
      const hasBitrate = body.formato === 'mp3' || body.formato === 'm4a';
      if (hasBitrate && (typeof body.kbps !== 'number' || !AUDIO_BITRATE_STEPS.includes(body.kbps))) {
        throw new YoutubeError(400, 'La calidad de audio elegida no está admitida.');
      }
      const job = jobs.start({
        tipo: 'lote',
        baseName,
        videos: videos as BatchItem[],
        mode: 'audio',
        format: body.formato,
        maxKbps: hasBitrate ? (body.kbps as number) : null,
      });
      sendJson(res, 202, { id: job.id, nombreArchivo: job.nombreArchivo });
      return;
    }
    throw new YoutubeError(400, 'Tipo de descarga no válido.');
  }

  async function handleFile(job: Job, res: ServerResponse): Promise<void> {
    if (job.estado !== 'listo' || !job.filePath) throw new YoutubeError(409, 'El archivo todavía no está listo.');
    const info = await stat(job.filePath);
    if (!info.isFile() || info.size === 0) throw new YoutubeError(500, 'El archivo final no está disponible.');
    const extension = job.extension.toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[extension] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Content-Disposition': contentDisposition(job.nombreArchivo),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    // El archivo se conserva hasta YOUTUBE_RESULT_TTL_MINUTES para poder guardarlo otra vez;
    // lo borra la limpieza periódica (o DELETE, o al cerrar el servidor).
    const stream = createReadStream(job.filePath);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }

  function dispatch(req: IncomingMessage, res: ServerResponse, method: string, path: string): Promise<void> | void {
    const rest = path.slice(API_PREFIX.length); // "", "/estado", "/trabajos/<id>", ...

    if (rest === '/estado') {
      if (method !== 'GET') throw new YoutubeError(405, 'Método no permitido.');
      const payload: StatusResponse = config.enabled
        ? {
            habilitado: true,
            limites: {
              duracionMaximaMinutos: Math.round(config.maxDurationSeconds / 60),
              tamanoMaximoMb: Math.round(config.maxFilesizeBytes / (1024 * 1024)),
              trabajosSimultaneos: config.maxConcurrentJobs,
            },
          }
        : { habilitado: false, limites: null };
      sendJson(res, 200, payload);
      return;
    }

    if (!config.enabled) {
      // Descargas deshabilitadas (producción): ninguna ruta de descarga hace nada.
      throw new YoutubeError(404, 'Las descargas de YouTube están deshabilitadas en este entorno.');
    }

    if (rest === '/lote/analizar') {
      if (method !== 'POST') throw new YoutubeError(405, 'Método no permitido.');
      return handleBatchAnalyze(req, res);
    }
    if (rest === '/lote/trabajos') {
      if (method !== 'POST') throw new YoutubeError(405, 'Método no permitido.');
      return handleBatchJob(req, res);
    }
    if (rest === '/analizar') {
      if (method !== 'POST') throw new YoutubeError(405, 'Método no permitido.');
      return handleAnalyze(req, res);
    }
    if (rest === '/trabajos') {
      if (method !== 'POST') throw new YoutubeError(405, 'Método no permitido.');
      return handleCreateJob(req, res);
    }

    const match = /^\/trabajos\/([^/]+)(\/archivo)?$/.exec(rest);
    if (match) {
      const id = match[1];
      if (!JOB_ID.test(id)) throw new YoutubeError(404, 'Trabajo no encontrado.');
      const job = jobs.get(id);
      if (!job) throw new YoutubeError(404, 'Trabajo no encontrado.');
      if (match[2]) {
        if (method !== 'GET') throw new YoutubeError(405, 'Método no permitido.');
        return handleFile(job, res);
      }
      if (method === 'GET') {
        sendJson(res, 200, statusOf(job));
        return;
      }
      if (method === 'DELETE') {
        void jobs.release(id);
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      throw new YoutubeError(405, 'Método no permitido.');
    }

    throw new YoutubeError(404, 'Ruta no encontrada.');
  }

  return {
    config,
    init: () => jobs.init(),
    dispose: () => jobs.dispose(),
    handle(req, res) {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;
      if (path !== API_PREFIX && !path.startsWith(`${API_PREFIX}/`)) return false;

      if (!isAllowedRequest(req)) {
        sendError(res, 403, 'Solicitud rechazada: host u origen no permitido.');
        return true;
      }
      try {
        const result = dispatch(req, res, req.method ?? 'GET', path);
        if (result instanceof Promise) {
          result.catch((err: unknown) => fail(res, err));
        }
      } catch (err) {
        fail(res, err);
      }
      return true;
    },
  };

  function fail(res: ServerResponse, err: unknown): void {
    if (res.headersSent) {
      res.destroy();
      return;
    }
    if (err instanceof YoutubeError) {
      sendError(res, err.status, err.message);
      return;
    }
    // Detalle técnico solo en el registro del servidor, nunca en la respuesta.
    console.error('[youtube] error interno:', err instanceof Error ? err.name : 'desconocido');
    sendError(res, 500, 'Ocurrió un error inesperado.');
  }
}

/** Carga la configuración desde variables de entorno y crea el manejador. */
export function createYoutubeApiFromEnv(env: Record<string, string | undefined>): YoutubeApi {
  return createYoutubeApi(loadYoutubeConfig(env));
}
