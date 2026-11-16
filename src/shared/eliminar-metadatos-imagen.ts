/*
 * Eliminar metadatos de imágenes (JPEG, PNG, WebP). Sin librerías externas, sin IA y sin servidor.
 *
 * El método es quitar los segmentos (JPEG), chunks (PNG) o chunks RIFF (WebP) que guardan datos
 * sobre la foto: EXIF (cámara, fecha, GPS, miniatura), XMP, IPTC/Photoshop, comentarios y textos.
 * Los píxeles no se vuelven a codificar, así que la calidad no cambia.
 *
 * La única información que se conserva es la orientación (cómo se gira la foto para verla derecha).
 * Si se quitara, una foto tomada en vertical se vería de costado. La orientación se reescribe con
 * un EXIF mínimo que solo contiene ese dato. El perfil de color ICC también se conserva.
 */

export type FormatoImagen = 'jpeg' | 'png' | 'webp';

export interface MetadatosImagen {
  formato: FormatoImagen;
  /** Hay un bloque EXIF (cámara, fechas, GPS, miniatura). */
  exif: boolean;
  /** El EXIF incluye coordenadas GPS. */
  gps: boolean;
  /** Fabricante y modelo de la cámara, o null. */
  camara: string | null;
  /** Fecha de captura o de modificación que guarda el EXIF, o null. */
  fecha: string | null;
  /** Hay un bloque XMP (metadatos XML). */
  xmp: boolean;
  /** Bloques IPTC o de Photoshop (JPEG). */
  iptc: boolean;
  /** Comentarios (JPEG) o textos incrustados (PNG). */
  textos: number;
}

export interface ResultadoImagen {
  bytes: Uint8Array;
  formato: FormatoImagen;
}

const ENC = new TextEncoder();

class FormatoInvalido extends Error {}

function fallo(): never {
  throw new FormatoInvalido('La imagen está dañada o tiene una estructura no admitida.');
}

function u8(b: Uint8Array, o: number): number {
  if (o < 0 || o >= b.length) fallo();
  return b[o] ?? 0;
}

function u16be(b: Uint8Array, o: number): number {
  return (u8(b, o) << 8) | u8(b, o + 1);
}

function u32be(b: Uint8Array, o: number): number {
  return ((u8(b, o) << 24) >>> 0) + ((u8(b, o + 1) << 16) | (u8(b, o + 2) << 8) | u8(b, o + 3));
}

function ascii(b: Uint8Array, o: number, n: number): string {
  let s = '';
  for (let i = o; i < o + n && i < b.length; i++) s += String.fromCharCode(b[i] ?? 0);
  return s;
}

