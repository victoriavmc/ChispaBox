/*
 * Mejorar calidad de imagen con dos métodos independientes, sin IA:
 *  - Sharp: endpoint local /api/imagen/mejorar (libvips). Solo disponible con `npm run dev` o `npm run preview`.
 *  - Canvas: worker del navegador. No envía nada a ningún servidor.
 * Siempre se parte del archivo original: aplicar otra mejora no acumula filtros sobre un resultado.
 */
import '../styles/grabar-audio.css';
import '../styles/image-tools.css';

import { IMAGE_LIMITS, TOOL_LIMITS, formatBytes, formatMegapixels } from '../shared/image-limits';
import { outputMatches, type OutputFormat } from '../shared/image-format';
import { inspectImageFile, requirementLines, type ImageInfo } from '../lib/image-file';
import { PRESETS, INTENSITY_LABEL, outputSize, type Intensity, type Interpolation } from '../lib/enhance-core';
import type { EnhanceJob, EnhanceReply } from '../workers/enhance.worker';
import {
  attachDropzone,
  canEncode,
  clearError,
  renderInfo,
  requireEl,
  setStatus,
  showError,
  triggerDownload,
} from '../lib/ui-common';

type Method = 'sharp' | 'canvas';

interface Result {
  key: string;
  method: Method;
  intensity: Intensity;
  format: OutputFormat;
  width: number;
  height: number;
  sizeBytes: number;
  url: string;
}

const MAX_RESULTS = 6;
const MAX_INPUT_PIXELS = Math.max(TOOL_LIMITS.mejorarSharp.maxPixels, TOOL_LIMITS.mejorarCanvas.maxPixels);

const fileInput = requireEl<HTMLInputElement>('mej-file');
const dropzone = requireEl<HTMLElement>('mej-dropzone');
const requirementsList = requireEl<HTMLElement>('mej-requirements');
const infoEl = requireEl<HTMLElement>('mej-info');
const errorEl = requireEl<HTMLElement>('mej-error');
const statusEl = requireEl<HTMLElement>('mej-status');
const progressWrap = requireEl<HTMLElement>('mej-progress-wrap');
const progressText = requireEl<HTMLElement>('mej-progress-text');
const methodInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="mej-method"]'));
const sharpInput = requireEl<HTMLInputElement>('mej-method-sharp');
const sharpNote = requireEl<HTMLElement>('mej-sharp-note');
const methodLimits = requireEl<HTMLElement>('mej-method-limits');
const intensityInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="mej-intensity"]'));
const formatSelect = requireEl<HTMLSelectElement>('mej-format');
const qualityWrap = requireEl<HTMLElement>('mej-quality-wrap');
const quality = requireEl<HTMLInputElement>('mej-quality');
const qualityValue = requireEl<HTMLElement>('mej-quality-value');
const keepSize = requireEl<HTMLInputElement>('mej-keep-size');
const keepRatio = requireEl<HTMLInputElement>('mej-keep-ratio');
const sizeFields = requireEl<HTMLElement>('mej-size-fields');
const widthInput = requireEl<HTMLInputElement>('mej-width');
const heightInput = requireEl<HTMLInputElement>('mej-height');
const interpWrap = requireEl<HTMLElement>('mej-interp-wrap');
const interpSelect = requireEl<HTMLSelectElement>('mej-interp');
const sizeEl = requireEl<HTMLElement>('mej-size');
const splitLine = requireEl<HTMLElement>('mej-split');
const cancelBtn = requireEl<HTMLButtonElement>('mej-cancel');
const resetOptsBtn = requireEl<HTMLButtonElement>('mej-reset-opts');
const clearBtn = requireEl<HTMLButtonElement>('mej-clear');
const stageWrap = requireEl<HTMLElement>('mej-stage-wrap');
const originalImg = requireEl<HTMLImageElement>('mej-original');
const resultImg = requireEl<HTMLImageElement>('mej-result');
const compareRange = requireEl<HTMLInputElement>('mej-compare');
const stageEl = requireEl<HTMLElement>('mej-stage');
const zoomOutBtn = requireEl<HTMLButtonElement>('mej-zoom-out');
const zoomInBtn = requireEl<HTMLButtonElement>('mej-zoom-in');
const zoomResetBtn = requireEl<HTMLButtonElement>('mej-zoom-reset');
const zoomLabel = requireEl<HTMLElement>('mej-zoom-label');

