/*
 * Página «Dividir PDF»: cada página en un PDF separado (eligiendo cuáles, con miniaturas),
 * o intervalos (p. ej. 3-8). Todo ocurre en el navegador: pdf-lib divide y PDF.js dibuja las
 * miniaturas. El archivo no se sube a ningún servidor.
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/dividir-pdf.css';
import { formatBytes } from '../shared/image-limits.ts';
import { baseNameOf, dedupeBaseNames, sanitizeBaseName } from '../shared/nombres-archivo.ts';
import { buildZipStore } from '../shared/zip-store.ts';
import {
  DIVIDIR_LIMITS,
  cargarPdf,
  dividirPdf,
  etiquetaIntervalo,
  intervalosDePaginas,
  parseIntervalos,
  unirPaginas,
  type Intervalo,
} from '../shared/dividir-pdf.ts';
import { openPdf, renderPage, type OpenedPdf } from '../lib/pdf-viewer.ts';
import { clearError, requireEl, setStatus, showError, triggerDownload } from '../lib/ui-common.ts';
import type { PDFDocument } from 'pdf-lib';

type Modo = 'paginas' | 'seleccion' | 'intervalos';

interface Loaded {
  name: string;
  bytes: Uint8Array;
  doc: PDFDocument;
  total: number;
  size: number;
}

const E = {
  requirements: requireEl<HTMLElement>('dividir-requirements'),
  file: requireEl<HTMLInputElement>('dividir-file'),
  dropzone: requireEl<HTMLElement>('dividir-dropzone'),
  error: requireEl<HTMLElement>('dividir-error'),
  info: requireEl<HTMLElement>('dividir-info'),
  modoPaginas: requireEl<HTMLInputElement>('dividir-modo-paginas'),
  modoIntervalos: requireEl<HTMLInputElement>('dividir-modo-intervalos'),
  modoSeleccion: requireEl<HTMLInputElement>('dividir-modo-seleccion'),
  gridHelp: requireEl<HTMLElement>('dividir-grid-help'),
  intervalosWrap: requireEl<HTMLElement>('dividir-intervalos-wrap'),
  intervalos: requireEl<HTMLInputElement>('dividir-intervalos'),
  intervalosHelp: requireEl<HTMLElement>('dividir-intervalos-help'),
  gridWrap: requireEl<HTMLElement>('dividir-grid-wrap'),
  gridCount: requireEl<HTMLElement>('dividir-grid-count'),
  selectAll: requireEl<HTMLButtonElement>('dividir-sel-todas'),
  selectNone: requireEl<HTMLButtonElement>('dividir-sel-ninguna'),
  selectInvert: requireEl<HTMLButtonElement>('dividir-sel-invertir'),
  grid: requireEl<HTMLOListElement>('dividir-grid'),
  zoom: requireEl<HTMLDialogElement>('dividir-zoom'),
  zoomCanvas: requireEl<HTMLCanvasElement>('dividir-zoom-canvas'),
  zoomTitle: requireEl<HTMLElement>('dividir-zoom-title'),
  zoomPrev: requireEl<HTMLButtonElement>('dividir-zoom-prev'),
  zoomNext: requireEl<HTMLButtonElement>('dividir-zoom-next'),
  zoomClose: requireEl<HTMLButtonElement>('dividir-zoom-close'),
  run: requireEl<HTMLButtonElement>('dividir-run'),
  clear: requireEl<HTMLButtonElement>('dividir-clear'),
  progressWrap: requireEl<HTMLElement>('dividir-progress-wrap'),
  progressText: requireEl<HTMLElement>('dividir-progress-text'),
  status: requireEl<HTMLElement>('dividir-status'),
  results: requireEl<HTMLElement>('dividir-results'),
};

let loaded: Loaded | null = null;
let busy = false;
/** Páginas elegidas (base 1). Por defecto, todas. */
let selected = new Set<number>();
/** Documento de PDF.js para las miniaturas; se cierra al cambiar de archivo. */
let preview: OpenedPdf | null = null;
let thumbObserver: IntersectionObserver | null = null;
let thumbSession = 0;

function modoActual(): Modo {
  if (E.modoIntervalos.checked) return 'intervalos';
  if (E.modoSeleccion.checked) return 'seleccion';
  return 'paginas';
}

/** Firma «%PDF-» al inicio del archivo, además de la extensión. */
async function tieneFirmaPdf(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return head.length === 5 && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 && head[4] === 0x2d;
}

function resetResults(): void {
  E.results.replaceChildren();
  E.results.hidden = true;
}

