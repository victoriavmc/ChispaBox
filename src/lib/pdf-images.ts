/*
 * Preparación de imágenes para el PDF en el navegador (Canvas API + CompressionStream).
 * Sin librerías externas: el navegador decodifica, aplana el fondo y codifica.
 *
 * Reglas de codificación:
 * - PNG pequeños (hasta 4 MP) → RGB sin pérdida comprimido con zlib (FlateDecode).
 * - Resto (JPG, WebP y PNG grandes) → JPEG de calidad 92 (DCTDecode).
 * - La transparencia se aplana sobre el color elegido (por defecto blanco): nunca queda negro.
 */
import type { PdfImage } from '../shared/pdf-writer.ts';

const LOSSLESS_MAX_PIXELS = 4_000_000;
const JPEG_QUALITY = 0.92;

export type SourceFormat = 'jpeg' | 'png' | 'webp';

function encodeJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('El navegador no pudo codificar la imagen.'));
        blob
          .arrayBuffer()
          .then((buf) => resolve(new Uint8Array(buf)))
          .catch(reject);
      },
      'image/jpeg',
      JPEG_QUALITY,
    );
  });
}

async function deflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Convierte un ImageBitmap en datos listos para incrustar en el PDF. Libera el canvas al terminar. */
export async function encodeForPdf(bitmap: ImageBitmap, source: SourceFormat, background: string): Promise<PdfImage> {
  const width = bitmap.width;
  const height = bitmap.height;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  try {
    // alpha:false evita que las zonas transparentes queden negras: se pintan sobre el fondo elegido.
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('El navegador no permite procesar imágenes en canvas.');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0);

    const lossless = source === 'png' && width * height <= LOSSLESS_MAX_PIXELS && typeof CompressionStream !== 'undefined';
    if (lossless) {
      const rgba = ctx.getImageData(0, 0, width, height).data;
      const rgb = new Uint8Array(width * height * 3);
      for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
        rgb[j] = rgba[i];
        rgb[j + 1] = rgba[i + 1];
        rgb[j + 2] = rgba[i + 2];
      }
      return { width, height, encoding: 'flate', data: await deflate(rgb) };
    }
    return { width, height, encoding: 'jpeg', data: await encodeJpeg(canvas) };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** Valida un color #RRGGBB (el de entrada de color del formulario siempre lo cumple). */
export function isHexColor(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}
