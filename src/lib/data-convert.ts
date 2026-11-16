/*
 * Conversión de datos entre CSV, JSON, XML y Excel (.xlsx) en el navegador.
 * Funciones puras (sin DOM) para poder probarlas en node. Sin IA, sin red.
 *
 * Seguridad:
 * - JSON se lee con JSON.parse (nunca se ejecuta código).
 * - Las claves se guardan como propiedades propias (defineProperty), así una clave
 *   "__proto__" no altera el prototipo de los objetos.
 * - XML con DTD o entidades se rechaza (evita XXE y expansión de entidades).
 * - Al exportar a CSV se neutralizan las celdas que Excel interpretaría como fórmula
 *   (empiezan con = + - @ o tabulador), anteponiendo una comilla simple.
 */
import Papa from 'papaparse';
import { buildZipStore } from '../shared/zip-store.ts';

export const DATOS_LIMITS = {
  maxBytesTexto: 20 * 1024 * 1024,
  maxBytesExcel: 10 * 1024 * 1024,
  maxFilas: 200_000,
  maxColumnas: 2_000,
  maxProfundidadXml: 64,
} as const;

export type Matriz = string[][];

export class ErrorDatos extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorDatos';
  }
}

const BOM = '﻿';

export function quitarBom(texto: string): string {
  return texto.startsWith(BOM) ? texto.slice(1) : texto;
}

/** Guarda una propiedad propia aunque la clave sea "__proto__". */
function ponerPropiedad(obj: Record<string, unknown>, clave: string, valor: unknown): void {
  Object.defineProperty(obj, clave, { value: valor, enumerable: true, writable: true, configurable: true });
}

/** Neutraliza valores que Excel tomaría como fórmula al abrir el CSV. */
export function protegerFormula(valor: string): string {
  return /^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor;
}

/** Nombres de columna legibles: vacíos -> columna_N, repetidos -> nombre_2, nombre_3… */
export function nombresDeColumna(cabecera: string[]): string[] {
  if (cabecera.length > DATOS_LIMITS.maxColumnas) {
    throw new ErrorDatos(`El archivo tiene más de ${DATOS_LIMITS.maxColumnas} columnas.`);
  }
  const vistos = new Map<string, number>();
  return cabecera.map((bruto, i) => {
    const base = bruto.trim() || `columna_${i + 1}`;
    const n = (vistos.get(base) ?? 0) + 1;
    vistos.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
  });
}

// ---------- CSV -> JSON ----------

export interface OpcionesCsv {
  /** Delimitador; null detecta automáticamente entre coma, punto y coma, tabulador y barra vertical. */
  delimitador: string | null;
  primeraFilaEncabezado: boolean;
}

export interface ResultadoCsv {
  datos: unknown[];
  avisos: string[];
}

export function leerCsv(texto: string, delimitador: string | null): { filas: string[][]; avisos: string[] } {
  const res = Papa.parse<string[]>(quitarBom(texto), {
    header: false,
    skipEmptyLines: 'greedy',
    delimiter: delimitador ?? '',
  });
  const avisos = res.errors.slice(0, 5).map((e) => `Línea ${(e.row ?? 0) + 1}: ${e.message}`);
  if (res.data.length > DATOS_LIMITS.maxFilas) {
    throw new ErrorDatos(`El archivo tiene más de ${DATOS_LIMITS.maxFilas} filas.`);
  }
  return { filas: res.data, avisos };
}

export function csvAJson(texto: string, opciones: OpcionesCsv): ResultadoCsv {
  const { filas, avisos } = leerCsv(texto, opciones.delimitador);
  if (!opciones.primeraFilaEncabezado) return { datos: filas, avisos };
  if (filas.length === 0) return { datos: [], avisos };

  const encabezados = nombresDeColumna(filas[0]);
  const datos = filas.slice(1).map((fila) => {
    const obj: Record<string, unknown> = {};
    const n = Math.max(fila.length, encabezados.length);
    for (let i = 0; i < n; i++) {
      ponerPropiedad(obj, encabezados[i] ?? `columna_${i + 1}`, fila[i] ?? '');
    }
    return obj;
  });
  return { datos, avisos };
}

// ---------- JSON -> CSV ----------

export function valorATexto(valor: unknown): string {
  if (valor === undefined || valor === null) return '';
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'object') return JSON.stringify(valor);
  return String(valor);
}

