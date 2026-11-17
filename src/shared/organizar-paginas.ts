/*
 * Lógica de «Organizar páginas»: reordena, gira, quita y extrae páginas de un PDF.
 * Usa pdf-lib (MIT, JavaScript puro, sin IA). Todo corre en el navegador.
 */
import { EncryptedPDFError, PDFDocument, degrees } from 'pdf-lib';
import { esFirmaPdf } from './unificar-pdf.ts';

export const ORGANIZAR_LIMITS = {
  /** Peso máximo del PDF de entrada. */
  maxBytes: 50 * 1024 * 1024,
  /** Páginas máximas que se pueden organizar. */
  maxPaginas: 500,
} as const;

export type Giro = 0 | 90 | 180 | 270;

/** Una página en el resultado: número original (1-based), giro añadido y si se incluye en la extracción. */
export interface PaginaEditada {
  original: number;
  giro: Giro;
}

/** Suma un giro de 90° (en sentido horario si delta es +90) y lo mantiene entre 0 y 270. */
export function girar(actual: Giro, delta: 90 | -90): Giro {
  return (((actual + delta) % 360) + 360) % 360 as Giro;
}

/** Abre el PDF y valida firma, cifrado y cantidad de páginas. */
export async function leerPdfOrganizable(bytes: Uint8Array): Promise<{ doc: PDFDocument; paginas: number }> {
  if (!esFirmaPdf(bytes)) throw new Error('El contenido no es un PDF: la firma no coincide con la extensión.');
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    if (error instanceof EncryptedPDFError) {
      throw new Error('El PDF está protegido con contraseña y no se puede organizar.');
    }
    throw new Error('El archivo no es un PDF válido o está dañado.');
  }
  const paginas = doc.getPageCount();
  if (paginas < 1) throw new Error('El PDF no tiene páginas.');
  if (paginas > ORGANIZAR_LIMITS.maxPaginas) {
    throw new Error(`El PDF tiene ${paginas} páginas; el máximo para organizar es ${ORGANIZAR_LIMITS.maxPaginas}.`);
  }
  return { doc, paginas };
}

/**
 * Crea un PDF nuevo con las páginas indicadas, en ese orden. Cada página conserva su giro original
 * y le suma el giro elegido. Sin metadatos añadidos por la librería.
 */
export async function construirPdf(origen: PDFDocument, paginas: readonly PaginaEditada[]): Promise<Uint8Array> {
  if (paginas.length === 0) throw new Error('No hay páginas para generar el PDF.');
  const total = origen.getPageCount();
  for (const p of paginas) {
    if (!Number.isInteger(p.original) || p.original < 1 || p.original > total) {
      throw new Error(`La página ${p.original} no existe en el PDF.`);
    }
    if (![0, 90, 180, 270].includes(p.giro)) throw new Error('Giro no válido.');
  }

  const destino = await PDFDocument.create({ updateMetadata: false });
  const copias = await destino.copyPages(
    origen,
    paginas.map((p) => p.original - 1),
  );
  copias.forEach((copia, i) => {
    const entrada = paginas[i];
    if (!entrada) return;
    const base = origen.getPage(entrada.original - 1).getRotation().angle;
    copia.setRotation(degrees((((base + entrada.giro) % 360) + 360) % 360));
    destino.addPage(copia);
  });
  return destino.save();
}
