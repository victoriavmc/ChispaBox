import type { Plugin } from 'vite';

// Metadatos para buscadores, redes sociales y motores de respuesta (datos estructurados).
// Se añaden a cada página HTML en la compilación; no tocan los HTML fuente.
// Si una página ya trae un valor (canonical, JSON-LD, og:*), no se duplica.

const SITE = 'https://chispabox.io';
const OG_IMAGE = `${SITE}/images/logo/chispabox-logo.png`;
const LOCALE = 'es_AR';

const escapeAttr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Ruta de Vite (/paginas/x/index.html) -> URL pública (https://chispabox.io/paginas/x/).
function urlPublica(ruta: string): string {
  const limpia = ruta.replace(/^\//, '').replace(/index\.html$/, '');
  return `${SITE}/${limpia}`;
}

function extraer(html: string, re: RegExp): string | undefined {
  const m = html.match(re);
  return m ? m[1].replace(/\s+/g, ' ').trim() : undefined;
}

function metadatosDe(html: string, ruta: string) {
  const titulo = extraer(html, /<title>([^<]*)<\/title>/) ?? 'ChispaBox';
  const descripcion =
    extraer(html, /<meta[^>]*name="description"[^>]*content="([^"]*)"/) ??
    'Pequeñas herramientas, grandes soluciones: herramientas gratuitas que funcionan en tu navegador.';
  const url = urlPublica(ruta);
  const esInicio = ruta === '/index.html';
  return { titulo, descripcion, url, esInicio };
}

function bloqueJsonLd(m: ReturnType<typeof metadatosDe>): string {
  const organizacion = { '@type': 'Organization', '@id': `${SITE}/#org`, name: 'ChispaBox', url: SITE, logo: OG_IMAGE };
  const sitio = {
    '@type': 'WebSite',
    '@id': `${SITE}/#web`,
    url: SITE,
    name: 'ChispaBox',
    inLanguage: 'es',
    publisher: { '@id': `${SITE}/#org` },
  };
  const pagina = m.esInicio
    ? { '@type': 'WebPage', '@id': `${m.url}#pagina`, url: m.url, name: m.titulo, description: m.descripcion, isPartOf: { '@id': `${SITE}/#web` }, inLanguage: 'es' }
    : {
        '@type': 'WebApplication',
        '@id': `${m.url}#app`,
        url: m.url,
        name: m.titulo.replace(/\s*\|\s*ChispaBox\s*$/, ''),
        description: m.descripcion,
        applicationCategory: 'UtilitiesApplication',
        operatingSystem: 'Cualquiera con navegador web moderno',
        browserRequirements: 'Requiere JavaScript',
        isAccessibleForFree: true,
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
        inLanguage: 'es',
        isPartOf: { '@id': `${SITE}/#web` },
        publisher: { '@id': `${SITE}/#org` },
      };
  const grafo = { '@context': 'https://schema.org', '@graph': [organizacion, sitio, pagina] };
  // Evita que un "</script>" dentro del JSON cierre la etiqueta antes de tiempo.
  return JSON.stringify(grafo).replace(/</g, '\\u003c');
}

export function seoHead(publicBuild: boolean): Plugin {
  return {
    name: 'seo-head',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        const ruta = ctx.path;
        if (!ruta || ruta.endsWith('/404.html') || ruta === '/404.html') return html;
        const m = metadatosDe(html, ruta);
        const etiquetas: string[] = [];
        if (!/rel="canonical"/.test(html)) etiquetas.push(`<link rel="canonical" href="${escapeAttr(m.url)}" />`);
        if (!/property="og:title"/.test(html)) {
          etiquetas.push(
            `<meta property="og:type" content="website" />`,
            `<meta property="og:site_name" content="ChispaBox" />`,
            `<meta property="og:locale" content="${LOCALE}" />`,
            `<meta property="og:title" content="${escapeAttr(m.titulo)}" />`,
            `<meta property="og:description" content="${escapeAttr(m.descripcion)}" />`,
            `<meta property="og:url" content="${escapeAttr(m.url)}" />`,
            `<meta property="og:image" content="${OG_IMAGE}" />`,
            `<meta name="twitter:card" content="summary" />`,
          );
        }
        if (!/application\/ld\+json/.test(html)) {
          etiquetas.push(`<script type="application/ld+json">${bloqueJsonLd(m)}</script>`);
        }
        if (etiquetas.length === 0) return html;
        return html.replace(/<\/head>/, `    ${etiquetas.join('\n    ')}\n  </head>`);
      },
    },
    generateBundle: {
      order: 'post',
      handler(_opciones, bundle) {
      if (!publicBuild) return;
      // Mapa del sitio con las páginas que realmente se compilan en la versión pública.
      const paginas = Object.keys(bundle)
        .filter((nombre) => nombre.endsWith('.html') && nombre !== '404.html')
        .map((nombre) => `${SITE}/${nombre.replace(/index\.html$/, '')}`)
        .sort();
      const urls = paginas.map((u) => `  <url><loc>${escapeAttr(u)}</loc></url>`).join('\n');
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
      this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: xml });
      },
    },
  };
}
