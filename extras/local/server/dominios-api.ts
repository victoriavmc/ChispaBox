// API local de «Dominios» (solo `dev` y `preview` de extras/local). Hace consultas que un navegador no puede
// hacer por seguridad: certificado TLS, cabeceras HTTP, historial (Internet Archive), subdominios (crt.sh)
// y propagación (resolutores DNS públicos). Todas las entradas se validan antes de usarse.
import net from 'node:net';
import tls from 'node:tls';
import { Resolver, lookup } from 'node:dns/promises';
import type { Plugin } from 'vite';

const RUTA = '/api/dominios/';
const TIEMPO_MS = 20000;
const TIEMPO_PUERTO_MS = 3000;
const MAX_PUERTOS_LOCAL = 20;
const DOMINIO_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const RESOLUTORES = ['8.8.8.8', '1.1.1.1', '9.9.9.9', '208.67.222.222', '64.6.64.6'];
const TIPOS_PROPAGACION = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA'] as const;

class ErrorApi extends Error {
  constructor(
    readonly codigo: number,
    mensaje: string,
  ) {
    super(mensaje);
  }
}

function dominioValido(texto: string | null): string {
  const d = (texto ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (!DOMINIO_RE.test(d)) throw new ErrorApi(400, 'El dominio no es válido (por ejemplo ejemplo.com).');
  return d;
}

function hostValido(texto: string | null): string {
  const h = (texto ?? '').trim().toLowerCase().replace(/\.$/, '');
  if (net.isIP(h) !== 0) return h;
  if (!DOMINIO_RE.test(h)) throw new ErrorApi(400, 'El servidor no es válido (por ejemplo mi-sitio.com o una IP).');
  return h;
}

function listaPuertos(texto: string | null): number[] {
  const puertos: number[] = [];
  for (const token of (texto ?? '').split(/[\s,;]+/).filter((t) => t !== '')) {
    if (!/^\d{1,5}$/.test(token)) throw new ErrorApi(400, `«${token}» no es un número de puerto.`);
    const numero = Number(token);
    if (numero < 1 || numero > 65535) throw new ErrorApi(400, `${numero} está fuera del rango 1-65535.`);
    if (!puertos.includes(numero)) puertos.push(numero);
  }
  if (puertos.length === 0) throw new ErrorApi(400, 'Escribí al menos un puerto.');
  if (puertos.length > MAX_PUERTOS_LOCAL) {
    throw new ErrorApi(400, `Como máximo se pueden revisar ${MAX_PUERTOS_LOCAL} puertos a la vez.`);
  }
  return puertos;
}

type EstadoPuerto = 'abierto' | 'cerrado' | 'filtrado';

/** Conexión TCP real: «abierto» si acepta, «cerrado» si lo rechaza, «filtrado» si no responde a tiempo. */
function probarPuerto(ip: string, puerto: number): Promise<{ puerto: number; estado: EstadoPuerto; ms: number }> {
  return new Promise((resolver) => {
    const inicio = Date.now();
    const socket = new net.Socket();
    let terminado = false;
    const terminar = (estado: EstadoPuerto): void => {
      if (terminado) return;
      terminado = true;
      socket.destroy();
      resolver({ puerto, estado, ms: Date.now() - inicio });
    };
    socket.setTimeout(TIEMPO_PUERTO_MS);
    socket.once('connect', () => terminar('abierto'));
    socket.once('timeout', () => terminar('filtrado'));
    socket.once('error', (e: NodeJS.ErrnoException) => terminar(e.code === 'ECONNREFUSED' ? 'cerrado' : 'filtrado'));
    socket.connect(puerto, ip);
  });
}

async function puertosAbiertos(host: string, puertos: number[]): Promise<unknown> {
  let ip: string;
  try {
    ip = (await lookup(host)).address;
  } catch {
    throw new ErrorApi(502, `No se encontró el servidor «${host}». Revisá el nombre.`);
  }
  const resultados = await Promise.all(puertos.map((p) => probarPuerto(ip, p)));
  return { host, ip, resultados };
}

/** Certificado del servidor HTTPS del host (sin exigir que sea válido, para poder mostrar también los vencidos). */
function certificado(host: string): Promise<Record<string, unknown>> {
  return new Promise((resolver, rechazar) => {
    const socket = tls.connect({ host, port: 443, servername: host, rejectUnauthorized: false, timeout: TIEMPO_MS }, () => {
      const cert = socket.getPeerCertificate(false);
      const autorizado = socket.authorized;
      const error = socket.authorizationError ? String(socket.authorizationError) : null;
      socket.end();
      if (!cert || !cert.valid_to) {
        rechazar(new ErrorApi(502, 'El servidor no presentó un certificado.'));
        return;
      }
      const vence = new Date(cert.valid_to);
      const dias = Math.floor((vence.getTime() - Date.now()) / 86400000);
      resolver({
        host,
        emisor: cert.issuer?.O ?? cert.issuer?.CN ?? 'No informado',
        sujeto: cert.subject?.CN ?? host,
        nombresAlternativos: String(cert.subjectaltname ?? '')
          .split(',')
          .map((s) => s.replace(/^\s*DNS:/, '').trim())
          .filter((s) => s !== '')
          .slice(0, 20),
        validoDesde: new Date(cert.valid_from).toISOString().slice(0, 10),
        validoHasta: vence.toISOString().slice(0, 10),
        diasRestantes: dias,
        confiable: autorizado,
        motivoNoConfiable: error,
      });
    });
    socket.on('timeout', () => {
      socket.destroy();
      rechazar(new ErrorApi(504, 'El servidor no respondió a tiempo.'));
    });
    socket.on('error', (e) => rechazar(new ErrorApi(502, `No se pudo conectar por HTTPS: ${e.message}`)));
  });
}

const CABECERAS_UTILES = [
  'server',
  'content-type',
  'content-length',
  'cache-control',
  'strict-transport-security',
  'content-security-policy',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
  'set-cookie',
];

/** Sigue las redirecciones (hasta 6) y devuelve cada salto con su código y cabeceras útiles. */
async function cabeceras(urlInicial: string): Promise<unknown> {
  let actual = urlInicial;
  const saltos: unknown[] = [];
  for (let i = 0; i < 7; i++) {
    const control = new AbortController();
    const timer = setTimeout(() => control.abort(), TIEMPO_MS);
    let respuesta: Response;
    try {
      respuesta = await fetch(actual, { redirect: 'manual', signal: control.signal, headers: { 'user-agent': 'ChispaBox-Dominios/1.0' } });
    } catch (e) {
      throw new ErrorApi(502, `No se pudo consultar ${actual}: ${(e as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
    await respuesta.body?.cancel();
    const cabecera: Record<string, string> = {};
    for (const nombre of CABECERAS_UTILES) {
      const valor = respuesta.headers.get(nombre);
      if (valor !== null) cabecera[nombre] = valor.length > 300 ? `${valor.slice(0, 300)}…` : valor;
    }
    const location = respuesta.headers.get('location');
    saltos.push({ url: actual, codigo: respuesta.status, redireccion: location, cabeceras: cabecera });
    if (location === null || respuesta.status < 300 || respuesta.status >= 400) break;
    actual = new URL(location, actual).toString();
  }
  return { saltos };
}

async function historial(dominio: string): Promise<unknown> {
  const url = `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(dominio)}&output=json&fl=timestamp&collapse=timestamp:4`;
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), 20000);
  try {
    const r = await fetch(url, { signal: control.signal, headers: { 'user-agent': 'ChispaBox-Dominios/1.0' } });
    if (!r.ok) throw new ErrorApi(502, `Internet Archive respondió con error ${r.status}.`);
    const datos = (await r.json()) as string[][];
    const anios = datos.slice(1).map((f) => f[0]?.slice(0, 4)).filter((a): a is string => !!a && /^\d{4}$/.test(a));
    return { dominio, anios, enlace: `https://web.archive.org/web/*/${dominio}` };
  } catch (e) {
    if (e instanceof ErrorApi) throw e;
    throw new ErrorApi(502, 'No se pudo consultar Internet Archive.');
  } finally {
    clearTimeout(timer);
  }
}

async function subdominios(dominio: string): Promise<unknown> {
  const control = new AbortController();
  const timer = setTimeout(() => control.abort(), 25000);
  try {
    const r = await fetch(`https://crt.sh/?q=${encodeURIComponent('%.' + dominio)}&output=json`, { signal: control.signal });
    if (!r.ok) throw new ErrorApi(502, `crt.sh respondió con error ${r.status}.`);
    const filas = (await r.json()) as Array<{ name_value?: string }>;
    const nombres = new Set<string>();
    for (const f of filas) {
      for (const linea of String(f.name_value ?? '').split('\n')) {
        const n = linea.trim().toLowerCase().replace(/^\*\./, '');
        if (n === dominio || (n.endsWith('.' + dominio) && DOMINIO_RE.test(n))) nombres.add(n);
      }
    }
    const lista = [...nombres].sort();
    return { dominio, total: lista.length, subdominios: lista.slice(0, 300), recortado: lista.length > 300 };
  } catch (e) {
    if (e instanceof ErrorApi) throw e;
    throw new ErrorApi(502, 'No se pudo consultar crt.sh.');
  } finally {
    clearTimeout(timer);
  }
}

/** Texto legible para cada tipo de respuesta de node:dns (MX, SOA, TXT…). */
function formatearValor(d: unknown): string {
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map(String).join('');
  if (d && typeof d === 'object') {
    const o = d as Record<string, unknown>;
    if ('exchange' in o) return `${o.priority} ${o.exchange}`;
    if ('nsname' in o) return `${o.nsname} ${o.hostmaster} (serie ${o.serial})`;
    if ('address' in o) return String(o.address);
    return JSON.stringify(d);
  }
  return String(d);
}

async function propagacion(dominio: string, tipo: string): Promise<unknown> {
  if (!(TIPOS_PROPAGACION as readonly string[]).includes(tipo)) throw new ErrorApi(400, 'Tipo de registro no admitido.');
  const resultados = await Promise.all(
    RESOLUTORES.map(async (servidor) => {
      const resolutor = new Resolver({ timeout: 5000, tries: 1 });
      resolutor.setServers([servidor]);
      try {
        const datos = await resolutor.resolve(dominio, tipo as 'A');
        const valores = (Array.isArray(datos) ? datos : [datos]).map(formatearValor);
        return { servidor, estado: 'resuelta', valores };
      } catch (e) {
        const codigo = (e as NodeJS.ErrnoException).code ?? 'ERROR';
        return { servidor, estado: codigo === 'ENODATA' || codigo === 'ENOTFOUND' ? 'sin-registro' : 'no-resuelta', valores: [], detalle: codigo };
      }
    }),
  );
  return { dominio, tipo, resultados };
}

async function manejar(ruta: string, params: URLSearchParams): Promise<unknown> {
  switch (ruta) {
    case 'ssl':
      return certificado(dominioValido(params.get('host')));
    case 'cabeceras': {
      const entrada = (params.get('url') ?? '').trim();
      let url: URL;
      try {
        url = new URL(/^https?:\/\//i.test(entrada) ? entrada : `https://${entrada}`);
      } catch {
        throw new ErrorApi(400, 'La dirección no es válida.');
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new ErrorApi(400, 'Solo se admiten http y https.');
      dominioValido(url.hostname);
      return cabeceras(url.toString());
    }
    case 'historial':
      return historial(dominioValido(params.get('dominio')));
    case 'subdominios':
      return subdominios(dominioValido(params.get('dominio')));
    case 'puertos':
      return puertosAbiertos(hostValido(params.get('host')), listaPuertos(params.get('puertos')));
    case 'propagacion':
      return propagacion(dominioValido(params.get('dominio')), (params.get('tipo') ?? 'A').toUpperCase());
    default:
      throw new ErrorApi(404, 'Consulta no encontrada.');
  }
}

export function dominiosLocalApi(): Plugin {
  const middleware = async (req: { url?: string }, res: { statusCode: number; setHeader(n: string, v: string): void; end(b: string): void }, next: () => void) => {
    const url = new URL(req.url ?? '/', 'http://local');
    if (!url.pathname.startsWith(RUTA)) return next();
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    try {
      const datos = await manejar(url.pathname.slice(RUTA.length), url.searchParams);
      res.statusCode = 200;
      res.end(JSON.stringify(datos));
    } catch (e) {
      const codigo = e instanceof ErrorApi ? e.codigo : 500;
      const mensaje = e instanceof ErrorApi ? e.message : 'Error interno de la consulta.';
      res.statusCode = codigo;
      res.end(JSON.stringify({ error: mensaje }));
    }
  };
  return {
    name: 'dominios-local-api',
    configureServer(server) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(middleware);
    },
  };
}
