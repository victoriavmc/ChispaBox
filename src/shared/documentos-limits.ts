/*
 * Límites centralizados de «Documentos a PDF».
 * Los usan la interfaz (src/) y el servidor local de Vite (server/): la UI muestra
 * exactamente los valores que aplica el sistema. Cambiar un número aquí basta.
 *
 * Cada límite indica su origen:
 * - «Real»: impuesto por el formato o por la propia dependencia (no se puede superar).
 * - «Preventivo»: elegido para proteger la aplicación (memoria, tiempo, disco).
 */

const MB = 1024 * 1024;

export const DOCUMENTOS_LIMITS = {
  // ---- Documentos de Office (servidor + LibreOffice) ----
  /** Preventivo: tamaño máximo del archivo de Office que se acepta. Por variable DOCUMENTOS_MAX_MB. */
  officeMaxBytes: 30 * MB,
  /** Preventivo: tamaño total descomprimido de un .docx/.xlsx/.pptx (protección contra «zip bombs»). */
  ooxmlMaxUncompressedBytes: 300 * MB,
  /** Preventivo: entradas máximas dentro de un .docx/.xlsx/.pptx. */
  ooxmlMaxEntries: 5000,
  /** Preventivo: tiempo máximo de una conversión con LibreOffice. Por variable DOCUMENTOS_TIMEOUT_SEG. */
  officeTimeoutMs: 120_000,
  /** Preventivo: conversiones simultáneas en el servidor. Por variable DOCUMENTOS_MAX_CONCURRENT. */
  officeMaxConcurrent: 1,
  /** Preventivo: páginas máximas del PDF resultante. */
  officeMaxPages: 500,
  /** Real (Excel): filas y columnas máximas de una hoja de cálculo. */
  excelMaxRows: 1_048_576,
  excelMaxColumns: 16_384,

  // ---- Imágenes a PDF (navegador) ----
  /** Preventivo: imágenes por operación. */
  imagesMaxFiles: 30,
  /** Preventivo: peso máximo por imagen (igual que las demás herramientas de imagen). */
  imageMaxBytesEach: 20 * MB,
  /** Preventivo: peso total de todas las imágenes de una operación. */
  imagesMaxTotalBytes: 150 * MB,
  /** Preventivo: lado máximo de cada imagen en píxeles. */
  imageMaxSide: 8000,
  /** Preventivo: píxeles máximos por imagen (20 MP). */
  imageMaxPixels: 20_000_000,
  /** Real (PDF): tamaño máximo de una página, en puntos (14 400 pt = 200 pulgadas). */
  pdfMaxPageSidePt: 14_400,
  /** Real (PDF): tamaño mínimo de una página, en puntos. */
  pdfMinPageSidePt: 3,
  /** Preventivo: páginas máximas que se generan en una operación. */
  imagesMaxPages: 200,
} as const;

/** Tamaño de página de salida: dimensiones en puntos PDF (1 pt = 1/72 in). */
export const PAGE_SIZES_PT = {
  a4: { width: 595.28, height: 841.89, label: 'A4 (210 × 297 mm)' },
  letter: { width: 612, height: 792, label: 'Carta (8,5 × 11 in)' },
  legal: { width: 612, height: 1008, label: 'Oficio/Legal (8,5 × 14 in)' },
} as const;

export type PageSizeKey = keyof typeof PAGE_SIZES_PT;

/** Márgenes en puntos. «Sin margen» solo se permite si la imagen se ajusta al tamaño de la página. */
export const MARGINS_PT = {
  normal: 36,
  reducido: 12,
  ninguno: 0,
} as const;

export type MarginKey = keyof typeof MARGINS_PT;

/** Formatos de Office admitidos y su firma esperada. */
export const OFFICE_FORMATS = {
  docx: { kind: 'word', family: 'ooxml', extension: '.docx', label: 'Word (.docx)' },
  doc: { kind: 'word', family: 'ole', extension: '.doc', label: 'Word 97-2003 (.doc)' },
  xlsx: { kind: 'excel', family: 'ooxml', extension: '.xlsx', label: 'Excel (.xlsx)' },
  xls: { kind: 'excel', family: 'ole', extension: '.xls', label: 'Excel 97-2003 (.xls)' },
  pptx: { kind: 'powerpoint', family: 'ooxml', extension: '.pptx', label: 'PowerPoint (.pptx)' },
  ppt: { kind: 'powerpoint', family: 'ole', extension: '.ppt', label: 'PowerPoint 97-2003 (.ppt)' },
} as const;

export type OfficeFormat = keyof typeof OFFICE_FORMATS;

export const OFFICE_FORMAT_KEYS = Object.keys(OFFICE_FORMATS) as OfficeFormat[];

export const IMAGE_INPUT_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'] as const;
