/*
 * Visor de vista previa de PDF con PDF.js (pdfjs-dist), 100 % local:
 * el worker, los mapas de caracteres y las fuentes estándar se sirven desde /pdfjs/
 * (copiados de node_modules por scripts/copy-pdfjs.mjs). No se usa ningún CDN.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';

type PdfJs = typeof import('pdfjs-dist');

let pdfjsPromise: Promise<PdfJs> | null = null;

function loadPdfJs(): Promise<PdfJs> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
      return lib;
    });
  }
  return pdfjsPromise;
}

export interface OpenedPdf {
  doc: PDFDocumentProxy;
  /** Libera el documento y el worker de PDF.js. */
  close: () => Promise<void>;
}

/** Abre un PDF desde bytes. Se pasa una copia para no desvincular el búfer original. */
export async function openPdf(bytes: Uint8Array): Promise<OpenedPdf> {
  const pdfjs = await loadPdfJs();
  const task = pdfjs.getDocument({
    data: bytes.slice(),
    cMapUrl: '/pdfjs/cmaps/',
    cMapPacked: true,
    standardFontDataUrl: '/pdfjs/standard_fonts/',
    wasmUrl: '/pdfjs/wasm/',
  });
  const doc = await task.promise;
  return { doc, close: () => task.destroy() };
}

/** Cuenta las páginas de un PDF abriéndolo con PDF.js (verificación independiente del escritor). */
export async function countPdfPages(bytes: Uint8Array): Promise<number> {
  const { doc, close } = await openPdf(bytes);
  try {
    return doc.numPages;
  } finally {
    await close();
  }
}

/** Dibuja una página en el canvas, ajustada al ancho disponible. */
export async function renderPage(doc: PDFDocumentProxy, pageNumber: number, canvas: HTMLCanvasElement, cssWidth: number): Promise<void> {
  const page = await doc.getPage(pageNumber);
  const base = page.getViewport({ scale: 1 });
  // Escala CSS para que la página quepa en cssWidth; el canvas se dibuja con la densidad de la pantalla.
  const cssScale = Math.min(2, Math.max(0.2, cssWidth / base.width));
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const viewport = page.getViewport({ scale: cssScale * dpr });
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);
  canvas.style.width = `${Math.floor(base.width * cssScale)}px`;
  canvas.style.height = 'auto';
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('El navegador no permite dibujar la vista previa.');
  await page.render({ canvasContext: ctx, viewport, canvas }).promise;
  page.cleanup();
}

export interface PdfViewer {
  show(bytes: Uint8Array, label: string): Promise<number>;
  clear(): void;
}

/** Crea un visor con navegación entre páginas dentro del contenedor indicado. */
export function createPdfViewer(container: HTMLElement): PdfViewer {
  const status = document.createElement('p');
  status.className = 'pdfv-status';
  status.setAttribute('role', 'status');
  const canvas = document.createElement('canvas');
  canvas.className = 'pdfv-canvas';
  canvas.setAttribute('aria-label', 'Vista previa del PDF');
  const nav = document.createElement('div');
  nav.className = 'pdfv-nav';
  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'btn btn--ghost';
  prev.textContent = 'Anterior';
  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'btn btn--ghost';
  next.textContent = 'Siguiente';
  const pageLabel = document.createElement('span');
  pageLabel.className = 'pdfv-page';
  nav.append(prev, pageLabel, next);
  container.replaceChildren(status, canvas, nav);
  container.hidden = true;

  let opened: OpenedPdf | null = null;
  let current = 1;
  let token = 0;

  const update = async () => {
    if (!opened) return;
    const { doc } = opened;
    const myToken = ++token;
    pageLabel.textContent = `Página ${current} de ${doc.numPages}`;
    prev.disabled = current <= 1;
    next.disabled = current >= doc.numPages;
    await renderPage(doc, current, canvas, Math.min(container.clientWidth || 600, 760));
    if (myToken !== token) return;
  };

  prev.addEventListener('click', () => {
    if (current > 1) {
      current -= 1;
      void update();
    }
  });
  next.addEventListener('click', () => {
    if (opened && current < opened.doc.numPages) {
      current += 1;
      void update();
    }
  });

  const release = () => {
    const previous = opened;
    opened = null;
    if (previous) void previous.close();
  };

  return {
    async show(bytes, label) {
      status.textContent = `Cargando la vista previa de ${label}…`;
      container.hidden = false;
      release();
      try {
        opened = await openPdf(bytes);
        current = 1;
        status.textContent = `Vista previa de ${label}`;
        await update();
        return opened.doc.numPages;
      } catch {
        status.textContent = 'No se pudo mostrar la vista previa de este PDF.';
        canvas.width = 0;
        canvas.height = 0;
        pageLabel.textContent = '';
        prev.disabled = true;
        next.disabled = true;
        throw new Error('No se pudo abrir el PDF para la vista previa.');
      }
    },
    clear() {
      token += 1;
      status.textContent = '';
      pageLabel.textContent = '';
      prev.disabled = true;
      next.disabled = true;
      container.hidden = true;
      canvas.width = 0;
      canvas.height = 0;
      release();
    },
  };
}
