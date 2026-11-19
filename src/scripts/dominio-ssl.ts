/*
 * Página «Verificar SSL» (solo versión local): certificado HTTPS del host, vía la API local.
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/grabar-audio.css';
import '../styles/redes.css';
import { pedirLocal } from '../lib/api-local.ts';
import { esHostValido, normalizarHost } from '../shared/redes.ts';
import { mostrarError, ocultarError, pintarDatos, requireEl } from '../lib/red-dom.ts';

interface Certificado {
  host: string;
  emisor: string;
  sujeto: string;
  nombresAlternativos: string[];
  validoDesde: string;
  validoHasta: string;
  diasRestantes: number;
  confiable: boolean;
  motivoNoConfiable: string | null;
}

const E = {
  form: requireEl<HTMLFormElement>('ssl-form'),
  entrada: requireEl<HTMLInputElement>('ssl-entrada'),
  btn: requireEl<HTMLButtonElement>('ssl-btn'),
  error: requireEl<HTMLElement>('ssl-error'),
  resultado: requireEl<HTMLElement>('ssl-resultado'),
  banner: requireEl<HTMLElement>('ssl-banner'),
  datos: requireEl<HTMLElement>('ssl-datos'),
  status: requireEl<HTMLElement>('ssl-status'),
};

async function consultar(): Promise<void> {
  ocultarError(E.error);
  const host = normalizarHost(E.entrada.value);
  if (!esHostValido(host) || !host.includes('.')) {
    mostrarError(E.error, 'Escribí un dominio válido, por ejemplo chispabox.io.');
    return;
  }
  E.btn.disabled = true;
  E.resultado.hidden = true;
  E.status.textContent = 'Revisando el certificado…';
  try {
    const c = await pedirLocal<Certificado>('ssl', { host });
    const vencido = c.diasRestantes < 0;
    E.banner.textContent = c.confiable && !vencido
      ? `Certificado válido: quedan ${c.diasRestantes} días.`
      : vencido
        ? `Certificado vencido hace ${Math.abs(c.diasRestantes)} días.`
        : 'Certificado no confiable.';
    E.banner.hidden = false;
    pintarDatos(E.datos, [
      ['Sitio', c.host],
      ['Emitido para', c.sujeto],
      ['Emisor', c.emisor],
      ['Válido desde', c.validoDesde],
      ['Vence el', c.validoHasta],
      ['Días restantes', String(c.diasRestantes)],
      ['Confiable', c.confiable ? 'Sí' : `No${c.motivoNoConfiable ? ` (${c.motivoNoConfiable})` : ''}`],
      ['Otros nombres cubiertos', c.nombresAlternativos.join(', ') || 'Ninguno'],
    ]);
    E.resultado.hidden = false;
    E.status.textContent = `Revisión terminada para ${c.host}.`;
  } catch (error) {
    E.status.textContent = '';
    mostrarError(E.error, error instanceof Error ? error.message : 'No se pudo revisar el certificado.');
  } finally {
    E.btn.disabled = false;
  }
}

E.form.addEventListener('submit', (event) => {
  event.preventDefault();
  void consultar();
});
