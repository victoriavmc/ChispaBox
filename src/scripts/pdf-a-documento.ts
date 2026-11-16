/*
 * Página «PDF a documento»: el navegador valida el PDF y lo envía al servidor local de esta
 * aplicación (`npm run dev` / `npm run preview`), donde LibreOffice lo importa con Writer y lo
 * exporta al formato elegido. En una publicación estática sin servidor, la herramienta queda deshabilitada.
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import { formatBytes } from '../shared/image-limits.ts';
import { baseNameOf, sanitizeBaseName } from '../shared/nombres-archivo.ts';
import { clearError, requireEl, setStatus, showError, triggerDownload } from '../lib/ui-common.ts';

const API = '/api/documentos-pdf';

type Target = 'docx' | 'odt' | 'rtf';

const TARGETS: Record<Target, { label: string; extension: string; note: string }> = {
  docx: {
    label: 'Word (.docx)',
    extension: '.docx',
    note: 'Recomendado para editar en Word. El texto queda en párrafos y títulos que fluyen normalmente. No conserva el diseño exacto, las imágenes ni las tablas (las tablas quedan como líneas de texto).',
  },
  odt: {
    label: 'OpenDocument (.odt)',
    extension: '.odt',
    note: 'Para LibreOffice u otros programas que usan OpenDocument. Mismo resultado de texto que Word: párrafos y títulos, sin el diseño exacto del PDF.',
  },
  rtf: {
    label: 'RTF (.rtf)',
    extension: '.rtf',
    note: 'Texto con formato sencillo; abre en casi cualquier editor. Pierde más diseño que Word u OpenDocument.',
  },
};

interface ServerStatus {
  habilitado: boolean;
  disponible: boolean;
  limites: { maxBytes: number; timeoutSeg: number };
}

interface Result {
  name: string;
  bytes: Blob;
  target: Target;
}

let status: ServerStatus | null = null;
let selected: File | null = null;
let controller: AbortController | null = null;
let timer: number | null = null;
let result: Result | null = null;

const E = {
  panel: requireEl<HTMLElement>('panel-pdf-doc'),
  unavailable: requireEl<HTMLElement>('pdfdoc-unavailable'),
  requirements: requireEl<HTMLElement>('pdfdoc-requirements'),
  file: requireEl<HTMLInputElement>('pdfdoc-file'),
  dropzone: requireEl<HTMLElement>('pdfdoc-dropzone'),
  error: requireEl<HTMLElement>('pdfdoc-error'),
  info: requireEl<HTMLElement>('pdfdoc-info'),
  target: requireEl<HTMLSelectElement>('pdfdoc-target'),
  targetNote: requireEl<HTMLElement>('pdfdoc-target-note'),
  run: requireEl<HTMLButtonElement>('pdfdoc-run'),
  cancel: requireEl<HTMLButtonElement>('pdfdoc-cancel'),
  clear: requireEl<HTMLButtonElement>('pdfdoc-clear'),
  progressWrap: requireEl<HTMLElement>('pdfdoc-progress-wrap'),
  progressText: requireEl<HTMLElement>('pdfdoc-progress-text'),
  status: requireEl<HTMLElement>('pdfdoc-status'),
  results: requireEl<HTMLElement>('pdfdoc-results'),
};

function currentTarget(): Target {
  return E.target.value as Target;
}

/** Comprueba la firma «%PDF-» de los primeros bytes (no solo la extensión). */
async function isPdf(file: File): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  return head.length === 5 && head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46 && head[4] === 0x2d;
}

function resetResult(): void {
  result = null;
  E.results.replaceChildren();
  E.results.hidden = true;
}

