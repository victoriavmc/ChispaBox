/*
 * Formatear y validar JSON/XML. Todo ocurre en el navegador: sin subir archivos, sin IA y sin dependencias.
 * JSON: validador propio (src/lib/formato-json-xml.ts) con línea y columna del error.
 * XML: DOMParser nativo (no ejecuta scripts ni carga recursos); se rechazan DTD y entidades.
 */
import '../styles/grabar-audio.css';
import '../styles/image-tools.css';
import '../styles/formato-json-xml.css';

import {
  ErrorFormato,
  FORMATO_LIMITS,
  comprobarJson,
  construirVistaError,
  declaracionXml,
  type FilaVista,
  detectarTipo,
  errorXmlDesdeMensaje,
  formatearJson,
  formatearXml,
  repararJson,
  rechazarDtd,
  sangriaXml,
  type NodoXmlFormato,
  type TipoFormato,
} from '../lib/formato-json-xml';
import { clearError, requireEl, setStatus, showError } from '../lib/ui-common';
import { formatBytes } from '../shared/image-limits';

type Modo = 'auto' | TipoFormato;

interface Resultado {
  texto: string;
  tipo: TipoFormato;
}

const tipoSelect = requireEl<HTMLSelectElement>('fx-tipo');
const archivoInput = requireEl<HTMLInputElement>('fx-archivo');
const archivoError = requireEl<HTMLElement>('fx-archivo-error');
const entrada = requireEl<HTMLTextAreaElement>('fx-entrada');
const validarBtn = requireEl<HTMLButtonElement>('fx-validar');
const formatearBtn = requireEl<HTMLButtonElement>('fx-formatear');
const limpiarBtn = requireEl<HTMLButtonElement>('fx-limpiar');
const estado = requireEl<HTMLElement>('fx-estado');
const errorBox = requireEl<HTMLElement>('fx-error');
const errorTitulo = requireEl<HTMLElement>('fx-error-titulo');
const errorDetalle = requireEl<HTMLElement>('fx-error-detalle');
const extracto = requireEl<HTMLElement>('fx-extracto');
const okBox = requireEl<HTMLElement>('fx-ok');
const okTitulo = requireEl<HTMLElement>('fx-ok-titulo');
const okDetalle = requireEl<HTMLElement>('fx-ok-detalle');
const salidaPanel = requireEl<HTMLElement>('fx-salida-panel');
const salidaEl = requireEl<HTMLTextAreaElement>('fx-salida');
const descargarBtn = requireEl<HTMLButtonElement>('fx-descargar');
const copiarBtn = requireEl<HTMLButtonElement>('fx-copiar');
const copiaEstado = requireEl<HTMLElement>('fx-copia-estado');
const cambiosList = requireEl<HTMLUListElement>('fx-cambios');
const deshacerBtn = requireEl<HTMLButtonElement>('fx-deshacer');

const vivo = requireEl<HTMLElement>('fx-vivo');

let resultado: Resultado | null = null;
/** true cuando el texto vino de un archivo: el error se marca con «$Error$» para ubicarlo rápido. */
let origenArchivo = false;
let temporizador: number | undefined;

function modoActual(): Modo {
  return tipoSelect.value === 'json' || tipoSelect.value === 'xml' ? tipoSelect.value : 'auto';
}

/** Tipo elegido o, en modo automático, el detectado. Null si no se puede reconocer. */
function tipoEfectivo(texto: string): TipoFormato | null {
  const modo = modoActual();
  return modo === 'auto' ? detectarTipo(texto) : modo;
}

/** Sangría fija de 2 espacios: la página ya no ofrece opciones de formato. */
const SANGRIA = 2;

function ocultarResultados(): void {
  errorBox.hidden = true;
  extracto.hidden = true;
  extracto.replaceChildren();
  okBox.hidden = true;
  cambiosList.replaceChildren();
  cambiosList.hidden = true;
  deshacerBtn.hidden = true;
  salidaPanel.hidden = true;
  salidaEl.value = '';
  copiaEstado.textContent = '';
  resultado = null;
}

/** Muestra las filas con su número de línea; el carácter con error va marcado en rojo. */
function pintarExtracto(filas: FilaVista[], marcaTexto: boolean): void {
  const ancho = String(Math.max(...filas.map((f) => f.numero))).length;
  extracto.replaceChildren(
    ...filas.map((f) => {
      const fila = document.createElement('span');
      fila.className = f.errorEn === null ? 'fx-linea' : 'fx-linea fx-linea--error';
      const numero = document.createElement('span');
      numero.className = 'fx-num';
      numero.textContent = String(f.numero).padStart(ancho, ' ');
      fila.append(numero, '  ');
      if (f.errorEn === null) {
        fila.append(f.texto);
      } else {
        const marca = document.createElement('mark');
        marca.className = 'fx-error-char';
        if (marcaTexto) {
          // Archivo: se inserta «$Error$» justo antes del carácter con error.
          marca.textContent = '$Error$';
          fila.append(f.texto.slice(0, f.errorEn), marca, f.texto.slice(f.errorEn));
        } else {
          marca.textContent = f.texto.charAt(f.errorEn);
          fila.append(f.texto.slice(0, f.errorEn), marca, f.texto.slice(f.errorEn + 1));
        }
      }
      return fila;
    }),
  );
  extracto.hidden = false;
}

