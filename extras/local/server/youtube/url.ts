/*
 * Validación estricta de enlaces de YouTube (RG-05).
 *
 * Solo se aceptan enlaces HTTPS a un único video de estos hosts exactos:
 *   youtube.com/watch?v=ID · www.youtube.com/watch?v=ID · m.youtube.com/watch?v=ID
 *   youtube.com/shorts/ID · youtu.be/ID
 * El enlace se reconstruye en forma canónica: yt-dlp nunca recibe el texto original del usuario.
 * Listas de reproducción, canales, transmisiones y otros hosts se rechazan.
 */

const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_INPUT_LENGTH = 300;
const WATCH_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
const SHORT_HOST = 'youtu.be';

export type UrlCheck = { ok: true; videoId: string; canonicalUrl: string } | { ok: false; error: string };

const REJECT_MESSAGE = 'Enlace no admitido. Pegá un enlace de un video de YouTube (youtube.com/watch, youtu.be o shorts).';

export function parseYoutubeVideoUrl(input: unknown): UrlCheck {
  if (typeof input !== 'string') return { ok: false, error: REJECT_MESSAGE };
  const text = input.trim();
  if (text.length === 0 || text.length > MAX_INPUT_LENGTH) return { ok: false, error: REJECT_MESSAGE };

  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, error: REJECT_MESSAGE };
  }

  // Sin credenciales, sin puerto explícito y solo HTTPS.
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== '') {
    return { ok: false, error: REJECT_MESSAGE };
  }

  const host = url.hostname.toLowerCase();
  let videoId: string | null = null;

  if (host === SHORT_HOST) {
    const segments = url.pathname.split('/').filter((s) => s.length > 0);
    if (segments.length === 1) videoId = segments[0];
  } else if (WATCH_HOSTS.has(host)) {
    if (url.pathname === '/watch') {
      const values = url.searchParams.getAll('v');
      if (values.length === 1) videoId = values[0];
    } else {
      const match = /^\/shorts\/([^/]+)$/.exec(url.pathname);
      if (match) videoId = match[1];
    }
  }

  if (videoId === null || !VIDEO_ID.test(videoId)) return { ok: false, error: REJECT_MESSAGE };

  return {
    ok: true,
    videoId,
    canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
  };
}
