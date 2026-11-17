/*
 * Límites centralizados de las herramientas de imagen.
 * Lo usan la interfaz (src/) y el servidor local de Vite (server/), así que
 * la UI nunca muestra un valor distinto del que aplica el sistema.
 * Cambiar un número aquí basta; no repetir cifras en otros archivos.
 */

const MB = 1024 * 1024;

export const IMAGE_LIMITS = {
  /** Peso mínimo: 1 byte (solo rechaza archivos vacíos). */
  minBytes: 1,
  /** Peso máximo por archivo (preventivo, para evitar agotar memoria). */
  maxBytes: 20 * MB,
  /** Lado mínimo: 1 px (límite técnico de Canvas y Sharp; no se agrega un mínimo propio). */
  minSide: 1,
  /** Lado máximo preventivo, por encima de esto se rechaza aunque la pixelación sea menor. */
  maxSide: 8000,
  /** Lotes de conversión: archivos por vez. */
  maxBatchFiles: 10,
  /** Tiempo máximo de un procesamiento antes de cancelarlo (ms). */
  maxProcessingMs: 30_000,
} as const;

/** Límites por herramienta y método (en píxeles totales). */
export const TOOL_LIMITS = {
  quitarFondo: { maxPixels: 20_000_000 },
  convertir: { maxPixels: 20_000_000 },
  redimensionar: { maxPixels: 20_000_000 },
  mejorarCanvas: { maxPixels: 12_000_000 },
  mejorarSharp: { maxPixels: 20_000_000 },
} as const;

export function formatBytes(bytes: number): string {
  if (bytes < MB) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / MB).toFixed(2)} MB`;
}

export function formatMegapixels(pixels: number): string {
  return `${(pixels / 1_000_000).toFixed(1)} MP`;
}
