/*
 * Página «Verificador de integridad»: calcula el SHA-256 de un archivo en el navegador (Web Crypto)
 * y lo compara con el hash esperado. El archivo nunca sale del equipo.
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/verificador-integridad.css';
import { bytesAHex, compararHash, validarTamano } from '../shared/verificador-integridad.ts';

function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta el elemento #${id}`);
  return el as T;
}

const E = {
  dropzone: requireEl<HTMLElement>('integ-dropzone'),
  file: requireEl<HTMLInputElement>('integ-file'),
  error: requireEl<HTMLElement>('integ-error'),
  hash: requireEl<HTMLElement>('integ-hash'),
  copy: requireEl<HTMLButtonElement>('integ-copy'),
  copyStatus: requireEl<HTMLElement>('integ-copy-status'),
  expected: requireEl<HTMLInputElement>('integ-expected'),
  result: requireEl<HTMLElement>('integ-result'),
  status: requireEl<HTMLElement>('integ-status'),
};

let hashActual: string | null = null;
/** Evita que un cálculo viejo pise el resultado de un archivo más nuevo. */
let solicitud = 0;

function mostrarError(mensaje: string): void {
  E.error.textContent = mensaje;
  E.error.hidden = false;
}

function limpiarError(): void {
  E.error.textContent = '';
  E.error.hidden = true;
}

function actualizarComparacion(): void {
  const esperado = E.expected.value;
  if (!esperado.trim()) {
    E.result.hidden = true;
    E.result.textContent = '';
    E.result.className = 'verificador-result';
    return;
  }
  if (hashActual === null) {
    E.result.hidden = true;
    return;
  }
  const comparacion = compararHash(hashActual, esperado);
  const textos = {
    vacio: '',
    coincide: 'Coincide: el archivo no cambió.',
    'no-coincide': 'No coincide: el archivo cambió o el hash no corresponde a este archivo.',
    'formato-invalido': 'El hash no es válido: debe tener 64 caracteres hexadecimales (0-9 y a-f).',
  } as const;
  E.result.textContent = textos[comparacion];
  E.result.className = `verificador-result ${comparacion === 'coincide' ? 'is-ok' : 'is-bad'}`;
  E.result.hidden = comparacion === 'vacio';
}

async function calcular(archivo: File): Promise<void> {
  const id = ++solicitud;
  limpiarError();
  hashActual = null;
  E.copy.disabled = true;
  E.copyStatus.textContent = '';
  E.hash.textContent = 'Calculando…';
  actualizarComparacion();

  const problema = validarTamano(archivo.size);
  if (problema) {
    E.hash.textContent = 'Todavía no elegiste un archivo válido.';
    mostrarError(problema);
    return;
  }
  if (!globalThis.crypto?.subtle) {
    E.hash.textContent = 'No se pudo calcular.';
    mostrarError('Este navegador no permite calcular el hash aquí. Abrí la página con una conexión segura (https) o en localhost.');
    return;
  }

  try {
    const buffer = await archivo.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    if (id !== solicitud) return;
    hashActual = bytesAHex(digest);
    E.hash.textContent = hashActual;
    E.copy.disabled = false;
    E.status.textContent = `Hash calculado para ${archivo.name}.`;
    actualizarComparacion();
  } catch {
    if (id !== solicitud) return;
    E.hash.textContent = 'No se pudo calcular.';
    mostrarError('No se pudo leer el archivo. Probá de nuevo.');
  }
}

async function copiarHash(): Promise<void> {
  if (!hashActual) return;
  try {
    await navigator.clipboard.writeText(hashActual);
    E.copyStatus.textContent = 'Hash copiado.';
  } catch {
    E.copyStatus.textContent = 'No se pudo copiar automáticamente. Seleccionalo y copialo a mano.';
  }
}

function iniciar(): void {
  E.file.addEventListener('change', () => {
    const archivo = E.file.files?.[0];
    if (archivo) void calcular(archivo);
  });

  E.dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    E.dropzone.classList.add('is-dragover');
  });
  E.dropzone.addEventListener('dragleave', () => E.dropzone.classList.remove('is-dragover'));
  E.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    E.dropzone.classList.remove('is-dragover');
    const archivo = e.dataTransfer?.files?.[0];
    if (archivo) void calcular(archivo);
  });

  E.expected.addEventListener('input', actualizarComparacion);
  E.copy.addEventListener('click', () => void copiarHash());
}

iniciar();
