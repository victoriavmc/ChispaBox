/*
 * Validación estricta de enlaces de playlist de YouTube.
 * Solo se acepta /playlist?list=ID en los mismos hosts que los videos, sin parámetro v.
 * El enlace se reconstruye en forma canónica antes de llegar a yt-dlp.
 */

const LIST_ID = /^[A-Za-z0-9_-]{10,64}$/;
const WATCH_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);

export type PlaylistCheck =
  | { ok: true; playlistId: string; canonicalUrl: string }
  | { ok: false; error: string };

export function parseYoutubePlaylistUrl(input: string): PlaylistCheck {
  const reject: PlaylistCheck = { ok: false, error: 'Enlace de playlist no admitido.' };
  const text = input.trim();
  if (text.length === 0 || text.length > 300) return reject;

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return reject;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') return reject;
  if (!WATCH_HOSTS.has(url.hostname.toLowerCase()) || url.pathname !== '/playlist') return reject;
  if (url.searchParams.has('v')) return reject;

  const lists = url.searchParams.getAll('list');
  if (lists.length !== 1 || !LIST_ID.test(lists[0])) return reject;

  return {
    ok: true,
    playlistId: lists[0],
    canonicalUrl: `https://www.youtube.com/playlist?list=${lists[0]}`,
  };
}
