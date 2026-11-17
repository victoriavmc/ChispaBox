/*
 * Quitar fondo de imagen con algoritmos clásicos (sin IA, sin modelos, sin red).
 * Métodos: 1) fondo uniforme, 2) cuentagotas, 3) región conectada, 4) pincel.
 * La imagen original nunca se modifica: se trabaja sobre una copia en memoria.
 */
import '../styles/grabar-audio.css';
import '../styles/image-tools.css';
import '../styles/quitar-fondo.css';

import { TOOL_LIMITS, formatBytes } from '../shared/image-limits';
import { inspectImageFile, requirementLines, type ImageInfo } from '../lib/image-file';
import { CutoutSession } from '../lib/cutout';
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
} from '../lib/ui-common';

type Method = 'uniform' | 'picker' | 'region' | 'brush';

const MAX_PIXELS = TOOL_LIMITS.quitarFondo.maxPixels;

const fileInput = requireEl<HTMLInputElement>('bg-file');
const dropzone = requireEl<HTMLElement>('bg-dropzone');
const requirementsList = requireEl<HTMLElement>('bg-requirements');
const infoList = requireEl<HTMLElement>('bg-info');
const statusEl = requireEl<HTMLElement>('bg-status');
const errorEl = requireEl<HTMLElement>('bg-error');
const progressWrap = requireEl<HTMLElement>('bg-progress-wrap');
const progressText = requireEl<HTMLElement>('bg-progress-text');
const stage = requireEl<HTMLElement>('bg-stage');
const originalImg = requireEl<HTMLImageElement>('bg-original');
const resultCanvas = requireEl<HTMLCanvasElement>('bg-canvas');
const compareRange = requireEl<HTMLInputElement>('bg-compare');
const splitLine = requireEl<HTMLElement>('bg-split');
const methodInputs = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="bg-method"]'));
const uniformColor = requireEl<HTMLSelectElement>('bg-uniform-color');
const uniformHint = requireEl<HTMLElement>('bg-uniform-hint');
const pickedSwatch = requireEl<HTMLElement>('bg-picked');
const tolerance = requireEl<HTMLInputElement>('bg-tolerance');
const toleranceValue = requireEl<HTMLElement>('bg-tolerance-value');
const brushSize = requireEl<HTMLInputElement>('bg-brush-size');
const brushSizeValue = requireEl<HTMLElement>('bg-brush-size-value');
const brushMode = requireEl<HTMLSelectElement>('bg-brush-mode');
const methodPanels = Array.from(document.querySelectorAll<HTMLElement>('[data-bg-panel]'));
const toleranceWrap = requireEl<HTMLElement>('bg-tolerance-wrap');
const restoreBtn = requireEl<HTMLButtonElement>('bg-restore');
const resetBtn = requireEl<HTMLButtonElement>('bg-reset');
const zoomOut = requireEl<HTMLButtonElement>('bg-zoom-out');
const zoomIn = requireEl<HTMLButtonElement>('bg-zoom-in');
const zoomReset = requireEl<HTMLButtonElement>('bg-zoom-reset');
const zoomLabel = requireEl<HTMLElement>('bg-zoom-label');
const formatSelect = requireEl<HTMLSelectElement>('bg-format');
const jpegBgWrap = requireEl<HTMLElement>('bg-jpeg-bg-wrap');
const jpegBg = requireEl<HTMLInputElement>('bg-jpeg-bg');
const sizeEl = requireEl<HTMLElement>('bg-size');
const downloadBtn = requireEl<HTMLButtonElement>('bg-download');
const stageWrap = requireEl<HTMLElement>('bg-stage-wrap');

let session: CutoutSession | null = null;
let info: ImageInfo | null = null;
let originalUrl: string | null = null;
let picked: [number, number, number] | null = null;

/** Selección pendiente: se muestra en la vista previa (cuadrados) y se aplica con el botón. */
type Pending =
  | { kind: 'color'; target: [number, number, number]; mask: Uint8Array }
  | { kind: 'region'; point: [number, number]; mask: Uint8Array };
let pending: Pending | null = null;

const PREVIEW_CELL = 10;
const PREVIEW_DARK: [number, number, number] = [36, 36, 36];
const PREVIEW_LIGHT: [number, number, number] = [170, 170, 170];
let zoom = 1;
let loadToken = 0;
let brushing = false;
let lastPoint: [number, number] | null = null;

requirementsList.replaceChildren(
  ...requirementLines(MAX_PIXELS, ['JPG', 'PNG', 'WebP']).map((line) => {
    const li = document.createElement('li');
    li.textContent = line;
    return li;
  }),
);

