/*
 * Formatear y validar JSON/XML. Lógica pura, sin dependencias y sin IA:
 * - JSON: validador propio que indica línea y columna del primer error (con mensajes en español);
 *   el resultado se produce con JSON.parse y JSON.stringify nativos.
 * - XML: se verifica "bien formado" con DOMParser nativo (lo hace la página); aquí quedan la
 *   detección de DTD/entidades, la lectura de la posición del error y el formateo del árbol.
 * Nada de esto ejecuta código ni sale del navegador.
 */

export const FORMATO_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  maxProfundidad: 500,
} as const;

export type Sangria = 0 | 2 | 4 | 'tab';
export type TipoFormato = 'json' | 'xml';

export interface OpcionesJson {
  sangria: Sangria;
  ordenarClaves: boolean;
}

/** Error con posición opcional (línea y columna empiezan en 1). */
export class ErrorFormato extends Error {
  constructor(mensaje: string, linea: number | null = null, columna: number | null = null) {
    super(mensaje);
    this.name = 'ErrorFormato';
    this.linea = linea;
    this.columna = columna;
  }
  linea: number | null;
  columna: number | null;
}

/** Línea y columna (base 1) de un índice dentro del texto. */
export function ubicar(texto: string, indice: number): { linea: number; columna: number } {
  const fin = Math.min(Math.max(indice, 0), texto.length);
  let linea = 1;
  let columna = 1;
  for (let i = 0; i < fin; i++) {
    if (texto.charCodeAt(i) === 10) {
      linea++;
      columna = 1;
    } else {
      columna++;
    }
  }
  return { linea, columna };
}

/** Una fila del extracto: número de línea, texto visible y posición del carácter con error (o null). */
export interface FilaVista {
  numero: number;
  texto: string;
  errorEn: number | null;
}

const ANCHO_VISTA = 100;

/**
 * Filas alrededor del error (hasta 2 líneas antes y 1 después) con sus números.
 * En la línea del error indica en qué posición del texto visible está el carácter a marcar.
 * Si el error está al final de la línea, marca un espacio extra.
 * Las líneas muy largas se recortan en una ventana alrededor del error.
 */
export function construirVistaError(texto: string, linea: number, columna: number): FilaVista[] {
  const todas = texto.split('\n');
  const primera = Math.max(1, linea - 2);
  const ultima = Math.min(todas.length, linea + 1);
  const filas: FilaVista[] = [];
  for (let n = primera; n <= ultima; n++) {
    let crudo = (todas[n - 1] ?? '').replace(/\r$/, '').replace(/\t/g, ' ');
    if (n !== linea) {
      const corto = crudo.length > ANCHO_VISTA ? crudo.slice(0, ANCHO_VISTA) + '…' : crudo;
      filas.push({ numero: n, texto: corto, errorEn: null });
      continue;
    }
    const pos = Math.min(Math.max(0, columna - 1), crudo.length);
    if (pos === crudo.length) crudo += ' ';
    const ini = Math.max(0, pos - Math.floor(ANCHO_VISTA / 2));
    const fin = Math.min(crudo.length, ini + ANCHO_VISTA);
    const prefijo = ini > 0 ? '…' : '';
    const sufijo = fin < crudo.length ? '…' : '';
    filas.push({
      numero: n,
      texto: prefijo + crudo.slice(ini, fin) + sufijo,
      errorEn: prefijo.length + (pos - ini),
    });
  }
  return filas;
}

/**
 * Detecta si el contenido es JSON o XML. Devuelve null si no se puede saber.
 * - Empieza con «<» → XML (con o sin declaración <?xml ?>, con comentarios antes del elemento).
 * - Empieza con «{» o «[» → JSON (aunque tenga errores, así se marcan).
 * - Un valor suelto válido (12, "texto", true, null) → JSON.
 * - Contiene etiquetas <nombre> pero no empieza como XML → XML.
 */
