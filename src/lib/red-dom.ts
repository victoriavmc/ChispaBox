/* Ayudas de DOM para las herramientas de Networking. Todo se escribe con textContent (sin innerHTML). */

export function requireEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Falta el elemento #${id}`);
  return el as T;
}

/** Reemplaza el contenido de una lista de pares etiqueta/valor (<dl>). */
export function pintarDatos(dl: HTMLElement, filas: Array<[string, string]>): void {
  dl.replaceChildren();
  for (const [etiqueta, valor] of filas) {
    const fila = document.createElement('div');
    fila.className = 'red-datos__fila';
    const dt = document.createElement('dt');
    dt.textContent = etiqueta;
    const dd = document.createElement('dd');
    dd.textContent = valor;
    fila.append(dt, dd);
    dl.append(fila);
  }
  dl.hidden = false;
}

/** Muestra un mensaje de error en un elemento con role="alert". */
export function mostrarError(el: HTMLElement, mensaje: string): void {
  el.textContent = mensaje;
  el.hidden = false;
}

export function ocultarError(el: HTMLElement): void {
  el.textContent = '';
  el.hidden = true;
}

/** Ejecuta fetch con tiempo máximo. Lanza un error legible si vence el tiempo. */
export async function fetchConTiempo(url: string, init: RequestInit, ms: number): Promise<Response> {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: control.signal });
  } catch (error) {
    if (control.signal.aborted) throw new Error('La consulta tardó demasiado.');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
