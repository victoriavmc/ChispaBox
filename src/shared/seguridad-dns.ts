/*
 * Análisis opcional de seguridad y correo de un dominio, a partir de sus registros DNS.
 * Solo reglas sobre los textos publicados: no se envía ni se prueba ningún correo ni conexión.
 */

export type EstadoChequeo = 'ok' | 'alerta' | 'falta';

export interface ChequeoDns {
  id: string;
  titulo: string;
  estado: EstadoChequeo;
  detalle: string;
}

/** Registros ya consultados: cada lista trae solo los valores de ese tipo. */
export interface RegistrosDominio {
  mx: string[];
  ns: string[];
  txtRaiz: string[];
  txtDmarc: string[];
  caa: string[];
  ds: string[];
}

/** Política DMARC (p=none, quarantine o reject), o null si no aparece. */
export function politicaDmarc(registro: string): string | null {
  const coincidencia = /(?:^|;)\s*p=(\w+)/i.exec(registro);
  return coincidencia ? coincidencia[1].toLowerCase() : null;
}

/** Evalúa SPF, DMARC, MX, NS, CAA y DNSSEC según los registros consultados. */
export function chequearDns(registros: RegistrosDominio): ChequeoDns[] {
  const chequeos: ChequeoDns[] = [];

  chequeos.push(
    registros.mx.length > 0
      ? { id: 'mx', titulo: 'Correo (MX)', estado: 'ok', detalle: `${registros.mx.length} servidor(es) de correo configurado(s).` }
      : { id: 'mx', titulo: 'Correo (MX)', estado: 'alerta', detalle: 'No hay servidores de correo: el dominio no recibe correos.' },
  );

  const spf = registros.txtRaiz.filter((t) => /^v=spf1\b/i.test(t));
  chequeos.push(
    spf.length === 1
      ? { id: 'spf', titulo: 'SPF', estado: 'ok', detalle: 'Hay un registro SPF: indica qué servidores pueden enviar correo por el dominio.' }
      : spf.length === 0
        ? { id: 'spf', titulo: 'SPF', estado: 'falta', detalle: 'Falta SPF: es más fácil suplantar correos del dominio.' }
        : { id: 'spf', titulo: 'SPF', estado: 'alerta', detalle: 'Hay más de un registro SPF: eso invalida el SPF.' },
  );

  const politicas = registros.txtDmarc.filter((t) => /^v=DMARC1\b/i.test(t)).map(politicaDmarc);
  const politica = politicas.find((p) => p !== null) ?? null;
  if (politica === null) {
    chequeos.push({ id: 'dmarc', titulo: 'DMARC', estado: 'falta', detalle: 'Falta DMARC: no hay política para los correos que fallan SPF o DKIM.' });
  } else if (politica === 'none') {
    chequeos.push({ id: 'dmarc', titulo: 'DMARC', estado: 'alerta', detalle: 'DMARC en modo de solo observar (p=none): no bloquea correos falsos.' });
  } else {
    chequeos.push({ id: 'dmarc', titulo: 'DMARC', estado: 'ok', detalle: `DMARC con política p=${politica}.` });
  }

  chequeos.push(
    registros.ns.length >= 2
      ? { id: 'ns', titulo: 'Servidores de nombres (NS)', estado: 'ok', detalle: `${registros.ns.length} servidores de nombres: hay redundancia.` }
      : { id: 'ns', titulo: 'Servidores de nombres (NS)', estado: 'alerta', detalle: 'Un solo servidor de nombres: si cae, el dominio deja de resolverse.' },
  );

  chequeos.push(
    registros.caa.length > 0
      ? { id: 'caa', titulo: 'Autoridades de certificado (CAA)', estado: 'ok', detalle: 'Hay registros CAA: limitan qué autoridades pueden emitir certificados.' }
      : { id: 'caa', titulo: 'Autoridades de certificado (CAA)', estado: 'falta', detalle: 'Sin CAA: cualquier autoridad de certificados puede emitir uno para el dominio.' },
  );

  chequeos.push(
    registros.ds.length > 0
      ? { id: 'dnssec', titulo: 'DNSSEC', estado: 'ok', detalle: 'DNSSEC está activo: las respuestas DNS están firmadas.' }
      : { id: 'dnssec', titulo: 'DNSSEC', estado: 'alerta', detalle: 'DNSSEC no está habilitado: las respuestas DNS podrían falsificarse.' },
  );

  return chequeos;
}