function mostrarError(error: ErrorFormato, tipo: TipoFormato | null, texto: string): void {
  errorTitulo.textContent = tipo ? `Hay un error en el ${tipo.toUpperCase()}` : 'No se reconoce el contenido';
  if (error.linea !== null && error.columna !== null) {
    errorDetalle.textContent = `Línea ${error.linea}, columna ${error.columna}: ${error.message}`;
    pintarExtracto(construirVistaError(texto, error.linea, error.columna), origenArchivo);
  } else {
    errorDetalle.textContent = error.message;
    extracto.hidden = true;
  }
  errorBox.hidden = false;
  setStatus(estado, 'No se pudo completar. Revisá el error marcado.');
}

function mostrarOk(titulo: string, detalle: string): void {
  okTitulo.textContent = titulo;
  okDetalle.textContent = detalle;
  okBox.hidden = false;
}

/** Mensaje cuando no se puede saber si es JSON o XML. */
const MENSAJE_NO_RECONOCIDO =
  'No pude saber si es JSON o XML. Un JSON empieza con «{» o «[»; un XML, con «<».';

/** Comprueba JSON o XML. Devuelve el error (con posición si se conoce) o null si el texto es válido. */
function comprobar(texto: string, tipo: TipoFormato | null): ErrorFormato | null {
  if (texto.trim() === '') return new ErrorFormato('El texto está vacío.');
  if (tipo === null) return new ErrorFormato(MENSAJE_NO_RECONOCIDO);
  if (tipo === 'json') return comprobarJson(texto);
  return comprobarXml(texto);
}

function comprobarXml(texto: string): ErrorFormato | null {
  try {
    rechazarDtd(texto);
  } catch (e) {
    return e instanceof ErrorFormato ? e : new ErrorFormato('El XML no se pudo leer.');
  }
  const doc = new DOMParser().parseFromString(texto, 'application/xml');
  const fallo = doc.getElementsByTagName('parsererror')[0];
  if (fallo || !doc.documentElement) {
    return errorXmlDesdeMensaje(fallo?.textContent ?? 'XML Parsing Error');
  }
  return null;
}

/** Formatea el texto. Lanza ErrorFormato si no es válido. */
function formatear(texto: string, tipo: TipoFormato): Resultado {
  if (tipo === 'json') {
    return { texto: formatearJson(texto, { sangria: SANGRIA, ordenarClaves: false }), tipo };
  }
  const error = comprobarXml(texto);
  if (error) throw error;
  const doc = new DOMParser().parseFromString(texto, 'application/xml');
  // El documento completo incluye comentarios y PI antes y después del elemento raíz.
  // La declaración <?xml ?> no es nodo en el DOM: se toma del texto original.
  return {
    texto: formatearXml(doc as unknown as NodoXmlFormato, declaracionXml(texto), sangriaXml(SANGRIA)),
    tipo,
  };
}

function validar(): void {
  ocultarResultados();
  clearError(archivoError);
  const texto = entrada.value;
  const tipo = tipoEfectivo(texto);
  const error = comprobar(texto, tipo);
  if (error || tipo === null) {
    mostrarError(error ?? new ErrorFormato(MENSAJE_NO_RECONOCIDO), tipo, texto);
    return;
  }
  mostrarOk(
    `${tipo.toUpperCase()} válido`,
    `Detectado automáticamente como ${tipo.toUpperCase()}. El contenido está bien formado (${texto.split('\n').length} líneas).`,
  );
  setStatus(estado, 'Listo: el contenido es válido.');
}

function formatearTexto(): void {
  ocultarResultados();
  clearError(archivoError);
  const texto = entrada.value;
  const tipo = tipoEfectivo(texto);
  if (texto.trim() === '' || tipo === null) {
    mostrarError(new ErrorFormato(texto.trim() === '' ? 'El texto está vacío.' : MENSAJE_NO_RECONOCIDO), tipo, texto);
    return;
  }
  if (tipo === 'json') {
    formatearJsonConCorreccion(texto);
    return;
  }
  try {
    const r = formatear(texto, tipo);
    resultado = r;
    salidaEl.value = r.texto;
    salidaPanel.hidden = false;
    mostrarOk(`${tipo.toUpperCase()} formateado`, `${r.texto.split('\n').length} líneas en el resultado.`);
    setStatus(estado, 'Listo. Revisá el resultado y descargalo o copialo.');
  } catch (e) {
    if (e instanceof ErrorFormato) {
      mostrarError(e, tipo, texto);
    } else {
      showError(errorBox, 'No se pudo formatear el contenido.');
      setStatus(estado, '');
    }
  }
}

