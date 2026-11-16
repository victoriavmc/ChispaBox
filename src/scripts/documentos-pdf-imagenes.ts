/*
 * Pestaña «Imágenes»: JPG, JPEG, PNG y WebP → un PDF o un PDF por imagen (ZIP si son varios).
 * Todo ocurre en el navegador: las imágenes no se suben a ningún servidor.
 */
import { DOCUMENTOS_LIMITS, type MarginKey } from '../shared/documentos-limits.ts';
import { inspectImageFile, type ImageInfo } from '../lib/image-file.ts';
import { formatBytes } from '../shared/image-limits.ts';
import { computeLayout, MARGIN_LABEL, SIZE_LABEL, type FitOption, type LayoutOptions, type OrientationOption, type SizeOption, type PageLayout } from '../shared/pdf-layout.ts';
import { buildPdf, inspectPdfStructure, type PdfPage } from '../shared/pdf-writer.ts';
import { buildZipStore } from '../shared/zip-store.ts';
import { baseNameOf, dedupeBaseNames, sanitizeBaseName, withPdfExtension } from '../shared/nombres-archivo.ts';
import { encodeForPdf, isHexColor, type SourceFormat } from '../lib/pdf-images.ts';
import { countPdfPages, createPdfViewer, type PdfViewer } from '../lib/pdf-viewer.ts';
import { clearError, requireEl, setStatus, showError, triggerDownload } from '../lib/ui-common.ts';

interface ImageItem {
  uid: number;
  file: File;
  info: ImageInfo;
  url: string;
}

interface ResultFile {
  uid: number;
  base: string;
  bytes: Uint8Array;
  url: string;
  pages: number;
  verified: boolean;
}

const ACCEPT_FORMATS = ['JPG', 'JPEG', 'PNG', 'WebP'];

let nextUid = 1;
let items: ImageItem[] = [];
let results: ResultFile[] = [];
let running = false;
let cancelRequested = false;
let viewer: PdfViewer | null = null;

const L = {
  file: requireEl<HTMLInputElement>('img-file'),
  dropzone: requireEl<HTMLElement>('img-dropzone'),
  requirements: requireEl<HTMLElement>('img-requirements'),
  error: requireEl<HTMLElement>('img-error'),
  list: requireEl<HTMLOListElement>('img-list'),
  summary: requireEl<HTMLElement>('img-summary'),
  mode: requireEl<HTMLSelectElement>('img-mode'),
  size: requireEl<HTMLSelectElement>('img-size'),
  orientation: requireEl<HTMLSelectElement>('img-orientation'),
  margin: requireEl<HTMLSelectElement>('img-margin'),
  fit: requireEl<HTMLSelectElement>('img-fit'),
  bg: requireEl<HTMLInputElement>('img-bg'),
  bgWrap: requireEl<HTMLElement>('img-bg-wrap'),
  fitNote: requireEl<HTMLElement>('img-fit-note'),
  preview: requireEl<HTMLElement>('img-preview'),
  run: requireEl<HTMLButtonElement>('img-run'),
  cancel: requireEl<HTMLButtonElement>('img-cancel'),
  clear: requireEl<HTMLButtonElement>('img-clear'),
  progressWrap: requireEl<HTMLElement>('img-progress-wrap'),
  progress: requireEl<HTMLProgressElement>('img-progress'),
  progressText: requireEl<HTMLElement>('img-progress-text'),
  status: requireEl<HTMLElement>('img-status'),
  results: requireEl<HTMLElement>('img-results'),
  viewer: requireEl<HTMLElement>('img-viewer'),
};

function layoutOptions(): LayoutOptions {
  return {
    size: L.size.value as SizeOption,
    orientation: L.orientation.value as OrientationOption,
    margin: L.margin.value as MarginKey,
    fit: L.fit.value as FitOption,
  };
}

function backgroundColor(): string {
  return isHexColor(L.bg.value) ? L.bg.value : '#ffffff';
}

