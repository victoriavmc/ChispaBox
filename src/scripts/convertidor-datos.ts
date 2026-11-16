/*
 * Convertidor de datos: CSV a JSON, JSON a CSV, XML a JSON y Excel (.xlsx) a CSV.
 * Todo se hace en el navegador (sin subir archivos, sin IA). Las librerías son libres:
 * papaparse (MIT) para CSV, read-excel-file (MIT) para .xlsx y DOMParser nativo para XML.
 */
import '../styles/grabar-audio.css';
import '../styles/image-tools.css';
import '../styles/convertidor-datos.css';

import readXlsxFile from 'read-excel-file/browser';
import {
  DATOS_LIMITS,
  ErrorDatos,
  csvAJson,
  csvAXlsx,
  hojaAMatriz,
  jsonAMatriz,
  matrizACsv,
  rechazarXmlPeligroso,
  xmlAJson,
  type NodoXml,
} from '../lib/data-convert';
import { attachDropzone, clearError, requireEl, setStatus, showError } from '../lib/ui-common';
import { formatBytes } from '../shared/image-limits';

type Modo = 'csv-json' | 'json-csv' | 'xml-json' | 'xlsx-csv' | 'csv-xlsx';

interface ConfigModo {
  accept: string;
  maxBytes: number;
  requisitos: string[];
  salida: 'json' | 'csv' | 'xlsx';
}

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const MODOS: Record<Modo, ConfigModo> = {
  'csv-xlsx': {
    accept: '.csv,text/csv',
    maxBytes: DATOS_LIMITS.maxBytesTexto,
    requisitos: [
      'Archivo .csv de texto (UTF-8 recomendado).',
      'Tamaño máximo: 20 MB.',
      'Se crea un libro .xlsx con una hoja llamada «Datos». Los números se guardan como números; el resto, como texto.',
    ],
    salida: 'xlsx',
  },
  'csv-json': {
    accept: '.csv,text/csv',
    maxBytes: DATOS_LIMITS.maxBytesTexto,
    requisitos: ['Archivo .csv de texto (UTF-8 recomendado).', 'Tamaño máximo: 20 MB.', 'Los valores quedan como texto.'],
    salida: 'json',
  },
  'json-csv': {
    accept: '.json,application/json',
    maxBytes: DATOS_LIMITS.maxBytesTexto,
    requisitos: [
      'Archivo .json con una lista de objetos, por ejemplo [{"nombre":"Ana"}].',
      'Tamaño máximo: 20 MB.',
      'Los objetos anidados se guardan como texto JSON dentro de la celda.',
    ],
    salida: 'csv',
  },
  'xml-json': {
    accept: '.xml,text/xml,application/xml',
    maxBytes: DATOS_LIMITS.maxBytesTexto,
    requisitos: [
      'Archivo .xml bien formado.',
      'No se admiten DTD ni entidades declaradas (por seguridad).',
      'Tamaño máximo: 20 MB.',
    ],
    salida: 'json',
  },
  'xlsx-csv': {
    accept: '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    maxBytes: DATOS_LIMITS.maxBytesExcel,
    requisitos: [
      'Libro .xlsx (no .xls, .xlsm ni .ods).',
      'Tamaño máximo: 10 MB.',
      'Se convierte una hoja por vez; se usan los valores ya calculados.',
    ],
    salida: 'csv',
  },
};

const PREVIEW_MAX_CHARS = 200_000;

interface Resultado {
  texto: string;
  tipo: 'json' | 'csv' | 'xlsx';
  /** Contenido binario (solo para .xlsx). */
  bytes?: Uint8Array;
  nombre: string;
  filas: number;
  columnas: number;
  avisos: string[];
}

interface HojaExcel {
  sheet: string;
  data: ReadonlyArray<ReadonlyArray<unknown>>;
}

