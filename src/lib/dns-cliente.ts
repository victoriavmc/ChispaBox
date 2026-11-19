/* Consultas DNS desde el navegador (Google Public DNS, JSON). Compartido por las herramientas de dominios. */
import { interpretarRespuestaDns, type RegistroDns } from '../shared/redes.ts';
import { fetchConTiempo } from './red-dom.ts';

/** Registros de un tipo para un nombre. Lanza error si el servicio falla. */
export async function consultarDns(nombre: string, tipo: string): Promise<RegistroDns[]> {
  const url = `https://dns.google/resolve?name=${encodeURIComponent(nombre)}&type=${tipo}`;
  const respuesta = await fetchConTiempo(url, { cache: 'no-store', credentials: 'omit' }, 10000);
  if (!respuesta.ok) throw new Error(`El servicio DNS respondió con error ${respuesta.status}.`);
  const datos = interpretarRespuestaDns(await respuesta.json());
  if (datos.error) throw new Error(datos.error);
  return datos.registros;
}

/** Como consultarDns, pero devuelve lista vacía si falla (para revisiones opcionales). */
export async function consultarDnsSeguro(nombre: string, tipo: string): Promise<RegistroDns[]> {
  try {
    return await consultarDns(nombre, tipo);
  } catch {
    return [];
  }
}

/** Valores de un tipo; los TXT se devuelven sin las comillas que agrega la API. */
export function valoresDe(registros: RegistroDns[], tipo: string): string[] {
  return registros
    .filter((r) => r.tipo === tipo)
    .map((r) => {
      if (tipo !== 'TXT') return r.valor;
      const partes = r.valor.match(/"([^"]*)"/g);
      return partes ? partes.map((p) => p.slice(1, -1)).join('') : r.valor;
    });
}
