/*
 * Lógica de «Acortador de enlaces»: validación, códigos cortos y registro de enlaces.
 * Sin IA, sin servicios externos y sin dependencias: solo funciones puras (se prueban con node --test).
 */

export const MAX_URL_LENGTH = 2048;
export const LONGITUD_CODIGO = 7;
/** Sin caracteres ambiguos (0/O, 1/l/I). */
export const ALFABETO = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const MAX_ENLACES = 500;

export interface EntradaEnlace {
  url: string;
  creado: number;
}

export type Registro = Record<string, EntradaEnlace>;

export type Validacion = { ok: true; url: string } | { ok: false; error: string };

/** Acepta solo URL http o https completas, sin credenciales y con tamaño acotado. */
export function validarUrl(entrada: string): Validacion {
  const texto = entrada.trim();
  if (!texto) return { ok: false, error: 'Pegá un enlace para acortarlo.' };
  if (texto.length > MAX_URL_LENGTH) {
    return { ok: false, error: `El enlace supera los ${MAX_URL_LENGTH} caracteres.` };
  }
  let url: URL;
  try {
    url = new URL(texto);
  } catch {
    return { ok: false, error: 'Escribí un enlace completo, que empiece con https:// o http://.' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return { ok: false, error: 'Solo se aceptan enlaces http o https.' };
  }
  if (url.username || url.password) {
    return { ok: false, error: 'El enlace no puede incluir usuario ni contraseña.' };
  }
  return { ok: true, url: url.href };
}

/**
 * Convierte bytes aleatorios en un código de LONGITUD_CODIGO caracteres.
 * Descarta los bytes que producirían sesgo (muestreo por rechazo), así cada carácter es equiprobable.
 */
export function generarCodigo(aleatorio: (n: number) => Uint8Array): string {
  const limite = 256 - (256 % ALFABETO.length);
  let codigo = '';
  while (codigo.length < LONGITUD_CODIGO) {
    for (const byte of aleatorio(LONGITUD_CODIGO)) {
      if (byte < limite && codigo.length < LONGITUD_CODIGO) {
        codigo += ALFABETO[byte % ALFABETO.length];
      }
    }
  }
  return codigo;
}

/** Prefijo corto de los enlaces: https://dominio/s/CODIGO */
export const PREFIJO_CORTO = '/s/';

const FORMATO_CODIGO = new RegExp(`^[${escaparClase(ALFABETO)}]{${LONGITUD_CODIGO}}$`);

/** Devuelve el código de /s/CODIGO (o de ?c=CODIGO, formato antiguo) si es válido; si no, null. */
export function codigoDesdeUrl(ruta: string, busqueda: string): string | null {
  const enRuta = ruta.startsWith(PREFIJO_CORTO) ? ruta.slice(PREFIJO_CORTO.length).replace(/\/$/, '') : '';
  const candidato = enRuta || new URLSearchParams(busqueda).get('c') || '';
  return FORMATO_CODIGO.test(candidato) ? candidato : null;
}

/** Enlace corto: origen + /s/ + código. */
export function construirEnlace(origen: string, codigo: string): string {
  return new URL(`${PREFIJO_CORTO}${codigo}`, origen).href;
}

/** Agrega un enlace al registro sin duplicar códigos y descartando los más antiguos al superar el límite. */
export function agregarAlRegistro(registro: Registro, codigo: string, url: string, creado: number): Registro {
  const nuevo: Registro = { ...registro, [codigo]: { url, creado } };
  const codigos = Object.keys(nuevo).sort((a, b) => nuevo[a].creado - nuevo[b].creado);
  for (const viejo of codigos.slice(0, Math.max(0, codigos.length - MAX_ENLACES))) {
    delete nuevo[viejo];
  }
  return nuevo;
}

/** Comprueba que un valor guardado tenga la forma esperada antes de usarlo. */
export function esRegistroValido(valor: unknown): valor is Registro {
  if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return false;
  return Object.values(valor).every(
    (e) =>
      !!e &&
      typeof e === 'object' &&
      typeof (e as EntradaEnlace).url === 'string' &&
      typeof (e as EntradaEnlace).creado === 'number',
  );
}

function escaparClase(texto: string): string {
  return texto.replace(/[\]\\^-]/g, '\\$&');
}