const modoSelect = requireEl<HTMLSelectElement>('dat-modo');
const requisitosList = requireEl<HTMLUListElement>('dat-requirements');
const dropzone = requireEl<HTMLElement>('dat-dropzone');
const fileInput = requireEl<HTMLInputElement>('dat-file');
const errorEl = requireEl<HTMLElement>('dat-error');
const fileInfo = requireEl<HTMLElement>('dat-file-info');
const optCsvIn = requireEl<HTMLElement>('dat-opt-csv-in');
const optXlsx = requireEl<HTMLElement>('dat-opt-xlsx');
const optCsvOut = requireEl<HTMLElement>('dat-opt-csv-out');
const optProtect = requireEl<HTMLElement>('dat-opt-protect');
const csvDelim = requireEl<HTMLSelectElement>('dat-csv-delim');
const csvHeader = requireEl<HTMLInputElement>('dat-csv-header');
const sheetSelect = requireEl<HTMLSelectElement>('dat-sheet');
const outDelim = requireEl<HTMLSelectElement>('dat-out-delim');
const protectCheck = requireEl<HTMLInputElement>('dat-protect');
const runBtn = requireEl<HTMLButtonElement>('dat-run');
const clearBtn = requireEl<HTMLButtonElement>('dat-clear');
const statusEl = requireEl<HTMLElement>('dat-status');
const resultBox = requireEl<HTMLElement>('dat-result');
const metaEl = requireEl<HTMLElement>('dat-result-meta');
const warningsList = requireEl<HTMLUListElement>('dat-warnings');
const outputEl = requireEl<HTMLTextAreaElement>('dat-output');
const previewNote = requireEl<HTMLElement>('dat-preview-note');
const downloadBtn = requireEl<HTMLButtonElement>('dat-download');
const copyBtn = requireEl<HTMLButtonElement>('dat-copy');
const copyStatus = requireEl<HTMLElement>('dat-copy-status');

let modo: Modo = 'csv-json';
let archivo: File | null = null;
let hojas: HojaExcel[] | null = null;
let resultado: Resultado | null = null;
let urlDescarga: string | null = null;

function modoActual(): Modo {
  const valor = modoSelect.value as Modo;
  return valor in MODOS ? valor : 'csv-json';
}

function ocultarResultado(): void {
  resultado = null;
  resultBox.hidden = true;
  metaEl.textContent = '';
  outputEl.value = '';
  warningsList.replaceChildren();
  warningsList.hidden = true;
  if (urlDescarga) URL.revokeObjectURL(urlDescarga);
  urlDescarga = null;
  copyStatus.textContent = '';
  copyBtn.hidden = false;
}

function mostrarOpcionesDelModo(): void {
  const config = MODOS[modo];
  fileInput.accept = config.accept;
  requisitosList.replaceChildren(
    ...config.requisitos.map((texto) => {
      const li = document.createElement('li');
      li.textContent = texto;
      return li;
    }),
  );
  optCsvIn.hidden = modo !== 'csv-json' && modo !== 'csv-xlsx';
  optXlsx.hidden = modo !== 'xlsx-csv';
  optCsvOut.hidden = config.salida !== 'csv';
  optProtect.hidden = config.salida !== 'csv';
}

function limpiarArchivo(): void {
  archivo = null;
  hojas = null;
  fileInput.value = '';
  fileInfo.hidden = true;
  fileInfo.textContent = '';
  sheetSelect.replaceChildren(new Option('Elegí un archivo primero', ''));
  sheetSelect.disabled = true;
  runBtn.disabled = true;
  clearError(errorEl);
  ocultarResultado();
  setStatus(statusEl, '');
}

function nombreSinExtension(nombre: string): string {
  return nombre.replace(/\.[^.]+$/, '') || 'datos';
}

