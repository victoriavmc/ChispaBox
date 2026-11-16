/*
 * Página «Generador y lector de QR». Genera códigos con qrcode (MIT) y lee imágenes con jsQR
 * (Apache-2.0). Todo corre en el navegador: ningún contenido sale del equipo.
 * Un enlace leído nunca se abre solo: hay que tocar «Abrir enlace», y solo se permiten http y https.
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/generador-qr.css';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import { formatBytes } from '../shared/image-limits.ts';
import {
  QR_LIMITS,
  enlaceSeguro,
  fechaValida,
  sitioWebValido,
  textoContacto,
  textoWifi,
  type DatosWifi,
} from '../shared/qr-contenido.ts';
import { clearError, requireEl, setStatus, showError, triggerDownload } from '../lib/ui-common.ts';

const E = {
  tipo: requireEl<HTMLSelectElement>('qr-tipo'),
  enlace: requireEl<HTMLInputElement>('qr-enlace'),
  texto: requireEl<HTMLTextAreaElement>('qr-texto'),
  ssid: requireEl<HTMLInputElement>('qr-ssid'),
  clave: requireEl<HTMLInputElement>('qr-clave'),
  cifrado: requireEl<HTMLSelectElement>('qr-cifrado'),
  oculta: requireEl<HTMLInputElement>('qr-oculta'),
  nombre: requireEl<HTMLInputElement>('qr-nombre'),
  telefono: requireEl<HTMLInputElement>('qr-telefono'),
  email: requireEl<HTMLInputElement>('qr-email'),
  org: requireEl<HTMLInputElement>('qr-org'),
  web: requireEl<HTMLInputElement>('qr-web'),
  nacimiento: requireEl<HTMLInputElement>('qr-nacimiento'),
  calle: requireEl<HTMLInputElement>('qr-calle'),
  ciudad: requireEl<HTMLInputElement>('qr-ciudad'),
  cp: requireEl<HTMLInputElement>('qr-cp'),
  pais: requireEl<HTMLInputElement>('qr-pais'),
  generar: requireEl<HTMLButtonElement>('qr-generar'),
  errorGen: requireEl<HTMLElement>('qr-error-gen'),
  resultadoWrap: requireEl<HTMLElement>('qr-resultado-wrap'),
  canvas: requireEl<HTMLCanvasElement>('qr-canvas'),
  png: requireEl<HTMLButtonElement>('qr-png'),
  svg: requireEl<HTMLButtonElement>('qr-svg'),
  requirements: requireEl<HTMLElement>('qr-requirements'),
  file: requireEl<HTMLInputElement>('qr-file'),
  dropzone: requireEl<HTMLElement>('qr-dropzone'),
  errorLeer: requireEl<HTMLElement>('qr-error-leer'),
  readWrap: requireEl<HTMLElement>('qr-read-wrap'),
  readTexto: requireEl<HTMLElement>('qr-read-texto'),
  readAviso: requireEl<HTMLElement>('qr-read-aviso'),
  copiar: requireEl<HTMLButtonElement>('qr-copiar'),
  abrir: requireEl<HTMLAnchorElement>('qr-abrir'),
  status: requireEl<HTMLElement>('qr-status'),
};

/** Último contenido generado, para descargar PNG y SVG sin volver a pedir los datos. */
let ultimoTexto: string | null = null;
let contenidoLeido: string | null = null;

const TIPOS = ['enlace', 'texto', 'wifi', 'contacto'] as const;

function mostrarCampos(): void {
  const actual = E.tipo.value;
  for (const tipo of TIPOS) {
    const bloque = document.querySelector<HTMLElement>(`[data-tipo="${tipo}"]`);
    if (bloque) bloque.hidden = tipo !== actual;
  }
  E.errorGen.hidden = true;
}

/** Arma el texto del QR según el tipo elegido. Devuelve un mensaje de error si falta algo. */
function construirTexto(): string | { error: string } {
  const tipo = E.tipo.value;
  if (tipo === 'enlace') {
    const valor = E.enlace.value.trim();
    if (!enlaceSeguro(valor)) return { error: 'Escribí un enlace completo que empiece con http:// o https://.' };
    return valor;
  }
  if (tipo === 'texto') {
    const valor = E.texto.value;
    if (valor.trim().length === 0) return { error: 'Escribí el texto que querés codificar.' };
    return valor;
  }
  if (tipo === 'wifi') {
    const ssid = E.ssid.value.trim();
    if (!ssid) return { error: 'Escribí el nombre de la red.' };
    const cifrado = E.cifrado.value as DatosWifi['cifrado'];
    if (cifrado !== 'nopass' && E.clave.value.length === 0) return { error: 'Escribí la contraseña de la red.' };
    return textoWifi({ ssid, password: E.clave.value, cifrado, oculta: E.oculta.checked });
  }
  const nombre = E.nombre.value.trim();
  if (!nombre) return { error: 'Escribí el nombre del contacto.' };
  const sitioWeb = E.web.value.trim();
  if (!sitioWebValido(sitioWeb)) return { error: 'El sitio web debe empezar con http:// o https://.' };
  const fechaNacimiento = E.nacimiento.value;
  if (fechaNacimiento && !fechaValida(fechaNacimiento)) return { error: 'La fecha de nacimiento no es válida.' };
  return textoContacto({
    nombre,
    telefono: E.telefono.value.trim(),
    email: E.email.value.trim(),
    organizacion: E.org.value.trim(),
    sitioWeb,
    fechaNacimiento,
    direccion: {
      calle: E.calle.value.trim(),
      ciudad: E.ciudad.value.trim(),
      codigoPostal: E.cp.value.trim(),
      pais: E.pais.value.trim(),
    },
  });
}

