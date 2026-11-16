/*
 * Procesamiento de un lote: descarga cada video con la mejor calidad disponible hasta el
 * límite elegido (o el mejor audio sin superar el origen), lo verifica y, al final, guarda
 * todos los archivos correctos en un único ZIP. Los videos que fallan se omiten y se informa
 * el motivo de cada uno; no detienen al resto del lote.
 */
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { YoutubeConfig } from './config.ts';
import { describeYtDlpFailure, YoutubeError } from './errors.ts';
import { probeFile, startAudioConversion } from './ffmpeg.ts';
import { buildAudioOptions, buildVideoOptions, sourceAudioKbps, type RawFormat } from './formats.ts';
import { type ProcessHandle } from './process.ts';
import { writeStoredZip, type ZipEntry } from './zip.ts';
import { fetchVideoInfo, startAudioDownload, startVideoDownload, type RawInfo } from './ytdlp.ts';
import { buildVideoName, sanitizeFileName, withExtension } from '../../web/shared/youtube-names.ts';
import type { AudioFormat, VideoContainer } from '../../web/shared/youtube-types.ts';

export interface BatchVideo {
  videoId: string;
  url: string;
  titulo: string;
  canal: string | null;
}

export interface BatchRequest {
  videos: BatchVideo[];
  mode: 'video' | 'audio';
  container?: VideoContainer;
  maxHeight?: number;
  format?: AudioFormat;
  maxKbps?: number | null;
  zipName: string;
}

export interface BatchHooks {
  /** Carpeta del trabajo: aquí se crean las carpetas por video y el ZIP. */
  dir: string;
  isCancelled(): boolean;
  setProcess(handle: ProcessHandle | null): void;
  progress(percent: number, message: string): void;
  deadline: number;
  now(): number;
}

export interface BatchOutcome {
  zipPath: string;
  bytes: number;
  ok: number;
  skipped: Array<{ titulo: string; motivo: string }>;
}

const UNKNOWN_FAILURE = 'No se pudo procesar este video.';

async function findMedia(dir: string): Promise<string | null> {
  const names = await readdir(dir);
  const match = names.find((name) => /^media\.(mp4|webm|mkv|m4a|mp3|opus|ogg|weba|aac|wav|flac|mka)$/i.test(name));
  return match ? join(dir, match) : null;
}

function assertNotLive(info: RawInfo): void {
  if ((info.live_status && ['is_live', 'is_upcoming', 'post_live'].includes(info.live_status)) || info.is_live === true) {
    throw new YoutubeError(422, 'Las transmisiones en vivo no se admiten.');
  }
}

function durationOf(info: RawInfo): number | null {
  return typeof info.duration === 'number' && info.duration > 0 ? Math.round(info.duration) : null;
}