function renderInfo(item: Loaded): void {
  const rows: Array<[string, string]> = [
    ['Nombre', item.name],
    ['Peso', formatBytes(item.size)],
    ['Páginas', String(item.total)],
    ['Validación', 'Correcta'],
  ];
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

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/* ---------- Miniaturas y selección de páginas ---------- */

function closePreview(): void {
  thumbSession += 1;
  thumbObserver?.disconnect();
  thumbObserver = null;
  const previous = preview;
  preview = null;
  if (previous) void previous.close();
}

/** Actualiza el contador y el estado del botón según las páginas elegidas. */
function updateSelectionUi(): void {
  const total = loaded?.total ?? 0;
  E.gridCount.textContent = `${selected.size} de ${total} página(s) seleccionada(s)`;
  if (modoActual() !== 'intervalos') {
    E.run.disabled = !loaded || selected.size === 0 || busy;
  }
}

function toggleSelected(page: number, on: boolean, item: HTMLLIElement): void {
  if (on) selected.add(page);
  else selected.delete(page);
  item.classList.toggle('is-selected', on);
  updateSelectionUi();
}

/** Crea una miniatura por página. El dibujo se hace cuando la página entra en pantalla. */
async function buildGrid(item: Loaded, bytes: Uint8Array): Promise<void> {
  const session = thumbSession;
  E.grid.replaceChildren();
  let opened: OpenedPdf | null = null;
  try {
    opened = await openPdf(bytes);
  } catch (error) {
    // Sin vista previa igual se pueden elegir y dividir las páginas: se informa el motivo real.
    console.error('Dividir PDF: no se abrió la vista previa', error);
    showError(
      E.error,
      `No se pudo generar la vista previa (${describeError(error)}). Podés igual elegir las páginas y dividir el PDF.`,
    );
  }
  if (opened && session !== thumbSession) {
    void opened.close();
    return;
  }
  preview = opened;

  const frag = document.createDocumentFragment();
  const canvases = new Map<HTMLCanvasElement, number>();
  for (let page = 1; page <= item.total; page += 1) {
    const li = document.createElement('li');
    li.className = 'dividir-item is-selected';
    const label = document.createElement('label');
    label.className = 'dividir-item__label';

    const canvas = document.createElement('canvas');
    canvas.className = 'dividir-item__canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvases.set(canvas, page);

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.className = 'dividir-item__check';
    check.checked = selected.has(page);
    check.dataset.page = String(page);
    check.addEventListener('change', () => toggleSelected(page, check.checked, li));

    const text = document.createElement('span');
    text.className = 'dividir-item__text';
    text.textContent = `Página ${page}`;

    const zoomBtn = document.createElement('button');
    zoomBtn.type = 'button';
    zoomBtn.className = 'btn btn--ghost dividir-item__zoom';
    zoomBtn.textContent = 'Ver grande';
    zoomBtn.setAttribute('aria-label', `Ver la página ${page} en tamaño grande`);
    zoomBtn.addEventListener('click', () => void openZoom(page));

    label.append(canvas, check, text);
    li.append(label, zoomBtn);
    li.classList.toggle('is-selected', selected.has(page));
    frag.append(li);
  }
  E.grid.append(frag);
  if (!preview) return;

  thumbObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const canvas = entry.target as HTMLCanvasElement;
        const page = canvases.get(canvas);
        thumbObserver?.unobserve(canvas);
        if (page === undefined || session !== thumbSession || !preview) continue;
        renderPage(preview.doc, page, canvas, 260).catch((error) => {
          console.error(`Dividir PDF: no se dibujó la página ${page}`, error);
        });
      }
    },
    { rootMargin: '300px 0px' },
  );
  for (const canvas of canvases.keys()) thumbObserver.observe(canvas);
}

let zoomPage = 1;

/** Muestra una página en grande dentro de un diálogo, con navegación anterior y siguiente. */
async function openZoom(page: number): Promise<void> {
  if (!preview || !loaded) return;
  zoomPage = page;
  E.zoomTitle.textContent = `Página ${page} de ${loaded.total}`;
  E.zoomPrev.disabled = page <= 1;
  E.zoomNext.disabled = page >= loaded.total;
  if (!E.zoom.open) E.zoom.showModal();
  const width = Math.min(window.innerWidth - 48, 900);
  try {
    await renderPage(preview.doc, page, E.zoomCanvas, Math.max(200, width));
  } catch {
    E.zoomTitle.textContent = `No se pudo mostrar la página ${page}`;
  }
}

function setAllSelected(on: boolean): void {
  if (!loaded) return;
  selected = on ? new Set(Array.from({ length: loaded.total }, (_, i) => i + 1)) : new Set();
  E.grid.querySelectorAll<HTMLLIElement>('.dividir-item').forEach((li) => {
    li.classList.toggle('is-selected', on);
    const check = li.querySelector<HTMLInputElement>('.dividir-item__check');
    if (check) check.checked = on;
  });
  updateSelectionUi();
}

