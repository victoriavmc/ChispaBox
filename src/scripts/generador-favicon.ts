/*
 * Página «Generador de favicon»: a partir de una imagen (JPG, PNG o WebP) crea el paquete de
 * íconos para un sitio: favicon.ico, PNG de 16 a 512 px, manifiesto web y el código para <head>.
 * Todo corre en el navegador con canvas; no se sube nada a ningún servidor. Los SVG no se
 * admiten a propósito: pueden contener scripts.
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/generador-favicon.css';
import { buildIco, verifyIco, type IcoEntry } from '../lib/ico.ts';
import { readDimensions } from '../lib/image-file.ts';
import { attachDropzone, canvasToVerifiedBlob, clearError, requireEl, setStatus, showError, triggerDownload } from '../lib/ui-common.ts';
import { IMAGE_LIMITS, formatBytes, formatMegapixels } from '../shared/image-limits.ts';
import { sniffInputFormat } from '../shared/image-format.ts';
import { safeBaseName } from '../shared/nombre-archivo.ts';
import { buildZipStore } from '../shared/zip-store.ts';
import {
  FAVICON_ICO_SIZES,
  FAVICON_PNG_SIZES,
  buildHeadSnippet,
  buildPackageFiles,
  buildWebManifest,
  cleanSiteName,
  computeFit,
  normalizeHexColor,
  pngFileName,
  type FitMode,
} from '../shared/favicon.ts';

const MAX_PIXELS = 20_000_000;
const PREVIEW_SIZE = 128;

interface Generated {
  pngs: Map<number, Uint8Array>;
  ico: Uint8Array;
  zip: Uint8Array;
  zipName: string;
  snippet: string;
}

let bitmap: ImageBitmap | null = null;
let sourceName = 'favicon';
let generated: Generated | null = null;

const E = {
  dropzone: requireEl<HTMLElement>('fav-dropzone'),
  file: requireEl<HTMLInputElement>('fav-file'),
  requirements: requireEl<HTMLElement>('fav-requirements'),
  error: requireEl<HTMLElement>('fav-error'),
  info: requireEl<HTMLElement>('fav-info'),
  fit: requireEl<HTMLSelectElement>('fav-fit'),
  transparent: requireEl<HTMLInputElement>('fav-transparent'),
  bg: requireEl<HTMLInputElement>('fav-bg'),
  theme: requireEl<HTMLInputElement>('fav-theme'),
  siteName: requireEl<HTMLInputElement>('fav-name'),
  run: requireEl<HTMLButtonElement>('fav-run'),
  clear: requireEl<HTMLButtonElement>('fav-clear'),
  preview: requireEl<HTMLCanvasElement>('fav-preview'),
  sizes: requireEl<HTMLElement>('fav-sizes'),
  results: requireEl<HTMLElement>('fav-results'),
  zip: requireEl<HTMLButtonElement>('fav-zip'),
  ico: requireEl<HTMLButtonElement>('fav-ico'),
  snippet: requireEl<HTMLTextAreaElement>('fav-snippet'),
  copy: requireEl<HTMLButtonElement>('fav-copy'),
  status: requireEl<HTMLElement>('fav-status'),
};

function renderRequirements(): void {
  const lines = [
    'Formatos: JPG, PNG o WebP. Los SVG no se admiten.',
    `Peso máximo: ${formatBytes(IMAGE_LIMITS.maxBytes)}.`,
    `Lado máximo: ${IMAGE_LIMITS.maxSide} px y hasta ${formatMegapixels(MAX_PIXELS)} en total.`,
    'Consejo: usá una imagen cuadrada con el motivo centrado, de al menos 512 px.',
  ];
  E.requirements.replaceChildren(
    ...lines.map((line) => {
      const li = document.createElement('li');
      li.textContent = line;
      return li;
    }),
  );
}

function fitMode(): FitMode {
  return E.fit.value === 'contain' ? 'contain' : 'cover';
}

function backgroundColor(): string | null {
  if (E.transparent.checked) return null;
  return normalizeHexColor(E.bg.value) ?? '#ffffff';
}

function setBitmap(next: ImageBitmap | null): void {
  bitmap?.close();
  bitmap = next;
}

function resetOutput(): void {
  generated = null;
  E.results.hidden = true;
  E.snippet.value = '';
  E.sizes.replaceChildren();
}

function updateButtons(): void {
  E.run.disabled = !bitmap;
  E.clear.disabled = !bitmap && !generated;
}

/** Dibuja la imagen fuente sobre un canvas cuadrado del tamaño pedido. */
function drawSquare(size: number, mode: FitMode, background: string | null): HTMLCanvasElement {
  if (!bitmap) throw new Error('No hay imagen cargada.');
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('El navegador no permite dibujar el favicon.');
  ctx.clearRect(0, 0, size, size);
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, size, size);
  }
  const fit = computeFit(bitmap.width, bitmap.height, size, mode);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, fit.dx, fit.dy, fit.dw, fit.dh);
  return canvas;
}

