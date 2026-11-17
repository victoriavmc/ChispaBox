/*
 * Ajuste de la configuración de página de un libro de Excel (.xlsx) ANTES de exportarlo.
 *
 * Solo se modifica una COPIA temporal del archivo, nunca el original (RG-07).
 * Se cambian únicamente los atributos de <pageSetup> y <sheetPr>/<pageSetUpPr> de cada hoja:
 * no se tocan fórmulas, datos, vínculos ni áreas de impresión.
 *
 * Opciones (lista blanca):
 * - orientación: «original» | «vertical» | «horizontal»
 * - papel: «original» | «a4» | «letter» | «legal»
 * - ajuste: «original» (escala tal como está) | «ancho» (todas las columnas en el ancho de la página)
 */
import { buildZip, type ZipFile } from './zip.ts';

export type Orientation = 'original' | 'vertical' | 'horizontal';
export type PaperKey = 'original' | 'a4' | 'letter' | 'legal';
export type FitKey = 'original' | 'ancho';

export interface ExcelPageOptions {
  orientation: Orientation;
  paper: PaperKey;
  fit: FitKey;
}

/** Códigos de papel de OOXML (ST_PaperSize). */
const PAPER_CODE: Record<Exclude<PaperKey, 'original'>, string> = {
  a4: '9',
  letter: '1',
  legal: '5',
};

const ORIENTATION_VALUE: Record<Exclude<Orientation, 'original'>, string> = {
  vertical: 'portrait',
  horizontal: 'landscape',
};

/** Elementos que, si existen, deben ir DESPUÉS de <pageSetup> (orden del esquema OOXML). */
const AFTER_PAGE_SETUP = [
  'headerFooter',
  'rowBreaks',
  'colBreaks',
  'customProperties',
  'cellWatches',
  'ignoredErrors',
  'smartTags',
  'drawing',
  'legacyDrawing',
  'legacyDrawingHF',
  'picture',
  'oleObjects',
  'controls',
  'webPublishItems',
  'tableParts',
  'extLst',
];

function parseAttrs(tag: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const re = /([\w:]+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag)) !== null) attrs.set(m[1], m[2]);
  return attrs;
}

function serializeAttrs(attrs: Map<string, string>): string {
  return Array.from(attrs, ([k, v]) => ` ${k}="${v}"`).join('');
}

/** Cambia <sheetPr> para activar o desactivar «ajustar a página». */
function setFitToPage(xml: string, fitToPage: boolean): string {
  const flag = fitToPage ? '1' : '0';
  // <sheetPr .../> sin contenido
  const selfClosing = /<((?:\w+:)?)sheetPr\b([^>]*?)\/>/;
  if (selfClosing.test(xml)) {
    return xml.replace(selfClosing, (_m, prefix: string, attrs: string) =>
      fitToPage
        ? `<${prefix}sheetPr${attrs}><${prefix}pageSetUpPr fitToPage="${flag}"/></${prefix}sheetPr>`
        : `<${prefix}sheetPr${attrs}/>`,
    );
  }
  const block = /<((?:\w+:)?)sheetPr\b([^>]*)>([\s\S]*?)<\/\1sheetPr>/;
  if (block.test(xml)) {
    return xml.replace(block, (_m, prefix: string, attrs: string, inner: string) => {
      const pageSetUp = new RegExp(`<${prefix}pageSetUpPr\\b[^>]*\\/>`);
      let body: string;
      if (pageSetUp.test(inner)) {
        body = inner.replace(pageSetUp, `<${prefix}pageSetUpPr fitToPage="${flag}"/>`);
      } else if (fitToPage) {
        // pageSetUpPr es el último hijo de sheetPr en el esquema.
        body = `${inner}<${prefix}pageSetUpPr fitToPage="${flag}"/>`;
      } else {
        body = inner;
      }
      return `<${prefix}sheetPr${attrs}>${body}</${prefix}sheetPr>`;
    });
  }
  if (!fitToPage) return xml;
  // Sin sheetPr: se inserta justo tras la etiqueta de apertura de worksheet.
  return xml.replace(/(<((?:\w+:)?)worksheet\b[^>]*>)/, (_m, open: string, prefix: string) =>
    `${open}<${prefix}sheetPr><${prefix}pageSetUpPr fitToPage="1"/></${prefix}sheetPr>`,
  );
}

/** Inserta o reemplaza <pageSetup> en la posición que exige el esquema. */
function setPageSetup(xml: string, attrs: Map<string, string>): string {
  const prefixMatch = xml.match(/<((?:\w+:)?)worksheet\b/);
  const prefix = prefixMatch ? prefixMatch[1] : '';
  const element = `<${prefix}pageSetup${serializeAttrs(attrs)}/>`;

  const existing = new RegExp(`<${prefix}pageSetup\\b[^>]*?(\\/>|>[\\s\\S]*?<\\/${prefix}pageSetup>)`);
  if (existing.test(xml)) return xml.replace(existing, element);

  const margins = new RegExp(`<${prefix}pageMargins\\b[^>]*\\/>`);
  if (margins.test(xml)) return xml.replace(margins, (m) => `${m}${element}`);

  const after = AFTER_PAGE_SETUP.map((name) => `<${prefix}${name}\\b`).join('|');
  const firstAfter = new RegExp(`(${after})`);
  const found = xml.match(firstAfter);
  if (found && found.index !== undefined) {
    return xml.slice(0, found.index) + element + xml.slice(found.index);
  }
  return xml.replace(new RegExp(`</${prefix}worksheet>`), `${element}</${prefix}worksheet>`);
}

/** Aplica las opciones a una hoja (XML de xl/worksheets/sheetN.xml). */
export function applyToSheetXml(xml: string, options: ExcelPageOptions): string {
  let out = xml;
  const fit = options.fit === 'ancho';
  out = setFitToPage(out, fit);

  const prefixMatch = out.match(/<((?:\w+:)?)worksheet\b/);
  const prefix = prefixMatch ? prefixMatch[1] : '';
  const current = out.match(new RegExp(`<${prefix}pageSetup\\b[^>]*\\/?>`));
  const attrs = current ? parseAttrs(current[0]) : new Map<string, string>();
  // Se quitan los atributos de id de impresora: referencian partes que no se conservan.
  attrs.delete('r:id');
  if (options.orientation !== 'original') attrs.set('orientation', ORIENTATION_VALUE[options.orientation]);
  if (options.paper !== 'original') attrs.set('paperSize', PAPER_CODE[options.paper]);
  if (fit) {
    attrs.set('fitToWidth', '1');
    attrs.set('fitToHeight', '0');
  } else {
    attrs.delete('fitToWidth');
    attrs.delete('fitToHeight');
  }
  const changes = options.orientation !== 'original' || options.paper !== 'original' || fit || current;
  if (changes) out = setPageSetup(out, attrs);
  return out;
}

const SHEET_PATH = /^xl\/worksheets\/[^/]+\.xml$/;

/** Devuelve un nuevo ZIP (.xlsx) con la configuración de página aplicada a todas las hojas. */
export function applyExcelPageOptions(entries: readonly ZipFile[], options: ExcelPageOptions): Buffer {
  if (options.orientation === 'original' && options.paper === 'original' && options.fit === 'original') {
    return buildZip(entries);
  }
  const changed = entries.map((entry) => {
    if (!SHEET_PATH.test(entry.name)) return entry;
    const xml = entry.data.toString('utf8');
    return { name: entry.name, data: Buffer.from(applyToSheetXml(xml, options), 'utf8') };
  });
  return buildZip(changed);
}
