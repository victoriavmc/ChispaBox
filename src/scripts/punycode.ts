/*
 * Página «Convertidor Punycode»: dominios con tildes o alfabetos propios ↔ forma ASCII (xn--).
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/grabar-audio.css';
import '../styles/redes.css';
import { dominioAscii, dominioUnicode } from '../shared/dominios.ts';
import { mostrarError, ocultarError, pintarDatos, requireEl } from '../lib/red-dom.ts';

const E = {
  form: requireEl<HTMLFormElement>('pun-form'),
  entrada: requireEl<HTMLInputElement>('pun-entrada'),
  btnAscii: requireEl<HTMLButtonElement>('pun-btn-ascii'),
  btnTexto: requireEl<HTMLButtonElement>('pun-btn-texto'),
  error: requireEl<HTMLElement>('pun-error'),
  resultado: requireEl<HTMLElement>('pun-resultado'),
  datos: requireEl<HTMLElement>('pun-datos'),
  status: requireEl<HTMLElement>('pun-status'),
};

/** Quita esquema y ruta: «https://münchen.de/x» → «münchen.de». */
function limpiar(texto: string): string {
  return texto.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split('/')[0] ?? '';
}

function convertir(modo: 'ascii' | 'texto'): void {
  ocultarError(E.error);
  const entrada = limpiar(E.entrada.value);
  if (entrada === '') {
    mostrarError(E.error, 'Escribí un dominio para convertir.');
    return;
  }
  const ascii = dominioAscii(entrada);
  if (ascii === null) {
    mostrarError(E.error, 'Ese texto no se puede convertir a un dominio válido.');
    return;
  }
  const unicode = dominioUnicode(ascii);
  pintarDatos(E.datos, [
    ['Forma ASCII (para registrar y usar en DNS)', ascii],
    ['Forma con tildes o alfabeto original', unicode],
  ]);
  E.resultado.hidden = false;
  E.entrada.value = modo === 'ascii' ? ascii : unicode;
  E.status.textContent = `Convertido a ${modo === 'ascii' ? 'ASCII' : 'texto con tildes'}.`;
}

E.form.addEventListener('submit', (event) => {
  event.preventDefault();
  convertir('ascii');
});
E.btnTexto.addEventListener('click', () => convertir('texto'));
E.btnAscii.addEventListener('click', (event) => {
  event.preventDefault();
  convertir('ascii');
});