async function generar(): Promise<void> {
  clearError(E.errorGen);
  const resultado = construirTexto();
  if (typeof resultado !== 'string') {
    showError(E.errorGen, resultado.error);
    E.resultadoWrap.hidden = true;
    return;
  }
  if (resultado.length > QR_LIMITS.maxCaracteres) {
    showError(E.errorGen, `El contenido tiene ${resultado.length} caracteres; el máximo es ${QR_LIMITS.maxCaracteres}.`);
    return;
  }
  try {
    await QRCode.toCanvas(E.canvas, resultado, { errorCorrectionLevel: 'M', margin: 2, width: 512 });
    ultimoTexto = resultado;
    E.resultadoWrap.hidden = false;
    setStatus(E.status, 'Código generado. Podés descargarlo como PNG o SVG.');
  } catch {
    showError(E.errorGen, 'No se pudo generar el código con ese contenido.');
  }
}

function descargarPng(): void {
  E.canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    triggerDownload(url, 'codigo-qr.png');
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }, 'image/png');
}

async function descargarSvg(): Promise<void> {
  if (ultimoTexto === null) return;
  const svg = await QRCode.toString(ultimoTexto, { type: 'svg', errorCorrectionLevel: 'M', margin: 2 });
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, 'codigo-qr.svg');
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/* ---------- Lectura ---------- */

async function leerArchivo(file: File): Promise<void> {
  clearError(E.errorLeer);
  E.readWrap.hidden = true;
  contenidoLeido = null;
  if (file.size < 1) return showError(E.errorLeer, 'La imagen está vacía (0 bytes).');
  if (file.size > QR_LIMITS.maxBytesImagen) {
    return showError(E.errorLeer, `La imagen pesa ${formatBytes(file.size)} y supera el máximo de ${formatBytes(QR_LIMITS.maxBytesImagen)}.`);
  }
  setStatus(E.status, 'Buscando el código en la imagen…');
  try {
    const bitmap = await createImageBitmap(file);
    if (bitmap.width > QR_LIMITS.maxLadoPx || bitmap.height > QR_LIMITS.maxLadoPx) {
      bitmap.close();
      throw new Error(`La imagen mide ${bitmap.width} × ${bitmap.height} px; el máximo es ${QR_LIMITS.maxLadoPx} px por lado.`);
    }
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('El navegador no permite leer la imagen.');
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close();
    const datos = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const codigo = jsQR(datos.data, datos.width, datos.height, { inversionAttempts: 'attemptBoth' });
    if (!codigo) {
      setStatus(E.status, '');
      showError(E.errorLeer, 'No se encontró ningún código QR en la imagen. Probá con una foto más nítida o más cerca del código.');
      return;
    }
    mostrarLectura(codigo.data);
    setStatus(E.status, 'Código leído.');
  } catch (error) {
    setStatus(E.status, '');
    showError(E.errorLeer, error instanceof Error ? error.message : 'No se pudo abrir la imagen.');
  }
}

function mostrarLectura(texto: string): void {
  contenidoLeido = texto;
  E.readTexto.textContent = texto;
  const url = enlaceSeguro(texto);
  E.abrir.hidden = url === null;
  if (url) {
    E.abrir.href = url.href;
    E.readAviso.textContent = `Es un enlace web (${url.hostname}). Se abre solo si lo tocás y lo confirmás en tu navegador.`;
  } else {
    E.abrir.removeAttribute('href');
    E.readAviso.textContent = 'Este contenido no es un enlace web http o https, así que no se abre. Revisalo antes de usarlo.';
  }
  E.readWrap.hidden = false;
}

async function copiarLectura(): Promise<void> {
  if (contenidoLeido === null) return;
  try {
    await navigator.clipboard.writeText(contenidoLeido);
    setStatus(E.status, 'Contenido copiado.');
  } catch {
    setStatus(E.status, 'No se pudo copiar automáticamente. Seleccioná el texto y copialo con Ctrl+C.');
  }
}

function init(): void {
  const lines = [
    'Formatos: PNG, JPG, WebP, GIF o BMP.',
    `Peso permitido: hasta ${formatBytes(QR_LIMITS.maxBytesImagen)}; hasta ${QR_LIMITS.maxLadoPx} px por lado.`,
    'La imagen se lee en tu navegador y no se sube a ningún servidor.',
  ];
  E.requirements.replaceChildren(
    ...lines.map((text) => {
      const li = document.createElement('li');
      li.textContent = text;
      return li;
    }),
  );
  mostrarCampos();
  E.tipo.addEventListener('change', mostrarCampos);
  E.generar.addEventListener('click', () => void generar());
  E.png.addEventListener('click', descargarPng);
  E.svg.addEventListener('click', () => void descargarSvg());
  E.file.addEventListener('change', () => {
    const file = E.file.files?.[0];
    if (file) void leerArchivo(file);
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
    if (file) void leerArchivo(file);
  });
  E.copiar.addEventListener('click', () => void copiarLectura());
}

init();
