/*
 * Cálculos puros de recorte y redimensionado (sin DOM), para probarlos con node:test.
 * Todas las coordenadas están en píxeles de la imagen original.
 */
import { IMAGE_LIMITS, TOOL_LIMITS } from './image-limits.ts';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Result<T> = { ok: true; value: T } | { ok: false; message: string };

export interface AspectPreset {
  id: string;
  label: string;
  /** Ancho / alto. null = sin proporción fija (recorte libre). */
  ratio: number | null;
}

export const ASPECT_PRESETS: readonly AspectPreset[] = [
  { id: 'libre', label: 'Libre', ratio: null },
  { id: '1:1', label: '1:1 (cuadrado)', ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:4', label: '3:4', ratio: 3 / 4 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 },
];

export function presetById(id: string): AspectPreset | undefined {
  return ASPECT_PRESETS.find((p) => p.id === id);
}

function fail<T>(message: string): Result<T> {
  return { ok: false, message };
}

/** Mayor rectángulo centrado con la proporción pedida (null = imagen completa). */
export function centeredCrop(srcW: number, srcH: number, ratio: number | null): Rect {
  if (ratio === null) return { x: 0, y: 0, width: srcW, height: srcH };
  let width = srcW;
  let height = srcH;
  if (srcW / srcH > ratio) width = Math.min(srcW, Math.max(1, Math.round(srcH * ratio)));
  else height = Math.min(srcH, Math.max(1, Math.round(srcW / ratio)));
  return centerRect(srcW, srcH, { x: 0, y: 0, width, height });
}

/** Vuelve a centrar un rectángulo de su mismo tamaño dentro de la imagen. */
export function centerRect(srcW: number, srcH: number, rect: Rect): Rect {
  return {
    x: Math.floor((srcW - rect.width) / 2),
    y: Math.floor((srcH - rect.height) / 2),
    width: rect.width,
    height: rect.height,
  };
}

/** Valida un recorte pedido. No lo ajusta en silencio: si se sale de la imagen, lo informa. */
export function clampCrop(srcW: number, srcH: number, rect: Rect): Result<Rect> {
  const values = [rect.x, rect.y, rect.width, rect.height];
  if (!values.every((v) => Number.isFinite(v))) {
    return fail('Completá x, y, ancho y alto del recorte con números enteros.');
  }
  const r = { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) };
  if (r.x < 0 || r.y < 0) return fail('El recorte no puede empezar fuera de la imagen (x e y deben ser 0 o más).');
  if (r.width < 1 || r.height < 1) return fail('El ancho y el alto del recorte deben ser de al menos 1 píxel.');
  if (r.x + r.width > srcW || r.y + r.height > srcH) {
    return fail(`El recorte se sale de la imagen (${srcW} × ${srcH} px). Reducí x, y, ancho o alto.`);
  }
  return { ok: true, value: r };
}

/** Lado que corresponde a mantener la proporción del recorte, a partir del lado editado. */
export function counterpart(crop: { width: number; height: number }, edited: 'width' | 'height', value: number): number {
  if (edited === 'width') return Math.max(1, Math.round((value * crop.height) / crop.width));
  return Math.max(1, Math.round((value * crop.width) / crop.height));
}

export interface OutputRequest {
  /** null = no indicado (se usa el tamaño del recorte). */
  width: number | null;
  height: number | null;
  keepRatio: boolean;
}

/** Tamaño final de la imagen exportada, con sus límites (lado y píxeles totales). */
export function outputSize(crop: { width: number; height: number }, req: OutputRequest): Result<{ width: number; height: number }> {
  let width = crop.width;
  let height = crop.height;
  if (req.keepRatio) {
    if (req.width !== null) {
      width = req.width;
      height = counterpart(crop, 'width', req.width);
    } else if (req.height !== null) {
      height = req.height;
      width = counterpart(crop, 'height', req.height);
    }
  } else {
    width = req.width ?? crop.width;
    height = req.height ?? crop.height;
  }

  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    return fail('Las dimensiones de salida deben ser números enteros de al menos 1 píxel.');
  }
  if (width > IMAGE_LIMITS.maxSide || height > IMAGE_LIMITS.maxSide) {
    return fail(`La salida ${width} × ${height} px supera el lado máximo de ${IMAGE_LIMITS.maxSide} px.`);
  }
  const pixels = width * height;
  if (pixels > TOOL_LIMITS.redimensionar.maxPixels) {
    return fail(
      `La salida ${width} × ${height} px (${(pixels / 1e6).toFixed(1)} MP) supera el límite de ${(TOOL_LIMITS.redimensionar.maxPixels / 1e6).toFixed(0)} MP.`,
    );
  }
  return { ok: true, value: { width, height } };
}
