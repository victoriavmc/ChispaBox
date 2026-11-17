/* Utilidades compartidas por las páginas de herramientas de imagen. */
import { formatBytes } from '../shared/image-limits';
import { outputMatches, type OutputFormat } from '../shared/image-format';
import type { ImageInfo } from './image-file';

export function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta el elemento #${id}`);
  return el as T;
}

export function setStatus(el: HTMLElement, message: string): void {
  el.textContent = message;
}

export function showError(el: HTMLElement, message: string): void {
  el.textContent = message;
  el.hidden = false;
}

export function clearError(el: HTMLElement): void {
  el.textContent = '';
  el.hidden = true;
}

/** Muestra nombre, formato, peso, dimensiones, píxeles y estado de validación. */
export function renderInfo(list: HTMLElement, info: ImageInfo | null): void {
  list.replaceChildren();
  if (!info) {
    list.hidden = true;
    return;
  }
  const rows: Array<[string, string]> = [
    ['Nombre', info.name],
    ['Formato detectado', info.format === 'jpeg' ? 'JPG / JPEG' : info.format.toUpperCase()],
    ['Peso', formatBytes(info.sizeBytes)],
    ['Ancho', `${info.width} px`],
    ['Alto', `${info.height} px`],
    ['Píxeles', info.pixels.toLocaleString('es-AR')],
    ['Validación', 'Correcta'],
  ];
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    list.append(dt, dd);
  }
  list.hidden = false;
}

/** Activa arrastrar y soltar sobre una zona de carga, además del selector de archivos. */
export function attachDropzone(zone: HTMLElement, onFiles: (files: File[]) => void): void {
  zone.addEventListener('dragover', (e) => {
    e.preventDefault();
    zone.classList.add('is-dragover');
  });
  zone.addEventListener('dragleave', () => zone.classList.remove('is-dragover'));
  zone.addEventListener('drop', (e) => {
    e.preventDefault();
    zone.classList.remove('is-dragover');
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) onFiles(files);
  });
}

/**
 * Convierte un canvas a Blob y comprueba que el formato generado sea el pedido.
 * Algunos navegadores devuelven PNG cuando no soportan WebP u otro formato.
 */
export async function canvasToVerifiedBlob(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  format: OutputFormat,
  quality?: number,
): Promise<Blob> {
  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  const blob = await encodeCanvas(canvas, mime, quality);
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (!outputMatches(head, format)) {
    throw new Error(`El navegador no pudo generar ${format.toUpperCase()}.`);
  }
  return blob;
}

function encodeCanvas(canvas: HTMLCanvasElement | OffscreenCanvas, mime: string, quality?: number): Promise<Blob> {
  const options = quality === undefined ? undefined : { quality };
  if (canvas instanceof HTMLCanvasElement) {
    return new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('No se pudo generar el archivo.'))), mime, options?.quality);
    });
  }
  return canvas.convertToBlob({ type: mime, ...(options ?? {}) });
}

/** Indica si el navegador codifica realmente un formato (no se asume por el nombre). */
export async function canEncode(format: 'jpeg' | 'png' | 'webp'): Promise<boolean> {
  const canvas = document.createElement('canvas');
  canvas.width = 2;
  canvas.height = 2;
  const mime = format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
  try {
    const blob = await encodeCanvas(canvas, mime, 0.8);
    const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    return outputMatches(head, format);
  } catch {
    return false;
  }
}

/** Libera un canvas grande (el navegador conserva el búfer hasta que se vacía). */
export function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

export function triggerDownload(url: string, filename: string): void {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
}
