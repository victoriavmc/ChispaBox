/*
 * Página «Comprimir PDF»: cada página se dibuja con PDF.js, se guarda como JPEG del nivel elegido
 * y se arma un PDF nuevo con pdf-lib. Si el resultado no pesa menos, no se entrega.
 * Todo ocurre en el navegador: el archivo no se sube a ningún servidor.
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/dividir-pdf.css';
import { formatBytes } from '../shared/image-limits.ts';
import { baseNameOf, sanitizeBaseName } from '../shared/nombres-archivo.ts';
import { esFirmaPdf } from '../shared/unificar-pdf.ts';
import {
  COMPRIMIR_LIMITS,
  NIVELES,
  NIVEL_ESTRUCTURA,
  construirPdfImagenes,
  optimizarEstructura,
  decidirEntrega,
  escalaParaDpi,
  type NivelCompresion,
  type PaginaImagen,
} from '../shared/comprimir-pdf.ts';
import { openPdf, type OpenedPdf } from '../lib/pdf-viewer.ts';
import { clearError, requireEl, setStatus, showError, triggerDownload } from '../lib/ui-common.ts';

const E = {
  requirements: requireEl<HTMLElement>('comp-requirements'),
  file: requireEl<HTMLInputElement>('comp-file'),
  dropzone: requireEl<HTMLElement>('comp-dropzone'),
  error: requireEl<HTMLElement>('comp-error'),
  info: requireEl<HTMLElement>('comp-info'),
  levelNote: requireEl<HTMLElement>('comp-level-note'),
  nivelEstructura: requireEl<HTMLInputElement>('comp-nivel-estructura'),
  nivelCorreo: requireEl<HTMLInputElement>('comp-nivel-correo'),
  nivelImpresion: requireEl<HTMLInputElement>('comp-nivel-impresion'),
  nameInput: requireEl<HTMLInputElement>('comp-nombre'),
  run: requireEl<HTMLButtonElement>('comp-run'),
  clear: requireEl<HTMLButtonElement>('comp-clear'),
  progressWrap: requireEl<HTMLElement>('comp-progress-wrap'),
  progress: requireEl<HTMLProgressElement>('comp-progress'),
  progressText: requireEl<HTMLElement>('comp-progress-text'),
  status: requireEl<HTMLElement>('comp-status'),
  results: requireEl<HTMLElement>('comp-results'),
};

interface Loaded {
  name: string;
  base: string;
  bytes: Uint8Array;
  size: number;
  paginas: number;
  preview: OpenedPdf;
}

let loaded: Loaded | null = null;
let busy = false;

function nivelActual(): NivelCompresion {
  if (E.nivelEstructura.checked) return 'estructura';
  return E.nivelImpresion.checked ? 'impresion' : 'correo';
}

function etiquetaNivel(nivel: NivelCompresion): string {
  return nivel === 'estructura' ? 'sin pérdida' : nivel === 'correo' ? 'correo' : 'impresión';
}

function describeError(error: unknown): string {
  if (error && typeof error === 'object' && 'name' in error && (error as { name: string }).name === 'PasswordException') {
    return 'El PDF está protegido con contraseña y no se puede comprimir.';
  }
  return error instanceof Error ? error.message : 'No se pudo procesar el PDF.';
}

function resetResults(): void {
  E.results.replaceChildren();
  E.results.hidden = true;
}

function updateLevel(): void {
  const nivel = nivelActual();
  E.levelNote.textContent = nivel === 'estructura' ? NIVEL_ESTRUCTURA.nota : NIVELES[nivel].nota;
  if (loaded) E.nameInput.value = `${loaded.base} - ${etiquetaNivel(nivel)}`;
  resetResults();
}

async function cargar(file: File): Promise<void> {
  clearError(E.error);
  resetResults();
  closeLoaded();
  E.run.disabled = true;
  E.info.hidden = true;

  if (!/\.pdf$/i.test(file.name)) return showError(E.error, 'Formato no admitido. Elegí un archivo .pdf.');
  if (file.size < 1) return showError(E.error, 'El archivo está vacío (0 bytes). Elegí otro.');
  if (file.size > COMPRIMIR_LIMITS.maxBytes) {
    return showError(E.error, `El archivo pesa ${formatBytes(file.size)} y supera el máximo de ${formatBytes(COMPRIMIR_LIMITS.maxBytes)}.`);
  }

  setStatus(E.status, 'Leyendo el PDF…');
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (!esFirmaPdf(bytes)) throw new Error('El contenido no es un PDF: la firma no coincide con la extensión.');
    const preview = await openPdf(bytes);
    const paginas = preview.doc.numPages;
    if (paginas > COMPRIMIR_LIMITS.maxPaginas) {
      await preview.close();
      throw new Error(`El PDF tiene ${paginas} páginas; el máximo para comprimir es ${COMPRIMIR_LIMITS.maxPaginas}.`);
    }
    loaded = {
      name: file.name,
      base: sanitizeBaseName(baseNameOf(file.name), 'PDF'),
      bytes,
      size: file.size,
      paginas,
      preview,
    };
    E.nameInput.value = `${loaded.base} - ${etiquetaNivel(nivelActual())}`;
    E.info.replaceChildren(
      ...[
        ['Nombre', file.name],
        ['Peso', formatBytes(file.size)],
        ['Páginas', String(paginas)],
      ].flatMap(([label, value]) => {
        const dt = document.createElement('dt');
        dt.textContent = label ?? '';
        const dd = document.createElement('dd');
        dd.textContent = value ?? '';
        return [dt, dd];
      }),
    );
    E.info.hidden = false;
    E.run.disabled = false;
    setStatus(E.status, '');
  } catch (error) {
    setStatus(E.status, '');
    showError(E.error, describeError(error));
  }
}

function closeLoaded(): void {
  if (!loaded) return;
  const previous = loaded;
  loaded = null;
  void previous.preview.close();
}

/** Evita que una página que no termina de dibujarse deje la página trabada para siempre. */
function conTiempo<T>(promesa: Promise<T>, ms: number, mensaje: string): Promise<T> {
  let timer: number | undefined;
  const limite = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(mensaje)), ms);
  });
  return Promise.race([promesa, limite]).finally(() => window.clearTimeout(timer));
}

