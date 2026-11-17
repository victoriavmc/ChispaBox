/*
 * Descarga de video de YouTube: analiza el enlace, muestra solo las calidades realmente
 * disponibles y guarda el archivo en la carpeta que elige el usuario al pulsar «Descargar».
 */
import '../../../../src/styles/grabar-audio.css';
import '../../../../src/styles/image-tools.css';
import '../styles/youtube.css';
import '../../../../src/styles/responsive.css';

import { buildVideoName, sanitizeFileName, withExtension } from '../shared/youtube-names';
import type { AnalysisResult, JobStatus, VideoContainer, VideoOption } from '../shared/youtube-types';
import { requireEl, setStatus, showError, clearError } from '../../../../src/lib/ui-common';
import {
  analyze,
  cancelJob,
  createJob,
  downloadWithBrowser,
  formatDuration,
  formatSize,
  getStatus,
  pickSaveTarget,
  watchJob,
  writeToTarget,
  YoutubeApiError,
  type JobWatcher,
  type SaveTarget,
} from '../lib/youtube-client';

const CONTAINER_LABEL: Record<VideoContainer, string> = {
  mp4: 'MP4 (recomendado: H.264 con audio AAC)',
  webm: 'WebM (VP9 con audio Opus)',
  mkv: 'MKV (contenedor Matroska)',
};

const urlInput = requireEl<HTMLInputElement>('yt-url');
const analyzeButton = requireEl<HTMLButtonElement>('yt-analyze');
const errorBox = requireEl<HTMLElement>('yt-error');
const statusBox = requireEl<HTMLElement>('yt-status');
const app = requireEl<HTMLElement>('yt-app');
const unavailable = requireEl<HTMLElement>('yt-unavailable');
const infoPanel = requireEl<HTMLElement>('yt-info-panel');
const info = requireEl<HTMLElement>('yt-info');
const optionsPanel = requireEl<HTMLElement>('yt-options-panel');
const formatSelect = requireEl<HTMLSelectElement>('yt-format');
const qualitySelect = requireEl<HTMLSelectElement>('yt-quality');
const nameInput = requireEl<HTMLInputElement>('yt-name');
const finalName = requireEl<HTMLElement>('yt-final-name');
const runPanel = requireEl<HTMLElement>('yt-run-panel');
const downloadButton = requireEl<HTMLButtonElement>('yt-download');
const cancelButton = requireEl<HTMLButtonElement>('yt-cancel');
const sizeLine = requireEl<HTMLElement>('yt-size');
const progressWrap = requireEl<HTMLElement>('yt-progress-wrap');
const progress = requireEl<HTMLProgressElement>('yt-progress');
const progressText = requireEl<HTMLElement>('yt-progress-text');

let analysis: AnalysisResult | null = null;
/** Trabajo en curso y el destino elegido en el diálogo (si el navegador lo ofrece). */
let activeJob: { id: string; watcher: JobWatcher; target: SaveTarget | null } | null = null;

function setBusy(busy: boolean): void {
  analyzeButton.disabled = busy;
  urlInput.disabled = busy;
  formatSelect.disabled = busy;
  qualitySelect.disabled = busy;
  nameInput.disabled = busy;
  downloadButton.disabled = busy || !analysis || analysis.video.length === 0;
  cancelButton.hidden = !busy;
}

function resetResult(): void {
  progressWrap.hidden = true;
  progress.value = 0;
  progressText.textContent = '';
}

function selectedOption(): VideoOption | undefined {
  return analysis?.video.find((option) => option.contenedor === formatSelect.value);
}

function currentContainer(): VideoContainer {
  return formatSelect.value as VideoContainer;
}

