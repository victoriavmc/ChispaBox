/*
 * Página «Recortar audio»: se elige un audio, se indican el inicio y el final, se escucha la
 * selección y se descarga solo esa parte (MP3 o WAV). Todo ocurre en el navegador.
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/recortar-onda.css';
import { formatBytes } from '../shared/image-limits.ts';
import { sanitizeBaseName, baseNameOf } from '../shared/nombres-archivo.ts';
import {
  RECORTAR_AUDIO_LIMITS,
  ajustarFin,
  formatTiempo,
  parseTiempo,
  validarRango,
} from '../shared/recortar-audio.ts';
import { decodeRecording, encodeMp3, encodeWav } from '../lib/audio-export.ts';
import { recortarAudio, reproducirFragmento } from '../lib/recortar-audio.ts';
import { crearSelectorOnda } from '../lib/selector-onda.ts';
import {
  attachDropzone,
  clearError,
  requireEl,
  setStatus,
  showError,
  triggerDownload,
} from '../lib/ui-common.ts';

const E = {
  file: requireEl<HTMLInputElement>('ra-file'),
  dropzone: requireEl<HTMLElement>('ra-dropzone'),
  error: requireEl<HTMLElement>('ra-error'),
  info: requireEl<HTMLElement>('ra-info'),
  inicio: requireEl<HTMLInputElement>('ra-inicio'),
  fin: requireEl<HTMLInputElement>('ra-fin'),
  escuchar: requireEl<HTMLButtonElement>('ra-escuchar'),
  parar: requireEl<HTMLButtonElement>('ra-parar'),
  rangoMsg: requireEl<HTMLElement>('ra-rango-msg'),
  formatoMp3: requireEl<HTMLInputElement>('ra-formato-mp3'),
  nombre: requireEl<HTMLInputElement>('ra-nombre'),
  run: requireEl<HTMLButtonElement>('ra-run'),
  clear: requireEl<HTMLButtonElement>('ra-clear'),
  results: requireEl<HTMLElement>('ra-results'),
  status: requireEl<HTMLElement>('ra-status'),
  wave: requireEl<HTMLElement>('ra-wave'),
  waveStage: requireEl<HTMLElement>('ra-wave-stage'),
  waveCanvas: requireEl<HTMLCanvasElement>('ra-wave-canvas'),
  waveSel: requireEl<HTMLElement>('ra-wave-sel'),
  waveHInicio: requireEl<HTMLElement>('ra-h-inicio'),
  waveHFin: requireEl<HTMLElement>('ra-h-fin'),
  waveTipInicio: requireEl<HTMLElement>('ra-tip-inicio'),
  waveTipFin: requireEl<HTMLElement>('ra-tip-fin'),
  waveDur: requireEl<HTMLElement>('ra-wave-dur'),
  waveReset: requireEl<HTMLButtonElement>('ra-wave-reset'),
};

let audio: { buffer: AudioBuffer; nombre: string } | null = null;
let detenerEscucha: (() => void) | null = null;
let busy = false;

/** Forma de onda: arrastrar los bordes actualiza los campos de texto, y viceversa. */
const onda = crearSelectorOnda({
  stage: E.waveStage,
  canvas: E.waveCanvas,
  sel: E.waveSel,
  handleInicio: E.waveHInicio,
  handleFin: E.waveHFin,
  tipInicio: E.waveTipInicio,
  tipFin: E.waveTipFin,
  onChange: (inicio, fin) => {
    E.inicio.value = formatTiempo(inicio);
    E.fin.value = formatTiempo(fin);
    leerRango();
  },
});

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo procesar el audio.';
}

/** Lee y valida los dos campos. Devuelve el rango o null si hay un error (mostrado en pantalla). */
function leerRango(): { inicio: number; fin: number } | null {
  if (!audio) return null;
  const duracion = audio.buffer.duration;
  const inicio = parseTiempo(E.inicio.value);
  let fin = parseTiempo(E.fin.value);
  if (fin !== null) fin = ajustarFin(fin, duracion);
  const error = validarRango(inicio, fin, duracion);
  if (error) {
    E.rangoMsg.textContent = error;
    return null;
  }
  E.rangoMsg.textContent = `Se conserva de ${formatTiempo(inicio!)} a ${formatTiempo(fin!)} (${formatTiempo(fin! - inicio!)}).`;
  onda.setRango(inicio!, fin!);
  return { inicio: inicio!, fin: fin! };
}

function setControlsEnabled(enabled: boolean): void {
  E.inicio.disabled = !enabled;
  E.fin.disabled = !enabled;
  E.escuchar.disabled = !enabled;
  E.nombre.disabled = !enabled;
  E.run.disabled = !enabled;
  E.clear.disabled = !enabled;
  E.waveReset.disabled = !enabled;
}

/** Vuelve a seleccionar todo el audio. */
function restablecerRango(): void {
  if (!audio) return;
  E.inicio.value = '0:00.0';
  E.fin.value = formatTiempo(audio.buffer.duration);
  leerRango();
}

