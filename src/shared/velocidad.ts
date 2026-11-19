/*
 * Cálculos de la prueba de velocidad: Mbps, mediana, fluctuación (jitter) y calificación.
 * Solo funciones puras.
 */

/** Megabits por segundo a partir de bytes transferidos y milisegundos. */
export function mbps(bytes: number, milisegundos: number): number {
  if (milisegundos <= 0 || bytes <= 0) return 0;
  return (bytes * 8) / (milisegundos / 1000) / 1_000_000;
}

/** Mediana de una lista de números (0 si está vacía). */
export function mediana(valores: number[]): number {
  if (valores.length === 0) return 0;
  const orden = [...valores].sort((a, b) => a - b);
  const medio = Math.floor(orden.length / 2);
  return orden.length % 2 === 0 ? (orden[medio - 1] + orden[medio]) / 2 : orden[medio];
}

/** Fluctuación: promedio de la diferencia absoluta entre mediciones consecutivas. */
export function fluctuacion(valores: number[]): number {
  if (valores.length < 2) return 0;
  let suma = 0;
  for (let i = 1; i < valores.length; i++) suma += Math.abs(valores[i] - valores[i - 1]);
  return suma / (valores.length - 1);
}

export type Calificacion = 'excelente' | 'buena' | 'regular' | 'lenta';

/** Calificación de la descarga según Mbps. */
export function calificarDescarga(mbpsDescarga: number): Calificacion {
  if (mbpsDescarga >= 100) return 'excelente';
  if (mbpsDescarga >= 25) return 'buena';
  if (mbpsDescarga >= 5) return 'regular';
  return 'lenta';
}

export const ETIQUETA_CALIFICACION: Record<Calificacion, string> = {
  excelente: 'Excelente',
  buena: 'Buena',
  regular: 'Regular',
  lenta: 'Lenta',
};

/** Qué tan bien anda cada uso según la descarga, la latencia y la fluctuación. */
export function usosRecomendados(descargaMbps: number, latenciaMs: number, fluctuacionMs: number): Array<{ uso: string; nivel: 'bueno' | 'promedio' | 'pobre' }> {
  const nivel = (bueno: boolean, promedio: boolean): 'bueno' | 'promedio' | 'pobre' => (bueno ? 'bueno' : promedio ? 'promedio' : 'pobre');
  return [
    { uso: 'Ver video', nivel: nivel(descargaMbps >= 15, descargaMbps >= 5) },
    { uso: 'Videollamadas', nivel: nivel(latenciaMs <= 100 && fluctuacionMs <= 30, latenciaMs <= 200) },
    { uso: 'Juegos en línea', nivel: nivel(latenciaMs <= 40 && fluctuacionMs <= 10, latenciaMs <= 80) },
  ];
}
