/*
 * Página «OCR de documentos»: reconoce texto de fotos o escaneos (JPG, PNG, WebP o PDF escaneado).
 * Todo ocurre en el navegador: Tesseract.js (Apache-2.0) corre en un Worker y carga su núcleo WASM
 * y los datos de idioma desde /ocr/ (copiados por scripts/copy-ocr.mjs). No se envía nada a servidores.
 * La vista previa de la imagen (o de la página del PDF) queda junto al texto para compararlos.
 */
import '../../../../src/styles/image-tools.css';
import '../../../../src/styles/documentos-pdf.css';
import '../styles/ocr-documentos.css';
import { createWorker, OEM, type Worker } from 'tesseract.js';
import { openPdf, renderPage, type OpenedPdf } from '../../../../src/lib/pdf-viewer.ts';
import { readDimensions } from '../../../../src/lib/image-file.ts';
import { attachDropzone, clearError, requireEl, setStatus, showError, triggerDownload } from '../../../../src/lib/ui-common.ts';
import { IMAGE_LIMITS, formatBytes, formatMegapixels } from '../../../../src/shared/image-limits.ts';
import { INPUT_MIME, sniffInputFormat, type InputFormat } from '../../../../src/shared/image-format.ts';
import {
  buildDocxBytes,
  buildTxtBytes,
  pageSeparator,
  safeBaseName,
} from '../shared/ocr-export.ts';

/** Límites propios del OCR (el reconocimiento es costoso en memoria y tiempo). */
const OCR_LIMITS = {
  maxPdfBytes: 30 * 1024 * 1024,
  maxPdfPages: 20,
  maxPixels: 20_000_000,
  /** Ancho objetivo al renderizar un PDF: ~300 ppp en una carta de 8,5 pulgadas. */
  pdfTargetWidth: 2550,
  pdfMaxScale: 3.5,
} as const;

/** Ancho máximo (px CSS) de la vista previa de una página del PDF. */
const PREVIEW_MAX_WIDTH = 560;

const ASSETS = {
  worker: '/ocr/worker.min.js',
  core: '/ocr/core/',
  lang: '/ocr/lang/',
} as const;

type Lang = 'spa' | 'eng' | 'spa+eng';

type Source =
  | { kind: 'image'; file: File; format: InputFormat; width: number; height: number }
  | { kind: 'pdf'; file: File; pages: number };

interface PageResult {
  text: string;
  confidence: number;
}

let source: Source | null = null;
let activeWorker: Worker | null = null;
let running = false;
let cancelRequested = false;
let resultName = 'Texto OCR';
/** Progreso global: páginas ya terminadas y total (lo usa el logger de Tesseract). */
let progressState = { done: 0, total: 1 };
/** Rechaza el reconocimiento en curso al cancelar (el worker terminado no resuelve sus trabajos). */
let abortRecognition: ((reason: Error) => void) | null = null;

/** Vista previa: imagen (object URL) o PDF abierto para renderizar la página elegida. */
let previewUrl: string | null = null;
let previewPdf: OpenedPdf | null = null;
let previewPages = 0;
let previewPage = 1;
let previewToken = 0;

