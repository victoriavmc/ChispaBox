/*
 * Validación de documentos de Office ANTES de entregarlos a LibreOffice (RG-05, sección 9).
 *
 * - No confía en la extensión: comprueba la firma (ZIP para .docx/.xlsx/.pptx,
 *   OLE2 para .doc/.xls/.ppt) y la estructura interna según el tipo pedido.
 * - Detecta macros (vbaProject.bin) y vínculos externos; NO los ejecuta ni los actualiza.
 *   Solo se informan para que la interfaz pueda advertir al usuario.
 * - Rechaza archivos cuyo contenido descomprimido supere el límite (zip bombs).
 */
import { readZip, ZipError, type ZipFile } from './zip.ts';
import { DOCUMENTOS_LIMITS, OFFICE_FORMATS, type OfficeFormat } from '../../src/shared/documentos-limits.ts';

export interface OfficeReport {
  format: OfficeFormat;
  /** Hojas de cálculo (solo Excel), para informar al usuario. */
  sheetCount: number;
  /** Hojas ocultas (solo Excel). */
  hiddenSheetCount: number;
  /** Hay macros VBA en el documento. Nunca se ejecutan. */
  hasMacros: boolean;
  /** El documento apunta a recursos externos (vínculos, imágenes remotas). No se actualizan. */
  hasExternalLinks: boolean;
  /** Entradas del ZIP (solo OOXML), para el ajuste de Excel. */
  zipEntries?: ZipFile[];
}

export class OfficeValidationError extends Error {}

const OLE_SIG = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const ZIP_SIG = Buffer.from([0x50, 0x4b, 0x03, 0x04]);

/** Tipos de contenido que identifican el documento principal de cada formato OOXML. */
const OOXML_MAIN_TYPE: Record<string, string> = {
  docx: 'wordprocessingml.document.main+xml',
  xlsx: 'spreadsheetml.sheet.main+xml',
  pptx: 'presentationml.presentation.main+xml',
};

const OOXML_MAIN_PART: Record<string, string> = {
  docx: 'word/document.xml',
  xlsx: 'xl/workbook.xml',
  pptx: 'ppt/presentation.xml',
};

/** Nombres de flujo que aparecen en el contenedor OLE2 (en UTF-16LE). */
const OLE_STREAM: Record<string, string> = {
  doc: 'WordDocument',
  xls: 'Workbook',
  ppt: 'PowerPoint Document',
};

export function validateOffice(buf: Buffer, format: OfficeFormat, limits = DOCUMENTOS_LIMITS): OfficeReport {
  const spec = OFFICE_FORMATS[format];
  if (spec.family === 'ooxml') return validateOoxml(buf, format, limits);
  return validateOle(buf, format);
}

function validateOle(buf: Buffer, format: OfficeFormat): OfficeReport {
  if (buf.length < 512 || !buf.subarray(0, 8).equals(OLE_SIG)) {
    throw new OfficeValidationError('El archivo no tiene la firma de un documento de Office 97-2003.');
  }
  const stream = Buffer.from(OLE_STREAM[format] ?? '', 'utf16le');
  if (!buf.includes(stream)) {
    throw new OfficeValidationError(`El archivo no corresponde a un ${OFFICE_FORMATS[format].label}.`);
  }
  // Los formatos binarios pueden llevar macros: se detectan por su nombre de flujo, sin ejecutarlas.
  const vba = Buffer.from('VBA', 'utf16le');
  const hasMacros = buf.includes(Buffer.from('_VBA_PROJECT', 'utf16le')) || buf.includes(vba);
  return {
    format,
    sheetCount: 0,
    hiddenSheetCount: 0,
    hasMacros,
    // En binarios no se puede comprobar fácilmente; se informa como posible.
    hasExternalLinks: false,
  };
}

function validateOoxml(buf: Buffer, format: OfficeFormat, limits: typeof DOCUMENTOS_LIMITS): OfficeReport {
  if (buf.length < 4 || !buf.subarray(0, 4).equals(ZIP_SIG)) {
    throw new OfficeValidationError('El archivo no tiene la firma de un documento Office moderno (ZIP).');
  }
  let entries: ZipFile[];
  try {
    entries = readZip(buf, {
      maxEntries: limits.ooxmlMaxEntries,
      maxUncompressedBytes: limits.ooxmlMaxUncompressedBytes,
    });
  } catch (error) {
    if (error instanceof ZipError) throw new OfficeValidationError(error.message);
    throw error;
  }

  const byName = new Map(entries.map((e) => [e.name, e.data] as const));
  const contentTypes = byName.get('[Content_Types].xml');
  if (!contentTypes) throw new OfficeValidationError('Falta [Content_Types].xml: el archivo no es un documento Office válido.');
  const ctText = contentTypes.toString('utf8');
  if (!ctText.includes(OOXML_MAIN_TYPE[format] ?? '\u0000')) {
    throw new OfficeValidationError(`El contenido del archivo no corresponde a un ${OFFICE_FORMATS[format].label}.`);
  }
  const mainPart = OOXML_MAIN_PART[format];
  if (!mainPart || !byName.has(mainPart)) {
    throw new OfficeValidationError(`Falta la parte principal «${mainPart}»: el archivo está incompleto o dañado.`);
  }

  const hasMacros = entries.some((e) => /vbaProject\.bin$/i.test(e.name));
  const hasExternalLinks =
    entries.some((e) => e.name.startsWith('xl/externalLinks/')) ||
    entries.some((e) => e.name.endsWith('.rels') && e.data.toString('utf8').includes('TargetMode="External"'));

  let sheetCount = 0;
  let hiddenSheetCount = 0;
  if (format === 'xlsx') {
    const workbook = (byName.get('xl/workbook.xml') ?? Buffer.alloc(0)).toString('utf8');
    const sheets = workbook.match(/<(?:[\w]+:)?sheet\b[^>]*>/g) ?? [];
    sheetCount = sheets.length;
    hiddenSheetCount = sheets.filter((s) => /\bstate="(hidden|veryHidden)"/.test(s)).length;
  }

  return { format, sheetCount, hiddenSheetCount, hasMacros, hasExternalLinks, zipEntries: entries };
}
