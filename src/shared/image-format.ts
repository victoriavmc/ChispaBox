/*
 * Detección de formato por firma binaria (magic bytes).
 * No se confía en la extensión ni en el MIME que informa el navegador.
 */

export type InputFormat = 'jpeg' | 'png' | 'webp';
export type OutputFormat = 'jpeg' | 'png' | 'webp' | 'ico';

export const INPUT_FORMATS: readonly InputFormat[] = ['jpeg', 'png', 'webp'];

export const INPUT_LABEL: Record<InputFormat, string> = {
  jpeg: 'JPG / JPEG',
  png: 'PNG',
  webp: 'WebP',
};

export const INPUT_MIME: Record<InputFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export const INPUT_EXTENSIONS: Record<InputFormat, readonly string[]> = {
  jpeg: ['.jpg', '.jpeg'],
  png: ['.png'],
  webp: ['.webp'],
};

export const OUTPUT_MIME: Record<OutputFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  ico: 'image/x-icon',
};

export const OUTPUT_EXTENSION: Record<OutputFormat, string> = {
  jpeg: 'jpg',
  png: 'png',
  webp: 'webp',
  ico: 'ico',
};

function ascii(bytes: Uint8Array, start: number, end: number): string {
  let s = '';
  for (let i = start; i < end && i < bytes.length; i++) s += String.fromCharCode(bytes[i] ?? 0);
  return s;
}

/** Devuelve el formato de entrada admitido según su firma, o null si no lo es. */
export function sniffInputFormat(head: Uint8Array): InputFormat | null {
  if (head.length >= 8 && head[0] === 0x89 && ascii(head, 1, 4) === 'PNG' && head[4] === 0x0d && head[5] === 0x0a && head[6] === 0x1a && head[7] === 0x0a) {
    return 'png';
  }
  if (head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (head.length >= 12 && ascii(head, 0, 4) === 'RIFF' && ascii(head, 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Nombre de un formato no admitido reconocido por firma (para mensajes claros). */
export function describeUnsupported(head: Uint8Array): string | null {
  const text = ascii(head, 0, 16);
  if (text.startsWith('GIF8')) return 'GIF';
  if (text.startsWith('BM')) return 'BMP';
  if (head.length >= 4 && head[0] === 0 && head[1] === 0 && head[2] === 1 && head[3] === 0) return 'ICO';
  if (text.startsWith('%PDF')) return 'PDF';
  if (text.startsWith('<svg') || text.startsWith('<?xml') || text.startsWith('<!DOCTYPE svg')) return 'SVG/XML';
  if (ascii(head, 4, 8) === 'ftyp') return 'HEIC/AVIF/MP4';
  return null;
}

/** Verifica que la salida generada sea del formato pedido (no confiar solo en Canvas.toBlob). */
export function outputMatches(head: Uint8Array, format: OutputFormat): boolean {
  if (format === 'ico') return head.length >= 4 && head[0] === 0 && head[1] === 0 && head[2] === 1 && head[3] === 0;
  return sniffInputFormat(head) === format;
}
