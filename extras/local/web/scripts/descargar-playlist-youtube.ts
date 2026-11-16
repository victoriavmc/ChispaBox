/*
 * Descarga de playlists y de varios videos: el usuario pega una lista o enlaces, elige los
 * videos y el formato, y se descarga un único ZIP con todos los archivos que se completaron.
 */
import '../../../../src/styles/grabar-audio.css';
import '../../../../src/styles/image-tools.css';
import '../styles/youtube.css';
import '../../../../src/styles/responsive.css';

import { AUDIO_BITRATE_STEPS, type AudioFormat, type BatchAnalysis, type BatchItem, type JobStatus, type VideoContainer } from '../shared/youtube-types';
import { requireEl, setStatus, showError, clearError } from '../../../../src/lib/ui-common';
import { sanitizeFileName, withExtension } from '../shared/youtube-names';
import {
  analyzeBatch,
  cancelJob,
  createBatchJob,
  downloadWithBrowser,
  formatDuration,
  getStatus,
  pickSaveTarget,
  watchJob,
  writeToTarget,
  YoutubeApiError,
  type JobWatcher,
  type SaveTarget,
} from '../lib/youtube-client';

const HEIGHTS = [2160, 1440, 1080, 720, 480, 360, 240, 144];

const textInput = requireEl<HTMLTextAreaElement>('pl-text');
const analyzeButton = requireEl<HTMLButtonElement>('pl-analyze');
const errorBox = requireEl<HTMLElement>('pl-error');
const statusBox = requireEl<HTMLElement>('pl-status');
const app = requireEl<HTMLElement>('yt-app');
const unavailable = requireEl<HTMLElement>('yt-unavailable');
const listPanel = requireEl<HTMLElement>('pl-list-panel');
const summary = requireEl<HTMLElement>('pl-summary');
const list = requireEl<HTMLUListElement>('pl-list');
const selectAll = requireEl<HTMLButtonElement>('pl-select-all');
const selectNone = requireEl<HTMLButtonElement>('pl-select-none');
const notes = requireEl<HTMLElement>('pl-notes');
const optionsPanel = requireEl<HTMLElement>('pl-options-panel');
const typeSelect = requireEl<HTMLSelectElement>('pl-type');
const videoWrap = requireEl<HTMLElement>('pl-video-wrap');
const containerSelect = requireEl<HTMLSelectElement>('pl-container');
const heightSelect = requireEl<HTMLSelectElement>('pl-height');
const audioWrap = requireEl<HTMLElement>('pl-audio-wrap');
const formatSelect = requireEl<HTMLSelectElement>('pl-format');
const bitrateWrap = requireEl<HTMLElement>('pl-bitrate-wrap');
const bitrateSelect = requireEl<HTMLSelectElement>('pl-bitrate');
const zipNameInput = requireEl<HTMLInputElement>('pl-zip-name');
const runPanel = requireEl<HTMLElement>('pl-run-panel');
const sizeLine = requireEl<HTMLElement>('pl-size');
const downloadButton = requireEl<HTMLButtonElement>('pl-download');
const cancelButton = requireEl<HTMLButtonElement>('pl-cancel');
const progressWrap = requireEl<HTMLElement>('pl-progress-wrap');
const progress = requireEl<HTMLProgressElement>('pl-progress');
const progressText = requireEl<HTMLElement>('pl-progress-text');

let analysis: BatchAnalysis | null = null;
const selected = new Set<string>();
let activeJob: { id: string; watcher: JobWatcher; target: SaveTarget | null } | null = null;

function setBusy(busy: boolean): void {
  analyzeButton.disabled = busy;
  textInput.disabled = busy;
  downloadButton.disabled = busy || selected.size === 0;
  cancelButton.hidden = !busy;
}

function renderList(): void {
  list.replaceChildren();
  for (const item of analysis?.items ?? []) {
    const li = document.createElement('li');
    li.className = 'yt-list__item';
    const label = document.createElement('label');
    label.className = 'yt-list__label';
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = selected.has(item.videoId);
    check.addEventListener('change', () => {
      if (check.checked) selected.add(item.videoId);
      else selected.delete(item.videoId);
      renderSummary();
    });
    const text = document.createElement('span');
    text.className = 'yt-list__text';
    const title = document.createElement('strong');
    title.textContent = item.titulo;
    const meta = document.createElement('small');
    meta.textContent = `${item.canal ?? 'Canal no informado'} · ${formatDuration(item.duracionSegundos)}`;
    text.append(title, meta);
    label.append(check, text);
    li.append(label);
    list.append(li);
  }
  renderSummary();
}

function renderSummary(): void {
  const total = analysis?.items.length ?? 0;
  summary.textContent = `${total} videos encontrados · ${selected.size} seleccionados.`;
  downloadButton.disabled = activeJob !== null || selected.size === 0;
}