function renderPreview(): void {
  if (!bitmap) return;
  const canvas = drawSquare(PREVIEW_SIZE, fitMode(), backgroundColor());
  const ctx = E.preview.getContext('2d');
  if (!ctx) return;
  E.preview.width = PREVIEW_SIZE;
  E.preview.height = PREVIEW_SIZE;
  ctx.clearRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
  ctx.drawImage(canvas, 0, 0);
  E.preview.hidden = false;
}

async function selectFile(file: File): Promise<void> {
  clearError(E.error);
  resetOutput();
  setBitmap(null);
  E.info.hidden = true;
  E.preview.hidden = true;
  updateButtons();

  if (file.size < 1) return showError(E.error, 'El archivo está vacío (0 bytes). Elegí otro.');
  if (file.size > IMAGE_LIMITS.maxBytes) {
    return showError(E.error, `La imagen pesa ${formatBytes(file.size)} y supera el máximo de ${formatBytes(IMAGE_LIMITS.maxBytes)}.`);
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = sniffInputFormat(bytes.subarray(0, 16));
  if (!format) {
    return showError(E.error, 'Formato no admitido. Elegí una imagen JPG, PNG o WebP (los SVG no se admiten).');
  }
  const header = readDimensions(bytes, format);
  if (!header || header.width < 1 || header.height < 1) {
    return showError(E.error, 'No se pudieron leer las dimensiones: el archivo parece dañado.');
  }
  const { width, height } = header;
  if (width > IMAGE_LIMITS.maxSide || height > IMAGE_LIMITS.maxSide) {
    return showError(E.error, `La imagen tiene ${width} × ${height} px y supera el lado máximo de ${IMAGE_LIMITS.maxSide} px.`);
  }
  if (width * height > MAX_PIXELS) {
    return showError(E.error, `La imagen tiene ${formatMegapixels(width * height)} y supera el máximo de ${formatMegapixels(MAX_PIXELS)}.`);
  }

  let decoded: ImageBitmap;
  try {
    decoded = await createImageBitmap(new Blob([bytes], { type: file.type || 'application/octet-stream' }), {
      imageOrientation: 'from-image',
    });
  } catch {
    return showError(E.error, 'No se pudo decodificar la imagen: el archivo está dañado o incompleto.');
  }
  setBitmap(decoded);
  sourceName = safeBaseName(file.name, 'favicon');
  E.info.replaceChildren(
    ...[
      ['Nombre', file.name],
      ['Peso', formatBytes(file.size)],
      ['Formato detectado', format === 'jpeg' ? 'JPG / JPEG' : format.toUpperCase()],
      ['Dimensiones', `${decoded.width} × ${decoded.height} px`],
    ].flatMap(([label, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = label ?? '';
      const dd = document.createElement('dd');
      dd.textContent = value ?? '';
      return [dt, dd];
    }),
  );
  E.info.hidden = false;
  renderPreview();
  updateButtons();
  setStatus(E.status, 'Imagen lista. Elegí el encuadre y generá el paquete.');
}

async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await canvasToVerifiedBlob(canvas, 'png');
  return new Uint8Array(await blob.arrayBuffer());
}

function readmeText(name: string): string {
  return [
    `Paquete de favicon: ${name}`,
    '',
    '1. Copiá favicon.ico, los PNG y site.webmanifest a la raíz de tu sitio (la carpeta pública).',
    '2. Pegá el contenido de fragmento-head.html dentro de <head> de cada página.',
    '3. Verificá la pestaña del navegador y la pantalla de inicio de un celular.',
    '',
    'Generado en el navegador: ningún archivo se envió a un servidor.',
    '',
  ].join('\n');
}

async function generate(): Promise<void> {
  if (!bitmap) return;
  clearError(E.error);
  E.run.disabled = true;
  setStatus(E.status, 'Generando el paquete…');
  try {
    const mode = fitMode();
    const background = backgroundColor();
    const themeColor = normalizeHexColor(E.theme.value);
    const pngs = new Map<number, Uint8Array>();
    for (const size of FAVICON_PNG_SIZES) {
      const canvas = drawSquare(size, mode, background);
      try {
        pngs.set(size, await canvasPng(canvas));
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    }

    const icoEntries: IcoEntry[] = FAVICON_ICO_SIZES.map((size) => {
      const png = pngs.get(size);
      if (!png) throw new Error(`Falta el PNG de ${size} px.`);
      return { size, png };
    });
    const ico = buildIco(icoEntries);
    verifyIco(ico);

    const name = cleanSiteName(E.siteName.value);
    const manifest = buildWebManifest({ name, themeColor, backgroundColor: background });
    const snippet = buildHeadSnippet(themeColor);
    const files = buildPackageFiles({ pngs, ico, manifest, snippet, readme: readmeText(name) });
    const zip = buildZipStore(files);

    generated = { pngs, ico, zip, zipName: `${sourceName}-favicon.zip`, snippet };
    renderResults();
    setStatus(E.status, 'Paquete generado. Descargalo y copiá el código para el <head>.');
  } catch (error) {
    showError(E.error, error instanceof Error ? error.message : 'No se pudo generar el paquete.');
    setStatus(E.status, 'La generación no terminó.');
  } finally {
    updateButtons();
  }
}

function renderResults(): void {
  if (!generated) return;
  E.sizes.replaceChildren(
    ...[...generated.pngs.entries()].map(([size, png]) => {
      const li = document.createElement('li');
      li.textContent = `${pngFileName(size)} · ${size} × ${size} px · ${formatBytes(png.byteLength)}`;
      return li;
    }),
  );
  E.snippet.value = generated.snippet;
  E.results.hidden = false;
}

function download(bytes: Uint8Array, mime: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type: mime }));
  triggerDownload(url, filename);
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function downloadZip(): void {
  if (!generated) return;
  download(generated.zip, 'application/zip', generated.zipName);
  setStatus(E.status, 'ZIP descargado.');
}

