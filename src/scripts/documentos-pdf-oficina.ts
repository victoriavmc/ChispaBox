/*
 * Pestañas «Word», «Excel» y «PowerPoint»: la conversión la hace LibreOffice en el servidor
 * local de esta aplicación (`npm run dev` / `npm run preview`). El navegador NO convierte
 * estos documentos. En una compilación estática sin servidor, la herramienta queda deshabilitada.
 */
import { DOCUMENTOS_LIMITS, OFFICE_FORMATS, type OfficeFormat } from '../shared/documentos-limits.ts';
import { formatBytes } from '../shared/image-limits.ts';
import { baseNameOf, sanitizeBaseName, withPdfExtension } from '../shared/nombres-archivo.ts';
import { countPdfPages, createPdfViewer, type PdfViewer } from '../lib/pdf-viewer.ts';
import { clearError, requireEl, setStatus, showError, triggerDownload } from '../lib/ui-common.ts';

export type OfficeKind = 'word' | 'excel' | 'powerpoint';

const API = '/api/documentos-pdf';
const KIND_FORMATS: Record<OfficeKind, OfficeFormat[]> = {
  word: ['docx', 'doc'],
  excel: ['xlsx', 'xls'],
  powerpoint: ['pptx', 'ppt'],
};
const KIND_LABEL: Record<OfficeKind, string> = {
  word: 'Word',
  excel: 'Excel',
  powerpoint: 'PowerPoint',
};
const KIND_NOTE: Record<OfficeKind, string> = {
  word: 'Conversión básica: se conservan márgenes, tamaño de página, encabezados, pies, tablas, imágenes y saltos de página tal como los define el documento.',
  excel: 'Podés elegir orientación, papel y ajuste de ancho. Si no cambiás nada, se usa la configuración del libro. Las áreas de impresión configuradas se respetan.',
  powerpoint: 'Cada diapositiva se convierte en una página con su distribución, textos, imágenes, colores y formas. El PDF es un formato estático: animaciones, transiciones, audio y video no se incluyen.',
};

interface ServerStatus {
  habilitado: boolean;
  disponible: boolean;
  version: string | null;
  limites: { maxBytes: number; timeoutSeg: number; maxPaginas: number; maxSimultaneas: number };
}

interface Result {
  name: string;
  bytes: Uint8Array;
  url: string;
  pages: number;
  warnings: string[];
}

let kind: OfficeKind = 'word';
let status: ServerStatus | null = null;
let selected: File | null = null;
let selectedFormat: OfficeFormat | null = null;
let controller: AbortController | null = null;
let result: Result | null = null;
let timer: number | null = null;
let viewer: PdfViewer | null = null;

const E = {
  panel: requireEl<HTMLElement>('panel-oficina'),
  unavailable: requireEl<HTMLElement>('ofi-unavailable'),
  requirements: requireEl<HTMLElement>('ofi-requirements'),
  file: requireEl<HTMLInputElement>('ofi-file'),
  dropzone: requireEl<HTMLElement>('ofi-dropzone'),
  error: requireEl<HTMLElement>('ofi-error'),
  info: requireEl<HTMLElement>('ofi-info'),
  optionsWrap: requireEl<HTMLElement>('ofi-options'),
  orientation: requireEl<HTMLSelectElement>('ofi-orientation'),
  paper: requireEl<HTMLSelectElement>('ofi-paper'),
  fit: requireEl<HTMLSelectElement>('ofi-fit'),
  kindNote: requireEl<HTMLElement>('ofi-kind-note'),
  run: requireEl<HTMLButtonElement>('ofi-run'),
  cancel: requireEl<HTMLButtonElement>('ofi-cancel'),
  clear: requireEl<HTMLButtonElement>('ofi-clear'),
  progressWrap: requireEl<HTMLElement>('ofi-progress-wrap'),
  progressText: requireEl<HTMLElement>('ofi-progress-text'),
  status: requireEl<HTMLElement>('ofi-status'),
  results: requireEl<HTMLElement>('ofi-results'),
  viewer: requireEl<HTMLElement>('ofi-viewer'),
};

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot).toLowerCase() : '';
}