function renderNotes(result: BatchAnalysis): void {
  notes.replaceChildren();
  const lines: string[] = [];
  if (result.omitidos > 0) lines.push(`Se omitieron ${result.omitidos} videos por superar el máximo por lote.`);
  lines.push(...result.errores);
  for (const line of lines) {
    const p = document.createElement('p');
    p.className = 'tool-note';
    p.textContent = line;
    notes.append(p);
  }
  notes.hidden = lines.length === 0;
}

function renderHeights(): void {
  heightSelect.replaceChildren();
  const any = document.createElement('option');
  any.value = '';
  any.textContent = 'La mejor disponible';
  heightSelect.append(any);
  for (const height of HEIGHTS) {
    const el = document.createElement('option');
    el.value = String(height);
    el.textContent = `Hasta ${height}p`;
    heightSelect.append(el);
  }
}

function renderBitrates(): void {
  bitrateSelect.replaceChildren();
  for (const kbps of AUDIO_BITRATE_STEPS) {
    const el = document.createElement('option');
    el.value = String(kbps);
    el.textContent = `Hasta ${kbps} kbps`;
    bitrateSelect.append(el);
  }
}

function updateKind(): void {
  const isVideo = typeSelect.value === 'video';
  videoWrap.hidden = !isVideo;
  audioWrap.hidden = isVideo;
  const format = formatSelect.value as AudioFormat;
  bitrateWrap.hidden = format === 'wav' || format === 'flac';
  sizeLine.textContent = isVideo
    ? 'Tamaño total: se conoce al terminar, porque depende de cada video.'
    : format === 'flac'
      ? 'FLAC no mejora el audio de origen: el tamaño total se conoce al terminar.'
      : 'Tamaño total: se conoce al terminar, porque depende de cada video.';
}

/** Mismo criterio que el servidor: «Playlist - nombre» (o fecha si no tiene), «Videos - fecha» para enlaces. */
function defaultZipName(result: BatchAnalysis): string {
  const hoy = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  const fecha = `${hoy.getFullYear()}-${pad(hoy.getMonth() + 1)}-${pad(hoy.getDate())}`;
  if (result.esPlaylist) return `Playlist - ${result.playlistTitulo ?? fecha}`;
  return `Videos - ${fecha}`;
}

async function onAnalyze(): Promise<void> {
  clearError(errorBox);
  if (activeJob) return;
  const texto = textInput.value.trim();
  if (!texto) {
    showError(errorBox, 'Pegá una playlist o uno o más enlaces de video.');
    return;
  }
  setBusy(true);
  setStatus(statusBox, 'Leyendo la lista…');
  try {
    analysis = await analyzeBatch(texto);
    zipNameInput.value = defaultZipName(analysis);
    selected.clear();
    for (const item of analysis.items) selected.add(item.videoId);
    listPanel.hidden = false;
    optionsPanel.hidden = false;
    runPanel.hidden = false;
    renderList();
    renderNotes(analysis);
    setStatus(statusBox, 'Elegí los videos, el formato y pulsá «Descargar lista».');
  } catch (err) {
    analysis = null;
    listPanel.hidden = true;
    optionsPanel.hidden = true;
    runPanel.hidden = true;
    showError(errorBox, err instanceof Error ? err.message : 'No se pudo leer la lista.');
    setStatus(statusBox, '');
  } finally {
    setBusy(false);
  }
}

function onDownload(): void {
  clearError(errorBox);
  if (!analysis || activeJob || selected.size === 0) return;
  const seleccion = analysis.items.filter((item: BatchItem) => selected.has(item.videoId)).map((item) => item.videoId);
  const nombre = zipNameInput.value.trim() || 'Lote de YouTube';
  const tipo = typeSelect.value as 'video' | 'audio';
  const request =
    tipo === 'video'
      ? {
          loteId: analysis.loteId,
          seleccion,
          tipo,
          contenedor: containerSelect.value as VideoContainer,
          ...(heightSelect.value ? { altura: Number(heightSelect.value) } : {}),
          nombre,
        }
      : {
          loteId: analysis.loteId,
          seleccion,
          tipo,
          formato: formatSelect.value as AudioFormat,
          ...(bitrateWrap.hidden ? {} : { kbps: Number(bitrateSelect.value) }),
          nombre,
        };

  // Sin await antes de este punto: el diálogo «Guardar como» debe abrirse con el clic.
  const picking = pickSaveTarget(withExtension(sanitizeFileName(nombre), 'zip'));
  setBusy(true);
  progressWrap.hidden = true;
  setStatus(statusBox, 'Elegí la carpeta donde guardar el ZIP…');

  picking
    .then((outcome) => {
      if (outcome.kind === 'error') {
        setBusy(false);
        showError(errorBox, outcome.mensaje);
        setStatus(statusBox, '');
        return;
      }
      if (outcome.kind === 'cancelado') {
        setBusy(false);
        setStatus(statusBox, 'Descarga cancelada: no elegiste una carpeta.');
        return;
      }
      const target = outcome.kind === 'destino' ? outcome.target : null;
      const note = outcome.kind === 'navegador' ? `${outcome.motivo} Se usará la descarga normal del navegador.` : '';
      startBatch(request, target, note);
    })
    .catch((err: unknown) => {
      setBusy(false);
      showError(errorBox, err instanceof Error ? err.message : 'No se pudo abrir el diálogo para guardar.');
      setStatus(statusBox, '');
    });
}

