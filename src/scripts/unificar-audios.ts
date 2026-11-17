/*
 * Página «Unificar audios»: se agregan grabaciones, se ordenan y se descarga un solo archivo
 * (MP3 o WAV). Todo ocurre en el navegador: decodificación, unión y codificación.
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/unificar-pdf.css';
import { formatBytes } from '../shared/image-limits.ts';
import { sanitizeBaseName } from '../shared/nombres-archivo.ts';
import {
  UNIFICAR_AUDIO_LIMITS,
  canalesDelResultado,
  posicionesInicio,
  validarListaAudio,
} from '../shared/unificar-audios.ts';
import { decodeRecording, encodeMp3, encodeWav } from '../lib/audio-export.ts';
import { unirAudios } from '../lib/unir-audio.ts';
import { clearError, requireEl, setStatus, showError, triggerDownload } from '../lib/ui-common.ts';

interface Item {
  id: number;
  name: string;
  bytes: number;
  buffer: AudioBuffer;
}

const E = {
  requirements: requireEl<HTMLElement>('ua-requirements'),
  file: requireEl<HTMLInputElement>('ua-file'),
  dropzone: requireEl<HTMLElement>('ua-dropzone'),
  error: requireEl<HTMLElement>('ua-error'),
  summary: requireEl<HTMLElement>('ua-summary'),
  list: requireEl<HTMLOListElement>('ua-list'),
  formatoMp3: requireEl<HTMLInputElement>('ua-formato-mp3'),
  nameInput: requireEl<HTMLInputElement>('ua-nombre'),
  run: requireEl<HTMLButtonElement>('ua-run'),
  clear: requireEl<HTMLButtonElement>('ua-clear'),
  progressWrap: requireEl<HTMLElement>('ua-progress-wrap'),
  progressText: requireEl<HTMLElement>('ua-progress-text'),
  status: requireEl<HTMLElement>('ua-status'),
  results: requireEl<HTMLElement>('ua-results'),
};

let items: Item[] = [];
let nextId = 1;
let busy = false;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo procesar el audio.';
}

function resetResults(): void {
  E.results.replaceChildren();
  E.results.hidden = true;
}

function duracionTotal(): number {
  return items.reduce((sum, i) => sum + i.buffer.duration, 0);
}

/** Decodifica cada archivo y lo agrega al final. Los que no se pueden leer se informan sin frenar el resto. */
async function agregar(files: File[]): Promise<void> {
  clearError(E.error);
  resetResults();
  const errores: string[] = [];
  for (const file of files) {
    if (!file.type.startsWith('audio/') && !/\.(mp3|wav|ogg|m4a|aac|flac|webm|opus)$/i.test(file.name)) {
      errores.push(`«${file.name}»: no es un archivo de audio.`);
      continue;
    }
    if (file.size < 1) {
      errores.push(`«${file.name}»: está vacío.`);
      continue;
    }
    if (file.size > UNIFICAR_AUDIO_LIMITS.maxBytesArchivo) {
      errores.push(`«${file.name}»: pesa ${formatBytes(file.size)} y supera el máximo de ${formatBytes(UNIFICAR_AUDIO_LIMITS.maxBytesArchivo)}.`);
      continue;
    }
    setStatus(E.status, `Leyendo «${file.name}»…`);
    try {
      const buffer = await decodeRecording(file);
      const candidatos = [...items.map((i) => ({ bytes: i.bytes, segundos: i.buffer.duration })), { bytes: file.size, segundos: buffer.duration }];
      const problema = validarListaAudio(candidatos);
      if (problema && !problema.startsWith('Agregá')) {
        errores.push(`«${file.name}»: ${problema}`);
        continue;
      }
      items.push({ id: nextId++, name: file.name, bytes: file.size, buffer });
    } catch {
      errores.push(`«${file.name}»: el navegador no pudo leer este audio.`);
    }
  }
  setStatus(E.status, '');
  if (errores.length > 0) showError(E.error, errores.join(' '));
  if (items.length > 0 && !E.nameInput.value) E.nameInput.value = 'Audio unificado';
  render();
}

function mover(id: number, delta: -1 | 1): void {
  const i = items.findIndex((x) => x.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= items.length) return;
  const [item] = items.splice(i, 1);
  if (item) items.splice(j, 0, item);
  resetResults();
  render();
}

function quitar(id: number): void {
  items = items.filter((x) => x.id !== id);
  resetResults();
  clearError(E.error);
  render();
}

