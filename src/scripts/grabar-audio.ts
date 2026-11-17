/*
 * Grabar audio desde el micrófono (API del navegador: getUserMedia + MediaRecorder + AnalyserNode).
 *
 * - Todo ocurre en el navegador: el audio no se sube a ningún servidor.
 * - El micrófono se pide sólo cuando el usuario toca el botón, y se apaga al guardar o descartar.
 */
import '../styles/grabar-audio.css';
import '../styles/image-tools.css';
import { decodeRecording, encodeMp3, encodeWav, mp3EstimateSize, wavSize } from '../lib/audio-export';
import { formatBytes } from '../shared/image-limits';
import { triggerDownload } from '../lib/ui-common';

const BAR_COUNT = 32;
const TIMER_TICK_MS = 250;
// Preferencia de grabación: MP4 (AAC) si el navegador lo graba; si no, WebM u OGG (Opus).
const MIME_CANDIDATES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];

type UiState = 'permit' | 'ready' | 'recording' | 'paused' | 'saved';

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta el elemento #${id}`);
  return el as T;
}

const permitStep = requireEl<HTMLElement>('rec-permit-step');
const permitBtn = requireEl<HTMLButtonElement>('rec-permit');
const controls = requireEl<HTMLElement>('rec-controls');
const panel = requireEl<HTMLElement>('rec-panel');
const timerEl = requireEl<HTMLElement>('rec-timer');
const stateEl = requireEl<HTMLElement>('rec-state');
const canvas = requireEl<HTMLCanvasElement>('rec-canvas');
const startBtn = requireEl<HTMLButtonElement>('rec-start');
const pauseBtn = requireEl<HTMLButtonElement>('rec-pause');
const saveBtn = requireEl<HTMLButtonElement>('rec-save');
const discardBtn = requireEl<HTMLButtonElement>('rec-discard');
const result = requireEl<HTMLElement>('rec-result');
const resultAudio = requireEl<HTMLAudioElement>('rec-audio');
const downloadBtn = requireEl<HTMLButtonElement>('rec-download');
const formatSelect = requireEl<HTMLSelectElement>('rec-format');
const sizeEl = requireEl<HTMLElement>('rec-size');
const againBtn = requireEl<HTMLButtonElement>('rec-again');
const statusEl = requireEl<HTMLElement>('rec-status');
const errorEl = requireEl<HTMLElement>('rec-error');

let stream: MediaStream | null = null;
let recorder: MediaRecorder | null = null;
let chunks: Blob[] = [];
let mimeType = '';
let discarding = false;
let audioCtx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let frequencyData: Uint8Array<ArrayBuffer> | null = null;
let rafId = 0;
let timerId = 0;
let elapsedMs = 0;
let segmentStart = 0;
let objectUrl: string | null = null;
type Choice = 'original' | 'wav' | 'mp3';
let sourceBlob: Blob | null = null;
let sourceExt = 'webm';
let sourceLabel = '';
let decoded: AudioBuffer | null = null;
let decodeFailed = false;
const converted = new Map<'wav' | 'mp3', Blob>();
let decodeToken = 0;
let palette = { from: '#E61932', to: '#F72568', muted: '#55555e' };
let hintVisible = true;

function setState(state: UiState): void {
  const recording = state === 'recording';
  const paused = state === 'paused';
  const active = recording || paused;

  hintVisible = state === 'ready';
  permitStep.hidden = state !== 'permit';
  controls.hidden = state === 'permit' || state === 'saved';
  result.hidden = state !== 'saved';
  panel.classList.toggle('is-recording', recording);

  startBtn.disabled = state !== 'ready';
  pauseBtn.disabled = !active;
  pauseBtn.textContent = paused ? 'Reanudar' : 'Pausar';
  saveBtn.disabled = !active;
  discardBtn.disabled = !active;

  const labels: Record<UiState, string> = {
    permit: '',
    ready: 'Listo para grabar',
    recording: 'Grabando',
    paused: 'En pausa',
    saved: 'Guardada',
  };
  stateEl.textContent = labels[state];

  // Se redibuja al final, cuando el canvas ya está visible y tiene tamaño.
  if (!analyser) {
    resizeCanvas();
  }
}

function showError(message: string): void {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function clearError(): void {
  errorEl.textContent = '';
  errorEl.hidden = true;
}

function say(message: string): void {
  statusEl.textContent = message;
}

function describeMicError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'No se permitió el micrófono. Podés habilitarlo desde el candado de la barra de direcciones y volver a intentar.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'No encontramos un micrófono conectado.';
  }
  if (name === 'NotReadableError') {
    return 'El micrófono está en uso por otra aplicación.';
  }
  return 'No pudimos acceder al micrófono.';
}

