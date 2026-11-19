/*
 * Página «Generador de nombres»: combina palabras, prefijos y sufijos, y revisa la disponibilidad por RDAP.
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/grabar-audio.css';
import '../styles/redes.css';
import { estadoDisponibilidad, generarNombres, limpiarPalabra } from '../shared/dominios.ts';
import { fetchConTiempo, mostrarError, ocultarError, requireEl } from '../lib/red-dom.ts';

const E = {
  form: requireEl<HTMLFormElement>('gen-form'),
  palabras: requireEl<HTMLInputElement>('gen-palabras'),
  prefijos: requireEl<HTMLInputElement>('gen-prefijos'),
  sufijos: requireEl<HTMLInputElement>('gen-sufijos'),
  ext: requireEl<HTMLSelectElement>('gen-ext'),
  btn: requireEl<HTMLButtonElement>('gen-btn'),
  error: requireEl<HTMLElement>('gen-error'),
  resultado: requireEl<HTMLElement>('gen-resultado'),
  filas: requireEl<HTMLElement>('gen-filas'),
  status: requireEl<HTMLElement>('gen-status'),
};

const lista = (texto: string): string[] => texto.split(',').map((s) => s.trim()).filter((s) => s !== '');

async function estadoDe(nombre: string): Promise<'libre' | 'registrado' | 'desconocido'> {
  try {
    const r = await fetchConTiempo(`https://rdap.org/domain/${nombre}`, { cache: 'no-store', credentials: 'omit' }, 10000);
    return estadoDisponibilidad(r.status);
  } catch {
    return 'desconocido';
  }
}

function fila(dominio: string, estado: 'libre' | 'registrado' | 'desconocido'): HTMLTableRowElement {
  const tr = document.createElement('tr');
  const a = document.createElement('td');
  a.textContent = dominio;
  const b = document.createElement('td');
  b.textContent = { libre: 'Libre', registrado: 'Registrado', desconocido: 'Sin dato' }[estado];
  b.className = estado === 'libre' ? 'gen-libre' : '';
  tr.append(a, b);
  return tr;
}

async function generar(): Promise<void> {
  ocultarError(E.error);
  const palabras = lista(E.palabras.value).map(limpiarPalabra).filter((p) => p !== '');
  if (palabras.length === 0) {
    mostrarError(E.error, 'Escribí al menos una palabra clave (solo letras y números).');
    return;
  }
  const nombres = generarNombres(palabras, lista(E.prefijos.value), lista(E.sufijos.value), 24);
  E.btn.disabled = true;
  E.resultado.hidden = false;
  E.filas.replaceChildren();
  let libres = 0;
  // De a 4 consultas en paralelo para no saturar el servicio.
  for (let i = 0; i < nombres.length; i += 4) {
    const lote = nombres.slice(i, i + 4);
    E.status.textContent = `Revisando ${Math.min(i + 4, nombres.length)} de ${nombres.length}…`;
    const estados = await Promise.all(lote.map((n) => estadoDe(`${n}.${E.ext.value}`)));
    lote.forEach((n, k) => {
      if (estados[k] === 'libre') libres++;
      E.filas.append(fila(`${n}.${E.ext.value}`, estados[k]));
    });
  }
  E.status.textContent = `Listo: ${libres} de ${nombres.length} nombres aparecen libres en .${E.ext.value}.`;
  E.btn.disabled = false;
}

E.form.addEventListener('submit', (event) => {
  event.preventDefault();
  void generar();
});
