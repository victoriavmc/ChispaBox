/*
 * Proteger PDF con contraseña: cifra el PDF con AES-256 usando QPDF (WebAssembly).
 * Todo ocurre en el navegador: la contraseña y el archivo nunca salen de la pestaña.
 * Antes de ofrecer la descarga, se comprueba que el archivo se abre con la contraseña
 * y que no se abre sin ella.
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/proteger-pdf.css';
import { formatBytes } from '../shared/image-limits.ts';
import { baseNameOf, sanitizeBaseName } from '../shared/nombres-archivo.ts';
import { esFirmaPdf } from '../shared/unificar-pdf.ts';
import {
  PROTEGER_PDF_LIMITS,
  MENSAJE_YA_PROTEGIDO,
  argumentosComprobacion,
  codigoCorrecto,
  construirArgumentosCifrado,
  generarClaveDueno,
  mensajeDeError,
  nombreProtegido,
  validarClave,
} from '../shared/proteger-pdf.ts';
import { ejecutarQpdf } from '../lib/qpdf-runner.ts';
import { clearError, requireEl, setStatus, showError, triggerDownload } from '../lib/ui-common.ts';

const E = {
  requirements: requireEl<HTMLElement>('pp-requirements'),
  file: requireEl<HTMLInputElement>('pp-file'),
  dropzone: requireEl<HTMLElement>('pp-dropzone'),
  error: requireEl<HTMLElement>('pp-error'),
  info: requireEl<HTMLElement>('pp-info'),
  clave: requireEl<HTMLInputElement>('pp-clave'),
  clave2: requireEl<HTMLInputElement>('pp-clave2'),
  mostrar: requireEl<HTMLInputElement>('pp-mostrar'),
  claveMsg: requireEl<HTMLElement>('pp-clave-msg'),
  restringir: requireEl<HTMLInputElement>('pp-restringir'),
  actual: requireEl<HTMLInputElement>('pp-actual'),
  detalles: requireEl<HTMLDetailsElement>('pp-details'),
  nombre: requireEl<HTMLInputElement>('pp-nombre'),
  run: requireEl<HTMLButtonElement>('pp-run'),
  clear: requireEl<HTMLButtonElement>('pp-clear'),
  status: requireEl<HTMLElement>('pp-status'),
  results: requireEl<HTMLElement>('pp-results'),
};

interface Cargado {
  name: string;
  base: string;
  bytes: Uint8Array;
  size: number;
  /** true si el PDF ya tiene contraseña para abrirlo: hay que escribir la anterior. */
  cifrado: boolean;
}

let cargado: Cargado | null = null;
let ocupado = false;

function describirError(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo proteger el PDF.';
}

function claveValida(): boolean {
  return validarClave(E.clave.value, E.clave2.value) === null;
}

function actualizarEstado(): void {
  const hayArchivo = cargado !== null;
  E.clave.disabled = !hayArchivo || ocupado;
  E.clave2.disabled = !hayArchivo || ocupado;
  E.actual.disabled = !hayArchivo || ocupado;
  E.nombre.disabled = !hayArchivo || ocupado;
  E.run.disabled = !hayArchivo || ocupado || !claveValida();

  if (!E.clave.value && !E.clave2.value) {
    E.claveMsg.textContent = '';
    return;
  }
  const motivo = validarClave(E.clave.value, E.clave2.value);
  E.claveMsg.textContent = motivo ?? '✔ Las contraseñas coinciden y cumplen los requisitos.';
}

function ocultarResultado(): void {
  E.results.replaceChildren();
  E.results.hidden = true;
}

