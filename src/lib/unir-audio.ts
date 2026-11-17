/*
 * Une varios audios en uno con la Web Audio API del navegador (OfflineAudioContext).
 * Cada audio se programa en su posición; el navegador remuestrea y ajusta los canales.
 * No usa librerías externas: todo se calcula localmente.
 */
import { muestrasTotales } from '../shared/unificar-audios.ts';

export const TASA_SALIDA = 44100;

/** Renderiza todos los audios en un solo AudioBuffer, uno detrás de otro. */
export async function unirAudios(buffers: readonly AudioBuffer[], canales: number, posiciones: readonly number[]): Promise<AudioBuffer> {
  const duraciones = buffers.map((b) => b.duration);
  const muestras = Math.max(1, muestrasTotales(duraciones, TASA_SALIDA));
  const ctx = new OfflineAudioContext(canales, muestras, TASA_SALIDA);
  buffers.forEach((buffer, i) => {
    const fuente = ctx.createBufferSource();
    fuente.buffer = buffer;
    fuente.connect(ctx.destination);
    fuente.start(posiciones[i] ?? 0);
  });
  return ctx.startRendering();
}
