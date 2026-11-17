/*
 * Opciones reales de descarga a partir de los metadatos que devuelve yt-dlp.
 * Funciones puras (sin red ni disco): solo se ofrece lo que el video tiene de verdad.
 */
import {
  AUDIO_BITRATE_STEPS,
  type AudioFormat,
  type AudioOption,
  type VideoContainer,
  type VideoOption,
} from '../../web/shared/youtube-types.ts';

/** Subconjunto de cada entrada de "formats" de yt-dlp que se usa aquí. */
export interface RawFormat {
  format_id?: string;
  ext?: string;
  vcodec?: string | null;
  acodec?: string | null;
  height?: number | null;
  abr?: number | null;
  tbr?: number | null;
  filesize?: number | null;
  filesize_approx?: number | null;
}

/** WAV estéreo 16 bits a 44,1 kHz: 1411 kbps (176 400 bytes por segundo). */
const WAV_BYTES_PER_SECOND = 176_400;
/**
 * FLAC sobre un origen comprimido: tamaño típico cercano al 60 % del WAV.
 * Es una estimación; el tamaño real se conoce al terminar la descarga.
 */
const FLAC_RATIO_TO_WAV = 0.6;

const isVideo = (f: RawFormat): boolean => !!f.vcodec && f.vcodec !== 'none';
const isAudio = (f: RawFormat): boolean => !!f.acodec && f.acodec !== 'none';
const isVideoOnly = (f: RawFormat): boolean => isVideo(f) && !isAudio(f);
const isAudioOnly = (f: RawFormat): boolean => isAudio(f) && !isVideo(f);
const isMuxed = (f: RawFormat): boolean => isVideo(f) && isAudio(f);

function heightOf(f: RawFormat): number | null {
  return typeof f.height === 'number' && Number.isInteger(f.height) && f.height > 0 ? f.height : null;
}

function descending(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((a, b) => b - a);
}

/** Puntuación para elegir el mejor flujo (como hace yt-dlp con los selectores de mejor vídeo y de mejor audio): bitrate informado. */
function score(f: RawFormat): number {
  return f.tbr ?? f.abr ?? 0;
}

/** Tiene tamaño informado (no es un flujo de streaming sin tamaño, como HLS). */
function hasSize(f: RawFormat): boolean {
  return (f.filesize ?? 0) > 0 || (f.filesize_approx ?? 0) > 0;
}

/** Prefiere flujos con tamaño conocido y, dentro de ellos, el de mayor bitrate. */
function pickBest(list: readonly RawFormat[]): RawFormat | undefined {
  return [...list].sort((a, b) => Number(hasSize(b)) - Number(hasSize(a)) || score(b) - score(a))[0];
}

/** Bytes de un flujo: tamaño informado, o bitrate × duración si no hay tamaño. */
function bytesOf(f: RawFormat, durationSeconds: number | null): number | null {
  if (typeof f.filesize === 'number' && f.filesize > 0) return f.filesize;
  if (typeof f.filesize_approx === 'number' && f.filesize_approx > 0) return f.filesize_approx;
  if (typeof f.tbr === 'number' && f.tbr > 0 && durationSeconds !== null) {
    return Math.round(f.tbr * 125 * durationSeconds); // kbps × 125 = bytes por segundo
  }
  return null;
}

/**
 * Tamaño aproximado de la combinación que usa el selector de descarga para esa altura y contenedor.
 * Debe coincidir con las reglas de buildVideoOptions y de buildFormatSelector (ytdlp.ts).
 */
function estimateVideoBytes(
  formats: readonly RawFormat[],
  container: VideoContainer,
  height: number,
  durationSeconds: number | null,
): number | null {
  const atHeight = formats.filter((f) => heightOf(f) === height);
  let videos: RawFormat[];
  let audios: RawFormat[];
  let muxed: RawFormat[];
  if (container === 'mp4') {
    videos = atHeight.filter((f) => isVideoOnly(f) && f.ext === 'mp4' && !!f.vcodec?.startsWith('avc1'));
    audios = formats.filter((f) => isAudioOnly(f) && f.ext === 'm4a');
    muxed = atHeight.filter((f) => isMuxed(f) && f.ext === 'mp4');
  } else if (container === 'webm') {
    videos = atHeight.filter((f) => isVideoOnly(f) && f.ext === 'webm');
    audios = formats.filter((f) => isAudioOnly(f) && f.ext === 'webm');
    muxed = atHeight.filter((f) => isMuxed(f) && f.ext === 'webm');
  } else {
    videos = atHeight.filter((f) => isVideoOnly(f));
    audios = formats.filter((f) => isAudioOnly(f));
    muxed = atHeight.filter((f) => isMuxed(f));
  }

  const video = pickBest(videos);
  const audio = pickBest(audios);
  if (video && audio) {
    const v = bytesOf(video, durationSeconds);
    const a = bytesOf(audio, durationSeconds);
    return v !== null && a !== null ? v + a : null;
  }
  const single = pickBest(muxed);
  return single ? bytesOf(single, durationSeconds) : null;
}