// Zoom de la comparación: 50 %–400 %. Por debajo de 100 % la imagen se reduce; por encima, se desplaza.
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 0.25;
let zoom = 1;

function setZoom(value: number): void {
  zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100));
  stageEl.style.setProperty('--zoom', String(zoom));
  zoomLabel.textContent = `${Math.round(zoom * 100)} %`;
  zoomOutBtn.disabled = zoom <= ZOOM_MIN;
  zoomInBtn.disabled = zoom >= ZOOM_MAX;
}
const summaryEl = requireEl<HTMLElement>('mej-summary');
const resultsList = requireEl<HTMLUListElement>('mej-results');
const downloadBtn = requireEl<HTMLButtonElement>('mej-download');

let file: File | null = null;
let info: ImageInfo | null = null;
let originalUrl: string | null = null;
let results: Result[] = [];
let current: Result | null = null;
let sharpAvailable = false;
let worker: Worker | null = null;
let rejectCanvas: ((err: Error) => void) | null = null;
let abortSharp: AbortController | null = null;
let running = false;
let runTimer = 0;
let lastRunKey = '';
let loadToken = 0;
let cancelled = false;

requirementsList.replaceChildren(
  ...requirementLines(MAX_INPUT_PIXELS, ['JPG', 'PNG', 'WebP']).map((line) => {
    const li = document.createElement('li');
    li.textContent = line;
    return li;
  }),
);

/* ---------- Métodos y límites ---------- */

function method(): Method {
  return (methodInputs.find((i) => i.checked)?.value as Method | undefined) ?? 'canvas';
}

function intensity(): Intensity {
  return (intensityInputs.find((i) => i.checked)?.value as Intensity | undefined) ?? 'media';
}

function methodMaxPixels(m: Method): number {
  return m === 'sharp' ? TOOL_LIMITS.mejorarSharp.maxPixels : TOOL_LIMITS.mejorarCanvas.maxPixels;
}

function renderMethodLimits(): void {
  const m = method();
  const maxPixels = methodMaxPixels(m);
  const lines = [
    `Límite de píxeles: ${formatMegapixels(maxPixels)}.`,
    m === 'sharp'
      ? 'Se procesa en el servidor local de este equipo (libvips). Solo disponible con npm run dev o npm run preview.'
      : 'Se procesa en el navegador, en un worker. Usa más memoria que Sharp, por eso su límite es menor.',
  ];
  methodLimits.replaceChildren(
    ...lines.map((t) => {
      const li = document.createElement('li');
      li.textContent = t;
      return li;
    }),
  );
}

function currentKey(): string {
  const size = targetSize();
  const sizeKey = typeof size === 'string' ? 'invalido' : `${size.width}x${size.height}`;
  return [file ? `${file.name}:${file.size}` : '', method(), intensity(), formatSelect.value, quality.value, sizeKey, interpSelect.value].join('|');
}

// Procesa la vista previa en cuanto cambia la configuración (con una pausa para no trabar al deslizar).
function scheduleRun(): void {
  window.clearTimeout(runTimer);
  if (!file || !info || running) return;
  if (currentKey() === lastRunKey) return;
  sizeEl.textContent = 'Calculando el peso…';
  runTimer = window.setTimeout(() => void run(), 500);
}

function updateSize(): void {
  if (running) {
    sizeEl.textContent = 'Calculando el peso…';
    return;
  }
  if (!current) {
    sizeEl.textContent = '';
    return;
  }
  sizeEl.textContent = `Pesa aproximadamente ${formatBytes(current.sizeBytes)} (${current.format.toUpperCase()}, ${INTENSITY_LABEL[current.intensity]}).`;
}

