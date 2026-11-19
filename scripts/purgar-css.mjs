// Elimina de la hoja de estilos compilada las reglas CSS que ninguna página ni script utiliza.
// Usa PurgeCSS: analiza el HTML y el JS ya compilados en dist/ y reescribe los .css en su sitio.
// Se ejecuta automáticamente tras `npm run build` (script "postbuild").
// Uso manual: npm run purgar-css   (requiere haber ejecutado antes el build)

import { readdir, readFile, writeFile, stat } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PurgeCSS } from 'purgecss';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');

async function listar(dir, extensiones) {
  const salida = [];
  for (const entrada of await readdir(dir, { withFileTypes: true })) {
    const ruta = join(dir, entrada.name);
    if (entrada.isDirectory()) salida.push(...(await listar(ruta, extensiones)));
    else if (extensiones.some((ext) => entrada.name.endsWith(ext))) salida.push(ruta);
  }
  return salida;
}

await stat(DIST).catch(() => {
  console.error('No existe dist/. Ejecutá `npm run build` primero.');
  process.exit(1);
});

const hojas = await listar(join(DIST, 'assets'), ['.css']);
if (hojas.length === 0) {
  console.log('purgar-css: no hay hojas de estilo en dist/assets, nada que hacer.');
  process.exit(0);
}

// Contenido donde buscar selectores usados: páginas HTML y bundles JS (las clases que se
// añaden desde el código también cuentan como usadas).
const contenido = [
  ...(await listar(DIST, ['.html'])),
  ...(await listar(join(DIST, 'assets'), ['.js'])),
];

// Clases y atributos que el código activa dinámicamente y no aparecen completos en el HTML/JS.
const safelist = [/^is-/, /^has-/, /^js-/, /^active/, /^open/, /^show/, /^hidden/, /^visible/, /^dark/, /^light/, /^error/, /^success/, /^warning/, /data-/, /aria-/];

let totalAntes = 0;
let totalDespues = 0;

for (const hoja of hojas) {
  const original = await readFile(hoja, 'utf8');
  // Se pasa el CSS como texto (raw) para evitar que las rutas de Windows se interpreten como globs.
  const res = await new PurgeCSS().purge({
    content: contenido,
    css: [{ raw: original }],
    safelist,
    keyframes: true,
    fontFace: true,
  });
  const nuevo = res[0].css;
  totalAntes += Buffer.byteLength(original);
  totalDespues += Buffer.byteLength(nuevo);
  await writeFile(hoja, nuevo, 'utf8');
  console.log(
    `purgar-css: ${relative(ROOT, hoja)} ${(Buffer.byteLength(original) / 1024).toFixed(1)} KB -> ${(Buffer.byteLength(nuevo) / 1024).toFixed(1)} KB`,
  );
}

console.log(`purgar-css: total ${(totalAntes / 1024).toFixed(1)} KB -> ${(totalDespues / 1024).toFixed(1)} KB`);
