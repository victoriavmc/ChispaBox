/*
 * Lógica de «Unificar PDF»: combina varios PDF en uno, en el orden elegido por el usuario.
 * Usa pdf-lib (MIT, JavaScript puro, sin IA, sin servicios externos). Todo corre en el navegador.
 */
import { EncryptedPDFError, PDFDocument } from 'pdf-lib';

export const UNIFICAR_LIMITS = {
  /** Archivos máximos en una misma unión. */
  maxArchivos: 30,
  /** Peso máximo de cada PDF de entrada. */
  maxBytesArchivo: 50 * 1024 * 1024,
  /** Peso total de los PDF de entrada. */
  maxBytesTotal: 200 * 1024 * 1024,
  /** Páginas totales del resultado. */
  maxPaginasTotal: 3000,
} as const;

/** Comprueba la firma «%PDF-» al inicio de los bytes. */
export function esFirmaPdf(bytes: Uint8Array): boolean {
  return bytes.length >= 5 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46 && bytes[4] === 0x2d;
}

/**
 * Abre un PDF y devuelve su cantidad de páginas. Rechaza PDF protegidos, sin páginas o dañados
 * con un mensaje que se muestra al usuario.
 */
export async function leerPaginas(bytes: Uint8Array): Promise<number> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const total = doc.getPageCount();
    if (total < 1) throw new Error('El PDF no tiene páginas.');
    return total;
  } catch (error) {
    if (error instanceof EncryptedPDFError) {
      throw new Error('El PDF está protegido con contraseña y no se puede unificar.');
    }
    if (error instanceof Error && error.message === 'El PDF no tiene páginas.') throw error;
    throw new Error('El archivo no es un PDF válido o está dañado.');
  }
}

export interface ArchivoLote {
  bytes: number;
  paginas: number;
}

/** Valida el conjunto completo antes de unir. Devuelve un mensaje de error o null si está bien. */
export function validarLote(archivos: readonly ArchivoLote[]): string | null {
  if (archivos.length < 2) return 'Agregá al menos dos PDF para unificarlos.';
  return validarLimites(archivos);
}

/** Límites de cantidad, peso y páginas, sin exigir un mínimo (útil mientras se agregan archivos). */
export function validarLimites(archivos: readonly ArchivoLote[]): string | null {
  if (archivos.length > UNIFICAR_LIMITS.maxArchivos) {
    return `Como máximo se pueden unificar ${UNIFICAR_LIMITS.maxArchivos} archivos.`;
  }
  const bytesTotal = archivos.reduce((sum, a) => sum + a.bytes, 0);
  if (bytesTotal > UNIFICAR_LIMITS.maxBytesTotal) {
    return `El conjunto pesa más del máximo permitido (${Math.round(UNIFICAR_LIMITS.maxBytesTotal / 1024 / 1024)} MB en total).`;
  }
  const paginasTotal = archivos.reduce((sum, a) => sum + a.paginas, 0);
  if (paginasTotal > UNIFICAR_LIMITS.maxPaginasTotal) {
    return `El resultado tendría ${paginasTotal} páginas; el máximo es ${UNIFICAR_LIMITS.maxPaginasTotal}.`;
  }
  return null;
}

/**
 * Une los PDF en el orden recibido. Cada documento se abre por separado y se copian todas sus
 * páginas. El resultado no lleva metadatos añadidos por la librería.
 */
export async function unificarPdfs(entradas: readonly Uint8Array[]): Promise<{ bytes: Uint8Array; paginas: number }> {
  if (entradas.length === 0) throw new Error('No hay PDF para unificar.');
  const destino = await PDFDocument.create({ updateMetadata: false });
  for (const entrada of entradas) {
    const origen = await PDFDocument.load(entrada, { updateMetadata: false });
    const indices = origen.getPageIndices();
    const copias = await destino.copyPages(origen, indices);
    for (const pagina of copias) destino.addPage(pagina);
  }
  const paginas = destino.getPageCount();
  if (paginas > UNIFICAR_LIMITS.maxPaginasTotal) {
    throw new Error(`El resultado tendría ${paginas} páginas; el máximo es ${UNIFICAR_LIMITS.maxPaginasTotal}.`);
  }
  return { bytes: await destino.save(), paginas };
}
