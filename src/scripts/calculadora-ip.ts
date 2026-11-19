/*
 * Página «Calculadora de IP»: red, máscara, broadcast y rango de hosts de una IPv4.
 * Todo el cálculo es local (src/shared/redes.ts).
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/grabar-audio.css';
import '../styles/redes.css';
import { calcularSubred, parseIPv4, type DatosSubred } from '../shared/redes.ts';
import { mostrarError, ocultarError, pintarDatos, requireEl } from '../lib/red-dom.ts';

const E = {
  form: requireEl<HTMLFormElement>('ip-form'),
  entrada: requireEl<HTMLInputElement>('ip-entrada'),
  datos: requireEl<HTMLElement>('ip-datos'),
  binario: requireEl<HTMLElement>('ip-binario'),
  binarioSeccion: requireEl<HTMLElement>('ip-binario-seccion'),
  error: requireEl<HTMLElement>('ip-error'),
  status: requireEl<HTMLElement>('ip-status'),
};

/** Cada bit de una IPv4 (32 valores), en orden de mayor a menor peso. */
function bitsDe(numero: number): number[] {
  const bits: number[] = [];
  for (let s = 31; s >= 0; s--) bits.push((numero >>> s) & 1);
  return bits;
}

/**
 * Una fila de la representación binaria. Cada bit se colorea según su rol:
 * - «ip», «red», «host»: los primeros `prefijo` bits son de red; el resto, de host.
 * - «mascara»: los unos son la máscara; los ceros, no.
 */
function filaBinaria(etiqueta: string, numero: number, prefijo: number, modo: 'red' | 'mascara', extra = ''): HTMLElement {
  const fila = document.createElement('div');
  fila.className = 'bin-fila';

  const titulo = document.createElement('span');
  titulo.className = 'bin-fila__etiqueta';
  titulo.textContent = etiqueta;

  const valor = document.createElement('span');
  valor.className = 'bin-fila__bits';
  bitsDe(numero).forEach((bit, indice) => {
    if (indice > 0 && indice % 8 === 0) valor.append('.');
    const span = document.createElement('span');
    if (modo === 'mascara') {
      span.className = bit === 1 ? 'bin--mascara' : 'bin--host';
    } else {
      span.className = indice < prefijo ? 'bin--red' : 'bin--host';
    }
    span.textContent = String(bit);
    valor.append(span);
  });

  const decimal = document.createElement('span');
  decimal.className = 'bin-fila__decimal';
  decimal.textContent = extra || `${(numero >>> 24) & 255}.${(numero >>> 16) & 255}.${(numero >>> 8) & 255}.${numero & 255}`;

  fila.append(titulo, valor, decimal);
  return fila;
}

/** Pinta la representación binaria, en el mismo formato que las calculadoras de referencia. */
function pintarBinario(d: DatosSubred): void {
  const ip = parseIPv4(d.ip);
  const mascara = parseIPv4(d.mascara);
  const red = parseIPv4(d.red);
  const broadcast = parseIPv4(d.broadcast);
  const primera = parseIPv4(d.primeraIp);
  const ultima = parseIPv4(d.ultimaIp);
  if ([ip, mascara, red, broadcast, primera, ultima].some((v) => v === null)) {
    E.binarioSeccion.hidden = true;
    return;
  }
  E.binario.replaceChildren(
    filaBinaria('Dirección', ip!, d.prefijo, 'red'),
    filaBinaria('Máscara', mascara!, d.prefijo, 'mascara', `${d.mascara} = /${d.prefijo}`),
    filaBinaria('Wildcard', (~mascara!) >>> 0, 0, 'red'),
    filaBinaria('Red', red!, d.prefijo, 'red'),
    filaBinaria('Primer host', primera!, d.prefijo, 'red'),
    filaBinaria('Último host', ultima!, d.prefijo, 'red'),
    filaBinaria('Broadcast', broadcast!, d.prefijo, 'red'),
  );
  E.binarioSeccion.hidden = false;
}

function calcular(): void {
  ocultarError(E.error);
  const resultado = calcularSubred(E.entrada.value);
  if (!resultado.ok) {
    E.datos.hidden = true;
    E.datos.replaceChildren();
    E.binarioSeccion.hidden = true;
    E.binario.replaceChildren();
    mostrarError(E.error, resultado.error);
    E.status.textContent = '';
    return;
  }
  const d = resultado.datos;
  pintarBinario(d);
  pintarDatos(E.datos, [
    ['Dirección IP', `${d.ip}/${d.prefijo}`],
    ['Máscara de subred', d.mascara],
    ['Máscara wildcard', d.wildcard],
    ['Dirección de red', d.red],
    ['Broadcast', d.broadcast],
    ['Primer host', d.primeraIp],
    ['Último host', d.ultimaIp],
    ['Cantidad de hosts', d.hosts.toLocaleString('es-AR')],
    ['Clase', d.clase],
    ['Tipo de dirección', d.tipo],
  ]);
  E.status.textContent = `Subred calculada: ${d.red}/${d.prefijo}.`;
}

E.form.addEventListener('submit', (event) => {
  event.preventDefault();
  calcular();
});
