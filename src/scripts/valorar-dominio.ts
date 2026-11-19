/*
 * Página «Valorar un dominio»: puntaje orientativo (0 a 100) con reglas simples. Todo en el navegador.
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import '../styles/grabar-audio.css';
import '../styles/redes.css';
import { valorarDominio, validarDominio } from '../shared/dominios.ts';
import { mostrarError, ocultarError, requireEl } from '../lib/red-dom.ts';

const E = {
  form: requireEl<HTMLFormElement>('val-form'),
  entrada: requireEl<HTMLInputElement>('val-entrada'),
  error: requireEl<HTMLElement>('val-error'),
  resultado: requireEl<HTMLElement>('val-resultado'),
  puntaje: requireEl<HTMLElement>('val-puntaje'),
  criterios: requireEl<HTMLElement>('val-criterios'),
  status: requireEl<HTMLElement>('val-status'),
};

E.form.addEventListener('submit', (event) => {
  event.preventDefault();
  ocultarError(E.error);
  const v = validarDominio(E.entrada.value);
  if (!v.ok) {
    mostrarError(E.error, v.error);
    return;
  }
  const { puntaje, criterios } = valorarDominio(v.ascii);
  E.puntaje.textContent = `${v.unicode}: ${puntaje} de 100`;
  E.criterios.replaceChildren(
    ...criterios.map((c) => {
      const li = document.createElement('li');
      const proporcion = c.puntos / c.maximo;
      li.className = `dns-chequeo dns-chequeo--${proporcion >= 0.7 ? 'ok' : proporcion >= 0.4 ? 'alerta' : 'falta'}`;
      const cab = document.createElement('div');
      cab.className = 'dns-chequeo__cabecera';
      const t = document.createElement('strong');
      t.textContent = c.titulo;
      const p = document.createElement('span');
      p.className = 'dns-chequeo__estado';
      p.textContent = `${c.puntos} / ${c.maximo}`;
      cab.append(t, p);
      const d = document.createElement('p');
      d.className = 'dns-chequeo__detalle';
      d.textContent = c.detalle;
      li.append(cab, d);
      return li;
    }),
  );
  E.resultado.hidden = false;
  E.status.textContent = `Valoración terminada para ${v.ascii}.`;
});
