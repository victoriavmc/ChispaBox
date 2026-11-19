/*
 * Página «Historial del dominio» (solo versión local): años con capturas en Internet Archive.
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/grabar-audio.css';
import '../styles/redes.css';
import { pedirLocal } from '../lib/api-local.ts';
import { validarDominio } from '../shared/dominios.ts';
import { mostrarError, ocultarError, requireEl } from '../lib/red-dom.ts';

interface Historial {
  dominio: string;
  anios: string[];
  enlace: string;
}

const E = {
  form: requireEl<HTMLFormElement>('his-form'),
  entrada: requireEl<HTMLInputElement>('his-entrada'),
  btn: requireEl<HTMLButtonElement>('his-btn'),
  error: requireEl<HTMLElement>('his-error'),
  resultado: requireEl<HTMLElement>('his-resultado'),
  resumen: requireEl<HTMLElement>('his-resumen'),
  anios: requireEl<HTMLElement>('his-anios'),
  status: requireEl<HTMLElement>('his-status'),
};

async function consultar(): Promise<void> {
  ocultarError(E.error);
  const v = validarDominio(E.entrada.value);
  if (!v.ok) {
    mostrarError(E.error, v.error);
    return;
  }
  E.btn.disabled = true;
  E.resultado.hidden = true;
  E.status.textContent = 'Buscando en Internet Archive…';
  try {
    const h = await pedirLocal<Historial>('historial', { dominio: v.ascii });
    E.resumen.textContent = h.anios.length > 0
      ? `${v.unicode} tiene capturas en ${h.anios.length} año(s), desde ${h.anios[0]} hasta ${h.anios[h.anios.length - 1]}.`
      : `No hay capturas de ${v.unicode} en Internet Archive.`;
    E.resumen.hidden = false;
    E.anios.replaceChildren(
      ...h.anios.map((anio) => {
        const li = document.createElement('li');
        const a = document.createElement('a');
        a.className = 'his-anio';
        a.href = `https://web.archive.org/web/${anio}0601000000*/${v.ascii}`;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.textContent = `${anio} (se abre en una pestaña nueva)`;
        li.append(a);
        return li;
      }),
    );
    E.resultado.hidden = false;
    E.status.textContent = 'Búsqueda terminada.';
  } catch (error) {
    E.status.textContent = '';
    mostrarError(E.error, error instanceof Error ? error.message : 'No se pudo consultar el historial.');
  } finally {
    E.btn.disabled = false;
  }
}

E.form.addEventListener('submit', (event) => {
  event.preventDefault();
  void consultar();
});