export function detectarTipo(texto: string): TipoFormato | null {
  const t = texto.replace(/^﻿/, '').trimStart();
  if (t === '') return null;
  if (t.startsWith('<')) return 'xml';
  if (t.startsWith('{') || t.startsWith('[')) return 'json';
  if (comprobarJson(t) === null) return 'json';
  if (/<[A-Za-z_][\w.-]*(\s[^<>]*)?\/?>/.test(t)) return 'xml';
  return null;
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

class FalloJson extends Error {
  constructor(indice: number, mensaje: string) {
    super(mensaje);
    this.name = 'FalloJson';
    this.indice = indice;
  }
  indice: number;
}

const ESPACIO = /[ \t\r\n]/;
const NUMERO = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const ESCAPE_VALIDO = '"\\/bfnrt';

/**
 * Recorre el texto como lo haría un parser JSON estricto y devuelve el primer error con su índice.
 * Devuelve null si el texto es un JSON válido.
 */
export function localizarErrorJson(texto: string): { indice: number; mensaje: string } | null {
  const n = texto.length;
  let i = 0;

  function fallo(mensaje: string, indice: number = i): never {
    throw new FalloJson(indice, mensaje);
  }

  function inesperado(): never {
    if (i >= n) fallo('El JSON termina antes de tiempo: faltan cerrar llaves, corchetes o comillas.');
    fallo(`Carácter inesperado «${texto[i]}».`);
  }

  function saltarEspacios(): void {
    while (i < n && ESPACIO.test(texto[i])) i++;
  }

  function cadena(): void {
    const inicio = i;
    i++; // comilla de apertura
    for (;;) {
      if (i >= n) fallo('Falta cerrar la cadena con comillas dobles.', inicio);
      const c = texto[i];
      if (c === '"') {
        i++;
        return;
      }
      if (c < ' ') fallo('Hay un salto de línea o un carácter de control dentro de una cadena. Usá \\n para los saltos.');
      if (c === '\\') {
        if (i + 1 >= n) fallo('Falta el carácter que sigue a la barra invertida.', i);
        const e = texto[i + 1];
        if (ESCAPE_VALIDO.includes(e)) {
          i += 2;
          continue;
        }
        if (e === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(texto.slice(i + 2, i + 6))) {
            fallo('El escape \\u debe tener 4 dígitos hexadecimales.', i);
          }
          i += 6;
          continue;
        }
        fallo(`Escape no válido «\\${e}».`, i);
      }
      i++;
    }
  }

  function numero(): void {
    NUMERO.lastIndex = i;
    const m = NUMERO.exec(texto);
    if (!m) {
      if (texto[i] === '-') fallo('Después del signo menos debe haber un número.', i + 1);
      fallo('Número mal escrito.');
    }
    i += m[0].length;
  }

  function valor(profundidad: number): void {
    saltarEspacios();
    if (i >= n) inesperado();
    const c = texto[i];
    if (c === '{') return objeto(profundidad + 1);
    if (c === '[') return arreglo(profundidad + 1);
    if (c === '"') return cadena();
    if (c === '-' || (c >= '0' && c <= '9')) return numero();
    if (texto.startsWith('true', i)) {
      i += 4;
      return;
    }
    if (texto.startsWith('false', i)) {
      i += 5;
      return;
    }
    if (texto.startsWith('null', i)) {
      i += 4;
      return;
    }
    if (c === 't' || c === 'f' || c === 'n') fallo('Palabra no válida: se esperaba true, false o null.');
    inesperado();
  }

  function objeto(profundidad: number): void {
    if (profundidad > FORMATO_LIMITS.maxProfundidad) fallo('El JSON está anidado con demasiada profundidad.');
    i++; // llave de apertura
    saltarEspacios();
    if (texto[i] === '}') {
      i++;
      return;
    }
    for (;;) {
      saltarEspacios();
      if (i >= n) inesperado();
      if (texto[i] === '}') fallo('Sobra una coma antes de la llave de cierre «}».');
      if (texto[i] !== '"') fallo('Se esperaba una clave entre comillas dobles.');
      cadena();
      saltarEspacios();
      if (texto[i] !== ':') {
        if (i >= n) inesperado();
        fallo('Se esperaba «:» después de la clave.');
      }
      i++;
      valor(profundidad);
      saltarEspacios();
      if (texto[i] === ',') {
        i++;
        continue;
      }
      if (texto[i] === '}') {
        i++;
        return;
      }
      if (i >= n) inesperado();
      fallo('Se esperaba «,» o «}» después del valor.');
    }
  }

  function arreglo(profundidad: number): void {
    if (profundidad > FORMATO_LIMITS.maxProfundidad) fallo('El JSON está anidado con demasiada profundidad.');
    i++; // corchete de apertura
    saltarEspacios();
    if (texto[i] === ']') {
      i++;
      return;
    }
    for (;;) {
      valor(profundidad);
      saltarEspacios();
      if (texto[i] === ',') {
        i++;
        saltarEspacios();
        if (texto[i] === ']') fallo('Sobra una coma antes del corchete de cierre «]».');
        continue;
      }
      if (texto[i] === ']') {
        i++;
        return;
      }
      if (i >= n) inesperado();
      fallo('Se esperaba «,» o «]» después del valor.');
    }
  }

  try {
    valor(0);
    saltarEspacios();
    if (i < n) fallo('Sobra contenido después del final del JSON.');
    return null;
  } catch (e) {
    if (e instanceof FalloJson) return { indice: e.indice, mensaje: e.message };
    throw e;
  }
}