function formatForName(name: string): OfficeFormat | null {
  const ext = extensionOf(name).slice(1) as OfficeFormat;
  return ext in OFFICE_FORMATS ? ext : null;
}

function renderRequirements(): void {
  const formats = KIND_FORMATS[kind].map((f) => OFFICE_FORMATS[f].extension).join(', ');
  const maxBytes = status?.limites.maxBytes ?? DOCUMENTOS_LIMITS.officeMaxBytes;
  const lines = [
    `Formatos: ${formats}.`,
    `Peso permitido: desde 1 byte (no vacío) hasta ${formatBytes(maxBytes)}.`,
    `Tiempo máximo de conversión: ${status?.limites.timeoutSeg ?? DOCUMENTOS_LIMITS.officeTimeoutMs / 1000} segundos.`,
    `Páginas máximas del PDF: ${status?.limites.maxPaginas ?? DOCUMENTOS_LIMITS.officeMaxPages}.`,
    'Un archivo por conversión. Las macros no se ejecutan y los vínculos externos no se actualizan.',
    'Los archivos con contraseña no se pueden convertir.',
  ];
  E.requirements.replaceChildren(
    ...lines.map((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      return li;
    }),
  );
  E.file.accept = KIND_FORMATS[kind].map((f) => OFFICE_FORMATS[f].extension).join(',');
  E.kindNote.textContent = KIND_NOTE[kind];
  E.optionsWrap.hidden = kind !== 'excel';
}

/** Comprueba la firma real del archivo (no solo la extensión) antes de enviarlo. */
async function sniff(file: File): Promise<'zip' | 'ole' | 'other'> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return 'zip';
  if (head.length >= 8 && head[0] === 0xd0 && head[1] === 0xcf && head[2] === 0x11 && head[3] === 0xe0) return 'ole';
  return 'other';
}

