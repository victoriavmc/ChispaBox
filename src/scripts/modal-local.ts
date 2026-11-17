/*
 * Modal de «Disponible en la versión local»: al hacer clic en la etiqueta de una
 * herramienta local se abre un aviso que lleva al repositorio de GitHub.
 */
import '../styles/modal-local.css';

const modal = document.getElementById('local-modal') as HTMLDialogElement | null;

if (modal) {
  const abrir = (e: Event) => {
    e.preventDefault();
    if (!modal.open) modal.showModal();
  };
  document.querySelectorAll<HTMLElement>('[data-local-modal]').forEach((boton) => {
    boton.addEventListener('click', abrir);
  });
  // Cerrar al hacer clic en el fondo (fuera de la caja).
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.close();
  });
}
