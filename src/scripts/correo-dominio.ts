/*
 * Página «Correo: SPF, DKIM y DMARC»: revisa MX, SPF, DMARC y los selectores DKIM comunes con dns.google.
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/grabar-audio.css';
import '../styles/redes.css';
import { esRegistroDkim, SELECTORES_DKIM, validarDominio } from '../shared/dominios.ts';
import { chequearDns, type ChequeoDns, type RegistrosDominio } from '../shared/seguridad-dns.ts';
import { consultarDnsSeguro, valoresDe } from '../lib/dns-cliente.ts';
import { mostrarError, ocultarError, requireEl } from '../lib/red-dom.ts';

const E = {
  form: requireEl<HTMLFormElement>('cor-form'),
  entrada: requireEl<HTMLInputElement>('cor-entrada'),
  btn: requireEl<HTMLButtonElement>('cor-btn'),
  error: requireEl<HTMLElement>('cor-error'),
  resultado: requireEl<HTMLElement>('cor-resultado'),
  chequeos: requireEl<HTMLElement>('cor-chequeos'),
  dkim: requireEl<HTMLElement>('cor-dkim'),
  status: requireEl<HTMLElement>('cor-status'),
};

const ETIQUETA: Record<ChequeoDns['estado'], string> = { ok: 'Correcto', alerta: 'Revisar', falta: 'Falta' };

async function revisar(): Promise<void> {
  ocultarError(E.error);
  const v = validarDominio(E.entrada.value);
  if (!v.ok) {
    mostrarError(E.error, v.error);
    return;
  }
  const d = v.ascii;
  E.btn.disabled = true;
  E.status.textContent = 'Revisando el correo…';
  try {
    const [mx, ns, txtRaiz, txtDmarc, ...dkim] = await Promise.all([
      consultarDnsSeguro(d, 'MX'),
      consultarDnsSeguro(d, 'NS'),
      consultarDnsSeguro(d, 'TXT'),
      consultarDnsSeguro(`_dmarc.${d}`, 'TXT'),
      ...SELECTORES_DKIM.map((s) => consultarDnsSeguro(`${s}._domainkey.${d}`, 'TXT')),
    ]);
    const registros: RegistrosDominio = {
      mx: valoresDe(mx, 'MX'),
      ns: valoresDe(ns, 'NS'),
      txtRaiz: valoresDe(txtRaiz, 'TXT'),
      txtDmarc: valoresDe(txtDmarc, 'TXT'),
      caa: [],
      ds: [],
    };
    const chequeos = chequearDns(registros).filter((c) => ['mx', 'spf', 'dmarc'].includes(c.id));
    const encontrados = SELECTORES_DKIM.filter((_, i) => valoresDe(dkim[i], 'TXT').some(esRegistroDkim));
    E.chequeos.replaceChildren(
      ...chequeos.map((c) => {
        const li = document.createElement('li');
        li.className = `dns-chequeo dns-chequeo--${c.estado}`;
        const cab = document.createElement('div');
        cab.className = 'dns-chequeo__cabecera';
        const t = document.createElement('strong');
        t.textContent = c.titulo;
        const e = document.createElement('span');
        e.className = 'dns-chequeo__estado';
        e.textContent = ETIQUETA[c.estado];
        cab.append(t, e);
        const p = document.createElement('p');
        p.className = 'dns-chequeo__detalle';
        p.textContent = c.detalle;
        li.append(cab, p);
        return li;
      }),
    );
    E.dkim.textContent =
      encontrados.length > 0
        ? `DKIM: se encontraron firmas con los selectores ${encontrados.join(', ')}. Si tu proveedor usa otro selector, puede no aparecer aquí.`
        : 'DKIM: no se encontró ninguna firma con los selectores comunes. Puede existir con otro selector que usa tu proveedor de correo.';
    E.resultado.hidden = false;
    E.status.textContent = `Revisión terminada para ${d}.`;
  } catch (error) {
    E.status.textContent = '';
    mostrarError(E.error, error instanceof Error ? error.message : 'No se pudo completar la revisión.');
  } finally {
    E.btn.disabled = false;
  }
}

E.form.addEventListener('submit', (event) => {
  event.preventDefault();
  void revisar();
});
