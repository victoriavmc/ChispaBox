/*
 * Página «Quién soy»: datos del navegador y, si la persona lo pide, su IP pública, ubicación
 * aproximada, proveedor y un mapa (Leaflet + OpenStreetMap). Todo sale a servicios externos
 * solo después de pulsar el botón.
 */
import 'leaflet/dist/leaflet.css';
import * as L from 'leaflet';
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/grabar-audio.css';
import '../styles/redes.css';
import { describirNavegador } from '../shared/redes.ts';
import { hostnameDesdePtr, interpretarIpinfo, interpretarIpwhois, ipADecimal, nombreArpaIPv4, type DatosIp } from '../shared/ip-publica.ts';
import { fetchConTiempo, mostrarError, ocultarError, pintarDatos, requireEl } from '../lib/red-dom.ts';

const E = {
  datos: requireEl<HTMLElement>('quien-datos'),
  ipBtn: requireEl<HTMLButtonElement>('quien-ip-btn'),
  resultado: requireEl<HTMLElement>('quien-ip-resultado'),
  tarjetas: requireEl<HTMLElement>('quien-tarjetas'),
  detalles: requireEl<HTMLElement>('quien-ip-detalles'),
  mapa: requireEl<HTMLElement>('quien-mapa'),
  error: requireEl<HTMLElement>('quien-error'),
  status: requireEl<HTMLElement>('quien-status'),
};

function conexion(): string {
  const info = (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number } }).connection;
  if (!info || !info.effectiveType) return 'No informada por el navegador';
  const mbps = typeof info.downlink === 'number' ? ` · ~${info.downlink} Mb/s` : '';
  return `${info.effectiveType.toUpperCase()}${mbps}`;
}

function pintarNavegador(): void {
  const ua = navigator.userAgent;
  const { navegador, sistema } = describirNavegador(ua);
  const zona = Intl.DateTimeFormat().resolvedOptions().timeZone || 'No informada';
  pintarDatos(E.datos, [
    ['Navegador', navegador],
    ['Sistema operativo', sistema],
    ['Idioma', navigator.language || 'No informado'],
    ['Idiomas preferidos', (navigator.languages ?? []).join(', ') || 'No informados'],
    ['Zona horaria', zona],
    ['Pantalla', `${screen.width} × ${screen.height} px · densidad ${window.devicePixelRatio}×`],
    ['Ventana', `${window.innerWidth} × ${window.innerHeight} px`],
    ['Conexión', conexion()],
    ['En línea', navigator.onLine ? 'Sí' : 'No'],
    ['Cookies', navigator.cookieEnabled ? 'Habilitadas' : 'Deshabilitadas'],
    ['Cadena de user agent', ua],
  ]);
}

/** Pide un JSON a un servicio con tiempo máximo. Lanza error si la respuesta no es 2xx. */
async function pedirJson(url: string): Promise<unknown> {
  const respuesta = await fetchConTiempo(url, { cache: 'no-store', credentials: 'omit' }, 8000);
  if (!respuesta.ok) throw new Error(`El servicio respondió con error ${respuesta.status}.`);
  return respuesta.json();
}

function tarjeta(etiqueta: string, valor: string, claseExtra = ''): HTMLElement {
  const caja = document.createElement('div');
  caja.className = `qs-tarjeta ${claseExtra}`.trim();
  const titulo = document.createElement('span');
  titulo.className = 'qs-tarjeta__etiqueta';
  titulo.textContent = etiqueta;
  const dato = document.createElement('strong');
  dato.className = 'qs-tarjeta__valor';
  dato.textContent = valor;
  caja.append(titulo, dato);
  return caja;
}

let mapa: L.Map | null = null;
let zona: L.Circle | null = null;

