/*
 * Lógica pura de «Proteger PDF con contraseña» (sin DOM, probable en node).
 * El cifrado lo hace QPDF (AES-256, PDF 2.0 / R6) en src/lib/qpdf-runner.ts.
 */

export const PROTEGER_PDF_LIMITS = {
  minClave: 8,
  maxClave: 128,
  maxBytes: 100 * 1024 * 1024,
} as const;

/** Alfabeto sin caracteres ambiguos (0/O, 1/l/I). */
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

/** Valida la contraseña que elige el usuario. Devuelve null si es válida. */
export function validarClave(clave: string, confirmacion: string): string | null {
  if (clave.length < PROTEGER_PDF_LIMITS.minClave) {
    return `La contraseña debe tener al menos ${PROTEGER_PDF_LIMITS.minClave} caracteres.`;
  }
  if (clave.length > PROTEGER_PDF_LIMITS.maxClave) {
    return `La contraseña no puede superar los ${PROTEGER_PDF_LIMITS.maxClave} caracteres.`;
  }
  if (clave.trim().length === 0) return 'La contraseña no puede estar formada solo por espacios.';
  if (/^(.)\1+$/.test(clave)) return 'La contraseña no puede repetir el mismo carácter.';
  if (clave !== confirmacion) return 'Las dos contraseñas no coinciden.';
  return null;
}

/**
 * Contraseña del propietario aleatoria: controla los permisos y nunca se muestra.
 * Así la única contraseña que conoce quien recibe el archivo es la que elegiste.
 */
export function generarClaveDueno(longitud = 32): string {
  const salida: string[] = [];
  const maxAceptado = 256 - (256 % ALFABETO.length); // evita sesgo al elegir letras
  const buffer = new Uint8Array(longitud * 2);
  while (salida.length < longitud) {
    crypto.getRandomValues(buffer);
    for (const b of buffer) {
      if (b < maxAceptado && salida.length < longitud) salida.push(ALFABETO[b % ALFABETO.length]);
    }
  }
  return salida.join('');
}

export interface OpcionesCifrado {
  claveUsuario: string;
  claveDueno: string;
  restringir: boolean;
  /** Contraseña actual del PDF, si ya tiene una. */
  claveOriginal?: string | undefined;
  entrada: string;
  salida: string;
}

/**
 * Argumentos para QPDF. Cada valor va como argumento separado (sin shell),
 * así una contraseña con espacios o símbolos no se interpreta.
 */
export function construirArgumentosCifrado(o: OpcionesCifrado): string[] {
  const args: string[] = [];
  if (o.claveOriginal) args.push(`--password=${o.claveOriginal}`);
  args.push('--encrypt', o.claveUsuario, o.claveDueno, '256');
  if (o.restringir) args.push('--print=none', '--modify=none', '--extract=n', '--annotate=n');
  args.push('--', o.entrada, o.salida);
  return args;
}

/** Argumentos para comprobar que el archivo se abre con la contraseña. */
export function argumentosComprobacion(ruta: string, clave?: string): string[] {
  return clave ? [`--password=${clave}`, '--check', ruta] : ['--check', ruta];
}

/**
 * Código de salida de QPDF que cuenta como éxito: 0 = correcto; 3 = correcto con advertencias
 * (QPDF reparó algo menor del archivo y el resultado sigue siendo válido). 2 = error.
 */
export function codigoCorrecto(codigo: number): boolean {
  return codigo === 0 || codigo === 3;
}

/** Última línea no vacía de la salida de QPDF, para mostrar el motivo real del fallo. */
export function ultimaLineaQpdf(salidaQpdf: string): string {
  const lineas = salidaQpdf
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const ultima = lineas[lineas.length - 1] ?? '';
  return ultima.length > 200 ? `${ultima.slice(0, 200)}…` : ultima;
}

export const MENSAJE_YA_PROTEGIDO =
  'Este PDF ya tiene contraseña. Escribí la contraseña anterior en el apartado correspondiente para cambiarla.';

/** Nombre sugerido para la copia protegida; no repite el sufijo si el archivo ya lo tiene. */
export function nombreProtegido(base: string): string {
  return /\s-\sprotegido$/i.test(base) ? base : `${base} - protegido`;
}

/** Traduce la salida de QPDF a un mensaje claro en español. */
export function mensajeDeError(salidaQpdf: string, hayClaveOriginal: boolean): string {
  const texto = salidaQpdf.toLowerCase();
  if (/invalid password|password/.test(texto)) {
    return hayClaveOriginal
      ? 'La contraseña anterior del PDF no es correcta.'
      : MENSAJE_YA_PROTEGIDO;
  }
  if (/not a pdf|damaged|unable to find|file is not|can't find|invalid/.test(texto)) {
    return 'El archivo no es un PDF válido o está dañado.';
  }
  const detalle = ultimaLineaQpdf(salidaQpdf);
  return detalle ? `No se pudo proteger el PDF. Motivo según QPDF: ${detalle}` : 'No se pudo proteger el PDF.';
}