/* ---------- Estado de la interfaz ---------- */

function currentMethod(): Method {
  const checked = methodInputs.find((input) => input.checked);
  return (checked?.value as Method | undefined) ?? 'uniform';
}

function refreshControls(): void {
  const has = session !== null;
  const method = currentMethod();
  for (const panel of methodPanels) panel.hidden = panel.dataset.bgPanel !== method;
  toleranceWrap.hidden = method === 'brush';
  toleranceValue.textContent = `${tolerance.value}`;
  brushSizeValue.textContent = `${brushSize.value} px`;
  restoreBtn.disabled = !has;
  resetBtn.disabled = false;
  downloadBtn.disabled = !has;
  stageWrap.hidden = !has;
  zoomLabel.textContent = `${Math.round(zoom * 100)} %`;
  jpegBgWrap.hidden = !needsSolidColor();
  scheduleEstimate();
  zoomOut.disabled = !has || zoom <= 0.5;
  zoomIn.disabled = !has || zoom >= 4;
  zoomReset.disabled = !has;
}

/** Imagen de vista previa: lo que se va a quitar aparece en cuadrados oscuros y grises. No modifica la sesión. */
function previewImage(mask: Uint8Array): ImageData {
  const cutout = session as CutoutSession;
  const { width, height, data } = cutout;
  const out = new Uint8ClampedArray(data);
  for (let p = 0; p < mask.length; p++) {
    if (mask[p] === 0) continue;
    const x = p % width;
    const y = (p - x) / width;
    const dark = (Math.floor(x / PREVIEW_CELL) + Math.floor(y / PREVIEW_CELL)) % 2 === 0;
    const c = dark ? PREVIEW_DARK : PREVIEW_LIGHT;
    const i = p * 4;
    out[i] = c[0];
    out[i + 1] = c[1];
    out[i + 2] = c[2];
    out[i + 3] = 255;
  }
  return new ImageData(out, width, height);
}

function renderFrame(dirty?: { x: number; y: number; w: number; h: number }): void {
  if (!session) return;
  const ctx = resultCanvas.getContext('2d');
  if (!ctx) return;
  const image = pending
    ? previewImage(pending.mask)
    : new ImageData(session.data, session.width, session.height);
  if (dirty) {
    ctx.putImageData(image, 0, 0, dirty.x, dirty.y, dirty.w, dirty.h);
  } else {
    ctx.putImageData(image, 0, 0);
  }
}

function setZoom(value: number): void {
  zoom = Math.min(4, Math.max(0.5, value));
  stage.style.setProperty('--zoom', String(zoom));
  refreshControls();
}

function resetAll(): void {
  loadToken++;
  session = null;
  info = null;
  picked = null;
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  originalUrl = null;
  originalImg.removeAttribute('src');
  releaseCanvas(resultCanvas);
  fileInput.value = '';
  renderInfo(infoList, null);
  clearError(errorEl);
  pickedSwatch.style.background = 'transparent';
  setZoom(1);
  progressWrap.hidden = true;
  setStatus(statusEl, 'Elegí una imagen para empezar.');
  refreshControls();
}

/* ---------- Carga ---------- */

async function loadFile(file: File): Promise<void> {
  const token = ++loadToken;
  clearError(errorEl);
  session = null;
  refreshControls();
  progressWrap.hidden = false;
  progressText.textContent = 'Validando la imagen…';
  setStatus(statusEl, '');

  const result = await inspectImageFile(file, MAX_PIXELS);
  if (token !== loadToken) {
    if (result.ok) result.bitmap.close();
    return;
  }
  progressWrap.hidden = true;
  if (!result.ok) {
    showError(errorEl, result.message);
    renderInfo(infoList, null);
    fileInput.value = '';
    return;
  }

  try {
    const { bitmap } = result;
    resultCanvas.width = bitmap.width;
    resultCanvas.height = bitmap.height;
    const ctx = resultCanvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('canvas');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const data = ctx.getImageData(0, 0, resultCanvas.width, resultCanvas.height);
    session = new CutoutSession(data);
    pending = null;
    compareRange.value = '50';
    applyCompare();
    renderFrame();
    computePending();
  } catch (err) {
    console.error(err);
    showError(errorEl, err instanceof RangeError ? 'No hay memoria suficiente para esta imagen. Probá con una más chica.' : 'No se pudo preparar la imagen.');
    session = null;
    refreshControls();
    return;
  }

  info = result.info;
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  originalUrl = URL.createObjectURL(file);
  originalImg.src = originalUrl;
  renderInfo(infoList, info);
  picked = null;
  pickedSwatch.style.background = 'transparent';
  setZoom(1);
  setStatus(statusEl, 'Imagen lista. Elegí un método y aplicalo. La imagen original no se modifica.');
  refreshControls();
}

