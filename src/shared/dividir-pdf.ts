/*
 * Lógica de «Dividir PDF»: interpreta los intervalos escritos por el usuario y separa el PDF
 * con pdf-lib (MIT, JavaScript puro, sin IA y sin servicios externos). Todo corre en el navegador:
 * el archivo nunca sale del equipo del usuario.
 */
import { EncryptedPDFError, PDFDocument } from 'pdf-lib';

export const DIVIDIR_LIMITS = {
  /** Peso máximo del PDF de entrada. */
  maxBytes: 50 * 1024 * 1024,
  /** Páginas máximas que se aceptan en el documento de entrada. */
  maxPaginas: 2000,
  /** Intervalos máximos que se pueden pedir en una sola operación. */
  maxIntervalos: 100,
  /** Archivos máximos de salida (más de uno se entrega en un ZIP). */
  maxSalidas: 200,
} as const;

/** Intervalo de páginas, 1-based e inclusivo en ambos extremos. */
export interface Intervalo {
  desde: number;
  hasta: number;
}

export type ParseIntervalosResult = { ok: true; intervalos: Intervalo[] } | { ok: false; error: string };

const TOKEN_RE = /^(\d{1,5})(?:\s*[-–]\s*(\d{1,5}))?$/;

/**
 * Interpreta «3-8, 10, 12-14». Solo admite números y guiones; cada extremo debe estar entre 1 y el
 * total de páginas, y el inicio no puede ser mayor que el final. Ante cualquier error devuelve un mensaje.
 */
export function parseIntervalos(texto: string, totalPaginas: number): ParseIntervalosResult {
  const crudo = texto.trim();
  if (crudo.length === 0) return { ok: false, error: 'Escribí al menos un intervalo, por ejemplo 3-8.' };
  if (crudo.length > 300) return { ok: false, error: 'La lista de intervalos es demasiado larga.' };

  const partes = crudo.split(',').map((p) => p.trim());
  if (partes.length > DIVIDIR_LIMITS.maxIntervalos) {
    return { ok: false, error: `Como máximo se pueden pedir ${DIVIDIR_LIMITS.maxIntervalos} intervalos.` };
  }

  const intervalos: Intervalo[] = [];
  for (const parte of partes) {
    const m = TOKEN_RE.exec(parte);
    if (!m) {
      return { ok: false, error: `«${parte || ' '}» no es válido. Usá el formato 3-8 o 5 separados por comas.` };
    }
    const desde = Number(m[1]);
    const hasta = m[2] === undefined ? desde : Number(m[2]);
    if (desde < 1 || hasta < 1 || desde > totalPaginas || hasta > totalPaginas) {
      return { ok: false, error: `«${parte}» está fuera de rango. El PDF tiene ${totalPaginas} página(s).` };
    }
    if (desde > hasta) {
      return { ok: false, error: `En «${parte}» el número inicial no puede ser mayor que el final.` };
    }
    intervalos.push({ desde, hasta });
  }
  return { ok: true, intervalos };
}

/** Un intervalo por cada página: 1-1, 2-2, … N-N. */
export function intervalosPorPagina(totalPaginas: number): Intervalo[] {
  return Array.from({ length: totalPaginas }, (_, i) => ({ desde: i + 1, hasta: i + 1 }));
}

/**
 * Un intervalo por cada página elegida. Ordena, quita repetidas y valida que estén en 1..total.
 */
export function intervalosDePaginas(paginas: readonly number[], totalPaginas: number): Intervalo[] {
  const unicas = [...new Set(paginas)].sort((a, b) => a - b);
  for (const p of unicas) {
    if (!Number.isInteger(p) || p < 1 || p > totalPaginas) throw new Error(`La página ${p} no existe en el PDF.`);
  }
  return unicas.map((p) => ({ desde: p, hasta: p }));
}

/** Carga el PDF y valida que se pueda dividir. Los PDF con contraseña se rechazan. */
export async function cargarPdf(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    const doc = await PDFDocument.load(bytes, { updateMetadata: false });
    const total = doc.getPageCount();
    if (total < 1) throw new Error('El PDF no tiene páginas.');
    if (total > DIVIDIR_LIMITS.maxPaginas) {
      throw new Error(`El PDF tiene ${total} páginas; el máximo admitido es ${DIVIDIR_LIMITS.maxPaginas}.`);
    }
    return doc;
  } catch (error) {
    if (error instanceof EncryptedPDFError) {
      throw new Error('El PDF está protegido con contraseña y no se puede dividir.');
    }
    if (error instanceof Error && /páginas|no tiene/.test(error.message)) throw error;
    throw new Error('El archivo no es un PDF válido o está dañado.');
  }
}

/**
 * Crea un PDF nuevo por cada intervalo, con las páginas copiadas del original.
 * El documento de salida no lleva metadatos añadidos por la librería.
 */
export async function dividirPdf(origen: PDFDocument, intervalos: readonly Intervalo[]): Promise<Uint8Array[]> {
  if (intervalos.length === 0) throw new Error('No hay intervalos para dividir.');
  if (intervalos.length > DIVIDIR_LIMITS.maxSalidas) {
    throw new Error(`Como máximo se generan ${DIVIDIR_LIMITS.maxSalidas} archivos por operación.`);
  }
  const salidas: Uint8Array[] = [];
  for (const { desde, hasta } of intervalos) {
    const destino = await PDFDocument.create({ updateMetadata: false });
    const indices: number[] = [];
    for (let p = desde; p <= hasta; p += 1) indices.push(p - 1);
    const paginas = await destino.copyPages(origen, indices);
    for (const pagina of paginas) destino.addPage(pagina);
    salidas.push(await destino.save());
  }
  return salidas;
}

/**
 * Une las páginas elegidas en un solo PDF, en su orden original. Sin metadatos añadidos.
 */
export async function unirPaginas(origen: PDFDocument, paginas: readonly number[]): Promise<Uint8Array> {
  const intervalos = intervalosDePaginas(paginas, origen.getPageCount());
  if (intervalos.length === 0) throw new Error('No hay páginas seleccionadas.');
  const destino = await PDFDocument.create({ updateMetadata: false });
  const copias = await destino.copyPages(origen, intervalos.map((i) => i.desde - 1));
  for (const pagina of copias) destino.addPage(pagina);
  return destino.save();
}

/** Nombre de salida sin extensión: «Informe - página 5» o «Informe - páginas 3-8». */
export function etiquetaIntervalo(intervalo: Intervalo, digitos: number): string {
  if (intervalo.desde === intervalo.hasta) {
    return `página ${String(intervalo.desde).padStart(digitos, '0')}`;
  }
  return `páginas ${intervalo.desde}-${intervalo.hasta}`;
}