function refreshControls(): void {
  const m = method();
  const format = formatSelect.value;
  qualityWrap.hidden = !(format === 'jpeg' || format === 'webp');
  qualityValue.textContent = quality.value;
  sizeFields.hidden = keepSize.checked;
  widthInput.disabled = keepSize.checked;
  heightInput.disabled = keepSize.checked;
  interpWrap.hidden = m !== 'canvas';
  renderMethodLimits();
  const hasFile = info !== null;
  cancelBtn.hidden = !running;
  resetOptsBtn.disabled = running;
  clearBtn.disabled = running;
  downloadBtn.disabled = current === null;
  stageWrap.hidden = !hasFile;
  renderSummary();
  renderResults();
  updateSize();
  scheduleRun();
}

function resetOptions(): void {
  methodInputs.forEach((i) => (i.checked = i.value === 'canvas'));
  intensityInputs.forEach((i) => (i.checked = i.value === 'media'));
  formatSelect.value = 'jpeg';
  quality.value = '92';
  keepSize.checked = true;
  keepRatio.checked = true;
  widthInput.value = '';
  heightInput.value = '';
  interpSelect.value = 'high';
  refreshControls();
}

async function checkSharp(): Promise<void> {
  try {
    const res = await fetch('/api/imagen/estado', { cache: 'no-store', credentials: 'omit' });
    if (!res.ok) throw new Error('no disponible');
    const body = (await res.json()) as { disponible?: boolean };
    sharpAvailable = body.disponible === true;
  } catch {
    sharpAvailable = false;
  }
  sharpInput.disabled = !sharpAvailable;
  if (!sharpAvailable) {
    sharpNote.textContent = 'Método Sharp no disponible en esta copia: necesita el servidor local (npm run dev o npm run preview). El método Canvas funciona igual.';
    const canvasInput = methodInputs.find((i) => i.value === 'canvas');
    if (canvasInput) canvasInput.checked = true;
  } else {
    sharpNote.textContent = '';
  }
  refreshControls();
}

/* ---------- Archivo ---------- */

function clearResults(): void {
  for (const r of results) URL.revokeObjectURL(r.url);
  results = [];
  current = null;
}

function clearAll(resetFile: boolean): void {
  loadToken++;
  clearResults();
  file = null;
  info = null;
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  originalUrl = null;
  originalImg.removeAttribute('src');
  resultImg.removeAttribute('src');
  renderInfo(infoEl, null);
  summaryEl.replaceChildren();
  if (resetFile) {
    fileInput.value = '';
    clearError(errorEl);
    setStatus(statusEl, 'Elegí una imagen para empezar.');
  }
  refreshControls();
}

async function onFile(selected: File): Promise<void> {
  const token = ++loadToken;
  clearResults();
  clearError(errorEl);
  setStatus(statusEl, '');
  progressWrap.hidden = false;
  progressText.textContent = 'Validando la imagen…';
  const result = await inspectImageFile(selected, MAX_INPUT_PIXELS);
  if (token !== loadToken) {
    if (result.ok) result.bitmap.close();
    return;
  }
  progressWrap.hidden = true;
  if (!result.ok) {
    showError(errorEl, result.message);
    fileInput.value = '';
    clearAll(false);
    return;
  }
  result.bitmap.close();
  file = selected;
  info = result.info;
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  originalUrl = URL.createObjectURL(selected);
  originalImg.src = originalUrl;
  renderInfo(infoEl, info);
  compareRange.value = '50';
  applyCompare();
  setStatus(statusEl, 'Imagen lista. Elegí un método y una intensidad. El original no se modifica.');
  refreshControls();
}

/* ---------- Tamaño de salida ---------- */