/** Dibuja la zona aproximada (no un punto exacto: la IP solo da una ubicación general). */
function pintarMapa(latitud: number, longitud: number): void {
  E.mapa.hidden = false;
  if (!mapa) {
    mapa = L.map(E.mapa, { scrollWheelZoom: false }).setView([latitud, longitud], 9);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
    }).addTo(mapa);
  }
  zona?.remove();
  zona = L.circle([latitud, longitud], {
    radius: 8000,
    color: '#e61932',
    weight: 2,
    fillColor: '#e61932',
    fillOpacity: 0.2,
  }).addTo(mapa);
  mapa.setView([latitud, longitud], 9);
  // El mapa se creó con el contenedor oculto: hay que recalcular su tamaño al mostrarlo.
  setTimeout(() => mapa?.invalidateSize(), 0);
}

function pintarResultado(d: DatosIp, ipv6: string | null, hostname: string | null): void {
  E.tarjetas.replaceChildren(
    tarjeta('Tu IPv4', d.ip, 'qs-tarjeta--ip'),
    tarjeta('Tu IPv6', ipv6 ?? 'No detectada'),
    tarjeta('Ubicación aproximada', `${d.ciudad}, ${d.region}, ${d.pais}`),
    tarjeta('Proveedor', d.proveedor),
  );
  const decimal = ipADecimal(d.ip);
  pintarDatos(E.detalles, [
    ['Dirección IPv4', d.ip],
    ['Valor decimal', decimal === null ? 'No disponible' : String(decimal)],
    ['Nombre de host', hostname ?? 'No disponible'],
    ['Proveedor (ISP)', d.proveedor],
    ['ASN', d.asn],
    ['País', d.pais],
    ['Región', d.region],
    ['Ciudad', d.ciudad],
    ['Coordenadas aproximadas', `${d.latitud.toFixed(4)}, ${d.longitud.toFixed(4)}`],
  ]);
  E.resultado.hidden = false;
  pintarMapa(d.latitud, d.longitud);
}

/**
 * Ubicación con respaldo: primero ipwho.is; si falla (por ejemplo con el límite de consultas,
 * error 429), se usa ipinfo.io. Solo falla si ninguno responde.
 */
async function obtenerUbicacion(): Promise<{ datos: DatosIp; fuente: string }> {
  try {
    const principal = interpretarIpwhois(await pedirJson('https://ipwho.is/'));
    if (principal.ok) return { datos: principal.datos, fuente: 'ipwho.is' };
  } catch {
    // Se intenta el servicio de respaldo.
  }
  try {
    const respaldo = interpretarIpinfo(await pedirJson('https://ipinfo.io/json'));
    if (respaldo.ok) return { datos: respaldo.datos, fuente: 'ipinfo.io' };
  } catch {
    // Ningún servicio respondió: se informa abajo.
  }
  throw new Error('Los servicios de ubicación no respondieron (puede ser el límite de consultas). Probá de nuevo en unos minutos.');
}

async function consultar(): Promise<void> {
  ocultarError(E.error);
  E.ipBtn.disabled = true;
  E.resultado.hidden = true;
  E.status.textContent = 'Consultando…';
  try {
    const [ubicacion, ipv6Crudo] = await Promise.all([
      obtenerUbicacion(),
      pedirJson('https://api6.ipify.org?format=json').catch(() => null),
    ]);
    const datos = ubicacion.datos;

    const ipv6 = typeof (ipv6Crudo as { ip?: unknown } | null)?.ip === 'string' ? (ipv6Crudo as { ip: string }).ip : null;
    const arpa = nombreArpaIPv4(datos.ip);
    const hostname = arpa ? hostnameDesdePtr(await pedirJson(`https://dns.google/resolve?name=${encodeURIComponent(arpa)}&type=PTR`).catch(() => null)) : null;

    pintarResultado(datos, ipv6, hostname);
    E.status.textContent = `Consulta terminada con datos de ${ubicacion.fuente}. La ubicación es aproximada.`;
  } catch (error) {
    E.resultado.hidden = true;
    E.status.textContent = '';
    mostrarError(E.error, error instanceof Error ? error.message : 'No se pudo consultar la IP.');
  } finally {
    E.ipBtn.disabled = false;
  }
}

pintarNavegador();
E.ipBtn.addEventListener('click', () => void consultar());
