/*
 * PDF a texto editable (sin LibreOffice): extrae el texto con unpdf (pdf.js) y arma un .docx
 * con párrafos, títulos y viñetas que fluyen normalmente en Word.
 *
 * Limitaciones (se informan al usuario): no conserva el diseño exacto, imágenes, tablas ni
 * columnas. Un PDF escaneado (solo imágenes) no tiene texto y se rechaza.
 *
 * Solo se usa en el servidor de desarrollo / vista previa (igual que el resto del API).
 */
import { getDocumentProxy } from 'unpdf';
import { buildZip } from './zip.ts';

export class PdfTextoError extends Error {}

export type Bloque =
  | { tipo: 'titulo1'; texto: string }
  | { tipo: 'titulo2'; texto: string }
  | { tipo: 'vineta'; texto: string }
  | { tipo: 'parrafo'; texto: string };

interface Linea {
  texto: string;
  tamano: number;
  y: number;
  pagina: number;
}

interface Item {
  str: string;
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

const VINETA = /^[•●▪■◦∙·\-–—*]\s+/;
const FIN_DE_FRASE = /[.!?:;)»"”]$/;

/** Extrae las líneas de texto de todas las páginas, ordenadas de arriba abajo. */
export async function extraerLineas(bytes: Uint8Array): Promise<{ lineas: Linea[]; paginas: number }> {
  let pdf;
  try {
    pdf = await getDocumentProxy(bytes);
  } catch {
    throw new PdfTextoError('No se pudo leer el PDF. Puede estar dañado o protegido con contraseña.');
  }
  const lineas: Linea[] = [];
  try {
    for (let n = 1; n <= pdf.numPages; n += 1) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      // Solo los fragmentos de texto (TextItem); las marcas de contenido no traen posición.
      const crudos = content.items as Array<{ str?: unknown; transform?: number[]; width?: number; height?: number }>;
      const items: Item[] = crudos
        .filter((it) => typeof it.str === 'string' && it.str.trim() !== '' && Array.isArray(it.transform))
        .map((it) => {
          const t = it.transform as number[];
          return {
            str: it.str as string,
            x: t[4],
            y: t[5],
            ancho: it.width ?? 0,
            alto: Math.abs(it.height ?? 0) || Math.abs(t[3]) || 0,
          };
        });
      lineas.push(...agruparEnLineas(items, n));
    }
  } finally {
    // Libera la memoria del documento si la versión de pdf.js lo permite.
    await (pdf as { destroy?: () => Promise<void> }).destroy?.().catch(() => undefined);
  }
  const paginas = contarPaginas(lineas);
  return { lineas: quitarEncabezadosRepetidos(lineas, paginas), paginas };
}

function contarPaginas(lineas: Linea[]): number {
  return lineas.length ? Math.max(...lineas.map((l) => l.pagina)) : 0;
}

/**
 * Quita encabezados y pies que se repiten en casi todas las páginas (p. ej. «Page 1 of 8 …»).
 * Los números se normalizan, así que «Page 2 of 8» cuenta como el mismo encabezado.
 */
export function quitarEncabezadosRepetidos(lineas: Linea[], paginas: number): Linea[] {
  if (paginas < 3) return lineas;
  const clave = (t: string) => t.toLowerCase().replace(/\d+/g, '#').trim();
  const paginasPorClave = new Map<string, Set<number>>();
  for (const l of lineas) {
    const k = clave(l.texto);
    if (!k) continue;
    const set = paginasPorClave.get(k) ?? new Set<number>();
    set.add(l.pagina);
    paginasPorClave.set(k, set);
  }
  const umbral = Math.max(3, Math.ceil(paginas * 0.6));
  return lineas.filter((l) => (paginasPorClave.get(clave(l.texto))?.size ?? 0) < umbral);
}

/** Agrupa los fragmentos de una página en líneas (misma altura de base) y las ordena por posición. */
export function agruparEnLineas(items: Item[], pagina: number): Linea[] {
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const grupos: Item[][] = [];
  for (const it of sorted) {
    const actual = grupos[grupos.length - 1];
    const tolerancia = Math.max(2, (it.alto || 10) * 0.5);
    if (actual && Math.abs(actual[0].y - it.y) <= tolerancia) actual.push(it);
    else grupos.push([it]);
  }
  return grupos.map((grupo) => {
    grupo.sort((a, b) => a.x - b.x);
    let texto = '';
    let previo: Item | null = null;
    for (const it of grupo) {
      if (previo) {
        const hueco = it.x - (previo.x + previo.ancho);
        const tieneEspacio = /\s$/.test(texto) || /^\s/.test(it.str);
        if (!tieneEspacio && hueco > 1) texto += ' ';
      }
      texto += it.str;
      previo = it;
    }
    const tamano = Math.max(...grupo.map((it) => it.alto));
    const y = grupo[0].y;
    return { texto: texto.replace(/\s+/g, ' ').trim(), tamano, y, pagina };
  });
}

