/*
 * Página «Documentos a PDF»: selector de origen (Word, Excel, PowerPoint, Imágenes)
 * y arranque de cada pestaña. Las pestañas se navegan con teclado (flechas, Inicio y Fin).
 */
import '../styles/image-tools.css';
import '../styles/documentos-pdf.css';
import { initImagenes } from './documentos-pdf-imagenes.ts';
import { initOficina, setOfficeKind, type OfficeKind } from './documentos-pdf-oficina.ts';
import { requireEl } from '../lib/ui-common.ts';

type Tab = OfficeKind | 'imagenes';
const TABS: Tab[] = ['word', 'excel', 'powerpoint', 'imagenes'];

const tabButtons = new Map<Tab, HTMLButtonElement>();
for (const tab of TABS) tabButtons.set(tab, requireEl<HTMLButtonElement>(`doc-tab-${tab}`));
const officePanel = requireEl<HTMLElement>('panel-oficina');
const imagesPanel = requireEl<HTMLElement>('panel-imagenes');

function select(tab: Tab, focus = false): void {
  for (const [key, button] of tabButtons) {
    const active = key === tab;
    button.setAttribute('aria-selected', String(active));
    button.tabIndex = active ? 0 : -1;
    if (active && focus) button.focus();
  }
  const isImages = tab === 'imagenes';
  imagesPanel.hidden = !isImages;
  officePanel.hidden = isImages;
  if (!isImages) {
    const labels: Record<OfficeKind, string> = {
      word: 'Word a PDF',
      excel: 'Excel a PDF',
      powerpoint: 'PowerPoint a PDF',
    };
    requireEl<HTMLElement>('ofi-heading').textContent = labels[tab];
    setOfficeKind(tab);
  }
  // Mantiene la URL sin recargar: permite compartir la pestaña abierta.
  history.replaceState(null, '', `#${tab}`);
}

TABS.forEach((tab, index) => {
  const button = tabButtons.get(tab);
  if (!button) return;
  button.addEventListener('click', () => select(tab));
  button.addEventListener('keydown', (e) => {
    let next: number | null = null;
    if (e.key === 'ArrowRight') next = (index + 1) % TABS.length;
    if (e.key === 'ArrowLeft') next = (index - 1 + TABS.length) % TABS.length;
    if (e.key === 'Home') next = 0;
    if (e.key === 'End') next = TABS.length - 1;
    if (next === null) return;
    e.preventDefault();
    const target = TABS[next];
    select(target, true);
  });
});

const initial = (location.hash.replace('#', '') as Tab) || 'word';
initOficina();
initImagenes();
select(TABS.includes(initial) ? initial : 'word');
