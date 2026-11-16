/*
 * Generación y verificación de archivos ICO (Windows Icon).
 * Cada tamaño se guarda como PNG embebido (admitido desde Windows Vista).
 * No es un PNG con extensión cambiada: el contenedor ICO se escribe byte a byte
 * y se vuelve a leer para comprobar que es válido.
 */

export interface IcoEntry {
  size: number; // lado en píxeles (cuadrado)
  png: Uint8Array;
}

const HEADER_SIZE = 6;
const ENTRY_SIZE = 16;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

export const ICO_MAX_SIZE = 256;

/** Construye el contenedor ICO con las entradas dadas (orden ascendente por tamaño). */
export function buildIco(entries: IcoEntry[]): Uint8Array<ArrayBuffer> {
  if (entries.length === 0 || entries.length > 255) throw new Error('Cantidad de tamaños ICO no válida.');
  const sorted = [...entries].sort((a, b) => a.size - b.size);
  for (const entry of sorted) {
    if (!Number.isInteger(entry.size) || entry.size < 1 || entry.size > ICO_MAX_SIZE) {
      throw new Error(`Tamaño ICO no válido: ${entry.size}.`);
    }
    if (!PNG_SIGNATURE.every((b, i) => entry.png[i] === b)) {
      throw new Error('Una de las imágenes del ICO no es PNG.');
    }
  }

  const total = HEADER_SIZE + ENTRY_SIZE * sorted.length + sorted.reduce((sum, e) => sum + e.png.length, 0);
  const out = new Uint8Array(new ArrayBuffer(total));
  const view = new DataView(out.buffer);
  // Cabecera: reservado 0, tipo 1 (icono), cantidad de imágenes.
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, sorted.length, true);

  let offset = HEADER_SIZE + ENTRY_SIZE * sorted.length;
  sorted.forEach((entry, n) => {
    const at = HEADER_SIZE + n * ENTRY_SIZE;
    // En la entrada, 256 px se codifica como 0.
    out[at] = entry.size === ICO_MAX_SIZE ? 0 : entry.size;
    out[at + 1] = entry.size === ICO_MAX_SIZE ? 0 : entry.size;
    out[at + 2] = 0; // sin paleta
    out[at + 3] = 0; // reservado
    view.setUint16(at + 4, 1, true); // planos
    view.setUint16(at + 6, 32, true); // bits por píxel
    view.setUint32(at + 8, entry.png.length, true);
    view.setUint32(at + 12, offset, true);
    out.set(entry.png, offset);
    offset += entry.png.length;
  });
  return out;
}

export interface IcoSummary {
  count: number;
  sizes: number[];
}

/** Lee la cabecera de un ICO y comprueba cada entrada. Lanza error si no es válido. */
export function verifyIco(bytes: Uint8Array): IcoSummary {
  if (bytes.length < HEADER_SIZE) throw new Error('El ICO está incompleto.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(0, true) !== 0 || view.getUint16(2, true) !== 1) throw new Error('Cabecera ICO no válida.');
  const count = view.getUint16(4, true);
  if (count < 1 || bytes.length < HEADER_SIZE + count * ENTRY_SIZE) throw new Error('Tabla ICO no válida.');

  const sizes: number[] = [];
  for (let n = 0; n < count; n++) {
    const at = HEADER_SIZE + n * ENTRY_SIZE;
    const w = bytes[at] === 0 ? ICO_MAX_SIZE : (bytes[at] ?? 0);
    const h = bytes[at + 1] === 0 ? ICO_MAX_SIZE : (bytes[at + 1] ?? 0);
    const size = view.getUint32(at + 8, true);
    const offset = view.getUint32(at + 12, true);
    if (w !== h) throw new Error('Un icono no es cuadrado.');
    if (size === 0 || offset + size > bytes.length) throw new Error('Una entrada del ICO apunta fuera del archivo.');
    const png = bytes.subarray(offset, offset + size);
    if (!PNG_SIGNATURE.every((b, i) => png[i] === b)) throw new Error('Una entrada del ICO no contiene PNG válido.');
    sizes.push(w);
  }
  return { count, sizes };
}