function mostrarInfo(item: Cargado): void {
  const filas: Array<[string, string]> = [
    ['Nombre', item.name],
    ['Peso', formatBytes(item.size)],
  ];
  E.info.replaceChildren(
    ...filas.flatMap(([label, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = value;
      return [dt, dd];
    }),
  );
  E.info.hidden = false;
}

async function cargar(file: File): Promise<void> {
  clearError(E.error);
  ocultarResultado();
  cargado = null;
  E.info.hidden = true;
  actualizarEstado();

  if (!/\.pdf$/i.test(file.name)) return showError(E.error, 'Formato no admitido. Elegí un archivo .pdf.');
  if (file.size < 1) return showError(E.error, 'El archivo está vacío (0 bytes). Elegí otro.');
  if (file.size > PROTEGER_PDF_LIMITS.maxBytes) {
    return showError(
      E.error,
      `El archivo pesa ${formatBytes(file.size)} y supera el máximo de ${formatBytes(PROTEGER_PDF_LIMITS.maxBytes)}.`,
    );
  }

  setStatus(E.status, 'Leyendo el PDF…');
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!esFirmaPdf(bytes)) throw new Error('El contenido no es un PDF: la firma no coincide con la extensión.');
    // Se comprueba sin contraseña: si QPDF pide una, el PDF ya está protegido.
    setStatus(E.status, 'Revisando si el PDF ya tiene contraseña…');
    const chequeo = await ejecutarQpdf({ '/c.pdf': bytes }, argumentosComprobacion('/c.pdf'));
    const mensaje = codigoCorrecto(chequeo.resultado.codigo)
      ? null
      : mensajeDeError(chequeo.resultado.salida, false);
    const cifrado = mensaje === MENSAJE_YA_PROTEGIDO;
    cargado = {
      name: file.name,
      base: sanitizeBaseName(baseNameOf(file.name), 'PDF'),
      bytes,
      size: file.size,
      cifrado,
    };
    E.nombre.value = nombreProtegido(cargado.base);
    mostrarInfo(cargado);
    if (cifrado) {
      // Muestra el error y abre el apartado para escribir la contraseña anterior.
      E.detalles.open = true;
      showError(E.error, MENSAJE_YA_PROTEGIDO);
    }
    setStatus(E.status, '');
  } catch (error) {
    cargado = null;
    showError(E.error, describirError(error));
    setStatus(E.status, '');
  }
  actualizarEstado();
}

async function proteger(): Promise<void> {
  const item = cargado;
  if (!item || ocupado) return;
  const clave = E.clave.value;
  const motivo = validarClave(clave, E.clave2.value);
  if (motivo) return showError(E.error, motivo);

  const actual = E.actual.value || undefined;
  if (item.cifrado && !actual) {
    E.detalles.open = true;
    E.actual.focus();
    return showError(E.error, MENSAJE_YA_PROTEGIDO);
  }

  clearError(E.error);
  ocultarResultado();
  ocupado = true;
  actualizarEstado();
  setStatus(E.status, 'Cifrando el PDF con AES-256 en tu navegador…');

  const nombre = sanitizeBaseName(E.nombre.value.trim() || nombreProtegido(item.base), nombreProtegido(item.base));
  try {
    const args = construirArgumentosCifrado({
      claveUsuario: clave,
      claveDueno: generarClaveDueno(),
      restringir: E.restringir.checked,
      claveOriginal: actual,
      entrada: '/entrada.pdf',
      salida: '/salida.pdf',
    });
    const { resultado, bytesSalida } = await ejecutarQpdf({ '/entrada.pdf': item.bytes }, args, '/salida.pdf');
    if (!codigoCorrecto(resultado.codigo) || !bytesSalida) {
      showError(E.error, mensajeDeError(resultado.salida, Boolean(actual)));
      setStatus(E.status, 'No se generó ningún archivo.');
      return;
    }

    setStatus(E.status, 'Comprobando que la contraseña funcione…');
    const conClave = await ejecutarQpdf({ '/c.pdf': bytesSalida }, argumentosComprobacion('/c.pdf', clave));
    const sinClave = await ejecutarQpdf({ '/c.pdf': bytesSalida }, argumentosComprobacion('/c.pdf'));
    if (!codigoCorrecto(conClave.resultado.codigo) || codigoCorrecto(sinClave.resultado.codigo)) {
      showError(E.error, 'La comprobación falló: no se generó el archivo para evitar entregar uno inseguro.');
      setStatus(E.status, 'No se generó ningún archivo.');
      return;
    }

    mostrarResultado(bytesSalida, nombre, Boolean(E.restringir.checked));
    E.clave.value = '';
    E.clave2.value = '';
    E.actual.value = '';
    setStatus(E.status, 'Listo: PDF protegido y comprobado.');
  } catch (error) {
    showError(E.error, describirError(error));
    setStatus(E.status, 'No se generó ningún archivo.');
  } finally {
    ocupado = false;
    actualizarEstado();
  }
}

