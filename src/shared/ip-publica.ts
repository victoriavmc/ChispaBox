/*
 * Funciones puras para «Quién soy»: convierten la IP en otros formatos y validan las respuestas
 * de los servicios externos (ipwho.is para ubicación y proveedor, dns.google para el nombre de host).
 */
import { parseIPv4 } from './redes.ts';

/** Valor decimal de una IPv4 (190.226.127.15 → 3202514703). */
export function ipADecimal(ip: string): number | null {
  return parseIPv4(ip);
}

/** Nombre para consultar el registro PTR de una IPv4 (15.127.226.190.in-addr.arpa). */
export function nombreArpaIPv4(ip: string): string | null {
  if (parseIPv4(ip) === null) return null;
  return `${ip.split('.').reverse().join('.')}.in-addr.arpa`;
}

/** Saca el nombre de host de una respuesta DNS JSON (registro PTR, tipo 12). */
export function hostnameDesdePtr(respuesta: unknown): string | null {
  if (typeof respuesta !== 'object' || respuesta === null) return null;
  const respuestas = (respuesta as { Answer?: unknown }).Answer;
  if (!Array.isArray(respuestas)) return null;
  for (const item of respuestas) {
    if (typeof item !== 'object' || item === null) continue;
    const { type, data } = item as { type?: unknown; data?: unknown };
    if (type === 12 && typeof data === 'string' && data !== '') return data.replace(/\.$/, '');
  }
  return null;
}

export interface DatosIp {
  ip: string;
  tipo: string;
  pais: string;
  region: string;
  ciudad: string;
  latitud: number;
  longitud: number;
  asn: string;
  proveedor: string;
}

export type ResultadoIp = { ok: true; datos: DatosIp } | { ok: false; error: string };

/** Nombre del país a partir de su código ISO (AR → Argentina). Usa Intl del navegador. */
export function nombrePais(codigo: string): string {
  try {
    return new Intl.DisplayNames(['es'], { type: 'region' }).of(codigo) ?? codigo;
  } catch {
    return codigo;
  }
}

/**
 * Valida la respuesta de ipinfo.io (servicio de respaldo). Trae la ubicación como «lat,lon»
 * y el proveedor con su ASN al principio («AS7303 Telecom Argentina S.A.»).
 */
export function interpretarIpinfo(respuesta: unknown): ResultadoIp {
  if (typeof respuesta !== 'object' || respuesta === null) {
    return { ok: false, error: 'La respuesta del servicio de respaldo no es válida.' };
  }
  const r = respuesta as Record<string, unknown>;
  const texto = (valor: unknown, por: string): string => (typeof valor === 'string' && valor !== '' ? valor : por);
  if (typeof r.ip !== 'string' || typeof r.loc !== 'string') {
    return { ok: false, error: 'El servicio de respaldo no devolvió la ubicación.' };
  }
  const [latTxt, lonTxt] = r.loc.split(',');
  const latitud = Number(latTxt);
  const longitud = Number(lonTxt);
  if (!Number.isFinite(latitud) || !Number.isFinite(longitud)) {
    return { ok: false, error: 'El servicio de respaldo no devolvió coordenadas válidas.' };
  }
  const org = texto(r.org, '');
  const coincide = /^AS(\d+)\s+(.*)$/.exec(org);
  const codigo = texto(r.country, '');
  return {
    ok: true,
    datos: {
      ip: r.ip,
      tipo: r.ip.includes(':') ? 'IPv6' : 'IPv4',
      pais: codigo ? nombrePais(codigo) : 'No informado',
      region: texto(r.region, 'No informada'),
      ciudad: texto(r.city, 'No informada'),
      latitud,
      longitud,
      asn: coincide ? `AS${coincide[1]}` : 'No informado',
      proveedor: coincide ? coincide[2] : texto(org, 'No informado'),
    },
  };
}

/** Valida la respuesta de ipwho.is y la deja en campos que usa la página. */
export function interpretarIpwhois(respuesta: unknown): ResultadoIp {
  if (typeof respuesta !== 'object' || respuesta === null) {
    return { ok: false, error: 'La respuesta del servicio de ubicación no es válida.' };
  }
  const r = respuesta as Record<string, unknown>;
  if (r.success !== true || typeof r.ip !== 'string') {
    return { ok: false, error: 'El servicio de ubicación no pudo identificar tu IP.' };
  }
  const conexion = (typeof r.connection === 'object' && r.connection !== null ? r.connection : {}) as Record<string, unknown>;
  const texto = (valor: unknown, por: string): string => (typeof valor === 'string' && valor !== '' ? valor : por);
  const numero = (valor: unknown): number | null => (typeof valor === 'number' && Number.isFinite(valor) ? valor : null);
  const latitud = numero(r.latitude);
  const longitud = numero(r.longitude);
  if (latitud === null || longitud === null) {
    return { ok: false, error: 'El servicio no devolvió una ubicación aproximada.' };
  }
  return {
    ok: true,
    datos: {
      ip: r.ip,
      tipo: texto(r.type, 'IPv4'),
      pais: texto(r.country, 'No informado'),
      region: texto(r.region, 'No informada'),
      ciudad: texto(r.city, 'No informada'),
      latitud,
      longitud,
      asn: typeof conexion.asn === 'number' ? `AS${conexion.asn}` : 'No informado',
      proveedor: texto(conexion.isp, texto(conexion.org, 'No informado')),
    },
  };
}