/** Procesa un video del lote y devuelve la ruta del archivo final verificado. */
async function processVideo(
  config: YoutubeConfig,
  req: BatchRequest,
  video: BatchVideo,
  itemDir: string,
  hooks: BatchHooks,
  report: (percent: number) => void,
): Promise<{ path: string; name: string }> {
  const info = await fetchVideoInfo(config, video.url);
  assertNotLive(info);
  const duration = durationOf(info);
  if (duration !== null && duration > config.maxDurationSeconds) {
    throw new YoutubeError(422, `supera la duración máxima de ${Math.round(config.maxDurationSeconds / 60)} minutos.`);
  }
  const formats: RawFormat[] = info.formats ?? [];
  const channel = (info.channel ?? info.uploader ?? '').trim() || video.canal;
  const title = (info.title ?? '').trim() || video.titulo;
  const remaining = (): number => Math.max(1000, hooks.deadline - hooks.now());
  const check = (): void => {
    if (hooks.isCancelled()) throw new YoutubeError(499, 'cancelado');
    if (hooks.now() > hooks.deadline) throw new YoutubeError(504, 'Se superó el tiempo máximo del lote.');
  };
  await mkdir(join(itemDir, 'salida'), { recursive: true, mode: 0o700 });

  if (req.mode === 'video') {
    const container = req.container as VideoContainer;
    const option = buildVideoOptions(formats, duration).find((o) => o.contenedor === container);
    const height = option?.alturas.find((h) => req.maxHeight === undefined || h <= req.maxHeight);
    if (height === undefined) {
      throw new YoutubeError(422, `no tiene calidad ${container.toUpperCase()} hasta ${req.maxHeight}p.`);
    }
    check();
    const handle = startVideoDownload(config, {
      canonicalUrl: video.url,
      container,
      height,
      outputDir: itemDir,
      maxFilesizeBytes: config.maxFilesizeBytes,
      timeoutMs: remaining(),
      onProgress: (percent) => report(((percent ?? 0) * 0.85) / 100),
    });
    hooks.setProcess(handle);
    const result = await handle.result;
    hooks.setProcess(null);
    check();
    if (result.spawnError) throw new YoutubeError(503, 'El descargador no está disponible en este servidor.');
    if (result.code !== 0 || result.timedOut) throw new YoutubeError(422, describeYtDlpFailure(result.stderr, result.timedOut));

    const produced = await findMedia(itemDir);
    if (!produced) throw new YoutubeError(500, 'No se generó el archivo de video.');
    const probe = await probeFile(config, produced);
    if (!probe.hasVideo || probe.durationSeconds === null) throw new YoutubeError(500, 'El video generado no es válido.');
    const name = withExtension(buildVideoName(channel, title), container);
    const finalPath = join(itemDir, 'salida', sanitizeFileName(name));
    await rename(produced, finalPath);
    return { path: finalPath, name: sanitizeFileName(name) };
  }

  // Audio: el bitrate elegido se baja al máximo permitido por el origen de ese video.
  const format = req.format as AudioFormat;
  const sourceKbps = sourceAudioKbps(formats);
  const option = buildAudioOptions(sourceKbps, duration).find((a) => a.formato === format);
  let kbps: number | null = null;
  if (format === 'mp3' || format === 'm4a') {
    const allowed = (option?.kbps ?? []).filter((k) => req.maxKbps === undefined || req.maxKbps === null || k <= req.maxKbps);
    if (allowed.length === 0) throw new YoutubeError(422, `no tiene un bitrate de ${format.toUpperCase()} dentro del límite.`);
    kbps = allowed[0];
  }
  check();
  const handle = startAudioDownload(config, {
    canonicalUrl: video.url,
    outputDir: itemDir,
    maxFilesizeBytes: config.maxFilesizeBytes,
    timeoutMs: remaining(),
    onProgress: (percent) => report(((percent ?? 0) * 0.5) / 100),
  });
  hooks.setProcess(handle);
  const result = await handle.result;
  hooks.setProcess(null);
  check();
  if (result.spawnError) throw new YoutubeError(503, 'El descargador no está disponible en este servidor.');
  if (result.code !== 0 || result.timedOut) throw new YoutubeError(422, describeYtDlpFailure(result.stderr, result.timedOut));

  const source = await findMedia(itemDir);
  if (!source) throw new YoutubeError(500, 'No se generó el archivo de audio.');
  const sourceProbe = await probeFile(config, source);
  if (!sourceProbe.hasAudio) throw new YoutubeError(500, 'El origen no contiene audio.');

  const artist = (info.artist ?? '').trim() || channel || '';
  const trackTitle = (info.track ?? '').trim() || title;
  // En lotes el nombre es siempre «Canal - Título»; artista y pista solo van como etiquetas del archivo.
  const name = buildVideoName(channel, title);
  const finalPath = join(itemDir, 'salida', withExtension(sanitizeFileName(name), format));
  const conversion = startAudioConversion(config, {
    inputPath: source,
    outputPath: finalPath,
    format,
    kbps,
    title: trackTitle,
    artist,
    sourceDurationSeconds: sourceProbe.durationSeconds,
    timeoutMs: remaining(),
    onProgress: (percent) => report(0.5 + (percent * 0.5) / 100),
  });
  hooks.setProcess(conversion);
  const converted = await conversion.result;
  hooks.setProcess(null);
  check();
  if (converted.spawnError) throw new YoutubeError(503, 'El conversor de audio no está disponible en este servidor.');
  if (converted.code !== 0 || converted.timedOut) throw new YoutubeError(500, 'Falló la conversión del audio.');
  const outProbe = await probeFile(config, finalPath);
  if (!outProbe.hasAudio || outProbe.durationSeconds === null) {
    throw new YoutubeError(500, 'El audio generado no es válido.');
  }
  return { path: finalPath, name: withExtension(sanitizeFileName(name), format) };
}

