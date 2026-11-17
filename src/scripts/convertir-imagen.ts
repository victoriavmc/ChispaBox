/*
 * Convertir imágenes entre JPG, PNG, WebP e ICO en el navegador (Canvas API + ICO propio).
 * Sin IA, sin red. Cada archivo se valida antes de convertirse y se decodifica
 * solo cuando le toca su turno, para no mantener varias imágenes en memoria a la vez.
 */
import '../styles/grabar-audio.css';
import '../styles/image-tools.css';

import { IMAGE_LIMITS, TOOL_LIMITS, formatBytes } from '../shared/image-limits';
import { OUTPUT_EXTENSION, type OutputFormat } from '../shared/image-format';
import { inspectImageFile, requirementLines, type ImageInfo } from '../lib/image-file';
import { buildIco, verifyIco, ICO_MAX_SIZE, type IcoEntry } from '../lib/ico';
import {
  attachDropzone,
  canEncode,
  canvasToVerifiedBlob,
  clearError,
  releaseCanvas,
  renderInfo,
  requireEl,
  setStatus,
  showError,
} from '../lib/ui-common';

const MAX_PIXELS = TOOL_LIMITS.convertir.maxPixels;

interface Item {
  file: File;
  info: ImageInfo;
  url: string | null; // URL temporal del original para la vista previa (solo del primero)
}

interface Result {
  name: string;
  format: OutputFormat;
  sizeBytes: number;
  width: number;
  height: number;
  url: string;
  previewUrl: string;
}

const fileInput = requireEl<HTMLInputElement>('conv-file');
const dropzone = requireEl<HTMLElement>('conv-dropzone');
const requirementsList = requireEl<HTMLElement>('conv-requirements');
const listEl = requireEl<HTMLOListElement>('conv-list');
const infoEl = requireEl<HTMLElement>('conv-info');
const originalImg = requireEl<HTMLImageElement>('conv-preview-original');
const resultImg = requireEl<HTMLImageElement>('conv-preview-result');
const formatSelect = requireEl<HTMLSelectElement>('conv-format');
const keepSize = requireEl<HTMLInputElement>('conv-keep-size');
const keepRatio = requireEl<HTMLInputElement>('conv-keep-ratio');
const widthInput = requireEl<HTMLInputElement>('conv-width');
const heightInput = requireEl<HTMLInputElement>('conv-height');
const sizeFields = requireEl<HTMLElement>('conv-size-fields');
const qualityWrap = requireEl<HTMLElement>('conv-quality-wrap');
const quality = requireEl<HTMLInputElement>('conv-quality');
const qualityValue = requireEl<HTMLElement>('conv-quality-value');
const bgWrap = requireEl<HTMLElement>('conv-bg-wrap');
const bgColor = requireEl<HTMLInputElement>('conv-bg');
const icoWrap = requireEl<HTMLElement>('conv-ico-wrap');
const icoSizeInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="conv-ico-size"]'));
const icoMode = requireEl<HTMLSelectElement>('conv-ico-mode');
const icoX = requireEl<HTMLInputElement>('conv-ico-x');
const icoY = requireEl<HTMLInputElement>('conv-ico-y');
const runBtn = requireEl<HTMLButtonElement>('conv-run');
const cancelBtn = requireEl<HTMLButtonElement>('conv-cancel');
const resetOptsBtn = requireEl<HTMLButtonElement>('conv-reset-opts');
const clearBtn = requireEl<HTMLButtonElement>('conv-clear');
const progressWrap = requireEl<HTMLElement>('conv-progress-wrap');
const progressText = requireEl<HTMLElement>('conv-progress-text');
const statusEl = requireEl<HTMLElement>('conv-status');
const errorEl = requireEl<HTMLElement>('conv-error');
const resultsList = requireEl<HTMLUListElement>('conv-results');

let items: Item[] = [];
let results: Result[] = [];
let running = false;
let cancelRequested = false;
let lastEdited: 'w' | 'h' = 'w';

requirementsList.replaceChildren(
  ...requirementLines(MAX_PIXELS, ['JPG', 'PNG', 'WebP']).map((line) => {
    const li = document.createElement('li');
    li.textContent = line;
    return li;
  }),
);
const outputLine = document.createElement('li');
outputLine.textContent = 'Salida: JPG, PNG, WebP o ICO (16, 32, 48 y 256 px). ICO como entrada no se admite.';
requirementsList.append(outputLine);
const batchLine = document.createElement('li');
batchLine.textContent = `Lote: hasta ${IMAGE_LIMITS.maxBatchFiles} imágenes por vez.`;
requirementsList.append(batchLine);

/* ---------- Opciones ---------- */