async function cargarArchivo(files: File[]): Promise<void> {
  limpiarArchivo();
  const file = files[0];
  if (!file) return;

  const config = MODOS[modo];
  if (file.size > config.maxBytes) {
    showError(errorEl, `El archivo pesa ${formatBytes(file.size)} y el máximo es ${formatBytes(config.maxBytes)}.`);
    return;
  }

  archivo = file;
  fileInfo.textContent = `${file.name} · ${formatBytes(file.size)}`;
  fileInfo.hidden = false;

  if (modo === 'xlsx-csv') {
    setStatus(statusEl, 'Leyendo las hojas del libro…');
    try {
      const leidas = await readXlsxFile(file);
      if (leidas.length === 0) throw new ErrorDatos('El libro no tiene hojas.');
      hojas = leidas.map((h) => ({ sheet: h.sheet, data: h.data }));
      sheetSelect.replaceChildren(...hojas.map((h, i) => new Option(h.sheet, String(i))));
      sheetSelect.disabled = hojas.length === 1;
    } catch {
      archivo = null;
      showError(errorEl, 'No se pudo leer el Excel. Revisá que sea un .xlsx válido y no esté protegido con contraseña.');
      setStatus(statusEl, '');
      return;
    }
    setStatus(statusEl, '');
  }

  runBtn.disabled = false;
}

function columnasDe(datos: unknown[]): number {
  const primera = datos[0];
  if (Array.isArray(primera)) return primera.length;
  if (primera && typeof primera === 'object') return Object.keys(primera).length;
  return 0;
}

async function convertir(): Promise<Resultado> {
  if (!archivo) throw new ErrorDatos('Elegí un archivo primero.');
  const base = nombreSinExtension(archivo.name);
  const protegerFormulas = protectCheck.checked;
  const delimitadorSalida = outDelim.value;

  if (modo === 'csv-xlsx') {
    const r = csvAXlsx(await archivo.text(), csvDelim.value === 'auto' ? null : csvDelim.value);
    return {
      texto: matrizACsv(r.matriz, ','),
      tipo: 'xlsx',
      bytes: r.bytes,
      nombre: `${base}.xlsx`,
      filas: r.matriz.length,
      columnas: r.matriz.reduce((max, fila) => Math.max(max, fila.length), 0),
      avisos: r.avisos,
    };
  }

  if (modo === 'csv-json') {
    const r = csvAJson(await archivo.text(), {
      delimitador: csvDelim.value === 'auto' ? null : csvDelim.value,
      primeraFilaEncabezado: csvHeader.checked,
    });
    return {
      texto: JSON.stringify(r.datos, null, 2),
      tipo: 'json',
      nombre: `${base}.json`,
      filas: r.datos.length,
      columnas: columnasDe(r.datos),
      avisos: r.avisos,
    };
  }

  if (modo === 'json-csv') {
    const matriz = jsonAMatriz(await archivo.text(), protegerFormulas);
    return {
      texto: matrizACsv(matriz, delimitadorSalida),
      tipo: 'csv',
      nombre: `${base}.csv`,
      filas: matriz.length - 1,
      columnas: matriz[0]?.length ?? 0,
      avisos: [],
    };
  }

  if (modo === 'xml-json') {
    const texto = await archivo.text();
    rechazarXmlPeligroso(texto);
    const doc = new DOMParser().parseFromString(texto, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length > 0 || !doc.documentElement) {
      throw new ErrorDatos('El XML no es válido: revisá que todas las etiquetas estén bien cerradas.');
    }
    const objeto = xmlAJson(doc.documentElement as unknown as NodoXml);
    const raiz = Object.values(objeto)[0];
    return {
      texto: JSON.stringify(objeto, null, 2),
      tipo: 'json',
      nombre: `${base}.json`,
      filas: Array.isArray(raiz) ? raiz.length : 1,
      columnas: raiz && typeof raiz === 'object' ? Object.keys(raiz).length : 1,
      avisos: [],
    };
  }

  // xlsx-csv
  const hoja = hojas?.[Number(sheetSelect.value) || 0];
  if (!hoja) throw new ErrorDatos('No hay una hoja para convertir.');
  const matriz = hojaAMatriz(hoja.data, protegerFormulas);
  return {
    texto: matrizACsv(matriz, delimitadorSalida),
    tipo: 'csv',
    nombre: `${base}-${hoja.sheet}.csv`.replace(/\s+/g, '_'),
    filas: matriz.length,
    columnas: matriz[0]?.length ?? 0,
    avisos: [],
  };
}