function onFileChosen(files: FileList | File[] | null | undefined): void {
  const file = files?.[0];
  if (!file) return;
  void loadFile(file);
}

/* ---------- Operaciones ---------- */

function report(count: number): void {
  if (!session) return;
  const total = session.width * session.height;
  const pct = total > 0 ? ((count / total) * 100).toFixed(1) : '0';
  setStatus(statusEl, count > 0 ? `Se quitaron ${count.toLocaleString('es-AR')} píxeles (${pct} %).` : 'No hubo píxeles para quitar con esta configuración.');
}

/** Recalcula la vista previa según el método, el color y la tolerancia actuales. */
function computePending(): void {
  if (!session) {
    pending = null;
    return;
  }
  const method = currentMethod();
  const tol = Number(tolerance.value);
  if (method === 'uniform') {
    const target = uniformTarget();
    pending = target ? { kind: 'color', target, mask: session.candidateColor(target, tol) } : null;
  } else if (method === 'picker') {
    pending = picked ? { kind: 'color', target: picked, mask: session.candidateColor(picked, tol) } : null;
  } else if (method === 'region') {
    pending = pending?.kind === 'region'
      ? { kind: 'region', point: pending.point, mask: session.candidateRegion(pending.point[0], pending.point[1], tol) }
      : null;
  } else {
    pending = null;
  }
  renderFrame();
  refreshControls();
  if (pending) {
    const count = pending.mask.reduce((n, v) => n + v, 0);
    setStatus(
      statusEl,
      count > 0
        ? `Se quitarían ${count.toLocaleString('es-AR')} píxeles (en cuadrados). Revisá la vista previa y tocá el botón para quitarlos.`
        : 'No hay píxeles que coincidan con esa selección. Probá con más tolerancia.',
    );
  }
}

function uniformTarget(): [number, number, number] | null {
  if (!session) return null;
  switch (uniformColor.value) {
    case 'white':
      return [255, 255, 255];
    case 'black':
      return [0, 0, 0];
    case 'green':
      return [0, 177, 64];
    default:
      return session.cornerColor();
  }
}

