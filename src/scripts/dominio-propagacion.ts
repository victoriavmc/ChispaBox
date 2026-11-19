/*
 * Página «Propagación DNS» (solo versión local): compara respuestas de varios resolutores públicos.
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/grabar-audio.css';
import '../styles/redes.css';
import { pedirLocal } from '../lib/api-local.ts';
import { validarDominio } from '../shared/dominios.ts';
import { mostrarError, ocultarError, requireEl } from '../lib/red-dom.ts';

interface Resultado {
  servidor: string;
  estado: 'resuelta' | 'sin-registro' | 'no-resuelta';
  valores: string[];
  detalle?: string;
}

const NOMBRE_RESOLUTOR: Record<string, string> = {
  '8.8.8.8': 'Google (8.8.8.8)',
  '1.1.1.1': 'Cloudflare (1.1.1.1)',
  '9.9.9.9': 'Quad9 (9.9.9.9)',
  '208.67.222.222': 'OpenDNS (208.67.222.222)',
  '64.6.64.6': 'Verisign (64.6.64.6)',
};

const ETIQUETA_ESTADO: Record<Resultado['estado'], string> = {
  resuelta: 'Respondió',
  'sin-registro': 'Sin registro',
  'no-resuelta': 'No respondió',
};

const E = {
  form: requireEl<HTMLFormElement>('pro-form'),
  entrada: requireEl<HTMLInputElement>('pro-entrada'),
  tipo: requireEl<HTMLSelectElement>('pro-tipo'),
  btn: requireEl<HTMLButtonElement>('pro-btn'),
  error: requireEl<HTMLElement>('pro-error'),
  resultado: requireEl<HTMLElement>('pro-resultado'),
  filas: requireEl<HTMLElement>('pro-filas'),
  status: requireEl<HTMLElement>('pro-status'),
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
  E.status.textContent = 'Consultando los resolutores…';
  try {
    const d = await pedirLocal<{ resultados: Resultado[] }>('propagacion', { dominio: v.ascii, tipo: E.tipo.value });
    E.filas.replaceChildren(
      ...d.resultados.map((r) => {
        const tr = document.createElement('tr');
        const celdas = [
          NOMBRE_RESOLUTOR[r.servidor] ?? r.servidor,
          ETIQUETA_ESTADO[r.estado],
          r.valores.length > 0 ? r.valores.join(' · ') : (r.detalle ?? '—'),
        ];
        for (const texto of celdas) {
          const td = document.createElement('td');
          td.textContent = texto;
          tr.append(td);
        }
        return tr;
      }),
    );
    const iguales = new Set(d.resultados.filter((r) => r.estado === 'resuelta').map((r) => r.valores.join('|'))).size;
    E.status.textContent = iguales <= 1
      ? `Los resolutores responden lo mismo para ${E.tipo.value}.`
      : `Hay respuestas distintas entre resolutores: el cambio puede estar propagándose.`;
    E.resultado.hidden = false;
  } catch (error) {
    E.status.textContent = '';
    mostrarError(E.error, error instanceof Error ? error.message : 'No se pudo consultar la propagación.');
  } finally {
    E.btn.disabled = false;
  }
}

E.form.addEventListener('submit', (event) => {
  event.preventDefault();
  void consultar();
});
