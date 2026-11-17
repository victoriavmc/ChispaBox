/*
 * Descarga de música de YouTube: analiza el enlace, pide artista y título (sin inventarlos)
 * y guarda el audio en la carpeta que elige el usuario al pulsar «Descargar».
 */
import '../../../../src/styles/grabar-audio.css';
import '../../../../src/styles/image-tools.css';
import '../styles/youtube.css';
import '../../../../src/styles/responsive.css';

import { buildAudioName, sanitizeFileName, withExtension } from '../shared/youtube-names';
import { AUDIO_FORMATS, type AnalysisResult, type AudioFormat, type JobStatus } from '../shared/youtube-types';
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

const FORMAT_LABEL: Record<AudioFormat, string> = {
  mp3: 'MP3 (con pérdida, compatible con casi todo)',
  m4a: 'M4A (AAC en contenedor MPEG-4, con pérdida)',
  wav: 'WAV (sin compresión, archivo muy grande)',
  flac: 'FLAC (sin pérdida)',
};

const FORMAT_NOTE: Record<AudioFormat, string> = {
  mp3: 'Calidad máxima: el bitrate de la fuente. No se ofrecen bitrates superiores al origen.',
  m4a: 'Calidad máxima: el bitrate de la fuente. M4A es audio; no es el contenedor MP4 de video.',
  wav: 'WAV conserva el audio sin comprimir (16 bits). No mejora la calidad del origen.',
  flac: 'FLAC es sin pérdida, pero el origen de YouTube es audio comprimido: no recupera calidad perdida.',
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
const artistInput = requireEl<HTMLInputElement>('yt-artist');
const titleInput = requireEl<HTMLInputElement>('yt-title');
const formatSelect = requireEl<HTMLSelectElement>('yt-format');
const formatNote = requireEl<HTMLElement>('yt-format-note');
const qualityWrap = requireEl<HTMLElement>('yt-quality-wrap');
const qualitySelect = requireEl<HTMLSelectElement>('yt-quality');
const artistHint = requireEl<HTMLElement>('yt-artist-hint');
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
  artistInput.disabled = busy;
  titleInput.disabled = busy;
  formatSelect.disabled = busy;
  qualitySelect.disabled = busy;
  downloadButton.disabled = busy || !analysis;
  cancelButton.hidden = !busy;
}

function resetResult(): void {
  progressWrap.hidden = true;
  progress.value = 0;
  progressText.textContent = '';
}

function currentFormat(): AudioFormat {
  return formatSelect.value as AudioFormat;
}