function pickMimeType(): string {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
}

// Intenta con el formato elegido y, si el navegador lo rechaza al empezar, con el formato por defecto.
function startMediaRecorder(source: MediaStream): MediaRecorder | null {
  const attempts: (MediaRecorderOptions | undefined)[] = mimeType
    ? [{ mimeType }, undefined]
    : [undefined];
  for (const options of attempts) {
    try {
      const candidate = new MediaRecorder(source, options);
      candidate.addEventListener('dataavailable', (event: BlobEvent) => {
        if (event.data.size > 0) chunks.push(event.data);
      });
      candidate.addEventListener('stop', finishRecording);
      candidate.start(1000);
      if (!options) mimeType = candidate.mimeType || '';
      return candidate;
    } catch {
      // Probar con la siguiente opción.
    }
  }
  return null;
}

function extensionFor(type: string): string {
  if (type.includes('ogg')) return 'ogg';
  if (type.includes('mp4')) return 'm4a';
  if (type.includes('webm')) return 'webm';
  return 'audio';
}

/* ---------- Micrófono ---------- */

async function requestMicrophone(): Promise<void> {
  clearError();
  if (!navigator.mediaDevices?.getUserMedia) {
    showError('Este navegador no permite grabar audio, o el sitio no está abierto con https.');
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    showError(describeMicError(err));
    return;
  }
  setState('ready');
  say('Micrófono listo. Tocá «Empezar a grabar».');
}

// Apaga todo lo de una grabación (visual, temporizador, contexto de audio) pero deja el micrófono abierto.
function stopCapture(): void {
  stopVisualizer();
  stopTimer();
  if (audioCtx) {
    void audioCtx.close();
    audioCtx = null;
  }
  analyser = null;
  frequencyData = null;
  recorder = null;
}

// Apaga el micrófono por completo. Sólo se usa al cerrar la pestaña.
function releaseMicrophone(): void {
  stopCapture();
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  chunks = [];
}

/* ---------- Grabación ---------- */

function startRecording(): void {
  if (!stream) return;
  clearError();
  discarding = false;
  chunks = [];
  mimeType = pickMimeType();

  const started = startMediaRecorder(stream);
  if (!started) {
    showError('No pudimos iniciar la grabadora de este navegador.');
    return;
  }
  recorder = started;

  audioCtx = new AudioContext();
  void audioCtx.resume();
  const source = audioCtx.createMediaStreamSource(stream);
  analyser = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.6;
  source.connect(analyser);
  frequencyData = new Uint8Array(analyser.frequencyBinCount);

  elapsedMs = 0;
  segmentStart = performance.now();
  timerId = window.setInterval(updateTimer, TIMER_TICK_MS);
  updateTimer();
  // El canvas estaba oculto al cargar (tamaño 0): se ajusta ahora que ya se ve.
  resizeCanvas();
  startVisualizer();
  setState('recording');
  say('Grabando. Podés pausar, guardar o descartar.');
}

function togglePause(): void {
  if (!recorder) return;
  if (recorder.state === 'recording') {
    recorder.pause();
    elapsedMs += performance.now() - segmentStart;
    stopTimer();
    updateTimer();
    setState('paused');
    say('Grabación en pausa.');
  } else if (recorder.state === 'paused') {
    recorder.resume();
    segmentStart = performance.now();
    timerId = window.setInterval(updateTimer, TIMER_TICK_MS);
    setState('recording');
    say('Grabando de nuevo.');
  }
}

function stopRecorder(discard: boolean): void {
  discarding = discard;
  if (recorder && recorder.state !== 'inactive') {
    recorder.stop();
  } else {
    finishRecording();
  }
}

function finishRecording(): void {
  const type = mimeType || recorder?.mimeType || 'audio/webm';
  const blob = new Blob(chunks, { type });
  chunks = [];
  stopCapture();

  if (discarding) {
    resetToReady();
    say('Grabación descartada. Podés empezar otra cuando quieras.');
    return;
  }

  if (objectUrl) URL.revokeObjectURL(objectUrl);
  objectUrl = URL.createObjectURL(blob);
  resultAudio.src = objectUrl;

  sourceBlob = blob;
  sourceExt = extensionFor(type);
  sourceLabel = sourceLabelFor(type);
  decoded = null;
  decodeFailed = false;
  converted.clear();
  populateFormats();
  setState('saved');
  say('Grabación lista. Escuchala, elegí el formato y descargala.');
  void prepareDecoded();
}

