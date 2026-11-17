/*
 * Conversión de la grabación a WAV y MP3, en el navegador.
 *
 * - WAV: PCM de 16 bits, escrito byte a byte (sin dependencias).
 * - MP3: libmp3lame (LAME, LGPL-2.0) a través del núcleo FFmpeg propio, 128 kbps, 44,1 kHz (src/lib/ffmpeg-mp3.ts).
 * - Todo ocurre localmente: ningún audio sale del equipo.
 */
import { encodeMp3WithLame } from './ffmpeg-mp3';

const MP3_RATE = 44100;
const MP3_KBPS = 128;

/** Decodifica la grabación (WebM, MP4 u OGG según el navegador) a PCM. */
export async function decodeRecording(blob: Blob): Promise<AudioBuffer> {
  const ctx = new AudioContext();
  try {
    return await ctx.decodeAudioData(await blob.arrayBuffer());
  } finally {
    void ctx.close();
  }
}

/** Tamaño exacto de un WAV de 16 bits para este audio. */
export function wavSize(buffer: AudioBuffer): number {
  const channels = Math.min(buffer.numberOfChannels, 2);
  return 44 + buffer.length * channels * 2;
}

/** Estimación del MP3 a 128 kbps (la cifra real sale al codificar). */
export function mp3EstimateSize(durationSeconds: number): number {
  return Math.round((durationSeconds * MP3_KBPS * 1000) / 8);
}

export function encodeWav(buffer: AudioBuffer): Blob {
  const channels = Math.min(buffer.numberOfChannels, 2);
  const frames = buffer.length;
  const dataSize = frames * channels * 2;
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);
  const writeText = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, dataSize, true);

  const channelData: Float32Array[] = [];
  for (let c = 0; c < channels; c++) channelData.push(buffer.getChannelData(c));
  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const sample = Math.max(-1, Math.min(1, channelData[c]?.[i] ?? 0));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([out], { type: 'audio/wav' });
}

async function resampleTo(buffer: AudioBuffer, rate: number, channels: number): Promise<AudioBuffer> {
  const length = Math.max(1, Math.ceil(buffer.duration * rate));
  const offline = new OfflineAudioContext(channels, length, rate);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start(0);
  return offline.startRendering();
}

/** MP3 a 128 kb/s y 44,1 kHz con libmp3lame del núcleo FFmpeg propio. */
export async function encodeMp3(buffer: AudioBuffer): Promise<Blob> {
  const channels = Math.min(buffer.numberOfChannels, 2);
  const pcm = buffer.sampleRate === MP3_RATE ? buffer : await resampleTo(buffer, MP3_RATE, channels);
  return encodeMp3WithLame(encodeWav(pcm), MP3_KBPS, MP3_RATE, channels);
}