function mostrarResultado(bytes: Uint8Array, base: string, restringido: boolean): void {
  E.results.replaceChildren();
  const heading = document.createElement('h3');
  heading.className = 'field-label';
  heading.textContent = 'Resultado';

  const card = document.createElement('article');
  card.className = 'img-result';
  const title = document.createElement('p');
  title.className = 'img-result__title';
  title.textContent = `✔ PDF protegido con AES-256 · ${formatBytes(bytes.length)}`;
  const check = document.createElement('p');
  check.className = 'tool-note';
  check.textContent =
    'Verificado: se abre con la contraseña y no se abre sin ella.' +
    (restringido ? ' Las restricciones de impresión, edición y copia quedaron activas.' : '');
  const aviso = document.createElement('p');
  aviso.className = 'tool-note';
  aviso.textContent = 'Compartí la contraseña por otro medio (por ejemplo, en persona o por un mensaje aparte del archivo).';
  card.append(title, check, aviso);

  const actions = document.createElement('div');
  actions.className = 'img-result__final rec-actions';
  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'btn btn--primary';
  download.textContent = 'Descargar PDF protegido';
  download.addEventListener('click', () => {
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' }));
    triggerDownload(url, `${base}.pdf`);
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });
  actions.append(download);

  E.results.append(heading, card, actions);
  E.results.hidden = false;
}

function limpiarPantalla(): void {
  if (ocupado) return;
  cargado = null;
  E.file.value = '';
  E.info.hidden = true;
  E.info.replaceChildren();
  E.clave.value = '';
  E.clave2.value = '';
  E.actual.value = '';
  E.nombre.value = '';
  E.restringir.checked = false;
  ocultarResultado();
  clearError(E.error);
  setStatus(E.status, '');
  actualizarEstado();
}

function init(): void {
  const lineas = [
    'Formato: .pdf.',
    `Peso permitido: hasta ${formatBytes(PROTEGER_PDF_LIMITS.maxBytes)}.`,
    'La contraseña y el archivo se procesan en tu navegador; no se envían ni se guardan.',
    'Si el PDF ya tiene contraseña, escribí la anterior en el apartado correspondiente.',
  ];
  E.requirements.replaceChildren(
    ...lineas.map((texto) => {
      const li = document.createElement('li');
      li.textContent = texto;
      return li;
    }),
  );

  E.file.addEventListener('change', () => {
    const file = E.file.files?.[0];
    if (file) void cargar(file);
  });
  E.dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    E.dropzone.classList.add('is-dragover');
  });
  E.dropzone.addEventListener('dragleave', () => E.dropzone.classList.remove('is-dragover'));
  E.dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    E.dropzone.classList.remove('is-dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) void cargar(file);
  });

  for (const campo of [E.clave, E.clave2]) campo.addEventListener('input', actualizarEstado);
  // Al escribir la contraseña anterior, se quita el aviso de «ya tiene contraseña» que quedó en pantalla.
  E.actual.addEventListener('input', () => {
    if (E.error.textContent === MENSAJE_YA_PROTEGIDO && E.actual.value) clearError(E.error);
    actualizarEstado();
  });
  E.mostrar.addEventListener('change', () => {
    const tipo = E.mostrar.checked ? 'text' : 'password';
    E.clave.type = tipo;
    E.clave2.type = tipo;
    E.actual.type = tipo;
  });

  E.run.addEventListener('click', () => void proteger());
  E.clear.addEventListener('click', limpiarPantalla);
  actualizarEstado();
}

init();