function resetResults(): void {
  E.results.replaceChildren();
  E.results.hidden = true;
}

async function loadFile(file: File): Promise<void> {
  clearError(E.error);
  resetResults();
  stopListening();
  if (file.size > RECORTAR_AUDIO_LIMITS.maxBytes) {
    showError(E.error, `El archivo pesa ${formatBytes(file.size)}. El máximo es ${formatBytes(RECORTAR_AUDIO_LIMITS.maxBytes)}.`);
    return;
  }
  setStatus(E.status, `Leyendo «${file.name}»…`);
  try {
    const buffer = await decodeRecording(file);
    if (buffer.duration > RECORTAR_AUDIO_LIMITS.maxSegundos) {
      showError(E.error, 'El audio dura más de 60 minutos. Dividilo antes de recortarlo.');
      setStatus(E.status, '');
      return;
    }
    audio = { buffer, nombre: sanitizeBaseName(baseNameOf(file.name), 'audio') };
    E.info.textContent = `${audio.nombre}: ${formatTiempo(buffer.duration)}, ${buffer.sampleRate} Hz, ${buffer.numberOfChannels === 1 ? 'mono' : 'estéreo'}.`;
    E.info.hidden = false;
    E.inicio.value = '0:00.0';
    E.fin.value = formatTiempo(buffer.duration);
    E.nombre.value = `${audio.nombre}-recorte`;
    E.waveDur.textContent = formatTiempo(buffer.duration);
    E.wave.hidden = false;
    onda.setAudio(buffer);
    setControlsEnabled(true);
    leerRango();
    setStatus(E.status, 'Audio listo. Elegí la parte a conservar.');
  } catch (error) {
    audio = null;
    E.wave.hidden = true;
    onda.setAudio(null);
    setControlsEnabled(false);
    showError(E.error, `No se pudo leer el audio: ${describeError(error)}`);
    setStatus(E.status, '');
  }
}

function stopListening(): void {
  detenerEscucha?.();
  detenerEscucha = null;
  E.parar.disabled = true;
}

function clearAudio(): void {
  stopListening();
  audio = null;
  E.file.value = '';
  E.info.hidden = true;
  E.inicio.value = '';
  E.fin.value = '';
  E.nombre.value = '';
  E.rangoMsg.textContent = '';
  E.wave.hidden = true;
  onda.setAudio(null);
  E.waveDur.textContent = '';
  setControlsEnabled(false);
  resetResults();
  setStatus(E.status, '');
}

function listen(): void {
  if (!audio) return;
  const rango = leerRango();
  if (!rango) return;
  stopListening();
  E.parar.disabled = false;
  detenerEscucha = reproducirFragmento(audio.buffer, rango.inicio, rango.fin, () => {
    detenerEscucha = null;
    E.parar.disabled = true;
  });
}

async function run(): Promise<void> {
  if (!audio || busy) return;
  const rango = leerRango();
  if (!rango) {
    showError(E.error, 'Revisá el inicio y el final antes de descargar.');
    return;
  }
  clearError(E.error);
  busy = true;
  E.run.disabled = true;
  setStatus(E.status, 'Recortando y codificando…');
  try {
    const recorte = recortarAudio(audio.buffer, rango.inicio, rango.fin);
    const formato = E.formatoMp3.checked ? 'mp3' : 'wav';
    const blob = formato === 'mp3' ? await encodeMp3(recorte) : encodeWav(recorte);
    const url = URL.createObjectURL(blob);
    const nombre = sanitizeBaseName(E.nombre.value, `${audio.nombre}-recorte`);
    const archivo = `${nombre}.${formato}`;
    triggerDownload(url, archivo);
    E.results.replaceChildren();
    const texto = document.createElement('p');
    texto.textContent = `Listo: ${archivo} (${formatBytes(blob.size)}).`;
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = archivo;
    enlace.textContent = 'Descargar de nuevo';
    E.results.append(texto, enlace);
    E.results.hidden = false;
    setStatus(E.status, 'Recorte listo.');
    // El enlace sigue sirviendo mientras la página esté abierta; luego se libera la memoria.
    setTimeout(() => URL.revokeObjectURL(url), 10 * 60 * 1000);
  } catch (error) {
    showError(E.error, `No se pudo recortar el audio: ${describeError(error)}`);
    setStatus(E.status, '');
  } finally {
    busy = false;
    E.run.disabled = false;
  }
}

E.file.addEventListener('change', () => {
  const file = E.file.files?.[0];
  if (file) void loadFile(file);
});
attachDropzone(E.dropzone, (files) => {
  const file = files[0];
  if (file) void loadFile(file);
});
E.inicio.addEventListener('input', () => leerRango());
E.fin.addEventListener('input', () => leerRango());
E.escuchar.addEventListener('click', listen);
E.parar.addEventListener('click', stopListening);
E.waveReset.addEventListener('click', restablecerRango);
E.run.addEventListener('click', () => void run());
E.clear.addEventListener('click', clearAudio);
