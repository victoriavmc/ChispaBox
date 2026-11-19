/*
 * Página «Prueba de velocidad»: latencia, fluctuación, descarga y carga contra speed.cloudflare.com.
 * El historial se guarda solo en este navegador (localStorage, con cuidado ante errores).
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/grabar-audio.css';
import '../styles/redes.css';
import { calificarDescarga, ETIQUETA_CALIFICACION, fluctuacion, mbps, mediana, usosRecomendados } from '../shared/velocidad.ts';
import { mostrarError, ocultarError, requireEl } from '../lib/red-dom.ts';

const SERVICIO = 'https://speed.cloudflare.com';
const CLAVE_HISTORIAL = 'chispabox-velocidad';
const TAMANOS_DESCARGA = [1_000_000, 5_000_000, 10_000_000, 20_000_000];
const TAMANOS_CARGA = [1_000_000, 3_000_000];

const E = {
  btn: requireEl<HTMLButtonElement>('vel-btn'),
  progreso: requireEl<HTMLElement>('vel-progreso'),
  error: requireEl<HTMLElement>('vel-error'),
  resultado: requireEl<HTMLElement>('vel-resultado'),
  descarga: requireEl<HTMLElement>('vel-descarga'),
  calificacion: requireEl<HTMLElement>('vel-calificacion'),
  carga: requireEl<HTMLElement>('vel-carga'),
  latencia: requireEl<HTMLElement>('vel-latencia'),
  jitter: requireEl<HTMLElement>('vel-jitter'),
  usos: requireEl<HTMLElement>('vel-usos'),
  historial: requireEl<HTMLElement>('vel-historial'),
};

interface Registro {
  fecha: string;
  descarga: number;
  carga: number;
  latencia: number;
  fluctuacion: number;
}

async function medirLatencia(): Promise<number[]> {
  const tiempos: number[] = [];
  for (let i = 0; i < 8; i++) {
    const t0 = performance.now();
    await fetch(`${SERVICIO}/__down?bytes=0&r=${Math.random()}`, { cache: 'no-store', credentials: 'omit' });
    tiempos.push(performance.now() - t0);
  }
  // La primera conexión suele tardar más (TLS): no se cuenta.
  return tiempos.slice(1);
}

async function medirDescarga(): Promise<number> {
  const velocidades: number[] = [];
  for (const bytes of TAMANOS_DESCARGA) {
    E.progreso.textContent = `Descarga: ${Math.round(bytes / 1_000_000)} MB…`;
    const t0 = performance.now();
    const r = await fetch(`${SERVICIO}/__down?bytes=${bytes}&r=${Math.random()}`, { cache: 'no-store', credentials: 'omit' });
    const cuerpo = await r.arrayBuffer();
    velocidades.push(mbps(cuerpo.byteLength, performance.now() - t0));
  }
  // Se promedian las dos pruebas más grandes, que son las más estables.
  return (velocidades[velocidades.length - 1] + velocidades[velocidades.length - 2]) / 2;
}

function datosAleatorios(bytes: number): Uint8Array {
  const datos = new Uint8Array(bytes);
  // crypto.getRandomValues admite como máximo 65536 bytes por llamada.
  for (let i = 0; i < bytes; i += 65536) crypto.getRandomValues(datos.subarray(i, Math.min(i + 65536, bytes)));
  return datos;
}

async function medirCarga(): Promise<number> {
  const velocidades: number[] = [];
  for (const bytes of TAMANOS_CARGA) {
    E.progreso.textContent = `Carga: ${Math.round(bytes / 1_000_000)} MB…`;
    const datos = datosAleatorios(bytes);
    const t0 = performance.now();
    await fetch(`${SERVICIO}/__up`, { method: 'POST', body: new Blob([datos.buffer as ArrayBuffer]), cache: 'no-store', credentials: 'omit' });
    velocidades.push(mbps(bytes, performance.now() - t0));
  }
  return velocidades[velocidades.length - 1];
}

function leerHistorial(): Registro[] {
  try {
    const crudo = localStorage.getItem(CLAVE_HISTORIAL);
    const datos = crudo ? (JSON.parse(crudo) as unknown) : [];
    return Array.isArray(datos) ? (datos as Registro[]).slice(0, 5) : [];
  } catch {
    return [];
  }
}

function guardarHistorial(registro: Registro): Registro[] {
  const lista = [registro, ...leerHistorial()].slice(0, 5);
  try {
    localStorage.setItem(CLAVE_HISTORIAL, JSON.stringify(lista));
  } catch {
    // Si el navegador no deja guardar, la prueba igual se muestra.
  }
  return lista;
}

function pintarHistorial(lista: Registro[]): void {
  E.historial.replaceChildren(
    ...lista.map((r) => {
      const li = document.createElement('li');
      li.textContent = `${new Date(r.fecha).toLocaleString('es-AR')} · ↓ ${r.descarga.toFixed(1)} Mb/s · ↑ ${r.carga.toFixed(1)} Mb/s · ${r.latencia.toFixed(0)} ms`;
      return li;
    }),
  );
}

function pintarResultado(r: Registro): void {
  const cal = ETIQUETA_CALIFICACION[calificarDescarga(r.descarga)];
  E.descarga.textContent = `${r.descarga.toFixed(2)} Mbps`;
  E.calificacion.textContent = cal;
  E.carga.textContent = `${r.carga.toFixed(2)} Mbps`;
  E.latencia.textContent = `${r.latencia.toFixed(2)} ms`;
  E.jitter.textContent = `${r.fluctuacion.toFixed(2)} ms`;
  const etiquetas = { bueno: 'Bueno', promedio: 'Promedio', pobre: 'Pobre' } as const;
  E.usos.replaceChildren(
    ...usosRecomendados(r.descarga, r.latencia, r.fluctuacion).flatMap((u) => {
      const dt = document.createElement('dt');
      dt.textContent = u.uso;
      const dd = document.createElement('dd');
      dd.textContent = etiquetas[u.nivel];
      return [dt, dd];
    }),
  );
  E.resultado.hidden = false;
}

async function iniciar(): Promise<void> {
  ocultarError(E.error);
  E.btn.disabled = true;
  E.resultado.hidden = true;
  try {
    E.progreso.textContent = 'Midiendo la latencia…';
    const tiempos = await medirLatencia();
    const latencia = mediana(tiempos);
    const fluct = fluctuacion(tiempos);
    const descarga = await medirDescarga();
    const carga = await medirCarga();
    const registro: Registro = { fecha: new Date().toISOString(), descarga, carga, latencia, fluctuacion: fluct };
    pintarResultado(registro);
    pintarHistorial(guardarHistorial(registro));
    E.progreso.textContent = 'Prueba terminada.';
  } catch {
    E.progreso.textContent = '';
    mostrarError(E.error, 'No se pudo completar la prueba. Revisá tu conexión y volvé a intentarlo.');
  } finally {
    E.btn.disabled = false;
  }
}

pintarHistorial(leerHistorial());
E.btn.addEventListener('click', () => void iniciar());