/** Muestra el estado del texto mientras se escribe (sin el panel grande de resultado). */
function actualizarVivo(): void {
  const texto = entrada.value;
  if (texto.trim() === '') {
    vivo.hidden = true;
    return;
  }
  const tipo = tipoEfectivo(texto);
  const error = comprobar(texto, tipo);
  vivo.hidden = false;
  if (error) {
    vivo.className = 'fx-vivo fx-vivo--error';
    vivo.textContent =
      error.linea !== null && error.columna !== null
        ? `Línea ${error.linea}, columna ${error.columna}: ${error.message}`
        : error.message;
  } else {
    vivo.className = 'fx-vivo fx-vivo--ok';
    vivo.textContent = `${(tipo ?? '').toUpperCase()} válido`;
  }
}

/**
 * JSON: corrige los errores simples, formatea y dice qué cambió.
 * El texto de la entrada no se modifica; «Volver al original» regresa a la vista del error.
 */
function formatearJsonConCorreccion(texto: string): void {
  const reparado = repararJson(texto);
  if (reparado.error) {
    mostrarError(reparado.error, 'json', reparado.texto);
    return;
  }
  const salida = formatearJson(reparado.texto, { sangria: SANGRIA, ordenarClaves: false });
  resultado = { texto: salida, tipo: 'json' };
  salidaEl.value = salida;
  salidaPanel.hidden = false;
  const lineas = salida.split('\n').length;
  if (reparado.cambios.length === 0) {
    mostrarOk('JSON formateado', `${lineas} líneas en el resultado.`);
    setStatus(estado, 'Listo. Revisá el resultado y descargalo o copialo.');
    return;
  }
  const n = reparado.cambios.length;
  mostrarOk(
    'JSON corregido y formateado',
    `Corregí ${n} ${n === 1 ? 'cosa' : 'cosas'} (${lineas} líneas). Revisá la lista; el texto original no cambió.`,
  );
  cambiosList.replaceChildren(
    ...reparado.cambios.map((c) => {
      const li = document.createElement('li');
      li.textContent = c;
      return li;
    }),
  );
  cambiosList.hidden = false;
  deshacerBtn.hidden = false;
  setStatus(estado, 'Listo. Corregí el JSON; revisá los cambios antes de usarlo.');
}

deshacerBtn.addEventListener('click', () => {
  ocultarResultados();
  validar();
  setStatus(estado, 'Volviste al texto original. No se modificó nada.');
});

async function cargarArchivo(): Promise<void> {
  const archivo = archivoInput.files?.[0];
  if (!archivo) return;
  clearError(archivoError);
  ocultarResultados();
  if (archivo.size > FORMATO_LIMITS.maxBytes) {
    showError(
      archivoError,
      `El archivo pesa ${formatBytes(archivo.size)} y el máximo es ${formatBytes(FORMATO_LIMITS.maxBytes)}.`,
    );
    archivoInput.value = '';
    return;
  }
  const texto = await archivo.text();
  entrada.value = texto;
  origenArchivo = true;
  actualizarVivo();
  validar();
}

function descargar(): void {
  if (!resultado) return;
  const extension = resultado.tipo;
  const tipoMime = resultado.tipo === 'json' ? 'application/json;charset=utf-8' : 'application/xml;charset=utf-8';
  const url = URL.createObjectURL(new Blob([resultado.texto], { type: tipoMime }));
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = `formateado.${extension}`;
  document.body.append(enlace);
  enlace.click();
  enlace.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function copiar(): Promise<void> {
  if (!resultado) return;
  try {
    await navigator.clipboard.writeText(resultado.texto);
    copiaEstado.textContent = 'Copiado al portapapeles.';
  } catch {
    copiaEstado.textContent = 'No se pudo copiar. Seleccioná el texto del resultado y copialo a mano.';
  }
}

function limpiar(): void {
  entrada.value = '';
  archivoInput.value = '';
  origenArchivo = false;
  vivo.hidden = true;
  clearError(archivoError);
  ocultarResultados();
  setStatus(estado, '');
  entrada.focus();
}

validarBtn.addEventListener('click', validar);
formatearBtn.addEventListener('click', formatearTexto);
limpiarBtn.addEventListener('click', limpiar);
archivoInput.addEventListener('change', () => void cargarArchivo());
descargarBtn.addEventListener('click', descargar);
copiarBtn.addEventListener('click', () => void copiar());
entrada.addEventListener('input', () => {
  origenArchivo = false;
  ocultarResultados();
  setStatus(estado, '');
  window.clearTimeout(temporizador);
  temporizador = window.setTimeout(actualizarVivo, 250);
});
