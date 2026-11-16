/*
 * Codificación MP3 con libmp3lame (LAME, LGPL-2.0) a través del núcleo FFmpeg propio de ChispaBox
 * (public/ffmpeg-lgpl/). Sustituye al codificador en JavaScript @breezystack/lamejs.
 *
 * - Se usa un motor nuevo por conversión: el CLI de FFmpeg no reinicia su estado entre ejecuciones
 *   (ver docs/ffmpeg-lgpl.md). El motor se cierra al terminar, con error o sin él.
 * - El audio no sale del equipo: el WAV y el MP3 viven en la memoria del navegador.
 */
import { FFmpeg } from '@ffmpeg/ffmpeg';

const CORE_URL = '/ffmpeg-lgpl/ffmpeg-core.js';
const WASM_URL = '/ffmpeg-lgpl/ffmpeg-core.wasm';

/**
 * Convierte un WAV PCM de 16 bits a MP3 CBR de 128 kb/s.
 * @param wav WAV de entrada (su frecuencia y canales se mantienen; el llamador decide 44,1 kHz).
 */
export async function encodeMp3WithLame(wav: Blob, bitrateKbps: number, sampleRate: number, channels: number): Promise<Blob> {
  const engine = new FFmpeg();
  try {
    await engine.load({ coreURL: CORE_URL, wasmURL: WASM_URL });
    await engine.writeFile('entrada.wav', new Uint8Array(await wav.arrayBuffer()));
    const code = await engine.exec([
      '-i', 'entrada.wav',
      '-vn',
      '-c:a', 'libmp3lame',
      '-b:a', `${bitrateKbps}k`,
      '-ar', String(sampleRate),
      '-ac', String(channels),
      '-f', 'mp3',
      'salida.mp3',
    ]);
    if (code !== 0) throw new Error(`FFmpeg terminó con código ${code}`);
    const data = await engine.readFile('salida.mp3');
    if (typeof data === 'string') throw new Error('Salida inesperada del motor de conversión');
    return new Blob([data as BlobPart], { type: 'audio/mpeg' });
  } finally {
    engine.terminate();
  }
}
