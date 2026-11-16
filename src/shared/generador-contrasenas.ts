/*
 * Lógica del generador de contraseñas. Sin dependencias ni IA: usa crypto.getRandomValues
 * (CSPRNG del navegador) con muestreo por rechazo, para que cada carácter sea equiprobable
 * (sin sesgo por módulo). La fortaleza se estima por entropía: longitud × log2(tamaño del alfabeto).
 */

export const CONJUNTOS = {
  mayusculas: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  minusculas: 'abcdefghijklmnopqrstuvwxyz',
  numeros: '0123456789',
  simbolos: '!@#$%^&*()-_=+[]{};:,.<>?/',
} as const;

/** Caracteres que se confunden a simple vista (0/O, 1/l/I). */
const AMBIGUOS = '0O1lI';

export type NombreConjunto = keyof typeof CONJUNTOS;

export interface OpcionesContrasena {
  longitud: number;
  mayusculas: boolean;
  minusculas: boolean;
  numeros: boolean;
  simbolos: boolean;
  sinAmbiguos: boolean;
}

export const LONGITUD_MIN = 8;
export const LONGITUD_MAX = 128;
export const LONGITUD_DEFAULT = 16;

export type ResultadoGeneracion = { ok: true; contrasena: string } | { ok: false; error: string };

/** Devuelve un entero uniforme en [0, max) usando solo CSPRNG. */
export function enteroAleatorio(max: number, random: (buf: Uint32Array<ArrayBuffer>) => Uint32Array<ArrayBuffer> = llenarAleatorio): number {
  if (!Number.isInteger(max) || max <= 0 || max > 0x100000000) throw new RangeError('max fuera de rango');
  // Límite múltiplo de max: los valores por encima se descartan para evitar sesgo.
  const limite = Math.floor(0x100000000 / max) * max;
  const buf = new Uint32Array(new ArrayBuffer(4));
  for (;;) {
    const valor = random(buf)[0] ?? 0;
    if (valor < limite) return valor % max;
  }
}

function llenarAleatorio(buf: Uint32Array<ArrayBuffer>): Uint32Array<ArrayBuffer> {
  crypto.getRandomValues(buf);
  return buf;
}

/** Caracteres disponibles según los conjuntos elegidos (sin repetidos). */
export function alfabetoDe(opciones: Pick<OpcionesContrasena, NombreConjunto | 'sinAmbiguos'>): string[] {
  const usados: NombreConjunto[] = (Object.keys(CONJUNTOS) as NombreConjunto[]).filter((n) => opciones[n]);
  return usados.map((n) => quitarAmbiguos(CONJUNTOS[n], opciones.sinAmbiguos));
}

function quitarAmbiguos(texto: string, sinAmbiguos: boolean): string {
  if (!sinAmbiguos) return texto;
  return [...texto].filter((c) => !AMBIGUOS.includes(c)).join('');
}

export function conjuntosElegidos(opciones: OpcionesContrasena): NombreConjunto[] {
  return (Object.keys(CONJUNTOS) as NombreConjunto[]).filter((n) => opciones[n]);
}

/** Tamaño del alfabeto combinado (caracteres distintos). */
export function tamanoAlfabeto(opciones: OpcionesContrasena): number {
  return new Set(alfabetoDe(opciones).join('')).size;
}

/** Entropía estimada en bits: longitud × log2(alfabeto). */
export function entropiaBits(opciones: OpcionesContrasena): number {
  const n = tamanoAlfabeto(opciones);
  if (n < 2) return 0;
  return opciones.longitud * Math.log2(n);
}

export function generarContrasena(
  opciones: OpcionesContrasena,
  random: (buf: Uint32Array<ArrayBuffer>) => Uint32Array<ArrayBuffer> = llenarAleatorio,
): ResultadoGeneracion {
  const { longitud } = opciones;
  if (!Number.isInteger(longitud) || longitud < LONGITUD_MIN || longitud > LONGITUD_MAX) {
    return { ok: false, error: `La longitud debe estar entre ${LONGITUD_MIN} y ${LONGITUD_MAX} caracteres.` };
  }
  const grupos = alfabetoDe(opciones).filter((g) => g.length > 0);
  if (grupos.length === 0) {
    return { ok: false, error: 'Elegí al menos un tipo de carácter.' };
  }
  const todos = grupos.join('');
  // Garantiza al menos un carácter de cada tipo elegido, si la longitud lo permite.
  const caracteres: string[] = [];
  if (grupos.length <= longitud) {
    for (const g of grupos) caracteres.push(g[enteroAleatorio(g.length, random)] ?? '');
  }
  while (caracteres.length < longitud) {
    caracteres.push(todos[enteroAleatorio(todos.length, random)] ?? '');
  }
  // Mezcla Fisher-Yates para que los caracteres garantizados no queden siempre al principio.
  for (let i = caracteres.length - 1; i > 0; i--) {
    const j = enteroAleatorio(i + 1, random);
    [caracteres[i], caracteres[j]] = [caracteres[j] ?? '', caracteres[i] ?? ''];
  }
  return { ok: true, contrasena: caracteres.join('') };
}

export type NivelFortaleza = 'muy-debil' | 'debil' | 'aceptable' | 'fuerte' | 'muy-fuerte';

export interface Fortaleza {
  nivel: NivelFortaleza;
  etiqueta: string;
  bits: number;
  /** 0–100, para dibujar la barra. */
  porcentaje: number;
}

const ESCALA_BITS = 128;

export function evaluarFortaleza(bits: number): Fortaleza {
  const b = Math.max(0, bits);
  const porcentaje = Math.round(Math.min(100, (b / ESCALA_BITS) * 100));
  if (b < 28) return { nivel: 'muy-debil', etiqueta: 'Muy débil', bits: b, porcentaje };
  if (b < 40) return { nivel: 'debil', etiqueta: 'Débil', bits: b, porcentaje };
  if (b < 60) return { nivel: 'aceptable', etiqueta: 'Aceptable', bits: b, porcentaje };
  if (b < 80) return { nivel: 'fuerte', etiqueta: 'Fuerte', bits: b, porcentaje };
  return { nivel: 'muy-fuerte', etiqueta: 'Muy fuerte', bits: b, porcentaje };
}

/** Tiempo orientativo para un atacante que prueba 10 mil millones de intentos por segundo (GPU de gama alta). */
export function tiempoDeCrackeo(bits: number): string {
  const segundos = Math.pow(2, bits) / 1e10 / 2;
  if (!Number.isFinite(segundos) || segundos > 3e16) return 'más que la edad del universo';
  const unidades: [number, string][] = [
    [31536000, 'años'],
    [86400, 'días'],
    [3600, 'horas'],
    [60, 'minutos'],
    [1, 'segundos'],
  ];
  if (segundos < 1) return 'menos de un segundo';
  for (const [factor, nombre] of unidades) {
    if (segundos >= factor) {
      const cantidad = Math.round(segundos / factor);
      if (factor === 31536000 && cantidad >= 1000) return `unos ${formatearMiles(cantidad)} años`;
      return `unos ${cantidad} ${cantidad === 1 ? singular(nombre) : nombre}`;
    }
  }
  return 'menos de un segundo';
}

function singular(nombre: string): string {
  return nombre.replace(/s$/, '');
}

function formatearMiles(n: number): string {
  return n.toLocaleString('es-AR');
}
