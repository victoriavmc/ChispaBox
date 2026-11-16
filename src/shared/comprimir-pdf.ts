/*
 * Lógica de «Comprimir PDF». Dos caminos:
 * - «Sin perder calidad»: reescribe el PDF con pdf-lib (MIT) quitando objetos sobrantes. No cambia
 *   el texto ni las imágenes.
 * - «Correo» e «Impresión»: cada página se dibuja con PDF.js (Apache-2.0) y se guarda como JPEG de
 *   menor resolución. Pierde el texto seleccionable, pero puede bajar mucho el peso de PDF con imágenes.
 * No usa IA ni servicios externos.
 */
import { PDFDocument } from 'pdf-lib';

export type NivelCompresion = 'estructura' | 'correo' | 'impresion';

export interface ConfigNivel {
  label: string;
  dpi: number;
  calidad: number;
  nota: string;
}

/** Sin pérdida: no toca el contenido, solo reescribe el archivo de forma más compacta. */
export const NIVEL_ESTRUCTURA = {
  label: 'Sin perder calidad (recomendado para PDF de texto)',
  nota: 'Conserva el texto seleccionable, las imágenes y los enlaces de página. Quita objetos sobrantes del archivo. Suele bajar entre 30 % y 50 % en PDF de texto. No conserva los marcadores ni los formularios.',
} as const;

export const NIVELES: Record<Exclude<NivelCompresion, 'estructura'>, ConfigNivel> = {
  correo: {
    label: 'Para enviar por correo (más compresión)',
    dpi: 96,
    calidad: 0.6,
    nota: 'Pesa mucho menos. Se ve bien en pantalla, pero la impresión puede verse borrosa.',
  },
  impresion: {
    label: 'Para imprimir (mejor calidad)',
    dpi: 150,
    calidad: 0.85,
    nota: 'Pesa menos que el original, con buena calidad para imprimir.',
  },
};

/**
 * Reescribe el PDF copiando sus páginas a un documento nuevo. Quita objetos que ya no se usan
 * (recursos duplicados o sobrantes) sin cambiar el contenido visible ni el texto.
 */
export async function optimizarEstructura(bytes: Uint8Array): Promise<Uint8Array> {
  const origen = await PDFDocument.load(bytes, { updateMetadata: false });
  const destino = await PDFDocument.create({ updateMetadata: false });
  const paginas = await destino.copyPages(origen, origen.getPageIndices());
  for (const pagina of paginas) destino.addPage(pagina);
  return destino.save({ useObjectStreams: true });
}

export const COMPRIMIR_LIMITS = {
  maxBytes: 100 * 1024 * 1024,
  maxPaginas: 200,
  /** Lado máximo del canvas en píxeles, para no pasar los límites del navegador. */
  maxLadoPx: 4000,
} as const;

/** Escala de PDF.js para que la página salga a `dpi` (un PDF mide 72 puntos por pulgada). */
export function escalaParaDpi(dpi: number, anchoPt: number, altoPt: number): number {
  const escala = dpi / 72;
  const lado = Math.max(anchoPt, altoPt) * escala;
  if (lado <= COMPRIMIR_LIMITS.maxLadoPx) return escala;
  return COMPRIMIR_LIMITS.maxLadoPx / Math.max(anchoPt, altoPt);
}

export interface PaginaImagen {
  jpeg: Uint8Array;
  anchoPt: number;
  altoPt: number;
}

/** Arma un PDF en el que cada página es una imagen JPEG del tamaño original de la página. */
export async function construirPdfImagenes(paginas: readonly PaginaImagen[]): Promise<Uint8Array> {
  if (paginas.length === 0) throw new Error('No hay páginas para armar el PDF.');
  const doc = await PDFDocument.create({ updateMetadata: false });
  for (const pagina of paginas) {
    const imagen = await doc.embedJpg(pagina.jpeg);
    const page = doc.addPage([pagina.anchoPt, pagina.altoPt]);
    page.drawImage(imagen, { x: 0, y: 0, width: pagina.anchoPt, height: pagina.altoPt });
  }
  return doc.save({ useObjectStreams: true });
}

export type Decision =
  | { ok: true; ahorro: number }
  | { ok: false; mensaje: string };

/**
 * Decide si conviene entregar el resultado. Si la versión comprimida no pesa menos que el
 * original, no se entrega: el usuario se queda con su archivo.
 */
export function decidirEntrega(bytesOriginal: number, bytesComprimido: number): Decision {
  if (bytesComprimido <= 0) return { ok: false, mensaje: 'El PDF comprimido salió vacío. No se entrega.' };
  if (bytesComprimido >= bytesOriginal) {
    return {
      ok: false,
      mensaje: 'Con este nivel el PDF no quedó más liviano que el original, así que no se entrega. Probá el nivel para correo o usá el original.',
    };
  }
  return { ok: true, ahorro: Math.round((1 - bytesComprimido / bytesOriginal) * 100) };
}
