/*
 * Herramientas de dominios (categoría «Dominios»): punycode, disponibilidad por RDAP, generador de
 * nombres, valoración orientativa y revisión de selectores DKIM. Solo funciones puras y reglas;
 * las consultas de red las hacen las páginas.
 */
import { esHostValido, normalizarHost } from './redes.ts';

// ---------------------------------------------------------------------------
// Punycode (RFC 3492): decodificación propia; la codificación usa la API URL del navegador.
// ---------------------------------------------------------------------------

const BASE = 36;
const TMIN = 1;
const TMAX = 26;
const SKEW = 38;
const DAMP = 700;
const BIAS_INICIAL = 72;
const N_INICIAL = 128;

function adaptar(delta: number, puntos: number, primeraVez: boolean): number {
  let d = primeraVez ? Math.floor(delta / DAMP) : Math.floor(delta / 2);
  d += Math.floor(d / puntos);
  let k = 0;
  while (d > ((BASE - TMIN) * TMAX) / 2) {
    d = Math.floor(d / (BASE - TMIN));
    k += BASE;
  }
  return k + Math.floor(((BASE - TMIN + 1) * d) / (d + SKEW));
}

/** Decodifica una etiqueta «xn--…» (sin el prefijo). Devuelve null si no es válida. */
function decodificarEtiqueta(entrada: string): string | null {
  const salida: number[] = [];
  const base = entrada.lastIndexOf('-');
  for (let j = 0; j < Math.max(base, 0); j++) {
    const c = entrada.charCodeAt(j);
    if (c >= 0x80) return null;
    salida.push(c);
  }
  let n = N_INICIAL;
  let i = 0;
  let bias = BIAS_INICIAL;
  for (let pos = base > 0 ? base + 1 : 0; pos < entrada.length; ) {
    const previa = i;
    let peso = 1;
    for (let k = BASE; ; k += BASE) {
      if (pos >= entrada.length) return null;
      const c = entrada.charCodeAt(pos++);
      const digito = c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97 < 26 ? c - 97 : BASE;
      if (digito >= BASE) return null;
      i += digito * peso;
      const t = k <= bias ? TMIN : k >= bias + TMAX ? TMAX : k - bias;
      if (digito < t) break;
      peso *= BASE - t;
    }
    bias = adaptar(i - previa, salida.length + 1, previa === 0);
    n += Math.floor(i / (salida.length + 1));
    i %= salida.length + 1;
    salida.splice(i, 0, n);
    i++;
  }
  return String.fromCodePoint(...salida);
}

/** Pasa un dominio con «xn--» a su forma con tildes o alfabeto original. */
export function dominioUnicode(dominio: string): string {
  return dominio
    .split('.')
    .map((etiqueta) => {
      if (!etiqueta.toLowerCase().startsWith('xn--')) return etiqueta;
      const decodificada = decodificarEtiqueta(etiqueta.slice(4).toLowerCase());
      return decodificada ?? etiqueta;
    })
    .join('.');
}

