/*
 * Página «Eliminar metadatos»: muestra lo que el archivo guarda sobre sí mismo (PDF, JPG, PNG o WebP)
 * y descarga una copia sin esa información. Todo ocurre en el navegador, sin librerías de IA ni servidor.
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import { formatBytes, IMAGE_LIMITS } from '../shared/image-limits.ts';
import { baseNameOf, sanitizeBaseName } from '../shared/nombres-archivo.ts';
import { esFirmaPdf } from '../shared/unificar-pdf.ts';
import { leerMetadatos, limpiarMetadatos, type MetadatosPdf } from '../shared/eliminar-metadatos.ts';
import {
  formatoImagenPorFirma,
  leerMetadatosImagen,
  limpiarMetadatosImagen,
  quedanDatosImagen,
  type FormatoImagen,
  type MetadatosImagen,
} from '../shared/eliminar-metadatos-imagen.ts';
import { clearError, requireEl, setStatus, showError, triggerDownload } from '../lib/ui-common.ts';

const MAX_PDF_BYTES = 100 * 1024 * 1024;
const MAX_IMAGE_BYTES = IMAGE_LIMITS.maxBytes;

const IMAGE_MIME: Record<FormatoImagen, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };
const IMAGE_EXT: Record<FormatoImagen, string> = { jpeg: 'jpg', png: 'png', webp: 'webp' };
const IMAGE_NOMBRE: Record<FormatoImagen, string> = { jpeg: 'JPG', png: 'PNG', webp: 'WebP' };

const E = {
  requirements: requireEl<HTMLElement>('meta-requirements'),
  file: requireEl<HTMLInputElement>('meta-file'),
  dropzone: requireEl<HTMLElement>('meta-dropzone'),
  error: requireEl<HTMLElement>('meta-error'),
  info: requireEl<HTMLElement>('meta-info'),
  nameInput: requireEl<HTMLInputElement>('meta-nombre'),
  run: requireEl<HTMLButtonElement>('meta-run'),
  clear: requireEl<HTMLButtonElement>('meta-clear'),
  status: requireEl<HTMLElement>('meta-status'),
  results: requireEl<HTMLElement>('meta-results'),
};

type Loaded =
  | { tipo: 'pdf'; name: string; base: string; bytes: Uint8Array; size: number }
  | { tipo: 'imagen'; name: string; base: string; bytes: Uint8Array; size: number; formato: FormatoImagen };

let loaded: Loaded | null = null;
let busy = false;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo leer el archivo.';
}

function resetResults(): void {
  E.results.replaceChildren();
  E.results.hidden = true;
}

function filasPdf(m: MetadatosPdf): Array<[string, string]> {
  return [
    ['Título', m.titulo],
    ['Autor', m.autor],
    ['Asunto', m.asunto],
    ['Palabras clave', m.palabrasClave],
    ['Programa que lo creó', m.creador],
    ['Programa que lo generó (productor)', m.productor],
    ['Fecha de creación', m.creado],
    ['Última modificación', m.modificado],
    ['Archivos adjuntos', String(m.adjuntos)],
    ['Anotaciones con autor o fecha', String(m.anotacionesConAutor)],
  ];
}

function filasImagen(m: MetadatosImagen): Array<[string, string]> {
  const si = (v: boolean): string => (v ? 'Sí' : 'No');
  return [
    ['Ubicación GPS', si(m.gps)],
    ['Cámara o dispositivo', m.camara ?? '—'],
    ['Fecha de captura', m.fecha ?? '—'],
    ['Bloque EXIF (datos de la cámara)', si(m.exif)],
    ['Metadatos XMP', si(m.xmp)],
    ['Bloque IPTC o de Photoshop', si(m.iptc)],
    ['Comentarios o textos incrustados', String(m.textos)],
  ];
}

function mostrarInfo(item: Loaded, filas: Array<[string, string]>): void {
  const rows: Array<[string, string]> = [['Nombre', item.name], ['Peso', formatBytes(item.size)], ...filas];
  E.info.replaceChildren(
    ...rows.flatMap(([label, value]) => {
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
  resetResults();
  loaded = null;
  E.info.hidden = true;
  E.run.disabled = true;

  if (file.size < 1) return showError(E.error, 'El archivo está vacío (0 bytes). Elegí otro.');
  const esPdfPorNombre = /\.pdf$/i.test(file.name);
  const esImagenPorNombre = /\.(jpe?g|png|webp)$/i.test(file.name);
  if (!esPdfPorNombre && !esImagenPorNombre) {
    return showError(E.error, 'Formato no admitido. Elegí un PDF, JPG, PNG o WebP.');
  }

  setStatus(E.status, 'Leyendo el archivo…');
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const base = sanitizeBaseName(baseNameOf(file.name), esPdfPorNombre ? 'PDF' : 'imagen');

    if (esPdfPorNombre) {
      if (file.size > MAX_PDF_BYTES) {
        throw new Error(`El PDF pesa ${formatBytes(file.size)} y supera el máximo de ${formatBytes(MAX_PDF_BYTES)}.`);
      }
      if (!esFirmaPdf(bytes)) throw new Error('El contenido no es un PDF: la firma no coincide con la extensión.');
      const metadatos = await leerMetadatos(bytes);
      loaded = { tipo: 'pdf', name: file.name, base, bytes, size: file.size };
      mostrarInfo(loaded, filasPdf(metadatos));
    } else {
      if (file.size > MAX_IMAGE_BYTES) {
        throw new Error(`La imagen pesa ${formatBytes(file.size)} y supera el máximo de ${formatBytes(MAX_IMAGE_BYTES)}.`);
      }
      const formato = formatoImagenPorFirma(bytes);
      if (!formato) throw new Error('El contenido no es una imagen JPG, PNG o WebP: la firma no coincide con la extensión.');
      const metadatos = leerMetadatosImagen(bytes);
      loaded = { tipo: 'imagen', name: file.name, base, bytes, size: file.size, formato };
      mostrarInfo(loaded, [['Formato real (por firma)', IMAGE_NOMBRE[formato]], ...filasImagen(metadatos)]);
    }

    E.nameInput.value = `${loaded.base} - sin metadatos`;
    E.run.disabled = false;
    setStatus(E.status, '');
  } catch (error) {
    setStatus(E.status, '');
    showError(E.error, describeError(error));
  }
}

async function limpiar(): Promise<void> {
  if (!loaded || busy) return;
  clearError(E.error);
  resetResults();
  busy = true;
  E.run.disabled = true;
  E.clear.disabled = true;
  setStatus(E.status, 'Eliminando metadatos en tu navegador…');
  try {
    const item = loaded;
    const nombre = sanitizeBaseName(E.nameInput.value.trim() || `${item.base} - sin metadatos`, `${item.base} - sin metadatos`);
    if (item.tipo === 'pdf') {
      const { bytes, paginas } = await limpiarMetadatos(item.bytes);
      const verificado = await leerMetadatos(bytes);
      mostrarResultado({
        bytes,
        nombre,
        mime: 'application/pdf',
        extension: 'pdf',
        titulo: `✔ Copia sin metadatos: ${paginas} página(s), ${formatBytes(bytes.length)}`,
        verificacion: verificarPdf(verificado),
      });
    } else {
      const { bytes, formato } = limpiarMetadatosImagen(item.bytes);
      const verificado = leerMetadatosImagen(bytes);
      mostrarResultado({
        bytes,
        nombre,
        mime: IMAGE_MIME[formato],
        extension: IMAGE_EXT[formato],
        titulo: `✔ Copia sin metadatos: ${IMAGE_NOMBRE[formato]}, ${formatBytes(bytes.length)}. Los píxeles no cambiaron.`,
        verificacion: verificarImagen(verificado),
      });
    }
    setStatus(E.status, 'Listo: copia sin metadatos.');
  } catch (error) {
    showError(E.error, describeError(error));
    setStatus(E.status, 'No se generó ningún archivo.');
  } finally {
    busy = false;
    E.clear.disabled = false;
    E.run.disabled = !loaded;
  }
}

function verificarPdf(m: MetadatosPdf): string {
  const quedan = [m.titulo, m.autor, m.creador, m.productor].filter((v) => v !== '—').length;
  return quedan === 0
    ? 'Verificado: título, autor, programa creador y productor quedaron vacíos.'
    : 'Atención: todavía quedan algunas propiedades. Revisá el archivo antes de compartirlo.';
}

function verificarImagen(m: MetadatosImagen): string {
  return quedanDatosImagen(m)
    ? 'Atención: todavía quedan datos en la imagen. Revisá el archivo antes de compartirlo.'
    : 'Verificado: no quedan datos de cámara, fecha, GPS, XMP ni textos. Solo se conserva la orientación de la foto.';
}

interface ResultadoVista {
  bytes: Uint8Array;
  nombre: string;
  mime: string;
  extension: string;
  titulo: string;
  verificacion: string;
}

function mostrarResultado(r: ResultadoVista): void {
  E.results.replaceChildren();
  const heading = document.createElement('h3');
  heading.className = 'field-label';
  heading.textContent = 'Resultado';
  const card = document.createElement('article');
  card.className = 'img-result';
  const title = document.createElement('p');
  title.className = 'img-result__title';
  title.textContent = r.titulo;
  const check = document.createElement('p');
  check.className = 'tool-note';
  check.textContent = r.verificacion;
  card.append(title, check);

  const actions = document.createElement('div');
  actions.className = 'img-result__final rec-actions';
  const download = document.createElement('button');
  download.type = 'button';
  download.className = 'btn btn--primary';
  download.textContent = `Descargar ${r.extension.toUpperCase()} sin metadatos`;
  download.addEventListener('click', () => {
    const blob = new Blob([r.bytes as BlobPart], { type: r.mime });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, `${r.nombre}.${r.extension}`);
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  });
  actions.append(download);
  E.results.append(heading, card, actions);
  E.results.hidden = false;
}

function limpiarPantalla(): void {
  if (busy) return;
  loaded = null;
  E.file.value = '';
  E.info.hidden = true;
  E.info.replaceChildren();
  E.run.disabled = true;
  resetResults();
  clearError(E.error);
  setStatus(E.status, '');
}

function init(): void {
  const lines = [
    'Formatos: PDF sin contraseña, o JPG, PNG y WebP.',
    `Peso permitido: hasta ${formatBytes(MAX_PDF_BYTES)} para PDF y ${formatBytes(MAX_IMAGE_BYTES)} para imágenes.`,
    'En las imágenes no se vuelven a comprimir los píxeles: la calidad se mantiene.',
    'El archivo original nunca se modifica ni se sube a ningún servidor.',
  ];
  E.requirements.replaceChildren(
    ...lines.map((text) => {
      const li = document.createElement('li');
      li.textContent = text;
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
  E.run.addEventListener('click', () => void limpiar());
  E.clear.addEventListener('click', limpiarPantalla);
}

init();
