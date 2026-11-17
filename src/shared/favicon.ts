/*
 * Lógica pura del generador de favicon (sin DOM): tamaños, geometría de encuadre,
 * manifiesto web, fragmento HTML y lista de archivos del paquete ZIP.
 * La usan la interfaz y los tests.
 */
import type { ZipStoreFile } from './zip-store.ts';

/** Tamaños PNG del paquete (nombre de archivo y lado en píxeles). */
export const FAVICON_PNG_SIZES = [16, 32, 48, 180, 192, 512] as const;

/** Tamaños incluidos dentro del favicon.ico (formato clásico de Windows y navegadores). */
export const FAVICON_ICO_SIZES = [16, 32, 48] as const;

export type FitMode = 'cover' | 'contain';

export interface FitRect {
  dx: number;
  dy: number;
  dw: number;
  dh: number;
}

/**
 * Calcula dónde dibujar la imagen dentro de un lienzo cuadrado de `size` px.
 * - `cover`: la imagen llena el cuadrado y se recorta lo que sobra (centrado).
 * - `contain`: la imagen entera entra en el cuadrado, con bordes del color de fondo.
 */
export function computeFit(srcWidth: number, srcHeight: number, size: number, mode: FitMode): FitRect {
  if (srcWidth < 1 || srcHeight < 1 || size < 1) throw new Error('Dimensiones no válidas.');
  const scale = mode === 'cover' ? Math.max(size / srcWidth, size / srcHeight) : Math.min(size / srcWidth, size / srcHeight);
  const dw = srcWidth * scale;
  const dh = srcHeight * scale;
  return { dx: (size - dw) / 2, dy: (size - dh) / 2, dw, dh };
}

/** Acepta solo #RRGGBB; devuelve null si no es válido (nunca se inserta texto libre en CSS ni HTML). */
export function normalizeHexColor(value: string): string | null {
  const trimmed = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(trimmed) ? trimmed.toLowerCase() : null;
}

/** Nombre del sitio limitado y sin saltos de línea, para el manifiesto. */
export function cleanSiteName(raw: string, fallback = 'Mi sitio'): string {
  const cleaned = raw.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return cleaned.length > 0 ? cleaned : fallback;
}

export interface ManifestOptions {
  name: string;
  themeColor: string | null;
  backgroundColor: string | null;
}

/** Manifiesto web (site.webmanifest) con los íconos del paquete. */
export function buildWebManifest(options: ManifestOptions): string {
  const manifest: Record<string, unknown> = {
    name: options.name,
    short_name: options.name.slice(0, 12),
    icons: [
      { src: 'android-chrome-192x192.png', sizes: '192x192', type: 'image/png' },
      { src: 'android-chrome-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    display: 'standalone',
  };
  if (options.themeColor) manifest.theme_color = options.themeColor;
  if (options.backgroundColor) manifest.background_color = options.backgroundColor;
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** Fragmento para pegar dentro de <head>. Solo contiene rutas fijas del paquete. */
export function buildHeadSnippet(themeColor: string | null): string {
  const lines = [
    '<link rel="icon" href="/favicon.ico" sizes="any" />',
    '<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />',
    '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />',
    '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />',
    '<link rel="manifest" href="/site.webmanifest" />',
  ];
  if (themeColor) lines.push(`<meta name="theme-color" content="${themeColor}" />`);
  return `${lines.join('\n')}\n`;
}

export function pngFileName(size: number): string {
  if (size === 180) return 'apple-touch-icon.png';
  if (size === 192) return 'android-chrome-192x192.png';
  if (size === 512) return 'android-chrome-512x512.png';
  return `favicon-${size}x${size}.png`;
}

export interface PackageInput {
  pngs: ReadonlyMap<number, Uint8Array>;
  ico: Uint8Array;
  manifest: string;
  snippet: string;
  readme: string;
}

/** Archivos del paquete ZIP, en el orden en que se muestran al usuario. */
export function buildPackageFiles(input: PackageInput): ZipStoreFile[] {
  const encoder = new TextEncoder();
  const files: ZipStoreFile[] = [{ name: 'favicon.ico', data: input.ico }];
  for (const size of FAVICON_PNG_SIZES) {
    const png = input.pngs.get(size);
    if (!png) throw new Error(`Falta el PNG de ${size} px.`);
    files.push({ name: pngFileName(size), data: png });
  }
  files.push({ name: 'site.webmanifest', data: encoder.encode(input.manifest) });
  files.push({ name: 'fragmento-head.html', data: encoder.encode(input.snippet) });
  files.push({ name: 'LEEME.txt', data: encoder.encode(input.readme) });
  return files;
}
