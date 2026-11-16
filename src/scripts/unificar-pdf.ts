/*
 * Página «Unificar PDF»: se agregan varios PDF, se ordenan, se quitan los que sobran y se descarga
 * un único PDF con todas las páginas en ese orden. Todo ocurre en el navegador con pdf-lib.
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/unificar-pdf.css';
import { formatBytes } from '../shared/image-limits.ts';
import { sanitizeBaseName } from '../shared/nombres-archivo.ts';
import {
  UNIFICAR_LIMITS,
  esFirmaPdf,
  leerPaginas,
  unificarPdfs,
  validarLimites,
  validarLote,
} from '../shared/unificar-pdf.ts';
import { clearError, requireEl, setStatus, showError, triggerDownload } from '../lib/ui-common.ts';

interface Item {
  id: number;
  name: string;
  bytes: Uint8Array;
  size: number;
  paginas: number;
}

const E = {
  requirements: requireEl<HTMLElement>('unificar-requirements'),
  file: requireEl<HTMLInputElement>('unificar-file'),
  dropzone: requireEl<HTMLElement>('unificar-dropzone'),
  error: requireEl<HTMLElement>('unificar-error'),
  list: requireEl<HTMLOListElement>('unificar-list'),
  summary: requireEl<HTMLElement>('unificar-summary'),
  nameInput: requireEl<HTMLInputElement>('unificar-nombre'),
  run: requireEl<HTMLButtonElement>('unificar-run'),
  clear: requireEl<HTMLButtonElement>('unificar-clear'),
  progressWrap: requireEl<HTMLElement>('unificar-progress-wrap'),
  progressText: requireEl<HTMLElement>('unificar-progress-text'),
  status: requireEl<HTMLElement>('unificar-status'),
  results: requireEl<HTMLElement>('unificar-results'),
};

let items: Item[] = [];
let nextId = 1;
let busy = false;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo procesar el archivo.';
}

function resetResults(): void {
  E.results.replaceChildren();
  E.results.hidden = true;
}

/** Lee un archivo, valida firma, peso y que sea PDF utilizable, y lo agrega al final de la lista. */
async function addFiles(files: File[]): Promise<void> {
  clearError(E.error);
  resetResults();
  const errores: string[] = [];

  for (const file of files) {
    if (!/\.pdf$/i.test(file.name)) {
      errores.push(`«${file.name}»: formato no admitido, solo .pdf.`);
      continue;
    }
    if (file.size < 1) {
      errores.push(`«${file.name}»: está vacío.`);
      continue;
    }
    if (file.size > UNIFICAR_LIMITS.maxBytesArchivo) {
      errores.push(`«${file.name}»: pesa ${formatBytes(file.size)} y supera el máximo de ${formatBytes(UNIFICAR_LIMITS.maxBytesArchivo)}.`);
      continue;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (!esFirmaPdf(bytes)) {
        errores.push(`«${file.name}»: el contenido no es un PDF.`);
        continue;
      }
      const paginas = await leerPaginas(bytes);
      const candidatos = [...items, { id: 0, name: file.name, bytes, size: file.size, paginas }];
      const problema = validarLimites(candidatos.map((c) => ({ bytes: c.size, paginas: c.paginas })));
      if (problema) {
        errores.push(`«${file.name}»: ${problema}`);
        continue;
      }
      items.push({ id: nextId++, name: file.name, bytes, size: file.size, paginas });
    } catch (error) {
      errores.push(`«${file.name}»: ${describeError(error)}`);
    }
  }

  if (errores.length > 0) showError(E.error, errores.join(' '));
  render();
}

function move(id: number, delta: number): void {
  const index = items.findIndex((i) => i.id === id);
  const target = index + delta;
  if (index < 0 || target < 0 || target >= items.length) return;
  const [moved] = items.splice(index, 1);
  if (moved) items.splice(target, 0, moved);
  resetResults();
  render();
}

function remove(id: number): void {
  items = items.filter((i) => i.id !== id);
  resetResults();
  clearError(E.error);
  render();
}

