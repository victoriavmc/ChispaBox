/*
 * Lógica pura de «Unificar audios»: límites y cálculo de posiciones. Sin dependencias del navegador,
 * para poder probarla con node. La unión en sí se hace en src/lib/unir-audio.ts.
 */

export const UNIFICAR_AUDIO_LIMITS = {
  maxArchivos: 20,
  maxBytesArchivo: 100 * 1024 * 1024,
  /** Duración máxima del resultado. Más largo consume demasiada memoria: el audio se guarda sin comprimir mientras se trabaja. */
  maxSegundos: 15 * 60,
} as const;

export interface EntradaAudio {
  bytes: number;
  segundos: number;
}

/** Valida la lista antes de decodificar. Devuelve un mensaje de error o null. */
export function validarListaAudio(entradas: readonly EntradaAudio[]): string | null {
  if (entradas.length < 2) return 'Agregá al menos dos audios para unirlos.';
  if (entradas.length > UNIFICAR_AUDIO_LIMITS.maxArchivos) {
    return `Como máximo se pueden unir ${UNIFICAR_AUDIO_LIMITS.maxArchivos} audios.`;
  }
  const total = entradas.reduce((sum, e) => sum + e.segundos, 0);
  if (total > UNIFICAR_AUDIO_LIMITS.maxSegundos) {
    return `La duración total (${Math.round(total / 60)} min) supera el máximo de ${UNIFICAR_AUDIO_LIMITS.maxSegundos / 60} min.`;
  }
  return null;
}

/** Posición de inicio de cada audio dentro del resultado, en segundos. */
export function posicionesInicio(duraciones: readonly number[]): number[] {
  const posiciones: number[] = [];
  let acumulado = 0;
  for (const d of duraciones) {
    posiciones.push(acumulado);
    acumulado += d;
  }
  return posiciones;
}

/** Cantidad de canales del resultado: el mayor de los audios (un mono se expande a estéreo). */
export function canalesDelResultado(canales: readonly number[]): number {
  return Math.max(1, ...canales);
}

/** Cantidad de muestras del resultado a la tasa indicada. */
export function muestrasTotales(duraciones: readonly number[], tasa: number): number {
  const total = duraciones.reduce((sum, d) => sum + d, 0);
  return Math.ceil(total * tasa);
}
