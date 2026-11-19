/* Llamadas a la API local de Dominios (solo existe en extras/local: `npm run dev` / `preview` de esa carpeta). */
import { fetchConTiempo } from './red-dom.ts';

export const MENSAJE_SIN_SERVIDOR_LOCAL =
  'Esta herramienta necesita el servidor local de ChispaBox (la versión local de extras/local). En la versión pública no está disponible.';

/** Pide una consulta a la API local. Si el servidor local no está, avisa con un mensaje claro. */
export async function pedirLocal<T>(ruta: string, params: Record<string, string>): Promise<T> {
  const query = new URLSearchParams(params).toString();
  let respuesta: Response;
  try {
    respuesta = await fetchConTiempo(`/api/dominios/${ruta}?${query}`, { cache: 'no-store', credentials: 'omit' }, 30000);
  } catch {
    throw new Error(MENSAJE_SIN_SERVIDOR_LOCAL);
  }
  const contenido = (await respuesta.json().catch(() => null)) as { error?: string } | T | null;
  if (!respuesta.ok) {
    const mensaje = contenido && typeof contenido === 'object' && 'error' in contenido ? contenido.error : undefined;
    if (respuesta.status === 404 && !mensaje) throw new Error(MENSAJE_SIN_SERVIDOR_LOCAL);
    throw new Error(mensaje ?? `La consulta falló (código ${respuesta.status}).`);
  }
  return contenido as T;
}