function renderInfo(result: AnalysisResult): void {
  info.replaceChildren();
  const rows: Array<[string, string]> = [
    ['Título del video', result.titulo],
    ['Duración', formatDuration(result.duracionSegundos)],
    ['Canal (solo informativo)', result.canal ?? 'No informado'],
    ['Bitrate de la fuente', result.fuenteAudioKbps !== null ? `${result.fuenteAudioKbps} kbps` : 'No informado'],
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
  for (const format of AUDIO_FORMATS) {
    const el = document.createElement('option');
    el.value = format;
    el.textContent = FORMAT_LABEL[format];
    formatSelect.append(el);
  }
  // Por defecto, MP3 (o el primero disponible).
  const first = result.audio.find((a) => a.formato === 'mp3') ?? result.audio[0];
  if (first) formatSelect.value = first.formato;
  renderQualities(result);
}

function renderQualities(result: AnalysisResult): void {
  const format = currentFormat();
  const option = result.audio.find((a) => a.formato === format);
  qualitySelect.replaceChildren();
  for (const kbps of option?.kbps ?? []) {
    const el = document.createElement('option');
    el.value = String(kbps);
    const bytes = option?.tamanos[String(kbps)] ?? null;
    el.textContent = bytes === null ? `${kbps} kbps` : `${kbps} kbps · ~${formatSize(bytes)}`;
    qualitySelect.append(el);
  }
  // Solo se muestra el selector cuando hay bitrates reales que elegir (MP3 y M4A).
  qualityWrap.hidden = qualitySelect.options.length === 0;
  formatNote.textContent = FORMAT_NOTE[format];
  renderFinalName();
  renderSize(result);
}

/** Tamaño aproximado del formato y bitrate elegidos, antes de descargar. */
function renderSize(result: AnalysisResult): void {
  const format = currentFormat();
  const option = result.audio.find((a) => a.formato === format);
  const key = qualityWrap.hidden ? '0' : qualitySelect.value;
  const bytes = option?.tamanos[key] ?? null;
  sizeLine.textContent =
    bytes === null
      ? 'Tamaño: no se puede estimar para esta opción.'
      : `Tamaño aproximado: ~${formatSize(bytes)}. El tamaño exacto se conoce al terminar.`;
}

function renderFinalName(): void {
  if (!analysis) return;
  const name = buildAudioName(artistInput.value, titleInput.value || analysis.tituloSugerido);
  finalName.textContent = withExtension(name, currentFormat());
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
    // Artista: el que informa YouTube; si no lo informa, el nombre del canal (editable).
    artistInput.value = analysis.artistaSugerido ?? analysis.canal ?? '';
    artistHint.textContent = analysis.artistaSugerido
      ? ''
      : 'YouTube no informa el artista: se usó el nombre del canal. Podés cambiarlo.';
    artistHint.hidden = analysis.artistaSugerido !== null;
    titleInput.value = analysis.tituloSugerido;
    renderFormats(analysis);
    optionsPanel.hidden = false;
    runPanel.hidden = false;
    setStatus(statusBox, 'Revisá artista y título antes de descargar.');
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
 * lo exige dentro del clic). Si se elige una carpeta, el audio se descarga y se guarda solo.
 */
function onDownload(): void {
  clearError(errorBox);
  if (!analysis || activeJob) return;
  const current = analysis;
  const format = currentFormat();
  const kbps = qualityWrap.hidden ? undefined : Number(qualitySelect.value);
  const artist = artistInput.value;
  const title = titleInput.value.trim() || current.tituloSugerido;
  const nombre = buildAudioName(artist, title);
  const suggested = withExtension(sanitizeFileName(nombre), format);

  // Sin await antes de este punto: así el diálogo «Guardar como» se abre con el clic.
  const picking = pickSaveTarget(suggested);
  setBusy(true);
  resetResult();
  setStatus(statusBox, 'Elegí la carpeta donde guardar el audio…');

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
      startJob(current, { format, kbps, artist, title, nombre }, target, note);
    })
    .catch((err: unknown) => {
      setBusy(false);
      showError(errorBox, err instanceof Error ? err.message : 'No se pudo abrir el diálogo para guardar.');
      setStatus(statusBox, '');
    });
}

interface AudioChoice {
  format: AudioFormat;
  kbps: number | undefined;
  artist: string;
  title: string;
  nombre: string;
}

function startJob(current: AnalysisResult, choice: AudioChoice, target: SaveTarget | null, note: string): void {
  setStatus(statusBox, 'Iniciando la descarga…');
  createJob({
    tipo: 'audio',
    videoId: current.videoId,
    formato: choice.format,
    ...(choice.kbps !== undefined ? { kbps: choice.kbps } : {}),
    artista: choice.artist,
    titulo: choice.title,
    nombre: choice.nombre,
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
  artistInput.addEventListener('input', () => renderFinalName());
  titleInput.addEventListener('input', () => renderFinalName());
  formatSelect.addEventListener('change', () => {
    if (analysis) renderQualities(analysis);
  });
  qualitySelect.addEventListener('change', () => {
    renderFinalName();
    if (analysis) renderSize(analysis);
  });
  downloadButton.addEventListener('click', onDownload);
  cancelButton.addEventListener('click', () => void onCancel());
}

void init();
