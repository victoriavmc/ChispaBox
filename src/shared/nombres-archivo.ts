/*
 * Nombres de salida seguros (RG-07): conservan tildes, ñ y otros caracteres válidos,
 * pero quitan separadores de ruta, caracteres de control y nombres reservados de Windows.
 * Nunca se usa el nombre del archivo del usuario como ruta: solo como nombre de descarga.
 */

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
const MAX_BASE_LENGTH = 120;

/** Devuelve el nombre base (sin .pdf) listo para descargar. */
export function sanitizeBaseName(raw: string, fallback: string): string {
  let name = raw.normalize('NFC');
  // Quita la extensión .pdf si el usuario la escribió (se agrega siempre al final).
  name = name.replace(/\.pdf$/i, '');
  // Separadores de ruta, caracteres prohibidos en Windows y caracteres de control.
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, ' ');
  // Segmentos «..» (recorridos de ruta) se eliminan.
  name = name.replace(/\.{2,}/g, ' ');
  name = name.replace(/\s+/g, ' ').trim();
  // Windows no admite puntos ni espacios al final del nombre.
  name = name.replace(/[. ]+$/g, '').replace(/^\.+/, '');
  if (name.length > MAX_BASE_LENGTH) name = name.slice(0, MAX_BASE_LENGTH).trim();
  if (name.length === 0) name = fallback;
  if (RESERVED.test(name)) name = `_${name}`;
  return name;
}

/** Nombre completo con extensión .pdf. */
export function withPdfExtension(base: string): string {
  return `${base}.pdf`;
}

/** Evita nombres repetidos en un ZIP o en la lista: «foto», «foto (2)», «foto (3)». */
export function dedupeBaseNames(bases: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return bases.map((base) => {
    const key = base.toLowerCase();
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    return count === 1 ? base : `${base} (${count})`;
  });
}

/** Nombre base de una imagen: el archivo original sin su extensión. */
export function baseNameOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  return dot > 0 ? fileName.slice(0, dot) : fileName;
}