function concat(piezas: Uint8Array[]): Uint8Array {
  const total = piezas.reduce((t, p) => t + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of piezas) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

/* ---------- TIFF / EXIF ---------- */

interface Tiff {
  b: Uint8Array;
  le: boolean;
  u16(o: number): number;
  u32(o: number): number;
}

function abrirTiff(entrada: Uint8Array): Tiff | null {
  const b = esExif(entrada) ? entrada.subarray(6) : entrada;
  if (b.length < 8) return null;
  const le = b[0] === 0x49 && b[1] === 0x49;
  const be = b[0] === 0x4d && b[1] === 0x4d;
  if (!le && !be) return null;
  const u16 = (o: number): number => (le ? u8(b, o) | (u8(b, o + 1) << 8) : (u8(b, o) << 8) | u8(b, o + 1));
  const u32 = (o: number): number => {
    const v = le
      ? (u8(b, o) | (u8(b, o + 1) << 8) | (u8(b, o + 2) << 16)) + u8(b, o + 3) * 0x1000000
      : u8(b, o) * 0x1000000 + ((u8(b, o + 1) << 16) | (u8(b, o + 2) << 8) | u8(b, o + 3));
    return v;
  };
  return { b, le, u16, u32 };
}

/** Entradas de la IFD0 (la primera tabla EXIF): etiqueta → posición de su entrada de 12 bytes. */
function entradasIfd0(t: Tiff): Map<number, number> {
  const mapa = new Map<number, number>();
  try {
    const ifd = t.u32(4);
    const n = t.u16(ifd);
    for (let i = 0; i < n; i++) {
      const e = ifd + 2 + i * 12;
      if (e + 12 > t.b.length) break;
      mapa.set(t.u16(e), e);
    }
  } catch {
    // TIFF truncado: se devuelve lo que se pudo leer.
  }
  return mapa;
}

/** Texto de una entrada ASCII (tipo 2). Devuelve null si no se puede leer. */
function textoEntrada(t: Tiff, e: number): string | null {
  try {
    const count = t.u32(e + 4);
    const pos = count <= 4 ? e + 8 : t.u32(e + 8);
    if (pos < 0 || pos + count > t.b.length) return null;
    return ascii(t.b, pos, count).replace(/\0+$/, '').trim() || null;
  } catch {
    return null;
  }
}

function orientacionDeTiff(t: Tiff | null): number {
  if (!t) return 1;
  const e = entradasIfd0(t).get(0x0112);
  if (e === undefined) return 1;
  const valor = t.u16(e + 8);
  return valor >= 1 && valor <= 8 ? valor : 1;
}

function resumenExif(tiff: Uint8Array): Pick<MetadatosImagen, 'gps' | 'camara' | 'fecha'> {
  const t = abrirTiff(tiff);
  if (!t) return { gps: false, camara: null, fecha: null };
  const mapa = entradasIfd0(t);
  const make = mapa.has(0x010f) ? textoEntrada(t, mapa.get(0x010f) as number) : null;
  const model = mapa.has(0x0110) ? textoEntrada(t, mapa.get(0x0110) as number) : null;
  const fechaEntrada = mapa.get(0x0132);
  const camara = [make, model].filter(Boolean).join(' ') || null;
  return {
    gps: mapa.has(0x8825),
    camara,
    fecha: fechaEntrada !== undefined ? textoEntrada(t, fechaEntrada) : null,
  };
}

/** EXIF mínimo que solo guarda la orientación (TIFF little-endian de 26 bytes). */
function tiffSoloOrientacion(orientacion: number): Uint8Array {
  const b = new Uint8Array(26);
  b.set([0x49, 0x49, 0x2a, 0x00, 0x08, 0x00, 0x00, 0x00], 0); // cabecera, IFD en 8
  b.set([0x01, 0x00], 8); // una entrada
  b.set([0x12, 0x01, 0x03, 0x00, 0x01, 0x00, 0x00, 0x00], 10); // 0x0112, SHORT, 1 valor
  b[18] = orientacion & 0xff;
  b[19] = 0;
  // 20..25: siguiente IFD = 0 (ya a cero)
  return b;
}

/* ---------- JPEG ---------- */

const EXIF_HEAD = ENC.encode('Exif\0\0');
const XMP_HEAD = 'http://ns.adobe.com/xap/1.0/';

function esJpeg(b: Uint8Array): boolean {
  return b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

interface SegmentoJpeg {
  marca: number;
  inicio: number;
  fin: number;
}

/** Recorre los segmentos hasta SOS. Devuelve los segmentos y la posición de los datos de imagen. */
function segmentosJpeg(b: Uint8Array): { segmentos: SegmentoJpeg[]; sos: number } {
  const segmentos: SegmentoJpeg[] = [];
  let pos = 2;
  while (pos < b.length) {
    if (u8(b, pos) !== 0xff) fallo();
    let marca = u8(b, pos + 1);
    let p = pos + 1;
    while (marca === 0xff) {
      p++;
      marca = u8(b, p);
    }
    if (marca === 0xd9) fallo(); // EOI sin datos de imagen
    if (marca === 0xda || marca === 0x01 || (marca >= 0xd0 && marca <= 0xd7)) {
      if (marca === 0xda) return { segmentos, sos: p - 1 };
      segmentos.push({ marca, inicio: pos, fin: p + 1 });
      pos = p + 1;
      continue;
    }
    const longitud = u16be(b, p + 1);
    if (longitud < 2 || p + 1 + longitud > b.length) fallo();
    segmentos.push({ marca, inicio: pos, fin: p + 1 + longitud });
    pos = p + 1 + longitud;
  }
  fallo();
}

function esExif(seg: Uint8Array): boolean {
  return seg.length >= 6 && ascii(seg, 0, 6) === 'Exif\0\0';
}

function esXmp(seg: Uint8Array): boolean {
  return ascii(seg, 0, XMP_HEAD.length) === XMP_HEAD;
}

function leerJpeg(b: Uint8Array): MetadatosImagen {
  const { segmentos } = segmentosJpeg(b);
  const meta: MetadatosImagen = { formato: 'jpeg', exif: false, gps: false, camara: null, fecha: null, xmp: false, iptc: false, textos: 0 };
  for (const s of segmentos) {
    const seg = b.subarray(s.inicio + 4, s.fin);
    if (s.marca === 0xe1 && esExif(seg)) {
      meta.exif = true;
      Object.assign(meta, resumenExif(seg.subarray(6)));
    } else if (s.marca === 0xe1 && esXmp(seg)) {
      meta.xmp = true;
    } else if (s.marca === 0xed) {
      meta.iptc = true;
    } else if (s.marca === 0xfe) {
      meta.textos += 1;
    }
  }
  return meta;
}

function limpiarJpeg(b: Uint8Array): Uint8Array {
  const { segmentos, sos } = segmentosJpeg(b);
  let orientacion = 1;
  for (const s of segmentos) {
    const seg = b.subarray(s.inicio + 4, s.fin);
    if (s.marca === 0xe1 && esExif(seg)) {
      orientacion = orientacionDeTiff(abrirTiff(seg.subarray(6)));
      break;
    }
  }

  const piezas: Uint8Array[] = [b.subarray(0, 2)];
  let exifEscrito = false;
  for (const s of segmentos) {
    const seg = b.subarray(s.inicio + 4, s.fin);
    const marca = s.marca;
    if (marca === 0xe1 && esExif(seg)) {
      if (orientacion !== 1 && !exifEscrito) {
        const tiff = tiffSoloOrientacion(orientacion);
        const cuerpo = concat([EXIF_HEAD, tiff]);
        piezas.push(segmentoJpeg(0xe1, cuerpo));
      }
      exifEscrito = true;
      continue;
    }
    if (conservarSegmentoJpeg(marca, seg)) piezas.push(b.subarray(s.inicio, s.fin));
  }

  // Cabecera SOS + datos comprimidos hasta el EOI (inclusive). Lo que venga después se descarta.
  const datosInicio = sos + 2 + u16be(b, sos + 2);
  const fin = buscarEoi(b, datosInicio);
  piezas.push(b.subarray(sos, fin));
  return concat(piezas);
}

function segmentoJpeg(marca: number, cuerpo: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + cuerpo.length);
  out[0] = 0xff;
  out[1] = marca;
  const longitud = cuerpo.length + 2;
  out[2] = (longitud >> 8) & 0xff;
  out[3] = longitud & 0xff;
  out.set(cuerpo, 4);
  return out;
}

function conservarSegmentoJpeg(marca: number, seg: Uint8Array): boolean {
  if (marca === 0xfe) return false; // COM: comentarios
  if (marca === 0xe0) return ascii(seg, 0, 5) === 'JFIF\0'; // APP0: solo JFIF; JFXX puede llevar miniaturas
  if (marca === 0xe2) return ascii(seg, 0, 12) === 'ICC_PROFILE\0'; // APP2: solo perfil de color
  if (marca === 0xee) return true; // APP14 (Adobe): necesario para CMYK
  if (marca >= 0xe1 && marca <= 0xef) return false; // EXIF, XMP, IPTC, MPF, Ducky, etc.
  return true; // SOF, DHT, DQT, DRI, etc.
}

/** Posición justo después del marcador EOI, respetando bytes de relleno y marcadores RST. */
function buscarEoi(b: Uint8Array, desde: number): number {
  let i = desde;
  while (i < b.length - 1) {
    if (b[i] === 0xff) {
      const sig = b[i + 1] ?? 0;
      if (sig === 0x00 || (sig >= 0xd0 && sig <= 0xd7)) {
        i += 2;
        continue;
      }
      if (sig === 0xff) {
        i += 1;
        continue;
      }
      if (sig === 0xd9) return i + 2;
    }
    i++;
  }
  return b.length;
}

/* ---------- PNG ---------- */

const PNG_FIRMA = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function esPng(b: Uint8Array): boolean {
  return b.length >= 8 && PNG_FIRMA.every((v, i) => b[i] === v);
}

interface ChunkPng {
  tipo: string;
  inicio: number;
  fin: number;
}

function chunksPng(b: Uint8Array): ChunkPng[] {
  const out: ChunkPng[] = [];
  let pos = 8;
  while (pos < b.length) {
    const largo = u32be(b, pos);
    const inicio = pos;
    const fin = pos + 12 + largo;
    if (fin > b.length) fallo();
    out.push({ tipo: ascii(b, pos + 4, 4), inicio, fin });
    pos = fin;
    if (out[out.length - 1]?.tipo === 'IEND') break;
  }
  return out;
}

const TEXTOS_PNG = ['tEXt', 'zTXt', 'iTXt'];

function leerPng(b: Uint8Array): MetadatosImagen {
  const meta: MetadatosImagen = { formato: 'png', exif: false, gps: false, camara: null, fecha: null, xmp: false, iptc: false, textos: 0 };
  for (const c of chunksPng(b)) {
    if (c.tipo === 'eXIf') {
      meta.exif = true;
      Object.assign(meta, resumenExif(b.subarray(c.inicio + 8, c.fin - 4)));
    } else if (TEXTOS_PNG.includes(c.tipo)) {
      meta.textos += 1;
      if (c.tipo === 'iTXt' && ascii(b, c.inicio + 8, 20).startsWith('XML:com.adobe.xmp')) meta.xmp = true;
    } else if (c.tipo === 'tIME') {
      meta.fecha = meta.fecha ?? 'Fecha de modificación (tIME)';
    }
  }
  return meta;
}

const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(datos: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < datos.length; i++) c = (TABLA_CRC[(c ^ (datos[i] ?? 0)) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunkPng(tipo: string, datos: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + datos.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, datos.length);
  out.set(ENC.encode(tipo), 4);
  out.set(datos, 8);
  dv.setUint32(8 + datos.length, crc32(out.subarray(4, 8 + datos.length)));
  return out;
}

function limpiarPng(b: Uint8Array): Uint8Array {
  const chunks = chunksPng(b);
  const orientacion = orientacionDeTiff(abrirTiffPng(b, chunks));
  const piezas: Uint8Array[] = [b.subarray(0, 8)];
  for (const c of chunks) {
    if (c.tipo === 'eXIf' || c.tipo === 'tIME' || TEXTOS_PNG.includes(c.tipo)) continue;
    piezas.push(b.subarray(c.inicio, c.fin));
    if (c.tipo === 'IHDR' && orientacion !== 1) piezas.push(chunkPng('eXIf', tiffSoloOrientacion(orientacion)));
  }
  return concat(piezas);
}

function abrirTiffPng(b: Uint8Array, chunks: ChunkPng[]): Tiff | null {
  const c = chunks.find((x) => x.tipo === 'eXIf');
  return c ? abrirTiff(b.subarray(c.inicio + 8, c.fin - 4)) : null;
}

/* ---------- WebP ---------- */

interface ChunkWebp {
  tipo: string;
  inicio: number;
  fin: number;
}

function esWebp(b: Uint8Array): boolean {
  return b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP';
}

function chunksWebp(b: Uint8Array): ChunkWebp[] {
  const out: ChunkWebp[] = [];
  const fin = Math.min(b.length, 8 + u32le(b, 4));
  let pos = 12;
  while (pos + 8 <= fin) {
    const largo = u32le(b, pos + 4);
    const fin_chunk = pos + 8 + largo + (largo & 1);
    if (fin_chunk > b.length) fallo();
    out.push({ tipo: ascii(b, pos, 4), inicio: pos, fin: fin_chunk });
    pos = fin_chunk;
  }
  return out;
}

function u32le(b: Uint8Array, o: number): number {
  return (u8(b, o) | (u8(b, o + 1) << 8) | (u8(b, o + 2) << 16)) + u8(b, o + 3) * 0x1000000;
}

function leerWebp(b: Uint8Array): MetadatosImagen {
  const meta: MetadatosImagen = { formato: 'webp', exif: false, gps: false, camara: null, fecha: null, xmp: false, iptc: false, textos: 0 };
  for (const c of chunksWebp(b)) {
    if (c.tipo === 'EXIF') {
      meta.exif = true;
      Object.assign(meta, resumenExif(exifWebp(b.subarray(c.inicio + 8, c.fin))));
    } else if (c.tipo === 'XMP ') {
      meta.xmp = true;
    }
  }
  return meta;
}

/** Algunos EXIF de WebP llevan la cabecera «Exif\0\0» delante del TIFF; se quita si existe. */
function exifWebp(datos: Uint8Array): Uint8Array {
  return esExif(datos) ? datos.subarray(6) : datos;
}

function limpiarWebp(b: Uint8Array): Uint8Array {
  const chunks = chunksWebp(b);
  const exif = chunks.find((c) => c.tipo === 'EXIF');
  const orientacion = exif ? orientacionDeTiff(abrirTiff(exifWebp(b.subarray(exif.inicio + 8, exif.fin)))) : 1;
  const tieneVp8x = chunks.some((c) => c.tipo === 'VP8X');
  const piezas: Uint8Array[] = [];
  for (const c of chunks) {
    if (c.tipo === 'EXIF' || c.tipo === 'XMP ') continue;
    if (c.tipo === 'VP8X') {
      const copia = b.slice(c.inicio, c.fin);
      // Bits de flags de VP8X: 0x08 = EXIF presente, 0x04 = XMP presente.
      const flags = copia[8] ?? 0;
      copia[8] = orientacion !== 1 ? flags | 0x08 : flags & ~0x08;
      copia[8] = copia[8] & ~0x04;
      piezas.push(copia);
      continue;
    }
    piezas.push(b.subarray(c.inicio, c.fin));
  }
  if (orientacion !== 1 && tieneVp8x) {
    const tiff = tiffSoloOrientacion(orientacion);
    const cabecera = new Uint8Array(8);
    cabecera.set(ENC.encode('EXIF'), 0);
    new DataView(cabecera.buffer).setUint32(4, tiff.length, true);
    piezas.push(cabecera, tiff);
  }
  const cuerpo = concat([ENC.encode('WEBP'), ...piezas]);
  const salida = new Uint8Array(8 + cuerpo.length);
  salida.set(ENC.encode('RIFF'), 0);
  new DataView(salida.buffer).setUint32(4, cuerpo.length, true);
  salida.set(cuerpo, 8);
  return salida;
}

/* ---------- API pública ---------- */

/** Formato real de la imagen según su firma, o null si no es JPEG, PNG ni WebP. */
export function formatoImagenPorFirma(bytes: Uint8Array): FormatoImagen | null {
  if (esJpeg(bytes)) return 'jpeg';
  if (esPng(bytes)) return 'png';
  if (esWebp(bytes)) return 'webp';
  return null;
}

/** Lee los datos sensibles que la imagen guarda sobre sí misma, sin modificarla. */
export function leerMetadatosImagen(bytes: Uint8Array): MetadatosImagen {
  try {
    switch (formatoImagenPorFirma(bytes)) {
      case 'jpeg':
        return leerJpeg(bytes);
      case 'png':
        return leerPng(bytes);
      case 'webp':
        return leerWebp(bytes);
      default:
        throw new Error('El archivo no es una imagen JPEG, PNG o WebP admitida.');
    }
  } catch (error) {
    if (error instanceof FormatoInvalido) throw new Error(error.message);
    throw error;
  }
}

/**
 * Devuelve una copia de la imagen sin EXIF, XMP, IPTC, comentarios ni textos. Los píxeles no
 * cambian. Se verifica que la salida siga siendo del mismo formato y que no quede ningún bloque.
 */
export function limpiarMetadatosImagen(bytes: Uint8Array): ResultadoImagen {
  const formato = formatoImagenPorFirma(bytes);
  if (!formato) throw new Error('El archivo no es una imagen JPEG, PNG o WebP admitida.');
  try {
    const salida =
      formato === 'jpeg' ? limpiarJpeg(bytes) : formato === 'png' ? limpiarPng(bytes) : limpiarWebp(bytes);
    if (formatoImagenPorFirma(salida) !== formato) throw new Error('La copia generada no tiene el formato esperado.');
    return { bytes: salida, formato };
  } catch (error) {
    if (error instanceof FormatoInvalido) throw new Error(error.message);
    throw error;
  }
}

/**
 * Indica si quedan datos personales en la imagen (cámara, fecha, GPS, XMP, IPTC o textos).
 * Un EXIF que solo lleva la orientación no cuenta: es el único dato que se conserva a propósito.
 */
export function quedanDatosImagen(m: MetadatosImagen): boolean {
  return m.gps || m.camara !== null || m.fecha !== null || m.xmp || m.iptc || m.textos > 0;
}