function sourceLabelFor(type: string): string {
  if (type.includes('mp4')) return 'MP4 / M4A (AAC)';
  if (type.includes('ogg')) return 'OGG (Opus)';
  if (type.includes('webm')) return 'WebM (Opus)';
  return 'formato del navegador';
}

function choiceLabel(choice: Choice): string {
  if (choice === 'original') return sourceLabel;
  return choice === 'wav' ? 'WAV, sin compresión' : 'MP3, 128 kbps';
}

function choiceExt(choice: Choice): string {
  return choice === 'original' ? sourceExt : choice;
}

function currentChoice(): Choice {
  return formatSelect.value === 'wav' || formatSelect.value === 'original' ? formatSelect.value : 'mp3';
}

function populateFormats(): void {
  formatSelect.replaceChildren();
  const options: Array<[Choice, string]> = [
    ['original', `Original · ${sourceLabel}`],
    ['wav', 'WAV · sin compresión (archivo grande)'],
    ['mp3', 'MP3 · 128 kbps (archivo compacto)'],
  ];
  for (const [value, text] of options) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = text;
    formatSelect.append(option);
  }
  formatSelect.value = 'mp3';
}

// Decodifica una vez para calcular pesos exactos de WAV y MP3.
async function prepareDecoded(): Promise<void> {
  if (!sourceBlob) return;
  const token = ++decodeToken;
  sizeEl.textContent = 'Preparando el audio…';
  try {
    const buffer = await decodeRecording(sourceBlob);
    if (token !== decodeToken) return;
    decoded = buffer;
  } catch (err) {
    console.error(err);
    decodeFailed = true;
  }
  updateSize();
}

async function convertChoice(choice: 'wav' | 'mp3'): Promise<Blob> {
  const cached = converted.get(choice);
  if (cached) return cached;
  if (!decoded) throw new Error('El audio todavía no está listo.');
  const blob = choice === 'wav' ? encodeWav(decoded) : await encodeMp3(decoded);
  converted.set(choice, blob);
  return blob;
}

// Muestra el peso del formato elegido antes de descargar.
function updateSize(): void {
  if (!sourceBlob) {
    sizeEl.textContent = '';
    return;
  }
  const choice = currentChoice();
  if (choice === 'original') {
    sizeEl.textContent = `Pesa ${formatBytes(sourceBlob.size)} (${sourceLabel}).`;
    return;
  }
  const cached = converted.get(choice);
  if (cached) {
    sizeEl.textContent = `Pesa ${formatBytes(cached.size)} (${choiceLabel(choice)}).`;
    return;
  }
  if (decodeFailed) {
    sizeEl.textContent = 'No pudimos convertir este audio. Descargalo en formato original.';
    return;
  }
  if (!decoded) {
    sizeEl.textContent = 'Calculando el peso…';
    return;
  }
  if (choice === 'wav') {
    sizeEl.textContent = `Pesa ${formatBytes(wavSize(decoded))} (WAV, sin compresión).`;
    return;
  }
  // MP3: se muestra una estimación y después el peso exacto, al terminar de codificar.
  sizeEl.textContent = `Pesa aproximadamente ${formatBytes(mp3EstimateSize(decoded.duration))} (MP3, 128 kbps). Calculando el tamaño exacto…`;
  void convertChoice('mp3')
    .then(() => {
      if (currentChoice() === 'mp3') updateSize();
    })
    .catch(() => {
      if (currentChoice() === 'mp3') sizeEl.textContent = 'No pudimos convertir a MP3. Descargalo en formato original.';
    });
}

async function onDownload(): Promise<void> {
  if (!sourceBlob) return;
  const choice = currentChoice();
  try {
    const blob = choice === 'original' ? sourceBlob : await convertChoice(choice);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const fileName = `grabacion-${stamp}.${choiceExt(choice)}`;
    const url = URL.createObjectURL(blob);
    triggerDownload(url, fileName);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    say(`Descargando ${fileName} (${formatBytes(blob.size)}).`);
  } catch (err) {
    console.error(err);
    say('No pudimos preparar el archivo. Probá de nuevo.');
  }
}

// Vuelve a la grabadora con el micrófono ya dado, sin pedir permiso otra vez.
function resetToReady(): void {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  resultAudio.removeAttribute('src');
  resultAudio.load();
  sourceBlob = null;
  decoded = null;
  decodeFailed = false;
  converted.clear();
  formatSelect.replaceChildren();
  sizeEl.textContent = '';
  elapsedMs = 0;
  updateTimer();
  setState('ready');
}

/* ---------- Temporizador ---------- */

function currentElapsed(): number {
  if (recorder?.state === 'recording') return elapsedMs + (performance.now() - segmentStart);
  return elapsedMs;
}

