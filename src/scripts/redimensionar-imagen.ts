/*
 * Redimensionar y recortar una imagen en el navegador (Canvas API, sin dependencias externas).
 * Sin IA, sin red. La imagen se valida antes de decodificarse (src/lib/image-file.ts)
 * y el resultado existe solo como blob local hasta que el usuario lo descarga.
 */
import '../styles/grabar-audio.css';
import '../styles/image-tools.css';

import { TOOL_LIMITS, formatBytes } from '../shared/image-limits.ts';
import { OUTPUT_EXTENSION, type OutputFormat } from '../shared/image-format.ts';
import { inspectImageFile, requirementLines, type ImageInfo } from '../lib/image-file.ts';
import {
  ASPECT_PRESETS,
  centerRect,
  centeredCrop,
  clampCrop,
  counterpart,
  outputSize,
  presetById,
  type OutputRequest,
  type Rect,
  type Result,
} from '../shared/resize-crop.ts';
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
  triggerDownload,
} from '../lib/ui-common.ts';

const MAX_PIXELS = TOOL_LIMITS.redimensionar.maxPixels;
const PREVIEW_MAX_W = 760;
const PREVIEW_MAX_H = 520;
const FORMAT_LABEL: Record<OutputFormat, string> = { jpeg: 'JPG', png: 'PNG', webp: 'WebP', ico: 'ICO' };

interface Loaded {
  file: File;
  info: ImageInfo;
  bitmap: ImageBitmap;
}

const fileInput = requireEl<HTMLInputElement>('res-file');
const dropzone = requireEl<HTMLElement>('res-dropzone');
const requirementsList = requireEl<HTMLElement>('res-requirements');
const errorEl = requireEl<HTMLElement>('res-error');
const infoEl = requireEl<HTMLElement>('res-info');
const previewCanvas = requireEl<HTMLCanvasElement>('res-preview');
const previewEmpty = requireEl<HTMLElement>('res-preview-empty');
const aspectSelect = requireEl<HTMLSelectElement>('res-aspect');
const cropX = requireEl<HTMLInputElement>('res-crop-x');
const cropY = requireEl<HTMLInputElement>('res-crop-y');
const cropW = requireEl<HTMLInputElement>('res-crop-w');
const cropH = requireEl<HTMLInputElement>('res-crop-h');
const centerBtn = requireEl<HTMLButtonElement>('res-center');
const cropMsg = requireEl<HTMLElement>('res-crop-msg');
const resizeToggle = requireEl<HTMLInputElement>('res-resize');
const sizeFields = requireEl<HTMLElement>('res-size-fields');
const keepRatio = requireEl<HTMLInputElement>('res-keep-ratio');
const outW = requireEl<HTMLInputElement>('res-out-w');
const outH = requireEl<HTMLInputElement>('res-out-h');
const sizeHint = requireEl<HTMLElement>('res-size-hint');
const formatSelect = requireEl<HTMLSelectElement>('res-format');
const qualityWrap = requireEl<HTMLElement>('res-quality-wrap');
const quality = requireEl<HTMLInputElement>('res-quality');
const qualityValue = requireEl<HTMLElement>('res-quality-value');
const bgWrap = requireEl<HTMLElement>('res-bg-wrap');
const bgColor = requireEl<HTMLInputElement>('res-bg');
const runBtn = requireEl<HTMLButtonElement>('res-run');
const resetBtn = requireEl<HTMLButtonElement>('res-reset');
const clearBtn = requireEl<HTMLButtonElement>('res-clear');
const resultWrap = requireEl<HTMLElement>('res-result-wrap');
const resultImg = requireEl<HTMLImageElement>('res-result');
const resultMeta = requireEl<HTMLElement>('res-result-meta');
const downloadBtn = requireEl<HTMLButtonElement>('res-download');
const statusEl = requireEl<HTMLElement>('res-status');