function outputFormat(): OutputFormat {
  return formatSelect.value as OutputFormat;
}

function selectedIcoSizes(): number[] {
  return icoSizeInputs.filter((i) => i.checked).map((i) => Number(i.value)).sort((a, b) => a - b);
}

function refreshOptions(): void {
  const format = outputFormat();
  qualityWrap.hidden = !(format === 'jpeg' || format === 'webp');
  qualityValue.textContent = quality.value;
  bgWrap.hidden = format !== 'jpeg';
  icoWrap.hidden = format !== 'ico';
  sizeFields.hidden = keepSize.checked;
  widthInput.disabled = keepSize.checked;
  heightInput.disabled = keepSize.checked;
  const hasItems = items.length > 0;
  runBtn.disabled = !hasItems || running || (format === 'ico' && selectedIcoSizes().length === 0);
  cancelBtn.hidden = !running;
  clearBtn.disabled = running;
  resetOptsBtn.disabled = running;
}

function resetOptions(): void {
  formatSelect.value = 'webp';
  keepSize.checked = true;
  keepRatio.checked = true;
  widthInput.value = '';
  heightInput.value = '';
  quality.value = '90';
  bgColor.value = '#ffffff';
  icoSizeInputs.forEach((i) => (i.checked = true));
  icoMode.value = 'recortar';
  icoX.value = '0';
  icoY.value = '0';
  refreshOptions();
}

/** Dimensiones de salida para un archivo, según las opciones (mantener o cambiar). */
function targetSize(info: ImageInfo): { width: number; height: number } | string {
  if (keepSize.checked) return { width: info.width, height: info.height };
  const w = Number.parseInt(widthInput.value, 10);
  const h = Number.parseInt(heightInput.value, 10);
  const hasW = Number.isFinite(w) && widthInput.value.trim() !== '';
  const hasH = Number.isFinite(h) && heightInput.value.trim() !== '';
  if (!hasW && !hasH) return 'Indicá el ancho o el alto de salida, o elegí mantener las dimensiones originales.';
  let width = hasW ? w : 0;
  let height = hasH ? h : 0;
  if (keepRatio.checked) {
    // Se calcula el lado que falta a partir del que se editó por última vez.
    if (hasW && (lastEdited === 'w' || !hasH)) {
      width = w;
      height = Math.round((w * info.height) / info.width);
    } else {
      height = h;
      width = Math.round((h * info.width) / info.height);
    }
  } else if (!hasW || !hasH) {
    return 'Sin conservar proporciones, indicá ancho y alto.';
  }
  if (width < 1 || height < 1) return 'Las dimensiones de salida deben ser de al menos 1 píxel.';
  if (width > IMAGE_LIMITS.maxSide || height > IMAGE_LIMITS.maxSide) {
    return `La salida ${width} × ${height} px supera el lado máximo de ${IMAGE_LIMITS.maxSide} px.`;
  }
  if (width * height > MAX_PIXELS) {
    return `La salida ${width} × ${height} px (${((width * height) / 1e6).toFixed(1)} MP) supera el límite de ${(MAX_PIXELS / 1e6).toFixed(0)} MP.`;
  }
  return { width, height };
}

/* ---------- Archivos ---------- */

function renderList(): void {
  listEl.replaceChildren();
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'conv-item';
    const name = document.createElement('span');
    name.textContent = `${item.info.name} · ${item.info.format.toUpperCase()} · ${formatBytes(item.info.sizeBytes)} · ${item.info.width} × ${item.info.height} px`;
    li.append(name);
    listEl.append(li);
  }
  listEl.hidden = items.length === 0;
}

async function addFiles(files: File[]): Promise<void> {
  clearError(errorEl);
  if (running) return;
  if (files.length > IMAGE_LIMITS.maxBatchFiles) {
    showError(errorEl, `Podés convertir hasta ${IMAGE_LIMITS.maxBatchFiles} imágenes por vez. Elegiste ${files.length}.`);
    fileInput.value = '';
    return;
  }
  clearAll(false);
  const failures: string[] = [];
  for (const file of files) {
    const result = await inspectImageFile(file, MAX_PIXELS);
    if (!result.ok) {
      failures.push(`${file.name}: ${result.message}`);
      continue;
    }
    result.bitmap.close();
    items.push({ file, info: result.info, url: null });
  }
  fileInput.value = '';
  if (failures.length > 0) showError(errorEl, failures.join('\n'));
  renderList();
  const first = items[0];
  if (first) {
    if (first.url) URL.revokeObjectURL(first.url);
    first.url = URL.createObjectURL(first.file);
    originalImg.src = first.url;
    originalImg.hidden = false;
    renderInfo(infoEl, first.info);
    setStatus(statusEl, `${items.length} imagen(es) lista(s). Elegí el formato y convertí.`);
  } else {
    originalImg.hidden = true;
    renderInfo(infoEl, null);
    setStatus(statusEl, 'Ninguna imagen cumple los requisitos. Revisá los mensajes.');
  }
  refreshOptions();
}