/** Convierte el JSON en una lista de objetos. Un valor suelto o una lista de valores se envuelve en {valor}. */
export function jsonAFilas(texto: string): Record<string, unknown>[] {
  let valor: unknown;
  try {
    valor = JSON.parse(quitarBom(texto));
  } catch (e) {
    throw new ErrorDatos(`El JSON no es válido: ${(e as Error).message}`);
  }
  const lista = Array.isArray(valor) ? valor : [valor];
  if (lista.length > DATOS_LIMITS.maxFilas) {
    throw new ErrorDatos(`El JSON tiene más de ${DATOS_LIMITS.maxFilas} registros.`);
  }
  return lista.map((item) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? (item as Record<string, unknown>)
      : { valor: item },
  );
}

export function jsonAMatriz(texto: string, protegerFormulas: boolean): Matriz {
  const filas = jsonAFilas(texto);
  const columnas: string[] = [];
  const vistas = new Set<string>();
  for (const fila of filas) {
    for (const clave of Object.keys(fila)) {
      if (!vistas.has(clave)) {
        vistas.add(clave);
        columnas.push(clave);
      }
    }
  }
  if (columnas.length > DATOS_LIMITS.maxColumnas) {
    throw new ErrorDatos(`El JSON tiene más de ${DATOS_LIMITS.maxColumnas} columnas distintas.`);
  }
  const celda = (s: string) => (protegerFormulas ? protegerFormula(s) : s);
  const matriz: Matriz = [columnas.map(celda)];
  for (const fila of filas) {
    matriz.push(
      columnas.map((c) => celda(valorATexto(Object.prototype.hasOwnProperty.call(fila, c) ? fila[c] : undefined))),
    );
  }
  return matriz;
}

// ---------- Excel -> CSV ----------

function valorDeHojaATexto(valor: unknown): string {
  if (valor === undefined || valor === null) return '';
  if (valor instanceof Date) return Number.isNaN(valor.getTime()) ? '' : valor.toISOString();
  if (typeof valor === 'boolean') return valor ? 'TRUE' : 'FALSE';
  if (typeof valor === 'string') return valor;
  return String(valor);
}

export function hojaAMatriz(filas: ReadonlyArray<ReadonlyArray<unknown>>, protegerFormulas: boolean): Matriz {
  if (filas.length > DATOS_LIMITS.maxFilas) {
    throw new ErrorDatos(`La hoja tiene más de ${DATOS_LIMITS.maxFilas} filas.`);
  }
  return filas.map((fila) =>
    fila.map((valor) => {
      const texto = valorDeHojaATexto(valor);
      return protegerFormulas ? protegerFormula(texto) : texto;
    }),
  );
}

// ---------- Matriz -> CSV ----------

export function matrizACsv(matriz: Matriz, delimitador: string): string {
  return Papa.unparse(matriz, { delimiter: delimitador, newline: '\r\n' });
}

// ---------- XML -> JSON ----------

/** Subconjunto de nodos del DOM que usa la conversión (así se puede probar sin navegador). */
export interface NodoXml {
  nodeType: number;
  nodeName: string;
  nodeValue: string | null;
  childNodes: ArrayLike<NodoXml>;
  attributes?: ArrayLike<{ name: string; value: string }> | null;
}

const NODO_ELEMENTO = 1;
const NODO_TEXTO = 3;
const NODO_CDATA = 4;

/** Rechaza DTD y entidades declaradas: evita XXE y la expansión de entidades ("billion laughs"). */
export function rechazarXmlPeligroso(texto: string): void {
  if (/<!DOCTYPE|<!ENTITY/i.test(texto)) {
    throw new ErrorDatos('Este XML declara un DTD o entidades, y no se admite por seguridad.');
  }
}

/**
 * Convierte el elemento raíz en un objeto:
 * - atributos -> "@nombre"; texto -> "#text"
 * - hijos con el mismo nombre -> lista
 * - elemento solo con texto -> cadena
 */
export function xmlAJson(raiz: NodoXml): Record<string, unknown> {
  return { [raiz.nodeName]: elementoAValor(raiz, 1) };
}

