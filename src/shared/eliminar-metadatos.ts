/*
 * Lógica de «Eliminar metadatos». Lee las propiedades del PDF (autor, programa, fechas, etc.) y
 * arma una copia sin ellas. Usa pdf-lib (MIT), sin IA ni servicios externos.
 *
 * La copia se hace pasando las páginas a un documento nuevo. Así no se arrastran el diccionario
 * de información, el XMP (metadatos en XML), el JavaScript, los adjuntos ni los marcadores del
 * original. Además se borran el autor y la fecha de cada anotación.
 */
import { EncryptedPDFError, PDFArray, PDFDict, PDFDocument, PDFName } from 'pdf-lib';

/** Abre el PDF con mensajes comprensibles para el usuario. */
async function abrir(bytes: Uint8Array): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes, { updateMetadata: false });
  } catch (error) {
    if (error instanceof EncryptedPDFError) {
      throw new Error('El PDF está protegido con contraseña y no se puede limpiar.');
    }
    throw new Error('El archivo no es un PDF válido o está dañado.');
  }
}

export interface MetadatosPdf {
  titulo: string;
  autor: string;
  asunto: string;
  palabrasClave: string;
  creador: string;
  productor: string;
  creado: string;
  modificado: string;
  adjuntos: number;
  anotacionesConAutor: number;
}

const VACIO = '—';

function texto(valor: string | undefined): string {
  return valor && valor.trim().length > 0 ? valor : VACIO;
}

function fecha(valor: Date | undefined): string {
  return valor ? valor.toLocaleString('es-AR') : VACIO;
}

/** Lee las propiedades visibles del PDF sin modificarlas. */
export async function leerMetadatos(bytes: Uint8Array): Promise<MetadatosPdf> {
  const doc = await abrir(bytes);
  const anotaciones = contarAnotaciones(doc);
  return {
    titulo: texto(doc.getTitle()),
    autor: texto(doc.getAuthor()),
    asunto: texto(doc.getSubject()),
    palabrasClave: texto(doc.getKeywords()),
    creador: texto(doc.getCreator()),
    productor: texto(doc.getProducer()),
    creado: fecha(doc.getCreationDate()),
    modificado: fecha(doc.getModificationDate()),
    adjuntos: contarAdjuntos(doc),
    anotacionesConAutor: anotaciones,
  };
}

/** Cuenta los archivos adjuntos del nivel raíz (árbol /Names → /EmbeddedFiles → /Names). */
function contarAdjuntos(doc: PDFDocument): number {
  const names = doc.catalog.lookup(PDFName.of('Names'));
  if (!(names instanceof PDFDict)) return 0;
  const embebidos = names.lookup(PDFName.of('EmbeddedFiles'));
  if (!(embebidos instanceof PDFDict)) return 0;
  const lista = embebidos.lookup(PDFName.of('Names'));
  return lista instanceof PDFArray ? Math.floor(lista.size() / 2) : 0;
}

/** Cuenta las anotaciones de página que llevan autor (/T) o fecha de modificación (/M). */
function contarAnotaciones(doc: PDFDocument): number {
  let n = 0;
  for (const pagina of doc.getPages()) {
    const annots = pagina.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i += 1) {
      const anot = doc.context.lookup(annots.get(i));
      if (!(anot instanceof PDFDict)) continue;
      if (anot.has(PDFName.of('T')) || anot.has(PDFName.of('M'))) n += 1;
    }
  }
  return n;
}

export interface ResultadoLimpieza {
  bytes: Uint8Array;
  paginas: number;
}

/**
 * Devuelve una copia del PDF sin metadatos. Las páginas y su contenido no cambian. Se quitan las
 * fechas y el autor de las anotaciones; los marcadores, adjuntos y formularios no se copian.
 */
export async function limpiarMetadatos(bytes: Uint8Array): Promise<ResultadoLimpieza> {
  const origen = await abrir(bytes);
  const destino = await PDFDocument.create({ updateMetadata: false });
  const paginas = await destino.copyPages(origen, origen.getPageIndices());
  for (const pagina of paginas) {
    destino.addPage(pagina);
    const annots = pagina.node.Annots();
    if (!annots) continue;
    for (let i = 0; i < annots.size(); i += 1) {
      const anot = destino.context.lookup(annots.get(i));
      if (!(anot instanceof PDFDict)) continue;
      // Se quita la fecha. El autor (/T) se quita salvo en campos de formulario, donde es el nombre del campo.
      anot.delete(PDFName.of('M'));
      if (!anot.has(PDFName.of('FT')) && !anot.has(PDFName.of('Parent'))) anot.delete(PDFName.of('T'));
    }
  }
  const salida = await destino.save({ useObjectStreams: true });
  return { bytes: salida, paginas: destino.getPageCount() };
}