function pageLabel(layout: PageLayout): string {
  if (L.size.value === 'ajustado') return 'Ajustado a la imagen';
  return `${SIZE_LABEL[L.size.value as SizeOption]} ${layout.orientation === 'horizontal' ? 'horizontal' : 'vertical'}`;
}

/** Mensajes de límites visibles antes de seleccionar (RG-09), generados desde la configuración central. */
function renderRequirements(): void {
  const lines = [
    `Formatos: ${ACCEPT_FORMATS.join(', ')}. La extensión y el contenido real deben coincidir.`,
    `Peso por imagen: no vacía y hasta ${formatBytes(DOCUMENTOS_LIMITS.imageMaxBytesEach)} (límite preventivo).`,
    `Dimensiones: lado máximo ${DOCUMENTOS_LIMITS.imageMaxSide} px (preventivo). Resolución máxima: ${(DOCUMENTOS_LIMITS.imageMaxPixels / 1_000_000).toFixed(1)} MP (${DOCUMENTOS_LIMITS.imageMaxPixels.toLocaleString('es-AR')} píxeles).`,
    `Cantidad máxima de imágenes por operación: ${DOCUMENTOS_LIMITS.imagesMaxFiles}.`,
    `Peso máximo total: ${formatBytes(DOCUMENTOS_LIMITS.imagesMaxTotalBytes)}.`,
    `Páginas máximas generadas: ${DOCUMENTOS_LIMITS.imagesMaxPages} (preventivo). Lado máximo de página del PDF: ${DOCUMENTOS_LIMITS.pdfMaxPageSidePt / 72} in (límite real del formato PDF).`,
    'Los límites preventivos protegen la memoria del navegador; los del formato PDF son obligatorios.',
  ];
  L.requirements.replaceChildren(...lines.map((text) => {
    const li = document.createElement('li');
    li.textContent = text;
    return li;
  }));
}

function totalBytes(list: readonly ImageItem[]): number {
  return list.reduce((sum, item) => sum + item.info.sizeBytes, 0);
}

async function addFiles(files: File[]): Promise<void> {
  clearError(L.error);
  const messages: string[] = [];
  let next = [...items];
  for (const file of files) {
    if (next.length >= DOCUMENTOS_LIMITS.imagesMaxFiles) {
      messages.push(`No se agregó «${file.name}»: el máximo es ${DOCUMENTOS_LIMITS.imagesMaxFiles} imágenes por operación.`);
      continue;
    }
    if (totalBytes(next) + file.size > DOCUMENTOS_LIMITS.imagesMaxTotalBytes) {
      messages.push(`No se agregó «${file.name}»: superaría el peso total de ${formatBytes(DOCUMENTOS_LIMITS.imagesMaxTotalBytes)}.`);
      continue;
    }
    const result = await inspectImageFile(file, DOCUMENTOS_LIMITS.imageMaxPixels);
    if (!result.ok) {
      messages.push(`«${file.name}»: ${result.message}`);
      continue;
    }
    result.bitmap.close();
    next = [...next, { uid: nextUid++, file, info: result.info, url: URL.createObjectURL(file) }];
  }
  items = next;
  if (messages.length > 0) showError(L.error, messages.join(' '));
  renderAll();
}

function removeItem(uid: number): void {
  const item = items.find((i) => i.uid === uid);
  if (item) URL.revokeObjectURL(item.url);
  items = items.filter((i) => i.uid !== uid);
  renderAll();
}

function moveItem(from: number, to: number): void {
  if (to < 0 || to >= items.length || from === to) return;
  const copy = [...items];
  const [moved] = copy.splice(from, 1);
  copy.splice(to, 0, moved);
  items = copy;
  renderAll();
}

