/*
 * Nombres de archivo para las descargas de YouTube.
 * Lo usan el servidor (server/youtube) y la interfaz, así que la vista previa del nombre
 * es idéntica al nombre que finalmente se guarda.
 *
 * Reglas:
 * - Se conservan letras con tildes y otros caracteres Unicode válidos.
 * - Se sustituyen los caracteres prohibidos por Windows, macOS y Linux (por "_").
 * - No se agregan símbolos: el separador " - " aparece solo si hay artista y título.
 */

export const NAME_MAX_LENGTH = 180;

// Caracteres prohibidos en nombres de archivo de Windows (y separadores de rutas), más control.
const FORBIDDEN_CHARS = /[<>:"/\\|?*\u0000-\u001F\u007F]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

/** Convierte un texto en un nombre de archivo seguro, sin extensión. */
export function sanitizeFileName(raw: string, maxLength = NAME_MAX_LENGTH): string {
  let name = raw
    .normalize('NFC')
    .replace(FORBIDDEN_CHARS, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '') // sin nombres ocultos que empiecen por punto
    .replace(/[. ]+$/, ''); // Windows no admite punto ni espacio al final

  // Límite por caracteres (no por unidades UTF-16) para no partir un emoji o una letra compuesta.
  const chars = Array.from(name);
  if (chars.length > maxLength) {
    name = chars.slice(0, maxLength).join('').trim().replace(/[. ]+$/, '');
  }

  if (!name) return 'descarga';
  const base = name.split('.')[0];
  if (WINDOWS_RESERVED.test(base)) name = `_${name}`;
  return name;
}

/** Nombre sugerido para audio: «Artista - Título» o solo «Título» si falta el artista. */
export function buildAudioName(artist: string, title: string): string {
  const parts = [artist.trim(), title.trim()].filter((part) => part.length > 0);
  return sanitizeFileName(parts.join(' - ') || 'Sin título');
}

/** Nombre sugerido para video: «Canal - Título del video», o solo el título si no hay canal. */
export function buildVideoName(channel: string | null, title: string): string {
  const parts = [(channel ?? '').trim(), title.trim()].filter((part) => part.length > 0);
  return sanitizeFileName(parts.join(' - ') || 'Sin título');
}

/** Nombre final con extensión, tal como se ofrece para descargar. */
export function withExtension(baseName: string, extension: string): string {
  return `${baseName}.${extension}`;
}
