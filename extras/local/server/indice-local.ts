/*
 * Índice de la versión local: reordena las tarjetas y convierte las de herramientas locales
 * en enlaces a sus páginas. Solo se aplica en el servidor de desarrollo de extras/local;
 * la compilación pública de la raíz no se toca.
 */
import type { Plugin } from 'vite';
import { PAGINAS, type Herramienta } from './disponibilidad.ts';

/** Id del título de cada tarjeta (identifica el <article> en index.html). */
const TARJETA = {
  video: 'tool-video-title',
  musica: 'tool-music-title',
  playlist: 'tool-playlist-title',
  transcribir: 'tool-trans-title',
  ocr: 'tool-ocr-title',
  'pdf-documento': 'tool-pdf-doc-title',
  grabar: 'tool-rec-title',
  dividir: 'tool-dividir-pdf-title',
} as const;

const ARROW = '<svg class="icon" aria-hidden="true"><use href="#i-arrow" /></svg>';

function articulos(html: string): Array<{ texto: string; inicio: number; fin: number }> {
  const lista: Array<{ texto: string; inicio: number; fin: number }> = [];
  const re = /<article[\s\S]*?<\/article>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    lista.push({ texto: m[0], inicio: m.index, fin: m.index + m[0].length });
  }
  return lista;
}

function buscar(html: string, id: string): { texto: string; inicio: number; fin: number } {
  const hallado = articulos(html).find((a) => a.texto.includes(`id="${id}"`));
  if (!hallado) throw new Error(`indice-local: no se encontró la tarjeta ${id} en index.html`);
  return hallado;
}

/** Cambia el pie (badge o botón) por un enlace a la página de la herramienta. */
function conEnlace(texto: string, herramienta: Herramienta, nombre: string): string {
  const href = PAGINAS[herramienta];
  const pie = `<p class="tool-card__foot"><a class="tool-card__cta" href="${href}">Abrir ${nombre} ${ARROW}</a></p>`;
  const nuevo = texto.replace(/<p class="tool-card__foot">[\s\S]*?<\/p>/, pie);
  return nuevo.replace(/\sdata-dev-link/, '');
}

/** Quita un <article> del HTML por posición. */
function quitar(html: string, a: { inicio: number; fin: number }): string {
  return html.slice(0, a.inicio) + html.slice(a.fin);
}

export function indiceLocal(): Plugin {
  return {
    name: 'indice-local-herramientas',
    apply: 'serve',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        // Solo la portada: Vite también transforma las demás páginas HTML, que no tienen estas tarjetas.
        if (!ctx.server || (ctx.path !== '/index.html' && ctx.path !== '/')) return html;
        try {
          return reordenar(html);
        } catch (err) {
          console.warn(`[indice-local] no se reordenó la portada: ${err instanceof Error ? err.message : err}`);
          return html;
        }
      },
    },
  };
}

function reordenar(html: string): string {
  {
        // 1) Tomar las tarjetas que se mueven (antes de tocar el HTML).
        const video = conEnlace(buscar(html, TARJETA.video).texto, 'video', 'el descargador de video');
        const musica = conEnlace(buscar(html, TARJETA.musica).texto, 'musica', 'el descargador de música');
        const playlist = conEnlace(buscar(html, TARJETA.playlist).texto, 'playlist', 'el descargador de playlist');
        const transcribir = conEnlace(buscar(html, TARJETA.transcribir).texto, 'transcribir', 'la transcripción');
        const pdfDoc = conEnlace(buscar(html, TARJETA['pdf-documento']).texto, 'pdf-documento', 'PDF a documento');
        const ocr = conEnlace(buscar(html, TARJETA.ocr).texto, 'ocr', 'el OCR');

        // 2) Quitarlas de donde están (de la última posición a la primera para no desplazar índices).
        const quitarIds = [TARJETA.video, TARJETA.musica, TARJETA.playlist, TARJETA.transcribir, TARJETA['pdf-documento'], TARJETA.ocr];
        let resto = html;
        const posiciones = quitarIds.map((id) => buscar(html, id)).sort((x, y) => y.inicio - x.inicio);
        for (const p of posiciones) resto = quitar(resto, p);

        // 3) Insertar en su sitio. Las anclas (Grabar audio, Dividir PDF) no se han movido.
        const grabar = buscar(resto, TARJETA.grabar);
        const dividir = buscar(resto, TARJETA.dividir);
        // Dividir PDF está más abajo que Grabar audio: insertamos primero en esa posición, que no
        // desplaza la de Grabar audio (está antes en el HTML).
        const despuesDividir = `\n${pdfDoc}\n${ocr}`;
        const despuesGrabar = `\n${transcribir}`;
        resto = resto.slice(0, dividir.fin) + despuesDividir + resto.slice(dividir.fin);
        resto = resto.slice(0, grabar.fin) + despuesGrabar + resto.slice(grabar.fin);

        // 4) Bloque de YouTube al principio, antes de la primera categoría.
        const bloqueYoutube = `<div class="tool-category">
            <h3 class="tool-category__title">
              <svg class="icon tool-category__icon" aria-hidden="true">
                <use href="#i-youtube" /></svg
              >Descargas de YouTube (local)
            </h3>
            <div class="tools-grid">
              ${video}
              ${musica}
              ${playlist}
            </div>
          </div>
          `;
        const primera = resto.indexOf('<div class="tool-category">');
        if (primera < 0) throw new Error('indice-local: no se encontró la primera categoría');
        resto = resto.slice(0, primera) + bloqueYoutube + resto.slice(primera);

        return resto;
  }
}