let loaded: Loaded | null = null;
let crop: Rect = { x: 0, y: 0, width: 1, height: 1 };
let result: { url: string; name: string } | null = null;
let busy = false;

requirementsList.replaceChildren(
  ...requirementLines(MAX_PIXELS, ['JPG', 'PNG', 'WebP']).map((line) => {
    const li = document.createElement('li');
    li.textContent = line;
    return li;
  }),
);
const outputLine = document.createElement('li');
outputLine.textContent = 'Salida: JPG, PNG o WebP. Los archivos no se suben a ningún servidor.';
requirementsList.append(outputLine);

/* ---------- Utilidades ---------- */

/** Número entero de un campo, o null si está vacío o no es entero. */
function optInt(input: HTMLInputElement): number | null {
  if (input.value.trim() === '') return null;
  const n = Number(input.value);
  return Number.isInteger(n) ? n : null;
}

function fillCropInputs(rect: Rect): void {
  cropX.value = String(rect.x);
  cropY.value = String(rect.y);
  cropW.value = String(rect.width);
  cropH.value = String(rect.height);
}

function setCropMessage(message: string | null): void {
  cropMsg.textContent = message ?? '';
  cropMsg.hidden = message === null;
}

/** Recorte según los campos. Si es inválido, se informa y se conserva el último válido. */
function readCropInputs(): void {
  if (!loaded) return;
  const parsed: Rect = {
    x: cropX.value.trim() === '' ? Number.NaN : Number(cropX.value),
    y: cropY.value.trim() === '' ? Number.NaN : Number(cropY.value),
    width: cropW.value.trim() === '' ? Number.NaN : Number(cropW.value),
    height: cropH.value.trim() === '' ? Number.NaN : Number(cropH.value),
  };
  const r = clampCrop(loaded.info.width, loaded.info.height, parsed);
  if (r.ok) {
    crop = r.value;
    setCropMessage(null);
  } else {
    setCropMessage(r.message);
  }
  aspectSelect.value = 'libre';
  drawPreview();
  refreshOptions();
}

/* ---------- Vista previa ---------- */

function drawPreview(): void {
  if (!loaded) {
    previewCanvas.hidden = true;
    previewEmpty.hidden = false;
    return;
  }
  const { width: sw, height: sh } = loaded.info;
  const scale = Math.min(1, PREVIEW_MAX_W / sw, PREVIEW_MAX_H / sh);
  const cw = Math.max(1, Math.round(sw * scale));
  const ch = Math.max(1, Math.round(sh * scale));
  previewCanvas.width = cw;
  previewCanvas.height = ch;
  const ctx = previewCanvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, cw, ch);
  ctx.drawImage(loaded.bitmap, 0, 0, cw, ch);
  // Oscurece todo y vuelve a dibujar solo la zona del recorte.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(0, 0, cw, ch);
  const dx = crop.x * scale;
  const dy = crop.y * scale;
  const dw = crop.width * scale;
  const dh = crop.height * scale;
  ctx.drawImage(loaded.bitmap, crop.x, crop.y, crop.width, crop.height, dx, dy, dw, dh);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeRect(dx + 1, dy + 1, Math.max(1, dw - 2), Math.max(1, dh - 2));
  previewCanvas.hidden = false;
  previewEmpty.hidden = true;
}

/* ---------- Opciones ---------- */

function currentOutput(): Result<{ width: number; height: number }> {
  if (!loaded) return { ok: false, message: 'Cargá una imagen primero.' };
  const req: OutputRequest = resizeToggle.checked
    ? { width: optInt(outW), height: optInt(outH), keepRatio: keepRatio.checked }
    : { width: null, height: null, keepRatio: false };
  return outputSize(crop, req);
}

