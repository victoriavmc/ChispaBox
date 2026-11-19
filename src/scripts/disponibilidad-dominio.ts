/*
 * Página «Disponibilidad de dominio»: RDAP (rdap.org). 404 = no registrado; 200 = registrado.
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/grabar-audio.css';
import '../styles/redes.css';
import { estadoDisponibilidad, validarDominio } from '../shared/dominios.ts';
import { fetchConTiempo, mostrarError, ocultarError, pintarDatos, requireEl } from '../lib/red-dom.ts';

const E = {
  form: requireEl<HTMLFormElement>('disp-form'),
  entrada: requireEl<HTMLInputElement>('disp-entrada'),
  btn: requireEl<HTMLButtonElement>('disp-btn'),
  error: requireEl<HTMLElement>('disp-error'),
  resultado: requireEl<HTMLElement>('disp-resultado'),
  estado: requireEl<HTMLElement>('disp-estado'),
  datos: requireEl<HTMLElement>('disp-datos'),
  status: requireEl<HTMLElement>('disp-status'),
};

type Json = Record<string, unknown>;

function fechaEvento(json: Json, accion: string): string {
  const eventos = Array.isArray(json.events) ? (json.events as Json[]) : [];
  const e = eventos.find((x) => x.eventAction === accion);
  return typeof e?.eventDate === 'string' ? e.eventDate.slice(0, 10) : 'No informada';
}

function registrador(json: Json): string {
  const entidades = Array.isArray(json.entities) ? (json.entities as Json[]) : [];
  const r = entidades.find((x) => Array.isArray(x.roles) && (x.roles as string[]).includes('registrar'));
  const vcard = r?.vcardArray as unknown[] | undefined;
  const props = Array.isArray(vcard?.[1]) ? (vcard![1] as unknown[][]) : [];
  const fn = props.find((p) => p[0] === 'fn');
  return typeof fn?.[3] === 'string' ? fn[3] : 'No informado';
}

async function consultar(): Promise<void> {
  ocultarError(E.error);
  const v = validarDominio(E.entrada.value);
  if (!v.ok) {
    mostrarError(E.error, v.error);
    return;
  }
  E.btn.disabled = true;
  E.resultado.hidden = true;
  E.status.textContent = 'Consultando el registro…';
  try {
    const r = await fetchConTiempo(`https://rdap.org/domain/${v.ascii}`, { cache: 'no-store', credentials: 'omit' }, 10000);
    const json = r.status === 200 ? ((await r.json()) as Json) : null;
    const estado = estadoDisponibilidad(r.status);
    const texto = { libre: 'Libre para registrar', registrado: 'Ya está registrado', desconocido: 'No se pudo determinar' }[estado];
    E.estado.textContent = `${v.unicode}: ${texto}`;
    E.estado.hidden = false;
    pintarDatos(E.datos, [
      ['Dominio consultado', v.ascii],
      ['Forma con tildes', v.unicode],
      ['Extensión', `.${v.tld}`],
      ['Registrado el', json ? fechaEvento(json, 'registration') : 'No aplica'],
      ['Vence el', json ? fechaEvento(json, 'expiration') : 'No aplica'],
      ['Registrador', json ? registrador(json) : 'No aplica'],
    ]);
    E.resultado.hidden = false;
    E.status.textContent = `Consulta terminada para ${v.ascii}.`;
  } catch (error) {
    E.resultado.hidden = true;
    E.status.textContent = '';
    mostrarError(E.error, error instanceof Error ? error.message : 'No se pudo consultar el registro.');
  } finally {
    E.btn.disabled = false;
  }
}

E.form.addEventListener('submit', (event) => {
  event.preventDefault();
  void consultar();
});
