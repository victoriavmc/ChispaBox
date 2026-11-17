/*
 * Página «Organizar páginas»: reordena, gira, quita y extrae páginas de un PDF.
 * Las miniaturas las dibuja PDF.js (ya incluido en el proyecto) y el PDF nuevo lo arma pdf-lib.
 * Todo ocurre en el navegador: el archivo no se sube a ningún servidor.
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/organizar-paginas.css';
import { formatBytes } from '../shared/image-limits.ts';
import { baseNameOf, sanitizeBaseName } from '../shared/nombres-archivo.ts';
import {
  ORGANIZAR_LIMITS,
  construirPdf,
  girar,
  leerPdfOrganizable,
  type Giro,
  type PaginaEditada,
} from '../shared/organizar-paginas.ts';
import { openPdf, type OpenedPdf } from '../lib/pdf-viewer.ts';
import { clearError, requireEl, setStatus, showError, triggerDownload } from '../lib/ui-common.ts';
import type { PDFDocument } from 'pdf-lib';

/** Una página de la lista de trabajo. */
interface Entrada {
  id: number;
  original: number;
  giro: Giro;
  extraer: boolean;
}

const E = {
  requirements: requireEl<HTMLElement>('org-requirements'),
  file: requireEl<HTMLInputElement>('org-file'),
  dropzone: requireEl<HTMLElement>('org-dropzone'),
  error: requireEl<HTMLElement>('org-error'),
  info: requireEl<HTMLElement>('org-info'),
  summary: requireEl<HTMLElement>('org-summary'),
  list: requireEl<HTMLOListElement>('org-list'),
  removedWrap: requireEl<HTMLElement>('org-removed-wrap'),
  removedList: requireEl<HTMLUListElement>('org-removed-list'),
  reset: requireEl<HTMLButtonElement>('org-reset'),
  nameInput: requireEl<HTMLInputElement>('org-nombre'),
  save: requireEl<HTMLButtonElement>('org-save'),
  extract: requireEl<HTMLButtonElement>('org-extract'),
  clear: requireEl<HTMLButtonElement>('org-clear'),
  progressWrap: requireEl<HTMLElement>('org-progress-wrap'),
  progressText: requireEl<HTMLElement>('org-progress-text'),
  status: requireEl<HTMLElement>('org-status'),
  results: requireEl<HTMLElement>('org-results'),
};

let pdf: PDFDocument | null = null;
let preview: OpenedPdf | null = null;
let fileBase = 'PDF';
let entradas: Entrada[] = [];
let quitadas: Entrada[] = [];
let nextId = 1;
let busy = false;
let observer: IntersectionObserver | null = null;
/** Miniaturas ya dibujadas, por página original y giro. Se reutilizan al reordenar. */
const cache = new Map<string, HTMLCanvasElement>();

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo procesar el archivo.';
}

function resetResults(): void {
  E.results.replaceChildren();
  E.results.hidden = true;
}

/* ---------- Miniaturas ---------- */