function invertSelected(): void {
  if (!loaded) return;
  const next = new Set<number>();
  for (let p = 1; p <= loaded.total; p += 1) if (!selected.has(p)) next.add(p);
  selected = next;
  E.grid.querySelectorAll<HTMLLIElement>('.dividir-item').forEach((li) => {
    const check = li.querySelector<HTMLInputElement>('.dividir-item__check');
    const page = Number(check?.dataset.page);
    const on = selected.has(page);
    li.classList.toggle('is-selected', on);
    if (check) check.checked = on;
  });
  updateSelectionUi();
}

/* ---------- Modo y carga ---------- */

function updateModo(): void {
  const intervalos = modoActual() === 'intervalos';
  E.intervalosWrap.hidden = !intervalos;
  E.intervalos.required = intervalos;
  E.gridWrap.hidden = intervalos || !loaded;
  E.gridHelp.textContent =
    modoActual() === 'seleccion'
      ? 'Tocá una miniatura o su casilla para elegir las páginas que van al PDF único.'
      : 'Tocá una miniatura o su casilla para elegirla. Cada página elegida se descarga en su propio PDF.';
  if (loaded) {
    E.intervalosHelp.textContent = `Ejemplos válidos: 3-8 · 1, 4, 6-9 · 5. El PDF tiene ${loaded.total} página(s).`;
  }
  resetResults();
  updateSelectionUi();
  if (!intervalos) E.run.disabled = !loaded || selected.size === 0 || busy;
  else E.run.disabled = !loaded || busy;
}

async function selectFile(file: File): Promise<void> {
  clearError(E.error);
  resetResults();
  closePreview();
  loaded = null;
  selected = new Set();
  E.grid.replaceChildren();
  E.gridWrap.hidden = true;
  E.info.hidden = true;
  E.run.disabled = true;

  if (!/\.pdf$/i.test(file.name)) return showError(E.error, 'Formato no admitido. Elegí un archivo .pdf.');
  if (file.size < 1) return showError(E.error, 'El archivo está vacío (0 bytes). Elegí otro.');
  if (file.size > DIVIDIR_LIMITS.maxBytes) {
    return showError(
      E.error,
      `El archivo pesa ${formatBytes(file.size)} y supera el máximo de ${formatBytes(DIVIDIR_LIMITS.maxBytes)}.`,
    );
  }
  if (!(await tieneFirmaPdf(file))) {
    return showError(E.error, 'El contenido no es un PDF: la firma del archivo no coincide con su extensión.');
  }

  setStatus(E.status, 'Leyendo el PDF…');
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const doc = await cargarPdf(bytes);
    loaded = { name: file.name, bytes, doc, total: doc.getPageCount(), size: file.size };
  } catch (error) {
    setStatus(E.status, '');
    return showError(E.error, error instanceof Error ? error.message : 'No se pudo leer el PDF.');
  }
  setStatus(E.status, '');
  selected = new Set(Array.from({ length: loaded.total }, (_, i) => i + 1));
  renderInfo(loaded);
  updateModo();
  if (modoActual() !== 'intervalos') {
    setStatus(E.status, 'Cargando las miniaturas…');
    try {
      await buildGrid(loaded, loaded.bytes);
      setStatus(E.status, '');
    } catch (error) {
      console.error('Dividir PDF: error al crear la cuadrícula', error);
      showError(E.error, `No se pudieron mostrar las miniaturas (${describeError(error)}).`);
    }
  }
}

async function dividir(): Promise<void> {
  if (!loaded || busy) return;
  clearError(E.error);
  resetResults();
  const item = loaded;
  const modo = modoActual();

  let plan: Intervalo[] = [];
  if (modo === 'intervalos') {
    const r = parseIntervalos(E.intervalos.value, item.total);
    if (!r.ok) {
      showError(E.error, r.error);
      return;
    }
    plan = r.intervalos;
  } else {
    if (selected.size === 0) {
      showError(E.error, 'Seleccioná al menos una página.');
      return;
    }
    if (modo === 'paginas') plan = intervalosDePaginas([...selected], item.total);
  }

  busy = true;
  E.run.disabled = true;
  E.clear.disabled = true;
  E.progressWrap.hidden = false;
  setStatus(E.progressText, modo === 'seleccion' ? 'Uniendo las páginas…' : `Dividiendo en ${plan.length} archivo(s)…`);
  setStatus(E.status, 'Procesando en tu navegador…');

  try {
    const base = sanitizeBaseName(baseNameOf(item.name), 'PDF');
    let salidas: Uint8Array[];
    let nombres: string[];
    if (modo === 'seleccion') {
      salidas = [await unirPaginas(item.doc, [...selected])];
      nombres = [`${base} - páginas seleccionadas`];
    } else {
      const digitos = String(item.total).length;
      salidas = await dividirPdf(item.doc, plan);
      nombres = dedupeBaseNames(plan.map((intervalo) => `${base} - ${etiquetaIntervalo(intervalo, digitos)}`));
    }
    renderResults(salidas, nombres);
    setStatus(E.status, `Listo: ${salidas.length} archivo(s) generado(s).`);
  } catch (error) {
    showError(E.error, error instanceof Error ? error.message : 'No se pudo dividir el PDF.');
    setStatus(E.status, 'La división no terminó. No se generó ningún archivo.');
  } finally {
    busy = false;
    E.progressWrap.hidden = true;
    E.clear.disabled = false;
    E.run.disabled = !loaded || (modoActual() !== 'intervalos' && selected.size === 0);
  }
}