function targetSize(): { width: number; height: number } | string {
  if (!info) return 'Falta la imagen.';
  if (keepSize.checked) return { width: info.width, height: info.height };
  const w = Number.parseInt(widthInput.value, 10);
  const h = Number.parseInt(heightInput.value, 10);
  const hasW = widthInput.value.trim() !== '' && Number.isFinite(w);
  const hasH = heightInput.value.trim() !== '' && Number.isFinite(h);
  if (!hasW && !hasH) return 'Indicá el ancho o el alto de salida, o mantené las dimensiones originales.';
  if (!keepRatio.checked && (!hasW || !hasH)) return 'Sin conservar proporciones, indicá ancho y alto.';
  const size = keepRatio.checked
    ? outputSize(info.width, info.height, hasW ? w : null, hasW ? null : h)
    : { width: w, height: h };
  if (size.width < 1 || size.height < 1) return 'Las dimensiones deben ser de al menos 1 píxel.';
  if (size.width > IMAGE_LIMITS.maxSide || size.height > IMAGE_LIMITS.maxSide) {
    return `La salida ${size.width} × ${size.height} px supera el lado máximo de ${IMAGE_LIMITS.maxSide} px.`;
  }
  return size;
}

/* ---------- Procesamiento ---------- */

function setRunning(value: boolean): void {
  running = value;
  progressWrap.hidden = !value;
  refreshControls();
}

/** Un worker nuevo por trabajo: al terminar, cancelar o vencer el tiempo, no queda estado residual. */
function runCanvas(input: File, job: Omit<EnhanceJob, 'id' | 'bitmap'>): Promise<Blob> {
  return new Promise<Blob>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (err: Error | null, blob?: Blob): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      worker?.terminate();
      worker = null;
      rejectCanvas = null;
      if (err) reject(err);
      else if (blob) resolve(blob);
    };
    rejectCanvas = (err) => finish(err);
    createImageBitmap(input)
      .then((bitmap) => {
        if (settled) {
          bitmap.close();
          return;
        }
        const w = new Worker(new URL('../workers/enhance.worker.ts', import.meta.url), { type: 'module' });
        worker = w;
        timer = setTimeout(() => finish(new Error(`Se superó el tiempo máximo de ${IMAGE_LIMITS.maxProcessingMs / 1000} s.`)), IMAGE_LIMITS.maxProcessingMs);
        w.onmessage = (e: MessageEvent<EnhanceReply>) => {
          if (e.data.ok) finish(null, e.data.blob);
          else finish(new Error(e.data.message));
        };
        w.onerror = () => finish(new Error('El procesamiento falló en el navegador.'));
        const message: EnhanceJob = { ...job, id: 1, bitmap };
        w.postMessage(message, [bitmap]);
      })
      .catch(() => finish(new Error('No se pudo decodificar la imagen.')));
  });
}

async function runSharp(input: File, fmt: OutputFormat, size: { width: number; height: number } | null): Promise<Blob> {
  const params = new URLSearchParams({ intensidad: intensity(), formato: fmt, calidad: quality.value });
  if (size && info && (size.width !== info.width || size.height !== info.height)) {
    params.set('ancho', String(size.width));
    params.set('alto', String(size.height));
  }
  const controller = new AbortController();
  abortSharp = controller;
  const timer = setTimeout(() => controller.abort(), IMAGE_LIMITS.maxProcessingMs);
  try {
    const res = await fetch(`/api/imagen/mejorar?${params.toString()}`, {
      method: 'POST',
      body: input,
      headers: { 'Content-Type': input.type || 'application/octet-stream' },
      cache: 'no-store',
      credentials: 'omit',
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({ error: 'Error del servidor local.' }))) as { error?: string };
      throw new Error(body.error ?? 'Error del servidor local.');
    }
    return await res.blob();
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(cancelled ? 'Procesamiento cancelado.' : `Se superó el tiempo máximo de ${IMAGE_LIMITS.maxProcessingMs / 1000} s.`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    abortSharp = null;
  }
}