/** Pasa un dominio con tildes o alfabeto original a la forma ASCII («xn--»). Null si no se puede. */
export function dominioAscii(dominio: string): string | null {
  try {
    const host = new URL(`http://${dominio}`).hostname;
    return host === '' ? null : host;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Validación y disponibilidad
// ---------------------------------------------------------------------------

export interface DominioValidado {
  ok: true;
  ascii: string;
  unicode: string;
  tld: string;
}
export type ResultadoDominio = DominioValidado | { ok: false; error: string };

/** Normaliza y valida un nombre de dominio (acepta tildes; devuelve la forma ASCII). */
export function validarDominio(entrada: string): ResultadoDominio {
  const limpio = normalizarHost(entrada);
  if (limpio === '') return { ok: false, error: 'Escribí un dominio, por ejemplo ejemplo.com.' };
  const ascii = dominioAscii(limpio);
  if (ascii === null || !esHostValido(ascii) || !ascii.includes('.')) {
    return { ok: false, error: 'Ese dominio no es válido. Revisá que tenga la forma nombre.extensión.' };
  }
  const tld = ascii.split('.').pop() ?? '';
  if (tld.length < 2) return { ok: false, error: 'La extensión del dominio no es válida.' };
  return { ok: true, ascii, unicode: dominioUnicode(ascii), tld };
}

export type EstadoDisponibilidad = 'libre' | 'registrado' | 'desconocido';

/** Interpreta el código HTTP de una consulta RDAP de dominio: 404 = no registrado. */
export function estadoDisponibilidad(codigoHttp: number): EstadoDisponibilidad {
  if (codigoHttp === 404) return 'libre';
  if (codigoHttp === 200) return 'registrado';
  return 'desconocido';
}

// ---------------------------------------------------------------------------
// Generador de nombres
// ---------------------------------------------------------------------------

const ETIQUETA_VALIDA = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Limpia una palabra para usarla en un dominio: minúsculas, sin tildes ni símbolos. */
export function limpiarPalabra(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '');
}

/**
 * Combina palabras clave con prefijos y sufijos habituales (y de a dos palabras) para proponer
 * nombres de dominio. Devuelve nombres sin repetir, solo con etiquetas válidas, hasta `maximo`.
 */
export function generarNombres(palabras: string[], prefijos: string[], sufijos: string[], maximo = 60): string[] {
  const base = palabras.map(limpiarPalabra).filter((p) => p !== '');
  const pre = prefijos.map(limpiarPalabra).filter((p) => p !== '');
  const suf = sufijos.map(limpiarPalabra).filter((p) => p !== '');
  const candidatos = new Set<string>();
  const agregar = (nombre: string): void => {
    if (candidatos.size < maximo && ETIQUETA_VALIDA.test(nombre)) candidatos.add(nombre);
  };
  for (const p of base) {
    agregar(p);
    for (const x of pre) agregar(`${x}${p}`);
    for (const x of suf) agregar(`${p}${x}`);
  }
  for (const a of base) {
    for (const b of base) {
      if (a !== b) agregar(`${a}${b}`);
    }
  }
  return [...candidatos];
}

// ---------------------------------------------------------------------------
// Valoración orientativa
// ---------------------------------------------------------------------------

export interface CriterioValoracion {
  titulo: string;
  detalle: string;
  puntos: number;
  maximo: number;
}

export interface ValoracionDominio {
  puntaje: number;
  criterios: CriterioValoracion[];
}

const EXTENSIONES_PUNTAJE: Record<string, number> = { com: 25, net: 18, org: 18, io: 14, co: 14, app: 14, dev: 14, ar: 12 };

/** Puntaje de 0 a 100 según longitud, caracteres, extensión y facilidad de pronunciación. Es orientativo. */
export function valorarDominio(ascii: string): ValoracionDominio {
  const partes = ascii.toLowerCase().split('.');
  const tld = partes.pop() ?? '';
  const nombre = partes.join('.');
  const criterios: CriterioValoracion[] = [];

  const largo = nombre.length;
  const puntosLargo = largo <= 8 ? 35 : largo <= 12 ? 25 : largo <= 15 ? 12 : 0;
  criterios.push({
    titulo: 'Longitud',
    detalle: `${largo} caracteres. Lo corto se recuerda y se escribe mejor.`,
    puntos: puntosLargo,
    maximo: 35,
  });

  const limpio = !/[-0-9]/.test(nombre);
  criterios.push({
    titulo: 'Sin guiones ni números',
    detalle: limpio ? 'Solo letras: más fácil de decir y de recordar.' : 'Tiene guiones o números: se confunde al dictarlo.',
    puntos: limpio ? 20 : 0,
    maximo: 20,
  });

  const puntosExt = EXTENSIONES_PUNTAJE[tld] ?? 5;
  criterios.push({
    titulo: 'Extensión',
    detalle: `.${tld}: ${puntosExt >= 18 ? 'extensión muy conocida' : 'extensión menos habitual'}.`,
    puntos: puntosExt,
    maximo: 25,
  });

  const letras = nombre.replace(/[^a-z]/g, '');
  const vocales = (letras.match(/[aeiou]/g) ?? []).length;
  const proporcion = letras.length === 0 ? 0 : vocales / letras.length;
  const consonantesSeguidas = /[^aeiou]{4,}/.test(letras);
  const pronunciable = proporcion >= 0.25 && proporcion <= 0.6 && !consonantesSeguidas;
  criterios.push({
    titulo: 'Pronunciación',
    detalle: pronunciable ? 'Se lee y se dice con naturalidad.' : 'Tiene muchas consonantes seguidas o pocas vocales: cuesta pronunciarlo.',
    puntos: pronunciable ? 20 : 8,
    maximo: 20,
  });

  const puntaje = criterios.reduce((total, c) => total + c.puntos, 0);
  return { puntaje, criterios };
}

// ---------------------------------------------------------------------------
// Correo: selectores DKIM comunes
// ---------------------------------------------------------------------------

/** Selectores DKIM que usan con frecuencia los proveedores de correo. */
export const SELECTORES_DKIM = ['default', 'google', 'selector1', 'selector2', 'k1', 'mail', 'dkim', 's1', 's2', 'mandrill', 'zoho', 'mxvault'];

/** Un registro TXT de DKIM tiene v=DKIM1 o la clave pública «p=». */
export function esRegistroDkim(texto: string): boolean {
  return /\bv=DKIM1\b/i.test(texto) || /(?:^|;)\s*p=[A-Za-z0-9+/=]+/.test(texto);
}
