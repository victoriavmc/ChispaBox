/*
 * Página «Cabeceras HTTP» (solo versión local): sigue las redirecciones y muestra las cabeceras de cada salto.
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/grabar-audio.css';
import '../styles/redes.css';
import { pedirLocal } from '../lib/api-local.ts';
import { mostrarError, ocultarError, requireEl } from '../lib/red-dom.ts';

interface Salto {
  url: string;
  codigo: number;
  redireccion: string | null;
  cabeceras: Record<string, string>;
}

const ETIQUETAS: Record<string, string> = {
  server: 'Servidor',
  'content-type': 'Tipo de contenido',
  'content-length': 'Tamaño',
  'cache-control': 'Caché',
  'strict-transport-security': 'HSTS',
  'content-security-policy': 'CSP',
  'x-frame-options': 'X-Frame-Options',
  'x-content-type-options': 'X-Content-Type-Options',
  'referrer-policy': 'Referrer-Policy',
  'permissions-policy': 'Permissions-Policy',
  'set-cookie': 'Cookies (set-cookie)',
};

const E = {
  form: requireEl<HTMLFormElement>('cab-form'),
  entrada: requireEl<HTMLInputElement>('cab-entrada'),
  btn: requireEl<HTMLButtonElement>('cab-btn'),
  error: requireEl<HTMLElement>('cab-error'),
  resultado: requireEl<HTMLElement>('cab-resultado'),
  saltos: requireEl<HTMLElement>('cab-saltos'),
  status: requireEl<HTMLElement>('cab-status'),
};

function pintarSalto(s: Salto, numero: number): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'cab-salto';
  const titulo = document.createElement('strong');
  titulo.textContent = `${numero}. ${s.url} → ${s.codigo}`;
  li.append(titulo);
  if (s.redireccion) {
    const r = document.createElement('p');
    r.className = 'tool-note';
    r.textContent = `Redirige a: ${s.redireccion}`;
    li.append(r);
  }
  const lista = document.createElement('dl');
  lista.className = 'red-datos';
  for (const [clave, valor] of Object.entries(s.cabeceras)) {
    const fila = document.createElement('div');
    fila.className = 'red-datos__fila';
    const dt = document.createElement('dt');
    dt.textContent = ETIQUETAS[clave] ?? clave;
    const dd = document.createElement('dd');
    dd.textContent = valor;
    fila.append(dt, dd);
    lista.append(fila);
  }
  if (Object.keys(s.cabeceras).length === 0) {
    const vacio = document.createElement('p');
    vacio.className = 'tool-note';
    vacio.textContent = 'Sin cabeceras útiles en esta respuesta.';
    li.append(vacio);
  } else {
    li.append(lista);
  }
  return li;
}

async function consultar(): Promise<void> {
  ocultarError(E.error);
  const entrada = E.entrada.value.trim();
  if (entrada === '') {
    mostrarError(E.error, 'Escribí un dominio o una URL.');
    return;
  }
  E.btn.disabled = true;
  E.resultado.hidden = true;
  E.status.textContent = 'Siguiendo las redirecciones…';
  try {
    const { saltos } = await pedirLocal<{ saltos: Salto[] }>('cabeceras', { url: entrada });
    E.saltos.replaceChildren(...saltos.map((s, i) => pintarSalto(s, i + 1)));
    E.resultado.hidden = false;
    E.status.textContent = `Se revisaron ${saltos.length} respuesta(s).`;
  } catch (error) {
    E.status.textContent = '';
    mostrarError(E.error, error instanceof Error ? error.message : 'No se pudieron leer las cabeceras.');
  } finally {
    E.btn.disabled = false;
  }
}

E.form.addEventListener('submit', (event) => {
  event.preventDefault();
  void consultar();
});
