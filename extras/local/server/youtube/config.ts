/*
 * Configuración del módulo de descargas de YouTube, leída solo de variables de entorno.
 * Ningún host, puerto ni ruta de herramienta está fijado en el código.
 *
 * Valores por defecto seguros:
 * - Descargas habilitadas solo fuera de producción (NODE_ENV distinto de "production").
 *   Un valor de YOUTUBE_DOWNLOADS_ENABLED no reconocido se trata como "false".
 * - Acceso al API solo para nombres de host locales (localhost, 127.0.0.1, [::1]).
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type Env = Record<string, string | undefined>;

export interface YoutubeConfig {
  enabled: boolean;
  host: string;
  port: number;
  /** Nombres de host (sin puerto) que acepta el API en la cabecera Host y Origin. */
  allowedHosts: readonly string[];
  ytDlpPath: string;
  ffmpegPath: string;
  ffprobePath: string;
  tempDir: string;
  maxConcurrentJobs: number;
  maxDurationSeconds: number;
  maxFilesizeBytes: number;
  jobTimeoutMs: number;
  resultTtlMs: number;
  /** Videos máximos por lista o conjunto de enlaces. */
  maxBatchItems: number;
  /** Tiempo máximo de un lote completo (ms). */
  batchTimeoutMs: number;
  /** Advertencias de configuración (valores no válidos), para mostrarlas al arrancar. */
  warnings: readonly string[];
}

const DEFAULT_ALLOWED_HOSTS = ['localhost', '127.0.0.1', '[::1]'] as const;

function parseBoolean(raw: string | undefined, fallback: boolean, warnings: string[]): boolean {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = raw.trim().toLowerCase();
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  warnings.push(`YOUTUBE_DOWNLOADS_ENABLED="${raw}" no es válido; se usa "false" (cerrado por seguridad).`);
  return false;
}

function parseIntegerInRange(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  name: string,
  warnings: string[],
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < min || value > max) {
    warnings.push(`${name}="${raw}" fuera de rango (${min}–${max}); se usa ${fallback}.`);
    return fallback;
  }
  return value;
}

function parseList(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return [...DEFAULT_ALLOWED_HOSTS];
  return raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
}

function optionalPath(raw: string | undefined, fallback: string): string {
  const value = raw?.trim();
  return value ? value : fallback;
}

export function loadYoutubeConfig(env: Env): YoutubeConfig {
  const warnings: string[] = [];
  const isProduction = env.NODE_ENV === 'production';

  return {
    enabled: parseBoolean(env.YOUTUBE_DOWNLOADS_ENABLED, !isProduction, warnings),
    host: optionalPath(env.API_HOST, '127.0.0.1'),
    port: parseIntegerInRange(env.API_PORT, 5174, 1, 65535, 'API_PORT', warnings),
    allowedHosts: parseList(env.ALLOWED_HOSTS),
    ytDlpPath: optionalPath(env.YTDLP_PATH, 'yt-dlp'),
    ffmpegPath: optionalPath(env.FFMPEG_PATH, 'ffmpeg'),
    ffprobePath: optionalPath(env.FFPROBE_PATH, 'ffprobe'),
    tempDir: optionalPath(env.YOUTUBE_TEMP_DIR, join(tmpdir(), 'chispabox-yt')),
    maxConcurrentJobs: parseIntegerInRange(env.YOUTUBE_MAX_CONCURRENT_JOBS, 2, 1, 8, 'YOUTUBE_MAX_CONCURRENT_JOBS', warnings),
    maxDurationSeconds:
      parseIntegerInRange(env.YOUTUBE_MAX_MINUTES, 120, 1, 600, 'YOUTUBE_MAX_MINUTES', warnings) * 60,
    maxFilesizeBytes:
      parseIntegerInRange(env.YOUTUBE_MAX_FILESIZE_MB, 2048, 1, 10240, 'YOUTUBE_MAX_FILESIZE_MB', warnings) * 1024 * 1024,
    jobTimeoutMs:
      parseIntegerInRange(env.YOUTUBE_JOB_TIMEOUT_MINUTES, 30, 1, 240, 'YOUTUBE_JOB_TIMEOUT_MINUTES', warnings) * 60_000,
    resultTtlMs:
      parseIntegerInRange(env.YOUTUBE_RESULT_TTL_MINUTES, 10, 1, 120, 'YOUTUBE_RESULT_TTL_MINUTES', warnings) * 60_000,
    maxBatchItems: parseIntegerInRange(env.YOUTUBE_MAX_BATCH_ITEMS, 50, 1, 200, 'YOUTUBE_MAX_BATCH_ITEMS', warnings),
    batchTimeoutMs:
      parseIntegerInRange(env.YOUTUBE_BATCH_TIMEOUT_MINUTES, 240, 1, 720, 'YOUTUBE_BATCH_TIMEOUT_MINUTES', warnings) * 60_000,
    warnings,
  };
}