/** Valida un JSON. Devuelve null si es válido, o un ErrorFormato con línea y columna. */
export function comprobarJson(texto: string): ErrorFormato | null {
  if (texto.trim() === '') return new ErrorFormato('El texto está vacío.');
  const error = localizarErrorJson(texto);
  if (!error) return null;
  const { linea, columna } = ubicar(texto, error.indice);
  return new ErrorFormato(error.mensaje, linea, columna);
}

export interface ReparacionJson {
  /** Texto corregido (si quedó válido) o el último estado alcanzado. */
  texto: string;
  /** Qué se cambió, en español, con la línea y columna del cambio. */
  cambios: string[];
  /** Error que sigue existiendo, o null si el texto corregido es válido. */
  error: ErrorFormato | null;
}

const INICIO_VALOR = /["{[\-\dtfn]/;
const CARACTER_ESTRUCTURAL = /[\s{}[\],:"\-\dtfn]/;
const MAX_CORRECCIONES = 1000;

/** Cierra en orden las llaves y corchetes que quedaron abiertos al final del texto. */
function cerrarEstructuras(texto: string): string | null {
  const pila: string[] = [];
  let enCadena = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (enCadena) {
      if (c === '\\') i++;
      else if (c === '"') enCadena = false;
      continue;
    }
    if (c === '"') enCadena = true;
    else if (c === '{') pila.push('}');
    else if (c === '[') pila.push(']');
    else if (c === '}' || c === ']') pila.pop();
  }
  if (enCadena) return null;
  return pila.reverse().join('');
}

/** Intenta una corrección segura para el error en `indice`. Devuelve null si no sabe arreglarlo. */
function corregirEn(texto: string, fallo: { indice: number; mensaje: string }): { texto: string; descripcion: string } | null {
  const i = fallo.indice;
  const { linea, columna } = ubicar(texto, i);
  const donde = `Línea ${linea}, columna ${columna}`;

  if (i >= texto.length) {
    const cierre = cerrarEstructuras(texto);
    if (!cierre) return null;
    return {
      texto: texto.trimEnd() + cierre,
      descripcion: `Final del texto: agregué «${cierre}» para cerrar lo que quedó abierto.`,
    };
  }

  if (fallo.mensaje.startsWith('Sobra una coma')) {
    let j = i - 1;
    while (j >= 0 && /\s/.test(texto[j])) j--;
    if (texto[j] !== ',') return null;
    return {
      texto: texto.slice(0, j) + texto.slice(j + 1),
      descripcion: `${donde}: quité la coma sobrante.`,
    };
  }

  const c = texto[i];

  // Clave sin comillas, por ejemplo {nombre: "Ana"}: se agregan las comillas.
  if (fallo.mensaje.startsWith('Se esperaba una clave') && /[A-Za-z_]/.test(c)) {
    const m = /^[A-Za-z_]\w*/.exec(texto.slice(i));
    if (m && /^\s*:/.test(texto.slice(i + m[0].length))) {
      return {
        texto: `${texto.slice(0, i)}"${m[0]}"${texto.slice(i + m[0].length)}`,
        descripcion: `${donde}: agregué las comillas a la clave «${m[0]}».`,
      };
    }
  }

  // Coma que falta entre dos valores o pares.
  if (/Se esperaba «,»/.test(fallo.mensaje) && INICIO_VALOR.test(c)) {
    return {
      texto: `${texto.slice(0, i)},${texto.slice(i)}`,
      descripcion: `${donde}: agregué la coma que faltaba.`,
    };
  }

  // Carácter suelto que no pertenece al JSON (como la «s» de la captura): se quita.
  if (!CARACTER_ESTRUCTURAL.test(c)) {
    return {
      texto: texto.slice(0, i) + texto.slice(i + 1),
      descripcion: `${donde}: quité el carácter sobrante «${c}».`,
    };
  }

  return null;
}

/**
 * Corrige errores simples de JSON y devuelve el texto corregido con la lista de cambios.
 * Solo hace arreglos seguros y acotados; si el error no es de esos, lo deja indicado en `error`.
 * El texto original nunca se modifica: se devuelve una copia.
 */
export function repararJson(original: string): ReparacionJson {
  const cambios: string[] = [];
  let texto = original;
  for (let paso = 0; paso < MAX_CORRECCIONES; paso++) {
    const fallo = localizarErrorJson(texto);
    if (!fallo) break;
    const arreglo = corregirEn(texto, fallo);
    if (!arreglo) break;
    texto = arreglo.texto;
    cambios.push(arreglo.descripcion);
  }
  const restante = comprobarJson(texto);
  if (restante === null) return { texto, cambios, error: null };
  // Sin correcciones aplicadas, el error es el original y así se muestra.
  if (cambios.length === 0) return { texto: original, cambios, error: comprobarJson(original) };
  return { texto, cambios, error: restante };
}

/** Copia recursiva con las claves ordenadas. Usa defineProperty para que "__proto__" sea una clave normal. */
export function ordenarClaves(valor: unknown): unknown {
  if (Array.isArray(valor)) return valor.map(ordenarClaves);
  if (valor !== null && typeof valor === 'object') {
    const origen = valor as Record<string, unknown>;
    const salida: Record<string, unknown> = {};
    for (const clave of Object.keys(origen).sort()) {
      Object.defineProperty(salida, clave, {
        value: ordenarClaves(origen[clave]),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return salida;
  }
  return valor;
}

/** Ordena o indenta un JSON válido. Lanza ErrorFormato si el texto no es válido. */
export function formatearJson(texto: string, opciones: OpcionesJson): string {
  const error = comprobarJson(texto);
  if (error) throw error;
  let valor = JSON.parse(texto) as unknown;
  if (opciones.ordenarClaves) valor = ordenarClaves(valor);
  const espacio = opciones.sangria === 'tab' ? '\t' : opciones.sangria;
  return JSON.stringify(valor, null, espacio);
}

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

export const NODO = {
  ELEMENTO: 1,
  TEXTO: 3,
  CDATA: 4,
  PI: 7,
  COMENTARIO: 8,
  DOCUMENTO: 9,
} as const;

/** Subconjunto de Node que usa el formateador (compatible con DOM y con objetos de prueba). */
export interface NodoXmlFormato {
  nodeType: number;
  nodeName: string;
  nodeValue: string | null;
  childNodes: ArrayLike<NodoXmlFormato>;
  attributes?: ArrayLike<{ name: string; value: string }>;
}

/** Rechaza DTD y entidades declaradas (evita expansiones y referencias externas). */
export function rechazarDtd(texto: string): void {
  if (/<!DOCTYPE|<!ENTITY/i.test(texto)) {
    throw new ErrorFormato('Este XML declara un DTD o entidades, y no se admite por seguridad.');
  }
}

/**
 * Interpreta el texto del elemento <parsererror> que devuelve DOMParser.
 * Chrome/Edge escriben «line N ... column M»; Firefox escribe «Line Number N, Column M».
 */
export function errorXmlDesdeMensaje(mensajeNavegador: string): ErrorFormato {
  const bruto = mensajeNavegador.replace(/\s+/g, ' ').trim();
  // Chrome antepone «This page contains the following errors:»; se descarta todo lo anterior al error.
  const inicio = bruto.search(/error on line|XML Parsing Error/i);
  const texto = inicio > 0 ? bruto.slice(inicio) : bruto;
  const linea = /line(?:\s*number)?\s*(\d+)/i.exec(texto);
  const columna = /column\s*(\d+)/i.exec(texto);
  // Solo el primer mensaje: Chrome agrega una frase de ayuda después y Firefox, la ubicación.
  const detalle = texto.split(/Below is a rendering|Location:/i)[0] ?? texto;
  const limpio = detalle
    .replace(/^XML Parsing Error:\s*/i, '')
    .replace(/^error on line \d+ at column \d+:\s*/i, '')
    .replace(/\s*Line Number \d+,?\s*Column \d+:?\s*$/i, '')
    .trim();
  const mensaje = limpio ? `El XML no está bien formado: ${limpio}` : 'El XML no está bien formado.';
  return new ErrorFormato(
    mensaje,
    linea ? Number(linea[1]) : null,
    columna ? Number(columna[1]) : null,
  );
}

/** Declaración <?xml ...?> del inicio, si existe. El DOM no la conserva como nodo. */
export function declaracionXml(texto: string): string | null {
  const m = /^﻿?\s*(<\?xml\s[^?]*\?>)/.exec(texto);
  return m ? m[1] : null;
}

function escaparTexto(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escaparAtributo(s: string): string {
  return escaparTexto(s)
    .replace(/"/g, '&quot;')
    .replace(/\t/g, '&#9;')
    .replace(/\n/g, '&#10;')
    .replace(/\r/g, '&#13;');
}

function esTextoVacio(nodo: NodoXmlFormato): boolean {
  return nodo.nodeType === NODO.TEXTO && (nodo.nodeValue ?? '').trim() === '';
}

/**
 * Escribe el árbol con sangría. Un elemento que solo contiene texto queda en una línea
 * (no se le agregan espacios, así no cambia su contenido). Los espacios sobrantes entre
 * elementos se descartan; los textos mixtos se recortan.
 */
export function formatearXml(doc: NodoXmlFormato, declaracion: string | null, sangria: string): string {
  const nl = sangria === '' ? '' : '\n';

  function render(nodo: NodoXmlFormato, nivel: number): string {
    const sangrar = sangria.repeat(nivel);
    switch (nodo.nodeType) {
      case NODO.TEXTO:
        return escaparTexto(nodo.nodeValue ?? '');
      case NODO.CDATA:
        return `<![CDATA[${nodo.nodeValue ?? ''}]]>`;
      case NODO.COMENTARIO:
        return `<!--${nodo.nodeValue ?? ''}-->`;
      case NODO.PI: {
        const datos = (nodo.nodeValue ?? '').trim();
        return datos ? `<?${nodo.nodeName} ${datos}?>` : `<?${nodo.nodeName}?>`;
      }
      case NODO.ELEMENTO: {
        const nombre = nodo.nodeName;
        const atributos = Array.from(nodo.attributes ?? [])
          .map((a) => ` ${a.name}="${escaparAtributo(a.value)}"`)
          .join('');
        const hijos = Array.from(nodo.childNodes);
        if (hijos.length === 0) return `<${nombre}${atributos}/>`;
        const soloTexto = hijos.every((h) => h.nodeType === NODO.TEXTO || h.nodeType === NODO.CDATA);
        if (soloTexto) {
          return `<${nombre}${atributos}>${hijos.map((h) => render(h, 0)).join('')}</${nombre}>`;
        }
        const bloques = hijos
          .filter((h) => !esTextoVacio(h))
          .map((h) => {
            const contenido = h.nodeType === NODO.TEXTO ? escaparTexto((h.nodeValue ?? '').trim()) : render(h, nivel + 1);
            return sangria.repeat(nivel + 1) + contenido;
          });
        return `<${nombre}${atributos}>${nl}${bloques.join(nl)}${nl}${sangrar}</${nombre}>`;
      }
      default:
        return '';
    }
  }

  const partes = Array.from(doc.childNodes)
    .filter((h) => !esTextoVacio(h))
    .map((h) => render(h, 0));
  const cuerpo = partes.join(nl);
  return declaracion ? `${declaracion}${nl}${cuerpo}` : cuerpo;
}

/** Convierte la opción de sangría en el texto que se usa para indentar XML. */
export function sangriaXml(sangria: Sangria): string {
  if (sangria === 'tab') return '\t';
  return ' '.repeat(sangria);
}
