/*
 * Lógica de las herramientas de Networking («Quién soy», «Calculadora de IP», «Consulta DNS»
 * y «Escáner de puertos»). Solo funciones puras: se prueban con node --test.
 * Los cálculos de IP se hacen aquí; las consultas de red las hacen las páginas, con fetch.
 */

// ---------------------------------------------------------------------------
// IPv4 y subredes
// ---------------------------------------------------------------------------

/** Convierte «a.b.c.d» en un número de 32 bits sin signo. Rechaza ceros a la izquierda (ambiguos). */
export function parseIPv4(texto: string): number | null {
  const partes = texto.trim().split('.');
  if (partes.length !== 4) return null;
  let total = 0;
  for (const parte of partes) {
    if (!/^(0|[1-9]\d{0,2})$/.test(parte)) return null;
    const valor = Number(parte);
    if (valor > 255) return null;
    total = total * 256 + valor;
  }
  return total >>> 0;
}

/** Convierte un número de 32 bits en «a.b.c.d». */
export function ipATexto(numero: number): string {
  return [24, 16, 8, 0].map((desplazamiento) => (numero >>> desplazamiento) & 255).join('.');
}

/** Máscara de red (32 bits) para un prefijo entre 0 y 32. */
export function prefijoAMascara(prefijo: number): number {
  if (prefijo <= 0) return 0;
  return (0xffffffff << (32 - prefijo)) >>> 0;
}

/** Prefijo para una máscara en notación decimal (255.255.255.0 → 24). Null si no es contigua. */
export function mascaraAPrefijo(texto: string): number | null {
  const mascara = parseIPv4(texto);
  if (mascara === null) return null;
  const invertida = (~mascara) >>> 0;
  if ((invertida & (invertida + 1)) !== 0) return null;
  let unos = 0;
  for (let resto = invertida; resto !== 0; resto >>>= 1) unos += resto & 1;
  return 32 - unos;
}

export interface DatosSubred {
  ip: string;
  prefijo: number;
  mascara: string;
  wildcard: string;
  red: string;
  broadcast: string;
  primeraIp: string;
  ultimaIp: string;
  hosts: number;
  clase: string;
  tipo: string;
}

export type ResultadoSubred = { ok: true; datos: DatosSubred } | { ok: false; error: string };

/** Clase histórica (A-E) según el primer octeto. */
export function claseIPv4(ip: number): string {
  const primer = ip >>> 24;
  if (primer < 128) return 'A';
  if (primer < 192) return 'B';
  if (primer < 224) return 'C';
  if (primer < 240) return 'D (multicast)';
  return 'E (reservada)';
}

/** Rango especial al que pertenece la dirección, si lo tiene. */
export function tipoIPv4(ip: number): string {
  const enRango = (base: string, prefijo: number): boolean => {
    const b = parseIPv4(base);
    if (b === null) return false;
    const mascara = prefijoAMascara(prefijo);
    return ((ip & mascara) >>> 0) === ((b & mascara) >>> 0);
  };
  if (enRango('10.0.0.0', 8) || enRango('172.16.0.0', 12) || enRango('192.168.0.0', 16)) {
    return 'Privada (RFC 1918, uso interno)';
  }
  if (enRango('127.0.0.0', 8)) return 'Loopback (esta misma máquina)';
  if (enRango('169.254.0.0', 16)) return 'Enlace local (sin DHCP)';
  if (enRango('100.64.0.0', 10)) return 'Compartida (CGNAT)';
  if (enRango('0.0.0.0', 8)) return 'Reservada (red 0)';
  if (ip >>> 24 >= 224) return 'Multicast o reservada';
  return 'Pública';
}

/**
 * Calcula red, broadcast, rango de hosts y máscara.
 * Acepta «192.168.1.10/24», «192.168.1.10 255.255.255.0» o «192.168.1.10 /24».
 */