function downloadIco(): void {
  if (!generated) return;
  download(generated.ico, 'image/vnd.microsoft.icon', 'favicon.ico');
  setStatus(E.status, 'favicon.ico descargado.');
}

async function copySnippet(): Promise<void> {
  if (!E.snippet.value) return;
  try {
    await navigator.clipboard.writeText(E.snippet.value);
    setStatus(E.status, 'Código copiado al portapapeles.');
  } catch {
    E.snippet.select();
    setStatus(E.status, 'No se pudo usar el portapapeles. El código quedó seleccionado: copialo con Ctrl+C.');
  }
}

function clearAll(): void {
  setBitmap(null);
  resetOutput();
  clearError(E.error);
  E.info.hidden = true;
  E.preview.hidden = true;
  E.file.value = '';
  setStatus(E.status, '');
  updateButtons();
}

function init(): void {
  renderRequirements();
  updateButtons();
  E.file.addEventListener('change', () => {
    const file = E.file.files?.[0];
    if (file) void selectFile(file);
  });
  attachDropzone(E.dropzone, (files) => {
    if (files.length > 1) showError(E.error, 'Se usa solo el primer archivo. Subí una imagen por vez.');
    const file = files[0];
    if (file) void selectFile(file);
  });
  for (const control of [E.fit, E.transparent, E.bg, E.theme, E.siteName]) {
    control.addEventListener('change', () => {
      if (bitmap) renderPreview();
      resetOutput();
      updateButtons();
    });
  }
  E.bg.addEventListener('input', () => {
    if (bitmap) renderPreview();
  });
  E.transparent.addEventListener('change', () => {
    E.bg.disabled = E.transparent.checked;
  });
  E.run.addEventListener('click', () => void generate());
  E.clear.addEventListener('click', clearAll);
  E.zip.addEventListener('click', downloadZip);
  E.ico.addEventListener('click', downloadIco);
  E.copy.addEventListener('click', () => void copySnippet());
}

init();