function hex(rgb: readonly [number, number, number]): string {
  return `#${rgb.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// Aplica la selección pendiente (se llama al descargar, así no hace falta un botón aparte).
function commitPending(): void {
  if (!session || !pending) return;
  const tol = Number(tolerance.value);
  let count = 0;
  if (pending.kind === 'color') {
    count = session.removeColor(pending.target, tol);
    if (currentMethod() === 'uniform') {
      uniformHint.textContent = uniformColor.value === 'auto' ? `Color detectado en las esquinas: ${hex(pending.target)}.` : '';
    }
  } else {
    count = session.removeRegion(pending.point[0], pending.point[1], tol);
  }
  pending = null;
  renderFrame();
  report(count);
  refreshControls();
}

/** Convierte un punto de la pantalla a coordenadas de la imagen. */
function toImagePoint(clientX: number, clientY: number): [number, number] | null {
  if (!session) return null;
  const rect = resultCanvas.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const x = Math.floor(((clientX - rect.left) / rect.width) * session.width);
  const y = Math.floor(((clientY - rect.top) / rect.height) * session.height);
  if (x < 0 || y < 0 || x >= session.width || y >= session.height) return null;
  return [x, y];
}

function imageRadius(): number {
  if (!session || !resultCanvas.getBoundingClientRect().width) return Number(brushSize.value) / 2;
  const scale = session.width / resultCanvas.getBoundingClientRect().width;
  return (Number(brushSize.value) / 2) * scale;
}

function onCanvasPointerDown(e: PointerEvent): void {
  if (!session) return;
  const point = toImagePoint(e.clientX, e.clientY);
  if (!point) return;
  const method = currentMethod();

  if (method === 'picker') {
    picked = session.colorAt(point[0], point[1]);
    pickedSwatch.style.background = hex(picked);
    computePending();
    return;
  }
  if (method === 'region') {
    // Primero se muestra la zona; se quita sólo al tocar el botón.
    const mask = session.candidateRegion(point[0], point[1], Number(tolerance.value));
    pending = { kind: 'region', point, mask };
    renderFrame();
    refreshControls();
    const count = mask.reduce((n, v) => n + v, 0);
    setStatus(
      statusEl,
      count > 0
        ? `Zona marcada: ${count.toLocaleString('es-AR')} píxeles en cuadrados. Tocá «Quitar esta zona» para quitarla.`
        : 'Ahí no hay una zona para quitar.',
    );
    return;
  }
  if (method === 'brush') {
    brushing = true;
    lastPoint = point;
    resultCanvas.setPointerCapture(e.pointerId);
    // Un trazo completo (de presionar a soltar) es un solo paso de deshacer.
    session.beginStroke();
    const radius = imageRadius();
    const changed = session.brushSegment(point, point, radius, brushMode.value === 'restore' ? 'restore' : 'erase');
    renderFrame(dirtyRect(point, point, radius));
    setStatus(statusEl, changed > 0 ? 'Pincel aplicado.' : '');
  }
}

function onCanvasPointerMove(e: PointerEvent): void {
  if (!session || !brushing || !lastPoint) return;
  const point = toImagePoint(e.clientX, e.clientY);
  if (!point) return;
  const radius = imageRadius();
  const from = lastPoint;
  session.brushSegment(from, point, radius, brushMode.value === 'restore' ? 'restore' : 'erase');
  renderFrame(dirtyRect(from, point, radius));
  lastPoint = point;
  refreshControls();
}

function onCanvasPointerUp(): void {
  if (brushing) session?.endStroke();
  brushing = false;
  lastPoint = null;
  refreshControls();
}

function dirtyRect(a: readonly [number, number], b: readonly [number, number], radius: number): { x: number; y: number; w: number; h: number } | undefined {
  if (!session) return undefined;
  const pad = Math.ceil(radius) + 2;
  const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0]) - pad));
  const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1]) - pad));
  const x1 = Math.min(session.width, Math.ceil(Math.max(a[0], b[0]) + pad));
  const y1 = Math.min(session.height, Math.ceil(Math.max(a[1], b[1]) + pad));
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

function onRestore(): void {
  if (!session) return;
  pending = null;
  const count = session.resetMask();
  renderFrame();
  setStatus(statusEl, count > 0 ? 'Se restauró todo el fondo original (podés deshacerlo).' : 'La imagen ya estaba completa.');
  refreshControls();
}

/* ---------- Exportación ---------- */

// Opciones de exportación: con y sin transparencia para PNG y WebP; JPG siempre sin transparencia.
type ExportChoice = { format: 'png' | 'webp' | 'jpeg'; solid: boolean; label: string };
const EXPORT_CHOICES: Record<string, ExportChoice> = {
  png: { format: 'png', solid: false, label: 'PNG con transparencia' },
  'png-solid': { format: 'png', solid: true, label: 'PNG sin transparencia' },
  webp: { format: 'webp', solid: false, label: 'WebP con transparencia' },
  'webp-solid': { format: 'webp', solid: true, label: 'WebP sin transparencia' },
  jpeg: { format: 'jpeg', solid: true, label: 'JPG sin transparencia' },
};

function currentChoice(): ExportChoice {
  return EXPORT_CHOICES[formatSelect.value] ?? EXPORT_CHOICES.png;
}

function needsSolidColor(): boolean {
  return currentChoice().solid;
}

// Construye el archivo a partir de la sesión (no de la vista previa, que muestra cuadrados).
async function buildExport(): Promise<{ blob: Blob; ext: string; choice: ExportChoice }> {
  if (!session) throw new Error('no session');
  const choice = currentChoice();
  const { width, height } = session;

  const source = document.createElement('canvas');
  source.width = width;
  source.height = height;
  const out = document.createElement('canvas');
  out.width = width;
  out.height = height;
  try {
    const srcCtx = source.getContext('2d');
    const ctx = out.getContext('2d');
    if (!srcCtx || !ctx) throw new Error('canvas');
    srcCtx.putImageData(new ImageData(session.data, width, height), 0, 0);
    if (choice.solid) {
      // Sin transparencia: las zonas quitadas se rellenan con el color elegido.
      ctx.fillStyle = jpegBg.value;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(source, 0, 0);
    const blob = await canvasToVerifiedBlob(out, choice.format, choice.format === 'png' ? undefined : 0.92);
    const ext = choice.format === 'jpeg' ? 'jpg' : choice.format;
    return { blob, ext, choice };
  } finally {
    releaseCanvas(source);
    releaseCanvas(out);
  }
}

let estimateTimer = 0;
let estimateToken = 0;

// Muestra el peso antes de descargar. Se recalcula con una pausa para no trabar mientras se edita.
function scheduleEstimate(): void {
  window.clearTimeout(estimateTimer);
  if (!session) {
    sizeEl.textContent = '';
    return;
  }
  sizeEl.textContent = 'Calculando el peso…';
  estimateTimer = window.setTimeout(() => void updateEstimate(), 450);
}

async function updateEstimate(): Promise<void> {
  if (!session) return;
  const token = ++estimateToken;
  try {
    const { blob, choice } = await buildExport();
    if (token !== estimateToken) return;
    sizeEl.textContent = `Pesa aproximadamente ${formatBytes(blob.size)} (${choice.label}).`;
  } catch {
    if (token === estimateToken) sizeEl.textContent = 'No pudimos calcular el peso de este formato.';
  }
}

async function onDownload(): Promise<void> {
  if (!session || !info) return;
  if (pending) commitPending();
  try {
    const { blob, ext, choice } = await buildExport();
    const base = info.name.replace(/\.[^.]+$/, '') || 'imagen';
    const url = URL.createObjectURL(blob);
    triggerDownload(url, `${base}-sin-fondo.${ext}`);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    setStatus(statusEl, `Archivo generado: ${choice.label}, ${formatBytes(blob.size)}. Revisá la descarga.`);
  } catch (err) {
    console.error(err);
    showError(errorEl, err instanceof Error && err.message.includes('no pudo generar') ? err.message : 'No se pudo generar el archivo. Probá de nuevo.');
  }
}

async function configureFormats(): Promise<void> {
  const webpOk = await canEncode('webp');
  for (const value of ['webp', 'webp-solid']) {
    const option = formatSelect.querySelector<HTMLOptionElement>(`option[value="${value}"]`);
    if (!option) continue;
    option.disabled = !webpOk;
    if (!webpOk) option.textContent = `${EXPORT_CHOICES[value]?.label ?? 'WebP'} (no disponible en este navegador)`;
  }
  scheduleEstimate();
}

/* ---------- Comparación antes/después ---------- */

function applyCompare(): void {
  const pos = Number(compareRange.value);
  // Izquierda: resultado (con transparencia). Derecha: original.
  originalImg.style.clipPath = `inset(0 0 0 ${pos}%)`;
  resultCanvas.style.clipPath = `inset(0 ${100 - pos}% 0 0)`;
  splitLine.style.left = `${pos}%`;
}

/* ---------- Eventos ---------- */

fileInput.addEventListener('change', () => onFileChosen(fileInput.files));
attachDropzone(dropzone, (files) => onFileChosen(files));
methodInputs.forEach((input) => input.addEventListener('change', () => { pending = null; computePending(); }));
uniformColor.addEventListener('change', computePending);
tolerance.addEventListener('input', computePending);
brushSize.addEventListener('input', refreshControls);
brushMode.addEventListener('change', refreshControls);
formatSelect.addEventListener('change', refreshControls);
jpegBg.addEventListener('input', scheduleEstimate);
restoreBtn.addEventListener('click', onRestore);
resetBtn.addEventListener('click', resetAll);
downloadBtn.addEventListener('click', () => void onDownload());
zoomOut.addEventListener('click', () => setZoom(zoom - 0.25));
zoomIn.addEventListener('click', () => setZoom(zoom + 0.25));
zoomReset.addEventListener('click', () => setZoom(1));
compareRange.addEventListener('input', applyCompare);
resultCanvas.addEventListener('pointerdown', onCanvasPointerDown);
resultCanvas.addEventListener('pointermove', onCanvasPointerMove);
resultCanvas.addEventListener('pointerup', onCanvasPointerUp);
resultCanvas.addEventListener('pointercancel', onCanvasPointerUp);
resultCanvas.addEventListener('pointerleave', () => {
  if (brushing) onCanvasPointerUp();
});
// Cuentagotas también desde la imagen original.
originalImg.addEventListener('click', (e) => {
  if (currentMethod() !== 'picker' || !session) return;
  const rect = originalImg.getBoundingClientRect();
  const x = Math.floor(((e.clientX - rect.left) / rect.width) * session.width);
  const y = Math.floor(((e.clientY - rect.top) / rect.height) * session.height);
  if (x < 0 || y < 0 || x >= session.width || y >= session.height) return;
  picked = session.colorAt(x, y);
  pickedSwatch.style.background = hex(picked);
  setStatus(statusEl, `Color elegido: ${hex(picked)}. Tocá «Quitar el color elegido».`);
  refreshControls();
});

// Limpieza al cerrar la pestaña: se liberan la copia de la imagen y la URL temporal.
window.addEventListener('pagehide', () => {
  if (originalUrl) URL.revokeObjectURL(originalUrl);
  session = null;
});

void configureFormats();
applyCompare();
setZoom(1);
refreshControls();
setStatus(statusEl, 'Elegí una imagen para empezar.');
