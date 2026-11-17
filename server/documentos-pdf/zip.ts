/*
 * Lectura y escritura de ZIP en memoria, sin dependencias (solo zlib de Node).
 *
 * Se usa para:
 * - Validar la estructura de .docx/.xlsx/.pptx antes de entregarlos a LibreOffice.
 * - Modificar la configuración de página de hojas de Excel en una COPIA temporal.
 *
 * Protecciones (RG-05): solo método 0 (sin compresión) y 8 (deflate); rechaza ZIP64,
 * cifrado, rutas peligrosas («..», rutas absolutas, barras invertidas), y limita el
 * número de entradas y el tamaño total descomprimido ANTES de inflar nada.
 */
import { inflateRawSync } from 'node:zlib';
import { buildZipStore } from '../../src/shared/zip-store.ts';

/** Escritor compartido, re-exportado con nombre local. Devuelve Buffer para el servidor. */
export function buildZip(files: readonly { name: string; data: Uint8Array }[]): Buffer {
  return Buffer.from(buildZipStore(files));
}

export interface ZipLimits {
  maxEntries: number;
  maxUncompressedBytes: number;
}

/** Entrada de un ZIP leído: los datos son Buffer de Node. */
export interface ZipFile {
  name: string;
  data: Buffer;
}

export class ZipError extends Error {}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
/** Mayor relación de compresión admitida por entrada (protección contra «zip bombs»). */
const MAX_RATIO = 200;

/** Comprueba que un nombre dentro del ZIP sea una ruta relativa segura. */
export function isSafeZipName(name: string): boolean {
  if (name.length === 0 || name.length > 255) return false;
  if (name.includes('\\') || name.includes('\0') || name.startsWith('/')) return false;
  if (/^[a-zA-Z]:/.test(name)) return false;
  return !name.split('/').some((part) => part === '..');
}

/** Lee todas las entradas de un ZIP, verificando límites antes de descomprimir. */
export function readZip(buf: Buffer, limits: ZipLimits): ZipFile[] {
  // El registro de fin de directorio está al final, seguido de hasta 64 KiB de comentario.
  const minEocd = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= minEocd; i -= 1) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('El archivo no tiene una estructura ZIP válida.');

  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new ZipError('Formato ZIP64 no admitido.');
  }
  if (count > limits.maxEntries) throw new ZipError('El documento contiene demasiadas partes internas.');
  if (cdOffset + cdSize > eocd) throw new ZipError('El directorio interno del archivo está dañado.');

  // Primera pasada: metadatos y límites, sin inflar.
  const records: Array<{
    name: string;
    method: number;
    flags: number;
    compSize: number;
    uncompSize: number;
    localOffset: number;
  }> = [];
  let total = 0;
  let p = cdOffset;
  for (let i = 0; i < count; i += 1) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) {
      throw new ZipError('El directorio interno del archivo está dañado.');
    }
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    p += 46 + nameLen + extraLen + commentLen;

    if (flags & 0x0001) throw new ZipError('Los archivos cifrados no se admiten.');
    if (method !== 0 && method !== 8) throw new ZipError('Método de compresión no admitido.');
    if (!isSafeZipName(name)) throw new ZipError('El archivo contiene rutas internas no permitidas.');
    if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOffset === 0xffffffff) {
      throw new ZipError('Formato ZIP64 no admitido.');
    }
    if (uncompSize > 0 && (compSize === 0 || uncompSize / compSize > MAX_RATIO) && uncompSize > 1024 * 1024) {
      throw new ZipError('Compresión anómala: posible archivo malicioso.');
    }
    total += uncompSize;
    if (total > limits.maxUncompressedBytes) {
      throw new ZipError('El contenido descomprimido supera el límite permitido.');
    }
    records.push({ name, method, flags, compSize, uncompSize, localOffset });
  }

  // Segunda pasada: leer datos reales (con límite de tamaño por entrada).
  return records.map((rec) => {
    if (rec.localOffset + 30 > buf.length || buf.readUInt32LE(rec.localOffset) !== LOC_SIG) {
      throw new ZipError('El archivo está dañado (cabecera local inválida).');
    }
    const nameLen = buf.readUInt16LE(rec.localOffset + 26);
    const extraLen = buf.readUInt16LE(rec.localOffset + 28);
    const start = rec.localOffset + 30 + nameLen + extraLen;
    const raw = buf.subarray(start, start + rec.compSize);
    if (raw.length !== rec.compSize) throw new ZipError('El archivo está truncado.');
    let data: Buffer;
    try {
      data =
        rec.method === 0
          ? Buffer.from(raw)
          : inflateRawSync(raw, { maxOutputLength: Math.max(1, rec.uncompSize) });
    } catch {
      throw new ZipError('No se pudo descomprimir una parte del archivo (dañado o malicioso).');
    }
    if (data.length !== rec.uncompSize) throw new ZipError('El tamaño interno del archivo no coincide.');
    return { name: rec.name, data };
  });
}