/**
 * Contenedores y alturas disponibles. Reglas:
 * - MP4: vídeo H.264 (avc1) en MP4 con audio AAC (m4a), o un archivo único MP4 con ambos.
 * - WebM: vídeo en WebM con audio en WebM (Opus), o un archivo único WebM.
 * - MKV: cualquier vídeo con cualquier audio; MKV admite todos los códecs que yt-dlp combina.
 * Además, tamaño aproximado por altura (null si no se puede estimar).
 */
export function buildVideoOptions(formats: readonly RawFormat[], durationSeconds: number | null = null): VideoOption[] {
  const hasAacAudio = formats.some((f) => isAudioOnly(f) && f.ext === 'm4a');
  const hasWebmAudio = formats.some((f) => isAudioOnly(f) && f.ext === 'webm');
  const hasAnyAudio = formats.some((f) => isAudio(f));

  const mp4Heights = formats
    .filter((f) => {
      const h = heightOf(f);
      if (h === null) return false;
      if (isMuxed(f)) return f.ext === 'mp4' && !!f.vcodec?.startsWith('avc1');
      return isVideoOnly(f) && f.ext === 'mp4' && !!f.vcodec?.startsWith('avc1') && hasAacAudio;
    })
    .map((f) => heightOf(f) as number);

  const webmHeights = formats
    .filter((f) => {
      const h = heightOf(f);
      if (h === null) return false;
      if (isMuxed(f)) return f.ext === 'webm';
      return isVideoOnly(f) && f.ext === 'webm' && hasWebmAudio;
    })
    .map((f) => heightOf(f) as number);

  const mkvHeights = formats.filter((f) => heightOf(f) !== null && isVideo(f)).map((f) => heightOf(f) as number);

  const build = (contenedor: VideoContainer, heights: number[]): VideoOption => {
    const alturas = descending(heights);
    const tamanos: Record<string, number | null> = {};
    for (const altura of alturas) tamanos[String(altura)] = estimateVideoBytes(formats, contenedor, altura, durationSeconds);
    return { contenedor, alturas, tamanos };
  };

  const options: VideoOption[] = [
    build('mp4', mp4Heights),
    build('webm', webmHeights),
    build('mkv', hasAnyAudio ? mkvHeights : []),
  ];
  return options.filter((option) => option.alturas.length > 0);
}

/** Mejor bitrate de audio informado por YouTube (kbps), o null si no hay dato fiable. */
export function sourceAudioKbps(formats: readonly RawFormat[]): number | null {
  const candidates = formats
    .filter((f) => isAudio(f))
    .map((f) => (typeof f.abr === 'number' && f.abr > 0 ? f.abr : typeof f.tbr === 'number' && f.tbr > 0 ? f.tbr : 0))
    .filter((kbps) => kbps > 0);
  if (candidates.length === 0) return null;
  // Redondeo hacia abajo: nunca se ofrece un bitrate por encima del que informa el origen.
  return Math.floor(Math.max(...candidates));
}

/**
 * Formatos de audio y bitrates ofrecibles. Un bitrate nunca supera el del origen.
 * MP3, M4A: con pérdida, solo bitrates ≤ origen. WAV: sin bitrate elegible. FLAC: sin pérdida,
 * pero el origen es audio comprimido, así que no recupera calidad (se avisa en la interfaz).
 * Tamaño aproximado: bitrate × duración; WAV y FLAC según su formato sin comprimir.
 */
export function buildAudioOptions(sourceKbps: number | null, durationSeconds: number | null = null): AudioOption[] {
  const steps = sourceKbps === null ? [] : AUDIO_BITRATE_STEPS.filter((kbps) => kbps <= sourceKbps);
  const lossyKbps = sourceKbps === null ? [128] : steps;
  const wavBytes = durationSeconds === null ? null : Math.round(WAV_BYTES_PER_SECOND * durationSeconds);
  const formats: AudioFormat[] = ['mp3', 'm4a', 'wav', 'flac'];
  return formats.map((formato): AudioOption => {
    if (formato === 'mp3' || formato === 'm4a') {
      const tamanos: Record<string, number | null> = {};
      for (const kbps of lossyKbps) {
        tamanos[String(kbps)] = durationSeconds === null ? null : Math.round(kbps * 125 * durationSeconds);
      }
      return { formato, kbps: lossyKbps, tamanos };
    }
    const bytes = formato === 'wav' ? wavBytes : wavBytes === null ? null : Math.round(wavBytes * FLAC_RATIO_TO_WAV);
    return { formato, kbps: [], tamanos: { '0': bytes } };
  });
}

export function isVideoContainer(value: unknown): value is VideoContainer {
  return value === 'mp4' || value === 'webm' || value === 'mkv';
}

export function isAudioFormat(value: unknown): value is AudioFormat {
  return value === 'mp3' || value === 'm4a' || value === 'wav' || value === 'flac';
}
