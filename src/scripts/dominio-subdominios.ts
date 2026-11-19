/*
 * Página «Buscar subdominios» (solo versión local): nombres de certificados públicos (crt.sh), vía la API local.
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/grabar-audio.css';
import '../styles/redes.css';
import { pedirLocal } from '../lib/api-local.ts';
import { validarDominio } from '../shared/dominios.ts';
import { mostrarError, ocultarError, requireEl } from '../lib/red-dom.ts';

interface Subdominios {
  dominio: string;
  total: number;
  subdominios: string[];
  recortado: boolean;
}

const E = {
  form: requireEl<HTMLFormElement>('sub-form'),
  entrada: requireEl<HTMLInputElement>('sub-entrada'),
  btn: requireEl<HTMLButtonElement>('sub-btn'),
  error: requireEl<HTMLElement>('sub-error'),
  resultado: requireEl<HTMLElement>('sub-resultado'),
  resumen: requireEl<HTMLElement>('sub-resumen'),
  lista: requireEl<HTMLElement>('sub-lista'),
  status: requireEl<HTMLElement>('sub-status'),
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
  E.status.textContent = 'Buscando certificados públicos…';
  try {
    const d = await pedirLocal<Subdominios>('subdominios', { dominio: v.ascii });
    E.resumen.textContent = d.total > 0
      ? `Se encontraron ${d.total} nombre(s) con certificado público para ${v.unicode}.${d.recortado ? ' Se muestran los primeros 300.' : ''}`
      : `No se encontraron nombres con certificado público para ${v.unicode}.`;
    E.resumen.hidden = false;
    E.lista.replaceChildren(
      ...d.subdominios.map((s) => {
        const li = document.createElement('li');
        li.textContent = s;
        return li;
      }),
    );
    E.resultado.hidden = false;
    E.status.textContent = 'Búsqueda terminada.';
  } catch (error) {
    E.status.textContent = '';
    mostrarError(E.error, error instanceof Error ? error.message : 'No se pudieron buscar los subdominios.');
  } finally {
    E.btn.disabled = false;
  }
}

E.form.addEventListener('submit', (event) => {
  event.preventDefault();
  void consultar();
});
