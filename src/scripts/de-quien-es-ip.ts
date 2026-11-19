/*
 * Página «De quién es esta IP». Acepta una IPv4 o un dominio (se resuelve con Google Public DNS)
 * y consulta el registro RDAP (rdap.org redirige al registro regional: LACNIC, ARIN, RIPE…).
 * Servicios externos: dns.google (solo si escribís un dominio) y rdap.org.
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/grabar-audio.css';
import '../styles/redes.css';
import { esHostValido, interpretarRespuestaDns, normalizarHost, parseIPv4 } from '../shared/redes.ts';
import { interpretarRdapIp } from '../shared/propietario-ip.ts';
import { fetchConTiempo, mostrarError, ocultarError, pintarDatos, requireEl } from '../lib/red-dom.ts';

const E = {
  form: requireEl<HTMLFormElement>('ip-form'),
  entrada: requireEl<HTMLInputElement>('ip-entrada'),
  btn: requireEl<HTMLButtonElement>('ip-btn'),
  resultado: requireEl<HTMLElement>('ip-resultado'),
  titular: requireEl<HTMLElement>('ip-titular'),
  datos: requireEl<HTMLElement>('ip-datos'),
  error: requireEl<HTMLElement>('ip-error'),
  status: requireEl<HTMLElement>('ip-status'),
};

async function pedirJson(url: string): Promise<{ json: unknown; urlFinal: string }> {
  const respuesta = await fetchConTiempo(url, { cache: 'no-store', credentials: 'omit' }, 10000);
  if (!respuesta.ok) throw new Error(`El servicio respondió con error ${respuesta.status}.`);
  return { json: await respuesta.json(), urlFinal: respuesta.url };
}

/** Si escribieron un dominio, se toma su primera dirección IPv4. */
async function resolverIPv4(host: string): Promise<string> {
  const { json } = await pedirJson(`https://dns.google/resolve?name=${encodeURIComponent(host)}&type=A`);
  const registro = interpretarRespuestaDns(json).registros.find((r) => r.tipo === 'A');
  if (!registro) throw new Error(`No encontramos una dirección IPv4 para ${host}.`);
  return registro.valor;
}

function pintarTitular(titular: string, pais: string): void {
  E.titular.textContent = '';
  const etiqueta = document.createElement('span');
  etiqueta.className = 'qs-tarjeta__etiqueta';
  etiqueta.textContent = 'Titular del bloque';
  const nombre = document.createElement('strong');
  nombre.className = 'ip-titular__nombre';
  nombre.textContent = titular;
  const detalle = document.createElement('span');
  detalle.className = 'ip-titular__pais';
  detalle.textContent = pais;
  E.titular.append(etiqueta, nombre, detalle);
  E.titular.hidden = false;
}

async function consultar(entrada: string): Promise<void> {
  ocultarError(E.error);
  E.btn.disabled = true;
  E.resultado.hidden = true;
  E.status.textContent = 'Consultando…';
  try {
    const host = normalizarHost(entrada);
    let ip: string;
    if (parseIPv4(host) !== null) {
      ip = host;
    } else if (esHostValido(host)) {
      ip = await resolverIPv4(host);
    } else {
      throw new Error('Escribí una IPv4 (por ejemplo 190.226.127.15) o un dominio (por ejemplo ejemplo.com).');
    }

    const { json, urlFinal } = await pedirJson(`https://rdap.org/ip/${ip}`);
    const r = interpretarRdapIp(json, urlFinal);
    if (!r.ok) throw new Error(r.error);
    const d = r.datos;

    pintarTitular(d.titular, d.pais);
    pintarDatos(E.datos, [
      ['IP consultada', ip],
      ['Bloque asignado', d.bloque],
      ['Rango', d.rango],
      ['Nombre de la red', d.nombreRed],
      ['Tipo de asignación', d.asignacion],
      ['País', d.pais],
      ['Contacto por abuso', d.abuso],
      ['Registrado', d.registrado],
      ['Última modificación', d.modificado],
      ['Registro regional', d.registro],
    ]);
    E.resultado.hidden = false;
    E.status.textContent = `Consulta terminada para ${ip}.`;
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
  void consultar(E.entrada.value);
});