async function run(): Promise<void> {
  if (!file || !info || running) return;
  lastRunKey = currentKey();
  clearError(errorEl);
  cancelled = false;
  const m = method();
  const fmt = formatSelect.value as OutputFormat;
  const maxPixels = methodMaxPixels(m);

  if (info.pixels > maxPixels) {
    showError(errorEl, `Con el método ${m === 'sharp' ? 'Sharp' : 'Canvas'} el límite es ${formatMegapixels(maxPixels)}. Esta imagen tiene ${formatMegapixels(info.pixels)}. Probá el otro método o una imagen más chica.`);
    return;
  }
  const sizeOrError = targetSize();
  if (typeof sizeOrError === 'string') {
    showError(errorEl, sizeOrError);
    return;
  }
  if (sizeOrError.width * sizeOrError.height > maxPixels) {
    showError(errorEl, `La salida ${sizeOrError.width} × ${sizeOrError.height} px supera el límite de ${formatMegapixels(maxPixels)} del método ${m === 'sharp' ? 'Sharp' : 'Canvas'}.`);
    return;
  }
  if (m === 'sharp' && !sharpAvailable) {
    showError(errorEl, 'El método Sharp no está disponible en esta copia.');
    return;
  }
  if (fmt === 'webp' && !(await canEncode('webp'))) {
    showError(errorEl, 'Este navegador no puede generar WebP. Elegí JPG o PNG.');
    return;
  }

  setRunning(true);
  progressText.textContent = m === 'sharp' ? 'Mejorando con Sharp en el servidor local…' : 'Mejorando con Canvas en el navegador…';
  setStatus(statusEl, '');
  const key = `${m}|${intensity()}|${fmt}|${sizeOrError.width}x${sizeOrError.height}|${fmt === 'png' ? '-' : quality.value}`;
  try {
    const params = PRESETS[intensity()];
    const blob =
      m === 'sharp'
        ? await runSharp(file, fmt, sizeOrError)
        : await runCanvas(file, {
            width: sizeOrError.width,
            height: sizeOrError.height,
            params,
            interpolation: interpSelect.value as Interpolation,
            format: fmt,
            quality: Number(quality.value) / 100,
          });
    const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    if (!outputMatches(head, fmt)) throw new Error(`El resultado no es ${fmt.toUpperCase()}; no se ofrece para descargar.`);
    const url = URL.createObjectURL(blob);
    const previous = results.find((r) => r.key === key);
    if (previous) {
      URL.revokeObjectURL(previous.url);
      results = results.filter((r) => r !== previous);
    }
    const item: Result = {
      key,
      method: m,
      intensity: intensity(),
      format: fmt,
      width: sizeOrError.width,
      height: sizeOrError.height,
      sizeBytes: blob.size,
      url,
    };
    results.push(item);
    while (results.length > MAX_RESULTS) {
      const old = results.shift();
      if (old) URL.revokeObjectURL(old.url);
    }
    selectResult(item);
    setStatus(statusEl, `Listo: ${INTENSITY_LABEL[item.intensity]} con ${m === 'sharp' ? 'Sharp' : 'Canvas'}, ${formatBytes(item.sizeBytes)}.`);
  } catch (err) {
    console.error(err);
    showError(errorEl, err instanceof Error && err.message ? err.message : 'No se pudo mejorar la imagen.');
  } finally {
    setRunning(false);
  }
}

function cancel(): void {
  if (!running) return;
  cancelled = true;
  rejectCanvas?.(new Error('Procesamiento cancelado.'));
  abortSharp?.abort();
  setStatus(statusEl, 'Procesamiento cancelado.');
}

/* ---------- Resultados y comparación ---------- */

function selectResult(r: Result): void {
  current = r;
  resultImg.src = r.url;
  resultImg.hidden = false;
  renderSummary();
  renderResults();
  applyCompare();
}