async function selectFile(file: File): Promise<void> {
  clearError(E.error);
  resetResult();
  selected = null;
  selectedFormat = null;
  E.info.hidden = true;
  E.run.disabled = true;

  const format = formatForName(file.name);
  const maxBytes = status?.limites.maxBytes ?? DOCUMENTOS_LIMITS.officeMaxBytes;
  if (file.size < 1) return showError(E.error, 'El archivo está vacío (0 bytes). Elegí otro.');
  if (file.size > maxBytes) {
    return showError(E.error, `El archivo pesa ${formatBytes(file.size)} y supera el máximo de ${formatBytes(maxBytes)}.`);
  }
  if (!format) {
    return showError(E.error, 'Formato no admitido. Usá .docx, .doc, .xlsx, .xls, .pptx o .ppt.');
  }
  if (!KIND_FORMATS[kind].includes(format)) {
    const other = (Object.keys(KIND_FORMATS) as OfficeKind[]).find((k) => KIND_FORMATS[k].includes(format));
    return showError(
      E.error,
      `Este archivo es ${OFFICE_FORMATS[format].label}. Cambiá a la pestaña ${other ? KIND_LABEL[other] : 'correspondiente'} para convertirlo.`,
    );
  }
  const expected = OFFICE_FORMATS[format].family === 'ooxml' ? 'zip' : 'ole';
  const signature = await sniff(file);
  if (signature !== expected) {
    return showError(E.error, `El contenido no corresponde a ${OFFICE_FORMATS[format].label}: la firma del archivo no coincide con su extensión.`);
  }

  selected = file;
  selectedFormat = format;
  const rows: Array<[string, string]> = [
    ['Nombre', file.name],
    ['Extensión', OFFICE_FORMATS[format].extension],
    ['Peso', formatBytes(file.size)],
    ['Tipo de archivo detectado', OFFICE_FORMATS[format].label],
    ['Validación', 'Firma y extensión correctas (la estructura se revisa al convertir)'],
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
  E.run.disabled = !status?.disponible;
}

function resetResult(): void {
  if (result) URL.revokeObjectURL(result.url);
  result = null;
  E.results.replaceChildren();
  E.results.hidden = true;
  viewer?.clear();
}

function startTimer(): void {
  const started = Date.now();
  const tick = () => setStatus(E.progressText, `Convirtiendo con LibreOffice… ${Math.round((Date.now() - started) / 1000)} s`);
  tick();
  timer = window.setInterval(tick, 1000);
}

function stopTimer(): void {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
}

async function convert(): Promise<void> {
  if (!selected || !selectedFormat || controller) return;
  clearError(E.error);
  resetResult();
  const params = new URLSearchParams({ tipo: selectedFormat });
  if (kind === 'excel') {
    params.set('orientacion', E.orientation.value);
    params.set('papel', E.paper.value);
    params.set('ajuste', E.fit.value);
  }

  controller = new AbortController();
  E.run.disabled = true;
  E.cancel.hidden = false;
  E.clear.disabled = true;
  E.progressWrap.hidden = false;
  setStatus(E.status, 'Convirtiendo en el servidor local con LibreOffice…');
  startTimer();

  try {
    const response = await fetch(`${API}/convertir?${params.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: selected,
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      let message = 'No se pudo convertir el documento.';
      try {
        const body = (await response.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        // respuesta sin JSON: se usa el mensaje genérico
      }
      throw new Error(message);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const pages = await countPdfPages(bytes);
    const expected = Number(response.headers.get('X-Paginas'));
    if (pages < 1 || (Number.isFinite(expected) && expected !== pages)) {
      throw new Error('El PDF generado no superó la verificación. No se entrega.');
    }
    const warnings: string[] = [];
    if (response.headers.get('X-Macros-Detectadas') === 'si') {
      warnings.push('El documento contiene macros. No se ejecutaron.');
    }
    if (response.headers.get('X-Vinculos-Externos') === 'si') {
      warnings.push('El documento tiene vínculos externos. No se actualizaron: el PDF muestra los valores guardados en el archivo.');
    }
    const hidden = Number(response.headers.get('X-Hojas-Ocultas') ?? 0);
    if (hidden > 0) warnings.push(`El libro tiene ${hidden} hoja(s) oculta(s). LibreOffice no las exporta: el PDF incluye solo las hojas visibles.`);

    result = {
      name: sanitizeBaseName(baseNameOf(selected.name), 'Documento'),
      bytes,
      url: URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' })),
      pages,
      warnings,
    };
    renderResult(result);
    setStatus(E.status, 'Conversión terminada y verificada.');
    void showViewer(result);
  } catch (error) {
    if (controller?.signal.aborted) {
      setStatus(E.status, 'Conversión cancelada. No se generó ningún archivo.');
    } else {
      const message =
        error instanceof TypeError
          ? 'No se pudo conectar con el servidor de conversión. Verificá que la aplicación esté en ejecución.'
          : error instanceof Error
            ? error.message
            : 'No se pudo completar la conversión.';
      showError(E.error, message);
      setStatus(E.status, 'La conversión no terminó.');
    }
  } finally {
    stopTimer();
    controller = null;
    E.cancel.hidden = true;
    E.clear.disabled = false;
    E.progressWrap.hidden = true;
    E.run.disabled = !selected || !status?.disponible;
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

/** Resultado: estadísticas, nombre editable, avisos, vista previa y, al final, la descarga. */
function renderResult(r: Result): void {
  E.results.replaceChildren();
  const heading = document.createElement('h3');
  heading.className = 'field-label';
  heading.textContent = 'Resultado';

  const card = document.createElement('article');
  card.className = 'img-result';
  const head = document.createElement('div');
  head.className = 'img-result__head';
  const title = document.createElement('p');
  title.className = 'img-result__title';
  title.textContent = '✔ PDF generado y verificado';
  head.append(title);

  const stats = document.createElement('div');
  stats.className = 'img-stats';
  stats.append(
    statTile('Páginas', String(r.pages)),
    statTile('Peso final', formatBytes(r.bytes.length)),
    statTile('Verificación', 'Abierto y comprobado'),
  );

  const nameId = 'ofi-result-name';
  const nameLabel = document.createElement('label');
  nameLabel.className = 'img-result__label';
  nameLabel.htmlFor = nameId;
  nameLabel.textContent = 'Nombre para cambiar (sin .pdf)';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.id = nameId;
  nameInput.className = 'img-result__name';
  nameInput.value = r.name;
  nameInput.maxLength = 140;

  card.append(head, stats, nameLabel, nameInput);

  const notes = document.createElement('ul');
  notes.className = 'tool-req__list ofi-notes';
  const generalNote = document.createElement('li');
  generalNote.textContent =
    'El PDF es una copia de diseño fijo. Si el documento usa fuentes que no están instaladas en el servidor, pueden verse diferencias.';
  notes.append(generalNote);
  for (const warning of r.warnings) {
    const li = document.createElement('li');
    li.textContent = warning;
    notes.append(li);
  }

  // La vista previa va después de la información y antes de la descarga.
  E.results.append(heading, card, notes, E.viewer);

  const actions = document.createElement('div');
  actions.className = 'img-result__final rec-actions';
  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'btn btn--primary';
  download.textContent = 'Descargar PDF';
  download.addEventListener('click', () => {
    triggerDownload(r.url, withPdfExtension(sanitizeBaseName(nameInput.value, r.name)));
  });
  actions.append(download);
  E.results.append(actions);

  E.results.hidden = false;
}

async function showViewer(r: Result): Promise<void> {
  viewer ??= createPdfViewer(E.viewer);
  try {
    await viewer.show(r.bytes, withPdfExtension(r.name));
  } catch {
    showError(E.error, 'No se pudo mostrar la vista previa. Podés descargar el PDF igualmente.');
  }
}

function reset(): void {
  controller?.abort();
  resetResult();
  selected = null;
  selectedFormat = null;
  E.file.value = '';
  E.info.hidden = true;
  clearError(E.error);
  setStatus(E.status, '');
  E.run.disabled = true;
}

/** Cambia el tipo de documento (pestaña). Limpia la selección anterior. */
export function setOfficeKind(next: OfficeKind): void {
  if (next === kind) return;
  kind = next;
  reset();
  renderRequirements();
}

async function loadStatus(): Promise<void> {
  try {
    const response = await fetch(`${API}/estado`, { cache: 'no-store' });
    if (!response.ok) throw new Error('estado no disponible');
    status = (await response.json()) as ServerStatus;
  } catch {
    status = null;
  }
  const available = status?.habilitado && status.disponible;
  E.unavailable.hidden = Boolean(available);
  E.panel.classList.toggle('is-unavailable', !available);
  E.file.disabled = !available;
  E.dropzone.classList.toggle('is-disabled', !available);
  if (!available) {
    E.unavailable.textContent =
      'La conversión de Office no está disponible aquí. Necesita el servidor de esta aplicación con LibreOffice instalado (npm run dev o npm run preview). En una publicación estática no hay conversión de Word, Excel ni PowerPoint.';
  }
  renderRequirements();
}

export function initOficina(): void {
  void loadStatus();

  E.file.addEventListener('change', () => {
    const file = E.file.files?.[0];
    if (file) void selectFile(file);
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
    if (file) void selectFile(file);
  });

  E.run.addEventListener('click', () => void convert());
  E.cancel.addEventListener('click', () => {
    setStatus(E.progressText, 'Cancelando…');
    controller?.abort();
  });
  E.clear.addEventListener('click', reset);
}