function clearResults(): void {
  for (const r of results) {
    URL.revokeObjectURL(r.url);
    if (r.previewUrl !== r.url) URL.revokeObjectURL(r.previewUrl);
  }
  results = [];
  resultsList.replaceChildren();
  resultsList.hidden = true;
  resultImg.removeAttribute('src');
  resultImg.hidden = true;
}

function clearAll(resetFileState: boolean): void {
  for (const item of items) if (item.url) URL.revokeObjectURL(item.url);
  items = [];
  clearResults();
  listEl.replaceChildren();
  listEl.hidden = true;
  originalImg.removeAttribute('src');
  originalImg.hidden = true;
  renderInfo(infoEl, null);
  if (resetFileState) {
    fileInput.value = '';
    clearError(errorEl);
    setStatus(statusEl, 'Elegí una o más imágenes para empezar.');
  }
  refreshOptions();
}

/* ---------- Conversión ---------- */

async function decode(file: File): Promise<ImageBitmap> {
  return createImageBitmap(file);
}

/** Dibuja una imagen en un canvas de salida, con relleno de fondo si el formato lo requiere. */
function drawRaster(bitmap: ImageBitmap, width: number, height: number, fill: string | null): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvas;
}

/** Cuadrado de «size» px con la imagen encuadrada: recortada (cubre) o completa con márgenes (contiene). */
function drawSquare(bitmap: ImageBitmap, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas');
  const cover = icoMode.value === 'recortar';
  const scale = cover ? Math.max(size / bitmap.width, size / bitmap.height) : Math.min(size / bitmap.width, size / bitmap.height);
  const dw = bitmap.width * scale;
  const dh = bitmap.height * scale;
  // Desplazamiento de -50 a 50 % sobre el espacio sobrante (0 = centrado).
  const px = (Number(icoX.value) + 50) / 100;
  const py = (Number(icoY.value) + 50) / 100;
  const dx = cover ? -(dw - size) * px : (size - dw) * px;
  const dy = cover ? -(dh - size) * py : (size - dh) * py;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, dx, dy, dw, dh);
  return canvas;
}

async function convertIco(bitmap: ImageBitmap): Promise<{ bytes: Uint8Array<ArrayBuffer>; previewPng: Blob }> {
  const sizes = selectedIcoSizes().filter((s) => s <= ICO_MAX_SIZE);
  const entries: IcoEntry[] = [];
  let previewPng: Blob | null = null;
  for (const size of sizes) {
    const canvas = drawSquare(bitmap, size);
    const png = await canvasToVerifiedBlob(canvas, 'png');
    releaseCanvas(canvas);
    entries.push({ size, png: new Uint8Array(await png.arrayBuffer()) });
    if (size === Math.max(...sizes)) previewPng = png;
  }
  const bytes = buildIco(entries);
  verifyIco(bytes);
  return { bytes, previewPng: previewPng ?? new Blob() };
}

async function convertItem(item: Item): Promise<Result> {
  const format = outputFormat();
  const size = targetSize(item.info);
  if (typeof size === 'string') throw new Error(size);
  const bitmap = await decode(item.file);
  let canvas: HTMLCanvasElement | null = null;
  try {
    const base = item.info.name.replace(/\.[^.]+$/, '') || 'imagen';
    const ext = OUTPUT_EXTENSION[format];
    if (format === 'ico') {
      const { bytes, previewPng } = await convertIco(bitmap);
      const blob = new Blob([bytes], { type: 'image/x-icon' });
      const url = URL.createObjectURL(blob);
      return {
        name: `${base}.${ext}`,
        format,
        sizeBytes: blob.size,
        width: Math.max(...selectedIcoSizes()),
        height: Math.max(...selectedIcoSizes()),
        url,
        previewUrl: URL.createObjectURL(previewPng),
      };
    }
    canvas = drawRaster(bitmap, size.width, size.height, format === 'jpeg' ? bgColor.value : null);
    const q = format === 'jpeg' || format === 'webp' ? Number(quality.value) / 100 : undefined;
    const blob = await canvasToVerifiedBlob(canvas, format, q);
    const url = URL.createObjectURL(blob);
    return {
      name: `${base}.${ext}`,
      format,
      sizeBytes: blob.size,
      width: size.width,
      height: size.height,
      url,
      previewUrl: url,
    };
  } finally {
    bitmap.close();
    if (canvas) releaseCanvas(canvas);
  }
}

