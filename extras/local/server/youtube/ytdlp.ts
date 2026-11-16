/*
 * Adaptador de yt-dlp: solo metadatos y descarga de un único video ya validado.
 *
 * Reglas de seguridad aplicadas en cada llamada:
 * - --ignore-config, --no-update y --no-plugin-dirs: nada se carga desde disco ni de la red.
 * - No se usan cookies ni perfiles de navegador (RG-05).
 * - --use-extractors youtube: ningún otro extractor (evita SSRF hacia hosts arbitrarios).
 * - --no-playlist y URL canónica: nunca se descargan listas ni canales.
 * - Los argumentos son una lista fija; el único dato variable es un ID de video validado.
 */
import { sep } from 'node:path';
import { startProcess, type ProcessHandle, type ProcessResult } from './process.ts';
import { describeYtDlpFailure, YoutubeError } from './errors.ts';
import type { YoutubeConfig } from './config.ts';
import type { RawFormat } from './formats.ts';
import type { VideoContainer } from '../../web/shared/youtube-types.ts';

export interface RawInfo {
  id?: string;
  title?: string;
  duration?: number | null;
  artist?: string | null;
  track?: string | null;
  uploader?: string | null;
  channel?: string | null;
  live_status?: string | null;
  is_live?: boolean | null;
  formats?: RawFormat[];
}

const COMMON_ARGS: readonly string[] = [
  '--ignore-config',
  '--no-update',
  '--no-plugin-dirs',
  '--no-cache-dir',
  '--no-playlist',
  '--use-extractors',
  'youtube',
  '--socket-timeout',
  '20',
  '--retries',
  '3',
  '--fragment-retries',
  '3',
];

const METADATA_TIMEOUT_MS = 60_000;
const METADATA_MAX_OUTPUT = 40 * 1024 * 1024;
const PROGRESS_PREFIX = 'CHISPA|';

/** Metadatos del video. Lanza YoutubeError con un mensaje seguro si falla. */
export async function fetchVideoInfo(config: YoutubeConfig, canonicalUrl: string): Promise<RawInfo> {
  const result = await runYtDlp(config, [
    ...COMMON_ARGS,
    '--skip-download',
    '--no-warnings',
    '--dump-single-json',
    '--',
    canonicalUrl,
  ], METADATA_TIMEOUT_MS, METADATA_MAX_OUTPUT);

  if (result.code !== 0 || result.timedOut) {
    throw new YoutubeError(422, describeYtDlpFailure(result.stderr, result.timedOut));
  }
  try {
    const parsed = JSON.parse(result.stdout) as RawInfo;
    if (typeof parsed !== 'object' || parsed === null) throw new Error('forma');
    return parsed;
  } catch {
    throw new YoutubeError(502, 'YouTube devolvió datos que no se pudieron leer.');
  }
}

export interface DownloadSpec {
  canonicalUrl: string;
  container: VideoContainer;
  height: number;
  outputDir: string;
  maxFilesizeBytes: number;
  timeoutMs: number;
  onProgress: (percent: number | null, phase: 'descargando' | 'combinando') => void;
}

/** Selector de yt-dlp para la combinación exacta elegida (altura y contenedor ya validados). */
export function buildFormatSelector(container: VideoContainer, height: number): string {
  if (!Number.isInteger(height) || height < 1 || height > 10_000) throw new Error('altura no válida');
  switch (container) {
    case 'mp4':
      return `bv*[height=${height}][vcodec^=avc1][ext=mp4]+ba[ext=m4a]/b[height=${height}][ext=mp4]`;
    case 'webm':
      return `bv*[height=${height}][ext=webm]+ba[ext=webm]/b[height=${height}][ext=webm]`;
    case 'mkv':
      return `bv*[height=${height}]+ba/b[height=${height}]`;
  }
}

/**
 * Descarga solo la mejor pista de audio (sin convertir: la conversión la hace FFmpeg en ffmpeg.ts).
 * El archivo resultante se llama media.<extensión de origen>.
 */
export function startAudioDownload(config: YoutubeConfig, spec: Omit<DownloadSpec, 'container' | 'height'>): ProcessHandle {
  return startYtDlpDownload(config, spec, [
    '-f',
    'ba/b',
    '-o',
    `${spec.outputDir.replace(/%/g, '%%')}${sep}media.%(ext)s`,
  ]);
}

/**
 * Descarga el video y lo combina con FFmpeg dentro de outputDir.
 * El archivo resultante se llama media.<contenedor>; el nombre final lo asigna el servidor.
 */
export function startVideoDownload(config: YoutubeConfig, spec: DownloadSpec): ProcessHandle {
  const extra = [
    '-f',
    buildFormatSelector(spec.container, spec.height),
    '--merge-output-format',
    spec.container,
    '-o',
    `${spec.outputDir.replace(/%/g, '%%')}${sep}media.%(ext)s`,
  ];
  return startYtDlpDownload(config, spec, extra);
}

function startYtDlpDownload(
  config: YoutubeConfig,
  spec: Omit<DownloadSpec, 'container' | 'height'>,
  selectionArgs: string[],
): ProcessHandle {
  const args: string[] = [
    ...COMMON_ARGS,
    '--no-warnings',
    '--no-part',
    '--no-overwrites',
    '--newline',
    '--progress-template',
    `download:${PROGRESS_PREFIX}%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s`,
    '--max-filesize',
    String(spec.maxFilesizeBytes),
    ...selectionArgs,
  ];
  if (config.ffmpegPath.includes('/') || config.ffmpegPath.includes('\\')) {
    args.push('--ffmpeg-location', config.ffmpegPath);
  }
  args.push('--', spec.canonicalUrl);

  let phase: 'descargando' | 'combinando' = 'descargando';
  let lastPercent: number | null = null;

  return startProcess({
    command: config.ytDlpPath,
    args,
    cwd: spec.outputDir,
    timeoutMs: spec.timeoutMs,
    maxOutputBytes: 256 * 1024,
    onLine: (line) => {
      if (line.startsWith('[Merger]')) {
        phase = 'combinando';
        spec.onProgress(null, phase);
        return;
      }
      if (!line.startsWith(PROGRESS_PREFIX)) return;
      const [downloaded, total, estimate] = line.slice(PROGRESS_PREFIX.length).split('|');
      const done = Number(downloaded);
      const size = Number(total) > 0 ? Number(total) : Number(estimate);
      if (Number.isFinite(done) && Number.isFinite(size) && size > 0) {
        lastPercent = Math.min(100, Math.max(0, (done / size) * 100));
      }
      spec.onProgress(lastPercent, phase);
    },
  });
}

async function runYtDlp(
  config: YoutubeConfig,
  args: string[],
  timeoutMs: number,
  maxOutputBytes: number,
): Promise<ProcessResult> {
  const handle = startProcess({
    command: config.ytDlpPath,
    args,
    timeoutMs,
    maxOutputBytes,
  });
  const result = await handle.result;
  if (result.spawnError) throw new YoutubeError(503, 'El descargador no está disponible en este servidor.');
  return result;
}