/** Dibuja cada página al nivel elegido y la guarda como JPEG. */
async function dibujarPaginas(item: Loaded, dpi: number, calidad: number): Promise<PaginaImagen[]> {
  const paginas: PaginaImagen[] = [];
  const doc = item.preview.doc;
  for (let n = 1; n <= doc.numPages; n += 1) {
    E.progress.value = (n - 1) / doc.numPages;
    setStatus(E.progressText, `Página ${n} de ${doc.numPages}`);
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: escalaParaDpi(dpi, base.width, base.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('El navegador no permite dibujar la página.');
    // Fondo blanco: sin esto, las zonas transparentes del PDF saldrían negras en el JPEG.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await conTiempo(
      page.render({ canvasContext: ctx, viewport, canvas }).promise,
      30_000,
      `La página ${n} tardó demasiado en dibujarse. No se generó ningún archivo.`,
    );
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', calidad));
    if (!blob) throw new Error('El navegador no pudo codificar una página como JPEG.');
    paginas.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), anchoPt: base.width, altoPt: base.height });
    page.cleanup();
    canvas.width = 0;
    canvas.height = 0;
  }
  return paginas;
}

async function comprimir(): Promise<void> {
  if (!loaded || busy) return;
  clearError(E.error);
  resetResults();
  const item = loaded;
  const nivel = nivelActual();

  busy = true;
  E.run.disabled = true;
  E.clear.disabled = true;
  E.progressWrap.hidden = false;
  E.progress.value = 0;
  setStatus(E.status, 'Comprimiendo en tu navegador…');

  try {
    let salida: Uint8Array;
    if (nivel === 'estructura') {
      setStatus(E.progressText, 'Reescribiendo el archivo…');
      salida = await optimizarEstructura(item.bytes);
    } else {
      const cfg = NIVELES[nivel];
      const paginas = await dibujarPaginas(item, cfg.dpi, cfg.calidad);
      setStatus(E.progressText, 'Armando el PDF…');
      salida = await construirPdfImagenes(paginas);
    }
    const decision = decidirEntrega(item.size, salida.length);
    if (!decision.ok) {
      showError(
        E.error,
        nivel === 'correo'
          ? 'Ni con el nivel para correo el PDF quedó más liviano: tiene poco contenido que comprimir (por ejemplo, texto vectorial). No se entrega ningún archivo; el original sigue igual.'
          : nivel === 'impresion'
            ? 'Con el nivel para imprimir el PDF no quedó más liviano que el original. Probá el nivel para correo o conservá el original.'
            : 'Este PDF ya está bien optimizado: reescribirlo no lo hizo más liviano. No se entrega ningún archivo; el original sigue igual.',
      );
      setStatus(E.status, 'No se entregó ningún archivo.');
      return;
    }
    const nombre = sanitizeBaseName(
      E.nameInput.value.trim() || `${item.base} - ${etiquetaNivel(nivel)}`,
      `${item.base} - ${etiquetaNivel(nivel)}`,
    );
    mostrarResultado(salida, nombre, item.size, decision.ahorro);
    setStatus(E.status, `Listo: el PDF pesa ${decision.ahorro}% menos.`);
  } catch (error) {
    showError(E.error, describeError(error));
    setStatus(E.status, 'La compresión no terminó. No se generó ningún archivo.');
  } finally {
    busy = false;
    E.progressWrap.hidden = true;
    E.clear.disabled = false;
    E.run.disabled = !loaded;
  }
}

