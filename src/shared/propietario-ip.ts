/*
 * «De quién es esta IP»: interpreta la respuesta RDAP (estándar IETF, JSON) de una dirección IP.
 * Solo se muestran datos de organizaciones y el correo de abuso; no se muestran nombres
 * ni teléfonos de personas físicas que figuran en el registro.
 */

import { nombrePais } from './ip-publica.ts';

type Json = Record<string, unknown>;

const esObjeto = (valor: unknown): valor is Json => typeof valor === 'object' && valor !== null;

/** Valor de un campo de vCard (fn, email, adr…) dentro de una entidad RDAP. */
function campoVcard(entidad: Json, campo: string): string | null {
  const vcard = entidad.vcardArray;
  if (!Array.isArray(vcard) || !Array.isArray(vcard[1])) return null;
  for (const propiedad of vcard[1]) {
    if (!Array.isArray(propiedad) || propiedad[0] !== campo) continue;
    const valor = propiedad[3];
    if (typeof valor === 'string' && valor !== '') return valor;
    if (Array.isArray(valor)) {
      const texto = valor.filter((p): p is string => typeof p === 'string' && p !== '').join(', ');
      if (texto !== '') return texto;
    }
  }
  return null;
}

/** Primera entidad con el rol pedido («registrant», «abuse»…). */
function entidadConRol(json: Json, rol: string): Json | null {
  const entidades = Array.isArray(json.entities) ? json.entities : [];
  for (const entidad of entidades) {
    if (!esObjeto(entidad)) continue;
    if (Array.isArray(entidad.roles) && entidad.roles.includes(rol)) {
      return entidad;
    }
  }
  return null;
}

/** Fecha de un evento RDAP (registration, last changed…) en formato corto. */
function fechaEvento(json: Json, accion: string): string | null {
  const eventos = Array.isArray(json.events) ? json.events : [];
  for (const evento of eventos) {
    if (esObjeto(evento) && evento.eventAction === accion && typeof evento.eventDate === 'string') {
      const fecha = new Date(evento.eventDate);
      return Number.isNaN(fecha.getTime()) ? evento.eventDate.slice(0, 10) : fecha.toISOString().slice(0, 10);
    }
  }
  return null;
}

/** Registro regional de Internet a partir del servidor RDAP que respondió (rdap.lacnic.net → LACNIC). */
export function registroRegional(urlRespuesta: string): string {
  const nombres: Array<[RegExp, string]> = [
    [/lacnic/i, 'LACNIC (Latinoamérica y Caribe)'],
    [/arin/i, 'ARIN (América del Norte)'],
    [/ripe/i, 'RIPE NCC (Europa, Medio Oriente, Asia central)'],
    [/apnic/i, 'APNIC (Asia-Pacífico)'],
    [/afrinic/i, 'AFRINIC (África)'],
  ];
  for (const [patron, nombre] of nombres) {
    if (patron.test(urlRespuesta)) return nombre;
  }
  return 'No identificado';
}

export interface DatosPropietario {
  bloque: string;
  rango: string;
  nombreRed: string;
  titular: string;
  pais: string;
  abuso: string;
  registrado: string;
  modificado: string;
  registro: string;
  asignacion: string;
}

export type ResultadoPropietario = { ok: true; datos: DatosPropietario } | { ok: false; error: string };

/** Valida y resume una respuesta RDAP de IP. `urlRespuesta` es la dirección final que respondió. */
export function interpretarRdapIp(respuesta: unknown, urlRespuesta: string): ResultadoPropietario {
  if (!esObjeto(respuesta) || respuesta.objectClassName !== 'ip network') {
    return { ok: false, error: 'La respuesta del registro no corresponde a un bloque de IP.' };
  }
  const json = respuesta;
  const texto = (valor: unknown): string | null => (typeof valor === 'string' && valor !== '' ? valor : null);

  const cidrs = Array.isArray(json.cidr0_cidrs) ? json.cidr0_cidrs : [];
  const primerCidr = esObjeto(cidrs[0]) ? cidrs[0] : null;
  const bloque =
    primerCidr && typeof primerCidr.v4prefix === 'string' && typeof primerCidr.length === 'number'
      ? `${primerCidr.v4prefix}/${primerCidr.length}`
      : texto(json.handle) ?? 'No informado';

  const titularEntidad = entidadConRol(json, 'registrant');
  const abuseEntidad = entidadConRol(json, 'abuse');
  // El campo «adr» trae la dirección como lista; el país es el último elemento no vacío.
  let paisCodigo: string | null = null;
  const vcard = titularEntidad?.vcardArray;
  if (Array.isArray(vcard) && Array.isArray(vcard[1])) {
    for (const propiedad of vcard[1]) {
      if (Array.isArray(propiedad) && propiedad[0] === 'adr' && Array.isArray(propiedad[3])) {
        const partes = propiedad[3].filter((p): p is string => typeof p === 'string' && p !== '');
        paisCodigo = partes.length > 0 ? partes[partes.length - 1] : null;
      }
    }
  }

  return {
    ok: true,
    datos: {
      bloque,
      rango: texto(json.startAddress) && texto(json.endAddress) ? `${json.startAddress} – ${json.endAddress}` : 'No informado',
      nombreRed: texto(json.name) ?? 'No informado',
      titular: (titularEntidad && campoVcard(titularEntidad, 'fn')) ?? 'No informado',
      pais: paisCodigo ? nombrePais(paisCodigo) : (texto(json.country) ?? 'No informado'),
      abuso: (abuseEntidad && campoVcard(abuseEntidad, 'email')) ?? 'No publicado',
      registrado: fechaEvento(json, 'registration') ?? 'No informado',
      modificado: fechaEvento(json, 'last changed') ?? 'No informado',
      registro: registroRegional(urlRespuesta),
      asignacion: texto(json.type) ?? 'No informado',
    },
  };
}