/** Un solo archivo se descarga directo; varios se entregan en un ZIP sin compresión. */
function renderResults(salidas: Uint8Array[], nombres: string[]): void {
  E.results.replaceChildren();
  const heading = document.createElement('h3');
  heading.className = 'field-label';
  heading.textContent = 'Resultado';

  const card = document.createElement('article');
  card.className = 'img-result';
  const title = document.createElement('p');
  title.className = 'img-result__title';
  title.textContent = `✔ ${salidas.length} PDF generado(s)`;
  card.append(title);

  const actions = document.createElement('div');
  actions.className = 'img-result__final rec-actions';
  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'btn btn--primary';

  if (salidas.length === 1) {
    download.textContent = 'Descargar PDF';
    download.addEventListener('click', () =>
      descargarBlob(new Blob([salidas[0] as BlobPart], { type: 'application/pdf' }), `${nombres[0]}.pdf`),
    );
  } else {
    download.textContent = `Descargar ZIP (${salidas.length} PDF)`;
    download.addEventListener('click', () => {
      const zip = buildZipStore(salidas.map((data, i) => ({ name: `${nombres[i]}.pdf`, data })));
      const base = sanitizeBaseName(baseNameOf(loaded?.name ?? 'PDF'), 'PDF');
      descargarBlob(new Blob([zip as BlobPart], { type: 'application/zip' }), `${base} - divididos.zip`);
    });
  }
  actions.append(download);

  const notes = document.createElement('ul');
  notes.className = 'tool-req__list ofi-notes';
  const li = document.createElement('li');
  li.textContent = `Archivos: ${nombres.join(' · ')}`;
  notes.append(li);

  E.results.append(heading, card, notes, actions);
  E.results.hidden = false;
}

function descargarBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  triggerDownload(url, sanitizeDownloadName(filename));
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

function sanitizeDownloadName(filename: string): string {
  const ext = /\.[a-z]+$/i.exec(filename)?.[0] ?? '';
  const base = sanitizeBaseName(filename.slice(0, filename.length - ext.length), 'PDF');
  return `${base}${ext.toLowerCase()}`;
}

function reset(): void {
  if (busy) return;
  resetResults();
  closePreview();
  loaded = null;
  selected = new Set();
  E.grid.replaceChildren();
  E.gridWrap.hidden = true;
  E.file.value = '';
  E.info.hidden = true;
  E.run.disabled = true;
  clearError(E.error);
  setStatus(E.status, '');
}

function renderRequirements(): void {
  const lines = [
    'Formato: .pdf (PDF sin contraseña).',
    `Peso permitido: hasta ${formatBytes(DIVIDIR_LIMITS.maxBytes)}.`,
    `Páginas permitidas: hasta ${DIVIDIR_LIMITS.maxPaginas}.`,
    'El archivo original nunca se modifica ni se sube a ningún servidor.',
  ];
  E.requirements.replaceChildren(
    ...lines.map((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      return li;
    }),
  );
}

function init(): void {
  renderRequirements();
  updateModo();

  E.file.addEventListener('change', () => {
    const file = E.file.files?.[0];
    if (file) void selectFile(file);
  });
  E.modoPaginas.addEventListener('change', updateModo);
  E.modoIntervalos.addEventListener('change', updateModo);
  E.modoSeleccion.addEventListener('change', updateModo);
  E.selectAll.addEventListener('click', () => setAllSelected(true));
  E.selectNone.addEventListener('click', () => setAllSelected(false));
  E.selectInvert.addEventListener('click', invertSelected);
  E.zoomPrev.addEventListener('click', () => void openZoom(zoomPage - 1));
  E.zoomNext.addEventListener('click', () => void openZoom(zoomPage + 1));
  E.zoomClose.addEventListener('click', () => E.zoom.close());
  E.run.addEventListener('click', () => void dividir());
  E.clear.addEventListener('click', reset);

  E.dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    E.dropzone.classList.add('is-dragover');
  });
  E.dropzone.addEventListener('dragleave', () => E.dropzone.classList.remove('is-dragover'));
  E.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    E.dropzone.classList.remove('is-dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) void selectFile(file);
  });
}

init();
