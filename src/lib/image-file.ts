/*
 * Validación de archivos de imagen seleccionados por el usuario.
 * Orden de comprobaciones (RG-05, RG-09): tamaño → firma → extensión/MIME →
 * dimensiones leídas del encabezado → decodificación. Así no se decodifica
 * nunca una imagen que supere los límites (evita «bombas» de descompresión).
 */
import { IMAGE_LIMITS, formatBytes, formatMegapixels } from '../shared/image-limits';
import {
  INPUT_EXTENSIONS,
  INPUT_MIME,
  sniffInputFormat,
  describeUnsupported,
  type InputFormat,
} from '../shared/image-format';

export interface ImageInfo {
  name: string;
  sizeBytes: number;
  format: InputFormat;
  width: number;
  height: number;
  pixels: number;
}

export type InspectResult =
  | { ok: true; info: ImageInfo; bitmap: ImageBitmap }
  | { ok: false; message: string };

function u16be(b: Uint8Array, o: number): number {
  return ((b[o] ?? 0) << 8) | (b[o + 1] ?? 0);
}
function u32be(b: Uint8Array, o: number): number {
  return ((b[o] ?? 0) * 0x1000000) + (((b[o + 1] ?? 0) << 16) | ((b[o + 2] ?? 0) << 8) | (b[o + 3] ?? 0));
}
function u16le(b: Uint8Array, o: number): number {
  return (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8);
}
function u24le(b: Uint8Array, o: number): number {
  return (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8) | ((b[o + 2] ?? 0) << 16);
}

/** Lee ancho y alto del encabezado sin decodificar los píxeles. */
export function readDimensions(bytes: Uint8Array, format: InputFormat): { width: number; height: number } | null {
  if (format === 'png') {
    if (bytes.length < 24) return null;
    return { width: u32be(bytes, 16), height: u32be(bytes, 20) };
  }
  if (format === 'jpeg') {
    let o = 2;
    while (o + 9 < bytes.length) {
      if (bytes[o] !== 0xff) return null;
      const marker = bytes[o + 1] ?? 0;
      if (marker === 0xff) {
        o += 1;
        continue;
      }
      // Marcadores SOF0..SOF15 salvo DHT (C4), JPG (C8) y DAC (CC).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: u16be(bytes, o + 5), width: u16be(bytes, o + 7) };
      }
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        o += 2;
        continue;
      }
      o += 2 + u16be(bytes, o + 2);
    }
    return null;
  }
  // WebP: VP8X (lienzo), VP8L (sin pérdida) o VP8 (con pérdida).
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === 'VP8X') return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
  if (chunk === 'VP8L') {
    // Tras la firma 0x2f (byte 20), 14 bits de ancho-1 y 14 bits de alto-1 empaquetados.
    const b1 = bytes[21] ?? 0;
    const b2 = bytes[22] ?? 0;
    const b3 = bytes[23] ?? 0;
    const b4 = bytes[24] ?? 0;
    return {
      width: 1 + (((b2 & 0x3f) << 8) | b1),
      height: 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | (b2 >> 6)),
    };
  }
  if (chunk === 'VP8 ') return { width: u16le(bytes, 26) & 0x3fff, height: u16le(bytes, 28) & 0x3fff };
  return null;
}

function extensionOf(name: string): string {
  const m = /\.[^./\\]+$/.exec(name);
  return m ? m[0].toLowerCase() : '';
}

/** Comprueba un archivo y decodifica solo si cumple los límites. */
export async function inspectImageFile(file: File, maxPixels: number): Promise<InspectResult> {
  const size = file.size;
  if (size < IMAGE_LIMITS.minBytes) {
    return { ok: false, message: 'El archivo está vacío (0 bytes). Elegí otra imagen.' };
  }
  if (size > IMAGE_LIMITS.maxBytes) {
    return {
      ok: false,
      message: `La imagen pesa ${formatBytes(size)} y supera el máximo de ${formatBytes(IMAGE_LIMITS.maxBytes)}.`,
    };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = sniffInputFormat(bytes.subarray(0, 16));
  if (!format) {
    const other = describeUnsupported(bytes.subarray(0, 16));
    return {
      ok: false,
      message: other
        ? `El archivo es ${other}, un formato no admitido. Formatos admitidos: JPG, PNG y WebP.`
        : 'El contenido no es una imagen JPG, PNG o WebP válida (o está dañada).',
    };
  }

  const ext = extensionOf(file.name);
  if (ext && !INPUT_EXTENSIONS[format].includes(ext)) {
    return {
      ok: false,
      message: `La extensión ${ext} no corresponde al contenido real del archivo (es ${INPUT_MIME[format]}).`,
    };
  }
  if (file.type && file.type !== INPUT_MIME[format]) {
    return { ok: false, message: `El tipo informado (${file.type}) no coincide con el contenido (${INPUT_MIME[format]}).` };
  }

  const header = readDimensions(bytes, format);
  if (!header || header.width < 1 || header.height < 1) {
    return { ok: false, message: 'No se pudieron leer las dimensiones: el archivo parece dañado.' };
  }
  const { width, height } = header;
  const pixels = width * height;
  if (width > IMAGE_LIMITS.maxSide || height > IMAGE_LIMITS.maxSide) {
    return {
      ok: false,
      message: `Esta imagen tiene ${width} × ${height} píxeles y supera el lado máximo de ${IMAGE_LIMITS.maxSide} px.`,
    };
  }
  if (pixels > maxPixels) {
    return {
      ok: false,
      message: `Esta imagen tiene ${width} × ${height} píxeles (${formatMegapixels(pixels)}) y supera el límite configurado para esta herramienta: ${formatMegapixels(maxPixels)}.`,
    };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([bytes], { type: INPUT_MIME[format] }));
  } catch {
    return { ok: false, message: 'No se pudo decodificar la imagen: el archivo está dañado o incompleto.' };
  }
  if (bitmap.width !== width || bitmap.height !== height) {
    bitmap.close();
    return { ok: false, message: 'Las dimensiones del archivo no coinciden con su contenido: se considera dañado.' };
  }

  return {
    ok: true,
    info: { name: file.name, sizeBytes: size, format, width, height, pixels },
    bitmap,
  };
}

/** Texto con los requisitos de entrada, generado desde la configuración real (RG-11). */
export function requirementLines(maxPixels: number, formats: readonly string[]): string[] {
  return [
    `Formatos: ${formats.join(', ')}.`,
    `Peso permitido: desde ${formatBytes(IMAGE_LIMITS.minBytes)} (no vacío) hasta ${formatBytes(IMAGE_LIMITS.maxBytes)}.`,
    `Dimensiones: lado mínimo ${IMAGE_LIMITS.minSide} px y lado máximo ${IMAGE_LIMITS.maxSide} px.`,
    `Resolución máxima: ${formatMegapixels(maxPixels)} (${maxPixels.toLocaleString('es-AR')} píxeles en total).`,
  ];
}
