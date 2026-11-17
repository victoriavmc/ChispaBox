/*
 * Worker del método Canvas: escala, ajusta y codifica la imagen fuera del hilo
 * principal, para no bloquear la interfaz. No hace ninguna petición de red.
 */
import { applyEnhancement, type EnhanceParams, type Interpolation } from '../lib/enhance-core';
import { outputMatches, type OutputFormat } from '../shared/image-format';

export interface EnhanceJob {
  id: number;
  bitmap: ImageBitmap;
  width: number;
  height: number;
  params: EnhanceParams;
  interpolation: Interpolation;
  format: OutputFormat;
  quality: number;
}

export type EnhanceReply =
  | { id: number; ok: true; blob: Blob; width: number; height: number }
  | { id: number; ok: false; message: string };

interface WorkerScope {
  onmessage: ((e: MessageEvent<EnhanceJob>) => void) | null;
  postMessage(message: EnhanceReply): void;
}

const scope = self as unknown as WorkerScope;
const QUALITY: Record<Interpolation, ImageSmoothingQuality> = {
  low: 'low',
  medium: 'medium',
  high: 'high',
};
const MIME: Record<OutputFormat, string> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  ico: 'image/x-icon',
};

async function run(job: EnhanceJob): Promise<EnhanceReply> {
  const { bitmap } = job;
  try {
    const canvas = new OffscreenCanvas(job.width, job.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return { id: job.id, ok: false, message: 'El navegador no permite procesar imágenes.' };
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = QUALITY[job.interpolation];
    ctx.drawImage(bitmap, 0, 0, job.width, job.height);
    bitmap.close();

    const image = ctx.getImageData(0, 0, job.width, job.height);
    applyEnhancement(image, job.params);
    ctx.putImageData(image, 0, 0);

    // JPG no tiene transparencia: se rellena de blanco antes de codificar.
    if (job.format === 'jpeg') {
      const flat = new OffscreenCanvas(job.width, job.height);
      const fctx = flat.getContext('2d');
      if (!fctx) return { id: job.id, ok: false, message: 'El navegador no permite procesar imágenes.' };
      fctx.fillStyle = '#ffffff';
      fctx.fillRect(0, 0, job.width, job.height);
      fctx.drawImage(canvas, 0, 0);
      return finish(job, flat);
    }
    return finish(job, canvas);
  } catch (err) {
    if (err instanceof RangeError) return { id: job.id, ok: false, message: 'Falta memoria para esta imagen. Probá con una más chica o un tamaño menor.' };
    return { id: job.id, ok: false, message: 'No se pudo mejorar la imagen.' };
  }
}

async function finish(job: EnhanceJob, canvas: OffscreenCanvas): Promise<EnhanceReply> {
  const options = job.format === 'png' ? undefined : { type: MIME[job.format], quality: job.quality };
  const blob = await canvas.convertToBlob(options ?? { type: MIME.png });
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (!outputMatches(head, job.format)) {
    return { id: job.id, ok: false, message: `El navegador no pudo generar ${job.format.toUpperCase()}.` };
  }
  return { id: job.id, ok: true, blob, width: job.width, height: job.height };
}

scope.onmessage = (e: MessageEvent<EnhanceJob>) => {
  void run(e.data).then((reply) => scope.postMessage(reply));
};
