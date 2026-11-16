/*
 * Distribución de cada imagen dentro de su página PDF. Función pura: la usan
 * la vista previa y la exportación, así que lo que se ve es lo que se genera.
 *
 * Convención: 1 px = 1/96 in (0,75 pt), la misma que usan los navegadores para imágenes sin DPI.
 */
import { DOCUMENTOS_LIMITS, MARGINS_PT, PAGE_SIZES_PT, type MarginKey, type PageSizeKey } from './documentos-limits.ts';

export const PX_TO_PT = 0.75;

export type SizeOption = PageSizeKey | 'ajustado';
export type OrientationOption = 'automatica' | 'vertical' | 'horizontal';
export type FitOption = 'ajustar' | 'rellenar' | 'original';

export interface LayoutOptions {
  size: SizeOption;
  orientation: OrientationOption;
  margin: MarginKey;
  fit: FitOption;
}

export interface PageLayout {
  /** Página en puntos PDF. */
  pageWidth: number;
  pageHeight: number;
  /** Imagen dibujada, en puntos, desde la esquina inferior izquierda (como exige PDF). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Orientación resultante de la página. */
  orientation: 'vertical' | 'horizontal';
  /** La imagen se recorta en los bordes (solo con «rellenar»). */
  cropped: boolean;
  /** La imagen se reduce o amplía respecto a su tamaño natural. */
  scale: number;
  marginPt: number;
  /** La página se ajustó a los límites reales del formato PDF. */
  clampedToPdfLimits: boolean;
}

export function naturalSizePt(widthPx: number, heightPx: number): { width: number; height: number } {
  return { width: widthPx * PX_TO_PT, height: heightPx * PX_TO_PT };
}

function clampPageSide(value: number): number {
  return Math.min(DOCUMENTOS_LIMITS.pdfMaxPageSidePt, Math.max(DOCUMENTOS_LIMITS.pdfMinPageSidePt, value));
}

/** Calcula la página y la posición de la imagen. Lanza error si los datos no son válidos. */
export function computeLayout(widthPx: number, heightPx: number, options: LayoutOptions): PageLayout {
  if (!(widthPx > 0) || !(heightPx > 0)) throw new Error('Dimensiones de imagen no válidas.');
  const marginPt = MARGINS_PT[options.margin];
  const natural = naturalSizePt(widthPx, heightPx);
  const imageIsWide = widthPx > heightPx;

  // Tamaño ajustado: la página tiene el tamaño de la imagen más sus márgenes.
  if (options.size === 'ajustado') {
    const maxW = DOCUMENTOS_LIMITS.pdfMaxPageSidePt - 2 * marginPt;
    const maxH = DOCUMENTOS_LIMITS.pdfMaxPageSidePt - 2 * marginPt;
    const k = Math.min(1, maxW / natural.width, maxH / natural.height);
    const w = natural.width * k;
    const h = natural.height * k;
    const pageWidth = clampPageSide(w + 2 * marginPt);
    const pageHeight = clampPageSide(h + 2 * marginPt);
    return {
      pageWidth,
      pageHeight,
      x: marginPt,
      y: marginPt,
      width: w,
      height: h,
      orientation: pageWidth >= pageHeight ? 'horizontal' : 'vertical',
      cropped: false,
      scale: k,
      marginPt,
      clampedToPdfLimits: k < 1,
    };
  }

  const base = PAGE_SIZES_PT[options.size];
  const landscape =
    options.orientation === 'horizontal' || (options.orientation === 'automatica' && imageIsWide);
  const pageWidth = landscape ? base.height : base.width;
  const pageHeight = landscape ? base.width : base.height;
  const areaW = pageWidth - 2 * marginPt;
  const areaH = pageHeight - 2 * marginPt;

  if (options.fit === 'rellenar') {
    // Ocupa toda la página sin márgenes; lo que sobra se recorta en los bordes.
    const s = Math.max(pageWidth / natural.width, pageHeight / natural.height);
    const w = natural.width * s;
    const h = natural.height * s;
    return {
      pageWidth,
      pageHeight,
      x: (pageWidth - w) / 2,
      y: (pageHeight - h) / 2,
      width: w,
      height: h,
      orientation: landscape ? 'horizontal' : 'vertical',
      cropped: w > pageWidth + 0.01 || h > pageHeight + 0.01,
      scale: s,
      marginPt,
      clampedToPdfLimits: false,
    };
  }

  // «ajustar» amplía o reduce para verla completa; «original» nunca amplía.
  const fitScale = Math.min(areaW / natural.width, areaH / natural.height);
  const s = options.fit === 'original' ? Math.min(1, fitScale) : fitScale;
  const w = natural.width * s;
  const h = natural.height * s;
  return {
    pageWidth,
    pageHeight,
    x: marginPt + (areaW - w) / 2,
    y: marginPt + (areaH - h) / 2,
    width: w,
    height: h,
    orientation: landscape ? 'horizontal' : 'vertical',
    cropped: false,
    scale: s,
    marginPt,
    clampedToPdfLimits: false,
  };
}

export const ORIENTATION_LABEL: Record<OrientationOption, string> = {
  automatica: 'Automática',
  vertical: 'Vertical',
  horizontal: 'Horizontal',
};

export const SIZE_LABEL: Record<SizeOption, string> = {
  a4: 'A4',
  letter: 'Carta',
  legal: 'Oficio/Legal',
  ajustado: 'Ajustado a la imagen',
};

export const MARGIN_LABEL: Record<MarginKey, string> = {
  normal: 'Normal (0,5 in)',
  reducido: 'Reducido (1/6 in)',
  ninguno: 'Sin márgenes',
};

export const FIT_LABEL: Record<FitOption, string> = {
  ajustar: 'Ajustar (imagen completa)',
  rellenar: 'Rellenar (recorta bordes)',
  original: 'Tamaño original o proporcional',
};