function renderResults(): void {
  resultsList.replaceChildren();
  for (const r of results) {
    const li = document.createElement('li');
    li.className = 'conv-item';
    const text = document.createElement('span');
    text.textContent = `${r.name} · ${r.format.toUpperCase()} · ${formatBytes(r.sizeBytes)} · ${r.width} × ${r.height} px`;
    const link = document.createElement('a');
    link.className = 'btn btn--soft';
    link.href = r.url;
    link.download = r.name;
    link.textContent = 'Descargar';
    li.append(text, link);
    resultsList.append(li);
  }
  resultsList.hidden = results.length === 0;
  const first = results[0];
  if (first) {
    resultImg.src = first.previewUrl;
    resultImg.hidden = false;
  } else {
    resultImg.removeAttribute('src');
    resultImg.hidden = true;
  }
}

async function runConversion(): Promise<void> {
  if (running || items.length === 0) return;
  clearError(errorEl);
  clearResults();
  const format = outputFormat();
  if (format === 'ico' && selectedIcoSizes().length === 0) {
    showError(errorEl, 'Elegí al menos un tamaño para el ICO.');
    return;
  }
  const failures: string[] = [];
  running = true;
  cancelRequested = false;
  progressWrap.hidden = false;
  refreshOptions();
  const started = performance.now();
  try {
    for (let n = 0; n < items.length; n++) {
      const item = items[n];
      if (!item) continue;
      if (cancelRequested) {
        failures.push('Conversión cancelada por el usuario.');
        break;
      }
      if (performance.now() - started > IMAGE_LIMITS.maxProcessingMs) {
        failures.push(`Se superó el tiempo máximo de ${IMAGE_LIMITS.maxProcessingMs / 1000} s. Se detuvo la conversión.`);
        break;
      }
      progressText.textContent = `Convirtiendo ${n + 1} de ${items.length}: ${item.info.name}`;
      try {
        results.push(await convertItem(item));
      } catch (err) {
        console.error(err);
        const msg = err instanceof RangeError
          ? 'Falta memoria para esta imagen. Probá con una más chica.'
          : err instanceof Error && /no pudo generar|no válida|Tamaño ICO|Indicá|Sin conservar|Las dimensiones|supera|Cabecera|Tabla|no contiene|apunta|cuadrado|PNG/.test(err.message)
            ? err.message
            : 'No se pudo convertir esta imagen.';
        failures.push(`${item.info.name}: ${msg}`);
      }
    }
  } finally {
    running = false;
    progressWrap.hidden = true;
    progressText.textContent = '';
    renderResults();
    refreshOptions();
  }
  if (failures.length > 0) showError(errorEl, failures.join('\n'));
  if (results.length > 0) {
    setStatus(statusEl, `Listo: ${results.length} archivo(s) convertido(s). El original no se modificó.`);
  } else {
    setStatus(statusEl, '');
  }
}

/* ---------- Eventos ---------- */

fileInput.addEventListener('change', () => void addFiles(Array.from(fileInput.files ?? [])));
attachDropzone(dropzone, (files) => void addFiles(files));
formatSelect.addEventListener('change', () => {
  clearResults();
  refreshOptions();
});
keepSize.addEventListener('change', refreshOptions);
keepRatio.addEventListener('change', refreshOptions);
widthInput.addEventListener('input', () => {
  lastEdited = 'w';
});
heightInput.addEventListener('input', () => {
  lastEdited = 'h';
});
quality.addEventListener('input', refreshOptions);
icoSizeInputs.forEach((i) => i.addEventListener('change', refreshOptions));
runBtn.addEventListener('click', () => void runConversion());
cancelBtn.addEventListener('click', () => {
  cancelRequested = true;
  setStatus(statusEl, 'Cancelando después del archivo en curso…');
});
resetOptsBtn.addEventListener('click', resetOptions);
clearBtn.addEventListener('click', () => clearAll(true));

// Al cerrar la pestaña se liberan las URLs temporales y los resultados.
window.addEventListener('pagehide', () => {
  for (const item of items) if (item.url) URL.revokeObjectURL(item.url);
  clearResults();
});

void canEncode('webp').then((ok) => {
  const option = formatSelect.querySelector<HTMLOptionElement>('option[value="webp"]');
  if (option && !ok) {
    option.disabled = true;
    option.textContent = 'WebP (con transparencia; no disponible en este navegador)';
    if (formatSelect.value === 'webp') formatSelect.value = 'png';
  }
});

resetOptions();
setStatus(statusEl, 'Elegí una o más imágenes para empezar.');
