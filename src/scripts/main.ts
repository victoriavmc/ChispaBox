import '../styles/variables.css';
import '../styles/main.css';
import '../styles/responsive.css';
import '../styles/clean-tool.css';
import '../styles/not-found.css';
import '../styles/encabezado.css';
import '../styles/categorias.css';

import { initTheme } from './theme';
import { initTextTools } from './text-tools';
import { initSuggestions } from './suggestions';
import './modal-local';
import './footer-contacto';

initTheme();

// El contador vive en contador.html; en la landing no hay textarea y se omite.
if (document.querySelector('#text-input')) {
  initTextTools();
}

initSuggestions();

// Cuenta las herramientas que funcionan: no cuenta las tarjetas «Próximamente» (tool-card--soon)
// ni la tarjeta de «Próximas herramientas». Así el número es el mismo en `dev` y en la versión pública.
function actualizarContadorHerramientas(): void {
  const contador = document.getElementById('contador-herramientas');
  if (!contador) return;
  // Se excluye la tarjeta «Próximas herramientas» (no es una herramienta).
  const total = [...document.querySelectorAll('#herramientas .tool-card:not(.tool-card--soon)')].filter(
    (tarjeta) => !tarjeta.querySelector('#tool-next-title'),
  ).length;
  if (total > 0) contador.textContent = `${total} Herramientas`;
}
actualizarContadorHerramientas();

// Menú «Herramientas» del encabezado: se abre y cierra con el botón, Escape o un clic fuera.
function iniciarMenuHerramientas(): void {
  const menu = document.querySelector<HTMLElement>('[data-menu-herr]');
  const boton = document.querySelector<HTMLButtonElement>('[data-menu-herr-btn]');
  const panel = document.getElementById('menu-herr-panel');
  if (!menu || !boton || !panel) return;

  const cerrar = (): void => {
    panel.hidden = true;
    boton.setAttribute('aria-expanded', 'false');
  };
  const abrir = (): void => {
    panel.hidden = false;
    boton.setAttribute('aria-expanded', 'true');
  };

  boton.addEventListener('click', (event) => {
    event.stopPropagation();
    if (panel.hidden) abrir();
    else cerrar();
  });
  panel.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('a')) cerrar();
  });
  document.addEventListener('click', (event) => {
    if (!menu.contains(event.target as Node)) cerrar();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      cerrar();
      boton.focus();
    }
  });
}
iniciarMenuHerramientas();
