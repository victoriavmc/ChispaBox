/*
 * Conversiones de color para «Selector de color». Solo aritmética: sin librerías ni servicios.
 * Valores RGB de 0 a 255; HSL y HSV con matiz de 0 a 360 y saturación/luminosidad de 0 a 100.
 */

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface Hsl {
  h: number;
  s: number;
  l: number;
}

export interface Hsv {
  h: number;
  s: number;
  v: number;
}

const redondear = (n: number): number => Math.round(n);

function acotar(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** Pasa los valores a enteros de 0 a 255. */
export function normalizarRgb(r: number, g: number, b: number): Rgb {
  return {
    r: acotar(redondear(r), 0, 255),
    g: acotar(redondear(g), 0, 255),
    b: acotar(redondear(b), 0, 255),
  };
}

export function rgbAHex({ r, g, b }: Rgb): string {
  const par = (n: number) => n.toString(16).toUpperCase().padStart(2, '0');
  return `#${par(r)}${par(g)}${par(b)}`;
}

/** Matiz (0-360) a partir de los máximos y la diferencia de canales. */
function matiz(r: number, g: number, b: number, max: number, delta: number): number {
  if (delta === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

export function rgbAHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return {
    h: redondear(matiz(rn, gn, bn, max, delta)) % 360,
    s: redondear(acotar(s, 0, 1) * 100),
    l: redondear(l * 100),
  };
}

export function rgbAHsv({ r, g, b }: Rgb): Hsv {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  const s = max === 0 ? 0 : delta / max;
  return {
    h: redondear(matiz(rn, gn, bn, max, delta)) % 360,
    s: redondear(s * 100),
    v: redondear(max * 100),
  };
}

/** Texto listo para copiar en cada formato. */
export function formatosColor(rgb: Rgb): { hex: string; rgb: string; hsl: string; hsv: string } {
  const hsl = rgbAHsl(rgb);
  const hsv = rgbAHsv(rgb);
  return {
    hex: rgbAHex(rgb),
    rgb: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
    hsl: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
    hsv: `hsv(${hsv.h}, ${hsv.s}%, ${hsv.v}%)`,
  };
}
