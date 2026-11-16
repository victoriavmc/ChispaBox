/*
 * Textos que se codifican en un QR: enlaces, texto libre, redes Wi-Fi y contactos.
 * Solo texto: sin IA y sin llamadas externas. Los caracteres especiales se escapan según el formato.
 */

export const QR_LIMITS = {
  maxCaracteres: 1000,
  maxLadoPx: 4000,
  maxBytesImagen: 20 * 1024 * 1024,
} as const;

/** Barra invertida, usada como carácter de escape en WIFI: y en vCard. */
const BARRA = String.fromCharCode(92);

/** Antepone la barra de escape a cada carácter que esté en la lista. */
function escaparCaracteres(valor: string, especiales: readonly string[]): string {
  let salida = '';
  for (const caracter of valor) {
    salida += especiales.includes(caracter) ? BARRA + caracter : caracter;
  }
  return salida;
}

/** Escapa los caracteres que el formato WIFI: usa como separadores. */
export function escaparWifi(valor: string): string {
  return escaparCaracteres(valor, [BARRA, ';', ',', ':', '"']);
}

export interface DatosWifi {
  ssid: string;
  password: string;
  cifrado: 'WPA' | 'WEP' | 'nopass';
  oculta: boolean;
}

/** Texto del formato Wi-Fi que leen las cámaras y los lectores de QR de los teléfonos. */
export function textoWifi(d: DatosWifi): string {
  const partes = [`WIFI:T:${d.cifrado}`, `S:${escaparWifi(d.ssid)}`];
  if (d.cifrado !== 'nopass') partes.push(`P:${escaparWifi(d.password)}`);
  partes.push(`H:${d.oculta ? 'true' : 'false'}`);
  return `${partes.join(';')};;`;
}

export interface DireccionContacto {
  calle: string;
  ciudad: string;
  codigoPostal: string;
  pais: string;
}

/** Todos los campos del contacto. Los opcionales llegan vacíos (cadena vacía) si no se completaron. */
export interface DatosContacto {
  nombre: string;
  telefono: string;
  email: string;
  organizacion: string;
  sitioWeb: string;
  /** Fecha de nacimiento en formato AAAA-MM-DD, tal como la entrega un campo de fecha. */
  fechaNacimiento: string;
  direccion: DireccionContacto;
}

/** Escapa un valor de vCard (RFC 6350): barra, punto y coma, coma y saltos de línea. */
function escaparVcard(valor: string): string {
  const sinSaltos = valor.split('\r\n').join('\n');
  let salida = escaparCaracteres(sinSaltos, [BARRA, ';', ',']);
  salida = salida.split('\n').join(BARRA + 'n');
  return salida;
}

/** Sitio web: solo http o https, para que el contacto no lleve enlaces de otro tipo. */
export function sitioWebValido(valor: string): boolean {
  if (!valor) return true;
  try {
    const url = new URL(valor);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** Fecha AAAA-MM-DD que existe realmente en el calendario. */
export function fechaValida(valor: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!m) return false;
  const anio = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
}

/** Dirección vCard (ADR): calle; ciudad; (región vacía); código postal; país. */
function lineaDireccion(d: DireccionContacto): string | null {
  const partes = [d.calle, d.ciudad, '', d.codigoPostal, d.pais].map((p) => escaparVcard(p.trim()));
  if (partes.every((p) => p === '')) return null;
  return `ADR;TYPE=HOME:;;${partes.join(';')}`;
}

/** Contacto en formato vCard 3.0. Los campos vacíos no se incluyen. */
export function textoContacto(d: DatosContacto): string {
  const lineas = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${escaparVcard(d.nombre)}`, `N:${escaparVcard(d.nombre)};;;;`];
  if (d.organizacion) lineas.push(`ORG:${escaparVcard(d.organizacion)}`);
  if (d.telefono) lineas.push(`TEL;TYPE=CELL:${escaparVcard(d.telefono)}`);
  if (d.email) lineas.push(`EMAIL:${escaparVcard(d.email)}`);
  if (d.sitioWeb) lineas.push(`URL:${escaparVcard(d.sitioWeb)}`);
  if (d.fechaNacimiento) lineas.push(`BDAY:${d.fechaNacimiento}`);
  const direccion = lineaDireccion(d.direccion);
  if (direccion) lineas.push(direccion);
  lineas.push('END:VCARD');
  return lineas.join('\n');
}

/**
 * Devuelve la URL solo si es http o https. Cualquier otro esquema (javascript:, data:, file:, etc.)
 * se muestra como texto y nunca se vuelve un enlace clicable.
 */
export function enlaceSeguro(texto: string): URL | null {
  try {
    const url = new URL(texto.trim());
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}
