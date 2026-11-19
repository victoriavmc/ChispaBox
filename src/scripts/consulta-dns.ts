/*
 * Página «Consulta DNS». Consulta registros con la API JSON de Google Public DNS (DNS over HTTPS).
 * Es un servicio externo: el dominio que escribas se envía a dns.google.
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/grabar-audio.css';
import '../styles/redes.css';
import {
  DESCRIPCION_TIPO_DNS,
  TIPOS_DNS,
  type TipoDns,
  esHostValido,
  interpretarRespuestaDns,
  normalizarHost,
  type RegistroDns,
} from '../shared/redes.ts';
import { fetchConTiempo, mostrarError, ocultarError, requireEl } from '../lib/red-dom.ts';

const E = {
  form: requireEl<HTMLFormElement>('dns-form'),
  dominio: requireEl<HTMLInputElement>('dns-dominio'),
  grupo: requireEl<HTMLFieldSetElement>('dns-tipo-grupo'),
  btn: requireEl<HTMLButtonElement>('dns-btn'),
  resultado: requireEl<HTMLElement>('dns-resultado'),
  estado: requireEl<HTMLElement>('dns-estado'),
  tbody: requireEl<HTMLElement>('dns-registros'),
  tabla: requireEl<HTMLElement>('dns-tabla-wrap'),
  error: requireEl<HTMLElement>('dns-error'),
  status: requireEl<HTMLElement>('dns-status'),
};

// Un botón por tipo (radio): la descripción aparece al instante al pasar el mouse o enfocar,
// sin el retraso de los títulos nativos de un <select>.
TIPOS_DNS.forEach((tipo, indice) => {
  const etiqueta = document.createElement('label');
  etiqueta.className = 'red-tipo';
  etiqueta.dataset.desc = DESCRIPCION_TIPO_DNS[tipo];

  const radio = document.createElement('input');
  radio.type = 'radio';
  radio.name = 'dns-tipo';
  radio.value = tipo;
  radio.checked = indice === 0;

  const chip = document.createElement('span');
  chip.className = 'red-tipo__chip';
  chip.textContent = tipo;

  etiqueta.append(radio, chip);
  E.grupo.append(etiqueta);
});

function tipoElegido(): TipoDns {
  const marcado = E.grupo.querySelector<HTMLInputElement>('input[name="dns-tipo"]:checked');
  return (marcado?.value ?? 'A') as TipoDns;
}

// Debajo del grupo también se escribe qué significa el tipo elegido.
const descripcionTipo = requireEl<HTMLElement>('dns-tipo-desc');
function mostrarDescripcionTipo(): void {
  const tipo = tipoElegido();
  descripcionTipo.textContent = `${tipo}: ${DESCRIPCION_TIPO_DNS[tipo]}`;
}
E.grupo.addEventListener('change', mostrarDescripcionTipo);
mostrarDescripcionTipo();

function pintarRegistros(registros: RegistroDns[]): void {
  E.tbody.replaceChildren();
  for (const registro of registros) {
    const fila = document.createElement('tr');
    const celdas = [registro.tipo, String(registro.ttl), registro.valor];
    for (const texto of celdas) {
      const td = document.createElement('td');
      td.textContent = texto;
      fila.append(td);
    }
    E.tbody.append(fila);
  }
  E.tabla.hidden = registros.length === 0;
}

async function consultar(dominio: string, tipo: TipoDns): Promise<void> {
  ocultarError(E.error);
  E.btn.disabled = true;
  E.status.textContent = 'Consultando…';
  E.resultado.hidden = true;
  try {
    const url = `https://dns.google/resolve?name=${encodeURIComponent(dominio)}&type=${tipo}`;
    const respuesta = await fetchConTiempo(url, { cache: 'no-store', credentials: 'omit' }, 10000);
    if (!respuesta.ok) throw new Error(`El servicio DNS respondió con error ${respuesta.status}.`);
    const datos = interpretarRespuestaDns(await respuesta.json());
    if (datos.error) throw new Error(datos.error);

    E.estado.textContent = datos.estado;
    pintarRegistros(datos.registros);
    E.resultado.hidden = false;
    E.status.textContent =
      datos.registros.length === 0
        ? `Sin registros ${tipo} para ${dominio}.`
        : `${datos.registros.length} registro(s) ${tipo} para ${dominio}.`;
  } catch (error) {
    mostrarError(E.error, error instanceof Error ? error.message : 'No se pudo completar la consulta DNS.');
    E.status.textContent = '';
  } finally {
    E.btn.disabled = false;
  }
}

E.form.addEventListener('submit', (event) => {
  event.preventDefault();
  ocultarError(E.error);
  const dominio = normalizarHost(E.dominio.value);
  if (!esHostValido(dominio)) {
    mostrarError(E.error, 'Escribí un dominio válido, por ejemplo ejemplo.com.');
    return;
  }
  E.dominio.value = dominio;
  const tipo = tipoElegido();
  void consultar(dominio, tipo);
});