/** Ejecuta el lote completo y devuelve el ZIP con los archivos que sí se completaron. */
/** Texto de progreso de un elemento: dice «Audio» o «Video» según lo que se descarga. */
export function etiquetaElemento(mode: 'video' | 'audio', index: number, total: number, titulo: string): string {
  return `${mode === 'audio' ? 'Audio' : 'Video'} ${index + 1} de ${total}: ${titulo}`;
}

export async function runBatch(config: YoutubeConfig, req: BatchRequest, hooks: BatchHooks): Promise<BatchOutcome> {
  const total = req.videos.length;
  const finished: Array<{ path: string; name: string }> = [];
  const skipped: Array<{ titulo: string; motivo: string }> = [];

  for (let index = 0; index < total; index += 1) {
    const video = req.videos[index];
    if (hooks.isCancelled()) throw new YoutubeError(499, 'cancelado');
    const base = (index / total) * 90;
    const span = 90 / total;
    hooks.progress(base, etiquetaElemento(req.mode, index, total, video.titulo));
    const itemDir = join(hooks.dir, `item-${index}`);
    try {
      const done = await processVideo(config, req, video, itemDir, hooks, (fraction) => {
        hooks.progress(base + fraction * span, etiquetaElemento(req.mode, index, total, video.titulo));
      });
      finished.push(done);
    } catch (err) {
      if (hooks.isCancelled() || (err instanceof YoutubeError && err.status === 499)) throw new YoutubeError(499, 'cancelado');
      skipped.push({
        titulo: video.titulo,
        motivo: err instanceof YoutubeError ? err.message : UNKNOWN_FAILURE,
      });
    }
  }

  if (finished.length === 0) {
    const first = skipped[0]?.motivo ?? 'ningún video se pudo procesar.';
    throw new YoutubeError(422, `Ningún video del lote se pudo descargar. Motivo principal: ${first}`);
  }

  hooks.progress(92, 'Armando el ZIP…');
  const used = new Set<string>();
  const entries: ZipEntry[] = finished.map((file) => {
    let name = file.name;
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let counter = 2;
    while (used.has(name.toLowerCase())) {
      name = `${stem} (${counter})${ext}`;
      counter += 1;
    }
    used.add(name.toLowerCase());
    return { name, path: file.path };
  });

  const zipPath = join(hooks.dir, 'salida', withExtension(sanitizeFileName(req.zipName), 'zip'));
  await mkdir(join(hooks.dir, 'salida'), { recursive: true, mode: 0o700 });
  const bytes = await writeStoredZip(zipPath, entries);

  // Libera espacio: los archivos sueltos ya están dentro del ZIP.
  for (let index = 0; index < total; index += 1) {
    await rm(join(hooks.dir, `item-${index}`), { recursive: true, force: true });
  }
  const zipInfo = await stat(zipPath);
  if (zipInfo.size !== bytes) throw new YoutubeError(500, 'El ZIP generado no coincide con lo escrito.');
  return { zipPath, bytes, ok: finished.length, skipped };
}
