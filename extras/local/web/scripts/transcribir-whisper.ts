/*
 * Transcribir un archivo de audio a texto con Whisper, dentro del navegador (@huggingface/transformers).
 * Herramienta LOCAL (extras/local): no se publica en Hostinger.
 *
 * - El audio no sale del dispositivo. Sólo se descargan los archivos del modelo la primera vez
 *   (desde Hugging Face); después quedan en la caché del navegador.
 * - La librería se carga recién al transcribir, así la página sigue liviana para quien sólo dicta.
 * - Whisper trabaja a 16 kHz mono: el audio se convierte antes de transcribirlo.
 */
import { decodeRecording } from '../../../../src/lib/audio-export';

const MODEL_ID = 'onnx-community/whisper-base';
const MODEL_DTYPE = 'q8';
const SAMPLE_RATE = 16000;
const CHUNK_SECONDS = 30;
const STRIDE_SECONDS = 5;
const MAX_FILE_MB = 100;

// Nombres de idioma que entiende Whisper, según el código del selector.
const LANGUAGES: readonly { code: string; label: string; whisper: string }[] = [
  { code: 'es', label: 'Español', whisper: 'spanish' },
  { code: 'en', label: 'Inglés', whisper: 'english' },
  { code: 'pt', label: 'Portugués', whisper: 'portuguese' },
  { code: 'fr', label: 'Francés', whisper: 'french' },
  { code: 'it', label: 'Italiano', whisper: 'italian' },
  { code: 'de', label: 'Alemán', whisper: 'german' },
];
const DEFAULT_LANG = 'es';

interface AsrOutput {
  text: string;
}
type Transcriber = (audio: Float32Array, options: Record<string, unknown>) => Promise<AsrOutput | AsrOutput[]>;
interface ProgressInfo {
  status: string;
  progress?: number;
  file?: string;
}

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta el elemento #${id}`);
  return el as T;
}

const fileInput = requireEl<HTMLInputElement>('up-file');
const fileNameEl = requireEl<HTMLElement>('up-file-name');
const langSelect = requireEl<HTMLSelectElement>('up-lang');
const startBtn = requireEl<HTMLButtonElement>('up-start');
const copyBtn = requireEl<HTMLButtonElement>('up-copy');
const clearBtn = requireEl<HTMLButtonElement>('up-clear');
const progressEl = requireEl<HTMLProgressElement>('up-progress');
const output = requireEl<HTMLTextAreaElement>('up-output');
const statusEl = requireEl<HTMLElement>('up-status');
const errorEl = requireEl<HTMLElement>('up-error');
const consentEl = requireEl<HTMLInputElement>('up-consent');

let selectedFile: File | null = null;
let busy = false;
let transcriberPromise: Promise<Transcriber> | null = null;

function say(message: string): void {
  statusEl.textContent = message;
}

function showError(message: string): void {
  errorEl.textContent = message;
  errorEl.hidden = false;
}

function clearError(): void {
  errorEl.textContent = '';
  errorEl.hidden = true;
}

function setProgress(percent: number | null): void {
  if (percent === null) {
    progressEl.removeAttribute('value');
  } else {
    progressEl.value = Math.max(0, Math.min(100, percent));
  }
  progressEl.hidden = false;
}

function hideProgress(): void {
  progressEl.hidden = true;
  progressEl.value = 0;
}

function refreshButtons(): void {
  startBtn.disabled = busy || !selectedFile;
  copyBtn.disabled = busy || !output.value.trim();
  clearBtn.disabled = busy || (!selectedFile && !output.value);
  fileInput.disabled = busy;
  langSelect.disabled = busy;
}

/* ---------- Modelo ---------- */

// Carga el modelo una sola vez por página. Si falla, se permite reintentar.
function loadTranscriber(): Promise<Transcriber> {
  if (!transcriberPromise) {
    transcriberPromise = (async () => {
      const { pipeline } = await import('@huggingface/transformers');
      const asr = await pipeline('automatic-speech-recognition', MODEL_ID, {
        device: 'wasm',
        dtype: MODEL_DTYPE,
        progress_callback: (info: ProgressInfo) => {
          if (info.status === 'progress' && typeof info.progress === 'number') {
            setProgress(info.progress);
            say(`Descargando el modelo de reconocimiento… ${Math.round(info.progress)}%`);
          }
        },
      });
      return asr as unknown as Transcriber;
    })();
    transcriberPromise.catch(() => {
      transcriberPromise = null;
    });
  }
  return transcriberPromise;
}