function elementoAValor(el: NodoXml, profundidad: number): unknown {
  if (profundidad > DATOS_LIMITS.maxProfundidadXml) {
    throw new ErrorDatos('El XML está anidado con demasiada profundidad.');
  }
  const atributos = Array.from(el.attributes ?? []);
  const hijos = Array.from(el.childNodes);
  const elementos = hijos.filter((h) => h.nodeType === NODO_ELEMENTO);
  const texto = hijos
    .filter((h) => h.nodeType === NODO_TEXTO || h.nodeType === NODO_CDATA)
    .map((h) => h.nodeValue ?? '')
    .join('')
    .trim();

  if (atributos.length === 0 && elementos.length === 0) return texto;

  const obj: Record<string, unknown> = {};
  for (const a of atributos) ponerPropiedad(obj, `@${a.name}`, a.value);
  for (const h of elementos) {
    const valor = elementoAValor(h, profundidad + 1);
    if (!Object.prototype.hasOwnProperty.call(obj, h.nodeName)) {
      ponerPropiedad(obj, h.nodeName, valor);
    } else {
      const previo = obj[h.nodeName];
      // Los valores de elemento nunca son listas, así que un array aquí es un grupo ya abierto.
      if (Array.isArray(previo)) previo.push(valor);
      else ponerPropiedad(obj, h.nodeName, [previo, valor]);
    }
  }
  if (texto) ponerPropiedad(obj, '#text', texto);
  return obj;
}

// ---------- CSV -> Excel (.xlsx) ----------

/** Números que se guardan como número en Excel. Con ceros a la izquierda o más de 15 dígitos quedan como texto. */
const NUMERO_SEGURO = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/** Quita caracteres que XML 1.0 no admite (controles), que harían inválido el .xlsx. */
function xmlSeguro(texto: string): string {
  return texto.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '');
}

function escaparXml(texto: string): string {
  return xmlSeguro(texto)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Letras de columna de Excel: 0 → A, 25 → Z, 26 → AA. */
export function letraColumna(indice: number): string {
  let n = indice + 1;
  let letras = '';
  while (n > 0) {
    const resto = (n - 1) % 26;
    letras = String.fromCharCode(65 + resto) + letras;
    n = Math.floor((n - 1) / 26);
  }
  return letras;
}

function celdaXml(ref: string, texto: string): string {
  const digitos = texto.replace(/^-|\./g, '').length;
  if (NUMERO_SEGURO.test(texto) && digitos <= 15) return `<c r="${ref}"><v>${texto}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escaparXml(texto)}</t></is></c>`;
}

/** Arma un libro .xlsx mínimo con una hoja. Los textos van como texto (Excel no los ejecuta como fórmulas). */
export function matrizAXlsx(matriz: Matriz, nombreHoja = 'Datos'): Uint8Array {
  if (matriz.length > DATOS_LIMITS.maxFilas) {
    throw new ErrorDatos(`La hoja tiene más de ${DATOS_LIMITS.maxFilas} filas.`);
  }
  const filasXml = matriz
    .map((fila, r) => {
      const celdas = fila
        .map((valor, c) => (valor === '' ? '' : celdaXml(`${letraColumna(c)}${r + 1}`, valor)))
        .join('');
      return `<row r="${r + 1}">${celdas}</row>`;
    })
    .join('');

  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const RELS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const archivos = [
    {
      name: '[Content_Types].xml',
      xml: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    },
    {
      name: '_rels/.rels',
      xml: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RELS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    },
    {
      name: 'xl/workbook.xml',
      xml: `${XML}<workbook xmlns="${NS}" xmlns:r="${RELS}"><sheets><sheet name="${escaparXml(nombreHoja.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      xml: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${RELS}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${RELS}/styles" Target="styles.xml"/></Relationships>`,
    },
    {
      name: 'xl/styles.xml',
      xml: `${XML}<styleSheet xmlns="${NS}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`,
    },
    {
      name: 'xl/worksheets/sheet1.xml',
      xml: `${XML}<worksheet xmlns="${NS}"><sheetData>${filasXml}</sheetData></worksheet>`,
    },
  ];
  const encoder = new TextEncoder();
  return buildZipStore(archivos.map((a) => ({ name: a.name, data: encoder.encode(a.xml) })));
}

export function csvAXlsx(texto: string, delimitador: string | null): { bytes: Uint8Array; matriz: Matriz; avisos: string[] } {
  const { filas, avisos } = leerCsv(texto, delimitador);
  const matriz: Matriz = filas.map((fila) => fila.map((c) => c ?? ''));
  const columnas = matriz.reduce((max, fila) => Math.max(max, fila.length), 0);
  if (columnas > DATOS_LIMITS.maxColumnas) {
    throw new ErrorDatos(`El archivo tiene más de ${DATOS_LIMITS.maxColumnas} columnas.`);
  }
  return { bytes: matrizAXlsx(matriz), matriz, avisos };
}
