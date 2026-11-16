/*
 * Mejora de calidad con operaciones clásicas de píxeles (sin IA).
 * Usado por el worker del método Canvas. Las mismas intensidades existen en el
 * método Sharp (server/image-enhance.ts) con operaciones equivalentes en libvips.
 */

export type Intensity = 'suave' | 'media' | 'intensa';

export const INTENSITIES: readonly Intensity[] = ['suave', 'media', 'intensa'];

export const INTENSITY_LABEL: Record<Intensity, string> = {
  suave: 'Suave',
  media: 'Media',
  intensa: 'Intensa',
};

export interface EnhanceParams {
  /** −100 a 100 */
  brightness: number;
  /** −100 a 100 */
  contrast: number;
  /** −100 a 100 */
  saturation: number;
  /** 0 a 100: intensidad del enfoque por máscara de nitidez (unsharp mask). */
  sharpen: number;
}

export const PRESETS: Record<Intensity, EnhanceParams> = {
  suave: { brightness: 0, contrast: 4, saturation: 4, sharpen: 15 },
  media: { brightness: 2, contrast: 10, saturation: 10, sharpen: 35 },
  intensa: { brightness: 4, contrast: 20, saturation: 20, sharpen: 65 },
};

export type Interpolation = 'low' | 'medium' | 'high';

export const INTERPOLATION_LABEL: Record<Interpolation, string> = {
  low: 'Rápida',
  medium: 'Media',
  high: 'Alta calidad',
};

const clamp = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : v);

/**
 * Aplica brillo, contraste, saturación y enfoque sobre un ImageData (in situ).
 * Orden: brillo → contraste → saturación → enfoque. El enfoque usa un desenfoque
 * gaussiano 3×3 (matriz [1 2 1]) y resta la versión suavizada.
 */
export function applyEnhancement(image: ImageData, p: EnhanceParams): void {
  const { data, width, height } = image;
  const bright = (p.brightness / 100) * 255;
  const c = (p.contrast / 100) * 255;
  const contrastFactor = (259 * (c + 255)) / (255 * (259 - c));
  const sat = 1 + p.saturation / 100;
  const amount = (p.sharpen / 100) * 1.2;

  for (let i = 0; i < data.length; i += 4) {
    let r = (data[i] ?? 0) + bright;
    let g = (data[i + 1] ?? 0) + bright;
    let b = (data[i + 2] ?? 0) + bright;
    r = contrastFactor * (r - 128) + 128;
    g = contrastFactor * (g - 128) + 128;
    b = contrastFactor * (b - 128) + 128;
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    r = gray + (r - gray) * sat;
    g = gray + (g - gray) * sat;
    b = gray + (b - gray) * sat;
    data[i] = clamp(r);
    data[i + 1] = clamp(g);
    data[i + 2] = clamp(b);
  }

  if (amount > 0) {
    const src = new Uint8ClampedArray(data);
    const w = width;
    const h = height;
    for (let y = 0; y < h; y++) {
      const y0 = y > 0 ? y - 1 : y;
      const y1 = y < h - 1 ? y + 1 : y;
      for (let x = 0; x < w; x++) {
        const x0 = x > 0 ? x - 1 : x;
        const x1 = x < w - 1 ? x + 1 : x;
        const i = (y * w + x) * 4;
        for (let ch = 0; ch < 3; ch++) {
          // Kernel separable [1 2 1] / 4 en ambas direcciones: 9 muestras con pesos 1,2,1 × 1,2,1 / 16.
          const s =
            (src[(y0 * w + x0) * 4 + ch] ?? 0) +
            2 * (src[(y0 * w + x) * 4 + ch] ?? 0) +
            (src[(y0 * w + x1) * 4 + ch] ?? 0) +
            2 * (src[(y * w + x0) * 4 + ch] ?? 0) +
            4 * (src[i + ch] ?? 0) +
            2 * (src[(y * w + x1) * 4 + ch] ?? 0) +
            (src[(y1 * w + x0) * 4 + ch] ?? 0) +
            2 * (src[(y1 * w + x) * 4 + ch] ?? 0) +
            (src[(y1 * w + x1) * 4 + ch] ?? 0);
          const blur = s / 16;
          const original = src[i + ch] ?? 0;
          data[i + ch] = clamp(original + amount * (original - blur));
        }
      }
    }
  }
}

/** Ancho/alto de salida a partir de un valor editado; mantiene la proporción si se pide. */
export function outputSize(
  srcW: number,
  srcH: number,
  width: number | null,
  height: number | null,
): { width: number; height: number } {
  if (width !== null && height !== null) return { width, height };
  if (width !== null) return { width, height: Math.max(1, Math.round((width * srcH) / srcW)) };
  if (height !== null) return { width: Math.max(1, Math.round((height * srcW) / srcH)), height };
  return { width: srcW, height: srcH };
}