/** Tamaño de letra más frecuente (ponderado por longitud): es el texto de cuerpo. */
function tamanoCuerpo(lineas: Linea[]): number {
  const pesos = new Map<number, number>();
  for (const l of lineas) {
    const clave = Math.round(l.tamano * 2) / 2;
    pesos.set(clave, (pesos.get(clave) ?? 0) + l.texto.length);
  }
  let mejor = 10;
  let peso = -1;
  for (const [tamano, p] of pesos) {
    if (p > peso) {
      mejor = tamano;
      peso = p;
    }
  }
  return mejor || 10;
}

/** Convierte líneas en bloques: títulos por tamaño, viñetas por símbolo, párrafos por espacio vertical. */
export function lineasABloques(lineas: Linea[]): Bloque[] {
  const cuerpo = tamanoCuerpo(lineas);
  const bloques: Bloque[] = [];
  let anterior: Linea | null = null;
  let tipoActual: Bloque['tipo'] | null = null;
  let acumulado = '';

  const cerrar = () => {
    const texto = acumulado.trim();
    if (tipoActual && texto) bloques.push({ tipo: tipoActual, texto } as Bloque);
    acumulado = '';
    tipoActual = null;
  };

  for (const linea of lineas) {
    if (!linea.texto) continue;
    let tipo: Bloque['tipo'] = 'parrafo';
    let texto = linea.texto;
    if (linea.tamano >= cuerpo * 1.6) tipo = 'titulo1';
    else if (linea.tamano >= cuerpo * 1.25) tipo = 'titulo2';
    else if (VINETA.test(texto)) {
      tipo = 'vineta';
      texto = texto.replace(VINETA, '');
    }

    const saltoDePagina = anterior !== null && anterior.pagina !== linea.pagina;
    const hueco = anterior && !saltoDePagina ? anterior.y - linea.y : 0;
    const cortarPorEspacio = anterior !== null && hueco > Math.max(cuerpo, anterior.tamano) * 1.9;
    const cortarPorPagina = saltoDePagina && anterior !== null && FIN_DE_FRASE.test(anterior.texto);
    const cambioTipo = tipo !== tipoActual;

    if (tipoActual === null || cambioTipo || tipo === 'vineta' || cortarPorEspacio || cortarPorPagina) {
      cerrar();
      tipoActual = tipo;
      acumulado = texto;
    } else if (acumulado.endsWith('-') && /^[a-záéíóúñü]/.test(texto)) {
      acumulado = acumulado.slice(0, -1) + texto;
    } else {
      acumulado += ' ' + texto;
    }
    anterior = linea;
  }
  cerrar();
  return bloques;
}

/** Extrae el texto del PDF y lo devuelve como bloques editables. */
export async function pdfABloques(bytes: Uint8Array): Promise<Bloque[]> {
  const { lineas } = await extraerLineas(bytes);
  const bloques = lineasABloques(lineas);
  const caracteres = bloques.reduce((n, b) => n + b.texto.length, 0);
  if (caracteres < 1) {
    throw new PdfTextoError('El PDF no tiene texto seleccionable. Si es un escaneo (fotos de páginas), no se puede convertir a texto.');
  }
  return bloques;
}

const XML_ESCAPE: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };

function xml(texto: string): string {
  return texto.replace(/[&<>"']/g, (c) => XML_ESCAPE[c]).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
}

function parrafoXml(b: Bloque): string {
  const estilo = b.tipo === 'titulo1' ? 'Heading1' : b.tipo === 'titulo2' ? 'Heading2' : null;
  const pPr = [
    estilo ? `<w:pStyle w:val="${estilo}"/>` : '',
    b.tipo === 'vineta' ? '<w:ind w:left="360" w:hanging="360"/>' : '',
  ].join('');
  const texto = b.tipo === 'vineta' ? `•\t${b.texto}` : b.texto;
  const partes = texto.split('\t').map((p, i) => (i === 0 ? xml(p) : `<w:tab/>${xml(p)}`)).join('');
  return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${partes}</w:t></w:r></w:p>`;
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
</Types>`;

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="es-AR"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="360" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>
</w:styles>`;

/** Arma un .docx mínimo (OOXML) con los bloques dados. */
export function bloquesADocx(bloques: Bloque[]): Buffer {
  const cuerpo = bloques.map(parrafoXml).join('');
  const documento = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${cuerpo}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const enc = (s: string) => new TextEncoder().encode(s);
  return buildZip([
    { name: '[Content_Types].xml', data: enc(CONTENT_TYPES) },
    { name: '_rels/.rels', data: enc(ROOT_RELS) },
    { name: 'word/document.xml', data: enc(documento) },
    { name: 'word/styles.xml', data: enc(STYLES) },
    { name: 'word/_rels/document.xml.rels', data: enc(DOC_RELS) },
  ]);
}
