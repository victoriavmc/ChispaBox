/*
 * Recorte de un audio decodificado con Web Audio API. Todo ocurre en el navegador.
 */
import { muestrasRango } from '../shared/recortar-audio.ts';

/** Copia la parte [inicio, fin] (en segundos) del audio a un nuevo AudioBuffer. */
export function recortarAudio(buffer: AudioBuffer, inicio: number, fin: number): AudioBuffer {
  const { desde, hasta } = muestrasRango(buffer.sampleRate, inicio, fin, buffer.duration);
  const longitud = Math.max(1, hasta - desde);
  const salida = new AudioBuffer({
    length: longitud,
    numberOfChannels: buffer.numberOfChannels,
    sampleRate: buffer.sampleRate,
  });
  for (let canal = 0; canal < buffer.numberOfChannels; canal++) {
    const origen = buffer.getChannelData(canal).subarray(desde, desde + longitud);
    salida.copyToChannel(origen, canal);
  }
  return salida;
}

/** Reproduce un fragmento del audio. Devuelve una función para detenerlo. */
export function reproducirFragmento(
  buffer: AudioBuffer,
  inicio: number,
  fin: number,
  alTerminar: () => void,
): () => void {
  const ctx = new AudioContext();
  const fuente = ctx.createBufferSource();
  fuente.buffer = buffer;
  fuente.connect(ctx.destination);
  fuente.onended = () => {
    void ctx.close();
    alTerminar();
  };
  fuente.start(0, inicio, Math.max(0.05, fin - inicio));
  return () => {
    try {
      fuente.stop();
    } catch {
      // Ya terminó: no hace falta detenerlo.
    }
  };
}
