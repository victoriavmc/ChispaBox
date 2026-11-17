/*
 * Página «Selector de color»: se abre una imagen en el navegador, se toca un píxel y se muestran
 * sus valores en HEX, RGB, HSL y HSV. No se sube ningún archivo ni se usa IA.
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/selector-color.css';
import { formatBytes } from '../shared/image-limits.ts';
import { formatosColor, normalizarRgb, type Rgb } from '../shared/selector-color.ts';
import { clearError, requireEl, setStatus, showError } from '../lib/ui-common.ts';

const MAX_BYTES = 40 * 1024 * 1024;
const MAX_LADO = 6000;
const FORMATOS = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/bmp'];

const E = {
  requirements: requireEl<HTMLElement>('color-requirements'),
  file: requireEl<HTMLInputElement>('color-file'),
  dropzone: requireEl<HTMLElement>('color-dropzone'),
  error: requireEl<HTMLElement>('color-error'),
  canvas: requireEl<HTMLCanvasElement>('color-canvas'),
  coordsWrap: requireEl<HTMLElement>('color-coords-wrap'),
  x: requireEl<HTMLInputElement>('color-x'),
  y: requireEl<HTMLInputElement>('color-y'),
  apply: requireEl<HTMLButtonElement>('color-apply'),
  result: requireEl<HTMLElement>('color-result'),
  swatch: requireEl<HTMLElement>('color-swatch'),
  values: requireEl<HTMLElement>('color-values'),
  alphaNote: requireEl<HTMLElement>('color-alpha-note'),
  empty: requireEl<HTMLElement>('color-empty'),
  status: requireEl<HTMLElement>('color-status'),
};

const ctx = E.canvas.getContext('2d', { willReadFrequently: true });
let ancho = 0;
let alto = 0;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : 'No se pudo abrir la imagen.';
}

/** Muestra un píxel: color, valores en los cuatro formatos y coordenadas. */
function elegir(x: number, y: number): void {
  if (!ctx || ancho === 0) return;
  const px = Math.min(ancho - 1, Math.max(0, Math.floor(x)));
  const py = Math.min(alto - 1, Math.max(0, Math.floor(y)));
  const [r = 0, g = 0, b = 0, a = 255] = ctx.getImageData(px, py, 1, 1).data;
  const rgb: Rgb = normalizarRgb(r, g, b);
  E.x.value = String(px);
  E.y.value = String(py);
  pintarValores(rgb, a, px, py);
}

function pintarValores(rgb: Rgb, alfa: number, x: number, y: number): void {
  const f = formatosColor(rgb);
  E.swatch.style.background = `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`;
  const filas: Array<[string, string]> = [
    ['HEX', f.hex],
    ['RGB', f.rgb],
    ['HSL', f.hsl],
    ['HSV', f.hsv],
    ['Píxel', `x ${x}, y ${y}`],
  ];
  E.values.replaceChildren(
    ...filas.flatMap(([label, valor]) => {
      const dt = document.createElement('dt');
      dt.textContent = label;
      const dd = document.createElement('dd');
      dd.textContent = valor;
      const boton = document.createElement('button');
      boton.type = 'button';
      boton.className = 'btn btn--ghost';
      boton.textContent = 'Copiar';
      boton.setAttribute('aria-label', `Copiar ${label}: ${valor}`);
      boton.disabled = label === 'Píxel';
      boton.addEventListener('click', () => void copiar(valor, label));
      return label === 'Píxel' ? [dt, dd] : [dt, dd, boton];
    }),
  );
  E.alphaNote.hidden = alfa >= 255;
  E.alphaNote.textContent =
    alfa >= 255 ? '' : `Este píxel es parcialmente transparente (alfa ${Math.round((alfa / 255) * 100)} %). El valor RGB es el del píxel sin transparencia.`;
  E.result.hidden = false;
  E.empty.hidden = true;
}

async function copiar(texto: string, etiqueta: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(texto);
    setStatus(E.status, `Copiado ${etiqueta}: ${texto}`);
  } catch {
    setStatus(E.status, `No se pudo copiar automáticamente. Seleccioná el texto ${texto} y copialo con Ctrl+C.`);
  }
}

function alClicar(event: MouseEvent): void {
  const rect = E.canvas.getBoundingClientRect();
  const x = ((event.clientX - rect.left) * ancho) / rect.width;
  const y = ((event.clientY - rect.top) * alto) / rect.height;
  elegir(x, y);
}

async function cargar(file: File): Promise<void> {
  clearError(E.error);
  E.result.hidden = true;
  E.empty.hidden = false;
  if (file.size < 1) return showError(E.error, 'El archivo está vacío (0 bytes). Elegí otra imagen.');
  if (file.size > MAX_BYTES) {
    return showError(E.error, `La imagen pesa ${formatBytes(file.size)} y supera el máximo de ${formatBytes(MAX_BYTES)}.`);
  }
  if (!FORMATOS.includes(file.type)) {
    return showError(E.error, 'Formato no admitido. Usá PNG, JPG, WebP, GIF o BMP.');
  }
  setStatus(E.status, 'Abriendo la imagen…');
  try {
    const bitmap = await createImageBitmap(file);
    if (bitmap.width > MAX_LADO || bitmap.height > MAX_LADO) {
      bitmap.close();
      throw new Error(`La imagen mide ${bitmap.width} × ${bitmap.height} px; el máximo es ${MAX_LADO} px por lado.`);
    }
    ancho = bitmap.width;
    alto = bitmap.height;
    E.canvas.width = ancho;
    E.canvas.height = alto;
    if (!ctx) throw new Error('El navegador no permite leer los píxeles de la imagen.');
    ctx.clearRect(0, 0, ancho, alto);
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    E.canvas.hidden = false;
    E.coordsWrap.hidden = false;
    E.x.max = String(ancho - 1);
    E.y.max = String(alto - 1);
    setStatus(E.status, `Imagen cargada: ${ancho} × ${alto} px. Hacé clic sobre un píxel.`);
  } catch (error) {
    E.canvas.hidden = true;
    E.coordsWrap.hidden = true;
    setStatus(E.status, '');
    showError(E.error, describeError(error));
  }
}

function aplicarCoordenadas(): void {
  const x = Number(E.x.value);
  const y = Number(E.y.value);
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= ancho || y >= alto) {
    showError(E.error, `Las coordenadas deben estar entre 0 y ${ancho - 1} (X) y entre 0 y ${alto - 1} (Y).`);
    return;
  }
  clearError(E.error);
  elegir(x, y);
}

function init(): void {
  const lines = [
    `Formatos: PNG, JPG, WebP, GIF o BMP.`,
    `Peso permitido: hasta ${formatBytes(MAX_BYTES)}; hasta ${MAX_LADO} px por lado.`,
    'La imagen se abre en tu navegador y no se sube a ningún servidor.',
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
  E.canvas.addEventListener('click', alClicar);
  E.apply.addEventListener('click', aplicarCoordenadas);
}

init();