function renderList(): void {
  L.list.replaceChildren();
  items.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'img-item';
    li.draggable = true;
    li.dataset.index = String(index);

    const order = document.createElement('span');
    order.className = 'img-item__order';
    order.textContent = String(index + 1);
    order.setAttribute('aria-label', `Orden ${index + 1}`);

    const thumb = document.createElement('img');
    thumb.className = 'img-item__thumb';
    thumb.src = item.url;
    thumb.alt = '';
    thumb.loading = 'lazy';
    thumb.decoding = 'async';

    const meta = document.createElement('div');
    meta.className = 'img-item__meta';
    const name = document.createElement('strong');
    name.textContent = item.info.name;
    const details = document.createElement('span');
    details.textContent = `${item.info.format === 'jpeg' ? 'JPG' : item.info.format.toUpperCase()} · ${formatBytes(item.info.sizeBytes)} · ${item.info.width} × ${item.info.height} px · ${item.info.pixels.toLocaleString('es-AR')} píxeles`;
    meta.append(name, details);

    const actions = document.createElement('div');
    actions.className = 'img-item__actions';
    const up = button('Subir', `Subir «${item.info.name}»`, index === 0, () => moveItem(index, index - 1));
    const down = button('Bajar', `Bajar «${item.info.name}»`, index === items.length - 1, () => moveItem(index, index + 1));
    const del = button('Quitar', `Quitar «${item.info.name}»`, false, () => removeItem(item.uid));
    del.classList.add('img-item__remove');
    actions.append(up, down, del);

    li.append(order, thumb, meta, actions);
    li.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData('text/plain', String(index));
      li.classList.add('is-dragging');
    });
    li.addEventListener('dragend', () => li.classList.remove('is-dragging'));
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      li.classList.add('is-dragover');
    });
    li.addEventListener('dragleave', () => li.classList.remove('is-dragover'));
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      li.classList.remove('is-dragover');
      const from = Number(e.dataTransfer?.getData('text/plain'));
      if (Number.isInteger(from)) moveItem(from, index);
    });
    L.list.append(li);
  });
  L.list.hidden = items.length === 0;
}

function button(label: string, aria: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn--ghost img-item__btn';
  b.textContent = label;
  b.setAttribute('aria-label', aria);
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

function renderSummary(): void {
  L.summary.replaceChildren();
  if (items.length === 0) {
    L.summary.hidden = true;
    return;
  }
  const rows: Array<[string, string]> = [
    ['Imágenes', String(items.length)],
    ['Peso total', formatBytes(totalBytes(items))],
    ['Páginas que se generarían', String(items.length)],
    ['Validación', 'Correcta'],
  ];
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    L.summary.append(dt, dd);
  }
  L.summary.hidden = false;
}

/** Vista previa calculada con la MISMA función que la exportación (computeLayout). */
function renderPreview(): void {
  L.preview.replaceChildren();
  if (items.length === 0) {
    L.preview.hidden = true;
    return;
  }
  const bg = backgroundColor();
  const grid = document.createElement('div');
  grid.className = 'img-preview__grid';
  items.forEach((item, index) => {
    const layout = computeLayout(item.info.width, item.info.height, layoutOptions());
    const card = document.createElement('figure');
    card.className = 'img-page';

    const sheet = document.createElement('div');
    sheet.className = 'img-page__sheet';
    sheet.style.aspectRatio = `${layout.pageWidth} / ${layout.pageHeight}`;
    sheet.style.background = bg;
    const img = document.createElement('img');
    img.src = item.url;
    img.alt = '';
    img.style.left = `${(layout.x / layout.pageWidth) * 100}%`;
    img.style.top = `${((layout.pageHeight - layout.y - layout.height) / layout.pageHeight) * 100}%`;
    img.style.width = `${(layout.width / layout.pageWidth) * 100}%`;
    img.style.height = `${(layout.height / layout.pageHeight) * 100}%`;
    if (layout.cropped) img.classList.add('is-cropped');
    sheet.append(img);

    const caption = document.createElement('figcaption');
    const dims = `${Math.round(layout.pageWidth)} × ${Math.round(layout.pageHeight)} pt`;
    const margin = `${MARGIN_LABEL[L.margin.value as MarginKey]}`;
    const notes: string[] = [];
    if (layout.cropped) notes.push('se recorta un borde');
    if (layout.clampedToPdfLimits) notes.push('reducida al límite del PDF');
    caption.textContent = `${index + 1}. ${item.info.name} · ${pageLabel(layout)} · ${dims} · margen ${margin.toLowerCase()}${notes.length ? ` · ${notes.join(', ')}` : ''}`;

    card.append(sheet, caption);
    grid.append(card);
  });
  L.preview.append(grid);
  L.preview.hidden = false;
}

