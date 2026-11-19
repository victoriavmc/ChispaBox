/*
 * Página «Calculadora de IP»: red, máscara, broadcast y rango de hosts de una IPv4.
 * Todo el cálculo es local (src/shared/redes.ts).
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/grabar-audio.css';
import '../styles/redes.css';
import { calcularSubred } from '../shared/redes.ts';
import { mostrarError, ocultarError, pintarDatos, requireEl } from '../lib/red-dom.ts';

const E = {
  form: requireEl<HTMLFormElement>('ip-form'),
  entrada: requireEl<HTMLInputElement>('ip-entrada'),
  datos: requireEl<HTMLElement>('ip-datos'),
  error: requireEl<HTMLElement>('ip-error'),
  status: requireEl<HTMLElement>('ip-status'),
};

function calcular(): void {
  ocultarError(E.error);
  const resultado = calcularSubred(E.entrada.value);
  if (!resultado.ok) {
    E.datos.hidden = true;
    E.datos.replaceChildren();
    mostrarError(E.error, resultado.error);
    E.status.textContent = '';
    return;
  }
  const d = resultado.datos;
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