/** Dibuja la página original con el giro indicado (PDF.js aplica la rotación). */
async function pintar(canvas: HTMLCanvasElement, original: number, giro: Giro): Promise<void> {
  if (!preview) return;
  const page = await preview.doc.getPage(original);
  const rotation = (((page.rotate + giro) % 360) + 360) % 360;
  const width = 180;
  const base = page.getViewport({ scale: 1, rotation });
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const scale = (width / base.width) * dpr;
  const viewport = page.getViewport({ scale, rotation });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${width}px`;
  canvas.style.height = 'auto';
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  page.cleanup();
}

function miniatura(entrada: Entrada): HTMLCanvasElement {
  const key = `${entrada.original}:${entrada.giro}`;
  const existente = cache.get(key);
  if (existente) return existente;
  const canvas = document.createElement('canvas');
  canvas.className = 'org-item__canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.dataset.original = String(entrada.original);
  canvas.dataset.giro = String(entrada.giro);
  cache.set(key, canvas);
  observer?.observe(canvas);
  return canvas;
}

function crearObservador(): void {
  observer?.disconnect();
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const canvas = entry.target as HTMLCanvasElement;
        observer?.unobserve(canvas);
        const original = Number(canvas.dataset.original);
        const giro = Number(canvas.dataset.giro) as Giro;
        pintar(canvas, original, giro).catch((error) => {
          console.error(`Organizar páginas: no se dibujó la página ${original}`, error);
        });
      }
    },
    { rootMargin: '300px 0px' },
  );
}

/* ---------- Edición ---------- */

function indiceDe(id: number): number {
  return entradas.findIndex((e) => e.id === id);
}

function mover(id: number, delta: -1 | 1): void {
  const i = indiceDe(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= entradas.length) return;
  const [item] = entradas.splice(i, 1);
  if (item) entradas.splice(j, 0, item);
  resetResults();
  render();
}

function girarEntrada(id: number, delta: 90 | -90): void {
  const entrada = entradas.find((e) => e.id === id);
  if (!entrada) return;
  entrada.giro = girar(entrada.giro, delta);
  resetResults();
  render();
}

function quitar(id: number): void {
  const i = indiceDe(id);
  if (i < 0) return;
  const [item] = entradas.splice(i, 1);
  if (item) {
    item.extraer = false;
    quitadas.push(item);
  }
  resetResults();
  render();
}

function restaurar(id: number): void {
  const i = quitadas.findIndex((e) => e.id === id);
  if (i < 0) return;
  const [item] = quitadas.splice(i, 1);
  if (item) entradas.push(item);
  resetResults();
  render();
}

function restablecer(): void {
  if (!pdf) return;
  const total = pdf.getPageCount();
  entradas = Array.from({ length: total }, (_, i) => ({ id: nextId++, original: i + 1, giro: 0 as Giro, extraer: false }));
  quitadas = [];
  resetResults();
  render();
}

/* ---------- Render ---------- */

function boton(texto: string, aria: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn--ghost org-item__btn';
  b.textContent = texto;
  b.setAttribute('aria-label', aria);
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

function render(): void {
  E.list.replaceChildren();
  entradas.forEach((entrada, index) => {
    const li = document.createElement('li');
    li.className = 'org-item';

    const canvas = miniatura(entrada);
    const figure = document.createElement('div');
    figure.className = 'org-item__thumb';
    figure.append(canvas);

    const titulo = document.createElement('p');
    titulo.className = 'org-item__title';
    titulo.textContent = `Posición ${index + 1} · página ${entrada.original}${entrada.giro ? ` · giro ${entrada.giro}°` : ''}`;

    const extraer = document.createElement('label');
    extraer.className = 'org-item__extract';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = entrada.extraer;
    check.addEventListener('change', () => {
      entrada.extraer = check.checked;
      updateButtons();
    });
    const texto = document.createElement('span');
    texto.textContent = 'Extraer esta página';
    extraer.append(check, texto);

    const acciones = document.createElement('div');
    acciones.className = 'org-item__actions';
    const n = `${index + 1} (página ${entrada.original})`;
    acciones.append(
      boton('↑ Subir', `Subir la posición ${n}`, () => mover(entrada.id, -1), index === 0),
      boton('↓ Bajar', `Bajar la posición ${n}`, () => mover(entrada.id, 1), index === entradas.length - 1),
      boton('↺ Girar', `Girar a la izquierda la página ${entrada.original}`, () => girarEntrada(entrada.id, -90)),
      boton('↻ Girar', `Girar a la derecha la página ${entrada.original}`, () => girarEntrada(entrada.id, 90)),
      boton('Quitar', `Quitar la página ${entrada.original} del resultado`, () => quitar(entrada.id)),
    );

    li.append(figure, titulo, extraer, acciones);
    E.list.append(li);
  });

  E.removedList.replaceChildren();
  for (const entrada of quitadas) {
    const li = document.createElement('li');
    li.className = 'org-removed__item';
    const texto = document.createElement('span');
    texto.textContent = `Página ${entrada.original}`;
    li.append(
      texto,
      boton('Restaurar', `Restaurar la página ${entrada.original}`, () => restaurar(entrada.id)),
    );
    E.removedList.append(li);
  }
  E.removedWrap.hidden = quitadas.length === 0;

  E.summary.textContent = pdf
    ? `${entradas.length} página(s) en el resultado · ${quitadas.length} quitada(s) · original con ${pdf.getPageCount()} página(s).`
    : '';
  E.list.hidden = entradas.length === 0;
  E.reset.disabled = busy || !pdf;
  E.clear.disabled = busy || !pdf;
  updateButtons();
}

function updateButtons(): void {
  const hayPaginas = entradas.length > 0;
  const hayExtraidas = entradas.some((e) => e.extraer);
  E.save.disabled = busy || !hayPaginas;
  E.extract.disabled = busy || !hayExtraidas;
}

/* ---------- Carga y salida ---------- */

async function cargar(file: File): Promise<void> {
  clearError(E.error);
  resetResults();
  if (!/\.pdf$/i.test(file.name)) return showError(E.error, 'Formato no admitido. Elegí un archivo .pdf.');
  if (file.size < 1) return showError(E.error, 'El archivo está vacío (0 bytes). Elegí otro.');
  if (file.size > ORGANIZAR_LIMITS.maxBytes) {
    return showError(E.error, `El archivo pesa ${formatBytes(file.size)} y supera el máximo de ${formatBytes(ORGANIZAR_LIMITS.maxBytes)}.`);
  }

  setStatus(E.status, 'Leyendo el PDF…');
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { doc } = await leerPdfOrganizable(bytes);
    preview?.close().catch(() => undefined);
    preview = await openPdf(bytes);
    pdf = doc;
    fileBase = sanitizeBaseName(baseNameOf(file.name), 'PDF');
    E.nameInput.value = `${fileBase} - organizado`;
    cache.clear();
    crearObservador();
    restablecer();
    E.info.hidden = false;
    E.info.replaceChildren(
      ...[
        ['Nombre', file.name],
        ['Peso', formatBytes(file.size)],
        ['Páginas', String(doc.getPageCount())],
      ].flatMap(([label, value]) => {
        const dt = document.createElement('dt');
        dt.textContent = label ?? '';
        const dd = document.createElement('dd');
        dd.textContent = value ?? '';
        return [dt, dd];
      }),
    );
    setStatus(E.status, '');
  } catch (error) {
    setStatus(E.status, '');
    showError(E.error, describeError(error));
  }
}

async function generar(soloExtraidas: boolean): Promise<void> {
  if (!pdf || busy) return;
  clearError(E.error);
  resetResults();
  const seleccion = soloExtraidas ? entradas.filter((e) => e.extraer) : entradas;
  if (seleccion.length === 0) {
    showError(E.error, soloExtraidas ? 'Marcá al menos una página para extraer.' : 'No quedan páginas en el resultado.');
    return;
  }

  busy = true;
  render();
  E.progressWrap.hidden = false;
  setStatus(E.progressText, 'Armando el PDF…');
  setStatus(E.status, 'Procesando en tu navegador…');
  try {
    const paginas: PaginaEditada[] = seleccion.map((e) => ({ original: e.original, giro: e.giro }));
    const bytes = await construirPdf(pdf, paginas);
    const nombre = soloExtraidas
      ? `${fileBase} - extraídas`
      : sanitizeBaseName(E.nameInput.value.trim() || `${fileBase} - organizado`, `${fileBase} - organizado`);
    mostrarResultado(bytes, nombre, seleccion.length, soloExtraidas);
    setStatus(E.status, `Listo: ${seleccion.length} página(s).`);
  } catch (error) {
    showError(E.error, describeError(error));
    setStatus(E.status, 'No se generó el PDF.');
  } finally {
    busy = false;
    E.progressWrap.hidden = true;
    render();
  }
}

function mostrarResultado(bytes: Uint8Array, base: string, paginas: number, extraidas: boolean): void {
  E.results.replaceChildren();
  const heading = document.createElement('h3');
  heading.className = 'field-label';
  heading.textContent = 'Resultado';
  const card = document.createElement('article');
  card.className = 'img-result';
  const title = document.createElement('p');
  title.className = 'img-result__title';
  title.textContent = `✔ ${extraidas ? 'Páginas extraídas' : 'PDF organizado'}: ${paginas} página(s), ${formatBytes(bytes.length)}`;
  card.append(title);

  const actions = document.createElement('div');
  actions.className = 'img-result__final rec-actions';
  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'btn btn--primary';
  download.textContent = 'Descargar PDF';
  download.addEventListener('click', () => {
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, `${base}.pdf`);
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });
  actions.append(download);
  E.results.append(heading, card, actions);
  E.results.hidden = false;
}

function limpiar(): void {
  if (busy) return;
  preview?.close().catch(() => undefined);
  preview = null;
  pdf = null;
  entradas = [];
  quitadas = [];
  cache.clear();
  observer?.disconnect();
  observer = null;
  E.file.value = '';
  E.info.hidden = true;
  E.info.replaceChildren();
  resetResults();
  clearError(E.error);
  setStatus(E.status, '');
  render();
}

function renderRequirements(): void {
  const lines = [
    'Formato: .pdf sin contraseña.',
    `Peso permitido: hasta ${formatBytes(ORGANIZAR_LIMITS.maxBytes)}.`,
    `Páginas permitidas: hasta ${ORGANIZAR_LIMITS.maxPaginas}.`,
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
  render();
  E.file.addEventListener('change', () => {
    const file = E.file.files?.[0];
    if (file) void cargar(file);
  });
  E.dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    E.dropzone.classList.add('is-dragover');
  });
  E.dropzone.addEventListener('dragleave', () => E.dropzone.classList.remove('is-dragover'));
  E.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    E.dropzone.classList.remove('is-dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) void cargar(file);
  });
  E.reset.addEventListener('click', () => {
    resetResults();
    restablecer();
  });
  E.save.addEventListener('click', () => void generar(false));
  E.extract.addEventListener('click', () => void generar(true));
  E.clear.addEventListener('click', limpiar);
}

init();