function updateFitNote(): void {
  const fit = L.fit.value as FitOption;
  L.fitNote.textContent =
    fit === 'rellenar'
      ? 'Rellenar ocupa toda la página y recorta los bordes que no entren. Revisá la vista previa.'
      : fit === 'original'
        ? 'Tamaño original: la imagen usa su tamaño natural (96 px por pulgada) y solo se reduce si no entra en la página.'
        : 'Ajustar muestra la imagen completa, con su proporción y sin deformarla.';
  L.bgWrap.hidden = false;
  // La orientación no aplica al tamaño «ajustado»: la página sigue a la imagen.
  L.orientation.disabled = L.size.value === 'ajustado';
}

function renderAll(): void {
  renderList();
  renderSummary();
  renderPreview();
  updateButtons();
}

function updateButtons(): void {
  L.run.disabled = running || items.length === 0;
  L.clear.disabled = running;
  L.cancel.hidden = !running;
  L.file.disabled = running;
}

function sanitizedNames(): string[] {
  return dedupeBaseNames(items.map((item) => sanitizeBaseName(baseNameOf(item.info.name), 'Imagen')));
}

function clearResults(): void {
  for (const r of results) URL.revokeObjectURL(r.url);
  results = [];
  L.results.replaceChildren();
  L.results.hidden = true;
  viewer?.clear();
}

/** Convierte todas las imágenes en una lista de páginas (o un PDF por imagen). */
async function buildPages(item: ImageItem, index: number, total: number): Promise<{ page: PdfPage; layout: PageLayout }> {
  setStatus(L.progressText, `Procesando ${index + 1} de ${total}: ${item.info.name}`);
  L.progress.value = index / total;
  const bitmap = await createImageBitmap(item.file);
  try {
    const source = item.info.format as SourceFormat;
    const layout = computeLayout(item.info.width, item.info.height, layoutOptions());
    const image = await encodeForPdf(bitmap, source, backgroundColor());
    return {
      layout,
      page: {
        width: layout.pageWidth,
        height: layout.pageHeight,
        x: layout.x,
        y: layout.y,
        drawWidth: layout.width,
        drawHeight: layout.height,
        image,
      },
    };
  } finally {
    bitmap.close();
  }
}

async function verify(bytes: Uint8Array, expectedPages: number): Promise<boolean> {
  const structure = inspectPdfStructure(bytes);
  if (!structure.ok || structure.pages !== expectedPages) return false;
  const opened = await countPdfPages(bytes);
  return opened === expectedPages;
}