/* ---------- Audio ---------- */

// Decodifica el archivo (MP3, WAV, M4A, OGG, WebM…) y lo convierte a 16 kHz mono.
async function toWhisperAudio(file: File): Promise<Float32Array> {
  const decoded = await decodeRecording(file);
  const frames = Math.ceil(decoded.duration * SAMPLE_RATE);
  if (frames < 1) throw new Error('empty');

  const offline = new OfflineAudioContext(1, frames, SAMPLE_RATE);
  const source = offline.createBufferSource();
  source.buffer = decoded;
  source.connect(offline.destination);
  source.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

/* ---------- Eventos ---------- */

function onFileChosen(): void {
  clearError();
  const file = fileInput.files?.[0] ?? null;
  selectedFile = null;
  if (!file) {
    fileNameEl.textContent = '';
    refreshButtons();
    return;
  }
  if (file.size > MAX_FILE_MB * 1024 * 1024) {
    fileNameEl.textContent = '';
    fileInput.value = '';
    showError(`El archivo pesa más de ${MAX_FILE_MB} MB. Probá con uno más chico, por ejemplo en MP3.`);
    refreshButtons();
    return;
  }
  selectedFile = file;
  fileNameEl.textContent = `Archivo elegido: ${file.name}`;
  say('Listo. Elegí el idioma y tocá «Transcribir archivo».');
  refreshButtons();
}

async function onTranscribe(): Promise<void> {
  if (!selectedFile || busy) return;
  if (!consentEl.checked) {
    showError('Marcá la casilla para autorizar la descarga del modelo (unos 80 MB la primera vez). El audio no sale de tu equipo.');
    return;
  }
  const file = selectedFile;
  const whisperLang = LANGUAGES.find((lang) => lang.code === langSelect.value)?.whisper ?? 'spanish';

  clearError();
  output.value = '';
  busy = true;
  refreshButtons();
  setProgress(null);

  try {
    say('Preparando el audio…');
    let samples: Float32Array;
    try {
      samples = await toWhisperAudio(file);
    } catch {
      throw new UserError('No pudimos leer este archivo. Probá con MP3 o WAV.');
    }

    say('Preparando el reconocimiento de voz…');
    const transcriber = await loadTranscriber().catch(() => {
      throw new UserError('No pudimos cargar el reconocimiento de voz. Revisá tu conexión y probá de nuevo.');
    });

    say('Transcribiendo. Según la duración puede tardar un poco.');
    setProgress(null);
    const result = await transcriber(samples, {
      language: whisperLang,
      task: 'transcribe',
      chunk_length_s: CHUNK_SECONDS,
      stride_length_s: STRIDE_SECONDS,
    });
    const text = (Array.isArray(result) ? result[0]?.text : result.text) ?? '';
    output.value = text.trim();

    say(output.value
      ? `Transcripción lista (${output.value.length} caracteres).`
      : 'No detectamos voz en el audio.');
  } catch (err) {
    console.error(err);
    if (err instanceof UserError) {
      showError(err.message);
    } else {
      showError('Algo salió mal al transcribir. Probá de nuevo.');
    }
    say('');
  } finally {
    busy = false;
    hideProgress();
    refreshButtons();
  }
}

class UserError extends Error {}

async function copyText(): Promise<void> {
  const text = output.value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    say('Texto copiado al portapapeles.');
  } catch {
    showError('No pudimos copiar automáticamente. Seleccioná el texto y copialo a mano.');
  }
}

/* ---------- Inicio ---------- */

function fillLanguages(): void {
  for (const lang of LANGUAGES) {
    const option = document.createElement('option');
    option.value = lang.code;
    option.textContent = lang.label;
    langSelect.append(option);
  }
  const browserLang = navigator.language?.slice(0, 2).toLowerCase();
  const match = LANGUAGES.find((lang) => lang.code === browserLang);
  langSelect.value = match?.code ?? DEFAULT_LANG;
}

function clearUpload(): void {
  selectedFile = null;
  fileInput.value = '';
  fileNameEl.textContent = '';
  output.value = '';
  clearError();
  hideProgress();
  say('Borrado. Elegí otro audio cuando quieras.');
  refreshButtons();
}

fillLanguages();
fileInput.addEventListener('change', onFileChosen);
clearBtn.addEventListener('click', clearUpload);
startBtn.addEventListener('click', () => void onTranscribe());
copyBtn.addEventListener('click', () => void copyText());
refreshButtons();
