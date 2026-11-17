/*
 * Convertir audio entre formatos (OGG, MP3, M4A, MP4, WAV, FLAC, WebM) en el navegador,
 * con FFmpeg compilado a WebAssembly (@ffmpeg/ffmpeg + núcleo LGPL propio en public/ffmpeg-lgpl/).
 * Sin servidor: el archivo nunca sale del equipo. Cada conversión usa un motor nuevo, porque el CLI
 * de FFmpeg no reinicia su estado entre ejecuciones (ver docs/ffmpeg-lgpl.md).
 */
import '../styles/grabar-audio.css';
import '../styles/image-tools.css';

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

/** Núcleo FFmpeg LGPL-2.1+ (sin GPL): public/ffmpeg-lgpl/ (ver public/ffmpeg-lgpl/LEEME.md). */
const coreURL = '/ffmpeg-lgpl/ffmpeg-core.js';
const wasmURL = '/ffmpeg-lgpl/ffmpeg-core.wasm';

import { formatBytes } from '../shared/image-limits';
import { baseNameOf, sanitizeBaseName } from '../shared/nombres-archivo';
import { attachDropzone, clearError, requireEl, setStatus, showError, triggerDownload } from '../lib/ui-common';

/** Tamaño máximo del archivo de entrada: la conversión ocurre en memoria del navegador. */
const MAX_INPUT_BYTES = 300 * 1024 * 1024;

type OutputFormat = 'mp3' | 'ogg' | 'm4a' | 'mp4' | 'wav' | 'flac' | 'webm';

interface FormatSpec {
  ext: string;
  mime: string;
  lossy: boolean;
  /** Argumentos de códec y contenedor. El bitrate se pasa solo a los formatos con pérdida. */
  codecArgs: (bitrate: string) => string[];
}

const FORMATS: Record<OutputFormat, FormatSpec> = {
  mp3: { ext: 'mp3', mime: 'audio/mpeg', lossy: true, codecArgs: (b) => ['-c:a', 'libmp3lame', '-b:a', b, '-f', 'mp3'] },
  ogg: { ext: 'ogg', mime: 'audio/ogg', lossy: true, codecArgs: (b) => ['-c:a', 'libopus', '-b:a', b, '-f', 'ogg'] },
  m4a: {
    ext: 'm4a',
    mime: 'audio/mp4',
    lossy: true,
    codecArgs: (b) => ['-c:a', 'aac', '-b:a', b, '-f', 'mp4', '-movflags', '+faststart'],
  },
  mp4: {
    ext: 'mp4',
    mime: 'audio/mp4',
    lossy: true,
    codecArgs: (b) => ['-c:a', 'aac', '-b:a', b, '-f', 'mp4', '-movflags', '+faststart'],
  },
  wav: { ext: 'wav', mime: 'audio/wav', lossy: false, codecArgs: () => ['-c:a', 'pcm_s16le', '-f', 'wav'] },
  flac: { ext: 'flac', mime: 'audio/flac', lossy: false, codecArgs: () => ['-c:a', 'flac', '-f', 'flac'] },
  webm: { ext: 'webm', mime: 'audio/webm', lossy: true, codecArgs: (b) => ['-c:a', 'libopus', '-b:a', b, '-f', 'webm'] },
};

const fileInput = requireEl<HTMLInputElement>('audio-file');
const dropzone = requireEl<HTMLElement>('audio-dropzone');
const errorEl = requireEl<HTMLElement>('audio-error');
const infoEl = requireEl<HTMLElement>('audio-info');
const formatSelect = requireEl<HTMLSelectElement>('audio-format');
const bitrateWrap = requireEl<HTMLElement>('audio-bitrate-wrap');
const bitrateSelect = requireEl<HTMLSelectElement>('audio-bitrate');
const runBtn = requireEl<HTMLButtonElement>('audio-run');
const clearBtn = requireEl<HTMLButtonElement>('audio-clear');
const progressWrap = requireEl<HTMLElement>('audio-progress-wrap');
const progressEl = requireEl<HTMLProgressElement>('audio-progress');
const progressText = requireEl<HTMLElement>('audio-progress-text');
const resultsList = requireEl<HTMLUListElement>('audio-results');
const statusEl = requireEl<HTMLElement>('audio-status');

let selected: File | null = null;
let running = false;
let objectUrls: string[] = [];
let ffmpeg: FFmpeg | null = null;
let loading: Promise<FFmpeg> | null = null;

/** Carga FFmpeg una sola vez. Si falla, se puede reintentar en el próximo clic. */
function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg) return Promise.resolve(ffmpeg);
  if (loading) return loading;
  loading = (async () => {
    const instance = new FFmpeg();
    instance.on('progress', ({ progress }) => {
      if (running) setProgress(progress);
    });
    await instance.load({ coreURL, wasmURL });
    ffmpeg = instance;
    return instance;
  })();
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

function setProgress(fraction: number): void {
  const percent = Number.isFinite(fraction) ? Math.min(100, Math.max(0, Math.round(fraction * 100))) : 0;
  progressEl.value = percent;
  progressText.textContent = `${percent}%`;
}