async function convert(): Promise<void> {
  if (running || items.length === 0) return;
  clearError(L.error);
  clearResults();
  const mode = L.mode.value;
  // Cada imagen ocupa una página, tanto en un PDF único como en PDF separados.
  if (items.length > DOCUMENTOS_LIMITS.imagesMaxPages) {
    showError(L.error, `La operación generaría ${items.length} páginas; el máximo es ${DOCUMENTOS_LIMITS.imagesMaxPages}.`);
    return;
  }
  running = true;
  cancelRequested = false;
  updateButtons();
  L.progressWrap.hidden = false;
  L.progress.value = 0;
  setStatus(L.status, 'Convirtiendo…');
  try {
    const names = sanitizedNames();
    const produced: Array<{ base: string; bytes: Uint8Array; pages: number }> = [];

    if (mode === 'unico') {
      const pages: PdfPage[] = [];
      for (let i = 0; i < items.length; i += 1) {
        if (cancelRequested) break;
        pages.push((await buildPages(items[i], i, items.length)).page);
      }
      if (cancelRequested) throw new Error('CANCELADO');
      const bytes = buildPdf(pages);
      produced.push({ base: 'Mis imágenes', bytes, pages: pages.length });
    } else {
      for (let i = 0; i < items.length; i += 1) {
        if (cancelRequested) break;
        const { page } = await buildPages(items[i], i, items.length);
        produced.push({ base: names[i], bytes: buildPdf([page]), pages: 1 });
      }
      if (cancelRequested) throw new Error('CANCELADO');
    }

    L.progress.value = 1;
    setStatus(L.progressText, 'Verificando los archivos generados…');
    const checked: ResultFile[] = [];
    for (const p of produced) {
      const ok = await verify(p.bytes, p.pages);
      if (!ok) throw new Error(`El PDF «${p.base}» no superó la verificación. No se entrega.`);
      const blob = new Blob([p.bytes as BlobPart], { type: 'application/pdf' });
      checked.push({
        uid: nextUid++,
        base: p.base,
        bytes: p.bytes,
        url: URL.createObjectURL(blob),
        pages: p.pages,
        verified: true,
      });
    }
    results = checked;

    renderResults();
    setStatus(L.status, `Conversión terminada y verificada: ${results.length} archivo${results.length === 1 ? '' : 's'} PDF.`);
  } catch (error) {
    if (error instanceof Error && error.message === 'CANCELADO') {
      setStatus(L.status, 'Conversión cancelada. No se generó ningún archivo.');
    } else {
      showError(L.error, error instanceof Error ? error.message : 'No se pudo completar la conversión.');
      setStatus(L.status, 'La conversión no terminó.');
    }
  } finally {
    running = false;
    L.progressWrap.hidden = true;
    updateButtons();
  }
}

function statTile(label: string, value: string): HTMLElement {
  const tile = document.createElement('div');
  tile.className = 'img-stat';
  const l = document.createElement('span');
  l.className = 'img-stat__label';
  l.textContent = label;
  const v = document.createElement('strong');
  v.className = 'img-stat__value';
  v.textContent = value;
  tile.append(l, v);
  return tile;
}

/** Tarjeta de un PDF: nombre editable, estadísticas y descarga individual (en modo varios). */
function resultCard(result: ResultFile, nameInputRef: { input: HTMLInputElement | null }, showPerFileDownload: boolean): HTMLElement {
  const card = document.createElement('article');
  card.className = 'img-result';

  const head = document.createElement('div');
  head.className = 'img-result__head';
  const title = document.createElement('p');
  title.className = 'img-result__title';
  title.textContent = result.verified ? '✔ PDF generado y verificado' : 'PDF generado';
  head.append(title);

  const stats = document.createElement('div');
  stats.className = 'img-stats';
  stats.append(
    statTile('Páginas', String(result.pages)),
    statTile('Peso final', formatBytes(result.bytes.length)),
    statTile('Verificación', result.verified ? 'Abierto y comprobado' : 'No verificado'),
  );

  const nameId = `img-name-${result.uid}`;
  const nameLabel = document.createElement('label');
  nameLabel.className = 'img-result__label';
  nameLabel.htmlFor = nameId;
  nameLabel.textContent = 'Nombre para cambiar (sin .pdf)';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.id = nameId;
  nameInput.className = 'img-result__name';
  nameInput.value = result.base;
  nameInput.maxLength = 140;
  nameInputRef.input = nameInput;

  card.append(head, stats, nameLabel, nameInput);

  if (showPerFileDownload) {
    const actions = document.createElement('div');
    actions.className = 'img-result__actions';
    const download = document.createElement('button');
    download.type = 'button';
    download.className = 'btn btn--soft';
    download.textContent = 'Descargar este PDF';
    download.addEventListener('click', () => {
      triggerDownload(result.url, withPdfExtension(sanitizeBaseName(nameInput.value, result.base)));
    });
    const preview = document.createElement('button');
    preview.type = 'button';
    preview.className = 'btn btn--ghost';
    preview.textContent = 'Ver vista previa';
    preview.addEventListener('click', () => void showInViewer(result));
    actions.append(download, preview);
    card.append(actions);
  }
  return card;
}