function refreshOptions(): void {
  const hasImage = loaded !== null;
  const format = formatSelect.value as OutputFormat;
  aspectSelect.disabled = !hasImage || busy;
  for (const input of [cropX, cropY, cropW, cropH]) input.disabled = !hasImage || busy;
  centerBtn.disabled = !hasImage || busy;
  resizeToggle.disabled = !hasImage || busy;
  sizeFields.hidden = !resizeToggle.checked;
  outW.disabled = !resizeToggle.checked || busy;
  outH.disabled = !resizeToggle.checked || busy;
  formatSelect.disabled = !hasImage || busy;
  qualityWrap.hidden = format === 'png';
  qualityValue.textContent = quality.value;
  bgWrap.hidden = format !== 'jpeg';
  resetBtn.disabled = !hasImage || busy;
  clearBtn.disabled = busy;

  const out = currentOutput();
  if (out.ok) {
    sizeHint.textContent = `Salida: ${out.value.width} × ${out.value.height} px`;
  } else {
    sizeHint.textContent = out.message;
  }
  runBtn.disabled = !hasImage || busy || !out.ok || !cropMsg.hidden;
}

function resetOptions(): void {
  if (!loaded) return;
  aspectSelect.value = 'libre';
  crop = { x: 0, y: 0, width: loaded.info.width, height: loaded.info.height };
  fillCropInputs(crop);
  setCropMessage(null);
  resizeToggle.checked = false;
  keepRatio.checked = true;
  outW.value = '';
  outH.value = '';
  formatSelect.value = 'png';
  quality.value = '90';
  bgColor.value = '#ffffff';
  drawPreview();
  refreshOptions();
}

/* ---------- Resultado ---------- */

function clearResult(): void {
  if (result) URL.revokeObjectURL(result.url);
  result = null;
  resultImg.removeAttribute('src');
  resultImg.hidden = true;
  resultWrap.hidden = true;
  resultMeta.textContent = '';
  downloadBtn.hidden = true;
}

function clearAll(): void {
  loaded?.bitmap.close();
  loaded = null;
  clearResult();
  crop = { x: 0, y: 0, width: 1, height: 1 };
  fillCropInputs(crop);
  cropX.value = '';
  cropY.value = '';
  cropW.value = '';
  cropH.value = '';
  setCropMessage(null);
  renderInfo(infoEl, null);
  infoEl.hidden = true;
  outW.value = '';
  outH.value = '';
  fileInput.value = '';
  clearError(errorEl);
  aspectSelect.value = 'libre';
  drawPreview();
  setStatus(statusEl, 'Elegí una imagen para empezar.');
  refreshOptions();
}

/* ---------- Carga ---------- */

async function loadFile(file: File): Promise<void> {
  clearError(errorEl);
  const r = await inspectImageFile(file, MAX_PIXELS);
  fileInput.value = '';
  if (!r.ok) {
    showError(errorEl, `${file.name}: ${r.message}`);
    return;
  }
  loaded?.bitmap.close();
  clearResult();
  loaded = { file, info: r.info, bitmap: r.bitmap };
  crop = { x: 0, y: 0, width: r.info.width, height: r.info.height };
  fillCropInputs(crop);
  setCropMessage(null);
  aspectSelect.value = 'libre';
  resizeToggle.checked = false;
  outW.value = '';
  outH.value = '';
  renderInfo(infoEl, r.info);
  infoEl.hidden = false;
  drawPreview();
  setStatus(statusEl, 'Recortá la zona deseada, elegí el tamaño y el formato, y procesá la imagen.');
  refreshOptions();
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void loadFile(file);
});
attachDropzone(dropzone, (files) => {
  const file = files[0];
  if (file) void loadFile(file);
});

/* ---------- Eventos ---------- */

aspectSelect.addEventListener('change', () => {
  if (!loaded) return;
  const preset = presetById(aspectSelect.value);
  crop = centeredCrop(loaded.info.width, loaded.info.height, preset?.ratio ?? null);
  fillCropInputs(crop);
  setCropMessage(null);
  drawPreview();
  refreshOptions();
});

for (const input of [cropX, cropY, cropW, cropH]) input.addEventListener('input', readCropInputs);

