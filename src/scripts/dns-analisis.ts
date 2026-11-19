/*
 * Análisis opcional de seguridad y correo del dominio escrito en Consulta DNS.
 * Consulta MX, NS, TXT (raíz y _dmarc), CAA y DS con dns.google y evalúa las reglas de seguridad.
 */
import '../styles/redes.css';
import { esHostValido, interpretarRespuestaDns, normalizarHost, type RegistroDns } from '../shared/redes.ts';
import { chequearDns, type ChequeoDns, type RegistrosDominio } from '../shared/seguridad-dns.ts';
import { fetchConTiempo, requireEl } from '../lib/red-dom.ts';

const E = {
  dominio: requireEl<HTMLInputElement>('dns-dominio'),
  boton: requireEl<HTMLButtonElement>('dns-analizar-btn'),
  lista: requireEl<HTMLUListElement>('dns-chequeos'),
  error: requireEl<HTMLElement>('dns-error'),
  status: requireEl<HTMLElement>('dns-status'),
};

const ETIQUETA: Record<ChequeoDns['estado'], string> = { ok: 'Correcto', alerta: 'Revisar', falta: 'Falta' };

/** Quita las comillas que devuelve la API en los TXT, uniendo los trozos entre comillas. */
function textoTxt(valor: string): string {
  const partes = valor.match(/"([^"]*)"/g);
  return partes ? partes.map((p) => p.slice(1, -1)).join('') : valor;
}

async function consultar(nombre: string, tipo: string): Promise<RegistroDns[]> {
  const url = `https://dns.google/resolve?name=${encodeURIComponent(nombre)}&type=${tipo}`;
  const respuesta = await fetchConTiempo(url, { cache: 'no-store', credentials: 'omit' }, 10000);
  if (!respuesta.ok) throw new Error(`El servicio DNS respondió con error ${respuesta.status}.`);
  const datos = interpretarRespuestaDns(await respuesta.json());
  if (datos.error) throw new Error(datos.error);
  return datos.registros;
}

function valores(registros: RegistroDns[], tipo: string): string[] {
  return registros.filter((r) => r.tipo === tipo).map((r) => (tipo === 'TXT' ? textoTxt(r.valor) : r.valor));
}

async function analizar(): Promise<void> {
  const dominio = normalizarHost(E.dominio.value);
  E.error.hidden = true;
  if (!esHostValido(dominio) || dominio.split('.').length < 2) {
    E.error.textContent = 'Primero escribí un dominio válido en la consulta de arriba, por ejemplo ejemplo.com.';
    E.error.hidden = false;
    return;
  }
  E.boton.disabled = true;
  E.status.textContent = 'Analizando el dominio…';
  E.lista.hidden = true;
  try {
    const [mx, ns, txtRaiz, txtDmarc, caa, ds] = await Promise.all([
      consultar(dominio, 'MX'),
      consultar(dominio, 'NS'),
      consultar(dominio, 'TXT'),
      consultar(`_dmarc.${dominio}`, 'TXT').catch(() => []),
      consultar(dominio, 'CAA').catch(() => []),
      consultar(dominio, 'DS').catch(() => []),
    ]);
    const registros: RegistrosDominio = {
      mx: valores(mx, 'MX'),
      ns: valores(ns, 'NS'),
      txtRaiz: valores(txtRaiz, 'TXT'),
      txtDmarc: valores(txtDmarc, 'TXT'),
      caa: valores(caa, 'CAA'),
      ds: valores(ds, 'DS'),
    };
    const chequeos = chequearDns(registros);
    E.lista.replaceChildren(...chequeos.map((c) => {
      const li = document.createElement('li');
      li.className = `dns-chequeo dns-chequeo--${c.estado}`;
      const cabecera = document.createElement('div');
      cabecera.className = 'dns-chequeo__cabecera';
      const titulo = document.createElement('strong');
      titulo.textContent = c.titulo;
      const estado = document.createElement('span');
      estado.className = 'dns-chequeo__estado';
      estado.textContent = ETIQUETA[c.estado];
      cabecera.append(titulo, estado);
      const detalle = document.createElement('p');
      detalle.className = 'dns-chequeo__detalle';
      detalle.textContent = c.detalle;
      li.append(cabecera, detalle);
      return li;
    }));
    E.lista.hidden = false;
    E.status.textContent = `Análisis terminado para ${dominio}.`;
  } catch (error) {
    E.status.textContent = '';
    E.error.textContent = error instanceof Error ? error.message : 'No se pudo completar el análisis.';
    E.error.hidden = false;
  } finally {
    E.boton.disabled = false;
  }
}

E.boton.addEventListener('click', () => void analizar());