export function calcularSubred(entrada: string): ResultadoSubred {
  const texto = entrada.trim().replace(/\s*\/\s*/g, '/');
  if (texto === '') return { ok: false, error: 'Escribí una dirección IPv4, por ejemplo 192.168.1.10/24.' };

  let ipTexto: string;
  let prefijo: number | null;
  if (texto.includes('/')) {
    const [parteIp, partePrefijo, resto] = texto.split('/');
    if (resto !== undefined || !/^\d{1,2}$/.test(partePrefijo ?? '')) {
      return { ok: false, error: 'El prefijo debe ser un número entre 0 y 32, por ejemplo /24.' };
    }
    ipTexto = parteIp ?? '';
    prefijo = Number(partePrefijo);
  } else if (/\s/.test(texto)) {
    const [parteIp, mascara, resto] = texto.split(/\s+/);
    if (resto !== undefined || mascara === undefined) {
      return { ok: false, error: 'Usá «IP/prefijo» o «IP máscara», por ejemplo 192.168.1.10 255.255.255.0.' };
    }
    ipTexto = parteIp ?? '';
    prefijo = mascaraAPrefijo(mascara);
    if (prefijo === null) return { ok: false, error: 'La máscara no es válida (tiene que ser contigua, como 255.255.255.0).' };
  } else {
    return { ok: false, error: 'Falta la máscara o el prefijo. Escribí, por ejemplo, 192.168.1.10/24.' };
  }

  const ip = parseIPv4(ipTexto);
  if (ip === null) return { ok: false, error: `«${ipTexto}» no es una dirección IPv4 válida.` };
  if (prefijo === null || prefijo < 0 || prefijo > 32) {
    return { ok: false, error: 'El prefijo debe estar entre 0 y 32.' };
  }

  const mascara = prefijoAMascara(prefijo);
  const wildcard = (~mascara) >>> 0;
  const red = (ip & mascara) >>> 0;
  const broadcast = (red | wildcard) >>> 0;

  let primera: number;
  let ultima: number;
  let hosts: number;
  if (prefijo === 32) {
    primera = ip;
    ultima = ip;
    hosts = 1;
  } else if (prefijo === 31) {
    // RFC 3021: en un /31 no hay broadcast; los dos extremos son hosts válidos.
    primera = red;
    ultima = broadcast;
    hosts = 2;
  } else {
    primera = (red + 1) >>> 0;
    ultima = (broadcast - 1) >>> 0;
    hosts = 2 ** (32 - prefijo) - 2;
  }

  return {
    ok: true,
    datos: {
      ip: ipATexto(ip),
      prefijo,
      mascara: ipATexto(mascara),
      wildcard: ipATexto(wildcard),
      red: ipATexto(red),
      broadcast: ipATexto(broadcast),
      primeraIp: ipATexto(primera),
      ultimaIp: ipATexto(ultima),
      hosts,
      clase: claseIPv4(ip),
      tipo: tipoIPv4(ip),
    },
  };
}

// ---------------------------------------------------------------------------
// Nombres de host y puertos
// ---------------------------------------------------------------------------