const E = {
  dropzone: requireEl<HTMLElement>('ocr-dropzone'),
  file: requireEl<HTMLInputElement>('ocr-file'),
  requirements: requireEl<HTMLElement>('ocr-requirements'),
  error: requireEl<HTMLElement>('ocr-error'),
  info: requireEl<HTMLElement>('ocr-info'),
  lang: requireEl<HTMLSelectElement>('ocr-lang'),
  run: requireEl<HTMLButtonElement>('ocr-run'),
  cancel: requireEl<HTMLButtonElement>('ocr-cancel'),
  clear: requireEl<HTMLButtonElement>('ocr-clear'),
  progressWrap: requireEl<HTMLElement>('ocr-progress-wrap'),
  progress: requireEl<HTMLProgressElement>('ocr-progress'),
  progressText: requireEl<HTMLElement>('ocr-progress-text'),
  status: requireEl<HTMLElement>('ocr-status'),
  results: requireEl<HTMLElement>('ocr-results'),
  previewImg: requireEl<HTMLImageElement>('ocr-preview-img'),
  previewCanvas: requireEl<HTMLCanvasElement>('ocr-preview-canvas'),
  previewNav: requireEl<HTMLElement>('ocr-preview-nav'),
  previewLabel: requireEl<HTMLElement>('ocr-preview-label'),
  prev: requireEl<HTMLButtonElement>('ocr-prev'),
  next: requireEl<HTMLButtonElement>('ocr-next'),
  text: requireEl<HTMLTextAreaElement>('ocr-text'),
  copy: requireEl<HTMLButtonElement>('ocr-copy'),
  txt: requireEl<HTMLButtonElement>('ocr-txt'),
  docx: requireEl<HTMLButtonElement>('ocr-docx'),
};

const LANG_LABEL: Record<Lang, string> = {
  spa: 'Español',
  eng: 'Inglés',
  'spa+eng': 'Español e inglés',
};

function currentLang(): Lang {
  const value = E.lang.value;
  return value === 'eng' || value === 'spa+eng' ? value : 'spa';
}

function renderRequirements(): void {
  const lines = [
    'Formatos: JPG, PNG, WebP o PDF escaneado.',
    `Peso máximo: ${formatBytes(IMAGE_LIMITS.maxBytes)} por imagen y ${formatBytes(OCR_LIMITS.maxPdfBytes)} por PDF.`,
    `Resolución máxima de imagen: ${formatMegapixels(OCR_LIMITS.maxPixels)} y lado máximo de ${IMAGE_LIMITS.maxSide} px.`,
    `PDF: hasta ${OCR_LIMITS.maxPdfPages} páginas por vez.`,
    'Para mejores resultados: texto nítido, bien iluminado y sin inclinación.',
  ];
  E.requirements.replaceChildren(
    ...lines.map((line) => {
      const li = document.createElement('li');
      li.textContent = line;
      return li;
    }),
  );
}