function renderResults(): void {
  L.results.replaceChildren();
  const heading = document.createElement('h3');
  heading.className = 'field-label';
  heading.textContent = 'Resultado';
  L.results.append(heading);

  const multiple = results.length > 1;
  const refs: Array<{ input: HTMLInputElement | null }> = results.map(() => ({ input: null }));
  results.forEach((result, i) => {
    L.results.append(resultCard(result, refs[i], multiple));
  });

  // La vista previa va justo debajo del resultado y antes de las acciones finales.
  L.results.append(L.viewer);

  const actions = document.createElement('div');
  actions.className = 'img-result__final rec-actions';
  if (!multiple && results[0]) {
    const only = results[0];
    const download = document.createElement('button');
    download.type = 'button';
    download.className = 'btn btn--primary';
    download.textContent = 'Descargar PDF';
    download.addEventListener('click', () => {
      const name = refs[0].input?.value ?? only.base;
      triggerDownload(only.url, withPdfExtension(sanitizeBaseName(name, only.base)));
    });
    actions.append(download);
  } else if (multiple) {
    const zip = document.createElement('button');
    zip.type = 'button';
    zip.className = 'btn btn--primary';
    zip.textContent = `Descargar todos en ZIP (${results.length} PDF)`;
    zip.addEventListener('click', () => downloadZip());
    actions.append(zip);
  }
  const clearAll = document.createElement('button');
  clearAll.type = 'button';
  clearAll.className = 'btn btn--ghost';
  clearAll.textContent = 'Quitar todas las imágenes';
  clearAll.addEventListener('click', resetAll);
  actions.append(clearAll);
  L.results.append(actions);

  L.results.hidden = false;
  if (results[0]) void showInViewer(results[0]);
}

/** ZIP con los nombres que el usuario dejó en los campos (se genera al descargar, sin guardarlo). */
function downloadZip(): void {
  const inputs = Array.from(L.results.querySelectorAll<HTMLInputElement>('.img-result__name'));
  const names = dedupeBaseNames(inputs.map((input, i) => sanitizeBaseName(input.value, results[i]?.base ?? 'Documento')));
  const zipBytes = buildZipStore(results.map((r, i) => ({ name: withPdfExtension(names[i]), data: r.bytes })));
  const url = URL.createObjectURL(new Blob([zipBytes as BlobPart], { type: 'application/zip' }));
  triggerDownload(url, 'Imágenes en PDF.zip');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

async function showInViewer(result: ResultFile): Promise<void> {
  viewer ??= createPdfViewer(L.viewer);
  try {
    await viewer.show(result.bytes, withPdfExtension(result.base));
  } catch {
    showError(L.error, 'No se pudo mostrar la vista previa de este PDF.');
  }
}

function resetAll(): void {
  for (const item of items) URL.revokeObjectURL(item.url);
  items = [];
  clearResults();
  L.file.value = '';
  clearError(L.error);
  setStatus(L.status, '');
  renderAll();
}

export function initImagenes(): void {
  renderRequirements();
  updateFitNote();

  L.file.addEventListener('change', () => {
    const files = Array.from(L.file.files ?? []);
    L.file.value = '';
    if (files.length > 0) void addFiles(files);
  });
  L.dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    L.dropzone.classList.add('is-dragover');
  });
  L.dropzone.addEventListener('dragleave', () => L.dropzone.classList.remove('is-dragover'));
  L.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    L.dropzone.classList.remove('is-dragover');
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) void addFiles(files);
  });

  for (const control of [L.size, L.orientation, L.margin, L.fit, L.mode, L.bg]) {
    control.addEventListener('change', () => {
      updateFitNote();
      renderAll();
    });
  }
  L.bg.addEventListener('input', () => renderPreview());

  L.run.addEventListener('click', () => void convert());
  L.cancel.addEventListener('click', () => {
    cancelRequested = true;
    setStatus(L.progressText, 'Cancelando…');
  });
  L.clear.addEventListener('click', resetAll);

  renderAll();
}
