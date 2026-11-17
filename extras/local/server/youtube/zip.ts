/*
 * Escritor de ZIP sin dependencias. Guarda los archivos sin comprimir (método 0):
 * el audio y el video ya vienen comprimidos, así que comprimir de nuevo no ahorra espacio.
 *
 * Limitaciones deliberadas (se validan): máximo 65 535 entradas y 4 GB en total (sin ZIP64).
 * Cada entrada usa «data descriptor» (bit 3), así se escribe en una sola pasada.
 */
import { createReadStream } from 'node:fs';
import { open, stat, type FileHandle } from 'node:fs/promises';

export interface ZipEntry {
  /** Nombre dentro del ZIP (UTF-8). */
  name: string;
  /** Ruta del archivo en disco. */
  path: string;
}

const MAX_ENTRIES = 65_535;
const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024 - 1;
const FLAGS = 0x0008 | 0x0800; // data descriptor + nombres UTF-8

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crcUpdate(crc: number, chunk: Buffer): number {
  let c = crc;
  for (let i = 0; i < chunk.length; i += 1) c = CRC_TABLE[(c ^ chunk[i]) & 0xff] ^ (c >>> 8);
  return c >>> 0;
}

/** Fecha y hora en formato MS-DOS, como exige ZIP. */
function dosDateTime(date: Date): { time: number; day: number } {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

async function writeAll(handle: FileHandle, data: Buffer, position: number): Promise<number> {
  let offset = 0;
  while (offset < data.length) {
    const { bytesWritten } = await handle.write(data, offset, data.length - offset, position + offset);
    offset += bytesWritten;
  }
  return position + data.length;
}

/** Escribe un ZIP con las entradas dadas y devuelve su tamaño en bytes. */
export async function writeStoredZip(outPath: string, entries: readonly ZipEntry[]): Promise<number> {
  if (entries.length === 0) throw new Error('El ZIP no puede estar vacío.');
  if (entries.length > MAX_ENTRIES) throw new Error('Demasiados archivos para un ZIP.');

  const sizes = await Promise.all(entries.map(async (entry) => (await stat(entry.path)).size));
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total > MAX_TOTAL_BYTES) throw new Error('El ZIP superaría 4 GB.');

  const { time, day } = dosDateTime(new Date());
  const handle = await open(outPath, 'w');
  try {
    let position = 0;
    const central: Array<{ header: Buffer; name: Buffer; crc: number; size: number; offset: number }> = [];

    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      const nameBuffer = Buffer.from(entry.name, 'utf8');
      const offset = position;

      // Cabecera local: el CRC y los tamaños van en el data descriptor, tras los datos.
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(FLAGS, 6);
      local.writeUInt16LE(0, 8); // método 0: sin compresión
      local.writeUInt16LE(time, 10);
      local.writeUInt16LE(day, 12);
      local.writeUInt32LE(0, 14);
      local.writeUInt32LE(0, 18);
      local.writeUInt32LE(0, 22);
      local.writeUInt16LE(nameBuffer.length, 26);
      local.writeUInt16LE(0, 28);
      position = await writeAll(handle, Buffer.concat([local, nameBuffer]), position);

      let crc = 0xffffffff;
      let written = 0;
      for await (const chunk of createReadStream(entry.path)) {
        const buffer = chunk as Buffer;
        crc = crcUpdate(crc, buffer); // el registro se invierte solo al inicio y al final
        written += buffer.length;
        position = await writeAll(handle, buffer, position);
      }
      crc = (crc ^ 0xffffffff) >>> 0;
      if (written !== sizes[i]) throw new Error('El archivo cambió mientras se comprimía.');

      const descriptor = Buffer.alloc(16);
      descriptor.writeUInt32LE(0x08074b50, 0);
      descriptor.writeUInt32LE(crc, 4);
      descriptor.writeUInt32LE(written, 8);
      descriptor.writeUInt32LE(written, 12);
      position = await writeAll(handle, descriptor, position);

      const header = Buffer.alloc(46);
      header.writeUInt32LE(0x02014b50, 0);
      header.writeUInt16LE(20, 4); // versión que creó
      header.writeUInt16LE(20, 6); // versión necesaria
      header.writeUInt16LE(FLAGS, 8);
      header.writeUInt16LE(0, 10);
      header.writeUInt16LE(time, 12);
      header.writeUInt16LE(day, 14);
      header.writeUInt32LE(crc, 16);
      header.writeUInt32LE(written, 20);
      header.writeUInt32LE(written, 24);
      header.writeUInt16LE(nameBuffer.length, 28);
      header.writeUInt16LE(0, 30); // extra
      header.writeUInt16LE(0, 32); // comentario
      header.writeUInt16LE(0, 34); // disco
      header.writeUInt16LE(0, 36); // atributos internos
      header.writeUInt32LE(0, 38); // atributos externos
      header.writeUInt32LE(offset, 42);
      central.push({ header, name: nameBuffer, crc, size: written, offset });
    }

    const centralStart = position;
    for (const item of central) {
      position = await writeAll(handle, Buffer.concat([item.header, item.name]), position);
    }
    const centralSize = position - centralStart;

    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0, 4);
    end.writeUInt16LE(0, 6);
    end.writeUInt16LE(central.length, 8);
    end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(centralStart, 16);
    end.writeUInt16LE(0, 20);
    position = await writeAll(handle, end, position);
    return position;
  } finally {
    await handle.close();
  }
}