function render(): void {
  E.list.replaceChildren();
  items.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'unificar-item';

    const order = document.createElement('span');
    order.className = 'unificar-item__order';
    order.textContent = String(index + 1);

    const meta = document.createElement('div');
    meta.className = 'unificar-item__meta';
    const name = document.createElement('span');
    name.className = 'unificar-item__name';
    name.textContent = item.name;
    const info = document.createElement('span');
    info.className = 'unificar-item__info';
    info.textContent = `${item.paginas} página(s) · ${formatBytes(item.size)}`;
    meta.append(name, info);

    const actions = document.createElement('div');
    actions.className = 'unificar-item__actions';
    const up = button('Subir', `Subir «${item.name}»`, index === 0, () => move(item.id, -1));
    const down = button('Bajar', `Bajar «${item.name}»`, index === items.length - 1, () => move(item.id, 1));
    const del = button('Quitar', `Quitar «${item.name}»`, false, () => remove(item.id));
    actions.append(up, down, del);

    li.append(order, meta, actions);
    E.list.append(li);
  });

  const totalPaginas = items.reduce((sum, i) => sum + i.paginas, 0);
  E.summary.textContent =
    items.length === 0
      ? 'Todavía no agregaste PDF.'
      : `${items.length} archivo(s), ${totalPaginas} página(s) en total. El orden de esta lista es el orden del resultado.`;
  E.run.disabled = busy || items.length < 2;
  E.clear.disabled = busy || items.length === 0;
  E.list.hidden = items.length === 0;
}

function button(label: string, aria: string, disabled: boolean, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn--ghost unificar-item__btn';
  b.textContent = label;
  b.setAttribute('aria-label', aria);
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

async function unificar(): Promise<void> {
  if (busy) return;
  clearError(E.error);
  resetResults();
  const problema = validarLote(items.map((i) => ({ bytes: i.size, paginas: i.paginas })));
  if (problema) {
    showError(E.error, problema);
    return;
  }

  busy = true;
  render();
  E.progressWrap.hidden = false;
  setStatus(E.progressText, 'Uniendo los PDF…');
  setStatus(E.status, 'Procesando en tu navegador…');

  try {
    const { bytes, paginas } = await unificarPdfs(items.map((i) => i.bytes));
    const base = sanitizeBaseName(E.nameInput.value.trim() || 'PDF unificado', 'PDF unificado');
    renderResult(bytes, base, paginas);
    setStatus(E.status, `Listo: ${paginas} página(s) unidas en un PDF.`);
  } catch (error) {
    showError(E.error, describeError(error));
    setStatus(E.status, 'La unión no terminó. No se generó ningún archivo.');
  } finally {
    busy = false;
    E.progressWrap.hidden = true;
    render();
  }
}

function renderResult(bytes: Uint8Array, base: string, paginas: number): void {
  E.results.replaceChildren();
  const heading = document.createElement('h3');
  heading.className = 'field-label';
  heading.textContent = 'Resultado';

  const card = document.createElement('article');
  card.className = 'img-result';
  const title = document.createElement('p');
  title.className = 'img-result__title';
  title.textContent = `✔ PDF unificado: ${paginas} página(s), ${formatBytes(bytes.length)}`;
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

function reset(): void {
  if (busy) return;
  items = [];
  resetResults();
  clearError(E.error);
  E.file.value = '';
  setStatus(E.status, '');
  render();
}

function renderRequirements(): void {
  const lines = [
    'Formato: .pdf sin contraseña. Mínimo 2 archivos.',
    `Hasta ${UNIFICAR_LIMITS.maxArchivos} archivos; ${formatBytes(UNIFICAR_LIMITS.maxBytesArchivo)} cada uno y ${formatBytes(UNIFICAR_LIMITS.maxBytesTotal)} en total.`,
    `Hasta ${UNIFICAR_LIMITS.maxPaginasTotal} páginas en el resultado.`,
    'Los archivos originales nunca se modifican ni se suben a ningún servidor.',
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
    const files = Array.from(E.file.files ?? []);
    E.file.value = '';
    if (files.length > 0) void addFiles(files);
  });
  E.dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    E.dropzone.classList.add('is-dragover');
  });
  E.dropzone.addEventListener('dragleave', () => E.dropzone.classList.remove('is-dragover'));
  E.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    E.dropzone.classList.remove('is-dragover');
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length > 0) void addFiles(files);
  });
  E.run.addEventListener('click', () => void unificar());
  E.clear.addEventListener('click', reset);
  E.nameInput.value = 'PDF unificado';
}

init();