function boton(texto: string, aria: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn btn--ghost unificar-item__btn';
  b.textContent = texto;
  b.setAttribute('aria-label', aria);
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
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
    info.textContent = `${formatSegundos(item.buffer.duration)} · ${formatBytes(item.bytes)}`;
    meta.append(name, info);
    const actions = document.createElement('div');
    actions.className = 'unificar-item__actions';
    actions.append(
      boton('Subir', `Subir «${item.name}»`, () => mover(item.id, -1), index === 0),
      boton('Bajar', `Bajar «${item.name}»`, () => mover(item.id, 1), index === items.length - 1),
      boton('Quitar', `Quitar «${item.name}»`, () => quitar(item.id)),
    );
    li.append(order, meta, actions);
    E.list.append(li);
  });
  E.list.hidden = items.length === 0;
  E.summary.textContent =
    items.length === 0
      ? 'Todavía no agregaste audios.'
      : `${items.length} audio(s), ${formatSegundos(duracionTotal())} en total. El orden de la lista es el orden del archivo final.`;
  E.run.disabled = busy || items.length < 2;
  E.clear.disabled = busy || items.length === 0;
}

function formatSegundos(s: number): string {
  const total = Math.round(s);
  const m = Math.floor(total / 60);
  const r = String(total % 60).padStart(2, '0');
  return `${m}:${r}`;
}

async function unir(): Promise<void> {
  if (busy) return;
  clearError(E.error);
  resetResults();
  const problema = validarListaAudio(items.map((i) => ({ bytes: i.bytes, segundos: i.buffer.duration })));
  if (problema) return showError(E.error, problema);

  busy = true;
  render();
  E.progressWrap.hidden = false;
  setStatus(E.progressText, 'Uniendo los audios…');
  setStatus(E.status, 'Procesando en tu navegador…');
  try {
    const buffers = items.map((i) => i.buffer);
    const posiciones = posicionesInicio(buffers.map((b) => b.duration));
    const canales = canalesDelResultado(buffers.map((b) => b.numberOfChannels));
    const unido = await unirAudios(buffers, canales, posiciones);
    setStatus(E.progressText, 'Codificando…');
    const mp3 = E.formatoMp3.checked;
    const blob = mp3 ? await encodeMp3(unido) : encodeWav(unido);
    const base = sanitizeBaseName(E.nameInput.value.trim() || 'Audio unificado', 'Audio unificado');
    mostrarResultado(blob, `${base}.${mp3 ? 'mp3' : 'wav'}`, unido.duration);
    setStatus(E.status, `Listo: ${formatSegundos(unido.duration)} en un archivo ${mp3 ? 'MP3' : 'WAV'}.`);
  } catch (error) {
    showError(E.error, describeError(error));
    setStatus(E.status, 'La unión no terminó. No se generó ningún archivo.');
  } finally {
    busy = false;
    E.progressWrap.hidden = true;
    render();
  }
}

function mostrarResultado(blob: Blob, nombre: string, segundos: number): void {
  E.results.replaceChildren();
  const heading = document.createElement('h3');
  heading.className = 'field-label';
  heading.textContent = 'Resultado';
  const card = document.createElement('article');
  card.className = 'img-result';
  const title = document.createElement('p');
  title.className = 'img-result__title';
  title.textContent = `✔ ${nombre}: ${formatSegundos(segundos)} · ${formatBytes(blob.size)}`;
  const audio = document.createElement('audio');
  audio.controls = true;
  audio.preload = 'metadata';
  audio.src = URL.createObjectURL(blob);
  audio.setAttribute('aria-label', 'Escuchar el audio unificado');
  card.append(title, audio);

  const actions = document.createElement('div');
  actions.className = 'img-result__final rec-actions';
  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'btn btn--primary';
  download.textContent = 'Descargar audio';
  download.addEventListener('click', () => {
    const url = URL.createObjectURL(blob);
    triggerDownload(url, nombre);
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });
  actions.append(download);
  E.results.append(heading, card, actions);
  E.results.hidden = false;
}

function limpiar(): void {
  if (busy) return;
  items = [];
  resetResults();
  clearError(E.error);
  E.file.value = '';
  setStatus(E.status, '');
  render();
}

function init(): void {
  const lines = [
    'Formatos: MP3, WAV, OGG, M4A, AAC, FLAC y WebM (según lo que soporte tu navegador).',
    `Hasta ${UNIFICAR_AUDIO_LIMITS.maxArchivos} audios; ${Math.round(UNIFICAR_AUDIO_LIMITS.maxSegundos / 60)} minutos de duración total como máximo.`,
    'Los audios se procesan en tu navegador y no se suben a ningún servidor.',
  ];
  E.requirements.replaceChildren(
    ...lines.map((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      return li;
    }),
  );
  render();
  E.file.addEventListener('change', () => {
    const files = Array.from(E.file.files ?? []);
    E.file.value = '';
    if (files.length > 0) void agregar(files);
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
    if (files.length > 0) void agregar(files);
  });
  E.run.addEventListener('click', () => void unir());
  E.clear.addEventListener('click', limpiar);
}

init();