function inputExtension(name: string): string {
  const match = /\.([a-z0-9]{1,8})$/i.exec(name);
  return match ? match[1].toLowerCase() : 'bin';
}

function isAudioOrVideo(file: File): boolean {
  if (file.type.startsWith('audio/') || file.type.startsWith('video/')) return true;
  // Algunos navegadores no informan el tipo (p. ej. .opus o .amr): se acepta por extensión.
  return /\.(ogg|oga|opus|mp3|mp4|m4a|aac|wav|flac|webm|amr|3gp|mkv|mov)$/i.test(file.name);
}

function renderInfo(file: File): void {
  infoEl.replaceChildren();
  const rows: Array<[string, string]> = [
    ['Archivo', file.name],
    ['Tamaño', formatBytes(file.size)],
    ['Formato de origen', inputExtension(file.name).toUpperCase()],
  ];
  for (const [term, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    infoEl.append(dt, dd);
  }
  infoEl.hidden = false;
}

function updateBitrateVisibility(): void {
  const spec = FORMATS[formatSelect.value as OutputFormat];
  bitrateWrap.hidden = !spec.lossy;
}

function clearResults(): void {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls = [];
  resultsList.replaceChildren();
  resultsList.hidden = true;
}

function setSelected(file: File | null): void {
  selected = file;
  clearResults();
  clearError(errorEl);
  if (!file) {
    infoEl.hidden = true;
    infoEl.replaceChildren();
    setStatus(statusEl, '');
  } else {
    renderInfo(file);
    setStatus(statusEl, 'Listo. Elegí el formato de salida y tocá Convertir.');
  }
  runBtn.disabled = !file || running;
}

async function convert(file: File): Promise<void> {
  const format = formatSelect.value as OutputFormat;
  const spec = FORMATS[format];
  const bitrate = bitrateSelect.value;
  const baseName = sanitizeBaseName(baseNameOf(file.name), 'audio');
  const inputName = `input.${inputExtension(file.name)}`;
  const outputName = `output.${spec.ext}`;

  setStatus(statusEl, 'Cargando el motor de conversión (solo la primera vez)…');
  const engine = await getFFmpeg();

  setStatus(statusEl, 'Convirtiendo…');
  setProgress(0);
  await engine.writeFile(inputName, await fetchFile(file));
  try {
    // -map 0:a:0 toma la primera pista de audio (útil para videos); -vn descarta el video.
    const code = await engine.exec(['-i', inputName, '-map', '0:a:0', '-vn', ...spec.codecArgs(bitrate), outputName]);
    if (code !== 0) throw new Error(`FFmpeg terminó con código ${code}`);
    const data = await engine.readFile(outputName);
    if (typeof data === 'string') throw new Error('Salida inesperada del motor de conversión');
    const blob = new Blob([data as BlobPart], { type: spec.mime });
    const url = URL.createObjectURL(blob);
    objectUrls.push(url);
    const filename = `${baseName}.${spec.ext}`;

    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.className = 'tool-card__cta';
    link.textContent = `Descargar ${filename}`;
    const size = document.createElement('span');
    size.className = 'tool-note';
    size.textContent = ` (${formatBytes(blob.size)})`;
    item.append(link, size);
    resultsList.append(item);
    resultsList.hidden = false;

    setProgress(1);
    triggerDownload(url, filename);
    setStatus(statusEl, `Listo: ${filename} descargado.`);
  } finally {
    await engine.deleteFile(inputName).catch(() => undefined);
    await engine.deleteFile(outputName).catch(() => undefined);
    // Motor nuevo en la próxima conversión: el CLI de FFmpeg no es reentrante.
    engine.terminate();
    ffmpeg = null;
    loading = null;
  }
}

async function onRun(): Promise<void> {
  if (!selected || running) return;
  running = true;
  runBtn.disabled = true;
  clearBtn.disabled = true;
  fileInput.disabled = true;
  progressWrap.hidden = false;
  clearError(errorEl);
  try {
    await convert(selected);
  } catch (err) {
    console.error(err);
    showError(errorEl, 'No se pudo convertir este archivo. Probá con otro archivo o con otro formato de salida.');
    setStatus(statusEl, '');
  } finally {
    running = false;
    progressWrap.hidden = true;
    clearBtn.disabled = false;
    fileInput.disabled = false;
    runBtn.disabled = !selected;
  }
}

function acceptFile(files: File[]): void {
  const file = files[0];
  if (!file) return;
  if (!isAudioOrVideo(file)) {
    setSelected(null);
    showError(errorEl, 'Ese archivo no parece ser de audio o video.');
    return;
  }
  if (file.size > MAX_INPUT_BYTES) {
    setSelected(null);
    showError(errorEl, `El archivo supera el máximo de ${formatBytes(MAX_INPUT_BYTES)}.`);
    return;
  }
  setSelected(file);
}

fileInput.addEventListener('change', () => acceptFile(Array.from(fileInput.files ?? [])));
attachDropzone(dropzone, acceptFile);
formatSelect.addEventListener('change', updateBitrateVisibility);
runBtn.addEventListener('click', () => void onRun());
clearBtn.addEventListener('click', () => {
  fileInput.value = '';
  setSelected(null);
});
updateBitrateVisibility();