function mostrarResultado(bytes: Uint8Array, base: string, original: number, ahorro: number): void {
  E.results.replaceChildren();
  const heading = document.createElement('h3');
  heading.className = 'field-label';
  heading.textContent = 'Resultado';
  const card = document.createElement('article');
  card.className = 'img-result';
  const title = document.createElement('p');
  title.className = 'img-result__title';
  title.textContent = `✔ ${formatBytes(original)} → ${formatBytes(bytes.length)} (${ahorro}% menos)`;
  card.append(title);

  const actions = document.createElement('div');
  actions.className = 'img-result__final rec-actions';
  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'btn btn--primary';
  download.textContent = 'Descargar PDF comprimido';
  download.addEventListener('click', () => {
    const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, `${base}.pdf`);
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });
  actions.append(download);
  E.results.append(heading, card, actions);
  E.results.hidden = false;
}

function limpiar(): void {
  if (busy) return;
  closeLoaded();
  E.file.value = '';
  E.info.hidden = true;
  E.info.replaceChildren();
  E.run.disabled = true;
  resetResults();
  clearError(E.error);
  setStatus(E.status, '');
}

function renderRequirements(): void {
  const lines = [
    'Formato: .pdf sin contraseña.',
    `Peso permitido: hasta ${formatBytes(COMPRIMIR_LIMITS.maxBytes)}.`,
    `Páginas permitidas: hasta ${COMPRIMIR_LIMITS.maxPaginas}.`,
    'El archivo original nunca se modifica ni se sube a ningún servidor.',
  ];
  E.requirements.replaceChildren(
    ...lines.map((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      return li;
    }),
  );
}

function init(): void {
  renderRequirements();
  updateLevel();
  E.nivelCorreo.addEventListener('change', updateLevel);
  E.nivelImpresion.addEventListener('change', updateLevel);
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
  E.run.addEventListener('click', () => void comprimir());
  E.clear.addEventListener('click', limpiar);
}

init();