function renderSummary(): void {
  summaryEl.replaceChildren();
  if (!info) return;
  const rows: Array<[string, string]> = [
    ['Método', method() === 'sharp' ? 'Sharp (servidor local)' : 'Canvas (navegador)'],
    ['Intensidad', INTENSITY_LABEL[intensity()]],
    ['Dimensiones originales', `${info.width} × ${info.height} px`],
    ['Peso original', formatBytes(info.sizeBytes)],
  ];
  if (current) {
    rows.push(
      ['Formato de salida', current.format.toUpperCase()],
      ['Dimensiones resultado', `${current.width} × ${current.height} px`],
      ['Peso resultante', formatBytes(current.sizeBytes)],
      ['Método del resultado', current.method === 'sharp' ? 'Sharp' : 'Canvas'],
      ['Intensidad del resultado', INTENSITY_LABEL[current.intensity]],
    );
  }
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    summaryEl.append(dt, dd);
  }
  summaryEl.hidden = false;
}

function renderResults(): void {
  resultsList.replaceChildren();
  for (const r of results) {
    const li = document.createElement('li');
    li.className = 'conv-item';
    const text = document.createElement('span');
    text.textContent = `${r.method === 'sharp' ? 'Sharp' : 'Canvas'} · ${INTENSITY_LABEL[r.intensity]} · ${r.format.toUpperCase()} · ${formatBytes(r.sizeBytes)} · ${r.width} × ${r.height} px`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = r === current ? 'btn btn--primary' : 'btn btn--ghost';
    btn.textContent = r === current ? 'Viendo' : 'Ver';
    btn.addEventListener('click', () => selectResult(r));
    li.append(text, btn);
    resultsList.append(li);
  }
  resultsList.hidden = results.length === 0;
}

function applyCompare(): void {
  if (!current) {
    // Sin resultado todavía: se muestra el original completo.
    resultImg.hidden = true;
    originalImg.style.clipPath = 'none';
    splitLine.hidden = true;
    return;
  }
  const pos = Number(compareRange.value);
  // Izquierda: resultado; derecha: original.
  resultImg.hidden = false;
  resultImg.style.clipPath = `inset(0 ${100 - pos}% 0 0)`;
  originalImg.style.clipPath = `inset(0 0 0 ${pos}%)`;
  splitLine.hidden = false;
  splitLine.style.left = `${pos}%`;
}

function download(): void {
  if (!current || !info) return;
  const base = info.name.replace(/\.[^.]+$/, '') || 'imagen';
  const ext = current.format === 'jpeg' ? 'jpg' : current.format;
  triggerDownload(current.url, `${base}-mejorada-${current.intensity}.${ext}`);
  setStatus(statusEl, `Descarga: ${ext.toUpperCase()}, ${formatBytes(current.sizeBytes)}.`);
}

/* ---------- Eventos ---------- */

fileInput.addEventListener('change', () => {
  const f = fileInput.files?.[0];
  if (f) void onFile(f);
});
attachDropzone(dropzone, (files) => {
  const f = files[0];
  if (f) void onFile(f);
});
methodInputs.forEach((i) => i.addEventListener('change', refreshControls));
intensityInputs.forEach((i) => i.addEventListener('change', refreshControls));
formatSelect.addEventListener('change', refreshControls);
quality.addEventListener('input', refreshControls);
keepSize.addEventListener('change', refreshControls);
keepRatio.addEventListener('change', refreshControls);
widthInput.addEventListener('input', refreshControls);
heightInput.addEventListener('input', refreshControls);
interpSelect.addEventListener('change', refreshControls);
cancelBtn.addEventListener('click', cancel);
resetOptsBtn.addEventListener('click', resetOptions);
clearBtn.addEventListener('click', () => clearAll(true));
compareRange.addEventListener('input', applyCompare);
zoomOutBtn.addEventListener('click', () => setZoom(zoom - ZOOM_STEP));
zoomInBtn.addEventListener('click', () => setZoom(zoom + ZOOM_STEP));
zoomResetBtn.addEventListener('click', () => setZoom(1));
setZoom(1);
downloadBtn.addEventListener('click', download);

window.addEventListener('pagehide', () => {
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  clearResults();
  worker?.terminate();
  abortSharp?.abort();
});

void checkSharp();
resetOptions();
setStatus(statusEl, 'Elegí una imagen para empezar.');
