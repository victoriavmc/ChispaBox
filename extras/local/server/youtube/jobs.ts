/*
 * Gestor de trabajos de descarga: límite de procesos simultáneos, tiempo máximo por trabajo,
 * cancelación, verificación del archivo final y limpieza de temporales.
 *
 * Cada trabajo usa una carpeta propia cuyo nombre es un UUID generado aquí; el usuario nunca
 * elige rutas. El archivo final se guarda en <trabajo>/salida/<nombre seguro>.<extensión>.
 */
import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync } from 'node:fs';
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { YoutubeConfig } from './config.ts';
import { describeYtDlpFailure, YoutubeError } from './errors.ts';
import { probeFile, startAudioConversion } from './ffmpeg.ts';
import { startAudioDownload, startVideoDownload } from './ytdlp.ts';
import { runBatch, type BatchRequest } from './batch.ts';
import type { ProcessHandle } from './process.ts';
import type { AudioFormat, JobState, JobType, VideoContainer } from '../../web/shared/youtube-types.ts';
import { withExtension } from '../../web/shared/youtube-names.ts';

export interface VideoJobSpec {
  tipo: 'video';
  canonicalUrl: string;
  container: VideoContainer;
  height: number;
  baseName: string;
}

export interface AudioJobSpec {
  tipo: 'audio';
  canonicalUrl: string;
  format: AudioFormat;
  kbps: number | null;
  baseName: string;
  title: string;
  artist: string;
}

/** Lote: varios videos que se guardan en un único ZIP. */
export interface BatchJobSpec extends Omit<BatchRequest, 'zipName'> {
  tipo: 'lote';
  /** Nombre del ZIP sin extensión (igual que baseName en las demás descargas). */
  baseName: string;
}

export type JobSpec = VideoJobSpec | AudioJobSpec | BatchJobSpec;

export interface Job {
  id: string;
  tipo: JobType;
  estado: JobState;
  progreso: number | null;
  mensaje: string;
  nombreArchivo: string;
  extension: string;
  filePath: string | null;
  bytes: number | null;
  error: string | null;
  /** Avisos por video (lotes): los que se omitieron y por qué. */
  avisos: string[];
  dir: string;
  createdAt: number;
  finishedAt: number | null;
  process: ProcessHandle | null;
  cancelRequested: boolean;
}

const ACTIVE: ReadonlySet<JobState> = new Set<JobState>(['en_cola', 'descargando', 'procesando']);
const SWEEP_INTERVAL_MS = 60_000;

/** Borra una carpeta de trabajo. Best effort: en Windows un antivirus puede retener un archivo unos instantes. */
async function removeDir(dir: string): Promise<void> {
  try {
    await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  } catch {
    // Se reintenta al cerrar el servidor (dispose) o al arrancar (init).
  }
}

const AUDIO_EXTENSION: Record<AudioFormat, string> = { mp3: 'mp3', m4a: 'm4a', wav: 'wav', flac: 'flac' };

export class JobManager {
  private readonly config: YoutubeConfig;
  private readonly jobs = new Map<string, Job>();
  private readonly now: () => number;
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(config: YoutubeConfig, now: () => number = Date.now) {
    this.config = config;
    this.now = now;
  }

  /** Prepara la carpeta temporal (se vacía al arrancar: no quedan restos de ejecuciones previas). */
  init(): void {
    rmSync(this.config.tempDir, { recursive: true, force: true });
    mkdirSync(this.config.tempDir, { recursive: true, mode: 0o700 });
    this.sweeper = setInterval(() => {
      void this.sweep();
    }, SWEEP_INTERVAL_MS);
    this.sweeper.unref();
  }

  activeCount(): number {
    let count = 0;
    for (const job of this.jobs.values()) if (ACTIVE.has(job.estado)) count += 1;
    return count;
  }

  get(id: string): Job | undefined {
    return this.jobs.get(id);
  }

  /** Crea y lanza un trabajo. Falla con 429 si ya hay el máximo de procesos simultáneos. */
  start(spec: JobSpec): Job {
    if (this.activeCount() >= this.config.maxConcurrentJobs) {
      throw new YoutubeError(429, 'Ya hay descargas en curso. Esperá a que termine una antes de empezar otra.');
    }
    const id = randomUUID();
    const extension = spec.tipo === 'video' ? spec.container : spec.tipo === 'audio' ? AUDIO_EXTENSION[spec.format] : 'zip';
    const job: Job = {
      id,
      tipo: spec.tipo,
      estado: 'descargando',
      progreso: 0,
      mensaje: 'Iniciando la descarga…',
      nombreArchivo: withExtension(spec.baseName, extension),
      extension,
      filePath: null,
      bytes: null,
      error: null,
      avisos: [],
      dir: join(this.config.tempDir, id),
      createdAt: this.now(),
      finishedAt: null,
      process: null,
      cancelRequested: false,
    };
    this.jobs.set(id, job);
    void this.run(job, spec);
    return job;
  }