async function selectFile(file: File): Promise<void> {
  clearError(E.error);
  resetResult();
  selected = null;
  E.info.hidden = true;
  E.run.disabled = true;

  const maxBytes = status?.limites.maxBytes ?? 30 * 1024 * 1024;
  if (!/\.pdf$/i.test(file.name)) return showError(E.error, 'Formato no admitido. Elegí un archivo .pdf.');
  if (file.size < 1) return showError(E.error, 'El archivo está vacío (0 bytes). Elegí otro.');
  if (file.size > maxBytes) {
    return showError(E.error, `El archivo pesa ${formatBytes(file.size)} y supera el máximo de ${formatBytes(maxBytes)}.`);
  }
  if (!(await isPdf(file))) return showError(E.error, 'El contenido no es un PDF: la firma del archivo no coincide con su extensión.');

  selected = file;
  const rows: Array<[string, string]> = [
    ['Nombre', file.name],
    ['Peso', formatBytes(file.size)],
    ['Tipo de archivo detectado', 'PDF'],
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

function startTimer(): void {
  const started = Date.now();
  const tick = () => setStatus(E.progressText, `Convirtiendo… ${Math.round((Date.now() - started) / 1000)} s`);
  tick();
  timer = window.setInterval(tick, 1000);
}

function stopTimer(): void {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
}

async function convert(): Promise<void> {
  if (!selected || controller) return;
  clearError(E.error);
  resetResult();
  const target = currentTarget();

  controller = new AbortController();
  E.run.disabled = true;
  E.cancel.hidden = false;
  E.clear.disabled = true;
  E.progressWrap.hidden = false;
  setStatus(E.status, 'Convirtiendo el PDF en el servidor local…');
  startTimer();

  try {
    const params = new URLSearchParams({ tipo: target });
    const response = await fetch(`${API}/pdf-a-documento?${params.toString()}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: selected,
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) {
      let message = 'No se pudo convertir el PDF.';
      try {
        const body = (await response.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {
        // respuesta sin JSON: se usa el mensaje genérico
      }
      throw new Error(message);
    }
    const blob = await response.blob();
    if (blob.size < 64) throw new Error('El documento generado no superó la verificación. No se entrega.');

    result = {
      name: sanitizeBaseName(baseNameOf(selected.name), 'Documento'),
      bytes: blob,
      target,
    };
    renderResult(result);
    setStatus(E.status, 'Conversión terminada.');
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

/** Resultado: nombre editable antes de descargar, y el botón de descarga. */
function renderResult(r: Result): void {
  E.results.replaceChildren();
  const heading = document.createElement('h3');
  heading.className = 'field-label';
  heading.textContent = 'Resultado';

  const card = document.createElement('article');
  card.className = 'img-result';
  const title = document.createElement('p');
  title.className = 'img-result__title';
  title.textContent = `✔ ${TARGETS[r.target].label} generado`;

  const nameId = 'pdfdoc-result-name';
  const nameLabel = document.createElement('label');
  nameLabel.className = 'img-result__label';
  nameLabel.htmlFor = nameId;
  nameLabel.textContent = 'Nombre para cambiar (sin extensión)';
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.id = nameId;
  nameInput.className = 'img-result__name';
  nameInput.value = r.name;
  nameInput.maxLength = 140;

  card.append(title, nameLabel, nameInput);

  const notes = document.createElement('ul');
  notes.className = 'tool-req__list ofi-notes';
  for (const text of [
    'La conversión extrae el texto: el resultado no conserva el diseño, las imágenes ni las columnas del PDF original.',
    'Un PDF escaneado (fotos de páginas) no tiene texto seleccionable y no se puede convertir.',
  ]) {
    const li = document.createElement('li');
    li.textContent = text;
    notes.append(li);
  }

  const actions = document.createElement('div');
  actions.className = 'img-result__final rec-actions';
  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'btn btn--primary';
  download.textContent = `Descargar ${TARGETS[r.target].extension}`;
  download.addEventListener('click', () => {
    const base = sanitizeBaseName(nameInput.value, r.name);
    const url = URL.createObjectURL(r.bytes);
    triggerDownload(url, `${base}${TARGETS[r.target].extension}`);
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });
  actions.append(download);

  E.results.append(heading, card, notes, actions);
  E.results.hidden = false;
}

function reset(): void {
  controller?.abort();
  resetResult();
  selected = null;
  E.file.value = '';
  E.info.hidden = true;
  clearError(E.error);
  setStatus(E.status, '');
  E.run.disabled = true;
}

function renderRequirements(): void {
  const maxBytes = status?.limites.maxBytes ?? 30 * 1024 * 1024;
  const timeout = status?.limites.timeoutSeg ?? 120;
  const lines = [
    'Formato: .pdf (PDF con texto). Los PDF protegidos con contraseña no se pueden convertir.',
    `Peso permitido: desde 1 byte (no vacío) hasta ${formatBytes(maxBytes)}.`,
    `Tiempo máximo de conversión: ${timeout} segundos.`,
    'Un archivo por conversión. El original nunca se modifica.',
  ];
  E.requirements.replaceChildren(
    ...lines.map((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      return li;
    }),
  );
}

function renderTargetNote(): void {
  E.targetNote.textContent = TARGETS[currentTarget()].note;
}

async function loadStatus(): Promise<void> {
  try {
    const response = await fetch(`${API}/estado`, { cache: 'no-store' });
    if (!response.ok) throw new Error('estado no disponible');
    status = (await response.json()) as ServerStatus;
  } catch {
    status = null;
  }
  const available = Boolean(status?.habilitado && status.disponible);
  E.unavailable.hidden = available;
  E.panel.classList.toggle('is-unavailable', !available);
  E.file.disabled = !available;
  E.dropzone.classList.toggle('is-disabled', !available);
  if (!available) {
    E.unavailable.textContent =
      'Esta conversión no está disponible aquí. Necesita el servidor de esta aplicación con LibreOffice instalado (npm run dev o npm run preview). En una publicación estática no hay conversión de PDF a documento.';
  }
  renderRequirements();
}

function init(): void {
  for (const key of Object.keys(TARGETS) as Target[]) {
    const option = document.createElement('option');
    option.value = key;
    option.textContent = TARGETS[key].label;
    E.target.append(option);
  }
  E.target.value = 'docx';
  renderTargetNote();
  E.target.addEventListener('change', renderTargetNote);

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

init();
