/*
 * FFmpeg y ffprobe para el módulo de descargas.
 *
 * - Conversión de audio con listas de argumentos fijas. Los datos variables (bitrate validado,
 *   título y artista como un solo argumento cada uno) nunca se interpretan como opciones.
 * - Las etiquetas se escriben con -metadata; la metadata del origen se descarta (-map_metadata -1).
 * - Verificación básica de los archivos finales con ffprobe antes de marcarlos como listos.
 */
import { startProcess, type ProcessHandle } from './process.ts';
import { YoutubeError } from './errors.ts';
import type { YoutubeConfig } from './config.ts';
import type { AudioFormat } from '../../web/shared/youtube-types.ts';

const PROBE_TIMEOUT_MS = 30_000;
const PROBE_MAX_OUTPUT = 1024 * 1024;

export interface ProbeResult {
  durationSeconds: number | null;
  hasVideo: boolean;
  hasAudio: boolean;
}

interface FfprobeJson {
  format?: { duration?: string };
  streams?: Array<{ codec_type?: string }>;
}

/** Lee duración y tipos de pista de un archivo. Lanza si no se puede leer. */
export async function probeFile(config: YoutubeConfig, filePath: string): Promise<ProbeResult> {
  const handle = startProcess({
    command: config.ffprobePath,
    args: [
      '-v',
      'error',
      '-show_entries',
      'format=duration:stream=codec_type',
      '-of',
      'json',
      '--',
      filePath,
    ],
    timeoutMs: PROBE_TIMEOUT_MS,
    maxOutputBytes: PROBE_MAX_OUTPUT,
  });
  const result = await handle.result;
  if (result.code !== 0 || result.timedOut || result.spawnError) {
    throw new YoutubeError(500, 'El archivo generado no se puede leer.');
  }
  let parsed: FfprobeJson;
  try {
    parsed = JSON.parse(result.stdout) as FfprobeJson;
  } catch {
    throw new YoutubeError(500, 'El archivo generado no se puede leer.');
  }
  const types = (parsed.streams ?? []).map((s) => s.codec_type);
  const duration = Number(parsed.format?.duration);
  return {
    durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
    hasVideo: types.includes('video'),
    hasAudio: types.includes('audio'),
  };
}

export interface AudioConversion {
  inputPath: string;
  outputPath: string;
  format: AudioFormat;
  kbps: number | null;
  title: string;
  artist: string;
  sourceDurationSeconds: number | null;
  timeoutMs: number;
  onProgress: (percent: number) => void;
}

/** Códec y argumentos de salida para cada formato. Lista cerrada: no hay entrada libre. */
function codecArgs(format: AudioFormat, kbps: number | null): string[] {
  switch (format) {
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-b:a', `${requireKbps(kbps)}k`, '-id3v2_version', '3'];
    case 'm4a':
      return ['-c:a', 'aac', '-b:a', `${requireKbps(kbps)}k`, '-movflags', '+faststart'];
    case 'wav':
      return ['-c:a', 'pcm_s16le'];
    case 'flac':
      return ['-c:a', 'flac', '-compression_level', '8'];
  }
}

function requireKbps(kbps: number | null): number {
  if (kbps === null || !Number.isInteger(kbps) || kbps < 32 || kbps > 320) {
    throw new YoutubeError(400, 'Calidad de audio no válida.');
  }
  return kbps;
}

/** Convierte el audio descargado al formato pedido, con etiquetas de título y artista. */
export function startAudioConversion(config: YoutubeConfig, job: AudioConversion): ProcessHandle {
  const args = [
    '-hide_banner',
    '-nostdin',
    '-n', // nunca sobrescribir
    '-i',
    job.inputPath,
    '-vn',
    '-map',
    '0:a:0',
    '-map_metadata',
    '-1',
    ...codecArgs(job.format, job.kbps),
  ];
  if (job.title) args.push('-metadata', `title=${job.title}`);
  if (job.artist) args.push('-metadata', `artist=${job.artist}`);
  args.push('-progress', 'pipe:1', '-nostats', job.outputPath);

  const total = job.sourceDurationSeconds;
  return startProcess({
    command: config.ffmpegPath,
    args,
    timeoutMs: job.timeoutMs,
    maxOutputBytes: 64 * 1024,
    onLine: (line) => {
      if (total === null) return;
      const match = /^out_time_us=(\d+)$/.exec(line);
      if (!match) return;
      const percent = (Number(match[1]) / 1_000_000 / total) * 100;
      job.onProgress(Math.min(100, Math.max(0, percent)));
    },
  });
}