  /** Cancela un trabajo activo. Devuelve false si no existe. */
  cancel(id: string): boolean {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (ACTIVE.has(job.estado)) {
      job.cancelRequested = true;
      job.process?.cancel();
    }
    return true;
  }

  /**
   * Retira un trabajo: detiene su proceso, espera a que termine y borra sus archivos.
   * Esperar al proceso evita borrar carpetas que aún están abiertas (en Windows darían EBUSY).
   */
  async release(id: string): Promise<void> {
    const job = this.jobs.get(id);
    if (!job) return;
    this.jobs.delete(id);
    const handle = job.process;
    if (ACTIVE.has(job.estado)) job.cancelRequested = true;
    handle?.cancel();
    if (handle) await handle.result.catch(() => undefined);
    await removeDir(job.dir);
  }

  /** Cierra todos los trabajos y borra la carpeta temporal (al detener el servidor). */
  async dispose(): Promise<void> {
    if (this.sweeper) clearInterval(this.sweeper);
    const ids = [...this.jobs.keys()];
    await Promise.all(ids.map((id) => this.release(id)));
    await removeDir(this.config.tempDir);
  }

  /** Elimina trabajos terminados cuyo plazo de descarga ya venció. */
  async sweep(): Promise<void> {
    const cutoff = this.now() - this.config.resultTtlMs;
    const expired = [...this.jobs.values()].filter(
      (job) => !ACTIVE.has(job.estado) && (job.finishedAt ?? job.createdAt) < cutoff,
    );
    for (const job of expired) await this.release(job.id);
  }

  private update(job: Job, patch: Partial<Job>): void {
    Object.assign(job, patch);
  }

  private fail(job: Job, message: string): void {
    this.update(job, { estado: 'error', error: message, mensaje: message, progreso: null, finishedAt: this.now(), process: null });
  }

  private async run(job: Job, spec: JobSpec): Promise<void> {
    const deadline = this.now() + this.config.jobTimeoutMs;
    const remaining = (): number => Math.max(1000, deadline - this.now());
    try {
      await mkdir(job.dir, { recursive: true, mode: 0o700 });
      await mkdir(join(job.dir, 'salida'), { recursive: true, mode: 0o700 });
      if (spec.tipo === 'video') {
        await this.runVideo(job, spec, remaining);
      } else if (spec.tipo === 'audio') {
        await this.runAudio(job, spec, remaining);
      } else {
        await this.runLote(job, spec);
      }
    } catch (err) {
      if (job.cancelRequested) {
        this.update(job, { estado: 'cancelado', mensaje: 'Descarga cancelada.', progreso: null, finishedAt: this.now(), process: null });
      } else {
        this.fail(job, err instanceof YoutubeError ? err.message : 'No se pudo completar la descarga.');
        // Registro sin contenido ni rutas: solo el tipo de fallo.
        console.error('[youtube] trabajo con error:', err instanceof YoutubeError ? err.status : 'interno');
      }
    }
  }

  private async runVideo(job: Job, spec: VideoJobSpec, remaining: () => number): Promise<void> {
    const handle = startVideoDownload(this.config, {
      canonicalUrl: spec.canonicalUrl,
      container: spec.container,
      height: spec.height,
      outputDir: job.dir,
      maxFilesizeBytes: this.config.maxFilesizeBytes,
      timeoutMs: remaining(),
      onProgress: (percent, phase) => {
        if (phase === 'combinando') {
          this.update(job, { estado: 'procesando', progreso: 90, mensaje: 'Combinando audio y video…' });
        } else {
          this.update(job, { progreso: percent === null ? job.progreso : Math.round(percent * 0.85), mensaje: 'Descargando desde YouTube…' });
        }
      },
    });
    this.update(job, { process: handle });
    const result = await handle.result;
    this.update(job, { process: null });
    if (job.cancelRequested) throw new YoutubeError(499, 'cancelado');
    if (result.spawnError) throw new YoutubeError(503, 'El descargador no está disponible en este servidor.');
    if (result.code !== 0 || result.timedOut) {
      throw new YoutubeError(422, describeYtDlpFailure(result.stderr, result.timedOut));
    }

    const produced = await this.findMedia(job.dir);
    if (!produced) throw new YoutubeError(500, 'No se generó el archivo de video.');
    this.update(job, { estado: 'procesando', progreso: 95, mensaje: 'Verificando el archivo…' });
    const probe = await probeFile(this.config, produced);
    if (!probe.hasVideo || probe.durationSeconds === null) {
      throw new YoutubeError(500, 'El archivo de video generado no es válido.');
    }
    await this.publish(job, produced);
  }

