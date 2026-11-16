/*
 * Lógica pura de «Recortar audio»: límites, lectura de tiempos y validación del rango.
 * Sin dependencias del navegador, para poder probarla con node.
 * El recorte en sí se hace en src/lib/recortar-audio.ts.
 */

export const RECORTAR_AUDIO_LIMITS = {
  /** Tamaño máximo del archivo de entrada. */
  maxBytes: 100 * 1024 * 1024,
  /** Duración máxima del audio de entrada. Se guarda sin comprimir mientras se trabaja. */
  maxSegundos: 60 * 60,
} as const;

/**
 * Convierte un tiempo escrito por el usuario a segundos.
 * Acepta «ss», «ss,d», «m:ss», «m:ss.d» y «h:mm:ss». Devuelve null si el texto no es válido.
 */
export function parseTiempo(texto: string): number | null {
  const limpio = texto.trim().replace(',', '.');
  if (!limpio) return null;
  if (!/^(\d+:){0,2}\d+(\.\d+)?$/.test(limpio)) return null;

  const partes = limpio.split(':');
  let segundos = 0;
  for (const parte of partes) {
    const valor = Number(parte);
    if (!Number.isFinite(valor) || valor < 0) return null;
    segundos = segundos * 60 + valor;
  }
  // Los minutos y segundos intermedios deben ser menores que 60 cuando hay más de una parte.
  if (partes.length > 1) {
    const ultimos = partes.slice(1);
    if (ultimos.some((p) => Number(p) >= 60)) return null;
  }
  return segundos;
}

/** Formato para mostrar un tiempo: m:ss.d (o h:mm:ss.d si supera una hora). */
export function formatTiempo(segundos: number): string {
  const total = Math.max(0, segundos);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total - h * 3600 - m * 60;
  const ss = s.toFixed(1).padStart(4, '0');
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${ss}`;
  return `${m}:${ss}`;
}

/**
 * Valida el rango [inicio, fin] contra la duración del audio.
 * Devuelve un mensaje para mostrar, o null si el rango es válido.
 */
export function validarRango(inicio: number | null, fin: number | null, duracion: number): string | null {
  if (inicio === null || fin === null) return 'Escribí el inicio y el final con el formato m:ss.';
  if (inicio < 0 || fin < 0) return 'Los tiempos no pueden ser negativos.';
  if (inicio >= fin) return 'El final tiene que ser posterior al inicio.';
  if (inicio >= duracion) return 'El inicio está después del final del audio.';
  if (fin - inicio < 0.1) return 'La selección debe durar al menos 0,1 segundos.';
  return null;
}

/** Ajusta el final a la duración del audio si se pasó. */
export function ajustarFin(fin: number, duracion: number): number {
  return Math.min(fin, duracion);
}

/** Muestras de inicio y fin para una tasa de muestreo dada, redondeadas dentro del audio. */
export function muestrasRango(
  sampleRate: number,
  inicio: number,
  fin: number,
  duracion: number,
): { desde: number; hasta: number } {
  const total = Math.round(duracion * sampleRate);
  const desde = Math.max(0, Math.min(total, Math.round(inicio * sampleRate)));
  const hasta = Math.max(desde, Math.min(total, Math.round(fin * sampleRate)));
  return { desde, hasta };
}