function renderInfo(rows: Array<[string, string]>): void {
  E.info.replaceChildren(
    ...rows.flatMap(([label, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      return [dt, dd];
    }),
  );
  E.info.hidden = false;
}

/** La sección de resultados se ve si hay algo que comparar: vista previa o texto. */
function updateResults(): void {
  E.results.hidden = !(previewUrl !== null || previewPdf !== null || E.text.value.length > 0);
}

function resetResult(): void {
  E.text.value = '';
  updateResults();
}

function updateButtons(): void {
  E.run.disabled = !source || running;
  E.clear.disabled = running;
  E.lang.disabled = running;
}

/** Libera la vista previa anterior (object URL y documento PDF). */
async function clearPreview(): Promise<void> {
  previewToken += 1;
  if (previewUrl) {
    URL.revokeObjectURL(previewUrl);
    previewUrl = null;
  }
  E.previewImg.hidden = true;
  E.previewImg.removeAttribute('src');
  E.previewCanvas.hidden = true;
  E.previewNav.hidden = true;
  const pdf = previewPdf;
  previewPdf = null;
  previewPages = 0;
  previewPage = 1;
  if (pdf) await pdf.close().catch(() => undefined);
  updateResults();
}

/** Dibuja una página del PDF en la vista previa y actualiza los controles de navegación. */
async function showPdfPage(pageNumber: number): Promise<void> {
  if (!previewPdf) return;
  const token = ++previewToken;
  previewPage = pageNumber;
  E.previewLabel.textContent = `Página ${pageNumber} de ${previewPages}`;
  E.prev.disabled = pageNumber <= 1;
  E.next.disabled = pageNumber >= previewPages;
  const width = Math.min(PREVIEW_MAX_WIDTH, Math.max(200, E.previewCanvas.parentElement?.clientWidth ?? PREVIEW_MAX_WIDTH));
  try {
    await renderPage(previewPdf.doc, pageNumber, E.previewCanvas, width);
  } catch {
    if (token === previewToken) showError(E.error, 'No se pudo mostrar la vista previa de esta página.');
    return;
  }
  if (token === previewToken) E.previewCanvas.hidden = false;
}

/** Comprueba la firma «%PDF-» de los primeros bytes (no solo la extensión). */
async function sniffPdf(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return head.length === 5 && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 && head[4] === 0x2d;
}

async function selectFile(file: File): Promise<void> {
  clearError(E.error);
  resetResult();
  await clearPreview();
  source = null;
  E.info.hidden = true;
  updateButtons();

  if (file.size < 1) return showError(E.error, 'El archivo está vacío (0 bytes). Elegí otro.');

  if (await sniffPdf(file)) {
    if (file.size > OCR_LIMITS.maxPdfBytes) {
      return showError(E.error, `El PDF pesa ${formatBytes(file.size)} y supera el máximo de ${formatBytes(OCR_LIMITS.maxPdfBytes)}.`);
    }
    let opened: OpenedPdf;
    try {
      opened = await openPdf(new Uint8Array(await file.arrayBuffer()));
    } catch {
      return showError(E.error, 'No se pudo abrir el PDF: el archivo está dañado o protegido con contraseña.');
    }
    const pages = opened.doc.numPages;
    if (pages > OCR_LIMITS.maxPdfPages) {
      await opened.close();
      return showError(E.error, `El PDF tiene ${pages} páginas y el máximo por vez es ${OCR_LIMITS.maxPdfPages}. Dividilo e intentá de nuevo.`);
    }
    // El documento queda abierto para la vista previa; se cierra al cambiar de archivo.
    previewPdf = opened;
    previewPages = pages;
    source = { kind: 'pdf', file, pages };
    E.previewNav.hidden = pages <= 1;
    renderInfo([
      ['Nombre', file.name],
      ['Peso', formatBytes(file.size)],
      ['Tipo de archivo detectado', 'PDF'],
      ['Páginas', String(pages)],
    ]);
    updateResults();
    updateButtons();
    await showPdfPage(1);
    return;
  }

  if (file.size > IMAGE_LIMITS.maxBytes) {
    return showError(E.error, `La imagen pesa ${formatBytes(file.size)} y supera el máximo de ${formatBytes(IMAGE_LIMITS.maxBytes)}.`);
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = sniffInputFormat(bytes.subarray(0, 16));
  if (!format) {
    return showError(E.error, 'Formato no admitido. Elegí una imagen JPG, PNG o WebP, o un PDF escaneado.');
  }
  const header = readDimensions(bytes, format);
  if (!header || header.width < 1 || header.height < 1) {
    return showError(E.error, 'No se pudieron leer las dimensiones: el archivo parece dañado.');
  }
  const { width, height } = header;
  if (width > IMAGE_LIMITS.maxSide || height > IMAGE_LIMITS.maxSide) {
    return showError(E.error, `La imagen tiene ${width} × ${height} px y supera el lado máximo de ${IMAGE_LIMITS.maxSide} px.`);
  }
  if (width * height > OCR_LIMITS.maxPixels) {
    return showError(E.error, `La imagen tiene ${formatMegapixels(width * height)} y supera el máximo de ${formatMegapixels(OCR_LIMITS.maxPixels)}.`);
  }

  const imageFile = new File([bytes], file.name, { type: INPUT_MIME[format] });
  source = { kind: 'image', file: imageFile, format, width, height };
  previewUrl = URL.createObjectURL(imageFile);
  E.previewImg.src = previewUrl;
  E.previewImg.hidden = false;
  E.previewNav.hidden = true;
  renderInfo([
    ['Nombre', file.name],
    ['Peso', formatBytes(file.size)],
    ['Formato detectado', format === 'jpeg' ? 'JPG / JPEG' : format.toUpperCase()],
    ['Dimensiones', `${width} × ${height} px`],
  ]);
  updateResults();
  updateButtons();
}

/** Dibuja la imagen respetando la orientación EXIF (las fotos de celular suelen venir giradas). */
async function imageToCanvas(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('El navegador no permite procesar la imagen.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

/** Renderiza una página del PDF a canvas con resolución suficiente para OCR. */
async function renderPdfPage(opened: OpenedPdf, pageNumber: number): Promise<HTMLCanvasElement> {
  const page = await opened.doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(OCR_LIMITS.pdfMaxScale, OCR_LIMITS.pdfTargetWidth / base.width);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('El navegador no permite procesar la página.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  page.cleanup();
  return canvas;
}

function releaseCanvas(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
}

function setProgress(done: number, total: number, pageFraction: number): void {
  const overall = total === 0 ? 0 : (done + pageFraction) / total;
  E.progress.value = Math.min(1, Math.max(0, overall));
  E.progressText.textContent = `Página ${Math.min(done + 1, total)} de ${total} · ${Math.round(pageFraction * 100)} %`;
}

/** Reconoce una página; se puede interrumpir con «Cancelar» sin esperar a que Tesseract responda. */
function recognizeCanvas(worker: Worker, canvas: HTMLCanvasElement): Promise<PageResult> {
  const aborted = new Promise<never>((_resolve, reject) => {
    abortRecognition = reject;
  });
  const recognized = worker.recognize(canvas).then((result) => ({
    text: result.data.text.trim(),
    confidence: result.data.confidence,
  }));
  return Promise.race([recognized, aborted]).finally(() => {
    abortRecognition = null;
  });
}

async function runOcr(): Promise<void> {
  if (!source || running) return;
  clearError(E.error);
  resetResult();
  running = true;
  cancelRequested = false;
  updateButtons();
  E.cancel.hidden = false;
  E.progressWrap.hidden = false;
  E.progress.value = 0;
  const lang = currentLang();
  setStatus(E.status, `Cargando el idioma (${LANG_LABEL[lang]}) y el motor de reconocimiento…`);

  const pages: PageResult[] = [];
  let pdf: OpenedPdf | null = null;
  try {
    const worker = await createWorker(lang, OEM.LSTM_ONLY, {
      workerPath: ASSETS.worker,
      corePath: ASSETS.core,
      langPath: ASSETS.lang,
      gzip: true,
      logger: (message: { status: string; progress: number }) => {
        if (message.status === 'recognizing text') setProgress(progressState.done, progressState.total, message.progress);
      },
    });
    activeWorker = worker;
    if (cancelRequested) throw new Error('cancelado');

    const total = source.kind === 'pdf' ? source.pages : 1;
    progressState = { done: 0, total };
    setStatus(E.status, 'Reconociendo el texto. Esto puede tardar unos segundos por página…');

    if (source.kind === 'image') {
      setProgress(0, 1, 0);
      const canvas = await imageToCanvas(source.file);
      try {
        pages.push(await recognizeCanvas(worker, canvas));
      } finally {
        releaseCanvas(canvas);
      }
      setProgress(1, 1, 1);
    } else {
      pdf = await openPdf(new Uint8Array(await source.file.arrayBuffer()));
      for (let n = 1; n <= total; n += 1) {
        if (cancelRequested) throw new Error('cancelado');
        progressState = { done: n - 1, total };
        setProgress(n - 1, total, 0);
        const canvas = await renderPdfPage(pdf, n);
        try {
          pages.push(await recognizeCanvas(worker, canvas));
        } finally {
          releaseCanvas(canvas);
        }
        setProgress(n, total, 1);
      }
    }

    await worker.terminate();
    activeWorker = null;

    const withText = pages.filter((p) => p.text.length > 0);
    if (withText.length === 0) {
      setStatus(E.status, 'Listo, pero no se detectó texto.');
      showError(E.error, 'No se detectó texto. Probá con una foto más nítida, con mejor luz o sin inclinación.');
      return;
    }

    E.text.value =
      pages.length === 1
        ? pages[0]?.text ?? ''
        : pages.map((p, i) => `${pageSeparator(i + 1)}\n\n${p.text}`).join('\n\n');
    resultName = safeBaseName(source.file.name, 'Texto OCR');
    updateResults();

    const confidence = pages.reduce((sum, p) => sum + p.confidence, 0) / pages.length;
    setStatus(E.status, `Reconocimiento terminado. Confianza media: ${Math.round(confidence)} %. Compará el texto con la vista previa antes de usarlo.`);
  } catch (error) {
    if (cancelRequested || (error instanceof Error && error.message === 'cancelado')) {
      setStatus(E.status, 'Reconocimiento cancelado. No se generó ningún texto.');
    } else {
      const message = error instanceof Error ? error.message : 'No se pudo completar el reconocimiento.';
      showError(E.error, `No se pudo completar el reconocimiento: ${message}`);
      setStatus(E.status, 'El reconocimiento no terminó.');
    }
  } finally {
    if (activeWorker) {
      await activeWorker.terminate().catch(() => undefined);
      activeWorker = null;
    }
    if (pdf) await pdf.close().catch(() => undefined);
    running = false;
    cancelRequested = false;
    E.cancel.hidden = true;
    E.progressWrap.hidden = true;
    updateButtons();
  }
}

async function cancelOcr(): Promise<void> {
  if (!running) return;
  cancelRequested = true;
  abortRecognition?.(new Error('cancelado'));
  if (activeWorker) {
    await activeWorker.terminate().catch(() => undefined);
    activeWorker = null;
  }
}

async function copyText(): Promise<void> {
  const text = E.text.value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus(E.status, 'Texto copiado al portapapeles.');
  } catch {
    // Sin permiso del portapapeles: se selecciona el texto para copiarlo a mano.
    E.text.select();
    setStatus(E.status, 'No se pudo usar el portapapeles automáticamente. El texto quedó seleccionado: copialo con Ctrl+C.');
  }
}

function download(bytes: Uint8Array, mime: string, filename: string): void {
  const blob = new Blob([bytes.slice()], { type: mime });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function downloadTxt(): void {
  if (!E.text.value) return;
  download(buildTxtBytes(E.text.value), 'text/plain;charset=utf-8', `${resultName}.txt`);
  setStatus(E.status, 'Archivo TXT generado.');
}

function downloadDocx(): void {
  if (!E.text.value) return;
  download(
    buildDocxBytes(E.text.value),
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    `${resultName}.docx`,
  );
  setStatus(E.status, 'Archivo DOCX generado.');
}

async function clearAll(): Promise<void> {
  if (running) return;
  source = null;
  clearError(E.error);
  resetResult();
  await clearPreview();
  E.info.hidden = true;
  E.file.value = '';
  setStatus(E.status, '');
  updateButtons();
}

function init(): void {
  renderRequirements();
  updateButtons();
  updateResults();

  E.file.addEventListener('change', () => {
    const file = E.file.files?.[0];
    if (file) void selectFile(file);
  });
  attachDropzone(E.dropzone, (files) => {
    const file = files[0];
    if (files.length > 1) showError(E.error, 'Se usa solo el primer archivo. Subí un archivo por vez.');
    if (file) void selectFile(file);
  });
  E.run.addEventListener('click', () => void runOcr());
  E.cancel.addEventListener('click', () => void cancelOcr());
  E.clear.addEventListener('click', () => void clearAll());
  E.prev.addEventListener('click', () => void showPdfPage(previewPage - 1));
  E.next.addEventListener('click', () => void showPdfPage(previewPage + 1));
  E.copy.addEventListener('click', () => void copyText());
  E.txt.addEventListener('click', downloadTxt);
  E.docx.addEventListener('click', downloadDocx);
  window.addEventListener('beforeunload', (event) => {
    if (running) event.preventDefault();
  });
}

init();