function mostrarResultado(r: Resultado): void {
  resultado = r;
  const bytes = r.bytes ? r.bytes.byteLength : new Blob([r.texto]).size;
  const plural = (n: number, singular: string, plural_: string) => `${n} ${n === 1 ? singular : plural_}`;
  metaEl.textContent = `${plural(r.filas, 'fila', 'filas')} · ${plural(r.columnas, 'columna', 'columnas')} · ${formatBytes(bytes)} (${r.tipo.toUpperCase()})`;

  warningsList.replaceChildren(
    ...r.avisos.map((aviso) => {
      const li = document.createElement('li');
      li.textContent = aviso;
      return li;
    }),
  );
  warningsList.hidden = r.avisos.length === 0;

  const recortado = r.texto.length > PREVIEW_MAX_CHARS;
  outputEl.value = recortado ? r.texto.slice(0, PREVIEW_MAX_CHARS) : r.texto;
  // En .xlsx la vista previa es el CSV equivalente; no se copia porque el archivo es binario.
  copyBtn.hidden = r.tipo === 'xlsx';
  previewNote.hidden = !recortado;
  previewNote.textContent = recortado
    ? 'La vista previa muestra solo el comienzo. Descargá el archivo para tenerlo completo.'
    : '';

  if (urlDescarga) URL.revokeObjectURL(urlDescarga);
  // CSV con BOM UTF-8: Excel lo abre con acentos bien (ñ, á, é…).
  const contenido = r.tipo === 'csv' ? `﻿${r.texto}` : r.texto;
  const tipoMime = r.tipo === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8';
  urlDescarga = r.bytes
    ? URL.createObjectURL(new Blob([new Uint8Array(r.bytes)], { type: MIME_XLSX }))
    : URL.createObjectURL(new Blob([contenido], { type: tipoMime }));
  resultBox.hidden = false;
}

async function ejecutar(): Promise<void> {
  clearError(errorEl);
  ocultarResultado();
  runBtn.disabled = true;
  setStatus(statusEl, 'Convirtiendo…');
  try {
    // Deja que el navegador pinte el estado antes de la conversión (que es síncrona).
    await new Promise((resolve) => setTimeout(resolve, 0));
    mostrarResultado(await convertir());
    setStatus(statusEl, 'Listo. Revisá la vista previa y descargá el archivo.');
  } catch (e) {
    showError(errorEl, e instanceof ErrorDatos ? e.message : 'No se pudo convertir el archivo.');
    setStatus(statusEl, '');
  } finally {
    runBtn.disabled = archivo === null;
  }
}

function descargar(): void {
  if (!resultado || !urlDescarga) return;
  const enlace = document.createElement('a');
  enlace.href = urlDescarga;
  enlace.download = resultado.nombre;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
}

async function copiar(): Promise<void> {
  if (!resultado) return;
  try {
    await navigator.clipboard.writeText(resultado.texto);
    copyStatus.textContent = 'Copiado al portapapeles.';
  } catch {
    copyStatus.textContent = 'No se pudo copiar. Seleccioná el texto de la vista previa y copialo a mano.';
  }
}

modoSelect.addEventListener('change', () => {
  modo = modoActual();
  mostrarOpcionesDelModo();
  limpiarArchivo();
});

fileInput.addEventListener('change', () => void cargarArchivo(Array.from(fileInput.files ?? [])));
attachDropzone(dropzone, (files) => void cargarArchivo(files));
runBtn.addEventListener('click', () => void ejecutar());
clearBtn.addEventListener('click', limpiarArchivo);
downloadBtn.addEventListener('click', descargar);
copyBtn.addEventListener('click', () => void copiar());

modo = modoActual();
mostrarOpcionesDelModo();