centerBtn.addEventListener('click', () => {
  if (!loaded) return;
  crop = centerRect(loaded.info.width, loaded.info.height, crop);
  fillCropInputs(crop);
  setCropMessage(null);
  drawPreview();
  refreshOptions();
});

// Con proporción fija, al escribir un lado se completa el otro.
outW.addEventListener('input', () => {
  const w = optInt(outW);
  if (keepRatio.checked && w !== null && w >= 1) outH.value = String(counterpart(crop, 'width', w));
  refreshOptions();
});
outH.addEventListener('input', () => {
  const h = optInt(outH);
  if (keepRatio.checked && h !== null && h >= 1) outW.value = String(counterpart(crop, 'height', h));
  refreshOptions();
});
keepRatio.addEventListener('change', () => {
  const w = optInt(outW);
  if (keepRatio.checked && w !== null && w >= 1) outH.value = String(counterpart(crop, 'width', w));
  refreshOptions();
});
resizeToggle.addEventListener('change', refreshOptions);
formatSelect.addEventListener('change', refreshOptions);
quality.addEventListener('input', refreshOptions);

resetBtn.addEventListener('click', () => {
  resetOptions();
  setStatus(statusEl, 'Opciones restablecidas.');
});
clearBtn.addEventListener('click', clearAll);

async function processImage(): Promise<void> {
  if (!loaded || busy) return;
  clearError(errorEl);
  const out = currentOutput();
  if (!out.ok) {
    showError(errorEl, out.message);
    return;
  }
  const format = formatSelect.value as OutputFormat;
  const { width, height } = out.value;
  busy = true;
  clearResult();
  refreshOptions();
  setStatus(statusEl, 'Procesando…');

  let canvas: HTMLCanvasElement | null = null;
  try {
    canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('El navegador no permite dibujar la imagen.');
    if (format === 'jpeg') {
      ctx.fillStyle = bgColor.value;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(loaded.bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, width, height);

    const q = format === 'png' ? undefined : Number(quality.value) / 100;
    const blob = await canvasToVerifiedBlob(canvas, format, q);
    const base = (loaded.info.name.replace(/\.[^.]+$/, '') || 'imagen').replace(/[^\w.-]+/g, '_');
    result = {
      url: URL.createObjectURL(blob),
      name: `${base}-recorte-${width}x${height}.${OUTPUT_EXTENSION[format]}`,
    };
    resultImg.src = result.url;
    resultImg.hidden = false;
    resultWrap.hidden = false;
    resultMeta.textContent = `${FORMAT_LABEL[format]} · ${width} × ${height} px · ${formatBytes(blob.size)}`;
    downloadBtn.hidden = false;
    setStatus(statusEl, 'Listo. Descargá el archivo o cambiá las opciones y volvé a procesar.');
  } catch (error) {
    showError(errorEl, error instanceof Error ? error.message : 'No se pudo procesar la imagen.');
    setStatus(statusEl, 'No se pudo procesar la imagen.');
  } finally {
    if (canvas) releaseCanvas(canvas);
    busy = false;
    refreshOptions();
  }
}

runBtn.addEventListener('click', () => void processImage());

downloadBtn.addEventListener('click', () => {
  if (result) triggerDownload(result.url, result.name);
});

/* ---------- Inicio ---------- */

// WebP solo se ofrece si el navegador lo codifica de verdad (se comprueba, no se asume).
void canEncode('webp').then((ok) => {
  if (ok) return;
  const option = formatSelect.querySelector<HTMLOptionElement>('option[value="webp"]');
  if (option) {
    option.disabled = true;
    option.textContent = 'WebP (no disponible en este navegador)';
  }
});

// Las proporciones de la lista del HTML deben coincidir con las de la lógica.
for (const option of Array.from(aspectSelect.options)) {
  if (!ASPECT_PRESETS.some((p) => p.id === option.value)) option.remove();
}

refreshOptions();