function renderInfo(result: AnalysisResult): void {
  info.replaceChildren();
  const rows: Array<[string, string]> = [
    ['Título', result.titulo],
    ['Duración', formatDuration(result.duracionSegundos)],
    ['Canal', result.canal ?? 'No informado'],
  ];
  for (const [label, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    info.append(dt, dd);
  }
  infoPanel.hidden = false;
}

function renderFormats(result: AnalysisResult): void {
  formatSelect.replaceChildren();
  for (const option of result.video) {
    const el = document.createElement('option');
    el.value = option.contenedor;
    el.textContent = CONTAINER_LABEL[option.contenedor];
    formatSelect.append(el);
  }
  renderQualities();
}

function renderQualities(): void {
  qualitySelect.replaceChildren();
  const option = selectedOption();
  for (const height of option?.alturas ?? []) {
    const el = document.createElement('option');
    el.value = String(height);
    const bytes = option?.tamanos[String(height)] ?? null;
    el.textContent = bytes === null ? `${height}p` : `${height}p · ~${formatSize(bytes)}`;
    qualitySelect.append(el);
  }
  // Por defecto, la calidad más alta que existe para ese formato.
  renderFinalName();
  renderSize();
}

/** Tamaño aproximado de la opción elegida, antes de descargar. */
function renderSize(): void {
  const option = selectedOption();
  const bytes = option?.tamanos[qualitySelect.value] ?? null;
  sizeLine.textContent =
    bytes === null
      ? 'Tamaño: no se puede estimar para esta opción.'
      : `Tamaño aproximado: ~${formatSize(bytes)}. El tamaño exacto se conoce al terminar.`;
}

function renderFinalName(): void {
  if (!analysis) return;
  const base = sanitizeFileName(nameInput.value.trim() || buildVideoName(analysis.canal, analysis.titulo));
  finalName.textContent = withExtension(base, currentContainer());
}

function resetOptionsForNewVideo(result: AnalysisResult): void {
  nameInput.value = buildVideoName(result.canal, result.titulo);
  renderFormats(result);
  const hasVideo = result.video.length > 0;
  optionsPanel.hidden = !hasVideo;
  runPanel.hidden = !hasVideo;
  if (!hasVideo) {
    showError(errorBox, 'No se encontraron formatos de video descargables en este enlace.');
  }
  // Calidad por defecto: la primera de la lista (es la más alta).
  if (qualitySelect.options.length > 0) qualitySelect.selectedIndex = 0;
  renderFinalName();
}

async function onAnalyze(): Promise<void> {
  clearError(errorBox);
  if (activeJob) return;
  const url = urlInput.value.trim();
  if (!url) {
    showError(errorBox, 'Pegá un enlace de YouTube para analizar.');
    return;
  }
  setBusy(true);
  setStatus(statusBox, 'Analizando el enlace…');
  resetResult();
  try {
    analysis = await analyze(url);
    renderInfo(analysis);
    resetOptionsForNewVideo(analysis);
    setStatus(statusBox, 'Listo. Elegí formato, calidad y nombre.');
  } catch (err) {
    analysis = null;
    infoPanel.hidden = true;
    optionsPanel.hidden = true;
    runPanel.hidden = true;
    showError(errorBox, err instanceof Error ? err.message : 'No se pudo analizar el enlace.');
    setStatus(statusBox, '');
  } finally {
    setBusy(false);
  }
}

/**
 * Al pulsar «Descargar»: primero se abre el diálogo para elegir la carpeta (el navegador
 * lo exige dentro del clic). Si se elige una carpeta, el video se descarga y se guarda solo.
 */
function onDownload(): void {
  clearError(errorBox);
  if (!analysis || activeJob) return;
  const current = analysis;
  const altura = Number(qualitySelect.value);
  const nombre = nameInput.value.trim() || buildVideoName(current.canal, current.titulo);
  const suggested = withExtension(sanitizeFileName(nombre), currentContainer());

  // Sin await antes de este punto: así el diálogo «Guardar como» se abre con el clic.
  const picking = pickSaveTarget(suggested);
  setBusy(true);
  resetResult();
  setStatus(statusBox, 'Elegí la carpeta donde guardar el video…');

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
      startJob(current, altura, nombre, target, note);
    })
    .catch((err: unknown) => {
      setBusy(false);
      showError(errorBox, err instanceof Error ? err.message : 'No se pudo abrir el diálogo para guardar.');
      setStatus(statusBox, '');
    });
}

function startJob(current: AnalysisResult, altura: number, nombre: string, target: SaveTarget | null, note: string): void {
  setStatus(statusBox, 'Iniciando la descarga…');
  createJob({
    tipo: 'video',
    videoId: current.videoId,
    contenedor: currentContainer(),
    altura,
    nombre,
  })
    .then(({ id, nombreArchivo }) => {
      progressWrap.hidden = false;
      progressText.textContent = 'Preparando…';
      const watcher = watchJob(
        id,
        (status) => renderProgress(status),
        (status) => void finish(id, status, target),
        (message) => fail(id, message, target),
      );
      activeJob = { id, watcher, target };
      setStatus(statusBox, `Descargando «${nombreArchivo}». ${note}`.trim());
    })
    .catch((err: unknown) => {
      void target?.abort();
      setBusy(false);
      showError(errorBox, err instanceof YoutubeApiError ? err.message : 'No se pudo iniciar la descarga.');
      setStatus(statusBox, '');
    });
}

function renderProgress(status: JobStatus): void {
  if (status.progreso !== null) {
    progress.removeAttribute('indeterminate');
    progress.value = status.progreso;
  } else {
    progress.removeAttribute('value');
  }
  progressText.textContent = status.mensaje;
  setStatus(statusBox, status.mensaje);
}

/** Terminado: escribe el archivo en la carpeta elegida (o usa la descarga del navegador). */
async function finish(id: string, status: JobStatus, target: SaveTarget | null): Promise<void> {
  activeJob = null;
  setBusy(false);
  if (status.estado !== 'listo') {
    await target?.abort();
    progressWrap.hidden = true;
    if (status.estado === 'cancelado') {
      setStatus(statusBox, 'Descarga cancelada.');
    } else {
      showError(errorBox, status.error ?? 'No se pudo completar la descarga.');
      setStatus(statusBox, '');
    }
    return;
  }

  progress.value = 100;
  progressText.textContent = 'Archivo verificado. Guardando…';
  const size = formatSize(status.bytes);
  try {
    if (target) {
      await writeToTarget(id, target);
      progressText.textContent = 'Guardado en la carpeta que elegiste.';
      setStatus(statusBox, `Guardado: ${status.nombreArchivo} (${size}).`);
    } else {
      downloadWithBrowser(id, status.nombreArchivo);
      progressText.textContent = 'Descarga iniciada en el navegador.';
      setStatus(
        statusBox,
        `Descarga iniciada: ${status.nombreArchivo} (${size}). Se guarda en la carpeta de descargas de tu navegador (normalmente «Descargas»).`,
      );
    }
  } catch (err) {
    showError(errorBox, err instanceof Error ? err.message : 'No se pudo guardar el archivo.');
    setStatus(statusBox, '');
  }
}

function fail(id: string, message: string, target: SaveTarget | null): void {
  if (activeJob?.id === id) activeJob = null;
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
    // Si el servidor ya terminó el trabajo, no hace falta más.
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
  analyzeButton.addEventListener('click', () => void onAnalyze());
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') void onAnalyze();
  });
  formatSelect.addEventListener('change', () => {
    renderQualities();
  });
  qualitySelect.addEventListener('change', () => {
    renderFinalName();
    renderSize();
  });
  nameInput.addEventListener('input', () => renderFinalName());
  downloadButton.addEventListener('click', onDownload);
  cancelButton.addEventListener('click', () => void onCancel());
}

void init();
