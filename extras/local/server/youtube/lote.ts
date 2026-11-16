/*
 * Análisis de lotes: convierte el texto que pega el usuario (una playlist y/o varios enlaces,
 * uno por línea) en una lista de videos válidos. Cada enlace se valida con las mismas reglas
 * que un video individual; las playlists se leen con yt-dlp en modo «solo lista».
 */
import { startProcess } from './process.ts';
import { describeYtDlpFailure, YoutubeError } from './errors.ts';
import { fetchVideoInfo } from './ytdlp.ts';
import { parseYoutubeVideoUrl } from './url.ts';
import { parseYoutubePlaylistUrl } from './playlist.ts';
import type { YoutubeConfig } from './config.ts';
import type { BatchItem } from '../../web/shared/youtube-types.ts';

const MAX_LINES = 200;
const PLAYLIST_TIMEOUT_MS = 120_000;
const PLAYLIST_MAX_OUTPUT = 40 * 1024 * 1024;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

interface PlaylistEntry {
  id?: string | null;
  title?: string | null;
  duration?: number | null;
  channel?: string | null;
  uploader?: string | null;
}

/** Lista de videos de una playlist, sin descargar nada (yt-dlp en modo plano). */
export async function fetchPlaylistEntries(
  config: YoutubeConfig,
  canonicalUrl: string,
): Promise<{ titulo: string | null; entries: PlaylistEntry[] }> {
  const handle = startProcess({
    command: config.ytDlpPath,
    args: [
      '--ignore-config',
      '--no-update',
      '--no-plugin-dirs',
      '--no-cache-dir',
      '--use-extractors',
      'youtube:tab,youtube', // solo las pestañas de YouTube (listas), nada fuera de YouTube
      '--socket-timeout',
      '20',
      '--yes-playlist',
      '--flat-playlist',
      '--skip-download',
      '--no-warnings',
      '--dump-single-json',
      '--',
      canonicalUrl,
    ],
    timeoutMs: PLAYLIST_TIMEOUT_MS,
    maxOutputBytes: PLAYLIST_MAX_OUTPUT,
  });
  const result = await handle.result;
  if (result.spawnError) throw new YoutubeError(503, 'El descargador no está disponible en este servidor.');
  if (result.code !== 0 || result.timedOut) {
    throw new YoutubeError(422, describeYtDlpFailure(result.stderr, result.timedOut));
  }
  let parsed: { title?: string | null; entries?: Array<PlaylistEntry | null> };
  try {
    parsed = JSON.parse(result.stdout) as { title?: string | null; entries?: Array<PlaylistEntry | null> };
  } catch {
    throw new YoutubeError(502, 'YouTube devolvió datos de la lista que no se pudieron leer.');
  }
  return {
    titulo: typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : null,
    entries: (parsed.entries ?? []).filter((entry): entry is PlaylistEntry => entry !== null),
  };
}

export interface ExpandResult {
  items: BatchItem[];
  omitidos: number;
  errores: string[];
  /** Nombre de la primera playlist de la lista, o null si no hay playlist o no tiene nombre. */
  playlistTitulo: string | null;
  /** Si la lista incluye alguna playlist (aunque no tenga nombre). */
  esPlaylist: boolean;
}

/** Interpreta cada línea: playlist (expandida), enlace de video o texto no admitido. */
export async function expandSources(config: YoutubeConfig, texto: string): Promise<ExpandResult> {
  const lines = texto
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const errors: string[] = [];
  const items = new Map<string, BatchItem>();
  let omitted = 0;
  const limit = config.maxBatchItems;

  const add = (item: BatchItem): void => {
    if (items.has(item.videoId)) return;
    if (items.size >= limit) {
      omitted += 1;
      return;
    }
    items.set(item.videoId, item);
  };

  if (lines.length > MAX_LINES) errors.push(`Solo se leen las primeras ${MAX_LINES} líneas.`);
  let playlistTitle: string | null = null;
  let hasPlaylist = false;

  for (const [index, line] of lines.slice(0, MAX_LINES).entries()) {
    const numero = index + 1;
    const playlist = parseYoutubePlaylistUrl(line);
    if (playlist.ok) {
      try {
        const { titulo, entries } = await fetchPlaylistEntries(config, playlist.canonicalUrl);
        hasPlaylist = true;
        if (playlistTitle === null) playlistTitle = titulo;
        for (const entry of entries) {
          if (typeof entry.id !== 'string' || !VIDEO_ID.test(entry.id)) continue;
          add({
            videoId: entry.id,
            url: `https://www.youtube.com/watch?v=${entry.id}`,
            titulo: (entry.title ?? '').trim() || entry.id,
            canal: (entry.channel ?? entry.uploader ?? '').trim() || null,
            duracionSegundos: typeof entry.duration === 'number' && entry.duration > 0 ? Math.round(entry.duration) : null,
          });
        }
      } catch (err) {
        errors.push(`Línea ${numero}: ${err instanceof YoutubeError ? err.message : 'no se pudo leer la lista.'}`);
      }
      continue;
    }

    const video = parseYoutubeVideoUrl(line);
    if (!video.ok) {
      errors.push(`Línea ${numero}: enlace no admitido.`);
      continue;
    }
    if (items.has(video.videoId)) continue;
    try {
      const info = await fetchVideoInfo(config, video.canonicalUrl);
      add({
        videoId: video.videoId,
        url: video.canonicalUrl,
        titulo: (info.title ?? '').trim() || video.videoId,
        canal: (info.channel ?? info.uploader ?? '').trim() || null,
        duracionSegundos: typeof info.duration === 'number' && info.duration > 0 ? Math.round(info.duration) : null,
      });
    } catch (err) {
      errors.push(`Línea ${numero}: ${err instanceof YoutubeError ? err.message : 'no se pudo leer el video.'}`);
    }
  }

  return {
    items: [...items.values()],
    omitidos: omitted,
    errores: errors,
    playlistTitulo: playlistTitle,
    esPlaylist: hasPlaylist,
  };
}
