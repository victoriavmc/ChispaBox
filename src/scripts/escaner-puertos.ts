/*
 * Página «Escáner de puertos».
 * - Con la versión local (extras/local): la API hace una conexión TCP real a cada puerto.
 * - En la versión pública: un navegador no puede abrir conexiones TCP, así que solo se prueba
 *   una conexión HTTPS (TLS + petición) a cada puerto con fetch. El resto aparece como «Sin respuesta».
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/grabar-audio.css';
import '../styles/redes.css';
import { pedirLocal, MENSAJE_SIN_SERVIDOR_LOCAL } from '../lib/api-local.ts';
import { MAX_PUERTOS, PUERTOS_BLOQUEADOS, esHostValido, normalizarHost, validarPuertos } from '../shared/redes.ts';
import { mostrarError, ocultarError, requireEl } from '../lib/red-dom.ts';

const TIEMPO_MAX_MS = 4000;
const PUERTOS_POR_DEFECTO = '443, 8443, 4443, 9443';

const SERVICIOS: Readonly<Record<number, string>> = {
  21: 'FTP',
  22: 'SSH',
  23: 'Telnet',
  25: 'SMTP',
  53: 'DNS',
  80: 'HTTP',
  110: 'POP3',
  115: 'SFTP',
  143: 'IMAP4',
  156: 'SQL',
  443: 'HTTPS',
  465: 'SMTP (SSL)',
  587: 'SMTP (TLS)',
  993: 'IMAPS',
  995: 'POP3S',
  1433: 'SQL Server',
  3306: 'MySQL',
  3389: 'RDP',
  5432: 'PostgreSQL',
  6379: 'Redis',
  8080: 'HTTP alternativo',
  8443: 'HTTPS alternativo',
};

const E = {
  form: requireEl<HTMLFormElement>('pto-form'),
  host: requireEl<HTMLInputElement>('pto-host'),
  puertos: requireEl<HTMLInputElement>('pto-puertos'),
  comunes: requireEl<HTMLSelectElement>('pto-comunes'),
  btn: requireEl<HTMLButtonElement>('pto-btn'),
  resultado: requireEl<HTMLElement>('pto-resultado'),
  tbody: requireEl<HTMLElement>('pto-registros'),
  tabla: requireEl<HTMLElement>('pto-tabla-wrap'),
  error: requireEl<HTMLElement>('pto-error'),
  status: requireEl<HTMLElement>('pto-status'),
};

E.puertos.value = PUERTOS_POR_DEFECTO;

for (const [puerto, servicio] of Object.entries(SERVICIOS)) {
  const opcion = document.createElement('option');
  opcion.value = puerto;
  opcion.textContent = `${puerto} - ${servicio}`;
  E.comunes.append(opcion);
}

/** Al elegir un puerto común se agrega a la lista (sin repetirlo). */
E.comunes.addEventListener('change', () => {
  const elegido = E.comunes.value;
  if (elegido === '') return;
  const actuales = E.puertos.value.split(/[\s,;]+/).filter((t) => t !== '');
  if (!actuales.includes(elegido)) actuales.push(elegido);
  E.puertos.value = actuales.join(', ');
  E.comunes.value = '';
});

type Estado = 'abierto' | 'cerrado' | 'filtrado' | 'https' | 'sin-respuesta' | 'no-consultable';

interface Sonda {
  puerto: number;
  estado: Estado;
  ms: number;
}

interface RespuestaLocal {
  host: string;
  ip: string;
  resultados: Array<{ puerto: number; estado: 'abierto' | 'cerrado' | 'filtrado'; ms: number }>;
}

const ETIQUETA_ESTADO: Readonly<Record<Estado, string>> = {
  abierto: 'Abierto (conexión aceptada)',
  cerrado: 'Cerrado (rechazó la conexión)',
  filtrado: 'Filtrado (sin respuesta)',
  https: 'Respondió (HTTPS)',
  'sin-respuesta': 'Sin respuesta (HTTPS)',
  'no-consultable': 'No se puede consultar desde el navegador',
};

/** Intenta una petición HTTPS al puerto (solo para la versión pública). */
async function sondearHttps(host: string, puerto: number): Promise<Sonda> {
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
    return { puerto, estado: 'https', ms: Math.round(performance.now() - inicio) };
  } catch {
    return { puerto, estado: 'sin-respuesta', ms: Math.round(performance.now() - inicio) };
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

    const tdServicio = document.createElement('td');
    tdServicio.textContent = SERVICIOS[sonda.puerto] ?? '—';

    const tdEstado = document.createElement('td');
    const insignia = document.createElement('span');
    const ok = sonda.estado === 'abierto' || sonda.estado === 'https';
    insignia.className = ok ? 'red-estado red-estado--ok' : 'red-estado';
    insignia.textContent = ETIQUETA_ESTADO[sonda.estado];
    tdEstado.append(insignia);

    const tdTiempo = document.createElement('td');
    tdTiempo.textContent = sonda.estado === 'no-consultable' ? '—' : `${sonda.ms} ms`;

    fila.append(tdPuerto, tdServicio, tdEstado, tdTiempo);
    E.tbody.append(fila);
  }
  E.tabla.hidden = sondas.length === 0;
}

/** Sin servidor local: se usa la prueba HTTPS desde el navegador. Los puertos bloqueados no se prueban. */
async function revisarDesdeNavegador(host: string, puertos: number[]): Promise<Sonda[]> {
  return Promise.all(
    puertos.map((puerto) =>
      PUERTOS_BLOQUEADOS.has(puerto)
        ? Promise.resolve<Sonda>({ puerto, estado: 'no-consultable', ms: 0 })
        : sondearHttps(host, puerto),
    ),
  );
}

async function revisar(host: string, puertos: number[]): Promise<void> {
  E.btn.disabled = true;
  E.resultado.hidden = true;
  E.status.textContent = `Revisando ${puertos.length} puerto(s) en ${host}…`;
  try {
    let sondas: Sonda[];
    let nota: string;
    try {
      const datos = await pedirLocal<RespuestaLocal>('puertos', { host, puertos: puertos.join(',') });
      sondas = datos.resultados.map((r) => ({ puerto: r.puerto, estado: r.estado, ms: r.ms }));
      nota = `Conexión TCP real desde el servidor local (${datos.ip}).`;
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : '';
      if (mensaje !== MENSAJE_SIN_SERVIDOR_LOCAL) {
        mostrarError(E.error, mensaje || 'La revisión falló.');
        E.status.textContent = '';
        return;
      }
      sondas = await revisarDesdeNavegador(host, puertos);
      nota = 'Sin servidor local: solo se probó HTTPS desde el navegador.';
    }
    pintarSondas(sondas);
    E.resultado.hidden = false;
    const abiertos = sondas.filter((s) => s.estado === 'abierto' || s.estado === 'https').length;
    E.status.textContent = `Revisión terminada: ${abiertos} de ${sondas.length} puerto(s) respondieron. ${nota}`;
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
  const { puertos, errores } = validarPuertos(E.puertos.value, { permitirBloqueados: true });
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