/** Quita esquema, ruta y espacios: «https://Ejemplo.com/algo» → «ejemplo.com». */
export function normalizarHost(texto: string): string {
  return texto
    .trim()
    .replace(/^[a-z][a-z0-9+.-]*:\/\//i, '')
    .split(/[/?#]/)[0]!
    .replace(/\.$/, '')
    .toLowerCase();
}

/** Nombre de dominio o «localhost»: etiquetas de letras, números y guiones, hasta 253 caracteres. */
export function esHostValido(host: string): boolean {
  if (host.length === 0 || host.length > 253) return false;
  return host.split('.').every((etiqueta) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(etiqueta));
}

/**
 * Puertos que los navegadores no dejan consultar desde una página web (lista de la Fetch API).
 * Se rechazan para no dar resultados engañosos.
 */
export const PUERTOS_BLOQUEADOS: ReadonlySet<number> = new Set([
  1, 7, 9, 11, 13, 15, 17, 19, 20, 21, 22, 23, 25, 37, 42, 43, 53, 69, 77, 79, 87, 95, 101, 102,
  103, 104, 109, 110, 111, 113, 115, 117, 119, 123, 135, 137, 139, 143, 179, 389, 427, 465, 512,
  513, 514, 515, 526, 530, 531, 532, 540, 548, 554, 556, 563, 587, 601, 636, 989, 990, 993, 995,
  1719, 1720, 1723, 2049, 3659, 4045, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669, 6697,
  10080,
]);

export const MAX_PUERTOS = 20;

export interface ResultadoPuertos {
  puertos: number[];
  errores: string[];
}

/** Lee una lista de puertos separados por coma o espacio, sin repetidos ni bloqueados. */
export function validarPuertos(texto: string): ResultadoPuertos {
  const puertos: number[] = [];
  const errores: string[] = [];
  const tokens = texto.split(/[\s,;]+/).filter((t) => t !== '');
  for (const token of tokens) {
    if (!/^\d{1,5}$/.test(token)) {
      errores.push(`«${token}» no es un número de puerto.`);
      continue;
    }
    const numero = Number(token);
    if (numero < 1 || numero > 65535) {
      errores.push(`${numero} está fuera del rango 1-65535.`);
      continue;
    }
    if (PUERTOS_BLOQUEADOS.has(numero)) {
      errores.push(`El puerto ${numero} no se puede consultar desde el navegador.`);
      continue;
    }
    if (!puertos.includes(numero)) puertos.push(numero);
  }
  if (puertos.length > MAX_PUERTOS) {
    errores.push(`Como máximo se pueden revisar ${MAX_PUERTOS} puertos a la vez.`);
  }
  return { puertos, errores };
}

// ---------------------------------------------------------------------------
// DNS (respuesta JSON de DNS over HTTPS, formato de Google Public DNS)
// ---------------------------------------------------------------------------

export const TIPOS_DNS = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA'] as const;
export type TipoDns = (typeof TIPOS_DNS)[number];

/** Qué significa cada tipo de registro, para mostrarlo al elegirlo en el selector. */
export const DESCRIPCION_TIPO_DNS: Readonly<Record<TipoDns, string>> = {
  A: 'Dirección IPv4: el número IP (por ejemplo 93.184.216.34) al que apunta el dominio.',
  AAAA: 'Dirección IPv6: igual que A, pero para direcciones IPv6 (más largas).',
  MX: 'Servidores de correo: dónde se entregan los correos del dominio. El número más bajo tiene prioridad.',
  TXT: 'Textos libres: se usan para verificar el dominio en servicios externos y para reglas de correo (SPF, DKIM, DMARC).',
  NS: 'Servidores de nombres: los servidores DNS que administran las zonas del dominio.',
  CNAME: 'Alias: un nombre que apunta a otro nombre, en lugar de a una IP directamente.',
  SOA: 'Registro de autoridad: datos administrativos de la zona (servidor principal, contacto y versión).',
};

/** Código numérico de cada tipo DNS que devuelve la API JSON. */
export const CODIGO_TIPO_DNS: Readonly<Record<number, string>> = {
  1: 'A',
  2: 'NS',
  5: 'CNAME',
  6: 'SOA',
  15: 'MX',
  16: 'TXT',
  28: 'AAAA',
};

const ESTADO_DNS: Readonly<Record<number, string>> = {
  0: 'Consulta correcta',
  2: 'El servidor DNS no pudo responder (SERVFAIL)',
  3: 'El dominio no existe (NXDOMAIN)',
  5: 'El servidor rechazó la consulta (REFUSED)',
};

export interface RegistroDns {
  tipo: string;
  ttl: number;
  valor: string;
}

export interface ResultadoDns {
  estado: string;
  registros: RegistroDns[];
  error?: string;
}

/** Interpreta la respuesta JSON de la API DNS. Valida la forma antes de usar los datos. */
export function interpretarRespuestaDns(respuesta: unknown): ResultadoDns {
  if (typeof respuesta !== 'object' || respuesta === null) {
    return { estado: '', registros: [], error: 'La respuesta del servicio DNS no es válida.' };
  }
  const { Status, Answer } = respuesta as { Status?: unknown; Answer?: unknown };
  if (typeof Status !== 'number') {
    return { estado: '', registros: [], error: 'La respuesta del servicio DNS no es válida.' };
  }
  const estado = ESTADO_DNS[Status] ?? `Código de estado ${Status}`;
  const registros: RegistroDns[] = [];
  if (Array.isArray(Answer)) {
    for (const item of Answer) {
      if (typeof item !== 'object' || item === null) continue;
      const { type, TTL, data } = item as { type?: unknown; TTL?: unknown; data?: unknown };
      if (typeof type !== 'number' || typeof TTL !== 'number' || typeof data !== 'string') continue;
      const tipo = CODIGO_TIPO_DNS[type];
      if (tipo === undefined) continue;
      registros.push({ tipo, ttl: TTL, valor: data });
    }
  }
  return { estado, registros };
}

// ---------------------------------------------------------------------------
// Quién soy: lectura del user agent
// ---------------------------------------------------------------------------

export interface NavegadorSistema {
  navegador: string;
  sistema: string;
}

/** Nombre aproximado del navegador y del sistema, a partir del user agent. */
export function describirNavegador(userAgent: string): NavegadorSistema {
  let navegador = 'Desconocido';
  if (/Edg\//.test(userAgent)) navegador = 'Microsoft Edge';
  else if (/OPR\//.test(userAgent)) navegador = 'Opera';
  else if (/Firefox\//.test(userAgent)) navegador = 'Firefox';
  else if (/Chrome\//.test(userAgent) || /CriOS\//.test(userAgent)) navegador = 'Chrome';
  else if (/Safari\//.test(userAgent)) navegador = 'Safari';

  let sistema = 'Desconocido';
  if (/Windows NT 10\.0/.test(userAgent)) sistema = 'Windows 10 u 11';
  else if (/Windows/.test(userAgent)) sistema = 'Windows';
  else if (/iPhone|iPad|iPod/.test(userAgent)) sistema = 'iOS / iPadOS';
  else if (/Android/.test(userAgent)) sistema = 'Android';
  else if (/Mac OS X/.test(userAgent)) sistema = 'macOS';
  else if (/CrOS/.test(userAgent)) sistema = 'ChromeOS';
  else if (/Linux/.test(userAgent)) sistema = 'Linux';

  return { navegador, sistema };
}
