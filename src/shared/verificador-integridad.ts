/*
 * Lógica de «Verificador de integridad»: SHA-256 de archivos y comparación con un hash esperado.
 * Solo funciones puras (se prueban con node --test). El cálculo lo hace Web Crypto del navegador.
 */

/** Límite de tamaño: el archivo se lee completo en memoria para calcular el hash. */
export const MAX_BYTES = 500 * 1024 * 1024;

export type Comparacion = 'vacio' | 'coincide' | 'no-coincide' | 'formato-invalido';

/** Pasa un hash a minúsculas y quita espacios y saltos de línea (lo que suele pegarse de un sitio). */
export function normalizarHash(texto: string): string {
  return texto.replace(/\s+/g, '').toLowerCase();
}

/** Un SHA-256 válido tiene 64 caracteres hexadecimales. */
export function esHashValido(hash: string): boolean {
  return /^[0-9a-f]{64}$/.test(hash);
}

/** Convierte el resultado de Web Crypto en texto hexadecimal en minúsculas. */
export function bytesAHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Compara el hash calculado con el esperado que pegó el usuario. */
export function compararHash(calculado: string, esperado: string): Comparacion {
  const normal = normalizarHash(esperado);
  if (normal === '') return 'vacio';
  if (!esHashValido(normal)) return 'formato-invalido';
  return normal === calculado ? 'coincide' : 'no-coincide';
}

/** Mensaje de tamaño: rechaza archivos vacíos y los que superan el límite. */
export function validarTamano(bytes: number): string | null {
  if (bytes === 0) return 'El archivo está vacío.';
  if (bytes > MAX_BYTES) return 'El archivo supera el límite de 500 MB.';
  return null;
}