function startBatch(request: Parameters<typeof createBatchJob>[0], target: SaveTarget | null, note: string): void {
  setStatus(statusBox, 'Iniciando el lote…');
  createBatchJob(request)
    .then(({ id, nombreArchivo }) => {
      progressWrap.hidden = false;
      progressText.textContent = 'Preparando…';
      const watcher = watchJob(
        id,
        (status) => renderProgress(status),
        (status) => void finish(id, status, target),
        (message) => fail(message, target),
      );
      activeJob = { id, watcher, target };
      setStatus(statusBox, `Descargando «${nombreArchivo}». Puede tardar varios minutos. ${note}`.trim());
    })
    .catch((err: unknown) => {
      void target?.abort();
      setBusy(false);
      showError(errorBox, err instanceof YoutubeApiError ? err.message : 'No se pudo iniciar el lote.');
      setStatus(statusBox, '');
    });
}

function renderProgress(status: JobStatus): void {
  if (status.progreso !== null) {
    progress.value = status.progreso;
  } else {
    progress.removeAttribute('value');
  }
  progressText.textContent = status.mensaje;
  setStatus(statusBox, status.mensaje);
}

async function finish(id: string, status: JobStatus, target: SaveTarget | null): Promise<void> {
  activeJob = null;
  setBusy(false);
  if (status.estado !== 'listo') await target?.abort();
  if (status.estado === 'listo') {
    progress.value = 100;
    progressText.textContent = status.mensaje;
    if (target) {
      try {
        await writeToTarget(id, target);
        setStatus(statusBox, `ZIP guardado en la carpeta que elegiste: ${status.nombreArchivo}.`);
      } catch (err) {
        showError(errorBox, err instanceof Error ? err.message : 'No se pudo guardar el ZIP.');
        setStatus(statusBox, '');
      }
    } else {
      downloadWithBrowser(id, status.nombreArchivo);
      setStatus(
        statusBox,
        `ZIP listo: ${status.nombreArchivo}. Se envía a la carpeta de descargas de tu navegador.`,
      );
    }
    if (status.avisos.length > 0) {
      notes.replaceChildren();
      for (const aviso of status.avisos) {
        const p = document.createElement('p');
        p.className = 'tool-note';
        p.textContent = `Omitido: ${aviso}`;
        notes.append(p);
      }
      notes.hidden = false;
    }
    return;
  }
  progressWrap.hidden = true;
  if (status.estado === 'cancelado') {
    setStatus(statusBox, 'Descarga cancelada.');
    return;
  }
  showError(errorBox, status.error ?? 'No se pudo completar el lote.');
  setStatus(statusBox, '');
}

function fail(message: string, target: SaveTarget | null): void {
  activeJob = null;
  void target?.abort();
  setBusy(false);
  progressWrap.hidden = true;
  showError(errorBox, message);
  setStatus(statusBox, '');
}

async function onCancel(): Promise<void> {
  if (!activeJob) return;
  const { id, watcher, target } = activeJob;
  watcher.stop();
  activeJob = null;
  await target?.abort();
  try {
    await cancelJob(id);
  } catch {
    // Si el servidor ya terminó el lote, no hace falta más.
  }
  setBusy(false);
  progressWrap.hidden = true;
  setStatus(statusBox, 'Descarga cancelada.');
}

async function init(): Promise<void> {
  try {
    const status = await getStatus();
    if (!status.habilitado) {
      unavailable.textContent = 'Las descargas de YouTube no están disponibles en este entorno.';
      unavailable.hidden = false;
      return;
    }
  } catch {
    unavailable.textContent = 'Esta herramienta no está disponible en este entorno.';
    unavailable.hidden = false;
    return;
  }

  app.hidden = false;
  renderHeights();
  renderBitrates();
  updateKind();
  analyzeButton.addEventListener('click', () => void onAnalyze());
  selectAll.addEventListener('click', () => {
    for (const item of analysis?.items ?? []) selected.add(item.videoId);
    renderList();
  });
  selectNone.addEventListener('click', () => {
    selected.clear();
    renderList();
  });
  typeSelect.addEventListener('change', updateKind);
  formatSelect.addEventListener('change', updateKind);
  downloadButton.addEventListener('click', onDownload);
  cancelButton.addEventListener('click', () => void onCancel());
}

void init();
