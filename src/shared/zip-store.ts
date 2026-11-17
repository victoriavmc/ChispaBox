/*
 * Escritor de ZIP sin compresión (método 0) y CRC-32, sin dependencias.
 * Compartido por el navegador (ZIP de PDF separados) y por el servidor (Excel ajustado).
 * Usa solo Uint8Array/DataView, así que funciona en ambos entornos.
 *
 * Fechas fijas (1980-01-01) para que el mismo contenido produzca el mismo ZIP.
 */

export interface ZipStoreFile {
  /** Nombre dentro del ZIP (UTF-8, rutas relativas, sin «..»). */
  name: string;
  data: Uint8Array;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01

export function buildZipStore(files: readonly ZipStoreFile[]): Uint8Array {
  if (files.length === 0 || files.length > 0xffff) throw new Error('Cantidad de archivos no válida para el ZIP.');
  const encoder = new TextEncoder();
  const prepared = files.map((file) => ({
    name: encoder.encode(file.name),
    data: file.data,
    crc: crc32(file.data),
  }));

  let total = 22; // registro de fin de directorio
  for (const p of prepared) total += 30 + p.name.length + p.data.length + 46 + p.name.length;
  if (total > 0xffffffff) throw new Error('El ZIP superaría 4 GB.');

  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  let pos = 0;
  const offsets: number[] = [];

  for (const p of prepared) {
    offsets.push(pos);
    view.setUint32(pos, 0x04034b50, true);
    view.setUint16(pos + 4, 20, true);
    view.setUint16(pos + 6, 0x0800, true); // nombres UTF-8
    view.setUint16(pos + 8, 0, true); // sin compresión
    view.setUint16(pos + 10, 0, true);
    view.setUint16(pos + 12, DOS_DATE, true);
    view.setUint32(pos + 14, p.crc, true);
    view.setUint32(pos + 18, p.data.length, true);
    view.setUint32(pos + 22, p.data.length, true);
    view.setUint16(pos + 26, p.name.length, true);
    view.setUint16(pos + 28, 0, true);
    pos += 30;
    out.set(p.name, pos);
    pos += p.name.length;
    out.set(p.data, pos);
    pos += p.data.length;
  }

  const cdStart = pos;
  prepared.forEach((p, i) => {
    view.setUint32(pos, 0x02014b50, true);
    view.setUint16(pos + 4, 20, true);
    view.setUint16(pos + 6, 20, true);
    view.setUint16(pos + 8, 0x0800, true);
    view.setUint16(pos + 10, 0, true);
    view.setUint16(pos + 12, 0, true);
    view.setUint16(pos + 14, DOS_DATE, true);
    view.setUint32(pos + 16, p.crc, true);
    view.setUint32(pos + 20, p.data.length, true);
    view.setUint32(pos + 24, p.data.length, true);
    view.setUint16(pos + 28, p.name.length, true);
    view.setUint16(pos + 30, 0, true);
    view.setUint16(pos + 32, 0, true);
    view.setUint16(pos + 34, 0, true);
    view.setUint16(pos + 36, 0, true);
    view.setUint32(pos + 38, 0, true);
    view.setUint32(pos + 42, offsets[i], true);
    pos += 46;
    out.set(p.name, pos);
    pos += p.name.length;
  });
  const cdSize = pos - cdStart;

  view.setUint32(pos, 0x06054b50, true);
  view.setUint16(pos + 4, 0, true);
  view.setUint16(pos + 6, 0, true);
  view.setUint16(pos + 8, prepared.length, true);
  view.setUint16(pos + 10, prepared.length, true);
  view.setUint32(pos + 12, cdSize, true);
  view.setUint32(pos + 16, cdStart, true);
  view.setUint16(pos + 20, 0, true);
  pos += 22;
  return out.subarray(0, pos);
}