  private async runAudio(job: Job, spec: AudioJobSpec, remaining: () => number): Promise<void> {
    const handle = startAudioDownload(this.config, {
      canonicalUrl: spec.canonicalUrl,
      outputDir: job.dir,
      maxFilesizeBytes: this.config.maxFilesizeBytes,
      timeoutMs: remaining(),
      onProgress: (percent) => {
        this.update(job, { progreso: percent === null ? job.progreso : Math.round(percent * 0.8), mensaje: 'Descargando audio desde YouTube…' });
      },
    });
    this.update(job, { process: handle });
    const result = await handle.result;
    this.update(job, { process: null });
    if (job.cancelRequested) throw new YoutubeError(499, 'cancelado');
    if (result.spawnError) throw new YoutubeError(503, 'El descargador no está disponible en este servidor.');
    if (result.code !== 0 || result.timedOut) {
      throw new YoutubeError(422, describeYtDlpFailure(result.stderr, result.timedOut));
    }

    const source = await this.findMedia(job.dir);
    if (!source) throw new YoutubeError(500, 'No se generó el archivo de audio.');
    const sourceProbe = await probeFile(this.config, source);
    if (!sourceProbe.hasAudio) throw new YoutubeError(500, 'El origen no contiene audio.');

    const outputPath = join(job.dir, 'salida', `conversion.${job.extension}`);
    this.update(job, { estado: 'procesando', progreso: 80, mensaje: 'Convirtiendo el audio…' });
    const conversion = startAudioConversion(this.config, {
      inputPath: source,
      outputPath,
      format: spec.format,
      kbps: spec.kbps,
      title: spec.title,
      artist: spec.artist,
      sourceDurationSeconds: sourceProbe.durationSeconds,
      timeoutMs: remaining(),
      onProgress: (percent) => {
        this.update(job, { progreso: 80 + Math.round(percent * 0.18) });
      },
    });
    this.update(job, { process: conversion });
    const converted = await conversion.result;
    this.update(job, { process: null });
    if (job.cancelRequested) throw new YoutubeError(499, 'cancelado');
    if (converted.spawnError) throw new YoutubeError(503, 'El conversor de audio no está disponible en este servidor.');
    if (converted.code !== 0 || converted.timedOut) throw new YoutubeError(500, 'Falló la conversión del audio.');

    this.update(job, { estado: 'procesando', progreso: 99, mensaje: 'Verificando el archivo…' });
    const outProbe = await probeFile(this.config, outputPath);
    if (!outProbe.hasAudio || outProbe.durationSeconds === null) {
      throw new YoutubeError(500, 'El archivo de audio generado no es válido.');
    }
    await this.publish(job, outputPath);
  }

  /** Lote: descarga cada video (omitiendo los que fallan) y publica el ZIP con los correctos. */
  private async runLote(job: Job, spec: BatchJobSpec): Promise<void> {
    const deadline = this.now() + this.config.batchTimeoutMs;
    const outcome = await runBatch(
      this.config,
      {
        videos: spec.videos,
        mode: spec.mode,
        container: spec.container,
        maxHeight: spec.maxHeight,
        format: spec.format,
        maxKbps: spec.maxKbps,
        zipName: spec.baseName,
      },
      {
        dir: job.dir,
        isCancelled: () => job.cancelRequested,
        setProcess: (handle) => {
          job.process = handle;
        },
        progress: (percent, message) => {
          this.update(job, { estado: 'descargando', progreso: Math.round(percent), mensaje: message });
        },
        deadline,
        now: () => this.now(),
      },
    );
    this.update(job, { estado: 'procesando', progreso: 95, mensaje: 'Verificando el ZIP…' });
    await this.publish(job, outcome.zipPath);
    const total = spec.videos.length;
    const omitted = outcome.skipped.length;
    const sustantivo = spec.mode === 'audio' ? 'audios' : 'videos';
    this.update(job, {
      mensaje: omitted === 0
        ? `ZIP listo: ${outcome.ok} de ${total} ${sustantivo}.`
        : `ZIP listo: ${outcome.ok} de ${total} ${sustantivo}. Se omitieron ${omitted}.`,
      avisos: outcome.skipped.map((item) => `${item.titulo}: ${item.motivo}`),
    });
  }

  /** Mueve el archivo final a su nombre seguro, comprueba tamaño y deja el trabajo listo. */
  private async publish(job: Job, producedPath: string): Promise<void> {
    const finalPath = join(job.dir, 'salida', job.nombreArchivo);
    if (producedPath !== finalPath) await rename(producedPath, finalPath);
    const info = await stat(finalPath);
    if (!info.isFile() || info.size === 0) throw new YoutubeError(500, 'El archivo final está vacío.');
    if (info.size > this.config.maxFilesizeBytes) throw new YoutubeError(413, 'El archivo supera el tamaño máximo permitido.');
    this.update(job, {
      estado: 'listo',
      progreso: 100,
      mensaje: 'Archivo listo para guardar.',
      filePath: finalPath,
      bytes: info.size,
      finishedAt: this.now(),
      process: null,
    });
  }

  /** Busca el archivo media.* producido por yt-dlp en la carpeta del trabajo. */
  private async findMedia(dir: string): Promise<string | null> {
    const entries = await readdir(dir);
    const match = entries.find((name) => /^media\.(mp4|webm|mkv|m4a|mp3|opus|ogg|weba|aac|wav|flac|mka)$/i.test(name));
    return match ? join(dir, match) : null;
  }
}
