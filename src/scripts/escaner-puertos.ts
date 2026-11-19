/*
 * Página «Escáner de puertos». Un navegador no puede abrir conexiones TCP arbitrarias, así que
 * esta prueba intenta una conexión HTTPS (TLS + petición) a cada puerto con fetch.
 * Solo detecta servidores que hablan HTTPS; el resto aparece como «Sin respuesta».
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/grabar-audio.css';
import '../styles/redes.css';
import { MAX_PUERTOS, esHostValido, normalizarHost, validarPuertos } from '../shared/redes.ts';
import { mostrarError, ocultarError, requireEl } from '../lib/red-dom.ts';

const TIEMPO_MAX_MS = 4000;
const PUERTOS_POR_DEFECTO = '443, 8443, 4443, 9443';

const E = {
  form: requireEl<HTMLFormElement>('pto-form'),
  host: requireEl<HTMLInputElement>('pto-host'),
  puertos: requireEl<HTMLInputElement>('pto-puertos'),
  btn: requireEl<HTMLButtonElement>('pto-btn'),
  resultado: requireEl<HTMLElement>('pto-resultado'),
  tbody: requireEl<HTMLElement>('pto-registros'),
  tabla: requireEl<HTMLElement>('pto-tabla-wrap'),
  error: requireEl<HTMLElement>('pto-error'),
  status: requireEl<HTMLElement>('pto-status'),
};

E.puertos.value = PUERTOS_POR_DEFECTO;

interface Sonda {
  puerto: number;
  abierto: boolean;
  ms: number;
}

/** Intenta una petición HTTPS al puerto. Si el servidor responde (aunque sea con error), el puerto está en uso. */
async function sondear(host: string, puerto: number): Promise<Sonda> {
  const inicio = performance.now();
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), TIEMPO_MAX_MS);
  try {
    // mode «no-cors»: la respuesta puede ser opaca, pero basta con saber que la conexión se completó.
    await fetch(`https://${host}:${puerto}/`, {
      mode: 'no-cors',
      cache: 'no-store',
      credentials: 'omit',
      signal: control.signal,
    });
    return { puerto, abierto: true, ms: Math.round(performance.now() - inicio) };
  } catch {
    return { puerto, abierto: false, ms: Math.round(performance.now() - inicio) };
  } finally {
    clearTimeout(timer);
  }
}

function pintarSondas(sondas: Sonda[]): void {
  E.tbody.replaceChildren();
  for (const sonda of sondas) {
    const fila = document.createElement('tr');

    const tdPuerto = document.createElement('td');
    tdPuerto.textContent = String(sonda.puerto);

    const tdEstado = document.createElement('td');
    const insignia = document.createElement('span');
    insignia.className = sonda.abierto ? 'red-estado red-estado--ok' : 'red-estado';
    insignia.textContent = sonda.abierto ? 'Respondió (HTTPS)' : 'Sin respuesta';
    tdEstado.append(insignia);

    const tdTiempo = document.createElement('td');
    tdTiempo.textContent = `${sonda.ms} ms`;

    fila.append(tdPuerto, tdEstado, tdTiempo);
    E.tbody.append(fila);
  }
  E.tabla.hidden = sondas.length === 0;
}

async function revisar(host: string, puertos: number[]): Promise<void> {
  E.btn.disabled = true;
  E.resultado.hidden = true;
  E.status.textContent = `Revisando ${puertos.length} puerto(s) en ${host}…`;
  try {
    const sondas = await Promise.all(puertos.map((puerto) => sondear(host, puerto)));
    pintarSondas(sondas);
    E.resultado.hidden = false;
    const abiertos = sondas.filter((s) => s.abierto).length;
    E.status.textContent = `Revisión terminada: ${abiertos} de ${sondas.length} puerto(s) respondieron.`;
  } finally {
    E.btn.disabled = false;
  }
}

E.form.addEventListener('submit', (event) => {
  event.preventDefault();
  ocultarError(E.error);
  // Cada envío empieza sin resultados previos: así no se mezclan con una lista de puertos distinta.
  E.resultado.hidden = true;
  E.tbody.replaceChildren();
  E.status.textContent = '';
  const host = normalizarHost(E.host.value);
  if (!esHostValido(host)) {
    mostrarError(E.error, 'Escribí el nombre o la IP del servidor, por ejemplo mi-sitio.com.');
    return;
  }
  const { puertos, errores } = validarPuertos(E.puertos.value);
  if (errores.length > 0) {
    mostrarError(E.error, errores.join(' '));
    return;
  }
  if (puertos.length === 0) {
    mostrarError(E.error, `Escribí al menos un puerto (hasta ${MAX_PUERTOS}).`);
    return;
  }
  E.host.value = host;
  void revisar(host, puertos);
});