function updateTimer(): void {
  const total = Math.floor(currentElapsed() / 1000);
  const minutes = String(Math.floor(total / 60)).padStart(2, '0');
  const seconds = String(total % 60).padStart(2, '0');
  timerEl.textContent = `${minutes}:${seconds}`;
}

function stopTimer(): void {
  window.clearInterval(timerId);
  timerId = 0;
}

/* ---------- Visualizador (barras de nivel) ---------- */

function resizeCanvas(): void {
  refreshPalette();
  const dpr = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  const ctx = canvas.getContext('2d');
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawBars(null);
}

// Alturas que se muestran (suavizadas): suben rápido y bajan despacio, para que no tiemblen.
const displayed = new Array<number>(BAR_COUNT).fill(0);

function refreshPalette(): void {
  const styles = getComputedStyle(document.documentElement);
  palette = {
    from: styles.getPropertyValue('--accent').trim() || '#E61932',
    to: styles.getPropertyValue('--accent-2').trim() || '#F72568',
    muted: styles.getPropertyValue('--text-muted').trim() || '#55555e',
  };
}

function drawBars(level: number[] | null): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  ctx.clearRect(0, 0, width, height);

  const gap = 6;
  const barWidth = (width - gap * (BAR_COUNT - 1)) / BAR_COUNT;
  const mid = height / 2;
  const maxHalf = height / 2 - 10;

  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, palette.from);
  gradient.addColorStop(1, palette.to);

  // Sin señal y sin barras que estén bajando: línea base continua o texto de ayuda.
  const idle = !level && displayed.every((value) => value < 0.01);
  if (idle) {
    if (hintVisible) {
      ctx.fillStyle = palette.muted;
      ctx.font = '500 14px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Apretá «Empezar a grabar» para ver el nivel del micrófono', width / 2, mid);
    } else {
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = gradient;
      ctx.fillRect(0, mid - 1, width, 2);
      ctx.globalAlpha = 1;
    }
    return;
  }

  ctx.fillStyle = gradient;
  for (let i = 0; i < BAR_COUNT; i++) {
    const target = level ? Math.min(1, level[i] ?? 0) : 0;
    const speed = target > displayed[i] ? 0.5 : 0.12;
    displayed[i] += (target - displayed[i]) * speed;
    if (displayed[i] < 0.01) continue;

    const half = Math.max(2, displayed[i] * maxHalf);
    const x = i * (barWidth + gap);
    ctx.beginPath();
    ctx.roundRect(x, mid - half, barWidth, half * 2, barWidth / 2);
    ctx.fill();
  }
}

function frame(): void {
  if (!analyser || !frequencyData) return;
  const active = recorder?.state === 'recording';
  if (active) {
    analyser.getByteFrequencyData(frequencyData);
    // Usa la parte de frecuencias donde está la voz (sin el extremo agudo).
    const usable = Math.floor(frequencyData.length * 0.6);
    const perBar = Math.max(1, Math.floor(usable / BAR_COUNT));
    const levels: number[] = [];
    for (let i = 0; i < BAR_COUNT; i++) {
      let sum = 0;
      for (let j = 0; j < perBar; j++) sum += frequencyData[i * perBar + j] ?? 0;
      levels.push(sum / perBar / 255);
    }
    drawBars(levels);
  } else {
    drawBars(null);
  }
  rafId = window.requestAnimationFrame(frame);
}

function startVisualizer(): void {
  window.cancelAnimationFrame(rafId);
  rafId = window.requestAnimationFrame(frame);
}

function stopVisualizer(): void {
  window.cancelAnimationFrame(rafId);
  rafId = 0;
  displayed.fill(0);
  drawBars(null);
}

/* ---------- Eventos ---------- */

permitBtn.addEventListener('click', () => {
  permitBtn.disabled = true;
  void requestMicrophone().then(() => {
    if (!stream) permitBtn.disabled = false;
  });
});

startBtn.addEventListener('click', startRecording);
pauseBtn.addEventListener('click', togglePause);
saveBtn.addEventListener('click', () => stopRecorder(false));
discardBtn.addEventListener('click', () => stopRecorder(true));
againBtn.addEventListener('click', () => {
  clearError();
  resetToReady();
  say('Listo para una nueva grabación.');
});

downloadBtn.addEventListener('click', () => void onDownload());
formatSelect.addEventListener('change', updateSize);

// Si la pestaña se cierra durante una grabación, se apaga el micrófono.
window.addEventListener('pagehide', releaseMicrophone);
window.addEventListener('resize', resizeCanvas);

setState('permit');
resizeCanvas();
