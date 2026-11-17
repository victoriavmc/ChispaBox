/*
 * «Contacto» del pie de página: abre un diálogo con la dirección oficial, el aviso de Gmail,
 * el botón «Copiar correo» (para Outlook, Proton Mail u otro servicio) y el enlace a Gmail.
 * No carga nada externo ni envía datos hasta que la persona hace clic en «Abrir Gmail».
 */
import '../styles/footer-contacto.css';

const abrir = document.querySelector<HTMLButtonElement>('[data-abrir-contacto]');
const dialogo = document.getElementById('contacto-modal') as HTMLDialogElement | null;
const boton = document.querySelector<HTMLButtonElement>('[data-copiar-correo]');
const estado = document.querySelector<HTMLElement>('.contacto-modal .site-footer__estado');

if (abrir && dialogo) {
  abrir.addEventListener('click', () => {
    if (!dialogo.open) dialogo.showModal();
  });
  // Cerrar al hacer clic fuera de la caja.
  dialogo.addEventListener('click', (e) => {
    if (e.target === dialogo) dialogo.close();
  });
  // Al cerrar, limpiar el aviso de copia.
  dialogo.addEventListener('close', () => {
    if (estado) estado.textContent = '';
  });
}

/** Respaldo para navegadores o contextos que no dan acceso a la API del portapapeles. */
function copiarConRespaldo(texto: string): boolean {
  const area = document.createElement('textarea');
  area.value = texto;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.append(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  return ok;
}

if (boton && estado) {
  boton.addEventListener('click', async () => {
    const correo = boton.dataset.copiarCorreo ?? '';
    // Primero el método sincrónico, que conserva el gesto del clic; luego la API moderna.
    if (copiarConRespaldo(correo)) {
      estado.textContent = 'Correo copiado.';
      return;
    }
    try {
      await navigator.clipboard.writeText(correo);
      estado.textContent = 'Correo copiado.';
    } catch {
      estado.textContent = 'No se pudo copiar. Seleccioná la dirección y copiala a mano.';
    }
  });
}
